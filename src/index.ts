import greeting from "../content/greeting_th.txt";
import knowledge from "../content/knowledge.md";
import promptTemplate from "../content/system_prompt.md";
import { buildSystemPrompt } from "./claude";
import { handleEvent, planEvents, type Content } from "./handler";
import { handleWeb } from "./liff";
import { cleanup } from "./store";
import { verifySignature } from "./signature";
import type { Env } from "./types";
import { parseWebhookBody } from "./webhook";

const MAX_BODY_BYTES = 256 * 1024;
const content: Content = { systemPrompt: buildSystemPrompt(promptTemplate, knowledge), greeting: greeting.trim() };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/webhook") {
      // The LINE web app (LIFF) and its API; everything else is 404.
      return (await handleWeb(request, env, ctx)) ?? new Response("Not found", { status: 404 });
    }
    if (request.method !== "POST") {
      return new Response("Not found", { status: 404 });
    }

    // Refuse oversized bodies before reading them. Content-Length can be absent or wrong, so the real size is checked too.
    if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) {
      return new Response("Too large", { status: 413 });
    }
    const raw = new Uint8Array(await request.arrayBuffer());
    if (raw.byteLength > MAX_BODY_BYTES) return new Response("Too large", { status: 413 });

    const ok = await verifySignature(raw, env.LINE_CHANNEL_SECRET, request.headers.get("x-line-signature"));
    if (!ok) return new Response("Unauthorized", { status: 401 });

    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    const events = parseWebhookBody(body);
    if (events === null) return new Response("Bad request", { status: 400 });

    // Answer LINE right away; the slow work (Claude, replies) continues in the background.
    ctx.waitUntil(Promise.all(planEvents(events).map((p) => handleEvent(p.ev, env, content, Date.now(), p.mode))));
    return new Response("OK", { status: 200 });
  },

  // Runs daily (see [triggers] in wrangler.toml): deletes data older than 7 days.
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(cleanup(env.DB, Date.now()));
  },
};
