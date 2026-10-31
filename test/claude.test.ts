import { afterEach, describe, expect, it, vi } from "vitest";
import {
  askClaude,
  buildRequestBody,
  buildSystemPrompt,
  CLAUDE_TIMEOUT_MS,
  isConciergeResponse,
  RESPONSE_SCHEMA,
} from "../src/claude";

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

describe("isConciergeResponse", () => {
  it("accepts a valid object", () => {
    expect(isConciergeResponse(valid)).toBe(true);
  });

  it("rejects a missing top-level field", () => {
    expect(isConciergeResponse({ reply: valid.reply, crm: valid.crm })).toBe(false);
  });

  it("rejects a wrong type", () => {
    expect(isConciergeResponse({ ...valid, handoff: "yes" })).toBe(false);
    expect(isConciergeResponse({ ...valid, reply: 5 })).toBe(false);
  });

  it("rejects a segment outside the enum", () => {
    expect(isConciergeResponse({ ...valid, crm: { ...valid.crm, segment: "vip" } })).toBe(false);
  });

  it("rejects a missing or incomplete crm object", () => {
    expect(isConciergeResponse({ reply: "x", handoff: false })).toBe(false);
    const crm: Record<string, unknown> = { ...valid.crm };
    delete crm.delete_request;
    expect(isConciergeResponse({ ...valid, crm })).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(isConciergeResponse(null)).toBe(false);
    expect(isConciergeResponse("{}")).toBe(false);
  });
});

describe("schema and request body", () => {
  it("schema requires every field the guard checks", () => {
    expect(RESPONSE_SCHEMA.required).toEqual(["reply", "handoff", "crm"]);
    expect([...RESPONSE_SCHEMA.properties.crm.required].sort()).toEqual(Object.keys(valid.crm).sort());
  });

  it("uses structured outputs, caching and none of the options Sonnet 5.5 rejects", () => {
    const body = buildRequestBody("claude-sonnet-5-5", "SYS", [], "hi");
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.system[0]?.cache_control).toEqual({ type: "ephemeral" });
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("tool_choice");
    expect(body.thinking).toEqual({ type: "between_tools" });
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "hi" });
  });

  it("injects the knowledge into the prompt", () => {
    expect(buildSystemPrompt("A {{KNOWLEDGE}} B", "K")).toBe("A K B");
  });
});

describe("askClaude", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stub(payload: unknown, status = 200) {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(payload), { status })));
  }

  it("returns the parsed object on a good response", async () => {
    stub({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(valid) }] });
    expect(await askClaude("k", "m", "s", [], "hi")).toEqual(valid);
  });

  it("returns null for HTTP errors, refusals, truncation, bad JSON and bad shape", async () => {
    stub({ error: "x" }, 500);
    expect(await askClaude("k", "m", "s", [], "hi")).toBeNull();
    stub({ stop_reason: "refusal", content: [] });
    expect(await askClaude("k", "m", "s", [], "hi")).toBeNull();
    stub({ stop_reason: "max_tokens", content: [{ type: "text", text: "{" }] });
    expect(await askClaude("k", "m", "s", [], "hi")).toBeNull();
    stub({ stop_reason: "end_turn", content: [{ type: "text", text: "not json" }] });
    expect(await askClaude("k", "m", "s", [], "hi")).toBeNull();
    stub({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify({ reply: "x" }) }] });
    expect(await askClaude("k", "m", "s", [], "hi")).toBeNull();
  });
});

describe("review fixes", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses low effort and keeps between_tools thinking", () => {
    const body = buildRequestBody("claude-sonnet-5-5", "SYS", [], "hi");
    expect(body.output_config.effort).toBe("low");
    expect(body.thinking).toEqual({ type: "between_tools" });
  });

  it("inserts the knowledge literally even when it contains replacement patterns", () => {
    expect(buildSystemPrompt("A {{KNOWLEDGE}} B", "price $& and $1 and $$")).toBe("A price $& and $1 and $$ B");
  });

  it("sends a 20 second abort signal and returns null on timeout", async () => {
    let signal: AbortSignal | null | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        signal = init?.signal;
        throw new DOMException("timed out", "TimeoutError");
      }),
    );
    expect(await askClaude("k", "m", "s", [], "hi")).toBeNull();
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(CLAUDE_TIMEOUT_MS).toBe(20_000);
  });
});
