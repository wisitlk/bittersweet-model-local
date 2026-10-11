# BitterSweet Scent Concierge (Cloudflare Worker)

A LINE Official Account chatbot for a one-day university demo. Customers chat in Thai; Claude Sonnet 5.5 recommends among BitterSweet's three scents, suggests the discovery set, saves a scent profile only after PDPA consent and adds interested people to the pre-order waitlist. It never takes orders, payments or addresses (Thai FDA notification is still pending). Skin, allergy, ingredients, complaints and requests for a human are handed off to the perfumer.

Setup for non-programmers: [SETUP.md](SETUP.md).

## Architecture

```
LINE user --> LINE platform --POST /webhook--> Cloudflare Worker --> D1 (history, dedupe, counters)
                                                  |  200 OK at once, rest in ctx.waitUntil
                                                  |--> LINE loading animation
                                                  |--> Anthropic Messages API (structured JSON)
                                                  |--> LINE reply API
                                                  '--> Google Apps Script --> Google Sheet "CRM" (+ email on handoff)
```

## File map

| Path | What |
|---|---|
| `src/index.ts` | HTTP entry: 404 except `POST /webhook`, signature check, answers 200, work in `waitUntil` |
| `src/signature.ts` | LINE HMAC-SHA256 signature check (Web Crypto, constant-time) |
| `src/webhook.ts` | Type guards for the webhook body, event parsing |
| `src/handler.ts` | One event: dedupe, limits, loading, Claude, reply, history, CRM |
| `src/claude.ts` | Messages API call, JSON schema, response guard, prompt caching |
| `src/line.ts` | LINE reply and loading-animation calls |
| `src/crm.ts` | CRM row mapping (consent rules) and POST to Apps Script |
| `src/store.ts` | D1 queries: idempotency, rate limit, daily cap, history, cleanup |
| `src/messages.ts` | Fixed Thai replies (rate limit, daily cap, non-text, apology) |
| `content/` | `system_prompt.md`, `knowledge.md`, `greeting_th.txt` (edit these, then redeploy) |
| `schema.sql` | D1 tables |
| `apps_script/Code.gs` | Google Sheet receiver |
| `scripts/send_test_event.ps1` | Sends a correctly signed test webhook |
| `test/` | Vitest tests (real SQLite stands in for D1) |

## Known limits (accepted for the demo)

- Two quick messages from the same person may not see each other in the history (each is handled in parallel).
- No timestamp-based replay check: a captured, correctly signed request could be replayed. Duplicates of the same LINE event id are ignored.
- No Cloudflare IP rate-limit rule. Cost is bounded by the per-user and global Claude caps instead.
- Replies use LINE reply tokens, which only work for about a minute.
- Chat is processed by Anthropic and stored in D1 for 7 days.
- Consent is forgotten 7 days after it was last given; the student is simply asked again.
- The Apps Script endpoint has no rate limit beyond the shared token (and the Worker's own caps upstream).
- A delete request can race with an append that is still in flight from a message sent just before it; in that rare case that one row survives and has to be deleted by hand.

## Commands

`npm run typecheck` (tsc), `npm test` (vitest), `npm run lint` (eslint, includes `no-explicit-any`), `npm run dev` (wrangler dev), `npm run deploy`.
