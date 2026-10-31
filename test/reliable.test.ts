import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askGeminiReliable, type GeminiPlan } from "../src/gemini";
import { handleEvent, MAX_MODEL_CALLS, type Content } from "../src/handler";
import { APOLOGY_REPLY } from "../src/messages";
import { makeEnv } from "./fixtures";

const valid = {
  reply: "สวัสดีครับ",
  handoff: false,
  crm: {
    save: false,
    consent_pdpa: false,
    segment: "",
    scents_smelled: "",
    liked: "",
    disliked: "",
    preferences: "",
    sample_interest: false,
    preorder_waitlist: false,
    delete_request: false,
  },
};
const ok = () =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(valid) }] }, finishReason: "STOP" }] }));
const overloaded = () => new Response(JSON.stringify({ error: { status: "UNAVAILABLE" } }), { status: 503 });
const localOk = () => new Response(JSON.stringify({ done_reason: "stop", message: { content: JSON.stringify(valid) } }));

interface Call {
  url: string;
  headers: Record<string, string>;
  body: string;
}
let calls: Call[];

/** Answers each model call in turn with the next responder; everything else (LINE, Sheet) gets {}. */
function stubSequence(responders: (() => Response | Promise<Response>)[]) {
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string>, body: String(init?.body ?? "") });
      if (url.includes("generativelanguage") || url.includes("/api/chat")) {
        const r = responders[i++];
        if (!r) throw new Error("unexpected model call");
        return r();
      }
      return new Response("{}", { status: 200 });
    }),
  );
}
const modelCalls = () => calls.filter((c) => c.url.includes("generativelanguage") || c.url.includes("/api/chat"));
const modelOf = (c: Call) => /models\/([^:]+):/.exec(c.url)?.[1] ?? "local";

function plan(over: Partial<GeminiPlan> = {}): GeminiPlan {
  return {
    apiKey: "k",
    model: "main",
    thinkingLevel: "minimal",
    fallbackModel: "backup",
    fallbackThinking: "low",
    deadline: Date.now() + 23_000,
    maxCalls: 3,
    ...over,
  };
}

beforeEach(() => {
  calls = [];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("askGeminiReliable", () => {
  it("uses only the main model when it answers", async () => {
    stubSequence([ok]);
    expect(await askGeminiReliable(plan(), "s", [], "hi")).toEqual(valid);
    expect(modelCalls().map(modelOf)).toEqual(["main"]);
  });

  it("moves to the backup model when the main one is overloaded", async () => {
    stubSequence([overloaded, ok]);
    expect(await askGeminiReliable(plan(), "s", [], "hi")).toEqual(valid);
    expect(modelCalls().map(modelOf)).toEqual(["main", "backup"]);
    expect(console.error).toHaveBeenCalledWith("gemini_fallback", 1);
  });

  it("tries the main model once more when the backup fails too, then gives up", async () => {
    stubSequence([overloaded, overloaded, overloaded]);
    expect(await askGeminiReliable(plan(), "s", [], "hi")).toBeNull();
    expect(modelCalls().map(modelOf)).toEqual(["main", "backup", "main"]);
  });

  it("retries the main model when the backup is turned off", async () => {
    stubSequence([overloaded, ok]);
    expect(await askGeminiReliable(plan({ fallbackModel: "" }), "s", [], "hi")).toEqual(valid);
    expect(modelCalls().map(modelOf)).toEqual(["main", "main"]);
  });

  it("never spends more calls than allowed", async () => {
    stubSequence([overloaded, overloaded]);
    expect(await askGeminiReliable(plan({ maxCalls: 2 }), "s", [], "hi")).toBeNull();
    expect(modelCalls()).toHaveLength(2);
  });

  it("does not start a try that cannot finish before the deadline", async () => {
    stubSequence([ok]);
    expect(await askGeminiReliable(plan({ deadline: Date.now() + 1000 }), "s", [], "hi")).toBeNull();
    expect(modelCalls()).toHaveLength(0);
  });

  it("leaves the backup at least 7 s when time is short (after a slow Mac mini)", async () => {
    const timeouts: number[] = [];
    const real = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      timeouts.push(ms);
      return real(ms);
    });
    stubSequence([overloaded, ok]);
    await askGeminiReliable(plan({ deadline: Date.now() + 14_000, maxCalls: 2 }), "s", [], "hi");
    expect(timeouts[0]).toBeLessThanOrEqual(7_000);
    expect(timeouts[1]).toBeGreaterThanOrEqual(6_500);
  });

  it("caps the first try so the backup keeps time", async () => {
    const timeouts: number[] = [];
    const real = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      timeouts.push(ms);
      return real(ms);
    });
    stubSequence([overloaded, ok]);
    await askGeminiReliable(plan(), "s", [], "hi");
    expect(timeouts[0]).toBe(12_000);
    // The backup is not the last try (the main model may get one more), so it is capped and leaves 7 s too.
    expect(timeouts[1]).toBeGreaterThan(10_000);
    expect(timeouts[1]).toBeLessThanOrEqual(12_000);
  });
});

