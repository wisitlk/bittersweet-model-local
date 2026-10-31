import appHtml from "../web/app.html";
import { findProduct, POINT_RULES, PRODUCTS, type PointReason } from "./catalog";
import { sendCrmRow, type CrmRow } from "./crm";
import { errName, isRecord } from "./guards";
import { awardPoints, joinWaitlist, loadPoints, loadWaitlist } from "./loyalty";
import { allowWebRequest, hasConsent, saveConsent } from "./store";
import { orderRef, parseOrder, promptPayPayload, salesOpen, saveOrder, VARIANTS } from "./checkout";
import { isMinor, loadMember, MAX_AGE, MIN_AGE, parseMember, saveMember } from "./member";
import { loadSurvey, parseSurvey, PERSONALITY, QUESTIONS, saveSurvey, type Survey } from "./survey";
import type { Env } from "./types";

/*
 * The LINE web app (LIFF): a catalog with a pre-order waitlist button and a points page. LINE Login happens in the
 * page (LIFF SDK); every API call carries the LINE ID token, which is checked with LINE before anything is read or
 * written, so nobody can act as another customer. Nothing here sells: no cart, no payment, no address.
 *
 * Subrequests per API call: verify 1 + rate limit 1 + friend check 1 + about 7 D1 queries + Apps Script 2 = 12 < 50.
 */

const VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify";
const PROFILE_URL = "https://api.line.me/v2/bot/profile";
const TIMEOUT_MS = 3000;
const MAX_BODY_BYTES = 2048;
const WEB_LIMIT = 30; // API calls per user ...
const WEB_WINDOW_SECONDS = 600; // ... per 10 minutes

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** Checks a LIFF ID token with LINE (signature, expiry, audience). Returns the LINE user id, or null. */
export async function verifyIdToken(idToken: string, channelId: string): Promise<string | null> {
  try {
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error("liff_verify_failed", res.status);
      return null;
    }
    const data: unknown = await res.json();
    if (!isRecord(data) || typeof data.sub !== "string" || !/^U[0-9a-f]{32}$/.test(data.sub)) return null;
    if (data.aud !== channelId) return null;
    return data.sub;
  } catch (err) {
    console.error("liff_verify_error", errName(err));
    return null;
  }
}

