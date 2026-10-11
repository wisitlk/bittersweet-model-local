import { askClaude, DEFAULT_MODEL, type ConciergeResponse } from "./claude";
import { buildCrmRow, sendCrmRow, WAIT_UNTIL_BUDGET_MS } from "./crm";
import { replyText, startLoading } from "./line";
import { APOLOGY_REPLY, BUSY_REPLY, DAILY_CAP_REPLY, NON_TEXT_REPLY, RATE_LIMITED_REPLY } from "./messages";
import {
  allowDailyCall,
  allowUserDay,
  allowUserMessage,
  claimEvent,
  deleteConsent,
  deleteHistory,
  hasConsent,
  loadHistory,
  saveConsent,
  saveTurn,
} from "./store";
import { errName } from "./guards";
import { truncate } from "./text";
import type { Env } from "./types";
import type { LineEvent } from "./webhook";

export interface Content {
  systemPrompt: string; // prompt + knowledge, already joined
  greeting: string;
}

export const MAX_USER_TEXT_CHARS = 1000;

/*
 * Work per webhook invocation. On the Workers Free plan one invocation may make at most 50 subrequests;
 * fetch() calls count (each redirect hop too) and so do D1 queries.
 *
 * Worst case for one text message on the full path:
 *   D1: claim 1 + per-user window 1 + per-user day 1 + global day 1 + history 1 + consent read 1
 *       + save turn 1 (one two-row INSERT) + consent upsert 1 = 8
 *       (a delete request replaces the save and upsert with 2 deletes, history and consent: also 8)
 *   fetch: loading 1 + Claude 1 + LINE reply 1 + Apps Script 2 (one redirect hop) = 5
 *       (a delete row is posted twice if the first try fails: +2, but then there is one D1 write less)
 *   one apology reply after a failure = 1
 *   total 16
 * So 2 full-path events cost 32. The remaining subrequests go to one-fetch replies (greeting, "please type
 * text", "please send that again"), capped at 10, so an invocation never exceeds 32 + 10 = 42 < 50.
 * Events beyond those caps are dropped. LINE normally sends one event per webhook, so this only matters in bursts.
 *
 * Time: ctx.waitUntil() keeps the Worker alive up to 30 s after the response is sent. Claude times out at 20 s,
 * LINE calls at 3 s, the Apps Script call at 5 s; the reply, history write and CRM post run in parallel after
 * Claude, so the usual worst case is about 20 + 5 s plus a few database round trips.
 */
export const FULL_PATH_COST = 16;
export const MAX_FULL_EVENTS = 2;
export const MAX_LIGHT_EVENTS = 10;

export type Mode = "full" | "light";
export interface PlannedEvent {
  ev: LineEvent;
  mode: Mode;
}

/** Decides which events of one webhook get the full Claude path, a one-fetch reply, or nothing. */
export function planEvents(events: LineEvent[]): PlannedEvent[] {
  const plan: PlannedEvent[] = [];
  let full = 0;
  let light = 0;
  for (const ev of events) {
    if (ev.kind === "text" && full < MAX_FULL_EVENTS) {
      full++;
      plan.push({ ev, mode: "full" });
    } else if (light < MAX_LIGHT_EVENTS) {
      light++;
      plan.push({ ev, mode: "light" });
    }
  }
  return plan;
}

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value !== undefined && Number.isFinite(n) && n > 0 ? n : fallback;
}

async function safeReply(token: string, replyToken: string, text: string, what: string): Promise<void> {
  try {
    await replyText(token, replyToken, text);
  } catch (err) {
    console.error("reply_failed", what, errName(err));
  }
}

export async function handleEvent(
  ev: LineEvent,
  env: Env,
  content: Content,
  now = Date.now(),
  mode: Mode = "full",
): Promise<void> {
  const started = Date.now();
  const token = env.LINE_CHANNEL_ACCESS_TOKEN;

  if (ev.kind === "follow") return safeReply(token, ev.replyToken, content.greeting, "follow");
  if (ev.kind === "nontext") return safeReply(token, ev.replyToken, NON_TEXT_REPLY, "nontext");
  if (mode === "light") return safeReply(token, ev.replyToken, BUSY_REPLY, "busy");

  let replied = false;
  const say = async (text: string) => {
    await replyText(token, ev.replyToken, text);
    replied = true;
  };

  try {
    // A redelivered event is caught by the same check: already processed -> skip.
    if (!(await claimEvent(env.DB, ev.webhookEventId, now))) return;

    const windowSeconds = num(env.USER_WINDOW_SECONDS, 600);
    if (!(await allowUserMessage(env.DB, ev.userId, num(env.USER_MSG_LIMIT, 20), windowSeconds, now))) {
      return await say(RATE_LIMITED_REPLY);
    }
    if (!(await allowUserDay(env.DB, ev.userId, num(env.USER_DAILY_LIMIT, 60), now))) {
      return await say(DAILY_CAP_REPLY);
    }
    if (!(await allowDailyCall(env.DB, num(env.DAILY_CLAUDE_CAP, 1500), now))) {
      return await say(DAILY_CAP_REPLY);
    }

    // Long input is cut before it is sent to Claude and before it is stored.
    const userText = truncate(ev.text, MAX_USER_TEXT_CHARS);

    // The typing animation is cosmetic: start it, but do not make the Claude call wait for it.
    const loading = startLoading(token, ev.userId);
    const [history, consentStored] = await Promise.all([loadHistory(env.DB, ev.userId), hasConsent(env.DB, ev.userId)]);
    const resp: ConciergeResponse | null = await askClaude(
      env.ANTHROPIC_API_KEY,
      env.CLAUDE_MODEL || DEFAULT_MODEL,
      content.systemPrompt,
      history,
      userText,
      consentStored,
    );
    await loading; // never rejects
    if (!resp) return await say(APOLOGY_REPLY);

    const persist = resp.crm.delete_request
      ? // The customer asked to delete their data: drop the stored conversation and consent, save nothing.
        Promise.all([deleteHistory(env.DB, ev.userId), deleteConsent(env.DB, ev.userId)])
      : // Only the reply text is stored as the assistant turn, never the CRM fields. Consent is remembered separately.
        Promise.all([
          saveTurn(env.DB, ev.userId, userText, resp.reply, now),
          resp.crm.consent_pdpa ? saveConsent(env.DB, ev.userId, now) : Promise.resolve(),
        ]);
    const row = buildCrmRow(ev.userId, userText, resp, new Date(now), consentStored);

    const [reply, saved, crm] = await Promise.allSettled([
      replyText(token, ev.replyToken, resp.reply),
      persist,
      row ? sendCrmRow(env.SHEETS_WEBHOOK_URL, env.SHEETS_TOKEN, row, started + WAIT_UNTIL_BUDGET_MS) : Promise.resolve(),
    ]);
    for (const r of [saved, crm]) {
      if (r.status === "rejected") console.error("event_step_failed", errName(r.reason));
    }
    if (reply.status === "rejected") throw reply.reason;
    if (!reply.value) {
      // LINE refused the main answer (replyText already logged line_reply_failed with the status).
      // Try the apology once; it may fail too if the reply token was already consumed.
      await safeReply(token, ev.replyToken, APOLOGY_REPLY, "apology");
      return;
    }
    replied = true;
  } catch (err) {
    // Log the event type and error name only: never message text, user ids or secrets.
    console.error("event_failed", ev.kind, errName(err));
    // The student must never be left with silence: try once to say sorry.
    if (!replied) await safeReply(token, ev.replyToken, APOLOGY_REPLY, "apology");
  }
}
