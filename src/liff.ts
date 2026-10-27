import appHtml from "../web/app.html";
import { findProduct, POINT_RULES, PRODUCTS, type PointReason } from "./catalog";
import { sendCrmRow, type CrmRow } from "./crm";
import { errName, isRecord } from "./guards";
import { awardPoints, joinWaitlist, loadPoints, loadWaitlist } from "./loyalty";
import { allowWebRequest, hasConsent, saveConsent } from "./store";
import type { Env } from "./types";

/*
 * The LINE web app (LIFF): a catalog with a pre-order waitlist button and a points page. LINE Login happens in the
 * page (LIFF SDK); every API call carries the LINE ID token, which is checked with LINE before anything is read or
 * written, so nobody can act as another customer. Nothing here sells: no cart, no payment, no address.
 *
 * Subrequests per API call: verify 1 + rate limit 1 + friend check 1 + about 6 D1 queries + Apps Script 2 = 11 < 50.
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
export function renderApp(liffId: string): string {
  const config = JSON.stringify({ liffId, products: PRODUCTS, rules: POINT_RULES }).replace(/</g, "\\u003c");
  return appHtml.replace("__APP_CONFIG__", config);
}

async function summary(db: D1Database, userId: string) {
  const [ledger, waitlist] = await Promise.all([loadPoints(db, userId), loadWaitlist(db, userId)]);
  return {
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
    segment: productId === "discovery_set" ? "set_trier" : "",
    scents_smelled: "",
    liked: "",
    disliked: "",
    preferences: `web pre-order: ${product?.name ?? productId}`,
    discovery_set_interest: productId === "discovery_set",
    preorder_waitlist: true,
    consent_pdpa: true,
    handoff: false,
    delete_request: false,
    last_message: "",
  };
}

/** Handles GET /app, GET /api/me and POST /api/waitlist. Returns null for any other path. */
export async function handleWeb(request: Request, env: Env, ctx: ExecutionContext, now = Date.now()): Promise<Response | null> {
  const { pathname } = new URL(request.url);

  if (pathname === "/app" && request.method === "GET") {
    if (!env.LIFF_ID) return new Response("Web app not configured (LIFF_ID)", { status: 503 });
    return new Response(renderApp(env.LIFF_ID), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    });
  }

  const isMe = pathname === "/api/me" && request.method === "GET";
  const isWaitlist = pathname === "/api/waitlist" && request.method === "POST";
  if (!isMe && !isWaitlist) return null;

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

  // POST /api/waitlist {product, consent}
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) return json({ error: "too_large" }, 413);
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: "too_large" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "bad_request" }, 400);
  }
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