describe("handleEvent with LLM_PROVIDER=hybrid", () => {
  const content: Content = { systemPrompt: "SYSTEM", greeting: "GREETING" };
  const NOW = Date.parse("2026-10-08T10:00:00.000Z");
  const text = (id: string) => ({
    kind: "text" as const,
    replyToken: `rt-${id}`,
    userId: "U1",
    text: "สวัสดี",
    webhookEventId: id,
  });
  const env = () =>
    makeEnv({
      LLM_PROVIDER: "hybrid",
      LLM_BASE_URL: "https://mini.example",
      LLM_MODEL: "gemma4:e4b",
      LLM_ACCESS_CLIENT_ID: "id",
      LLM_ACCESS_CLIENT_SECRET: "secret",
      GEMINI_API_KEY: "g",
      ANTHROPIC_API_KEY: undefined,
    });
  const replies = () => calls.filter((c) => c.url.includes("/message/reply"));

  it("answers from the Mac mini without calling Gemini", async () => {
    stubSequence([localOk]);
    await handleEvent(text("E1"), env(), content, NOW);
    expect(modelCalls().map(modelOf)).toEqual(["local"]);
    expect(modelCalls()[0]?.url).toBe("https://mini.example/api/chat");
    expect(modelCalls()[0]?.headers["CF-Access-Client-Id"]).toBe("id");
    expect(replies()).toHaveLength(1);
  });

  it("falls back to Gemini when the Mac mini is off, within the call budget", async () => {
    stubSequence([() => Promise.reject(new TypeError("fetch failed")), overloaded, ok]);
    await handleEvent(text("E1"), env(), content, NOW);
    expect(modelCalls().map(modelOf)).toEqual(["local", "gemini-3.6-flash", "gemini-3.1-flash-lite"]);
    expect(modelCalls().length).toBeLessThanOrEqual(MAX_MODEL_CALLS);
    expect(console.error).toHaveBeenCalledWith("hybrid_fallback_gemini");
  });

  it("apologises after every model fails, still within the call budget", async () => {
    stubSequence([() => new Response("", { status: 502 }), overloaded, overloaded]);
    await handleEvent(text("E1"), env(), content, NOW);
    expect(modelCalls()).toHaveLength(MAX_MODEL_CALLS);
    expect(replies().map((c) => (JSON.parse(c.body) as { messages: { text: string }[] }).messages[0]?.text)).toEqual([
      APOLOGY_REPLY,
    ]);
  });

  it("uses Gemini only when no Mac mini address is set", async () => {
    stubSequence([ok]);
    await handleEvent(text("E1"), makeEnv({ LLM_PROVIDER: "hybrid", GEMINI_API_KEY: "g" }), content, NOW);
    expect(modelCalls().map(modelOf)).toEqual(["gemini-3.6-flash"]);
  });
});
