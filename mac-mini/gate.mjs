/*
 * The lock in front of Ollama on the Mac mini. The Cloudflare quick tunnel makes this port reachable from the
 * internet, so it only lets through POST /api/chat requests that carry the two secret headers the Worker already sends
 * (CF-Access-Client-Id / CF-Access-Client-Secret, set with `wrangler secret put LLM_ACCESS_CLIENT_ID|SECRET`).
 * Everything else gets 401/404 and never reaches Ollama, so nobody can pull, delete or list models through it.
 * Logs carry only status codes and timings, never message text or header values.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import http from "node:http";
import { pathToFileURL } from "node:url";

const MAX_BODY_BYTES = 256 * 1024;

const digest = (s) => createHash("sha256").update(s).digest();
const short = (s) => createHash("sha256").update(s).digest("hex").slice(0, 8);

/**
 * The shape of a chat request without its text: message count, and short hashes of the system message and of the
 * first message after it. If `sys` changes between two requests, Ollama cannot reuse its cached prompt at all; if only
 * `first` changes, the chat history window moved and everything after the system prompt is read again.
 */
export function describeRequest(body) {
  try {
    const msgs = JSON.parse(body.toString("utf8")).messages;
    if (!Array.isArray(msgs)) return "shape=unknown";
    const text = (m) => (typeof m?.content === "string" ? m.content : "");
    return `msgs=${msgs.length} sys=${short(text(msgs[0]))} first=${short(text(msgs[1]))}`;
  } catch {
    return "shape=unknown";
  }
}

/**
 * Ollama's timing numbers from its last stream line (done: true): prompt tokens, how many came from its cache (field
 * names differ between Ollama versions, so every numeric field naming "cache" is kept) and seconds spent on the prompt.
 */
export function describeDone(lastLine) {
  try {
    const d = JSON.parse(lastLine);
    if (!d || d.done !== true) return "";
    const parts = [`prompt=${d.prompt_eval_count ?? "?"}`];
    for (const [k, v] of Object.entries(d)) if (/cache/i.test(k) && typeof v === "number") parts.push(`${k}=${v}`);
    if (typeof d.prompt_eval_duration === "number") parts.push(`prompt_s=${(d.prompt_eval_duration / 1e9).toFixed(2)}`);
    if (typeof d.eval_count === "number") parts.push(`out=${d.eval_count}`);
    return " " + parts.join(" ");
  } catch {
    return "";
  }
}
const sameSecret = (given, expected) => typeof given === "string" && timingSafeEqual(digest(given), digest(expected));

/** Builds the gate server. upstream is the Ollama base URL, e.g. http://127.0.0.1:11434. */
export function createGate({ clientId, clientSecret, upstream, maxConcurrent = 2, timeoutMs = 60_000, log = console.log }) {
  if (!clientId || !clientSecret || clientId.length < 16 || clientSecret.length < 16) {
    throw new Error("GATE_CLIENT_ID and GATE_CLIENT_SECRET must both be set (at least 16 characters)");
  }
  const target = new URL("/api/chat", upstream);
  let inFlight = 0;

  return http.createServer((req, res) => {
    const started = Date.now();
    const done = (status, body) => {
      if (!res.headersSent) res.writeHead(status, { "Content-Type": "application/json" });
      res.end(body ?? JSON.stringify({ error: http.STATUS_CODES[status] }));
      log(`gate ${status} ${Date.now() - started}ms`);
    };

    if (req.method === "GET" && req.url === "/healthz") return done(200, '{"ok":true}');
    if (req.method !== "POST" || req.url !== "/api/chat") return done(404);
    if (!sameSecret(req.headers["cf-access-client-id"], clientId) || !sameSecret(req.headers["cf-access-client-secret"], clientSecret)) {
      return done(401);
    }
    if (Number(req.headers["content-length"] ?? 0) > MAX_BODY_BYTES) return done(413);
    if (inFlight >= maxConcurrent) return done(503);

    inFlight++;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        inFlight--;
      }
    };
    // When the Worker gives up (its 9 s cap) it closes the connection; stop Ollama too, so a runaway reply does not keep
    // the Mac busy and slow down the next customer.
    // firstByte = when Ollama sent its first token, i.e. how long it spent reading the prompt; it tells a slow prompt
    // apart from a slow or runaway reply in the log.
    let up = null;
    let firstByte = null;
    let shape = "";
    const timing = () =>
      `${Date.now() - started}ms first_byte=${firstByte === null ? "none" : `${firstByte}ms`}${shape ? ` ${shape}` : ""}`;
    res.on("close", () => {
      release();
      if (res.writableFinished) return;
      log(`gate client_closed ${timing()}`);
      if (up) up.destroy(new Error("client_closed"));
    });

    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        return done(413);
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (size > MAX_BODY_BYTES) return;
      const body = Buffer.concat(chunks);
      shape = describeRequest(body);
      up = http.request(
        target,
        {
          method: "POST",
          // Ollama only trusts a local Host header; never forward the caller's headers.
          headers: { Host: "localhost:11434", "Content-Type": "application/json", "Content-Length": body.length },
          timeout: timeoutMs,
        },
        (upRes) => {
          res.writeHead(upRes.statusCode ?? 502, { "Content-Type": upRes.headers["content-type"] ?? "application/json" });
          upRes.once("data", () => (firstByte = Date.now() - started));
          // Keep only the end of the stream: its last line carries Ollama's token counts and timings.
          let tail = "";
          upRes.on("data", (c) => (tail = (tail + c.toString("utf8")).slice(-4096)));
          // After the Worker hangs up, destroying `up` makes upRes emit "error"; the close handler above logged it.
          upRes.on("error", () => undefined);
          upRes.pipe(res);
          upRes.on("end", () => {
            const last = tail.trim().split("\n").pop() ?? "";
            log(`gate ${upRes.statusCode} ${timing()}${describeDone(last)}`);
          });
        },
      );
      up.on("timeout", () => up.destroy(new Error("timeout")));
      up.on("error", (e) => {
        if (e.message === "client_closed") return;
        done(e.message === "timeout" ? 504 : 502);
      });
      up.end(body);
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const env = process.env;
  const port = Number(env.GATE_PORT || 11435);
  createGate({
    clientId: env.GATE_CLIENT_ID,
    clientSecret: env.GATE_CLIENT_SECRET,
    upstream: env.OLLAMA_URL || "http://127.0.0.1:11434",
    maxConcurrent: Number(env.GATE_MAX_CONCURRENT || 2),
    timeoutMs: Number(env.GATE_TIMEOUT_MS || 60_000),
    log: (line) => console.log(`${new Date().toISOString()} ${line}`),
  }).listen(port, "127.0.0.1", () => console.log(`gate listening on 127.0.0.1:${port}`));
}
