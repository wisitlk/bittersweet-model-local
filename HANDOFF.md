# Handoff: BitterSweet LINE Scent Concierge

You are taking over a working prototype. It was built and run on the previous owner's own accounts
(LINE, Cloudflare, Google, Anthropic). **None of those accounts are handed over.** You rebuild the
same thing on your own accounts with `SETUP.md`; that takes about two hours, most of it clicking
through consoles.

Read in this order: `START-HERE.md` (plain overview, also in Thai), this file, then `README.md` (architecture and file map), then `SETUP.md`
(step-by-step build).

## What it is and where it stands

A LINE Official Account chatbot for BitterSweet, a Thai niche perfume brand (BIS608/BIS609 student
project, KMUTT). A student scans a QR code, adds the account, and chats with "Scent Concierge",
which answers in the customer's language (Thai by default) from a fixed knowledge base.

```
LINE app → LINE Messaging API → Cloudflare Worker (/webhook) → Claude API
                                     ├─ Cloudflare D1: history, consent, rate limits, dedupe
                                     └─ Google Apps Script → Google Sheet "CRM"
```

Status at handoff (2026-10-10): deployed and verified end to end on 2026-10-08 — a LINE message got
a Claude reply, and a consented profile row landed in the Sheet. The pre-order and human-handoff
paths were not yet tried on the live system (they are covered by the unit tests).

## Decisions already taken, and why

Keep these unless you have a reason; each one was a deliberate choice.

- **The bot never sells.** BitterSweet cannot sell until its Thai FDA cosmetic notification is
  issued (first sales planned May 2027). The bot recommends among the three scents, suggests the
  discovery set, and adds interested people to a pre-order waitlist. No orders, payments or
  addresses. This comes from the strategy decks ("Scent Concierge that tells the truth").
- **PDPA first.** A profile reaches the Sheet only after the customer clearly consents. Without
  consent, only flags are sent for a human handoff or a deletion request — never message text
  (it can contain health data, e.g. an allergy). Consent is stored per user in D1 so it survives
  across turns. A deletion request erases D1 history, consent and the user's Sheet rows.
- **One model for everything: `claude-sonnet-5-5`.** Chosen for Thai quality. Thinking is off
  (`between_tools`) and effort is `low` for fast, cheap chat replies. The system prompt and
  knowledge base are prompt-cached.
- **Cloudflare D1, not KV.** The free KV plan allows only 1,000 writes a day; a busy demo would hit
  it. D1 allows 100,000 rows written a day.
- **Cost and abuse limits** (in `wrangler.toml`): 20 messages per 10 minutes and 60 per day per
  user; 1,500 Claude calls per day for the whole bot. User text is cut to 1,000 characters.
- **Memory:** the bot sees the last 10 exchanges with each person. History is deleted after 7 days
  by a daily cron job.
- **The Sheet is an append log.** Every profile update adds a new row rather than editing the old
  one. Switching to one row per customer is an open choice, not a bug.

## Things that cost time during the first build

- **`npx wrangler login` timed out on Windows** ("Timed out waiting for authorization code").
  Use an API token instead — `SETUP.md` step 3 has the exact steps. Never paste the token into a
  chat or a command line; paste it only at the `Read-Host` prompt.
- **The Apps Script web app must be open to "Anyone".** Symptom when it is not: `wrangler tail`
  shows `crm_http_error 401` and Apps Script → Executions stays empty. Opening the URL in your own
  browser proves nothing, because you are signed in there.
- **Copy the Apps Script URL with the Copy button.** The dialog truncates it on screen.
- **Changing the model is not a one-line change yet.** `src/claude.ts` sends `thinking:
  between_tools` and `fallbacks: "default"`, which only Sonnet 5.5 accepts. Haiku 5.5 or Opus 5.5
  would get an API error on every message. Make those two options model-dependent first.
- **LINE settings:** turn off Greeting message and Auto-response in OA Manager → Response settings,
  and do not enable LINE's own "AI Chatbot (Beta)" — it would answer alongside the bot. The
  "Use webhook" switch only works after the Webhook URL is saved and verified.
- **The workers.dev subdomain is account-wide.** Whatever you pick becomes the address of every
  Worker on your Cloudflare account.
- **The test script's fake user id is rejected by the Sheet** on purpose (it is not a real LINE id).
  Test CRM writes from a real phone.

## Open items

1. **Scent notes.** `content/knowledge.md` has three `TODO(owner)` lines: the top, heart and base
   notes of Fresh Leaf, Cilantro and Last Sip are not in the BIS608 report. Get them from the
   perfumer; until then the bot says it does not know them.
2. **Thai proofreading.** `content/greeting_th.txt`, the system prompt's tone, and the fixed
   replies in `src/messages.ts` were written by a model. A native Thai speaker should read them.
3. **Try the remaining live paths:** "I want to buy a bottle" (should offer the waitlist, set
   `preorder_waitlist`), and "I have sensitive skin" (should set `handoff`, and email you if
   `NOTIFY_EMAIL` is set in `Code.gs`).
4. **Sheet layout:** decide between the append log and one row per customer.
5. **QR code** for the demo: LINE Developers Console → your channel → Messaging API tab, or OA
   Manager → Home → Add friends.
6. Known limits accepted for a prototype are listed in `README.md` → "Known limits".

## Day-to-day changes

- **What the bot knows or how it talks:** edit `content/knowledge.md`, `content/system_prompt.md`
  or `content/greeting_th.txt`, then `npm run deploy`.
- **Limits or model id:** `wrangler.toml` `[vars]`, then `npm run deploy` (see the model caveat).
- **Sheet script:** edit in Apps Script, then Deploy → Manage deployments → Edit → New version
  (otherwise the old code keeps running; the URL stays the same).
- **Live logs:** `npx wrangler tail`. Logs carry event types and errors only, never message text.
- **Checks before any deploy:** `npm run typecheck`, `npm test`, `npm run lint`.

## What is deliberately not in this package

- **Secrets.** No LINE secret or token, Anthropic key, Sheet token or Cloudflare token. You create
  your own (`SETUP.md` steps 1, 5, 6, 7).
- **The live Sheet.** It holds real people's LINE ids and preferences; it stays with the previous
  owner and is deleted when the old bot is shut down.
- **The D1 database id.** `wrangler.toml` contains the placeholder `REPLACE_WITH_D1_DATABASE_ID`;
  `SETUP.md` step 4 creates your own database and tells you where to paste its id.

## Background material

`reference/` holds the strategy decks and reports the bot is based on: what the agent should do
(customer journey, segments, guardrails, sample conversations) and the brand facts. The knowledge
base and system prompt were written from them, via the earlier `sim-line-demo` draft, which is
not included because nothing in it is still needed.