/** true if the user has the bot as a friend (the Messaging API only returns profiles of friends). */
export async function isFriend(token: string, userId: string): Promise<boolean> {
  try {
    const res = await fetch(`${PROFILE_URL}/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return res.ok;
  } catch (err) {
    console.error("line_profile_error", errName(err));
    return false;
  }
}

/** The page, with the LIFF id and catalog filled in. `<` is escaped so the JSON cannot close the script tag. */
export function renderApp(liffId: string, sales = false): string {
  const config = JSON.stringify({
    liffId,
    sales,
    variants: VARIANTS,
    products: PRODUCTS,
    rules: POINT_RULES,
    survey: { questions: QUESTIONS },
    member: { minAge: MIN_AGE, maxAge: MAX_AGE },
  }).replace(/</g, "\\u003c");
  return appHtml.replace("__APP_CONFIG__", config);
}

/** What the page shows about a saved survey: the type and the scent that goes with it. */
export function surveyResult(s: Survey | null) {
  if (!s) return null;
  const p = PERSONALITY[s.personality];
  const product = findProduct(p.scent);
  return { age_group: s.age_group, answers: s.answers, type: p.type, label: p.label, scent: product?.name ?? p.scent };
}

async function summary(db: D1Database, userId: string) {
  const [ledger, waitlist, survey, member] = await Promise.all([
    loadPoints(db, userId),
    loadWaitlist(db, userId),
    loadSurvey(db, userId),
    loadMember(db, userId),
  ]);
  return {
    // The page shows the member their own details back (it is their data); first name only in the header.
    member: member ? { first_name: member.first_name, last_name: member.last_name, phone: member.phone, age: member.age } : null,
    survey: surveyResult(survey),
    points: ledger.reduce((sum, r) => sum + r.points, 0),
    ledger: ledger.map((r) => ({
      reason: r.reason,
      label: POINT_RULES[r.reason as PointReason]?.label ?? r.reason,
      points: r.points,
      created_at: r.created_at,
    })),
    waitlist,
  };
}

/** Sheet row for a waitlist sign-up from the web app. Always with consent; carries no message text. */
export function waitlistCrmRow(userId: string, productId: string, now: Date): CrmRow {
  const product = findProduct(productId);
  return {
    timestamp: now.toISOString(),
    line_user_id: userId,
    segment: "",
    scents_smelled: "",
    liked: "",
    disliked: "",
    preferences: `web pre-order: ${product?.name ?? productId}`,
    sample_interest: false,
    preorder_waitlist: true,
    consent_pdpa: true,
    handoff: false,
    delete_request: false,
    last_message: "",
  };
}

/** Sheet row for a survey answered in the web app. Always with consent; answer codes only, no free text. */
export function surveyCrmRow(userId: string, s: Survey, now: Date): CrmRow {
  const p = PERSONALITY[s.personality];
  const a = s.answers;
  return {
    timestamp: now.toISOString(),
    line_user_id: userId,
    segment: p.segment,
    scents_smelled: "",
    liked: "",
    disliked: "",
    preferences:
      `web survey: age ${s.age_group}${s.under_20 ? " (under 20, guardian ok)" : ""}; type ${p.type}; ` +
      `wear ${a.q1_wear_when}; family ${a.q2_scent_family}; intensity ${a.q3_intensity}; ` +
      `experience ${a.q5_perfume_experience}; intent ${a.q6_buy_intent}`,
    sample_interest: a.q6_buy_intent === "sample_first",
    preorder_waitlist: false,
    consent_pdpa: true,
    handoff: false,
    delete_request: false,
    last_message: "",
  };
}

async function readJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) return "too_large";
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return "too_large";
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return "bad_request";
  }
}

/** Handles GET /app, GET /api/me, POST /api/waitlist and POST /api/survey. Returns null for any other path. */
export async function handleWeb(request: Request, env: Env, ctx: ExecutionContext, now = Date.now()): Promise<Response | null> {
  const { pathname } = new URL(request.url);

  if ((pathname === "/app" || pathname === "/app/") && request.method === "GET") {
    if (!env.LIFF_ID) return new Response("Web app not configured (LIFF_ID)", { status: 503 });
    return new Response(renderApp(env.LIFF_ID, salesOpen(env)), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    });
  }

  const isMe = pathname === "/api/me" && request.method === "GET";
  const isWaitlist = pathname === "/api/waitlist" && request.method === "POST";
  const isSurvey = pathname === "/api/survey" && request.method === "POST";
  const isRegister = pathname === "/api/register" && request.method === "POST";
  const isCheckout = pathname === "/api/checkout" && request.method === "POST";
  if (!isMe && !isWaitlist && !isSurvey && !isRegister && !isCheckout) return null;

  if (!env.LINE_LOGIN_CHANNEL_ID) {
    console.error("liff_not_configured");
    return json({ error: "not_configured" }, 503);
  }
  const auth = request.headers.get("authorization") ?? "";
  const idToken = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!idToken || idToken.length > 4096) return json({ error: "login_required" }, 401);
  const userId = await verifyIdToken(idToken, env.LINE_LOGIN_CHANNEL_ID);
  if (!userId) return json({ error: "login_required" }, 401);

  if (!(await allowWebRequest(env.DB, userId, WEB_LIMIT, WEB_WINDOW_SECONDS, now))) {
    return json({ error: "rate_limited" }, 429);
  }

  if (isMe) {
    // Points that depend on state elsewhere are granted when the customer looks, each at most once.
    const [ledger, consent] = await Promise.all([loadPoints(env.DB, userId), hasConsent(env.DB, userId)]);
    const has = (r: string) => ledger.some((p) => p.reason === r);
    const friend = has("friend") || (await isFriend(env.LINE_CHANNEL_ACCESS_TOKEN, userId));
    await Promise.all([
      friend && !has("friend") ? awardPoints(env.DB, userId, "friend", now) : null,
      consent && !has("consent") ? awardPoints(env.DB, userId, "consent", now) : null,
    ]);
    return json({ ...(await summary(env.DB, userId)), friend, consent });
  }

  const body = await readJson(request);
  if (body === "too_large") return json({ error: "too_large" }, 413);
  if (body === "bad_request") return json({ error: "bad_request" }, 400);

  if (isRegister) {
    // POST /api/register {first_name, last_name, phone, age, consent, guardian_consent}
    // Personal data: the PDPA box must be ticked on this form itself, every time.
    if (!isRecord(body) || body.consent !== true) return json({ error: "consent_required" }, 400);
    const member = parseMember(body);
    if (typeof member === "string") return json({ error: member }, 400);
    await Promise.all([
      saveMember(env.DB, userId, member, now),
      saveConsent(env.DB, userId, now),
      awardPoints(env.DB, userId, "register", now),
      awardPoints(env.DB, userId, "consent", now),
    ]);
    return json({ ...(await summary(env.DB, userId)), consent: true, minor: isMinor(member.age) });
  }

  if (isCheckout) {
    // POST /api/checkout {lines: [{product, variant, qty}], shipping: {name, phone, address, postcode}}
    const order = parseOrder(body);
    if (typeof order === "string") return json({ error: order }, 400);
    if (!salesOpen(env)) {
      // Demo until the FDA notification exists: same answer shape, but nothing is stored and no QR is made.
      return json({ demo: true, ref: "DEMO", total: order.total, lines: order.lines });
    }
    if (!(await loadMember(env.DB, userId))) return json({ error: "register_required" }, 400);
    const ref = orderRef();
    await saveOrder(env.DB, ref, userId, order, now);
    console.error("order_created"); // event name only: no order details in logs
    return json({
      demo: false,
      ref,
      total: order.total,
      lines: order.lines,
      promptpay: promptPayPayload(env.PROMPTPAY_ID ?? "", order.total),
      fda: env.FDA_NOTIFICATION_NO,
    });
  }

  if (isSurvey) {
    // POST /api/survey {answers}: members only, so consent (and a guardian's under 20) was given at sign-up.
    const member = await loadMember(env.DB, userId);
    if (!member) return json({ error: "register_required" }, 400);
    const survey = parseSurvey(body, member);
    if (!survey) return json({ error: "bad_request" }, 400);
    await Promise.all([saveSurvey(env.DB, userId, survey, now), awardPoints(env.DB, userId, "survey", now)]);
    ctx.waitUntil(sendCrmRow(env.SHEETS_WEBHOOK_URL, env.SHEETS_TOKEN, surveyCrmRow(userId, survey, new Date(now))));
    return json({ ...(await summary(env.DB, userId)), consent: true });
  }

  // POST /api/waitlist {product, consent}
  if (!isRecord(body) || !findProduct(body.product)) return json({ error: "unknown_product" }, 400);
  const productId = body.product as string;
  // The waitlist stores who the customer is, so PDPA consent is required: given now, or stored from the chat.
  if (body.consent !== true && !(await hasConsent(env.DB, userId))) return json({ error: "consent_required" }, 400);

  const [isNew] = await Promise.all([
    joinWaitlist(env.DB, userId, productId, now),
    saveConsent(env.DB, userId, now),
    awardPoints(env.DB, userId, "waitlist", now),
    awardPoints(env.DB, userId, "consent", now),
  ]);
  if (isNew) ctx.waitUntil(sendCrmRow(env.SHEETS_WEBHOOK_URL, env.SHEETS_TOKEN, waitlistCrmRow(userId, productId, new Date(now))));
  return json({ ...(await summary(env.DB, userId)), joined: productId, consent: true });
}
