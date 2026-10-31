import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCrmRow, sendCrmRow, type CrmRow } from "../src/crm";
import { handleEvent, type Content } from "../src/handler";
import { APOLOGY_REPLY } from "../src/messages";
import type { LineEvent } from "../src/webhook";
import { makeEnv as env } from "./fixtures";

const content: Content = { systemPrompt: "SYSTEM", greeting: "GREETING" };
const NOW = Date.parse("2026-10-08T10:00:00.000Z");

function claudeJson(crm: Record<string, unknown> = {}) {
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
  };
}

const event: Extract<LineEvent, { kind: "text" }> = {
  kind: "text",
  replyToken: "rt",
  userId: "U1",
  text: "hi",
  webhookEventId: "E1",
};


let lineStatuses: number[]; // statuses LINE reply calls answer with, in order
let replyBodies: string[];
let errors: string[];

beforeEach(() => {
  lineStatuses = [];
  replyBodies = [];
  errors = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("anthropic.com")) {
        return new Response(
          JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(claudeJson()) }] }),
        );
      }
      if (url.includes("/message/reply")) {
        const body = JSON.parse(String(init?.body)) as { messages: { text: string }[] };
        replyBodies.push(body.messages[0]?.text ?? "");
        return new Response("{}", { status: lineStatuses.shift() ?? 200 });
      }
      return new Response("{}");
    }),
  );
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void errors.push(args.map(String).join(" ")));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a failed LINE reply is visible", () => {
  it("logs line_reply_failed with the status and tries the apology once", async () => {
    lineStatuses = [400, 200];
    await handleEvent(event, env(), content, NOW);
    expect(replyBodies).toEqual(["คำตอบ", APOLOGY_REPLY]);
    expect(errors.some((e) => e.includes("line_reply_failed") && e.includes("400"))).toBe(true);
  });

  it("does not loop: if the apology fails too it stops after that one attempt", async () => {
    lineStatuses = [400, 400];
    await handleEvent(event, env(), content, NOW);
    expect(replyBodies).toHaveLength(2);
    expect(errors.filter((e) => e.includes("line_reply_failed"))).toHaveLength(2);
  });

  it("a successful reply sends no apology", async () => {
    await handleEvent(event, env(), content, NOW);
    expect(replyBodies).toEqual(["คำตอบ"]);
    expect(errors.some((e) => e.includes("line_reply_failed"))).toBe(false);
  });
});

describe("sendCrmRow", () => {
  const deleteRow: CrmRow = buildCrmRow("U1", "x", claudeJson({ delete_request: true }) as never, new Date(NOW))!;
  const saveRow: CrmRow = buildCrmRow("U1", "x", claudeJson({ consent_pdpa: true, save: true }) as never, new Date(NOW))!;

  function sheetFetch(results: ("ok" | "http500" | "rejected" | "throw")[]) {
    const f = vi.fn(async () => {
      const r = results.shift() ?? "ok";
      if (r === "throw") throw new DOMException("t", "TimeoutError");
      if (r === "http500") return new Response("err", { status: 500 });
      if (r === "rejected") return new Response(JSON.stringify({ ok: false, error: "unauthorized" }));
      return new Response(JSON.stringify({ ok: true }));
    });
    vi.stubGlobal("fetch", f);
    return f;
  }

  it("retries a failed delete post once and logs nothing distinct when the retry works", async () => {
    const f = sheetFetch(["http500", "ok"]);
    await sendCrmRow("https://s", "t", deleteRow);
    expect(f).toHaveBeenCalledTimes(2);
    expect(errors.some((e) => e.includes("crm_delete_failed"))).toBe(false);
  });

  it("logs crm_delete_failed after two failed delete posts, never more than two", async () => {
    const f = sheetFetch(["throw", "throw", "ok"]);
    await sendCrmRow("https://s", "t", deleteRow);
    expect(f).toHaveBeenCalledTimes(2);
    expect(errors.filter((e) => e.includes("crm_delete_failed"))).toHaveLength(1);
  });

  it("treats an HTTP 200 with ok:false (Apps Script refused the row) as a failure", async () => {
    const f = sheetFetch(["rejected", "rejected"]);
    await sendCrmRow("https://s", "t", deleteRow);
    expect(f).toHaveBeenCalledTimes(2);
    expect(errors.some((e) => e.includes("crm_delete_failed"))).toBe(true);
  });

  it("a normal row is posted once, without retry and without the delete log line", async () => {
    const f = sheetFetch(["http500", "ok"]);
    await sendCrmRow("https://s", "t", saveRow);
    expect(f).toHaveBeenCalledTimes(1);
    expect(errors.some((e) => e.includes("crm_delete_failed"))).toBe(false);
    expect(errors.some((e) => e.includes("crm_http_error"))).toBe(true);
  });

  it("gives up without calling when the time budget is already used up", async () => {
    const f = sheetFetch(["ok"]);
    await sendCrmRow("https://s", "t", deleteRow, Date.now() + 500);
    expect(f).not.toHaveBeenCalled();
    expect(errors.some((e) => e.includes("crm_delete_failed"))).toBe(true);
  });

  it("uses a 10 second timeout per delete try and 5 seconds otherwise, never past the deadline", async () => {
    const timeouts: number[] = [];
    const spy = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
      timeouts.push(ms);
      return new AbortController().signal;
    });
    sheetFetch(["ok"]);
    await sendCrmRow("https://s", "t", deleteRow);
    sheetFetch(["ok"]);
    await sendCrmRow("https://s", "t", saveRow);
    sheetFetch(["ok"]);
    await sendCrmRow("https://s", "t", deleteRow, Date.now() + 3500);
    spy.mockRestore();
    expect(timeouts[0]).toBe(10_000);
    expect(timeouts[1]).toBe(5_000);
    expect(timeouts[2]).toBeLessThanOrEqual(3500);
  });
});
