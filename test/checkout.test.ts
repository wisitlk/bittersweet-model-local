import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { crc16, parseOrder, promptPayPayload } from "../src/checkout";
import { renderApp } from "../src/liff";
import { createFakeD1, rows } from "./fakeD1";
import type { Env } from "../src/types";

const USER = "U" + "c".repeat(32);
function makeEnv(extra: Partial<Env> = {}): Env {
  return {
    DB: createFakeD1(),
    LINE_CHANNEL_SECRET: "s",
    LINE_CHANNEL_ACCESS_TOKEN: "tok",
    LIFF_ID: "2001234567-AbCd",
    LINE_LOGIN_CHANNEL_ID: "2001234567",
    ...extra,
  };
}
async function call(env: Env, path: string, body: unknown) {
  const res = await worker.fetch(
    new Request(`https://w.example${path}`, {
      method: "POST",
      headers: { Authorization: "Bearer good", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
    { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext,
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const order = {
  lines: [{ product: "slow_morning", variant: "bottle", qty: 2, price: 1 }],
  shipping: { name: "สมใจ ใจดี", phone: "0812345678", address: "1 ถนนสุขุมวิท กรุงเทพ", postcode: "10110" },
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes("/oauth2/v2.1/verify")
        ? Response.json({ sub: USER, aud: new URLSearchParams(String(init?.body)).get("client_id") })
        : Response.json({ ok: true }),
    ),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("checkout", () => {
  it("computes the total from the catalog, ignoring any price the page sends", () => {
    expect(parseOrder(order)).toMatchObject({ total: 900 });
    expect(parseOrder({ ...order, lines: [{ product: "tea_break", variant: "sample", qty: 1 }] })).toMatchObject({ total: 249 });
    expect(parseOrder({ ...order, lines: [{ product: "nope", variant: "bottle", qty: 1 }] })).toBe("bad_cart");
    expect(parseOrder({ ...order, lines: [{ product: "slow_morning", variant: "bottle", qty: 99 }] })).toBe("bad_cart");
    expect(parseOrder({ ...order, shipping: { ...order.shipping, postcode: "1011" } })).toBe("bad_shipping");
    expect(parseOrder({ ...order, shipping: { ...order.shipping, address: "<script>" } })).toBe("bad_shipping");
  });

  it("is a demo while the FDA number is missing: nothing stored, no payment QR", async () => {
    const env = makeEnv({ PROMPTPAY_ID: "0812345678" });
    const r = await call(env, "/api/checkout", order);
    expect(r.body).toMatchObject({ demo: true, total: 900 });
    expect(r.body.promptpay).toBeUndefined();
    expect(rows(env.DB, "SELECT * FROM orders")).toEqual([]);
    expect(renderApp("x", false)).toContain('"sales":false');
  });

  it("stores the order and returns a PromptPay payload once sales are open (members only)", async () => {
    const env = makeEnv({ FDA_NOTIFICATION_NO: "10-1-0000000000", PROMPTPAY_ID: "0812345678" });
    expect((await call(env, "/api/checkout", order)).body.error).toBe("register_required");
    await call(env, "/api/register", { first_name: "สมใจ", last_name: "ใจดี", phone: "0812345678", age: 25, consent: true });
    const r = await call(env, "/api/checkout", order);
    expect(r.body).toMatchObject({ demo: false, total: 900 });
    expect(String(r.body.ref)).toMatch(/^BS-[2-9A-Z]{6}$/);
    expect(String(r.body.promptpay)).toContain("54069" + "00.00");
    expect(rows(env.DB, "SELECT total, status, ship_postcode FROM orders")).toEqual([
      { total: 900, status: "awaiting_payment", ship_postcode: "10110" },
    ]);
  });
});

describe("PromptPay payload", () => {
  it("uses CRC-16/CCITT-FALSE", () => {
    expect(crc16("123456789")).toBe("29B1");
  });
  it("encodes a phone as 0066 + number, the amount and a valid CRC", () => {
    const p = promptPayPayload("081-234-5678", 249);
    expect(p).toContain("29370016A000000677010111" + "01130066812345678");
    expect(p).toContain("5406249.00");
    expect(p.slice(-4)).toBe(crc16(p.slice(0, -4)));
  });
});
