import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createGate } from "../mac-mini/gate.mjs";

const ID = "i".repeat(32);
const SECRET = "s".repeat(64);
let upstream: http.Server;
let gate: http.Server;
let base = "";
const seen: { path?: string; host?: string; auth?: string }[] = [];

beforeAll(async () => {
  upstream = http.createServer((req, res) => {
    seen.push({ path: req.url, host: req.headers.host, auth: req.headers["cf-access-client-secret"] as string });
    req.resume();
    req.on("end", () => res.end('{"done_reason":"stop"}'));
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const up = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  gate = createGate({ clientId: ID, clientSecret: SECRET, upstream: up, log: () => undefined });
  await new Promise<void>((r) => gate.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(gate.address() as AddressInfo).port}`;
});
afterAll(() => {
  gate.close();
  upstream.close();
});

const chat = (headers: Record<string, string>, path = "/api/chat", method = "POST") =>
  fetch(base + path, { method, headers: { "Content-Type": "application/json", ...headers }, body: method === "POST" ? "{}" : undefined });

describe("Mac mini gate", () => {
  it("refuses to start without long secrets", () => {
    expect(() => createGate({ clientId: "", clientSecret: SECRET, upstream: "http://x" })).toThrow();
    expect(() => createGate({ clientId: ID, clientSecret: "short", upstream: "http://x" })).toThrow();
  });

  it("passes a chat with the right secrets to Ollama with a local Host and without the secrets", async () => {
    const res = await chat({ "CF-Access-Client-Id": ID, "CF-Access-Client-Secret": SECRET });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ done_reason: "stop" });
    expect(seen.at(-1)).toEqual({ path: "/api/chat", host: "localhost:11434", auth: undefined });
  });

  it("rejects missing or wrong secrets", async () => {
    const before = seen.length;
    expect((await chat({})).status).toBe(401);
    expect((await chat({ "CF-Access-Client-Id": ID, "CF-Access-Client-Secret": "x".repeat(64) })).status).toBe(401);
    expect(seen.length).toBe(before);
  });

  it("only exposes /api/chat and /healthz", async () => {
    const auth = { "CF-Access-Client-Id": ID, "CF-Access-Client-Secret": SECRET };
    expect((await chat(auth, "/api/pull")).status).toBe(404);
    expect((await chat(auth, "/api/tags", "GET")).status).toBe(404);
    expect((await fetch(base + "/healthz")).status).toBe(200);
  });

  it("stops the Ollama request when the caller hangs up, and logs it", async () => {
    const lines: string[] = [];
    let upstreamClosed!: () => void;
    const closed = new Promise<void>((r) => (upstreamClosed = r));
    const slow = http.createServer((req, res) => {
      req.resume();
      res.writeHead(200, { "Content-Type": "application/x-ndjson" });
      const tick = setInterval(() => res.write('{"message":{"content":" "},"done":false}\n'), 20);
      res.on("close", () => {
        clearInterval(tick);
        upstreamClosed();
      });
    });
    await new Promise<void>((r) => slow.listen(0, "127.0.0.1", r));
    const g = createGate({
      clientId: ID,
      clientSecret: SECRET,
      upstream: `http://127.0.0.1:${(slow.address() as AddressInfo).port}`,
      log: (line: string) => lines.push(line),
    });
    await new Promise<void>((r) => g.listen(0, "127.0.0.1", r));
    const ctrl = new AbortController();
    const res = await fetch(`http://127.0.0.1:${(g.address() as AddressInfo).port}/api/chat`, {
      method: "POST",
      headers: { "CF-Access-Client-Id": ID, "CF-Access-Client-Secret": SECRET },
      body: "{}",
      signal: ctrl.signal,
    });
    await res.body?.getReader().read();
    ctrl.abort();
    await closed; // resolves only if the gate closed its request to the upstream
    expect(lines.some((l) => /^gate client_closed \d+ms first_byte=\d+ms$/.test(l))).toBe(true);
    g.close();
    slow.close();
  });

  it("rejects a body over 256 KB", async () => {
    const res = await fetch(base + "/api/chat", {
      method: "POST",
      headers: { "CF-Access-Client-Id": ID, "CF-Access-Client-Secret": SECRET },
      body: "x".repeat(300 * 1024),
    });
    expect(res.status).toBe(413);
  });
});
