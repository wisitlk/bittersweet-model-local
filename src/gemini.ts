import { CONSENT_NOTE, isConciergeResponse, RESPONSE_SCHEMA, type ChatMessage, type ConciergeResponse } from "./claude";
import { errName, isRecord } from "./guards";

/*
 * Google Gemini through the generateContent REST API. Structured output (responseJsonSchema) forces the same
 * JSON shape Claude returns. Gemini 3.x/4 models cannot turn thinking off, only lower it with thinkingLevel; the
 * default "low" keeps replies fast. maxOutputTokens counts thinking tokens too, so it is set well above the
 * ~300 tokens a reply needs.
 */

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
export const DEFAULT_GEMINI_THINKING = "low";
export const GEMINI_TIMEOUT_MS = 20_000;
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
): Promise<ConciergeResponse | null> {
  try {
    const res = await fetch(`${API_BASE}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(buildGeminiRequestBody(system, history, userText, consentGiven, thinkingLevel)),
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error("gemini_http_error", res.status);
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
