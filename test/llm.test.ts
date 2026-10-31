import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONSENT_NOTE, RESPONSE_SCHEMA } from "../src/claude";
import { LOCAL_RESPONSE_SCHEMA } from "../src/llm";
import { handleEvent, type Content } from "../src/handler";
import {
  askLocal,
  buildLocalRequestBody,
  clampTimeout,
  DEFAULT_LOCAL_TIMEOUT_MS,
  type LocalConfig,
} from "../src/llm";
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

const cfg: LocalConfig = {
  baseUrl: "https://llm.example/",
  model: "qwen3.8:27b",
  timeoutMs: 24_000,
  accessClientId: "id",
  accessClientSecret: "secret",
};

function ollama(content: string, done_reason = "stop") {
  return { model: "qwen3.8:27b", message: { role: "assistant", content }, done: true, done_reason };
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
      if (url.includes("llm.example")) return new Response(JSON.stringify(payload), { status });
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

describe("buildLocalRequestBody", () => {
  it("forces the response schema, turns thinking off and does not stream", () => {
    const body = buildLocalRequestBody("qwen3.8:27b", "SYS", [], "hi");
    expect(body.model).toBe("qwen3.8:27b");
    expect(body.format).toBe(LOCAL_RESPONSE_SCHEMA);
    // Same shape as the cloud models' schema, plus length caps so Gemma cannot run on inside one string.
    expect(Object.keys(LOCAL_RESPONSE_SCHEMA.properties)).toEqual(Object.keys(RESPONSE_SCHEMA.properties));
    expect(LOCAL_RESPONSE_SCHEMA.required).toEqual(RESPONSE_SCHEMA.required);
    expect(LOCAL_RESPONSE_SCHEMA.properties.reply.maxLength).toBe(600);
    expect(LOCAL_RESPONSE_SCHEMA.properties.crm.properties.preferences.maxLength).toBe(120);
    expect(LOCAL_RESPONSE_SCHEMA.properties.crm.properties.segment).toBe(RESPONSE_SCHEMA.properties.crm.properties.segment);
    expect(body.think).toBe(false);
    expect(body.stream).toBe(false);
    expect(body.messages).toEqual([
      { role: "system", content: "SYS" },
      { role: "user", content: "hi" },
    ]);
  });

  it("keeps the system prompt first and adds the consent note after the user turn", () => {
    const history = [
      { role: "user" as const, content: "a" },
      { role: "assistant" as const, content: "b" },
    ];
    const body = buildLocalRequestBody("m", "SYS", history, "hi", true);
    expect(body.messages[0]).toEqual({ role: "system", content: "SYS" });
    expect(body.messages.slice(1, 3)).toEqual(history);
    expect(body.messages.at(-1)).toEqual({ role: "system", content: CONSENT_NOTE });
  });
});

describe("clampTimeout", () => {
  it("defaults when unset or invalid and caps at 25 s", () => {
    expect(clampTimeout(undefined)).toBe(DEFAULT_LOCAL_TIMEOUT_MS);
    expect(clampTimeout("abc")).toBe(DEFAULT_LOCAL_TIMEOUT_MS);
    expect(clampTimeout("0")).toBe(DEFAULT_LOCAL_TIMEOUT_MS);
    expect(clampTimeout("15000")).toBe(15_000);
    expect(clampTimeout("60000")).toBe(25_000);
  });
});

describe("askLocal", () => {
  it("posts to /api/chat with the Access headers and returns the parsed object", async () => {
    stub(ollama(JSON.stringify(valid)));
    expect(await askLocal(cfg, "s", [], "hi")).toEqual(valid);
    expect(calls[0]?.url).toBe("https://llm.example/api/chat");
    expect(calls[0]?.headers["CF-Access-Client-Id"]).toBe("id");
    expect(calls[0]?.headers["CF-Access-Client-Secret"]).toBe("secret");
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("sends no Access headers when the token is not set", async () => {
    stub(ollama(JSON.stringify(valid)));
    await askLocal({ ...cfg, accessClientId: undefined, accessClientSecret: undefined }, "s", [], "hi");
    expect(calls[0]?.headers).not.toHaveProperty("CF-Access-Client-Id");
  });

  it("returns null for HTTP errors, truncation, bad JSON and bad shape", async () => {
    stub({ error: "x" }, 502);
    expect(await askLocal(cfg, "s", [], "hi")).toBeNull();
    stub(ollama("{", "length"));
    expect(await askLocal(cfg, "s", [], "hi")).toBeNull();
    stub(ollama("not json"));
    expect(await askLocal(cfg, "s", [], "hi")).toBeNull();
    stub(ollama(JSON.stringify({ reply: "x" })));
    expect(await askLocal(cfg, "s", [], "hi")).toBeNull();
    stub({ done: true, done_reason: "stop" });
    expect(await askLocal(cfg, "s", [], "hi")).toBeNull();
  });

  it("returns null on timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("timed out", "TimeoutError");
      }),
    );
    expect(await askLocal(cfg, "s", [], "hi")).toBeNull();
  });
});

describe("handleEvent with LLM_PROVIDER=local", () => {
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

  it("asks the local model instead of Claude and replies with its answer", async () => {
    stub(ollama(JSON.stringify(valid)));
    const env = makeEnv({ LLM_PROVIDER: "local", LLM_BASE_URL: "https://llm.example", ANTHROPIC_API_KEY: undefined });
    await handleEvent(text("E1"), env, content, NOW);
    expect(calls.filter((c) => c.url.includes("llm.example"))).toHaveLength(1);
    expect(calls.filter((c) => c.url.includes("anthropic.com"))).toHaveLength(0);
    expect(lineReplies()).toEqual(["สวัสดีครับ"]);
  });

  it("sends the apology when the Mac does not answer", async () => {
    stub({ error: "tunnel down" }, 530);
    const env = makeEnv({ LLM_PROVIDER: "local", LLM_BASE_URL: "https://llm.example" });
    await handleEvent(text("E1"), env, content, NOW);
    expect(lineReplies()).toEqual([APOLOGY_REPLY]);
  });

  it("sends the apology without any model call when LLM_BASE_URL is missing", async () => {
    stub(ollama(JSON.stringify(valid)));
    const env = makeEnv({ LLM_PROVIDER: "local" });
    await handleEvent(text("E1"), env, content, NOW);
    expect(calls.filter((c) => c.url.includes("llm.example") || c.url.includes("anthropic.com"))).toHaveLength(0);
    expect(lineReplies()).toEqual([APOLOGY_REPLY]);
  });
});
