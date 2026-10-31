import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FULL_PATH_COST,
  handleEvent,
  MAX_FULL_EVENTS,
  MAX_LIGHT_EVENTS,
  MAX_USER_TEXT_CHARS,
  planEvents,
  type Content,
} from "../src/handler";
import { APOLOGY_REPLY, BUSY_REPLY, DAILY_CAP_REPLY } from "../src/messages";
import type { LineEvent } from "../src/webhook";
import { makeEnv as env } from "./fixtures";
import { rows } from "./fakeD1";

const content: Content = { systemPrompt: "SYSTEM", greeting: "GREETING" };
const NOW = Date.parse("2026-10-08T10:00:00.000Z");
type TextEvent = Extract<LineEvent, { kind: "text" }>;

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
      sample_interest: false,
      preorder_waitlist: false,
      delete_request: false,
      ...crm,
    },
    ...over,
  };
}

function text(id: string, userId = "U1", t = "สวัสดี"): TextEvent {
  return { kind: "text", replyToken: `rt-${id}`, userId, text: t, webhookEventId: id };
}

interface Call {
  url: string;
  body: Record<string, unknown>;
}
let calls: Call[];
let claudeOutput: unknown;
let claudeThrows: Error | null;

const urls = (u: string) => calls.filter((c) => c.url.includes(u));
const lineReplies = () => urls("/message/reply").map((c) => (c.body.messages as { text: string }[])[0]?.text);


