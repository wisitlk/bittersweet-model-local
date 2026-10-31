import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(resolve(import.meta.dirname, "../apps_script/Code.gs"), "utf8");
const GOOD_TOKEN = "t".repeat(40);
// Real LINE user ids are "U" followed by 32 lowercase hex characters.
const U1 = "U" + "1".repeat(32);
const U2 = "U" + "2".repeat(32);
const U9 = "U" + "9".repeat(32);
const HEADER = [
  "timestamp", "line_user_id", "segment", "scents_smelled", "liked", "disliked", "preferences",
  "sample_interest", "preorder_waitlist", "consent_pdpa", "handoff", "delete_request", "last_message",
];

type Row = unknown[];

/** Loads Code.gs into a sandbox with fake Google services. */
function load(opts: { token?: string | null; notify?: string; rows?: Row[] } = {}) {
  const sheetRows: Row[] = opts.rows ?? [];
  const mails: { to: string; subject: string; body: string }[] = [];
  const cacheStore = new Map<string, string>();
  let locks = 0;
  let unlocks = 0;

  const sheet = {
    getLastRow: () => sheetRows.length,
    appendRow: (r: Row) => void sheetRows.push(r),
    getRange: (row: number, col: number, n: number) => ({
      getValues: () => sheetRows.slice(row - 1, row - 1 + n).map((r) => [r[col - 1]]),
    }),
    deleteRow: (i: number) => void sheetRows.splice(i - 1, 1),
  };
  const sandbox: Record<string, unknown> = {
    console: { error: vi.fn() },
    JSON,
    Date,
    String,
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: () => (opts.token === undefined ? GOOD_TOKEN : opts.token) }),
    },
    LockService: {
      getScriptLock: () => ({ waitLock: () => void locks++, releaseLock: () => void unlocks++ }),
    },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({ getSheetByName: () => sheet, insertSheet: () => sheet }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k: string) => cacheStore.get(k) ?? null,
        put: (k: string, v: string) => void cacheStore.set(k, v),
      }),
    },
    MailApp: { sendEmail: (to: string, subject: string, body: string) => void mails.push({ to, subject, body }) },
    ContentService: {
      MimeType: { JSON: "json" },
      createTextOutput: (t: string) => ({ text: t, setMimeType() { return this; } }),
    },
  };
  runInNewContext(source + (opts.notify ? `\nNOTIFY_EMAIL = ${JSON.stringify(opts.notify)};` : ""), sandbox);
  const doPost = sandbox.doPost as (e: { postData: { contents: string } }) => { text: string };
  const call = (obj: unknown) => JSON.parse(doPost({ postData: { contents: JSON.stringify(obj) } }).text) as { ok: boolean; error?: string };
  return { call, sheetRows, mails, counts: () => ({ locks, unlocks }) };
}

const row = (over: Record<string, unknown> = {}) => ({
  token: GOOD_TOKEN,
  timestamp: "2026-10-08T10:00:00.000Z",
  line_user_id: U1,
  segment: "easy_explorer",
  scents_smelled: "Slow Morning",
  liked: "Slow Morning",
  disliked: "",
  preferences: "work",
  sample_interest: true,
  preorder_waitlist: false,
  consent_pdpa: true,
  handoff: false,
  delete_request: false,
  last_message: "hello",
  ...over,
});

describe("Code.gs token handling", () => {
  it("rejects a wrong token", () => {
    const { call, sheetRows } = load();
    expect(call(row({ token: "wrong" })).ok).toBe(false);
    expect(sheetRows).toHaveLength(0);
  });

  it("refuses to work when the script property is empty, a placeholder or too short", () => {
    for (const t of [null, "", "short-token", "REPLACE_WITH_A_LONG_RANDOM_STRING_1234567890"]) {
      const { call, sheetRows } = load({ token: t });
      const res = call(row({ token: t ?? "" }));
      expect(res.ok).toBe(false);
      expect(sheetRows).toHaveLength(0);
    }
  });

  it("accepts the right 32+ character token", () => {
    const { call, sheetRows } = load();
    expect(call(row()).ok).toBe(true);
    expect(sheetRows).toHaveLength(2); // header + the row
    expect(sheetRows[0]).toEqual(HEADER);
  });
});

describe("Code.gs writes", () => {
  it("writes cells in column order and guards against formula injection", () => {
    const { call, sheetRows } = load({ rows: [HEADER] });
    for (const bad of ["=1+1", "+1", "-1", "@SUM(A1)", "\tcmd", "\rcmd"]) call(row({ last_message: bad }));
    const messages = sheetRows.slice(1).map((r) => r[HEADER.indexOf("last_message")]);
    expect(messages).toEqual(["'=1+1", "'+1", "'-1", "'@SUM(A1)", "'\tcmd", "'\rcmd"]);
    expect(sheetRows[1]?.[HEADER.indexOf("line_user_id")]).toBe(U1);
    expect(sheetRows[1]?.[HEADER.indexOf("consent_pdpa")]).toBe(true);
  });

  it("holds the lock only around the sheet change and always releases it", () => {
    const { call, counts } = load({ rows: [HEADER] });
    call(row());
    expect(counts()).toEqual({ locks: 1, unlocks: 1 });
  });
});

