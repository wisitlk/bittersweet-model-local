import { errName } from "./guards";
import { truncate } from "./text";

const API = "https://api.line.me/v2/bot";
// Short timeouts keep the whole background job inside the 30 s waitUntil budget (see handler.ts).
const LINE_TIMEOUT_MS = 3000;
const MAX_REPLY_CHARS = 4900;

function post(token: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(LINE_TIMEOUT_MS),
  });
}

/** Sends the reply. Returns false (and logs the status) when LINE refuses it; throws on network errors. */
export async function replyText(token: string, replyToken: string, text: string): Promise<boolean> {
  const res = await post(token, "/message/reply", {
    replyToken,
    messages: [{ type: "text", text: truncate(text, MAX_REPLY_CHARS) }],
  });
  if (!res.ok) console.error("line_reply_failed", res.status);
  return res.ok;
}

/** Shows the "typing" animation. Never throws: a failure here must not stop the reply. */
export async function startLoading(token: string, userId: string): Promise<void> {
  try {
    const res = await post(token, "/chat/loading/start", { chatId: userId, loadingSeconds: 20 });
    if (!res.ok) console.error("line_loading_failed", res.status);
  } catch (err) {
    console.error("line_loading_error", errName(err));
  }
}
