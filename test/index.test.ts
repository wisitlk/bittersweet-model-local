import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { rows, createFakeD1 } from "./fakeD1";
import { RETENTION_MS, claimEvent, saveTurn } from "../src/store";
import type { Env } from "../src/types";

const SECRET = "channel-secret";

function makeEnv(): Env {
  return {
    DB: createFakeD1(),
    LINE_CHANNEL_SECRET: SECRET,
    LINE_CHANNEL_ACCESS_TOKEN: "tok",
    ANTHROPIC_API_KEY: "key",
  };
}

function ctxStub() {
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException: () => undefined };
  return { ctx: ctx as unknown as ExecutionContext, pending };
}

function post(body: string, headers: Record<string, string> = {}, path = "/webhook", method = "POST") {
  const sig = createHmac("sha256", SECRET).update(body).digest("base64");
  return new Request(`https://w.example${path}`, {
    method,
    headers: { "x-line-signature": sig, "content-type": "application/json", ...headers },
    body: method === "GET" ? undefined : body,
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("worker fetch handler", () => {
  it("404 for anything but POST /webhook", async () => {
    const { ctx } = ctxStub();
    expect((await worker.fetch(post("{}", {}, "/"), makeEnv(), ctx)).status).toBe(404);
    expect((await worker.fetch(post("", {}, "/webhook", "GET"), makeEnv(), ctx)).status).toBe(404);
  });

  it("401 on a bad signature", async () => {
    const { ctx } = ctxStub();
    const res = await worker.fetch(post("{}", { "x-line-signature": "nope" }), makeEnv(), ctx);
    expect(res.status).toBe(401);
  });

  it("200 for LINE's Verify (empty events)", async () => {
    const { ctx } = ctxStub();
    const res = await worker.fetch(post(JSON.stringify({ destination: "U", events: [] })), makeEnv(), ctx);
    expect(res.status).toBe(200);
  });

  it("400 for a signed body that is not a webhook", async () => {
    const { ctx } = ctxStub();
    expect((await worker.fetch(post("[]"), makeEnv(), ctx)).status).toBe(400);
    expect((await worker.fetch(post("not json"), makeEnv(), ctx)).status).toBe(400);
  });

  it("413 on a declared Content-Length over 256 KB without reading the body", async () => {
    const { ctx } = ctxStub();
    const arrayBuffer = vi.fn();
    const forged = { headers: new Headers({ "content-length": String(300 * 1024) }), method: "POST", url: "https://w.example/webhook", arrayBuffer };
    const res = await worker.fetch(forged as unknown as Request, makeEnv(), ctx);
    expect(res.status).toBe(413);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("413 on a body over 256 KB even without a Content-Length header", async () => {
    const { ctx } = ctxStub();
    const res = await worker.fetch(post("x".repeat(300 * 1024)), makeEnv(), ctx);
    expect(res.status).toBe(413);
  });

  it("answers 200 immediately and hands the work to waitUntil", async () => {
    const { ctx, pending } = ctxStub();
    const body = JSON.stringify({ events: [{ type: "follow", replyToken: "r", source: { type: "user", userId: "U1" } }] });
    const res = await worker.fetch(post(body), makeEnv(), ctx);
    expect(res.status).toBe(200);
    expect(pending).toHaveLength(1);
    await Promise.all(pending);
    const sent = vi.mocked(fetch).mock.calls.map((c) => String(c[0]));
    expect(sent.some((u) => u.includes("/message/reply"))).toBe(true);
  });

  it("scheduled() deletes data older than 7 days", async () => {
    const env = makeEnv();
    const now = Date.now();
    await claimEvent(env.DB, "OLD", now - RETENTION_MS - 5000);
    await claimEvent(env.DB, "NEW", now);
    await saveTurn(env.DB, "U1", "q", "a", now - RETENTION_MS - 5000);
    const { ctx, pending } = ctxStub();
    await worker.scheduled({} as ScheduledController, env, ctx);
    await Promise.all(pending);
    expect(rows(env.DB, "SELECT id FROM processed_events").map((r) => r.id)).toEqual(["NEW"]);
    expect(rows(env.DB, "SELECT * FROM messages")).toHaveLength(0);
  });
});
