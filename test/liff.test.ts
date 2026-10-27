import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { handleEvent } from "../src/handler";
import { renderApp, waitlistCrmRow } from "../src/liff";
import { PRODUCTS } from "../src/catalog";
import { saveConsent } from "../src/store";
import { createFakeD1, rows } from "./fakeD1";
import type { Env } from "../src/types";

const USER = "U" + "a".repeat(32);
const CHANNEL = "2001234567";

function makeEnv(extra: Partial<Env> = {}): Env {
  return {
    DB: createFakeD1(),
    LINE_CHANNEL_SECRET: "s",
    LINE_CHANNEL_ACCESS_TOKEN: "tok",
    LIFF_ID: "2001234567-AbCd",
    LINE_LOGIN_CHANNEL_ID: CHANNEL,
    SHEETS_WEBHOOK_URL: "https://sheet.example/exec",
    SHEETS_TOKEN: "sheet-token",
    ...extra,
  };
}

function ctxStub() {
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException: () => undefined };
  return { ctx: ctx as unknown as ExecutionContext, pending };
}

/** LINE verify answers for token "good"; the bot profile API answers 200 when `friend` is true. */
function stubLine(opts: { friend?: boolean; aud?: string } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://api.line.me/oauth2/v2.1/verify")) {
      const form = new URLSearchParams(String(init?.body));
      if (form.get("id_token") !== "good") return new Response('{"error":"invalid_request"}', { status: 400 });
      return Response.json({ sub: USER, aud: opts.aud ?? form.get("client_id") });
    }
    if (url.startsWith("https://api.line.me/v2/bot/profile/")) {
      return opts.friend ? Response.json({ userId: USER }) : new Response("{}", { status: 404 });
    }
    return Response.json({ ok: true });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function req(path: string, method = "GET", body?: unknown, token = "good") {
  return new Request(`https://w.example${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function call(env: Env, r: Request) {
  const { ctx, pending } = ctxStub();
  const res = await worker.fetch(r, env, ctx);
  await Promise.all(pending);
  return res;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("web app page", () => {
  it("serves the page with the LIFF id and catalog filled in", async () => {
    stubLine();
    const res = await call(makeEnv(), req("/app"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain('"liffId":"2001234567-AbCd"');
    expect(html).toContain("Fresh Leaf");
    expect(html).not.toContain("__APP_CONFIG__");
  });

  it("escapes < in the embedded config", () => {
    expect(renderApp("</script><x>")).not.toContain("</script><x>");
  });

  it("503 when LIFF_ID is not set, and the webhook path is unchanged", async () => {
    stubLine();
    expect((await call(makeEnv({ LIFF_ID: "" }), req("/app"))).status).toBe(503);
    expect((await call(makeEnv(), req("/webhook"))).status).toBe(404);
    expect((await call(makeEnv(), req("/nothing"))).status).toBe(404);
  });

  it("catalog prices match the knowledge base", () => {
    expect(PRODUCTS.map((p) => [p.name, p.price])).toEqual([
      ["Fresh Leaf", 450],
      ["Cilantro", 450],
      ["Last Sip", 450],
      ["Discovery set", 350],
    ]);
  });
});

describe("GET /api/me", () => {
  it("401 without a valid LINE ID token", async () => {
    stubLine();
    expect((await call(makeEnv(), req("/api/me", "GET", undefined, "forged"))).status).toBe(401);
    expect((await call(makeEnv(), new Request("https://w.example/api/me"))).status).toBe(401);
  });

  it("401 when the token was issued for another channel", async () => {
    stubLine({ aud: "999" });
    expect((await call(makeEnv(), req("/api/me"))).status).toBe(401);
  });

  it("503 when the LINE Login channel id is not set", async () => {
    stubLine();
    expect((await call(makeEnv({ LINE_LOGIN_CHANNEL_ID: "" }), req("/api/me"))).status).toBe(503);
  });

  it("awards friend and consent points once, however often the page is opened", async () => {
    stubLine({ friend: true });
    const env = makeEnv();
    await saveConsent(env.DB, USER, 1);
    for (let i = 0; i < 3; i++) {
      const body = (await (await call(env, req("/api/me"))).json()) as { points: number; friend: boolean };
      expect(body.points).toBe(30);
      expect(body.friend).toBe(true);
    }
    expect(rows(env.DB, "SELECT reason FROM points ORDER BY reason")).toEqual([{ reason: "consent" }, { reason: "friend" }]);
  });

  it("no friend points for someone who has not added the bot", async () => {
    stubLine({ friend: false });
    const body = (await (await call(makeEnv(), req("/api/me"))).json()) as { points: number; consent: boolean };
    expect(body.points).toBe(0);
    expect(body.consent).toBe(false);
  });

  it("rate-limits one user", async () => {
    stubLine();
    const env = makeEnv();
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await call(env, req("/api/me"))).status;
    expect(last).toBe(429);
  });
});

describe("POST /api/waitlist", () => {
  it("requires PDPA consent", async () => {
    stubLine();
    const env = makeEnv();
    const res = await call(env, req("/api/waitlist", "POST", { product: "cilantro" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "consent_required" });
    expect(rows(env.DB, "SELECT * FROM waitlist")).toEqual([]);
  });

  it("rejects unknown products", async () => {
    stubLine();
    const res = await call(makeEnv(), req("/api/waitlist", "POST", { product: "cart", consent: true }));
    expect(res.status).toBe(400);
  });

  it("joins once with consent, awards points once, and posts one Sheet row", async () => {
    const fetchMock = stubLine();
    const env = makeEnv();
    for (let i = 0; i < 2; i++) {
      const res = await call(env, req("/api/waitlist", "POST", { product: "last_sip", consent: true }));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { points: number; waitlist: string[] };
      expect(body.points).toBe(50); // waitlist 30 + consent 20
      expect(body.waitlist).toEqual(["last_sip"]);
    }
    expect(rows(env.DB, "SELECT given FROM consents")).toEqual([{ given: 1 }]);
    const sheetCalls = fetchMock.mock.calls.filter(([u]) => String(u) === "https://sheet.example/exec");
    expect(sheetCalls).toHaveLength(1);
    const sent = JSON.parse(String(sheetCalls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(sent).toMatchObject({ preorder_waitlist: true, consent_pdpa: true, last_message: "", line_user_id: USER });
  });

  it("uses consent already given in the chat", async () => {
    stubLine();
    const env = makeEnv();
    await saveConsent(env.DB, USER, 1);
    expect((await call(env, req("/api/waitlist", "POST", { product: "fresh_leaf" }))).status).toBe(200);
  });

  it("Sheet row carries no message text and a valid segment", () => {
    const row = waitlistCrmRow(USER, "discovery_set", new Date(0));
    expect(row.segment).toBe("set_trier");
    expect(row.discovery_set_interest).toBe(true);
    expect(row.last_message).toBe("");
  });
});

describe("deletion request", () => {
  it("also clears points and waitlist", async () => {
    stubLine();
    const env = makeEnv({ LLM_PROVIDER: "gemini", GEMINI_API_KEY: "k" });
    await call(env, req("/api/waitlist", "POST", { product: "cilantro", consent: true }));
    const answer = {
      reply: "ลบข้อมูลแล้วครับ",
      handoff: false,
      crm: {
        save: false, segment: "", scents_smelled: "", liked: "", disliked: "", preferences: "",
        discovery_set_interest: false, preorder_waitlist: false, consent_pdpa: false, delete_request: true,
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes("generativelanguage")
          ? Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(answer) }] } }] })
          : Response.json({ ok: true }),
      ),
    );
    await handleEvent(
      { kind: "text", replyToken: "r", userId: USER, text: "ลบข้อมูล", webhookEventId: "e1" },
      env,
      { systemPrompt: "p", greeting: "g" },
    );
    expect(rows(env.DB, "SELECT * FROM points")).toEqual([]);
    expect(rows(env.DB, "SELECT * FROM waitlist")).toEqual([]);
  });
});
