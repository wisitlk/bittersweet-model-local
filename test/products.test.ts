import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { setOrderStatus } from "../src/admin";
import { pointBalance } from "../src/loyalty";
import { parseProductInput } from "../src/products";
import { createFakeD1, rows } from "./fakeD1";
import type { Env } from "../src/types";

const ADMIN = "U" + "a".repeat(32);
const BUYER = "U" + "b".repeat(32);
const BUYER2 = "U" + "d".repeat(32);
const TOKENS: Record<string, string> = { admin: ADMIN, buyer: BUYER, buyer2: BUYER2 };

function makeEnv(extra: Partial<Env> = {}): Env {
  return {
    DB: createFakeD1(),
    LINE_CHANNEL_SECRET: "s",
    LINE_CHANNEL_ACCESS_TOKEN: "tok",
    LIFF_ID: "2001234567-AbCd",
    LINE_LOGIN_CHANNEL_ID: "2001234567",
    PROMPTPAY_ID: "0812345678",
    ADMIN_LINE_USER_IDS: ADMIN,
    ...extra,
  };
}
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;
async function call(env: Env, who: string, path: string, body?: unknown) {
  const res = await worker.fetch(
    new Request(`https://w.example${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${who}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
    ctx,
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}
const get = (env: Env, path: string) => worker.fetch(new Request(`https://w.example${path}`), env, ctx);

const member = { first_name: "สมใจ", last_name: "ใจดี", phone: "0812345678", age: 25, consent: true };
const buy = (product: string, qty = 1, redeem?: string) => ({
  lines: [{ product, variant: "bottle", qty }],
  shipping: { name: "สมใจ ใจดี", phone: "0812345678", address: "1 ถนนสุขุมวิท กรุงเทพ", postcode: "10110" },
  ...(redeem ? { redeem } : {}),
});
const stock = (env: Env, id: string) => rows(env.DB, `SELECT stock FROM products WHERE id = '${id}'`)[0]?.stock;
const newFish = { name: "Gold Koi Halfmoon", price: 800, stock: 1, size: "ตัวผู้ · Halfmoon", blurb: "ลายคาร์ปทอง" };
// A 1x1 white JPEG.
const JPEG =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).includes("/oauth2/v2.1/verify")) return Response.json({ ok: true });
      const form = new URLSearchParams(String(init?.body));
      const sub = TOKENS[form.get("id_token") ?? ""];
      return sub ? Response.json({ sub, aud: form.get("client_id") }) : Response.json({ error: "invalid" }, { status: 400 });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("stock", () => {
  it("sells the last fish once: the second buyer gets sold_out and the shop shows stock 0", async () => {
    const env = makeEnv();
    await call(env, "buyer", "/api/register", member);
    await call(env, "buyer2", "/api/register", member);
    expect((await call(env, "buyer", "/api/checkout", buy("black_samurai"))).body).toMatchObject({ demo: false, total: 590 });
    expect(stock(env, "black_samurai")).toBe(0);
    expect((await call(env, "buyer2", "/api/checkout", buy("black_samurai"))).body.error).toBe("sold_out");
    expect(rows(env.DB, "SELECT COUNT(*) AS n FROM orders")).toEqual([{ n: 1 }]);
    expect(await (await get(env, "/app")).text()).toContain('"stock":0');
  });

  it("refuses more than the stock, and a demo checkout says sold out too", async () => {
    const env = makeEnv({ PROMPTPAY_ID: "" });
    expect((await call(env, "buyer", "/api/checkout", buy("blue_rim", 2))).body.error).toBe("sold_out");
    expect((await call(env, "buyer", "/api/checkout", buy("blue_rim", 1))).body).toMatchObject({ demo: true });
    expect(stock(env, "blue_rim")).toBe(1); // the demo takes nothing
  });

  it("spends no points on an order refused as sold out", async () => {
    const env = makeEnv();
    await call(env, "buyer", "/api/register", member); // 70 points
    rows(env.DB, "UPDATE products SET stock = 0 WHERE id = 'galaxy_koi' RETURNING id");
    expect((await call(env, "buyer", "/api/checkout", buy("galaxy_koi", 1, "off20"))).body.error).toBe("sold_out");
    expect(await pointBalance(env.DB, BUYER)).toBe(70);
    expect(rows(env.DB, "SELECT COUNT(*) AS n FROM points WHERE reason LIKE 'redeem:%'")).toEqual([{ n: 0 }]);
  });

  it("gives the fish back once when staff cancel the order", async () => {
    const env = makeEnv();
    await call(env, "buyer", "/api/register", member);
    const ref = String((await call(env, "buyer", "/api/checkout", buy("nemo_candy"))).body.ref);
    expect(stock(env, "nemo_candy")).toBe(0);
    expect(await setOrderStatus(env.DB, ref, "cancelled")).toBe("ok");
    expect(await setOrderStatus(env.DB, ref, "cancelled")).toBe("ok"); // double tap
    expect(stock(env, "nemo_candy")).toBe(1);
    expect(rows(env.DB, `SELECT stock_held FROM orders WHERE ref = '${ref}'`)).toEqual([{ stock_held: 0 }]);
  });

  it("keeps the fish taken when the order is paid and shipped", async () => {
    const env = makeEnv();
    await call(env, "buyer", "/api/register", member);
    const ref = String((await call(env, "buyer", "/api/checkout", buy("red_dragon"))).body.ref);
    expect(await setOrderStatus(env.DB, ref, "paid")).toBe("ok");
    expect(await setOrderStatus(env.DB, ref, "shipped")).toBe("ok");
    expect(stock(env, "red_dragon")).toBe(0);
  });
});

describe("staff add and edit fish", () => {
  it("only admins can save a listing", async () => {
    const env = makeEnv();
    expect((await call(env, "buyer", "/api/admin/product", newFish)).status).toBe(404);
    expect(rows(env.DB, "SELECT COUNT(*) AS n FROM products")).toEqual([{ n: 5 }]);
  });

  it("adds a fish that the shop, the checkout and the chat model then know", async () => {
    const env = makeEnv();
    const r = await call(env, "admin", "/api/admin/product", newFish);
    expect(r.status).toBe(200);
    const id = String(r.body.id);
    expect(id).toMatch(/^gold_koi_halfmoon_[a-z0-9]{3}$/);
    expect(await (await get(env, "/app")).text()).toContain("Gold Koi Halfmoon");
    await call(env, "buyer", "/api/register", member);
    expect((await call(env, "buyer", "/api/checkout", buy(id))).body).toMatchObject({ total: 800 });
    const admin = await call(env, "admin", "/api/admin");
    expect((admin.body.products as { id: string; stock: number }[]).find((p) => p.id === id)?.stock).toBe(0);
  });

  it("edits price and stock, and hides a listing from the shop", async () => {
    const env = makeEnv();
    expect((await call(env, "admin", "/api/admin/product", { ...newFish, id: "blue_rim", price: 399, stock: 3 })).status).toBe(200);
    expect(rows(env.DB, "SELECT price, stock FROM products WHERE id = 'blue_rim'")).toEqual([{ price: 399, stock: 3 }]);
    await call(env, "admin", "/api/admin/product", { ...newFish, id: "blue_rim", status: "hidden" });
    expect(await (await get(env, "/app")).text()).not.toContain('"blue_rim"');
    expect((await call(env, "buyer", "/api/checkout", buy("blue_rim"))).body.error).toBe("bad_cart");
    expect((await call(env, "admin", "/api/admin/product", { ...newFish, id: "no_such_fish" })).status).toBe(404);
  });

  it("stores an uploaded photo and serves it at /pimg/<id>", async () => {
    const env = makeEnv();
    const r = await call(env, "admin", "/api/admin/product", { ...newFish, image: JPEG });
    const id = String(r.body.id);
    const image = rows(env.DB, `SELECT image FROM products WHERE id = '${id}'`)[0]?.image;
    expect(String(image)).toMatch(new RegExp(`^/pimg/${id}\\?v=\\d+$`));
    const res = await get(env, `/pimg/${id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await res.arrayBuffer()).slice(0, 2)).toEqual(new Uint8Array([0xff, 0xd8]));
    expect((await get(env, "/pimg/missing_one")).status).toBe(404);
    await call(env, "admin", "/api/admin/product", { ...newFish, id, remove_image: true });
    expect((await get(env, `/pimg/${id}`)).status).toBe(404);
  });

  it("validates every field", () => {
    expect(parseProductInput({ ...newFish, name: "" })).toBe("bad_name");
    expect(parseProductInput({ ...newFish, price: 0 })).toBe("bad_price");
    expect(parseProductInput({ ...newFish, price: 12.5 })).toBe("bad_price");
    expect(parseProductInput({ ...newFish, stock: -1 })).toBe("bad_stock");
    expect(parseProductInput({ ...newFish, blurb: "<script>" })).toBe("bad_text");
    expect(parseProductInput({ ...newFish, id: "../x" })).toBe("bad_id");
    expect(parseProductInput({ ...newFish, image: "data:text/html;base64,PGI+" })).toBe("bad_image");
    expect(parseProductInput({ ...newFish, image: "https://example.com/a.jpg" })).toBe("bad_image");
    expect(parseProductInput({ ...newFish, price: "450", stock: "2", detail: { suits: "ก\nข" } })).toMatchObject({
      price: 450,
      stock: 2,
      detail: { suits: ["ก", "ข"] },
    });
  });
});

describe("chat model fish list", () => {
  it("lists active fish with prices and marks sold-out ones, without hidden ones", async () => {
    const { loadConsentAndSurvey } = await import("../src/survey");
    const env = makeEnv();
    rows(env.DB, "UPDATE products SET stock = 0 WHERE id = 'black_samurai' RETURNING id");
    rows(env.DB, "UPDATE products SET status = 'hidden' WHERE id = 'galaxy_koi' RETURNING id");
    const { listing } = await loadConsentAndSurvey(env.DB, BUYER);
    expect(listing).toContain("Red Dragon Halfmoon 450 บาท");
    expect(listing).toContain("Black Samurai 590 บาท (ขายแล้ว)");
    expect(listing).not.toContain("Galaxy Koi");
  });
});
