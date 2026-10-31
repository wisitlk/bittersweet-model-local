import { findProduct, SAMPLE_PRICE } from "./catalog";
import { isRecord } from "./guards";
import { cleanPhone } from "./member";
import type { Env } from "./types";

/*
 * Buy flow of the web app: cart -> shipping address -> PromptPay payment page.
 *
 * SELLING IS OFF until the Thai FDA cosmetic notification exists (project rule, see CLAUDE.md). Sales open only
 * when BOTH vars are set: FDA_NOTIFICATION_NO (the notification number) and PROMPTPAY_ID (the shop's PromptPay
 * phone or tax id). Until then the same screens run as a demo: prices are computed, but no order and no address
 * is stored and no payment QR is made, so nobody can pay.
 * When sales open, content/knowledge.md and content/system_prompt.md must be updated too (they say "not selling").
 */

export const VARIANTS = {
  bottle: { label: "ขวด 10 ml", price: 450 },
  sample: { label: "Sample 5 ml", price: SAMPLE_PRICE },
} as const;
export type Variant = keyof typeof VARIANTS;

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
  total: number; // THB, products only; shipping is agreed in the chat
}

export const salesOpen = (env: Env) => Boolean(env.FDA_NOTIFICATION_NO?.trim() && env.PROMPTPAY_ID?.trim());

export type OrderError = "bad_cart" | "bad_shipping";

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
  // The price always comes from the catalog, never from the page.
  const total = lines.reduce((sum, l) => sum + VARIANTS[l.variant].price * l.qty, 0);
  return { lines, shipping: { name, phone, address, postcode }, total };
}

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

export async function saveOrder(db: D1Database, ref: string, userId: string, o: Order, now: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO orders (ref, user_id, lines, total, ship_name, ship_phone, ship_address, ship_postcode, status, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'awaiting_payment', ?9)`,
    )
    .bind(ref, userId, JSON.stringify(o.lines), o.total, o.shipping.name, o.shipping.phone, o.shipping.address, o.shipping.postcode, now)
    .run();
}