describe("Code.gs delete_request", () => {
  const existing: Row[] = [
    HEADER,
    ["t", U1, "easy_explorer"],
    ["t", U2, "sample_trier"],
    ["t", U1, "booth_smeller"],
  ];

  it("deletes every row of that user, keeps the header and other users, and appends nothing", () => {
    const { call, sheetRows } = load({ rows: existing.map((r) => [...r]) });
    expect(call(row({ delete_request: true, consent_pdpa: false })).ok).toBe(true);
    expect(sheetRows.map((r) => r[1])).toEqual(["line_user_id", U2]);
  });

  it("does nothing harmful when the user has no rows or the id is missing", () => {
    const { call, sheetRows } = load({ rows: existing.map((r) => [...r]) });
    call(row({ delete_request: true, line_user_id: U9 }));
    call(row({ delete_request: true, line_user_id: undefined }));
    expect(sheetRows).toHaveLength(4);
  });

  it("still sends the handoff alert for a delete request that also needs the perfumer", () => {
    const { call, mails } = load({ rows: existing.map((r) => [...r]), notify: "owner@example.com" });
    call(row({ delete_request: true, handoff: true }));
    expect(mails).toHaveLength(1);
  });
});

describe("Code.gs handoff email", () => {
  it("sends one email per user per day, and one for a different user", () => {
    const { call, mails } = load({ rows: [HEADER], notify: "owner@example.com" });
    call(row({ handoff: true }));
    call(row({ handoff: true }));
    call(row({ handoff: true, line_user_id: U2 }));
    expect(mails.map((m) => m.body.includes(U1))).toEqual([true, false]);
    expect(mails).toHaveLength(2);
  });

  it("sends nothing when NOTIFY_EMAIL is empty or handoff is false", () => {
    const a = load({ rows: [HEADER] });
    a.call(row({ handoff: true }));
    expect(a.mails).toHaveLength(0);
    const b = load({ rows: [HEADER], notify: "owner@example.com" });
    b.call(row({ handoff: false }));
    expect(b.mails).toHaveLength(0);
  });
});

describe("Code.gs row validation", () => {
  const rejected = (over: Record<string, unknown>) => {
    const { call, sheetRows } = load({ rows: [HEADER] });
    const res = call(row(over));
    return { res, rowsAfter: sheetRows.length };
  };

  it("accepts a fully valid row", () => {
    const { call, sheetRows } = load({ rows: [HEADER] });
    expect(call(row()).ok).toBe(true);
    expect(sheetRows).toHaveLength(2);
  });

  it("rejects a bad line_user_id (wrong shape, uppercase hex, missing, wrong type)", () => {
    for (const bad of ["U1", "U" + "G".repeat(32), "U" + "A".repeat(32), "X" + "1".repeat(32), "U" + "1".repeat(33), "", 5, undefined]) {
      const r = rejected({ line_user_id: bad });
      expect(r.res.ok).toBe(false);
      expect(r.res.error).toContain("line_user_id");
      expect(r.rowsAfter).toBe(1);
    }
  });

  it("rejects booleans that are not booleans", () => {
    for (const f of ["sample_interest", "preorder_waitlist", "consent_pdpa", "handoff", "delete_request"]) {
      for (const bad of ["true", 1, null, undefined]) {
        const r = rejected({ [f]: bad });
        expect(r.res.ok).toBe(false);
        expect(r.res.error).toContain(f);
        expect(r.rowsAfter).toBe(1);
      }
    }
  });

  it("rejects strings that are not strings or are longer than 500 characters", () => {
    for (const f of ["scents_smelled", "liked", "disliked", "preferences", "last_message"]) {
      expect(rejected({ [f]: 5 }).res.ok).toBe(false);
      expect(rejected({ [f]: "x".repeat(501) }).res.ok).toBe(false);
      expect(rejected({ [f]: "x".repeat(500) }).res.ok).toBe(true);
    }
    expect(rejected({ timestamp: "x".repeat(41) }).res.ok).toBe(false);
  });

  it("rejects a segment outside the allowed list", () => {
    const r = rejected({ segment: "vip" });
    expect(r.res.ok).toBe(false);
    expect(r.res.error).toContain("segment");
    expect(rejected({ segment: "" }).res.ok).toBe(true);
  });

  it("a delete request with an invalid id deletes nothing", () => {
    const { call, sheetRows } = load({ rows: [HEADER, ["t", U1, "x"]] });
    expect(call(row({ delete_request: true, line_user_id: "U1" })).ok).toBe(false);
    expect(sheetRows).toHaveLength(2);
  });

  it("takes the lock for at most 8 seconds", () => {
    expect(source).toContain("lock.waitLock(8000)");
  });
});
