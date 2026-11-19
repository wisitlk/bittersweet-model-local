import type { Product, ScentDetail } from "./catalog";
import { isRecord } from "./guards";

/*
 * The fish for sale live in D1 (table products) so staff can add and edit them in the dashboard without a deploy.
 * schema.sql seeds the five starter fish from src/catalog.ts. Each listing has a stock count (a single betta is 1);
 * an order takes stock in the same D1 batch that saves it (src/checkout.ts) and a cancelled order gives it back
 * (src/admin.ts). Photos uploaded in the dashboard are stored in product_images and served at /pimg/<id>.
 */

export const PRODUCT_STATUSES = ["active", "hidden"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export interface ShopProduct extends Product {
  stock: number;
  status: ProductStatus;
  sort: number;
}

interface ProductRow {
  id: string;
  name: string;
  size: string;
  price: number;
  blurb: string;
  color: string;
  image: string;
  detail: string;
  stock: number;
  status: string;
  sort: number;
}

const EMPTY_DETAIL: ScentDetail = { number: "", tagline: "", smells: "", feel: "", suits: [], when: "" };

function parseDetail(raw: string): ScentDetail {
  try {
    const d: unknown = JSON.parse(raw);
    if (!isRecord(d)) return EMPTY_DETAIL;
    const s = (v: unknown) => (typeof v === "string" ? v : "");
    return {
      number: s(d.number),
      tagline: s(d.tagline),
      smells: s(d.smells),
      feel: s(d.feel),
      suits: Array.isArray(d.suits) ? d.suits.filter((x): x is string => typeof x === "string") : [],
      when: s(d.when),
    };
  } catch {
    return EMPTY_DETAIL;
  }
}

function rowToProduct(r: ProductRow): ShopProduct {
  return {
    id: r.id,
    name: r.name,
    size: r.size,
    price: r.price,
    blurb: r.blurb,
    color: r.color,
    ...(r.image ? { image: r.image } : {}),
    detail: parseDetail(r.detail),
    stock: r.stock,
    status: r.status === "hidden" ? "hidden" : "active",
    sort: r.sort,
  };
}

/** Listings in shop order. Customers see only active ones (sold-out included, shown as sold out); staff see all. */
export async function loadProducts(db: D1Database, includeHidden = false): Promise<ShopProduct[]> {
  const { results } = await db
    .prepare(
      `SELECT id, name, size, price, blurb, color, image, detail, stock, status, sort FROM products
       ${includeHidden ? "" : "WHERE status = 'active'"} ORDER BY sort, created_at, id`,
    )
    .all<ProductRow>();
  return results.map(rowToProduct);
}

// ---- Staff edits ----------------------------------------------------------------------------------------------------

export const MAX_IMAGE_BYTES = 400 * 1024; // after the browser resizes the photo
export const MAX_PRODUCT_BODY_BYTES = 600 * 1024; // JSON with the base64 photo
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export interface ProductInput {
  id: string | null; // null = new listing
  name: string;
  size: string;
  price: number;
  stock: number;
  status: ProductStatus;
  blurb: string;
  color: string;
  detail: ScentDetail;
  image: { mime: string; data: string } | null; // a new photo, base64
  removeImage: boolean;
}

/** Text a customer will see: no angle brackets or control characters, whitespace tidied, within `max`. */
function cleanText(v: unknown, max: number, required = false): string | null {
  if (v === undefined || v === null) return required ? null : "";
  if (typeof v !== "string") return null;
  const s = v.normalize("NFC").replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  // Angle brackets and control characters (except the newlines kept above) are refused.
  if (s.length > max || /[<>]/.test(s) || /[^\P{Cc}\n]/u.test(s)) return null;
  if (required && !s) return null;
  return s;
}

function int(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n >= min && n <= max ? n : null;
}

export type ProductError = "bad_name" | "bad_price" | "bad_stock" | "bad_text" | "bad_image" | "bad_id";

/** Checks a listing sent from the dashboard. Every field is validated; the page is never trusted. */
export function parseProductInput(body: unknown): ProductInput | ProductError {
  if (!isRecord(body)) return "bad_text";
  let id: string | null = null;
  if (body.id !== undefined && body.id !== null && body.id !== "") {
    if (typeof body.id !== "string" || !/^[a-z0-9_]{2,40}$/.test(body.id)) return "bad_id";
    id = body.id;
  }
  const name = cleanText(body.name, 60, true);
  if (!name) return "bad_name";
  const price = int(body.price, 1, 1_000_000);
  if (price === null) return "bad_price";
  const stock = int(body.stock, 0, 999);
  if (stock === null) return "bad_stock";
  const status: ProductStatus = body.status === "hidden" ? "hidden" : "active";
  const color = typeof body.color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.color) ? body.color : "#2e6fa7";
  const size = cleanText(body.size, 80);
  const blurb = cleanText(body.blurb, 200);
  const d = isRecord(body.detail) ? body.detail : {};
  const detail = {
    number: cleanText(d.number, 30),
    tagline: cleanText(d.tagline, 100),
    smells: cleanText(d.smells, 400),
    feel: cleanText(d.feel, 200),
    when: cleanText(d.when, 400),
  };
  const suitsRaw = Array.isArray(d.suits) ? d.suits : typeof d.suits === "string" ? d.suits.split("\n") : [];
  const suits = suitsRaw.map((s) => cleanText(s, 150));
  if (size === null || blurb === null || Object.values(detail).some((v) => v === null) || suits.some((s) => s === null)) {
    return "bad_text";
  }
  let image: ProductInput["image"] = null;
  if (body.image !== undefined && body.image !== null && body.image !== "") {
    // "data:image/jpeg;base64,...." from the dashboard's canvas resize.
    const m = typeof body.image === "string" ? /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(body.image) : null;
    if (!m || !(IMAGE_TYPES as readonly string[]).includes(m[1]!)) return "bad_image";
    if ((m[2]!.length * 3) / 4 > MAX_IMAGE_BYTES) return "bad_image";
    image = { mime: m[1]!, data: m[2]! };
  }
  return {
    id,
    name,
    size,
    price,
    stock,
    status,
    blurb,
    color,
    detail: {
      number: detail.number!,
      tagline: detail.tagline!,
      smells: detail.smells!,
      feel: detail.feel!,
      when: detail.when!,
      suits: (suits as string[]).filter(Boolean).slice(0, 6),
    },
    image,
    removeImage: body.remove_image === true,
  };
}

