import { errName, isRecord } from "./guards";

export const DEFAULT_MODEL = "claude-sonnet-5-5";
const API_URL = "https://api.anthropic.com/v1/messages";
export const CLAUDE_TIMEOUT_MS = 20_000;
const SEGMENTS = [
  "",
  "booth_smeller",
  "set_trier",
  "cilantro_lover",
  "green_curious",
  "gift_seeker",
  "repeat_wearer",
] as const;

export interface CrmFields {
  save: boolean;
  consent_pdpa: boolean;
  segment: (typeof SEGMENTS)[number];
  scents_smelled: string;
  liked: string;
  disliked: string;
  preferences: string;
  discovery_set_interest: boolean;
  preorder_waitlist: boolean;
  delete_request: boolean;
}

export interface ConciergeResponse {
  reply: string;
  handoff: boolean;
  crm: CrmFields;
}

const str = { type: "string" } as const;
const bool = { type: "boolean" } as const;

/** JSON schema sent to the API (structured outputs). Mirrors sim-line-demo/03_line/agent_response_schema.json. */
export const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string", description: "Text sent to the customer on LINE. Thai by default, short, no markdown." },
    handoff: { type: "boolean", description: "True if the human perfumer must follow up." },
    crm: {
      type: "object",
      properties: {
        save: bool,
        consent_pdpa: bool,
        segment: { type: "string", enum: [...SEGMENTS] },
        scents_smelled: str,
        liked: str,
        disliked: str,
        preferences: str,
        discovery_set_interest: bool,
        preorder_waitlist: bool,
        delete_request: bool,
      },
      required: [
        "save",
        "consent_pdpa",
        "segment",
        "scents_smelled",
        "liked",
        "disliked",
        "preferences",
        "discovery_set_interest",
        "preorder_waitlist",
        "delete_request",
      ],
      additionalProperties: false,
    },
  },
  required: ["reply", "handoff", "crm"],
  additionalProperties: false,
} as const;

export function isConciergeResponse(v: unknown): v is ConciergeResponse {
  if (!isRecord(v) || typeof v.reply !== "string" || typeof v.handoff !== "boolean") return false;
  const c = v.crm;
  if (!isRecord(c)) return false;
  return (
    typeof c.save === "boolean" &&
    typeof c.consent_pdpa === "boolean" &&
    typeof c.segment === "string" &&
    (SEGMENTS as readonly string[]).includes(c.segment) &&
    typeof c.scents_smelled === "string" &&
    typeof c.liked === "string" &&
    typeof c.disliked === "string" &&
    typeof c.preferences === "string" &&
    typeof c.discovery_set_interest === "boolean" &&
    typeof c.preorder_waitlist === "boolean" &&
    typeof c.delete_request === "boolean"
  );
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export function buildSystemPrompt(promptTemplate: string, knowledge: string): string {
  // A replacer function: a plain string would interpret "$&" or "$1" inside the knowledge text.
  return promptTemplate.replace("{{KNOWLEDGE}}", () => knowledge);
}

/** Told to the model (not the customer) when D1 says this user already gave PDPA consent. */
export const CONSENT_NOTE =
  "PDPA consent was already given by this customer earlier. Set crm.consent_pdpa to true and do not ask for consent again.";

export function buildRequestBody(
  model: string,
  system: string,
  history: ChatMessage[],
  userText: string,
  consentGiven = false,
) {
  return {
    model,
    max_tokens: 1500,
    // The whole system prompt (prompt + knowledge) is static, so one cache breakpoint covers it.
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    // A mid-conversation system message (supported by Sonnet 5.5, no beta header) after the user turn:
    // the cached system prefix and the earlier history stay byte-identical.
    messages: [
      ...history,
      { role: "user", content: userText },
      ...(consentGiven ? [{ role: "system", content: CONSENT_NOTE }] : []),
    ],
    // Sonnet 5.5 rejects temperature/top_p and forced tool_choice, and thinking cannot be "disabled".
    // "between_tools" is its lowest thinking setting (needs effort high or below, no other thinking field).
    thinking: { type: "between_tools" },
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: RESPONSE_SCHEMA },
    },
    // Opt-in server-side refusal fallback that the claude-api skill recommends for Sonnet 5.5.
    fallbacks: "default",
  };
}

/** Calls the Messages API. Returns null on any failure (HTTP error, refusal, truncation, bad JSON or shape). */
export async function askClaude(
  apiKey: string,
  model: string,
  system: string,
  history: ChatMessage[],
  userText: string,
  consentGiven = false,
): Promise<ConciergeResponse | null> {
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "server-side-fallback-2026-07-01",
      },
      body: JSON.stringify(buildRequestBody(model, system, history, userText, consentGiven)),
      signal: AbortSignal.timeout(CLAUDE_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error("claude_http_error", res.status);
      return null;
    }
    const data: unknown = await res.json();
    if (!isRecord(data)) return null;
    if (data.stop_reason !== "end_turn") {
      console.error("claude_bad_stop_reason", String(data.stop_reason));
      return null;
    }
    const blocks = Array.isArray(data.content) ? (data.content as unknown[]) : [];
    let text: string | null = null;
    for (const b of blocks) if (isRecord(b) && b.type === "text" && typeof b.text === "string") text = b.text;
    if (text === null) return null;
    const parsed: unknown = JSON.parse(text);
    if (!isConciergeResponse(parsed)) {
      console.error("claude_schema_mismatch");
      return null;
    }
    return parsed;
  } catch (err) {
    console.error("claude_error", errName(err));
    return null;
  }
}