beforeEach(() => {
  calls = [];
  claudeOutput = claudeJson();
  claudeThrows = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
      if (url.includes("anthropic.com")) {
        if (claudeThrows) throw claudeThrows;
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

describe("history and input size", () => {
  it("stores only the reply text as the assistant turn, never the CRM JSON", async () => {
    claudeOutput = claudeJson({ reply: "ตอบแล้ว" }, { save: true, consent_pdpa: true, liked: "Slow Morning" });
    const e = env();
    await handleEvent(text("E1"), e, content, NOW);
    const stored = rows(e.DB, "SELECT role, content FROM messages ORDER BY id");
    expect(stored).toEqual([
      { role: "user", content: "สวัสดี" },
      { role: "assistant", content: "ตอบแล้ว" },
    ]);
    expect(JSON.stringify(stored)).not.toContain("consent_pdpa");
  });

  it("cuts long user text to 1000 characters before Claude and before storage", async () => {
    const e = env();
    await handleEvent(text("E1", "U1", "ก".repeat(5000)), e, content, NOW);
    const sent = urls("anthropic.com")[0]?.body.messages as { content: string }[];
    expect(sent.at(-1)?.content).toHaveLength(MAX_USER_TEXT_CHARS);
    const userRow = rows(e.DB, "SELECT content FROM messages WHERE role = 'user'")[0];
    expect(String(userRow?.content)).toHaveLength(MAX_USER_TEXT_CHARS);
  });

  it("does not split an emoji when cutting the reply to 4900 characters", async () => {
    claudeOutput = claudeJson({ reply: "a".repeat(4899) + "😀" });
    await handleEvent(text("E1"), env(), content, NOW);
    expect(lineReplies()[0]).toBe("a".repeat(4899));
  });
});

describe("CRM privacy", () => {
  it("no consent + handoff: the Sheet row has no message text and no profile", async () => {
    claudeOutput = claudeJson({ handoff: true }, { liked: "Slow Morning" });
    await handleEvent(text("E1", "U1", "ผมแพ้น้ำหอม ผิวขึ้นผื่น"), env(), content, NOW);
    const posted = urls("sheets.example");
    expect(posted).toHaveLength(1);
    expect(posted[0]?.body).toMatchObject({ handoff: true, line_user_id: "U1", last_message: "", liked: "" });
    expect(JSON.stringify(posted[0]?.body)).not.toContain("ผื่น");
  });
});

describe("per-user daily limit", () => {
  it("replies with the fixed daily message and does not call Claude once the user limit is passed", async () => {
    const e = env({ USER_DAILY_LIMIT: "2", USER_MSG_LIMIT: "100" });
    for (const id of ["E1", "E2", "E3"]) await handleEvent(text(id), e, content, NOW);
    expect(urls("anthropic.com")).toHaveLength(2);
    expect(lineReplies().at(-1)).toBe(DAILY_CAP_REPLY);
    // another user is unaffected
    await handleEvent(text("E4", "U2"), e, content, NOW);
    expect(urls("anthropic.com")).toHaveLength(3);
  });
});

describe("never silence", () => {
  it("Claude timeout: sends the apology", async () => {
    claudeThrows = new DOMException("timed out", "TimeoutError");
    await handleEvent(text("E1"), env(), content, NOW);
    expect(lineReplies()).toEqual([APOLOGY_REPLY]);
  });

  it("a database failure after the event was claimed still produces the apology", async () => {
    const e = env();
    const realPrepare = e.DB.prepare.bind(e.DB);
    e.DB.prepare = ((sql: string) => {
      if (sql.startsWith("SELECT role, content FROM messages")) throw new Error("d1 down");
      return realPrepare(sql);
    }) as D1Database["prepare"];
    await handleEvent(text("E1"), e, content, NOW);
    expect(lineReplies()).toEqual([APOLOGY_REPLY]);
    expect(urls("anthropic.com")).toHaveLength(0);
  });

  it("a failing LINE reply is retried once with the apology, and a duplicate gets no reply at all", async () => {
    const e = env();
    let replyAttempts = 0;
    const real = globalThis.fetch;
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      if (url.includes("/message/reply") && replyAttempts++ === 0) throw new Error("network");
      return real(url, init);
    });
    await handleEvent(text("E1"), e, content, NOW);
    expect(replyAttempts).toBe(2);
    expect(lineReplies()).toEqual([APOLOGY_REPLY]);
  });
});

describe("loading animation and history load run together", () => {
  it("starts the loading call before the Claude call and both happen", async () => {
    await handleEvent(text("E1"), env(), content, NOW);
    const order = calls.map((c) => c.url);
    expect(order.findIndex((u) => u.includes("/chat/loading/start"))).toBeGreaterThanOrEqual(0);
    expect(order.findIndex((u) => u.includes("/chat/loading/start"))).toBeLessThan(
      order.findIndex((u) => u.includes("anthropic.com")),
    );
  });
});

describe("planEvents (per-invocation budget)", () => {
  const follow: LineEvent = { kind: "follow", replyToken: "r" };

  it("gives the full path to the first 2 text events and a short busy reply to the rest", () => {
    const events = [1, 2, 3, 4, 5].map((i) => text(`E${i}`));
    const plan = planEvents(events);
    expect(plan.map((p) => p.mode)).toEqual(["full", "full", "light", "light", "light"]);
  });

  it("caps one-fetch replies at 10 and drops the rest", () => {
    const plan = planEvents(Array.from({ length: 30 }, () => follow));
    expect(plan).toHaveLength(MAX_LIGHT_EVENTS);
  });

  it("worst case stays under the 50-subrequest Free limit", () => {
    expect(MAX_FULL_EVENTS * FULL_PATH_COST + MAX_LIGHT_EVENTS).toBeLessThan(50);
    const mixed: LineEvent[] = [...Array.from({ length: 20 }, (_, i) => text(`E${i}`)), ...Array.from({ length: 20 }, () => follow)];
    const plan = planEvents(mixed);
    const cost = plan.reduce((n, p) => n + (p.mode === "full" ? FULL_PATH_COST : 1), 0);
    expect(cost).toBeLessThan(50);
  });

  it("a text event in light mode only sends the busy reply: no Claude, no database", async () => {
    const e = env();
    await handleEvent(text("E9"), e, content, NOW, "light");
    expect(lineReplies()).toEqual([BUSY_REPLY]);
    expect(urls("anthropic.com")).toHaveLength(0);
    expect(rows(e.DB, "SELECT * FROM processed_events")).toHaveLength(0);
  });
});
