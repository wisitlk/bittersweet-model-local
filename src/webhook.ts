import { isRecord } from "./guards";

export type LineEvent =
  | { kind: "follow"; replyToken: string }
  | {
      kind: "text";
      replyToken: string;
      userId: string;
      text: string;
      webhookEventId: string;
    }
  | { kind: "nontext"; replyToken: string; userId: string };

function parseEvent(raw: unknown): LineEvent | null {
  if (!isRecord(raw) || typeof raw.type !== "string") return null;
  // Events without a reply token (e.g. standby mode) cannot be answered.
  if (typeof raw.replyToken !== "string" || raw.replyToken === "") return null;
  const replyToken = raw.replyToken;

  if (raw.type === "follow") return { kind: "follow", replyToken };

  if (raw.type !== "message") return null;
  const source = raw.source;
  if (!isRecord(source) || source.type !== "user" || typeof source.userId !== "string") return null;
  const userId = source.userId;
  const message = raw.message;
  if (!isRecord(message) || typeof message.type !== "string") return null;

  if (message.type !== "text") return { kind: "nontext", replyToken, userId };
  if (typeof message.text !== "string" || typeof raw.webhookEventId !== "string") return null;
  return {
    kind: "text",
    replyToken,
    userId,
    text: message.text,
    webhookEventId: raw.webhookEventId,
  };
}

/**
 * Returns the answerable events of a LINE webhook body, or null if the body is not
 * a LINE webhook shape at all. An empty `events` array (LINE's Verify button) gives [].
 * Individual events we do not handle are skipped, not treated as errors.
 */
export function parseWebhookBody(body: unknown): LineEvent[] | null {
  if (!isRecord(body) || !Array.isArray(body.events)) return null;
  const events: LineEvent[] = [];
  for (const raw of body.events as unknown[]) {
    const ev = parseEvent(raw);
    if (ev) events.push(ev);
  }
  return events;
}
