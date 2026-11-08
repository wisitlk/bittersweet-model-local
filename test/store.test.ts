import { describe, expect, it } from "vitest";
import {
  allowDailyCall,
  allowUserDay,
  allowUserMessage,
  claimEvent,
  cleanup,
  deleteHistory,
  historyLength,
  loadHistory,
  RETENTION_MS,
  saveTurn,
} from "../src/store";
import { createFakeD1, rows } from "./fakeD1";

const T0 = Date.parse("2026-10-08T10:00:00.000Z");

describe("claimEvent (idempotency)", () => {
  it("accepts an event id once, then reports it as already seen", async () => {
    const db = createFakeD1();
    expect(await claimEvent(db, "E1", T0)).toBe(true);
    expect(await claimEvent(db, "E1", T0 + 1000)).toBe(false);
    expect(await claimEvent(db, "E2", T0)).toBe(true);
  });
});

describe("allowUserMessage (per-user rate limit)", () => {
  it("allows up to the limit, then blocks", async () => {
    const db = createFakeD1();
    for (let i = 0; i < 3; i++) expect(await allowUserMessage(db, "U1", 3, 600, T0 + i)).toBe(true);
    expect(await allowUserMessage(db, "U1", 3, 600, T0 + 10)).toBe(false);
  });

  it("counts users separately", async () => {
    const db = createFakeD1();
    expect(await allowUserMessage(db, "U1", 1, 600, T0)).toBe(true);
    expect(await allowUserMessage(db, "U1", 1, 600, T0)).toBe(false);
    expect(await allowUserMessage(db, "U2", 1, 600, T0)).toBe(true);
  });

  it("starts a fresh window once the old one has ended", async () => {
    const db = createFakeD1();
    await allowUserMessage(db, "U1", 1, 600, T0);
    expect(await allowUserMessage(db, "U1", 1, 600, T0 + 1000)).toBe(false);
    expect(await allowUserMessage(db, "U1", 1, 600, T0 + 601_000)).toBe(true);
  });
});

describe("allowDailyCall (global daily cap)", () => {
  it("blocks after the cap and resets on the next UTC day", async () => {
    const db = createFakeD1();
    expect(await allowDailyCall(db, 2, T0)).toBe(true);
    expect(await allowDailyCall(db, 2, T0 + 1000)).toBe(true);
    expect(await allowDailyCall(db, 2, T0 + 2000)).toBe(false);
    const tomorrow = T0 + 24 * 3600 * 1000;
    expect(await allowDailyCall(db, 2, tomorrow)).toBe(true);
  });

  it("cleanup() deletes data older than 7 days and expired counters, and keeps recent data", async () => {
    const db = createFakeD1();
    const old = T0 - RETENTION_MS - 1000;
    await claimEvent(db, "OLD", old);
    await claimEvent(db, "NEW", T0 - 1000);
    await saveTurn(db, "U1", "old q", "old a", old);
    await saveTurn(db, "U1", "new q", "new a", T0 - 1000);
    await allowUserMessage(db, "OLDUSER", 5, 600, old); // its window ended long ago
    await allowUserMessage(db, "NEWUSER", 5, 600, T0);

    await cleanup(db, T0);

    expect(rows(db, "SELECT id FROM processed_events").map((r) => r.id)).toEqual(["NEW"]);
    expect(rows(db, "SELECT content FROM messages ORDER BY id").map((r) => r.content)).toEqual(["new q", "new a"]);
    expect(rows(db, "SELECT key FROM counters").map((r) => r.key)).toEqual(["user:NEWUSER"]);
  });

  it("the request path no longer deletes anything (cleanup runs from the scheduled handler)", async () => {
    const db = createFakeD1();
    await claimEvent(db, "OLD", T0 - RETENTION_MS - 1000);
    await allowDailyCall(db, 100, T0); // first call of the day
    await allowDailyCall(db, 100, T0 + 1000);
    expect(rows(db, "SELECT id FROM processed_events")).toHaveLength(1);
  });
});

describe("allowUserDay (per-user daily limit)", () => {
  it("blocks one user after the limit without affecting another, and resets next UTC day", async () => {
    const db = createFakeD1();
    expect(await allowUserDay(db, "U1", 2, T0)).toBe(true);
    expect(await allowUserDay(db, "U1", 2, T0 + 1)).toBe(true);
    expect(await allowUserDay(db, "U1", 2, T0 + 2)).toBe(false);
    expect(await allowUserDay(db, "U2", 2, T0)).toBe(true);
    expect(await allowUserDay(db, "U1", 2, T0 + 24 * 3600 * 1000)).toBe(true);
  });
});

describe("history", () => {
  it("returns turns oldest first, user message first", async () => {
    const db = createFakeD1();
    await saveTurn(db, "U1", "q1", "a1", T0);
    await saveTurn(db, "U1", "q2", "a2", T0); // same millisecond: order must still hold
    expect(await loadHistory(db, "U1")).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q2" },
      { role: "assistant", content: "a2" },
    ]);
  });

  it("keeps at most 10 turns and drops old turns 4 at a time, so the history start stays put", async () => {
    const db = createFakeD1();
    const starts: string[] = [];
    const lengths: number[] = [];
    for (let i = 1; i <= 19; i++) {
      await saveTurn(db, "U1", `q${i}`, `a${i}`, T0 + i);
      const h = await loadHistory(db, "U1");
      starts.push(h[0]?.content ?? "");
      lengths.push(h.length);
      expect(h[0]?.role).toBe("user");
      expect(h.at(-1)).toEqual({ role: "assistant", content: `a${i}` });
    }
    expect(Math.max(...lengths)).toBe(20);
    expect(Math.min(...lengths.slice(10))).toBe(14);
    // Turns 1-10: all kept. Then the start jumps by 4 turns at a time: q5 for turns 11-14, q9 for 15-18, q13 from 19.
    expect(starts).toEqual([
      ...Array<string>(10).fill("q1"),
      ...Array<string>(4).fill("q5"),
      ...Array<string>(4).fill("q9"),
      "q13",
    ]);
  });

  it("historyLength never sends more than 10 turns or fewer than 7 once past the cap", () => {
    expect(historyLength(0)).toBe(0);
    expect(historyLength(20)).toBe(20);
    for (let n = 21; n < 200; n++) {
      expect(historyLength(n)).toBeLessThanOrEqual(20);
      expect(historyLength(n)).toBeGreaterThanOrEqual(13);
    }
  });

  it("keeps users apart and deleteHistory removes only that user", async () => {
    const db = createFakeD1();
    await saveTurn(db, "U1", "q", "a", T0);
    await saveTurn(db, "U2", "q", "a", T0);
    await deleteHistory(db, "U1");
    expect(await loadHistory(db, "U1")).toEqual([]);
    expect(await loadHistory(db, "U2")).toHaveLength(2);
  });
});
