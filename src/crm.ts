import type { ConciergeResponse } from "./claude";
import { errName, isRecord } from "./guards";
import { truncate } from "./text";

// ctx.waitUntil() keeps the Worker alive up to 30 s after the response; stop waiting for Apps Script before that.
export const WAIT_UNTIL_BUDGET_MS = 28_000;
const CRM_TIMEOUT_MS = 5000;
// Longer than the 8 s lock wait in Code.gs, so a busy sheet answers before we give up.
const CRM_DELETE_TIMEOUT_MS = 10_000;
const FIELD_MAX = 500; // Code.gs rejects longer strings

/** Column order is exactly sim-line-demo/04_crm/crm_schema.csv. */
export const CRM_COLUMNS = [
  "timestamp",
  "line_user_id",
  "segment",
  "scents_smelled",
  "liked",
  "disliked",
  "preferences",
  "sample_interest",
  "preorder_waitlist",
  "consent_pdpa",
  "handoff",
  "delete_request",
  "last_message",
] as const;

export interface CrmRow {
  timestamp: string;
  line_user_id: string;
  segment: string;
  scents_smelled: string;
  liked: string;
  disliked: string;
  preferences: string;
  sample_interest: boolean;
  preorder_waitlist: boolean;
  consent_pdpa: boolean;
  handoff: boolean;
  delete_request: boolean;
  last_message: string;
}

/**
 * Decides whether this turn produces a CRM row and builds it.
 * Without PDPA consent only handoff / delete requests are recorded, and the row carries the flags,
 * the LINE user id and the timestamp only: the message text (it may contain health data such as an
 * allergy) and every profile field stay empty.
 */
export function buildCrmRow(
  userId: string,
  userText: string,
  resp: ConciergeResponse,
  now: Date,
  consentStored = false,
): CrmRow | null {
  const { crm, handoff } = resp;
  const wanted = crm.save || handoff || crm.preorder_waitlist || crm.delete_request;
  if (!wanted) return null;
  // Consent counts if it was stored earlier OR given now. A delete request never carries content.
  const consent = !crm.delete_request && (consentStored || crm.consent_pdpa);
  if (!consent && !handoff && !crm.delete_request) return null;
  // Profile text is only ever copied when consent holds, and capped to what Code.gs accepts.
  const profile = (s: string) => (consent ? truncate(s, FIELD_MAX) : "");

  return {
    timestamp: now.toISOString(),
    line_user_id: userId,
    segment: consent ? crm.segment : "",
    scents_smelled: profile(crm.scents_smelled),
    liked: profile(crm.liked),
    disliked: profile(crm.disliked),
    preferences: profile(crm.preferences),
    sample_interest: consent ? crm.sample_interest : false,
    preorder_waitlist: consent ? crm.preorder_waitlist : false,
    consent_pdpa: consent,
    handoff,
    delete_request: crm.delete_request,
    last_message: profile(userText),
  };
}

/**
 * Posts the row to the Google Apps Script web app. Failures are logged only, never shown to the customer.
 * A delete row is the one that matters legally, so it gets a longer timeout and one retry
 * (both bounded by `deadline`, a timestamp in ms) and a distinct log line if it never arrives.
 */
export async function sendCrmRow(
  url: string | undefined,
  token: string | undefined,
  row: CrmRow,
  deadline = Date.now() + WAIT_UNTIL_BUDGET_MS,
): Promise<void> {
  if (!url || !token) {
    console.error("crm_not_configured");
    return;
  }
  const attempts = row.delete_request ? 2 : 1;
  const perTry = row.delete_request ? CRM_DELETE_TIMEOUT_MS : CRM_TIMEOUT_MS;
  for (let i = 0; i < attempts; i++) {
    const budget = Math.min(perTry, deadline - Date.now());
    if (budget < 1000) break;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, ...row }),
        signal: AbortSignal.timeout(budget),
      });
      // Apps Script answers HTTP 200 with {"ok":false,...} when it refuses a row, so read the body too.
      const body: unknown = await res.json().catch(() => null);
      if (res.ok && !(isRecord(body) && body.ok === false)) return;
      console.error("crm_http_error", res.status, isRecord(body) && body.ok === false ? "rejected" : "");
    } catch (err) {
      console.error("crm_error", errName(err));
    }
  }
  if (row.delete_request) console.error("crm_delete_failed");
}
