import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONSENT_NOTE, RESPONSE_SCHEMA } from "../src/claude";
import { askGemini, buildGeminiRequestBody, GEMINI_TIMEOUT_MS } from "../src/gemini";
import { handleEvent, type Content } from "../src/handler";
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
    discovery_set_interest: false,
    preorder_waitlist: false,
    delete_request: false,
  },
};

function gemini(parts: unknown[], finishReason = "STOP") {
  return { candidates: [{ content: { role: "model", parts }, finishReason }] };
}

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  signal?: AbortSignal | null;
}
let calls: Call[];

function stub(payload: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
        signal: init?.signal,
      });
      if (url.includes("generativelanguage.googleapis.com")) return new Response(JSON.stringify(payload), { status });
      return new Response("{}", { status: 200 });
    }),
  );
}

beforeEach(() => {
  calls = [];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("buildGeminiRequestBody", () => {
  it("asks for JSON with the response schema and low thinking", () => {
    const body = buildGeminiRequestBody("SYS", [], "hi");
    expect(body.systemInstruction).toEqual({ parts: [{ text: "SYS" }] });
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseJsonSchema).toBe(RESPONSE_SCHEMA);
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "low" });
    expect(body.contents).toEqual([{ role: "user", parts: [{ text: "hi" }] }]);
  });

  it("maps assistant turns to the model role and adds the consent note as a second system part", () => {
    const history = [
      { role: "user" as const, content: "a" },
      { role: "assistant" as const, content: "b" },
    ];
    const body = buildGeminiRequestBody("SYS", history, "hi", true, "minimal");
    expect(body.contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
    expect(body.systemInstruction.parts).toEqual([{ text: "SYS" }, { text: CONSENT_NOTE }]);
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "minimal" });
  });
});

describe("askGemini", () => {
  it("calls generateContent with the key header and returns the parsed object", async () => {
    stub(gemini([{ text: JSON.stringify(valid) }]));
    expect(await askGemini("k", "gemini-3.8-flash", "s", [], "hi")).toEqual(valid);
    expect(calls[0]?.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
    );
    expect(calls[0]?.headers["x-goog-api-key"]).toBe("k");
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(GEMINI_TIMEOUT_MS).toBe(20_000);
  });

  it("ignores thought parts and joins split text parts", async () => {
    const json = JSON.stringify(valid);
    stub(gemini([{ text: "thinking...", thought: true }, { text: json.slice(0, 10) }, { text: json.slice(10) }]));
    expect(await askGemini("k", "m", "s", [], "hi")).toEqual(valid);
  });

  it("returns null for HTTP errors, safety blocks, truncation, bad JSON and bad shape", async () => {
    stub({ error: { code: 429, status: "RESOURCE_EXHAUSTED" } }, 429);
    expect(await askGemini("k", "m", "s", [], "hi")).toBeNull();
    expect(console.error).toHaveBeenCalledWith("gemini_http_error", 429, "RESOURCE_EXHAUSTED");
    stub(gemini([], "SAFETY"));
    expect(await askGemini("k", "m", "s", [], "hi")).toBeNull();
    stub(gemini([{ text: "{" }], "MAX_TOKENS"));
    expect(await askGemini("k", "m", "s", [], "hi")).toBeNull();
    stub(gemini([{ text: "not json" }]));
    expect(await askGemini("k", "m", "s", [], "hi")).toBeNull();
    stub(gemini([{ text: JSON.stringify({ reply: "x" }) }]));
    expect(await askGemini("k", "m", "s", [], "hi")).toBeNull();
    stub({ promptFeedback: { blockReason: "SAFETY" } });
    expect(await askGemini("k", "m", "s", [], "hi")).toBeNull();
  });
});

describe("handleEvent with LLM_PROVIDER=gemini", () => {
  const content: Content = { systemPrompt: "SYSTEM", greeting: "GREETING" };
  const NOW = Date.parse("2026-10-08T10:00:00.000Z");
  const text = (id: string) => ({
    kind: "text" as const,
    replyToken: `rt-${id}`,
    userId: "U1",
    text: "สวัสดี",
    webhookEventId: id,
  });
  const lineReplies = () =>
    calls.filter((c) => c.url.includes("/message/reply")).map((c) => (c.body.messages as { text: string }[])[0]?.text);

  it("asks Gemini instead of Claude and replies with its answer", async () => {
    stub(gemini([{ text: JSON.stringify(valid) }]));
    const env = makeEnv({ LLM_PROVIDER: "gemini", GEMINI_API_KEY: "g", ANTHROPIC_API_KEY: undefined });
    await handleEvent(text("E1"), env, content, NOW);
    expect(calls.filter((c) => c.url.includes("generativelanguage"))).toHaveLength(1);
    expect(calls.filter((c) => c.url.includes("anthropic.com"))).toHaveLength(0);
    expect(lineReplies()).toEqual(["สวัสดีครับ"]);
  });

  it("sends the apology without any model call when GEMINI_API_KEY is missing", async () => {
    stub(gemini([{ text: JSON.stringify(valid) }]));
    const env = makeEnv({ LLM_PROVIDER: "gemini" });
    await handleEvent(text("E1"), env, content, NOW);
    expect(calls.filter((c) => c.url.includes("generativelanguage") || c.url.includes("anthropic.com"))).toHaveLength(0);
    expect(lineReplies()).toEqual([APOLOGY_REPLY]);
  });
});
