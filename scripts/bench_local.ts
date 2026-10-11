/*
 * Times the local model with the real system prompt, to check it answers inside the Worker's budget.
 * Run on the Mac mini, with Ollama running:
 *   npm run bench:local
 * Optional: LLM_BASE_URL (default http://localhost:11434), LLM_MODEL (default qwen3.8:27b).
 * Prints only timings and the bot's replies; nothing is sent to LINE or the Sheet.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSystemPrompt } from "../src/claude";
import { askLocal, DEFAULT_LOCAL_MODEL, DEFAULT_LOCAL_TIMEOUT_MS } from "../src/llm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const system = buildSystemPrompt(
  readFileSync(join(root, "content/system_prompt.md"), "utf8"),
  readFileSync(join(root, "content/knowledge.md"), "utf8"),
);

const samples = [
  "สวัสดีครับ แนะนำน้ำหอมให้หน่อย",
  "ชอบกลิ่นสดชื่นแบบใบไม้ ควรลองกลิ่นไหนดี",
  "Discovery set ราคาเท่าไหร่ครับ",
  "อยากซื้อขวดใหญ่ 1 ขวดครับ",
  "ผิวแพ้ง่าย ใช้ได้ไหมคะ",
];

const cfg = {
  baseUrl: process.env.LLM_BASE_URL || "http://localhost:11434",
  model: process.env.LLM_MODEL || DEFAULT_LOCAL_MODEL,
  timeoutMs: 120_000, // measure the real time here; the Worker itself stops at LLM_TIMEOUT_MS
};

console.log(`model ${cfg.model} at ${cfg.baseUrl}; Worker budget ${DEFAULT_LOCAL_TIMEOUT_MS / 1000} s per reply\n`);
let worst = 0;
for (const text of samples) {
  const t0 = performance.now();
  const resp = await askLocal(cfg, system, [], text);
  const secs = (performance.now() - t0) / 1000;
  worst = Math.max(worst, secs);
  const verdict = !resp ? "FAILED (no valid JSON)" : secs * 1000 > DEFAULT_LOCAL_TIMEOUT_MS ? "TOO SLOW" : "ok";
  console.log(`${secs.toFixed(1)} s  ${verdict}  > ${text}`);
  if (resp) {
    console.log(`        reply: ${resp.reply}`);
    console.log(`        handoff=${resp.handoff} waitlist=${resp.crm.preorder_waitlist} segment=${resp.crm.segment || "-"}\n`);
  }
}
console.log(`slowest: ${worst.toFixed(1)} s (the first call can be slower while the model loads; run it twice)`);
