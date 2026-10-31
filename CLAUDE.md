# CLAUDE.md — BitterSweet LINE Scent Concierge

Instructions for Claude Code working in this repository. Read `HANDOFF.md` next: it holds the
decisions already taken and the problems the first build ran into.

## The project in one paragraph

A Cloudflare Worker that turns a LINE Official Account into "Scent Concierge" for BitterSweet, a
Thai niche perfume brand (a BIS608/BIS609 university project, KMUTT). LINE posts each message to
`POST /webhook`; the Worker verifies the signature, loads recent history and consent from D1, asks
the AI model for a structured JSON answer (`LLM_PROVIDER`: `gemini` by default, see `docs/GEMINI.md`;
`hybrid` = Gemma on the owner's Mac mini first with Gemini as backup, see `docs/MAC-MINI.md`; `local` = the Mac mini only;
`anthropic` = Claude `claude-sonnet-5-5`), replies through the LINE reply API, and — only
with PDPA consent — appends a profile row to a Google Sheet through an Apps Script web app. The
goal is a demo where students scan a QR code and chat with the bot.

## Who you are probably working with

The person running this repo has just taken it over and is likely **not a programmer**. They are
rebuilding it on their own accounts (LINE, Cloudflare, Google, Anthropic) from `SETUP.md`.

- Guide one step at a time; say what to click and what to expect, and ask for a screenshot when a
  console looks different. Console UIs change — trust what they show you over the text here.
- Explain any technical term in plain words the first time.
- **Never ask for a secret in the chat** (LINE channel secret or access token, Anthropic or Gemini key,
  Sheet token, Cloudflare token). Secrets go in only at hidden prompts: `npx wrangler secret put
  <NAME>`, Apps Script → Project Settings → Script properties, and for the Cloudflare token
  `$env:CLOUDFLARE_API_TOKEN = Read-Host "Paste Cloudflare token"`. If one is pasted into the
  chat anyway, tell them to revoke and re-create it.
- Cloud actions on their accounts (deploy, creating or deleting the D1 database or Worker, account
  settings) are theirs to approve: give the command and let them run it, or ask before running it.
- The owner may write in Thai or English. Answer in the language they use.

## Commands

```
npm install
npm run typecheck     # tsc --noEmit
npm test              # vitest, ~120 tests; D1 is faked with node:sqlite
npm run lint          # eslint, no-explicit-any is an error
npm run deploy        # wrangler deploy — the owner's call
npx wrangler deploy --dry-run   # bundles without deploying, no login needed
npx wrangler tail     # live logs from the deployed Worker
```

Typecheck, tests and lint must be green before any deploy. A failing test means the code is
wrong; do not weaken or delete a test to make it pass.

## Map

| Path | Role |
|---|---|
| `src/index.ts` | HTTP entry (`/webhook` only, size cap, signature) and the daily `scheduled()` cleanup |
| `src/handler.ts` | Per-event flow: dedupe, limits, history, Claude, reply, consent, CRM; subrequest budget comment |
| `src/claude.ts` | Messages API call via `fetch`, prompt caching, JSON schema, response guard |
| `src/gemini.ts` | Gemini `generateContent` (`responseJsonSchema` = same schema, `thinkingLevel`) |
| `src/llm.ts` | Local model via Ollama `/api/chat` (`think: false`, `format` = same schema, Access headers) |
| `src/store.ts` | D1 queries: events, counters, history, consent, cleanup |
| `src/crm.ts` | Builds the Sheet row and posts it (consent rules live here) |
| `src/line.ts`, `src/signature.ts`, `src/webhook.ts` | LINE API calls, HMAC check, webhook body guards |
| `src/messages.ts` | Fixed Thai replies (busy, limit reached, apology, non-text) |
| `content/` | `knowledge.md`, `system_prompt.md`, `greeting_th.txt` — bundled as text modules |
| `src/liff.ts`, `src/catalog.ts`, `src/loyalty.ts` | LINE web app (`/app`, `/api/me`, `/api/waitlist`): ID-token check, catalog, points, waitlist (see `docs/LIFF.md`) |
| `src/member.ts`, `src/survey.ts`, `src/checkout.ts` | Web app sign-up, scent survey, and the buy flow (demo until `FDA_NOTIFICATION_NO` + `PROMPTPAY_ID` are set) |
| `web/app.html`, `public/img/` | The web app page (text module) and its photos (static assets) |
| `schema.sql` | D1 tables |
| `mac-mini/` | Gate (secret-header lock in front of Ollama), quick-tunnel start script, Worker secret helper |
| `apps_script/Code.gs` | The Sheet's web app (token check, row validation, delete-by-user, handoff email) |
| `wrangler.toml` | D1 binding, `[vars]` limits and model id, daily cron |

## Rules that must hold

- **The bot never sells.** No orders, payments or addresses until the Thai FDA notification exists.
  It recommends, suggests a Sample, and adds people to the pre-order waitlist. The web app's buy flow stays a demo
  (stores nothing, no payment QR) until `FDA_NOTIFICATION_NO` and `PROMPTPAY_ID` are both set. These rules
  are in `content/system_prompt.md`; keep them when editing the prompt.
- **No profile data in the Sheet without consent.** Without `consent_pdpa`, only flags go out for
  handoff or deletion — never message text or profile fields. A deletion request clears D1 history,
  consent and the user's Sheet rows.
- **Verify every webhook** (`x-line-signature`) before parsing; keep the body size cap. Web app API calls are
  trusted only after LINE verifies the ID token (`verifyIdToken`); the waitlist there needs PDPA consent too.
- **Bound the spend.** Keep the per-user and daily caps; the Workers Free plan allows 50
  subrequests per invocation, so re-check the budget comment in `handler.ts` after adding any
  D1 query or fetch.
- **Never log secrets or message text**; logs carry event types and error names only.
- Assume LINE redelivers and users double-send: keep writes idempotent.
- Code, comments and docs in English. Customer-facing bot text in Thai.

## Known traps

- Gemini 3.x/4 cannot turn thinking off (`thinkingLevel` low is the floor on some models, `minimal` on
  others); `maxOutputTokens` includes thinking tokens, so keep it generous. `thinkingBudget` is the
  older 2.5-series field and must not be sent together with `thinkingLevel`.
- Local model: all model tries share 23 s per message (`MODEL_BUDGET_MS`); in `hybrid` the Mac mini gets at most 9 s.
  Check speed on the Mac with `npm run bench:local` after changing the model. Thinking must stay off.
- Ollama rejects requests whose Host header is not local; the tunnel's public hostname needs
  HTTP Host Header `localhost:11434`.
- `thinking: {type: "between_tools"}` and `fallbacks: "default"` (with the
  `server-side-fallback-2026-07-01` beta header) are accepted only by `claude-sonnet-5-5`. Changing
  `CLAUDE_MODEL` without making those model-dependent breaks every reply. Check the current Claude
  API documentation before changing request options.
- Sonnet 5.5 rejects non-default `temperature` and forced `tool_choice`; structured output uses
  `output_config.format`.
- `wrangler login` can time out on Windows; use an API token (`SETUP.md` step 3).
- Apps Script must be deployed with access **Anyone**; otherwise the Worker logs
  `crm_http_error 401` and Apps Script → Executions stays empty. After editing `Code.gs`, deploy a
  **new version** of the existing deployment so the URL stays the same.
- `wrangler.toml` ships with `REPLACE_WITH_D1_DATABASE_ID`; the owner pastes their own id there.

## Open work

See `HANDOFF.md` → "Open items": missing scent notes, Thai proofreading, untested live
pre-order/handoff paths, Sheet layout (append log vs one row per customer).
