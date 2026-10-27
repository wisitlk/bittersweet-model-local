# Using Google Gemini as the bot's AI

This replaces SETUP.md step 5 (Anthropic key). Everything else in SETUP.md stays the same, including
the LINE **Official Account** (a LINE OpenChat group cannot run a bot; the Messaging API works only
with an Official Account).

## 1. Create the key (10 min)

1. Go to https://aistudio.google.com and sign in with the Google account that will own the bot.
2. **Get API key** → Create API key. A key is a password for your Gemini account: never paste it into a
   chat, email, document or Git. If that ever happens, delete it in AI Studio and create a new one.
3. **Turn on billing for the key's Google Cloud project** and set a budget alert (Google Cloud console →
   Billing → Budgets & alerts, e.g. 10 USD). Two reasons:
   - The free tier has low per-minute and per-day limits; a room of students can hit them and get the
     apology message.
   - On the free tier Google may use prompts and replies to improve its products. These are real
     customer chats (PDPA), so use the paid tier for the demo.

## 2. Check speed and answers on your computer (5 min)

In the project folder:
```
npm install
read -s GEMINI_API_KEY && export GEMINI_API_KEY
npm run bench:gemini
```
`read -s` waits for you to paste the key; nothing shows on screen and it is not saved in your shell
history. The script sends five sample Thai messages with the real system prompt. Every line should say
`ok` (under 20 s). Read the Thai replies too.

## 3. Store the key in Cloudflare and deploy

```
npx wrangler secret put GEMINI_API_KEY
```
Paste the key at the hidden prompt. In `wrangler.toml` → `[vars]`, keep `LLM_PROVIDER = "gemini"`.
`GEMINI_MODEL` is `gemini-3.6-flash` with `GEMINI_THINKING_LEVEL = "minimal"`, tested live on 2026-10-27
(`gemini-3.8-flash` at `low` took over 20 s, and it rejects `minimal` with HTTP 400). To try another model,
run `bench:gemini` with `GEMINI_MODEL=...` first. Then
continue with SETUP.md step 8 (deploy).

Gemini 3.x models cannot switch thinking off. `minimal` is the fastest level, but only some models accept it.

## When something goes wrong

`npx wrangler tail` shows one line per problem, never message text:

| Log line | Meaning | Fix |
|---|---|---|
| `gemini_not_configured` | `GEMINI_API_KEY` secret missing | `npx wrangler secret put GEMINI_API_KEY` |
| `gemini_http_error 400` | key wrong, or the model rejects a setting (e.g. thinking level) | re-enter the key; try `bench:gemini` with another `GEMINI_THINKING_LEVEL` |
| `gemini_http_error 403` | key disabled or API not enabled for the project | check the key in AI Studio |
| `gemini_http_error 404 NOT_FOUND` | model id not found | copy a model id from AI Studio into `GEMINI_MODEL` |
| `gemini_http_error 429` | free-tier or quota limit reached | turn on billing / raise quota |
| `gemini_bad_finish_reason SAFETY` | Gemini blocked the answer | rare for perfume chat; the student gets the apology |
| `gemini_bad_finish_reason MAX_TOKENS` / `gemini_schema_mismatch` | answer cut off or not in the required JSON | lower thinking level or try another model |
| `gemini_error TimeoutError` | no answer within 20 s | lower thinking level, or a Flash-Lite model |

## Switching model provider later

`LLM_PROVIDER = "local"` (Qwen on the Mac mini, see `docs/LOCAL-LLM.md`) or `"anthropic"` (Claude),
with that provider's secret stored, then deploy. Nothing else changes.
