import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { handleEvent } from "../src/handler";
import { ageGroupOf, cleanPhone, parseMember } from "../src/member";
import { createFakeD1, rows } from "./fakeD1";
import type { Env } from "../src/types";

const USER = "U" + "b".repeat(32);

function makeEnv(extra: Partial<Env> = {}): Env {
  return {
    DB: createFakeD1(),
    LINE_CHANNEL_SECRET: "s",
    LINE_CHANNEL_ACCESS_TOKEN: "tok",
    LIFF_ID: "2001234567-AbCd",
    LINE_LOGIN_CHANNEL_ID: "2001234567",
    SHEETS_WEBHOOK_URL: "https://sheet.example/exec",
    SHEETS_TOKEN: "sheet-token",
    LLM_PROVIDER: "gemini",
    GEMINI_API_KEY: "g",
    ...extra,
  };
}

let sheetBodies: string[];
let geminiBodies: string[];
function stub() {
  sheetBodies = [];
  geminiBodies = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://api.line.me/oauth2/v2.1/verify")) {
        return Response.json({ sub: USER, aud: new URLSearchParams(String(init?.body)).get("client_id") });
      }
      if (url.startsWith("https://api.line.me/v2/bot/profile/")) return Response.json({ userId: USER });
      if (url.startsWith("https://sheet.example")) sheetBodies.push(String(init?.body));
      if (url.includes("generativelanguage")) {
        geminiBodies.push(String(init?.body));
        const reply = {
          reply: "ลอง Slow Morning ดูนะครับ",
          handoff: false,
          crm: {
            save: false, consent_pdpa: false, segment: "", scents_smelled: "", liked: "", disliked: "",
            preferences: "", sample_interest: false, preorder_waitlist: false, delete_request: false,
          },
        };
        return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] }, finishReason: "STOP" }] });
      }
      return Response.json({ ok: true });
    }),
  );
}

async function call(env: Env, path: string, method = "GET", body?: unknown) {
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException: () => undefined };
  const res = await worker.fetch(
    new Request(`https://w.example${path}`, {
      method,
      headers: { Authorization: "Bearer good", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
    ctx as unknown as ExecutionContext,
  );
  await Promise.all(pending);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const member = { first_name: "สมใจ", last_name: "ใจดี", phone: "081-234-5678", age: 25, consent: true };
const answers = {
  q1_wear_when: "work_daily",
  q2_scent_family: "green_tea",
  q3_intensity: "light",
  q4_sounds_like_me: "calm_planner",
  q5_perfume_experience: "sometimes",
  q6_buy_intent: "sample_first",
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  stub();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("member checks", () => {
  it("cleans Thai phone numbers", () => {
    expect(cleanPhone("081-234-5678")).toBe("0812345678");
    expect(cleanPhone("+66812345678")).toBe("0812345678");
    expect(cleanPhone("021234567")).toBe("021234567");
    expect(cleanPhone("12345")).toBeNull();
    expect(cleanPhone("0812345678<script>")).toBeNull();
  });

  it("maps ages to the survey age groups", () => {
    expect([14, 22, 23, 30, 31, 40, 41].map(ageGroupOf)).toEqual(["14-22", "14-22", "23-30", "23-30", "31-40", "31-40", "41+"]);
  });

  it("rejects bad names, ages and minors without a guardian", () => {
    expect(parseMember({ ...member, first_name: "<b>x</b>" })).toBe("bad_name");
    expect(parseMember({ ...member, age: 13 })).toBe("bad_age");
    expect(parseMember({ ...member, age: 25.5 })).toBe("bad_age");
    expect(parseMember({ ...member, age: 17 })).toBe("guardian_required");
    expect(parseMember({ ...member, age: 17, guardian_consent: true })).toMatchObject({ age: 17, guardian_consent: true });
  });
});

describe("sign-up and survey in the web app", () => {
  it("shows no member before sign-up, and refuses the survey", async () => {
    const env = makeEnv();
    expect((await call(env, "/api/me")).body.member).toBeNull();
    expect(await call(env, "/api/survey", "POST", { answers })).toMatchObject({ status: 400, body: { error: "register_required" } });
  });

  it("needs the PDPA box ticked on the form", async () => {
    const env = makeEnv();
    const r = await call(env, "/api/register", "POST", { ...member, consent: false });
    expect(r).toMatchObject({ status: 400, body: { error: "consent_required" } });
    expect(rows(env.DB, "SELECT * FROM members")).toEqual([]);
  });

  it("signs up once, gives 50 points, keeps personal data out of the Sheet", async () => {
    const env = makeEnv();
    const r = await call(env, "/api/register", "POST", member);
    expect(r.status).toBe(200);
    expect(r.body.member).toEqual({ first_name: "สมใจ", last_name: "ใจดี", phone: "0812345678", age: 25 });
    await call(env, "/api/register", "POST", member); // double tap
    expect(rows(env.DB, "SELECT reason, amount FROM points WHERE reason = 'register'")).toEqual([{ reason: "register", amount: 50 }]);
    expect(rows(env.DB, "SELECT given FROM consents")).toEqual([{ given: 1 }]);
    expect(sheetBodies.join("")).not.toContain("0812345678");
  });

  it("saves a survey with the member's age group and returns the type and scent", async () => {
    const env = makeEnv();
    await call(env, "/api/register", "POST", member);
    const r = await call(env, "/api/survey", "POST", { answers });
    expect(r.status).toBe(200);
    expect(r.body.survey).toMatchObject({ age_group: "23-30", type: "Morning Minimalist", scent: "Slow Morning" });
    expect(rows(env.DB, "SELECT personality FROM surveys")).toEqual([{ personality: "calm_planner" }]);
    expect(sheetBodies.some((b) => b.includes("calm_planner") && b.includes("web survey"))).toBe(true);
    expect(sheetBodies.join("")).not.toContain("สมใจ");
  });

  it("rejects answers that are not one of the listed codes", async () => {
    const env = makeEnv();
    await call(env, "/api/register", "POST", member);
    const r = await call(env, "/api/survey", "POST", { answers: { ...answers, q2_scent_family: "anything I type" } });
    expect(r.status).toBe(400);
  });

  it("gives the chat model the survey, but stores only what the customer typed", async () => {
    const env = makeEnv();
    await call(env, "/api/register", "POST", member);
    await call(env, "/api/survey", "POST", { answers });
    await handleEvent(
      { kind: "text", replyToken: "rt", userId: USER, text: "แนะนำหน่อย", webhookEventId: "E1" },
      env,
      { systemPrompt: "SYS", greeting: "hi" },
      Date.now(),
    );
    expect(geminiBodies[0]).toContain("Morning Minimalist");
    expect(geminiBodies[0]).not.toContain("0812345678");
    expect(rows(env.DB, "SELECT content FROM messages WHERE role = 'user'")).toEqual([{ content: "แนะนำหน่อย" }]);
  });

  it("deletes member details and survey with a deletion request", async () => {
    const env = makeEnv();
    await call(env, "/api/register", "POST", member);
    await call(env, "/api/survey", "POST", { answers });
    const { deleteLoyalty } = await import("../src/loyalty");
    await deleteLoyalty(env.DB, USER);
    expect(rows(env.DB, "SELECT * FROM members")).toEqual([]);
    expect(rows(env.DB, "SELECT * FROM surveys")).toEqual([]);
  });
});
