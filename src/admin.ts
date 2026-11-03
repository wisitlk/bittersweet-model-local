import { findProduct } from "./catalog";
import { PERSONALITY } from "./survey";
import type { Env } from "./types";

/*
 * Staff dashboard inside the LINE web app. Only LINE users listed in the secret ADMIN_LINE_USER_IDS (comma separated)
 * get an "admin" flag in /api/me and can call /api/admin/*. The caller is identified by the same LINE ID-token check
 * as every other web API call (src/liff.ts), so nobody can claim to be an admin.
 *
 * It shows counts for the marketing funnel and the order list, and lets staff move an order along
 * awaiting_payment -> paid -> shipped, or cancel it. Points follow on their own: purchase points count only for
 * paid/shipped orders and a cancelled order's redemption stops counting (BALANCE_SQL in src/loyalty.ts).
 * Customer details are shown to staff only, never logged.
 *
 * Subrequests: verify 1 + rate limit 1 + at most 10 D1 queries.
 */

export function isAdmin(env: Env, userId: string): boolean {
  return (env.ADMIN_LINE_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(userId);
}

export const ORDER_STATUSES = ["awaiting_payment", "paid", "shipped", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Which status each status may move to. Shipped and cancelled are final. */
export const NEXT_STATUS: Record<OrderStatus, readonly OrderStatus[]> = {
  awaiting_payment: ["paid", "cancelled"],
  paid: ["shipped", "cancelled"],
  shipped: [],
  cancelled: [],
};

const DAY_MS = 86_400_000;
const ORDER_LIST_LIMIT = 50;

interface CountRow {
  key: string;
  n: number;
}

async function counts(db: D1Database, sql: string, ...params: unknown[]): Promise<Record<string, number>> {
  const { results } = await db.prepare(sql).bind(...params).all<CountRow>();
  return Object.fromEntries(results.map((r) => [r.key, r.n]));
}

async function one(db: D1Database, sql: string, ...params: unknown[]): Promise<number> {
  const row = await db.prepare(sql).bind(...params).first<{ n: number | null }>();
  return row?.n ?? 0;
}

/** The funnel numbers, survey mix, waitlist and sales, from D1 only. */
export async function adminSummary(db: D1Database, now: number) {
  const weekAgo = now - 7 * DAY_MS;
  const [chatters7d, messages7d, consents, members, surveys, personality, ageGroups, waitlist, orders, sales] =
    await Promise.all([
      one(db, "SELECT COUNT(DISTINCT user_id) AS n FROM messages WHERE role = 'user' AND created_at >= ?1", weekAgo),
      one(db, "SELECT COUNT(*) AS n FROM messages WHERE role = 'user' AND created_at >= ?1", weekAgo),
      one(db, "SELECT COUNT(*) AS n FROM consents WHERE given = 1"),
      one(db, "SELECT COUNT(*) AS n FROM members"),
      one(db, "SELECT COUNT(*) AS n FROM surveys"),
      counts(db, "SELECT personality AS key, COUNT(*) AS n FROM surveys GROUP BY personality"),
      counts(db, "SELECT age_group AS key, COUNT(*) AS n FROM surveys GROUP BY age_group"),
      counts(db, "SELECT product AS key, COUNT(*) AS n FROM waitlist GROUP BY product"),
      counts(db, "SELECT status AS key, COUNT(*) AS n FROM orders GROUP BY status"),
      db
        .prepare(
          `SELECT COALESCE(SUM(total), 0) AS revenue, COALESCE(SUM(discount), 0) AS discount,
                  COALESCE(SUM(points_used), 0) AS points_used
           FROM orders WHERE status IN ('paid', 'shipped')`,
        )
        .first<{ revenue: number; discount: number; points_used: number }>(),
    ]);
  return {
    funnel: { chatters7d, messages7d, consents, members, surveys, orders: Object.values(orders).reduce((a, b) => a + b, 0) },
    personality: Object.entries(PERSONALITY).map(([key, p]) => ({ key, label: p.label, count: personality[key] ?? 0 })),
    ageGroups,
    waitlist: Object.entries(waitlist).map(([id, n]) => ({ id, name: findProduct(id)?.name ?? id, count: n })),
    orders,
    sales: { revenue: sales?.revenue ?? 0, discount: sales?.discount ?? 0, points_used: sales?.points_used ?? 0 },
  };
}

interface OrderRow {
  ref: string;
  lines: string;
  subtotal: number;
  discount: number;
  total: number;
  points_used: number;
  ship_name: string;
  ship_phone: string;
  ship_address: string;
  ship_postcode: string;
  status: string;
  created_at: number;
}

/** "0812345678" -> "081-xxx-5678": enough to match a slip, not the whole number. */
export function maskPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  return d.length >= 7 ? `${d.slice(0, 3)}-xxx-${d.slice(-4)}` : "xxx";
}

function describeLines(raw: string): string {
  try {
    const lines = JSON.parse(raw) as { product?: string; variant?: string; qty?: number }[];
    return lines
      .map((l) => `${findProduct(l.product)?.name ?? l.product} ${l.variant === "sample" ? "Sample 5 ml" : "10 ml"} x${l.qty}`)
      .join(", ");
  } catch {
    return "";
  }
}

/**
 * The newest orders. The full address is shown only while it is needed to ship (paid); otherwise the name, a masked
 * phone and the postcode are enough to match a payment slip.
 */
export async function adminOrders(db: D1Database) {
  const { results } = await db
    .prepare(
      `SELECT ref, lines, subtotal, discount, total, points_used, ship_name, ship_phone, ship_address, ship_postcode,
              status, created_at
       FROM orders ORDER BY created_at DESC LIMIT ?1`,
    )
    .bind(ORDER_LIST_LIMIT)
    .all<OrderRow>();
  return results.map((o) => {
    const ship = o.status === "paid";
    return {
      ref: o.ref,
      items: describeLines(o.lines),
      subtotal: o.subtotal,
      discount: o.discount,
      total: o.total,
      points_used: o.points_used,
      name: o.ship_name,
      phone: ship ? o.ship_phone : maskPhone(o.ship_phone),
      address: ship ? `${o.ship_address} ${o.ship_postcode}` : o.ship_postcode,
      status: o.status,
      next: NEXT_STATUS[o.status as OrderStatus] ?? [],
      created_at: o.created_at,
    };
  });
}

export type StatusChange = "ok" | "bad_status" | "not_found" | "not_allowed";

/**
 * Moves one order to `to` if that is allowed from its current status. The UPDATE checks the status it read, so a
 * double tap or two staff at once change it only once.
 */
export async function setOrderStatus(db: D1Database, ref: unknown, to: unknown): Promise<StatusChange> {
  if (typeof ref !== "string" || !/^BS-[A-Z0-9]{4,12}$/.test(ref)) return "not_found";
  if (typeof to !== "string" || !(ORDER_STATUSES as readonly string[]).includes(to)) return "bad_status";
  const row = await db.prepare("SELECT status FROM orders WHERE ref = ?1").bind(ref).first<{ status: string }>();
  if (!row) return "not_found";
  const allowed = NEXT_STATUS[row.status as OrderStatus] ?? [];
  if (!(allowed as readonly string[]).includes(to)) return row.status === to ? "ok" : "not_allowed";
  await db.prepare("UPDATE orders SET status = ?1 WHERE ref = ?2 AND status = ?3").bind(to, ref, row.status).run();
  return "ok";
}
