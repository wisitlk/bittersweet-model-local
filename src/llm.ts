import { CONSENT_NOTE, isConciergeResponse, RESPONSE_SCHEMA, type ChatMessage, type ConciergeResponse } from "./claude";
import { errName, isRecord } from "./guards";

/*
 * Local model (Gemma on the owner's Mac mini) through Ollama's native chat API, reached from the Worker over a
 * Cloudflare quick tunnel and the gate in mac-mini/gate.mjs. Ollama is used directly rather than its OpenAI-style endpoint because `think: false` and
 * `format: <json schema>` are documented there and both are required: thinking makes replies far too slow, and
 * the schema forces the same JSON shape Claude returns.
 */

export const DEFAULT_LOCAL_MODEL = "gemma4:e4b";

// Live 2026-10-31: Gemma 4 E4B sometimes kept writing one JSON string until num_predict ran out (12-25 s,
// done_reason "length"), in about 1 of 3 tries for some questions. Ollama turns the schema into a grammar that
// enforces maxLength, so each string is cut off at a sane size and the JSON always closes in time.
export const LOCAL_REPLY_MAX_CHARS = 450;
export const LOCAL_FIELD_MAX_CHARS = 120;
const field = { type: "string", maxLength: LOCAL_FIELD_MAX_CHARS } as const;
export const LOCAL_RESPONSE_SCHEMA = {
  ...RESPONSE_SCHEMA,
  properties: {
    ...RESPONSE_SCHEMA.properties,
    reply: { ...RESPONSE_SCHEMA.properties.reply, maxLength: LOCAL_REPLY_MAX_CHARS },
    crm: {
      ...RESPONSE_SCHEMA.properties.crm,
      properties: {
        ...RESPONSE_SCHEMA.properties.crm.properties,
        scents_smelled: field,
        liked: field,
        disliked: field,
        preferences: field,
      },
    },
  },
} as const;
// waitUntil keeps the Worker alive about 30 s; the LINE reply and CRM post still need a few seconds after this.
export const DEFAULT_LOCAL_TIMEOUT_MS = 24_000;
const MAX_LOCAL_TIMEOUT_MS = 25_000;

export interface LocalConfig {
  baseUrl: string;
  model: string;
  timeoutMs: number;
  // The gate's two secrets (sent as CF-Access-Client-Id/Secret); both empty only when calling Ollama directly.
  accessClientId?: string;
  accessClientSecret?: string;
}

export function buildLocalRequestBody(
  model: string,
  system: string,
  history: ChatMessage[],
  userText: string,
  consentGiven = false,
) {
  return {
    model,
    // The system prompt comes first and stays byte-identical, so Ollama can reuse its cached prefix.
    messages: [
      { role: "system", content: system },
      ...history,
      { role: "user", content: userText },
      ...(consentGiven ? [{ role: "system", content: CONSENT_NOTE }] : []),
    ],
    stream: false,
    think: false,
    format: LOCAL_RESPONSE_SCHEMA,
    // Keep the model loaded between students so nobody waits for it to load from disk.
    keep_alive: -1,
    // A good reply is ~200 tokens of JSON; the maxLength limits above keep the longest valid one well under 800.
    // No repeat_penalty: it penalises the quotes and braces JSON must repeat (tried live 2026-10-31: 6 of 10 failed).
    options: { temperature: 0.3, num_predict: 800, num_ctx: 8192 },
  };
}

export function clampTimeout(value: string | undefined): number {
  const n = Number(value);
  if (value === undefined || !Number.isFinite(n) || n <= 0) return DEFAULT_LOCAL_TIMEOUT_MS;
  return Math.min(n, MAX_LOCAL_TIMEOUT_MS);
}

/** Calls Ollama's /api/chat. Returns null on any failure (HTTP error, truncation, timeout, bad JSON or shape). */
export async function askLocal(
  cfg: LocalConfig,
  system: string,
  history: ChatMessage[],
  userText: string,
  consentGiven = false,
): Promise<ConciergeResponse | null> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (cfg.accessClientId && cfg.accessClientSecret) {
      headers["CF-Access-Client-Id"] = cfg.accessClientId;
      headers["CF-Access-Client-Secret"] = cfg.accessClientSecret;
    }
    const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, "")}/api/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify(buildLocalRequestBody(cfg.model, system, history, userText, consentGiven)),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
    if (!res.ok) {
      console.error("local_http_error", res.status);
      return null;
    }
    const data: unknown = await res.json();
    if (!isRecord(data)) return null;
    if (data.done_reason !== "stop") {
      console.error("local_bad_done_reason", String(data.done_reason));
      return null;
    }
    const msg = data.message;
    if (!isRecord(msg) || typeof msg.content !== "string") return null;
    const parsed: unknown = JSON.parse(msg.content);
    if (!isConciergeResponse(parsed)) {
      console.error("local_schema_mismatch");
      return null;
    }
    return parsed;
  } catch (err) {
    console.error("local_error", errName(err));
    return null;
  }
}
