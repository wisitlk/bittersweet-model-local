import { findProduct, SAMPLE_PRICE } from "./catalog";
import { isRecord } from "./guards";
import { BALANCE_SQL } from "./loyalty";
import { cleanPhone } from "./member";
import type { Env } from "./types";

/*
 * Buy flow of the web app: cart (+ optional points redemption) -> shipping address -> PromptPay payment page.
 *
 * Sales are open only when BOTH are set (as Worker secrets, see docs/LIFF.md): FDA_NOTIFICATION_NO (the Thai FDA
 * cosmetic notification number) and PROMPTPAY_ID (the shop's PromptPay phone or tax id). Without them the same
 * screens run as a demo: prices are computed, but no order, address or points change is stored and no payment QR
 * is made, so nobody can pay. The chat bot never takes orders itself; it sends buyers to this page.
 */

export const VARIANTS = {
  bottle: { label: "ขวด 10 ml", price: 450 },
  sample: { label: "Sample 5 ml", price: SAMPLE_PRICE },
} as const;
export type Variant = keyof typeof VARIANTS;

/** Points redemption: one per order, applied to the products total. The page shows these; the server decides. */
export const REDEEM_OPTIONS = {
  off20: { points: 50, percent: 20, label: "ใช้ 50 คะแนน ลด 20%" },
  off50: { points: 200, percent: 50, label: "ใช้ 200 คะแนน ลด 50%" },
} as const;
export type RedeemOption = keyof typeof REDEEM_OPTIONS;

export const MAX_QTY = 5; // per line
export const MAX_LINES = 10;
const MAX_ADDRESS_CHARS = 300;

export interface OrderLine {
  product: string;
  variant: Variant;
  qty: number;
}
export interface Shipping {
  name: string;
  phone: string;
  address: string;
  postcode: string;
}
export interface Order {
  lines: OrderLine[];
  shipping: Shipping;
  subtotal: number; // THB, products only; shipping is agreed in the chat
  redeem: RedeemOption | null;
  discount: number; // THB taken off by the redemption
  total: number; // subtotal - discount: what the customer pays for the products
}

export const salesOpen = (env: Env) => Boolean(env.FDA_NOTIFICATION_NO?.trim() && env.PROMPTPAY_ID?.trim());

export type OrderError = "bad_cart" | "bad_shipping" | "bad_redeem";

function text(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  // No control characters or angle brackets: this is shown to staff later.
  const s = v.normalize("NFC").replace(/\s+/g, " ").trim();
  return s && s.length <= max && !/[<>\p{Cc}]/u.test(s) ? s : null;
}

export function parseOrder(body: unknown): Order | OrderError {
  if (!isRecord(body) || !Array.isArray(body.lines) || !body.lines.length || body.lines.length > MAX_LINES) return "bad_cart";
  const lines: OrderLine[] = [];
  for (const l of body.lines as unknown[]) {
    if (!isRecord(l) || !findProduct(l.product) || typeof l.variant !== "string" || !(l.variant in VARIANTS)) return "bad_cart";
    if (typeof l.qty !== "number" || !Number.isInteger(l.qty) || l.qty < 1 || l.qty > MAX_QTY) return "bad_cart";
    lines.push({ product: l.product as string, variant: l.variant as Variant, qty: l.qty });
  }
  const s = isRecord(body.shipping) ? body.shipping : {};
  const name = text(s.name, 120);
  const phone = cleanPhone(s.phone);
  const address = text(s.address, MAX_ADDRESS_CHARS);
  const postcode = typeof s.postcode === "string" && /^\d{5}$/.test(s.postcode.trim()) ? s.postcode.trim() : null;
  if (!name || !phone || !address || !postcode) return "bad_shipping";
  let redeem: RedeemOption | null = null;
  if (body.redeem !== undefined && body.redeem !== null && body.redeem !== "") {
    if (typeof body.redeem !== "string" || !Object.hasOwn(REDEEM_OPTIONS, body.redeem)) return "bad_redeem";
    redeem = body.redeem as RedeemOption;
  }
  // The price and the discount always come from the catalog, never from the page.
  const subtotal = lines.reduce((sum, l) => sum + VARIANTS[l.variant].price * l.qty, 0);
  const discount = redeem ? Math.round((subtotal * REDEEM_OPTIONS[redeem].percent) / 100) : 0;
  return { lines, shipping: { name, phone, address, postcode }, subtotal, redeem, discount, total: subtotal - discount };
}

/** Ledger reason of the points spent on one order; unique per order, so a retry can never spend twice. */
export const redeemReason = (ref: string) => "redeem:" + ref;

/** CRC-16/CCITT-FALSE, as EMVCo QR codes (PromptPay) require. */
export function crc16(s: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(s)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

const tlv = (id: string, value: string) => id + String(value.length).padStart(2, "0") + value;

/** PromptPay "Tag 30"-style payload for one payment of `amount` THB to a phone number or 13-digit tax id. */
export function promptPayPayload(promptPayId: string, amount: number): string {
  const digits = promptPayId.replace(/\D/g, "");
  const target =
    digits.length >= 13
      ? tlv("02", digits) // national / tax id
      : tlv("01", ("0000000000000" + digits.replace(/^0/, "66")).slice(-13)); // phone: 0066XXXXXXXXX
  const body =
    tlv("00", "01") +
    tlv("01", "12") + // dynamic QR: one payment, with amount
    tlv("29", tlv("00", "A000000677010111") + target) +
    tlv("53", "764") + // THB
    tlv("54", amount.toFixed(2)) +
    tlv("58", "TH");
  return body + "6304" + crc16(body + "6304");
}

/** Order reference shown to the customer and staff, e.g. BS-7K2Q9M. */
export function orderRef(): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return "BS-" + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/**
 * Saves the order. With a redemption, the points are taken and the order is written in one D1 batch (one
 * transaction): the points row is only inserted while the balance covers it, and the order row only when that
 * points row exists, so two orders at once can never spend the same points. Returns false if the points ran out.
 */
export async function saveOrder(db: D1Database, ref: string, userId: string, o: Order, now: number): Promise<boolean> {
  const cols = `(ref, user_id, lines, subtotal, discount, points_used, total, ship_name, ship_phone, ship_address,
     ship_postcode, status, created_at)`;
  const values = [ref, userId, JSON.stringify(o.lines), o.subtotal, o.discount, o.redeem ? REDEEM_OPTIONS[o.redeem].points : 0,
    o.total, o.shipping.name, o.shipping.phone, o.shipping.address, o.shipping.postcode, now];
  if (!o.redeem) {
    await db
      .prepare(`INSERT INTO orders ${cols} VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'awaiting_payment', ?12)`)
      .bind(...values)
      .run();
    return true;
  }
  const cost = REDEEM_OPTIONS[o.redeem].points;
  const reason = redeemReason(ref);
  const [, saved] = await db.batch([
    db
      .prepare(
        `INSERT INTO points (user_id, reason, amount, created_at)
         SELECT ?1, ?2, ?3, ?4 WHERE ${BALANCE_SQL} >= ?5`,
      )
      .bind(userId, reason, -cost, now, cost),
    db
      .prepare(
        `INSERT INTO orders ${cols}
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'awaiting_payment', ?12
         WHERE EXISTS (SELECT 1 FROM points WHERE user_id = ?2 AND reason = ?13)`,
      )
      .bind(...values, reason),
  ]);
  return saved?.meta.changes === 1;
}
