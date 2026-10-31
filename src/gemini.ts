import { CONSENT_NOTE, isConciergeResponse, RESPONSE_SCHEMA, type ChatMessage, type ConciergeResponse } from "./claude";
import { errName, isRecord } from "./guards";

/*
 * Google Gemini through the generateContent REST API. Structured output (responseJsonSchema) forces the same
 * JSON shape Claude returns. Gemini 3.x/4 models cannot turn thinking off, only lower it with thinkingLevel; the
 * default "low" keeps replies fast. maxOutputTokens counts thinking tokens too, so it is set well above the
 * ~300 tokens a reply needs.
 */

// Tested live on 2026-10-27: gemini-3.8-flash at "low" thinking exceeded the 20 s timeout and rejects "minimal";
// gemini-3.6-flash at "minimal" answers in time.
export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";
export const DEFAULT_GEMINI_THINKING = "low";
export const GEMINI_TIMEOUT_MS = 20_000;
// Backup model for overload (HTTP 503) and slow answers. Flash-Lite answered in time live on 2026-10-30.
// "low" is accepted by every 3.x model, so a changed fallback id cannot break on the thinking level.
export const DEFAULT_GEMINI_FALLBACK_MODEL = "gemini-3.1-flash-lite";
export const DEFAULT_GEMINI_FALLBACK_THINKING = "low";
// First try of the main model; a slower answer is abandoned so the backup still has time.
export const GEMINI_FIRST_TRY_MS = 12_000;
// A try with less time than this left is not started.
export const MIN_TRY_MS = 4_000;
// When another try may follow, the first one leaves at least this much for it (live 2026-10-31: a 503 on the
// main model left Flash-Lite too little time after a slow Mac mini).
export const BACKUP_RESERVE_MS = 7_000;
const RETRY_PAUSE_MS = 500;
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export function buildGeminiRequestBody(
  system: string,
  history: ChatMessage[],
  userText: string,
  consentGiven = false,
  thinkingLevel = DEFAULT_GEMINI_THINKING,
) {
  return {
    // The consent note is a second part, so the first part (prompt + knowledge) stays a byte-identical prefix
    // for Gemini's implicit caching.
    systemInstruction: { parts: [{ text: system }, ...(consentGiven ? [{ text: CONSENT_NOTE }] : [])] },
    contents: [
      ...history.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      { role: "user", parts: [{ text: userText }] },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema: RESPONSE_SCHEMA,
      maxOutputTokens: 4096,
      thinkingConfig: { thinkingLevel },
    },
  };
}

/** Calls generateContent. Returns null on any failure (HTTP error, safety block, truncation, bad JSON or shape). */
export async function askGemini(
  apiKey: string,
  model: string,
  system: string,
  history: ChatMessage[],
  userText: string,
  consentGiven = false,
  thinkingLevel = DEFAULT_GEMINI_THINKING,
  timeoutMs = GEMINI_TIMEOUT_MS,
): Promise<ConciergeResponse | null> {
  try {
    const res = await fetch(`${API_BASE}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(buildGeminiRequestBody(system, history, userText, consentGiven, thinkingLevel)),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      // Google's error status (e.g. NOT_FOUND, PERMISSION_DENIED) names the cause; it never contains the key or text.
      const err: unknown = await res.json().catch(() => null);
      const status = isRecord(err) && isRecord(err.error) && typeof err.error.status === "string" ? err.error.status : "";
      console.error("gemini_http_error", res.status, status);
      return null;
    }
    const data: unknown = await res.json();
    if (!isRecord(data) || !Array.isArray(data.candidates)) return null;
    const cand: unknown = data.candidates[0];
    if (!isRecord(cand)) return null;
    if (cand.finishReason !== "STOP") {
      console.error("gemini_bad_finish_reason", String(cand.finishReason));
      return null;
    }
    const parts = isRecord(cand.content) && Array.isArray(cand.content.parts) ? (cand.content.parts as unknown[]) : [];
    // Thought summaries (thought: true) are not part of the answer.
    const text = parts
      .filter((p) => isRecord(p) && p.thought !== true && typeof p.text === "string")
      .map((p) => (p as { text: string }).text)
      .join("");
    if (!text) return null;
    const parsed: unknown = JSON.parse(text);
    if (!isConciergeResponse(parsed)) {
      console.error("gemini_schema_mismatch");
      return null;
    }
    return parsed;
  } catch (err) {
    console.error("gemini_error", errName(err));
    return null;
  }
}

export interface GeminiPlan {
  apiKey: string;
  model: string;
  thinkingLevel: string;
  fallbackModel: string; // "" = no backup model, retry the main one instead
  fallbackThinking: string;
  deadline: number; // Date.now() value after which no try may still be running
  maxCalls: number; // fetches this message may spend on Gemini (subrequest budget in handler.ts)
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Gets an answer if Gemini can give one before the deadline: main model first (capped at GEMINI_FIRST_TRY_MS and
 * leaving BACKUP_RESERVE_MS), then the backup model, then the main model again if time and calls remain. Any failure
 * moves to the next try: a 503 or a timeout is overload, a 429 or 404 on one model says nothing about the other.
 */
export async function askGeminiReliable(
  plan: GeminiPlan,
  system: string,
  history: ChatMessage[],
  userText: string,
  consentGiven = false,
): Promise<ConciergeResponse | null> {
  const main = { model: plan.model, thinking: plan.thinkingLevel };
  const backup = plan.fallbackModel ? { model: plan.fallbackModel, thinking: plan.fallbackThinking } : main;
  const tries = [main, backup, main].slice(0, Math.max(0, plan.maxCalls));
  for (let i = 0; i < tries.length; i++) {
    const t = tries[i];
    if (!t) break;
    if (i > 0 && tries[i - 1]?.model === t.model) await sleep(RETRY_PAUSE_MS);
    const left = plan.deadline - Date.now();
    if (left < MIN_TRY_MS) {
      if (i > 0) console.error("gemini_out_of_time", i);
      break;
    }
    if (i > 0) console.error(t === main ? "gemini_retry" : "gemini_fallback", i);
    const last = i === tries.length - 1;
    const timeout = last ? left : Math.min(GEMINI_FIRST_TRY_MS, Math.max(MIN_TRY_MS, left - BACKUP_RESERVE_MS));
    const resp = await askGemini(plan.apiKey, t.model, system, history, userText, consentGiven, t.thinking, timeout);
    if (resp) return resp;
  }
  return null;
}
