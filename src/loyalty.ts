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
  ]);
}
