import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseWebhookBody } from "../src/webhook";

const sample: unknown = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "fixtures/sample_webhook_event.json"),
    "utf8",
  ),
);

describe("parseWebhookBody", () => {
  it("parses the real LINE sample text event", () => {
    const events = parseWebhookBody(sample);
    expect(events).toHaveLength(1);
    const ev = events?.[0];
    expect(ev?.kind).toBe("text");
    if (ev?.kind === "text") {
      expect(ev.userId).toBe("U_TEST_DEMO_USER_0001");
      expect(ev.webhookEventId).toBe("01TEST00000000000000000000");
      expect(ev.text).toContain("Cilantro");
    }
  });

  it("returns an empty list (not null) for LINE's Verify request", () => {
    expect(parseWebhookBody({ destination: "U1", events: [] })).toEqual([]);
  });

  it("returns null when the body is not a webhook shape", () => {
    expect(parseWebhookBody(null)).toBeNull();
    expect(parseWebhookBody("hello")).toBeNull();
    expect(parseWebhookBody([])).toBeNull();
    expect(parseWebhookBody({})).toBeNull();
    expect(parseWebhookBody({ events: "nope" })).toBeNull();
  });

  it("maps follow, sticker and text events", () => {
    const events = parseWebhookBody({
      events: [
        { type: "follow", replyToken: "r1", source: { type: "user", userId: "U1" } },
        {
          type: "message",
          replyToken: "r2",
          source: { type: "user", userId: "U1" },
          message: { type: "sticker", id: "1" },
        },
        {
          type: "message",
          replyToken: "r3",
          webhookEventId: "E3",
          source: { type: "user", userId: "U1" },
          message: { type: "text", id: "2", text: "hi" },
        },
      ],
    });
    expect(events?.map((e) => e.kind)).toEqual(["follow", "nontext", "text"]);
    const third = events?.[2];
    expect(third?.kind === "text" && third.webhookEventId).toBe("E3");
  });

  it("skips malformed or unhandled events instead of failing the whole body", () => {
    const events = parseWebhookBody({
      events: [
        42,
        { type: "message" },
        { type: "unfollow", source: { type: "user", userId: "U1" } },
        { type: "message", replyToken: "r", source: { type: "user", userId: "U1" }, message: { type: "text", text: 5 } },
        { type: "message", replyToken: "r", source: { type: "group", groupId: "G" }, message: { type: "text", id: "1", text: "x" }, webhookEventId: "E" },
        { type: "message", source: { type: "user", userId: "U1" }, message: { type: "text", text: "no token" }, webhookEventId: "E" },
      ],
    });
    expect(events).toEqual([]);
  });
});
