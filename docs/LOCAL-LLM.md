> Superseded by [MAC-MINI.md](MAC-MINI.md) (Gemma in the Ollama app + quick tunnel + gate, Gemini backup). Kept for the Qwen/Access notes.

# Running the bot on a local Qwen model (Mac mini)

This replaces SETUP.md step 5 (Anthropic key). Everything else in SETUP.md stays the same. You don't
need an Anthropic account: the bot asks Qwen on your Mac mini, and if the Mac can't answer in time,
the student gets the fixed apology message.

```
LINE → Cloudflare Worker ──HTTPS + Access token──▶ Cloudflare Tunnel ──▶ Ollama on the Mac mini (Qwen)
```

A **tunnel** is a private link that lets the Worker on the internet reach a program on your Mac without
opening anything on your router. **Cloudflare Access** puts a lock on that link, so only your Worker
(which holds the key) can use your Mac's model.

## 1. Pick the model (5 min)

| Mac mini memory | Model | Notes |
|---|---|---|
| 32 GB or more | Qwen 3.8 27B (4-bit) | ~24 GB in memory; check it is fast enough (step 4) |
| 96 GB or more | Qwen 3.8-Flash-Next | needs ~75 GB; usually faster per word |
| 16–24 GB | a smaller Qwen | 27B won't fit next to macOS |

Check memory: Apple menu → About This Mac.

## 2. Install Ollama and the model (15 min, mostly download)

1. Download Ollama for macOS from ollama.com and open it once (it runs in the menu bar).
2. In Terminal, pull the model. Find the exact name on the Ollama library page for Qwen 3.8; it looks
   like `qwen3.8:27b`. Then:
   ```
   ollama pull qwen3.8:27b
   ollama list            # copy the NAME column exactly; it goes into wrangler.toml
   ```
3. Keep the model loaded and allow two chats at once (a demo has several students):
   ```
   launchctl setenv OLLAMA_KEEP_ALIVE -1
   launchctl setenv OLLAMA_NUM_PARALLEL 2
   ```
   Quit Ollama from the menu bar and open it again so it picks these up.
4. Stop the Mac from sleeping during the demo: System Settings → Energy → turn on
   "Prevent automatic sleeping when the display is off".

## 3. Check the speed before anything else (5 min)

In the project folder on the Mac:
```
npm install
LLM_MODEL=qwen3.8:27b npm run bench:local
```
It sends five sample Thai messages with the real system prompt and prints the seconds per reply.
**Every line must say `ok`** (under 24 s, run it twice because the first load is slow). If you see
`TOO SLOW`, use a smaller or faster model. If you see `FAILED`, the model didn't return the required
JSON; try another model tag. Read the Thai replies too: this is your first quality check.

## 4. Create the tunnel and the lock (20 min)

You need a domain added to your Cloudflare account (a cheap one is fine) for a fixed address.

1. Cloudflare dashboard → **Zero Trust** → Networks → **Tunnels** → Create a tunnel →
   *Cloudflared* → name it `mac-mini-llm`. Follow the macOS install command it shows
   (`brew install cloudflared`, then the `sudo cloudflared service install …` line it gives you).
2. In the tunnel's **Public hostname** tab: subdomain `llm`, your domain, service type `HTTP`,
   URL `localhost:11434`. Under *Additional settings → HTTP Settings*, set **HTTP Host Header** to
   `localhost:11434` (Ollama refuses other host names).
3. Zero Trust → Access → **Service credentials** → Service Tokens → Create. Name it
   `line-worker`. It shows a **Client ID** and **Client Secret** once: keep that page open for step 5.
   Do not paste them into any chat.
4. Zero Trust → Access → **Applications** → Add → Self-hosted → domain `llm.<your-domain>`. Add a
   policy with action **Service Auth** and include **Service Token = line-worker**. Save.
5. Check the lock works: opening `https://llm.<your-domain>/api/tags` in a browser should show a
   Cloudflare login page, not a list of models.

For a quick test without a domain, `cloudflared tunnel --url http://localhost:11434` prints a
`*.trycloudflare.com` address. It has no lock and changes every restart, so don't use it for the demo.

## 5. Tell the Worker where the model is (5 min)

1. In `wrangler.toml` → `[vars]`: set `LLM_BASE_URL = "https://llm.<your-domain>"` and
   `LLM_MODEL` to the name from `ollama list`. Set `LLM_PROVIDER = "local"`.
2. Store the two token values at hidden prompts (paste when asked; nothing shows on screen):
   ```
   npx wrangler secret put LLM_ACCESS_CLIENT_ID
   npx wrangler secret put LLM_ACCESS_CLIENT_SECRET
   ```
   Skip `ANTHROPIC_API_KEY` in SETUP.md step 7.
3. Continue with SETUP.md step 8 (deploy) and the phone tests in step 10.

## When something goes wrong

`npx wrangler tail` shows one line per problem, never message text:

| Log line | Meaning | Fix |
|---|---|---|
| `local_not_configured` | `LLM_BASE_URL` is empty | set it in `wrangler.toml`, deploy |
| `local_error TypeError` | address wrong or still `REPLACE_WITH_TUNNEL_URL` | fix `LLM_BASE_URL` |
| `local_http_error 403` | Access lock refused the Worker | re-enter both `LLM_ACCESS_*` secrets; check the policy is *Service Auth* |
| `local_http_error 530` / `502` | tunnel up but Mac or Ollama down | wake the Mac, open Ollama, check `cloudflared` is running |
| `local_http_error 404` | model name not found | copy the exact name from `ollama list` |
| `local_error TimeoutError` | reply took over `LLM_TIMEOUT_MS` | smaller/faster model, or fewer students at once |
| `local_bad_done_reason length` / `local_schema_mismatch` | model ran out of room or broke the JSON | try another model tag |

## Switching back to Claude

Set `LLM_PROVIDER = "anthropic"` in `wrangler.toml`, store `ANTHROPIC_API_KEY` (SETUP.md steps 5 and
7), and deploy. Nothing else changes.
