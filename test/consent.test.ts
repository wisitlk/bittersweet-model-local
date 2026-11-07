import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildRequestBody, CONSENT_NOTE } from "../src/claude";
import { buildCrmRow } from "../src/crm";
import { handleEvent, type Content } from "../src/handler";
import { cleanup, deleteConsent, hasConsent, RETENTION_MS, saveConsent } from "../src/store";
import type { LineEvent } from "../src/webhook";
import { makeEnv as env } from "./fixtures";
import { createFakeD1, rows } from "./fakeD1";

const content: Content = { systemPrompt: "SYSTEM", greeting: "GREETING" };
const T0 = Date.parse("2026-10-08T10:00:00.000Z");

function claudeJson(crm: Record<string, unknown> = {}, over: Record<string, unknown> = {}) {
  return {
    reply: "ตอบ",
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

function text(id: string, userId = "U1", t = "hi"): Extract<LineEvent, { kind: "text" }> {
  return { kind: "text", replyToken: `rt-${id}`, userId, text: t, webhookEventId: id };
}

interface Call {
  url: string;
  body: Record<string, unknown>;
}
let calls: Call[];
let claudeOutput: unknown;
const urls = (u: string) => calls.filter((c) => c.url.includes(u));


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
      return new Response("{}");
    }),
  );
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("consent store", () => {
  it("saves, reads and deletes consent per user", async () => {
    const db = createFakeD1();
    expect(await hasConsent(db, "U1")).toBe(false);
    await saveConsent(db, "U1", T0);
    await saveConsent(db, "U1", T0 + 5); // upsert, not a second row
    expect(await hasConsent(db, "U1")).toBe(true);
    expect(await hasConsent(db, "U2")).toBe(false);
    expect(rows(db, "SELECT * FROM consents")).toHaveLength(1);
    await deleteConsent(db, "U1");
    expect(await hasConsent(db, "U1")).toBe(false);
  });

  it("the daily cleanup removes consents older than 7 days and keeps fresh ones", async () => {
    const db = createFakeD1();
    await saveConsent(db, "OLD", T0 - RETENTION_MS - 1000);
    await saveConsent(db, "NEW", T0 - 1000);
    await cleanup(db, T0);
    expect(rows(db, "SELECT user_id FROM consents").map((r) => r.user_id)).toEqual(["NEW"]);
  });
});

describe("request to Claude", () => {
  it("adds a mid-conversation system message after the user turn only when consent is stored", () => {
    const without = buildRequestBody("m", "SYS", [], "hi", false);
    expect(without.messages).toEqual([{ role: "user", content: "hi" }]);
    const withIt = buildRequestBody("m", "SYS", [{ role: "user", content: "a" }, { role: "assistant", content: "b" }], "hi", true);
    expect(withIt.messages.at(-2)).toEqual({ role: "user", content: "hi" });
    expect(withIt.messages.at(-1)).toEqual({ role: "system", content: CONSENT_NOTE });
    expect(withIt.system[0]?.text).toBe("SYS"); // the cached prefix is untouched
  });
});

describe("crm consent = stored OR current", () => {
  const resp = (crm: Record<string, unknown>) => claudeJson(crm) as unknown as Parameters<typeof buildCrmRow>[2];

  it("stored consent makes a pre-order row a full row", () => {
    const r = buildCrmRow("U1", "pre-order please", resp({ preorder_waitlist: true, liked: "Slow Morning", segment: "sample_trier" }), new Date(T0), true);
    expect(r).toMatchObject({ consent_pdpa: true, preorder_waitlist: true, liked: "Slow Morning", segment: "sample_trier", last_message: "pre-order please" });
  });

  it("without stored or current consent a pre-order row is still not sent", () => {
    expect(buildCrmRow("U1", "x", resp({ preorder_waitlist: true }), new Date(T0), false)).toBeNull();
  });

  it("a delete request row never carries message or profile, even with stored consent", () => {
    const r = buildCrmRow("U1", "delete me", resp({ delete_request: true, liked: "Slow Morning", consent_pdpa: true }), new Date(T0), true);
    expect(r).toMatchObject({ consent_pdpa: false, last_message: "", liked: "", delete_request: true });
  });
});

describe("consent across turns (handler)", () => {
  it("consent in turn 1 -> turn 3 pre-order row is sent with profile fields, and the model is told", async () => {
    const e = env();

    claudeOutput = claudeJson({ consent_pdpa: true, liked: "Slow Morning" });
    await handleEvent(text("E1"), e, content, T0);
    expect(rows(e.DB, "SELECT user_id FROM consents")).toHaveLength(1);
    expect(urls("anthropic.com")[0]?.body.messages).toEqual([{ role: "user", content: "hi" }]); // nothing stored yet

    // turn 2: the model forgets to repeat consent (history has only reply text)
    claudeOutput = claudeJson({ consent_pdpa: false });
    await handleEvent(text("E2", "U1", "tell me more"), e, content, T0 + 1000);
    const turn2 = urls("anthropic.com")[1]?.body.messages as { role: string; content: string }[];
    expect(turn2.at(-1)).toEqual({ role: "system", content: CONSENT_NOTE });
    expect(urls("sheets.example")).toHaveLength(0);

    // turn 3: pre-order, consent flag false in this response, stored consent still applies
    claudeOutput = claudeJson({ consent_pdpa: false, preorder_waitlist: true, liked: "Slow Morning", segment: "sample_trier" });
    await handleEvent(text("E3", "U1", "add me to the pre-order list"), e, content, T0 + 2000);
    const posted = urls("sheets.example");
    expect(posted).toHaveLength(1);
    expect(posted[0]?.body).toMatchObject({
      line_user_id: "U1",
      consent_pdpa: true,
      preorder_waitlist: true,
      liked: "Slow Morning",
      segment: "sample_trier",
      last_message: "add me to the pre-order list",
    });
  });

  it("consent is per user: another user without consent is not told and gets no pre-order row", async () => {
    const e = env();
    claudeOutput = claudeJson({ consent_pdpa: true });
    await handleEvent(text("E1", "U1"), e, content, T0);
    claudeOutput = claudeJson({ preorder_waitlist: true });
    await handleEvent(text("E2", "U2"), e, content, T0 + 1000);
    const msgs = urls("anthropic.com")[1]?.body.messages as { role: string }[];
    expect(msgs.some((m) => m.role === "system")).toBe(false);
    expect(urls("sheets.example")).toHaveLength(0);
  });

  it("delete_request clears the stored consent and history", async () => {
    const e = env();
    claudeOutput = claudeJson({ consent_pdpa: true });
    await handleEvent(text("E1"), e, content, T0);
    expect(await hasConsent(e.DB, "U1")).toBe(true);

    claudeOutput = claudeJson({ delete_request: true, consent_pdpa: true });
    await handleEvent(text("E2", "U1", "delete my data"), e, content, T0 + 1000);
    expect(await hasConsent(e.DB, "U1")).toBe(false);
    expect(rows(e.DB, "SELECT * FROM messages")).toHaveLength(0);

    // afterwards the model is no longer told consent exists
    claudeOutput = claudeJson();
    await handleEvent(text("E3"), e, content, T0 + 2000);
    const msgs = urls("anthropic.com")[2]?.body.messages as { role: string }[];
    expect(msgs.some((m) => m.role === "system")).toBe(false);
  });
});
