import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleEvent, type Content } from "../src/handler";
import { APOLOGY_REPLY, DAILY_CAP_REPLY, NON_TEXT_REPLY, RATE_LIMITED_REPLY } from "../src/messages";
import type { LineEvent } from "../src/webhook";
import { makeEnv as env } from "./fixtures";
import { rows } from "./fakeD1";

const content: Content = { systemPrompt: "SYSTEM", greeting: "GREETING" };
const NOW = Date.parse("2026-10-08T10:00:00.000Z");

function claudeJson(over: Record<string, unknown> = {}, crm: Record<string, unknown> = {}) {
  return {
    reply: "คำตอบ",
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
      ...crm,
    },
    ...over,
  };
}

interface Call {
  url: string;
  body: Record<string, unknown>;
}

let calls: Call[];
let claudeOutput: unknown;


function text(id: string, userId = "U1", t = "สวัสดี"): Extract<LineEvent, { kind: "text" }> {
  return { kind: "text", replyToken: `rt-${id}`, userId, text: t, webhookEventId: id };
}

const urls = (u: string) => calls.filter((c) => c.url.includes(u));
const lineReplies = () => urls("/message/reply").map((c) => (c.body.messages as { text: string }[])[0]?.text);

beforeEach(() => {
  calls = [];
  claudeOutput = claudeJson();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
      if (url.includes("anthropic.com")) {
        return new Response(
          JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(claudeOutput) }] }),
        );
      }
      return new Response("{}", { status: 200 });
    }),
  );
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("handleEvent", () => {
  it("follow: sends the fixed greeting and does not call Claude", async () => {
    await handleEvent({ kind: "follow", replyToken: "rt" }, env(), content, NOW);
    expect(lineReplies()).toEqual(["GREETING"]);
    expect(urls("anthropic.com")).toHaveLength(0);
  });

  it("non-text: sends the fixed reply and does not call Claude", async () => {
    await handleEvent({ kind: "nontext", replyToken: "rt", userId: "U1" }, env(), content, NOW);
    expect(lineReplies()).toEqual([NON_TEXT_REPLY]);
    expect(urls("anthropic.com")).toHaveLength(0);
  });

  it("text: starts loading, calls Claude once, replies, saves history", async () => {
    const e = env();
    await handleEvent(text("E1"), e, content, NOW);
    expect(urls("/chat/loading/start")).toHaveLength(1);
    expect(urls("anthropic.com")).toHaveLength(1);
    expect(lineReplies()).toEqual(["คำตอบ"]);
    expect(rows(e.DB, "SELECT role FROM messages ORDER BY id").map((r) => r.role)).toEqual(["user", "assistant"]);
  });

  it("dedupe: the same webhookEventId (e.g. redelivery) is processed once", async () => {
    const e = env();
    await handleEvent(text("E1"), e, content, NOW);
    await handleEvent(text("E1"), e, content, NOW + 5000); // LINE redelivers the same event id
    expect(urls("anthropic.com")).toHaveLength(1);
    expect(lineReplies()).toHaveLength(1);
  });

  it("per-user limit: the message over the limit gets the fixed reply, no Claude call", async () => {
    const e = env({ USER_MSG_LIMIT: "2" });
    for (const id of ["E1", "E2", "E3"]) await handleEvent(text(id), e, content, NOW);
    expect(urls("anthropic.com")).toHaveLength(2);
    expect(lineReplies().at(-1)).toBe(RATE_LIMITED_REPLY);
  });

  it("daily cap: once reached, everyone gets the fixed reply, no Claude call", async () => {
    const e = env({ DAILY_CLAUDE_CAP: "1" });
    await handleEvent(text("E1", "U1"), e, content, NOW);
    await handleEvent(text("E2", "U2"), e, content, NOW);
    expect(urls("anthropic.com")).toHaveLength(1);
    expect(lineReplies().at(-1)).toBe(DAILY_CAP_REPLY);
  });

  it("a failing loading animation does not stop the reply", async () => {
    const real = globalThis.fetch;
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      if (url.includes("/chat/loading/start")) throw new Error("boom");
      return real(url, init);
    });
    await handleEvent(text("E1"), env(), content, NOW);
    expect(lineReplies()).toEqual(["คำตอบ"]);
  });

  it("Claude failure: sends the Thai apology and saves nothing", async () => {
    claudeOutput = { reply: "missing fields" };
    const e = env();
    await handleEvent(text("E1"), e, content, NOW);
    expect(lineReplies()).toEqual([APOLOGY_REPLY]);
    expect(rows(e.DB, "SELECT * FROM messages")).toHaveLength(0);
  });

  it("truncates the reply to 4900 characters", async () => {
    claudeOutput = claudeJson({ reply: "ก".repeat(6000) });
    await handleEvent(text("E1"), env(), content, NOW);
    expect(lineReplies()[0]).toHaveLength(4900);
  });

  it("sends earlier turns to Claude as history", async () => {
    const e = env();
    await handleEvent(text("E1", "U1", "first"), e, content, NOW);
    await handleEvent(text("E2", "U1", "second"), e, content, NOW + 1000);
    const messages = urls("anthropic.com")[1]?.body.messages as { role: string; content: string }[];
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(messages[0]?.content).toBe("first");
    expect(messages[2]?.content).toBe("second");
  });

  it("CRM: consented save posts a row with the shared token; a plain chat posts nothing", async () => {
    const e = env();
    await handleEvent(text("E1"), e, content, NOW);
    expect(urls("sheets.example")).toHaveLength(0);

    claudeOutput = claudeJson({}, { save: true, consent_pdpa: true, segment: "green_curious", liked: "Cilantro" });
    await handleEvent(text("E2"), e, content, NOW + 1000);
    const posted = urls("sheets.example");
    expect(posted).toHaveLength(1);
    expect(posted[0]?.body).toMatchObject({ token: "shared", line_user_id: "U1", segment: "green_curious", consent_pdpa: true });
  });

  it("CRM failure never reaches the customer", async () => {
    claudeOutput = claudeJson({ handoff: true });
    const real = globalThis.fetch;
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      if (url.includes("sheets.example")) throw new Error("down");
      return real(url, init);
    });
    await handleEvent(text("E1"), env(), content, NOW);
    expect(lineReplies()).toEqual(["คำตอบ"]);
  });

  it("delete request: erases stored history and does not save the turn", async () => {
    const e = env();
    await handleEvent(text("E1"), e, content, NOW);
    expect(rows(e.DB, "SELECT * FROM messages")).toHaveLength(2);
    claudeOutput = claudeJson({}, { delete_request: true });
    await handleEvent(text("E2", "U1", "delete my data"), e, content, NOW + 1000);
    expect(rows(e.DB, "SELECT * FROM messages")).toHaveLength(0);
    expect(urls("sheets.example")[0]?.body).toMatchObject({ delete_request: true });
  });

  it("never logs message text or the user id", async () => {
    claudeOutput = { reply: "bad" };
    await handleEvent(text("E1", "U_SECRET_ID", "secret message text"), env(), content, NOW);
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).not.toContain("secret message text");
    expect(logged).not.toContain("U_SECRET_ID");
  });
});
