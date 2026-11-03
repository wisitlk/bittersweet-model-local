import type { ChatMessage } from "./claude";

const HISTORY_TURNS = 10;
// Once a chat is longer than HISTORY_TURNS, the oldest turns are dropped HISTORY_STEP_TURNS at a time instead of one
// per message, so the history starts at the same message for several turns in a row (between 6 and 10 turns are
// sent). A history that started one turn later on every message made the local model re-read all of it each time.
const HISTORY_STEP_TURNS = 4;
export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Idempotency: true if this LINE event id is new (and is now recorded), false if already handled.
 * One atomic INSERT ... ON CONFLICT, so two simultaneous deliveries cannot both win.
 */
export async function claimEvent(db: D1Database, eventId: string, now: number): Promise<boolean> {
  const r = await db
    .prepare("INSERT INTO processed_events (id, created_at) VALUES (?1, ?2) ON CONFLICT(id) DO NOTHING")
    .bind(eventId, now)
    .run();
  return r.meta.changes === 1;
}

/**
 * Counts one hit in a fixed window and returns the new count.
 * The window starts at the first hit and ends at `expiresAt`; after that the next hit starts a new one.
 */
async function hit(db: D1Database, key: string, expiresAt: number, now: number): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO counters (key, count, expires_at) VALUES (?1, 1, ?2)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN counters.expires_at <= ?3 THEN 1 ELSE counters.count + 1 END,
         expires_at = CASE WHEN counters.expires_at <= ?3 THEN ?2 ELSE counters.expires_at END
       RETURNING count`,
    )
    .bind(key, expiresAt, now)
    .first<{ count: number }>();
  return row?.count ?? 1;
}

/** Per-user limit. true = allowed. */
export async function allowUserMessage(
  db: D1Database,
  userId: string,
  limit: number,
  windowSeconds: number,
  now: number,
): Promise<boolean> {
  const count = await hit(db, `user:${userId}`, now + windowSeconds * 1000, now);
  return count <= limit;
}

/** Limit on web-app API calls per user (separate from the chat limits). true = allowed. */
export async function allowWebRequest(
  db: D1Database,
  userId: string,
  limit: number,
  windowSeconds: number,
  now: number,
): Promise<boolean> {
  const count = await hit(db, `web:${userId}`, now + windowSeconds * 1000, now);
  return count <= limit;
}

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function endOfUtcDay(now: number): number {
  return Math.floor(now / DAY_MS) * DAY_MS + DAY_MS;
}

/** Per-user limit per UTC day. true = allowed. */
export async function allowUserDay(db: D1Database, userId: string, limit: number, now: number): Promise<boolean> {
  const day = utcDay(now);
  const count = await hit(db, `userday:${day}:${userId}`, endOfUtcDay(now), now);
  return count <= limit;
}

/** Global daily cap on Claude calls (UTC day), all users together. true = allowed. */
export async function allowDailyCall(db: D1Database, cap: number, now: number): Promise<boolean> {
  const day = utcDay(now);
  const count = await hit(db, `day:${day}`, endOfUtcDay(now), now);
  return count <= cap;
}

/** Deletes data older than 7 days and expired counters. Run daily by the scheduled() handler. */
export async function cleanup(db: D1Database, now: number): Promise<void> {
  const cutoff = now - RETENTION_MS;
  await db.batch([
    db.prepare("DELETE FROM messages WHERE created_at < ?1").bind(cutoff),
    db.prepare("DELETE FROM processed_events WHERE created_at < ?1").bind(cutoff),
    db.prepare("DELETE FROM counters WHERE expires_at < ?1").bind(now),
    db.prepare("DELETE FROM consents WHERE updated_at < ?1").bind(cutoff),
  ]);
}

/**
 * The recent turns, oldest first, always starting with a user message: all of them up to HISTORY_TURNS, then between
 * HISTORY_TURNS - HISTORY_STEP_TURNS + 1 and HISTORY_TURNS turns, with a start that moves only every HISTORY_STEP_TURNS.
 */
export async function loadHistory(db: D1Database, userId: string): Promise<ChatMessage[]> {
  const { results } = await db
    .prepare(
      `SELECT role, content, (SELECT COUNT(*) FROM messages WHERE user_id = ?1) AS total
       FROM messages WHERE user_id = ?1 ORDER BY created_at DESC, id DESC LIMIT ?2`,
    )
    .bind(userId, HISTORY_TURNS * 2)
    .all<{ role: string; content: string; total: number }>();
  const total = results[0]?.total ?? 0;
  const keep = Math.min(results.length, historyLength(total));
  const msgs: ChatMessage[] = [];
  for (const r of results.slice(0, keep).reverse()) {
    if (r.role === "user" || r.role === "assistant") msgs.push({ role: r.role, content: r.content });
  }
  while (msgs[0]?.role === "assistant") msgs.shift();
  return msgs;
}

/** How many of a user's `total` stored messages to send: all up to the cap, then a window whose start moves in steps. */
export function historyLength(total: number): number {
  const max = HISTORY_TURNS * 2;
  if (total <= max) return total;
  const step = HISTORY_STEP_TURNS * 2;
  const min = max - step + 2;
  return Math.min(max, total - Math.floor((total - min) / step) * step);
}

export async function saveTurn(
  db: D1Database,
  userId: string,
  userText: string,
  assistantText: string,
  now: number,
): Promise<void> {
  // One statement, two rows (user first, so the autoincrement id keeps them in order).
  await db
    .prepare(
      `INSERT INTO messages (user_id, role, content, created_at)
       VALUES (?1, 'user', ?2, ?4), (?1, 'assistant', ?3, ?4)`,
    )
    .bind(userId, userText, assistantText, now)
    .run();
}

export async function deleteHistory(db: D1Database, userId: string): Promise<void> {
  await db.prepare("DELETE FROM messages WHERE user_id = ?1").bind(userId).run();
}

export async function hasConsent(db: D1Database, userId: string): Promise<boolean> {
  const row = await db.prepare("SELECT given FROM consents WHERE user_id = ?1").bind(userId).first<{ given: number }>();
  return row?.given === 1;
}

/** Remembers that the user gave PDPA consent. Refreshed whenever the model reports consent again. */
export async function saveConsent(db: D1Database, userId: string, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO consents (user_id, given, updated_at) VALUES (?1, 1, ?2)
       ON CONFLICT(user_id) DO UPDATE SET given = 1, updated_at = ?2`,
    )
    .bind(userId, now)
    .run();
}

export async function deleteConsent(db: D1Database, userId: string): Promise<void> {
  await db.prepare("DELETE FROM consents WHERE user_id = ?1").bind(userId).run();
}
