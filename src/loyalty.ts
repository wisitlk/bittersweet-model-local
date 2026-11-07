import { POINT_RULES, type PointReason } from "./catalog";

export interface PointRow {
  reason: string;
  points: number;
  created_at: number;
}

/** Awards the points for `reason` once. Returns true if they were new. Safe to call again (double taps, retries). */
export async function awardPoints(db: D1Database, userId: string, reason: PointReason, now: number): Promise<boolean> {
  const r = await db
    .prepare("INSERT INTO points (user_id, reason, amount, created_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT DO NOTHING")
    .bind(userId, reason, POINT_RULES[reason].points, now)
    .run();
  return r.meta.changes === 1;
}

/** Purchase points: 1 point per this many THB paid for products (after discount), once staff mark the order paid. */
export const BAHT_PER_POINT = 10;
const PAID = "('paid', 'shipped')";

/**
 * The point balance as SQL, for user ?1. Purchase points come from the orders table itself (status set by staff), and
 * points spent on an order that staff cancelled count again, so no extra write is needed to award or refund.
 */
export const BALANCE_SQL = `(SELECT COALESCE(SUM(p.amount), 0) FROM points p WHERE p.user_id = ?1
    AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.status = 'cancelled' AND p.reason = 'redeem:' || o.ref))
  + (SELECT COALESCE(SUM(o.total / ${BAHT_PER_POINT}), 0) FROM orders o WHERE o.user_id = ?1 AND o.status IN ${PAID})`;

export async function pointBalance(db: D1Database, userId: string): Promise<number> {
  const row = await db.prepare(`SELECT ${BALANCE_SQL} AS balance`).bind(userId).first<{ balance: number }>();
  return row?.balance ?? 0;
}

export interface LedgerRow extends PointRow {
  ref?: string;
}

/**
 * Everything that counts toward the balance, oldest first: point awards, redemptions (dropped once the order is
 * cancelled, which gives the points back) and paid orders. One query, so the page and BALANCE_SQL always agree.
 */
export async function loadLedger(db: D1Database, userId: string): Promise<LedgerRow[]> {
  const { results } = await db
    .prepare(
      `SELECT p.reason AS reason, p.amount AS points, p.created_at AS created_at FROM points p WHERE p.user_id = ?1
         AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.status = 'cancelled' AND p.reason = 'redeem:' || o.ref)
       UNION ALL
       SELECT 'purchase:' || o.ref, o.total / ${BAHT_PER_POINT}, o.created_at FROM orders o
         WHERE o.user_id = ?1 AND o.status IN ${PAID} AND o.total >= ${BAHT_PER_POINT}
       ORDER BY created_at, reason`,
    )
    .bind(userId)
    .all<PointRow>();
  return results.map((r) => {
    const i = r.reason.indexOf(":");
    return i > 0 ? { ...r, ref: r.reason.slice(i + 1) } : r;
  });
}

export async function loadPoints(db: D1Database, userId: string): Promise<PointRow[]> {
  const { results } = await db
    .prepare("SELECT reason, amount AS points, created_at FROM points WHERE user_id = ?1 ORDER BY created_at, reason")
    .bind(userId)
    .all<PointRow>();
  return results;
}

export async function loadWaitlist(db: D1Database, userId: string): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT product FROM waitlist WHERE user_id = ?1 ORDER BY created_at, product")
    .bind(userId)
    .all<{ product: string }>();
  return results.map((r) => r.product);
}

/** true if this product is new on the user's waitlist. */
export async function joinWaitlist(db: D1Database, userId: string, product: string, now: number): Promise<boolean> {
  const r = await db
    .prepare("INSERT INTO waitlist (user_id, product, created_at) VALUES (?1, ?2, ?3) ON CONFLICT DO NOTHING")
    .bind(userId, product, now)
    .run();
  return r.meta.changes === 1;
}

/** Part of a deletion request: points, waitlist, survey and member details go too. One batch, one subrequest. */
export async function deleteLoyalty(db: D1Database, userId: string): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM points WHERE user_id = ?1").bind(userId),
    db.prepare("DELETE FROM waitlist WHERE user_id = ?1").bind(userId),
    db.prepare("DELETE FROM surveys WHERE user_id = ?1").bind(userId),
    db.prepare("DELETE FROM members WHERE user_id = ?1").bind(userId),
    // Orders are not deleted here: tax law may require keeping paid orders, so a deletion request from a buyer
    // is handed to staff instead (see docs/LIFF.md).
  ]);
}
