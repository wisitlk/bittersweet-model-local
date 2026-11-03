import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { isAdmin, maskPhone } from "../src/admin";
import { pointBalance } from "../src/loyalty";
import { createFakeD1, rows } from "./fakeD1";
import type { Env } from "../src/types";

const USER = "U" + "a".repeat(32);
function makeEnv(extra: Partial<Env> = {}): Env {
  return {
    DB: createFakeD1(),
    LINE_CHANNEL_SECRET: "s",
    LINE_CHANNEL_ACCESS_TOKEN: "tok",
    LIFF_ID: "2001234567-AbCd",
    LINE_LOGIN_CHANNEL_ID: "2001234567",
    FDA_NOTIFICATION_NO: "10-1-0000000000",
    PROMPTPAY_ID: "0812345678",
    ...extra,
  };
}
async function call(env: Env, path: string, body?: unknown) {
  const res = await worker.fetch(
    new Request(`https://w.example${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: "Bearer good", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
    { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext,
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const member = { first_name: "สมใจ", last_name: "ใจดี", phone: "0812345678", age: 25, consent: true };
const order = {
  lines: [{ product: "slow_morning", variant: "bottle", qty: 1 }],
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

describe("admin dashboard", () => {
  it("knows admins only from ADMIN_LINE_USER_IDS", () => {
    expect(isAdmin(makeEnv(), USER)).toBe(false);
    expect(isAdmin(makeEnv({ ADMIN_LINE_USER_IDS: ` Uother , ${USER} ` }), USER)).toBe(true);
    expect(isAdmin(makeEnv({ ADMIN_LINE_USER_IDS: "" }), "")).toBe(false);
  });

  it("answers 404 to everyone else and tells /api/me who is an admin", async () => {
    const env = makeEnv();
    expect((await call(env, "/api/admin")).status).toBe(404);
    expect((await call(env, "/api/admin/order", { ref: "BS-AAAAAA", status: "paid" })).status).toBe(404);
    expect((await call(env, "/api/me")).body.admin).toBe(false);
    expect((await call(makeEnv({ ADMIN_LINE_USER_IDS: USER }), "/api/me")).body.admin).toBe(true);
  });

  it("counts the funnel and moves an order along, with points following", async () => {
    const env = makeEnv({ ADMIN_LINE_USER_IDS: USER });
    await call(env, "/api/register", member);
    const ref = String((await call(env, "/api/checkout", order)).body.ref);

    const before = await call(env, "/api/admin");
    expect(before.body.funnel).toMatchObject({ members: 1, orders: 1 });
    const listed = (before.body.orderList as { ref: string; phone: string; address: string; next: string[] }[])[0];
    expect(listed).toMatchObject({ ref, phone: "081-xxx-5678", address: "10110", next: ["paid", "cancelled"] });

    const balance = await pointBalance(env.DB, USER);
    expect((await call(env, "/api/admin/order", { ref, status: "shipped" })).body.error).toBe("not_allowed");
    const paid = await call(env, "/api/admin/order", { ref, status: "paid" });
    expect(paid.body.ok).toBe(true);
    // Paid: the full address is shown to ship it, and the purchase points (450 / 10) count.
    expect((paid.body.orderList as { address: string }[])[0]?.address).toContain("ถนนสุขุมวิท");
    expect(await pointBalance(env.DB, USER)).toBe(balance + 45);
    // A double tap is harmless.
    expect((await call(env, "/api/admin/order", { ref, status: "paid" })).body.ok).toBe(true);
    await call(env, "/api/admin/order", { ref, status: "shipped" });
    expect(rows(env.DB, "SELECT status FROM orders")).toEqual([{ status: "shipped" }]);
    expect((await call(env, "/api/admin/order", { ref, status: "cancelled" })).body.error).toBe("not_allowed");

    const after = await call(env, "/api/admin");
    expect(after.body.sales).toMatchObject({ revenue: 450 });
  });

  it("rejects unknown orders and statuses", async () => {
    const env = makeEnv({ ADMIN_LINE_USER_IDS: USER });
    expect((await call(env, "/api/admin/order", { ref: "BS-ZZZZZZ", status: "paid" })).status).toBe(404);
    expect((await call(env, "/api/admin/order", { ref: "x'; DROP", status: "paid" })).status).toBe(404);
    expect((await call(env, "/api/admin/order", { ref: "BS-ZZZZZZ", status: "refunded" })).body.error).toBe("bad_status");
  });

  it("masks phones", () => {
    expect(maskPhone("081-234-5678")).toBe("081-xxx-5678");
    expect(maskPhone("12")).toBe("xxx");
  });
});
