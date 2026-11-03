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
  // true = send Ollama's `format` grammar; false (the Worker's default) = ask for the JSON in words (LOCAL_JSON_HINT).
  useFormat?: boolean;
}

/**
 * Measured 2026-11-01 on the Mac mini: with the grammar on, about half of Gemma's replies stalled right after the
 * "segment" field and wrote whitespace until num_predict ran out; without it 15 of 15 were valid (1.6-3.0 s direct,
 * 4.3-6.6 s through the tunnel). So the Worker asks for the JSON in words, readJsonStream finds the object (even in a
 * ``` fence) and isConciergeResponse checks its shape; a malformed reply falls back to Gemini as before.
 */
export const LOCAL_JSON_HINT =
  "Answer with one JSON object only, no code fence, exactly these keys: " +
  '{"reply": string (max 450 characters), "handoff": boolean, "crm": {"save": boolean, "consent_pdpa": boolean, ' +
  '"segment": one of ' +
  JSON.stringify(RESPONSE_SCHEMA.properties.crm.properties.segment.enum) +
  ', "scents_smelled": string, "liked": string, "disliked": string, "preferences": string, ' +
  '"sample_interest": boolean, "preorder_waitlist": boolean, "delete_request": boolean}}';

// D1 stores only the reply text of earlier bot turns. Without the grammar, Gemma copies the shape of those turns and
// answers in plain text (live 2026-11-03: "Sample ราคาเท่าไหร่" after one earlier turn, 5 of 5 in plain text), so
// earlier replies are shown to it in the same JSON shape it must write. Flags were not stored, so they read as empty.
const EMPTY_CRM = {
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
};
export function asJsonTurn(m: ChatMessage): ChatMessage {
  return m.role === "assistant" ? { role: "assistant", content: JSON.stringify({ reply: m.content, handoff: false, crm: EMPTY_CRM }) } : m;
}

export function buildLocalRequestBody(
  model: string,
  system: string,
  history: ChatMessage[],
  userText: string,
  consentGiven = false,
  useFormat = false,
) {
  return {
    model,
    // The system prompt comes first and stays byte-identical, so Ollama can reuse its cached prefix.
    messages: [
      { role: "system", content: system },
      ...(useFormat ? history : history.map(asJsonTurn)),
      { role: "user", content: userText },
      ...(useFormat ? [] : [{ role: "system", content: LOCAL_JSON_HINT }]),
      ...(consentGiven ? [{ role: "system", content: CONSENT_NOTE }] : []),
    ],
    // Streamed so askLocal can stop as soon as the JSON object closes (see readJsonStream).
    stream: true,
    think: false,
    ...(useFormat ? { format: LOCAL_RESPONSE_SCHEMA } : {}),
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

// Live 2026-11-01: in 13 of 20 tries Gemma closed (or nearly closed) the JSON and then wrote only spaces and newlines
// until num_predict ran out: 800 tokens, 12-25 s, done_reason "length". The schema grammar allows whitespace between
// tokens, so maxLength cannot stop it. Reading the stream and stopping at the closing brace (or after a long run of
// whitespace) makes those replies finish in normal time, or fail fast so Gemini can answer.
export const MAX_WHITESPACE_RUN = 24;

/** What readJsonStream saw: the JSON text, or why it stopped without one. */
export type StreamResult = { ok: true; json: string } | { ok: false; reason: string };

/**
 * Reads Ollama's NDJSON chat stream and returns the first complete top-level JSON object in the model's text. Tracks
 * strings and escapes so braces inside the reply do not count. Cancels the stream once the object closes, which also
 * tells Ollama to stop generating.
 */
export async function readJsonStream(body: ReadableStream<Uint8Array>): Promise<StreamResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let text = "";
  let depth = 0;
  let started = false;
  let begin = 0; // where the object starts in `text`; anything before it (a ``` fence) is dropped
  let inString = false;
  let escaped = false;
  let blank = 0;
  const stop = async (r: StreamResult) => {
    await reader.cancel().catch(() => undefined);
    return r;
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return { ok: false, reason: "stream_ended" };
    pending += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, nl).trim();
      pending = pending.slice(nl + 1);
      if (!line) continue;
      const chunk: unknown = JSON.parse(line);
      if (!isRecord(chunk)) return stop({ ok: false, reason: "bad_chunk" });
      if (typeof chunk.error === "string") return stop({ ok: false, reason: "ollama_error" });
      const msg = chunk.message;
      const piece = isRecord(msg) && typeof msg.content === "string" ? msg.content : "";
      for (const ch of piece) {
        text += ch;
        if (inString) {
          if (escaped) escaped = false;
          else if (ch === "\\") escaped = true;
          else if (ch === '"') inString = false;
          continue;
        }
        if (ch === " " || ch === "\n" || ch === "\r" || ch === "\t") {
          if (++blank > MAX_WHITESPACE_RUN) return stop({ ok: false, reason: "whitespace_run" });
          continue;
        }
        blank = 0;
        if (ch === '"') inString = true;
        else if (ch === "{" || ch === "[") {
          if (!started) begin = text.length - ch.length;
          depth++;
          started = true;
        } else if (ch === "}" || ch === "]") {
          depth--;
          if (started && depth === 0) return stop({ ok: true, json: text.slice(begin) });
        }
      }
      if (chunk.done === true) return { ok: false, reason: `done_${String(chunk.done_reason)}` };
    }
  }
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
      body: JSON.stringify(buildLocalRequestBody(cfg.model, system, history, userText, consentGiven, cfg.useFormat === true)),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
    if (!res.ok) {
      console.error("local_http_error", res.status);
      return null;
    }
    if (!res.body) return null;
    const out = await readJsonStream(res.body);
    if (!out.ok) {
      console.error("local_stream_stopped", out.reason);
      return null;
    }
    const parsed: unknown = JSON.parse(out.json);
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
