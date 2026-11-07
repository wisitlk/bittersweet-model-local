/*
 * Times the AI model with the real system prompt, to check it answers inside the Worker's budget.
 *   Local Gemma (Ollama running on this Mac mini):  npm run bench:local
 *     optional LLM_BASE_URL (default http://localhost:11434), LLM_MODEL (default gemma4:e4b).
 *     To time the whole path through the tunnel and gate, set LLM_BASE_URL to the tunnel address and run
 *     `set -a; . mac-mini/.env; set +a` first, so the gate's two secrets are sent (they are never printed).
 *   Gemini: first `read -s GEMINI_API_KEY && export GEMINI_API_KEY` (paste the key at the hidden prompt),
 *     then npm run bench:gemini; optional GEMINI_MODEL, GEMINI_THINKING_LEVEL
 *   Add --raw (local only) to also print Ollama's done_reason, token counts and, when Gemma does not stop by itself,
 *     the end of the text it wrote (askLocal stops reading at the closing brace; --raw reads to the end).
 *   Add --history to ask each question after one earlier exchange (live traffic mostly has history).
 *   LLM_FORMAT=on npm run bench:local sends Ollama's JSON grammar too (off by default, as in the Worker).
 * Prints only timings and the bot's replies; nothing is sent to LINE or the Sheet.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSystemPrompt } from "../src/claude";
import { askGemini, DEFAULT_GEMINI_MODEL, DEFAULT_GEMINI_THINKING, GEMINI_TIMEOUT_MS } from "../src/gemini";
import { HYBRID_LOCAL_MAX_MS } from "../src/handler";
import { askLocal, buildLocalRequestBody, DEFAULT_LOCAL_MODEL } from "../src/llm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const system = buildSystemPrompt(
  readFileSync(join(root, "content/system_prompt.md"), "utf8"),
  readFileSync(join(root, "content/knowledge.md"), "utf8"),
);

const samples = [
  "สวัสดีครับ แนะนำน้ำหอมให้หน่อย",
  "ชอบกลิ่นชาเขียว ใส่ไปทำงานทุกวัน ควรลองกลิ่นไหนดี",
  "Sample ราคาเท่าไหร่ครับ",
  "อยากซื้อขวดใหญ่ 1 ขวดครับ",
  "ผิวแพ้ง่าย ใช้ได้ไหมคะ",
];

// --history: each question follows one earlier exchange, as most live messages do (the bot's reply stored as text).
const history = process.argv.includes("--history")
  ? [
      { role: "user" as const, content: "สวัสดีครับ" },
      { role: "assistant" as const, content: "สวัสดีครับ ยินดีต้อนรับสู่ BitterSweet อยากได้กลิ่นแบบไหนเล่าให้ฟังได้เลยครับ" },
    ]
  : [];
const useGemini = process.argv.includes("--gemini");
const raw = !useGemini && process.argv.includes("--raw");
const geminiKey = process.env.GEMINI_API_KEY ?? "";
if (useGemini && !geminiKey) {
  console.error("GEMINI_API_KEY is not set: run `read -s GEMINI_API_KEY && export GEMINI_API_KEY` first.");
  process.exit(1);
}
const geminiModel = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
const thinking = process.env.GEMINI_THINKING_LEVEL || DEFAULT_GEMINI_THINKING;
const cfg = {
  baseUrl: process.env.LLM_BASE_URL || "http://localhost:11434",
  model: process.env.LLM_MODEL || DEFAULT_LOCAL_MODEL,
  timeoutMs: 120_000, // measure the real time here; the Worker itself stops at LLM_TIMEOUT_MS
  accessClientId: process.env.GATE_CLIENT_ID,
  accessClientSecret: process.env.GATE_CLIENT_SECRET,
  useFormat: process.env.LLM_FORMAT === "on", // LLM_FORMAT=on sends Ollama's JSON grammar, like the Worker's LLM_FORMAT
};
// Gemini aborts at its own 20 s timeout inside askGemini. In "hybrid" the Worker gives the Mac mini at most
// HYBRID_LOCAL_MAX_MS before it asks Gemini instead.
const budgetMs = useGemini ? GEMINI_TIMEOUT_MS : HYBRID_LOCAL_MAX_MS;
const ask = (text: string) =>
  useGemini ? askGemini(geminiKey, geminiModel, system, history, text, false, thinking) : askLocal(cfg, system, history, text);

console.log(
  useGemini
    ? `Gemini ${geminiModel} (thinking ${thinking}); Worker budget ${budgetMs / 1000} s per reply\n`
    : `model ${cfg.model} at ${cfg.baseUrl}${cfg.useFormat ? " (JSON grammar on)" : ""}${history.length ? " with history" : ""}; Worker budget ${budgetMs / 1000} s per reply\n`,
);
// Same request as askLocal, but keeps Ollama's own fields so a "length" stop can be inspected.
async function rawLocal(text: string): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.accessClientId && cfg.accessClientSecret) {
    headers["CF-Access-Client-Id"] = cfg.accessClientId;
    headers["CF-Access-Client-Secret"] = cfg.accessClientSecret;
  }
  const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, "")}/api/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify(buildLocalRequestBody(cfg.model, system, history, text, false, cfg.useFormat)),
    signal: AbortSignal.timeout(cfg.timeoutMs),
  });
  // The request streams (NDJSON); read it all, without askLocal's early stop, to see what Gemma would write.
  type Line = {
    done_reason?: string;
    prompt_eval_count?: number;
    eval_count?: number;
    eval_duration?: number;
    message?: { content?: string };
  };
  const lines = (await res.text())
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Line);
  const data = lines.at(-1) ?? {};
  const content = lines.map((l) => l.message?.content ?? "").join("");
  const close = content.lastIndexOf("}");
  console.log(`        chars after the last closing brace: ${close < 0 ? "no brace" : content.length - close - 1}`);
  const tps = data.eval_count && data.eval_duration ? (data.eval_count / (data.eval_duration / 1e9)).toFixed(1) : "?";
  console.log(
    `        raw: done_reason=${data.done_reason} prompt_tokens=${data.prompt_eval_count} ` +
      `output_tokens=${data.eval_count} (${tps} tok/s) chars=${content.length}`,
  );
  if (data.done_reason !== "stop") {
    console.log(`        first 300 chars: ${JSON.stringify(content.slice(0, 300))}`);
    console.log(`        last 200 chars: ${JSON.stringify(content.slice(-200))}`);
  }
  else console.log(`        json: ${content}`);
  console.log("");
}

let worst = 0;
for (const text of samples) {
  const t0 = performance.now();
  const resp = await ask(text);
  const secs = (performance.now() - t0) / 1000;
  worst = Math.max(worst, secs);
  const verdict = !resp ? "FAILED (no valid JSON)" : secs * 1000 > budgetMs ? "TOO SLOW" : "ok";
  console.log(`${secs.toFixed(1)} s  ${verdict}  > ${text}`);
  if (resp) {
    console.log(`        reply: ${resp.reply}`);
    console.log(`        handoff=${resp.handoff} waitlist=${resp.crm.preorder_waitlist} segment=${resp.crm.segment || "-"}\n`);
  }
  if (raw) await rawLocal(text);
}
console.log(`slowest: ${worst.toFixed(1)} s (the first call can be slower while the model loads; run it twice)`);
