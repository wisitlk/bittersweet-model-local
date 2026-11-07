# Plan: run Scent Concierge on a local Qwen model (Mac mini)

Goal: replace the Anthropic (Claude) API with a Qwen model running on the owner's Mac mini, without
breaking the rules in `CLAUDE.md` (never sells, PDPA consent, signed webhooks, bounded spend, no
message text in logs).

## Where the AI is used today

Only one place: `askClaude()` in `src/claude.ts`, called once per text message from
`src/handler.ts`. It sends the system prompt + knowledge base, the last 10 exchanges and the new
message, and expects back one JSON object (`reply`, `handoff`, `crm{...}`) that matches
`RESPONSE_SCHEMA`. Everything else (LINE, D1, Google Sheet, limits) does not care which model
answers. So the change is small and contained.

## Recommended route: keep the bot on Cloudflare, call the Mac through a tunnel

```
LINE → Cloudflare Worker (unchanged: signature, D1, limits, Sheet)
             │  HTTPS + secret header
             ▼
   Cloudflare Tunnel (cloudflared on the Mac, free)
             ▼
   Ollama (or LM Studio) on the Mac mini → Qwen
```

Why this route and not "move the whole bot to the Mac":

- LINE needs a public HTTPS address either way, so the Mac would need a tunnel anyway.
- D1, the daily cleanup, the rate limits and all 120 tests keep working as they are.
- Only the "ask the AI" step changes; if the Mac is off, the Worker still answers (apology, or a
  Claude fallback, see below) instead of LINE getting no answer at all.

### Pieces on the Mac mini

1. **Ollama** (simplest; LM Studio works too). It serves an OpenAI-style API on
   `http://localhost:11434/v1`. Pull the Qwen model you chose (check the exact tag in the Ollama
   library; the names below are as given by the owner, not verified here).
2. **cloudflared** (Cloudflare Tunnel) to give the Mac a fixed address such as
   `https://llm.<your-domain>` without opening router ports. A named tunnel needs a domain on
   Cloudflare; a free "quick tunnel" (`*.trycloudflare.com`) works for testing but changes address
   on every restart.
3. **Protection**: put the tunnel behind a Cloudflare Access *service token* (two secret headers),
   so only the Worker can reach the model. Without it, anyone who finds the URL could use the Mac.
4. **Keep it awake** during the demo: System Settings → Energy → prevent sleep, and keep Ollama
   loaded (`OLLAMA_KEEP_ALIVE=-1`) so the first student doesn't wait for the model to load.

### Which Qwen model

| | Qwen 3.8 27B | Qwen 3.8-Flash-Next |
|---|---|---|
| Memory needed (owner's figures) | ~24 GB (4-bit) | ~75 GB+ |
| Mac mini that fits | 32 GB+ (M4 / M4 Pro) | 96–128 GB only |
| Speed | dense model: slower per word | MoE-style "flash": usually faster per word |

The deciding factor is time, not quality: Cloudflare keeps the background work alive about
**30 seconds** after LINE is answered (`handler.ts` comment), and the LINE reply token is single
use. Each reply needs the model to read the ~several-thousand-token system prompt plus history and
write ~150–300 tokens of JSON. That must finish in roughly 20–25 s on the Mac. Measure it before the
demo (step 5 below). Thinking/reasoning mode **must be off** (e.g. Ollama `think: false`), or the
reply will take far too long.

Thai quality: Qwen's Thai is usable but weaker than Claude's. The Thai review already listed as an
open item matters more with a local model.

## Code changes (small, about one file plus tests)

1. New `src/llm.ts`: `askLocal()` calls `POST {LLM_BASE_URL}/v1/chat/completions` with
   - `messages`: system prompt, history, user text, and the consent note as a system message
   - `response_format: {type: "json_schema", json_schema: {name: "concierge", schema: RESPONSE_SCHEMA, strict: true}}`
     so the model is forced into the same JSON shape
   - `temperature` low (e.g. 0.3), thinking off, `max_tokens` ~800
   - the Access service-token headers
   - same guard as today: `isConciergeResponse()`, return `null` on any error so the customer gets
     the apology reply.
2. `src/handler.ts`: pick the provider from a new var `LLM_PROVIDER` (`local` or `anthropic`).
   Subrequest budget is unchanged (still one AI call per message; +1 if a fallback is enabled,
   16 → 17, still under 50).
3. `wrangler.toml` `[vars]`: `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_TIMEOUT_MS`.
   New secrets (hidden prompt only): `LLM_ACCESS_CLIENT_ID`, `LLM_ACCESS_CLIENT_SECRET`.
   `ANTHROPIC_API_KEY` becomes optional.
4. Tests: copy the style of `test/claude.test.ts` for the new client (good reply, bad JSON,
   timeout, HTTP error) and one handler test per provider.
5. A small script `scripts/bench_local.mjs` that sends 5 sample Thai messages straight to the Mac
   and prints the time per reply, to check the 20–25 s budget before the demo.
6. Docs: a "Local model" section in `SETUP.md` (install Ollama, pull model, cloudflared, Access
   token, secrets).

## Decision: local only (2026-10-11)

No Claude backup. If the Mac is off, asleep or too slow, students get the fixed apology message, and no
Anthropic account is needed. Claude stays available by setting `LLM_PROVIDER = "anthropic"`.

As built, the Worker calls Ollama's native `/api/chat` (with `think: false` and `format` set to the
schema) rather than the OpenAI-style endpoint, because those two options are documented there. The
step-by-step setup is in `docs/LOCAL-LLM.md`.

## Not changed

LINE setup, D1 schema, Google Sheet / Apps Script, consent rules, limits, system prompt and
knowledge base.