/** A new id from the name: lowercase letters and digits, plus a short random tail so two "Halfmoon"s never clash. */
export function newProductId(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24);
  const tail = Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => (b % 36).toString(36)).join("");
  return `${base || "fish"}_${tail}`;
}

/**
 * Adds or updates one listing (and its photo). Returns the id, or null when an edit names a listing that does not
 * exist. An upsert on the id, so a double tap on "save" for an edit writes the same row twice, harmlessly.
 */
export async function saveProduct(db: D1Database, p: ProductInput, now: number): Promise<string | null> {
  const id = p.id ?? newProductId(p.name);
  if (p.id) {
    const exists = await db.prepare("SELECT 1 AS x FROM products WHERE id = ?1").bind(p.id).first();
    if (!exists) return null;
  }
  const stmts: D1PreparedStatement[] = [];
  let imageSql = "image";
  const params: unknown[] = [id, p.name, p.size, p.price, p.blurb, p.color, JSON.stringify(p.detail), p.stock, p.status, now];
  if (p.image) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO product_images (id, mime, data, updated_at) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT(id) DO UPDATE SET mime = ?2, data = ?3, updated_at = ?4`,
        )
        .bind(id, p.image.mime, p.image.data, now),
    );
    imageSql = "?11";
    params.push(`/pimg/${id}?v=${now}`);
  } else if (p.removeImage) {
    stmts.push(db.prepare("DELETE FROM product_images WHERE id = ?1").bind(id));
    imageSql = "''";
  }
  stmts.push(
    db
      .prepare(
        `INSERT INTO products (id, name, size, price, blurb, color, image, detail, stock, status, sort, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ${imageSql === "image" ? "''" : imageSql}, ?7, ?8, ?9,
                 (SELECT COALESCE(MAX(sort), 0) + 10 FROM products), ?10, ?10)
         ON CONFLICT(id) DO UPDATE SET name = ?2, size = ?3, price = ?4, blurb = ?5, color = ?6, image = ${imageSql},
           detail = ?7, stock = ?8, status = ?9, updated_at = ?10`,
      )
      .bind(...params),
  );
  await db.batch(stmts);
  return id;
}

/** GET /pimg/<id>: an uploaded photo. Public (product photos are not private); cached by the ?v= in its URL. */
export async function serveImage(db: D1Database, id: string): Promise<Response> {
  if (!/^[a-z0-9_]{2,40}$/.test(id)) return new Response("Not found", { status: 404 });
  const row = await db.prepare("SELECT mime, data FROM product_images WHERE id = ?1").bind(id).first<{ mime: string; data: string }>();
  if (!row) return new Response("Not found", { status: 404 });
  const bytes = Uint8Array.from(atob(row.data), (c) => c.charCodeAt(0));
  return new Response(bytes, {
    headers: {
      "Content-Type": row.mime,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** One line per active listing for the chat model, so it knows what is for sale right now (and what is sold out). */
export const LISTING_SQL = `(SELECT group_concat(line, '; ') FROM (
  SELECT name || ' ' || price || ' บาท' || CASE WHEN stock <= 0 THEN ' (ขายแล้ว)' ELSE '' END AS line
  FROM products WHERE status = 'active' ORDER BY sort, created_at, id LIMIT 40))`;
