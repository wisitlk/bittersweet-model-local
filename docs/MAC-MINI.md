# Gemma on the Mac mini, Gemini as backup ("hybrid")

The bot asks Gemma 4 on your own Mac mini first. If the Mac mini is off, asleep, busy or slower than 9 s, the
Worker asks Gemini instead (main model, then the Flash-Lite backup), so students still get an answer.

```
LINE → Cloudflare Worker ──HTTPS + 2 secret headers──▶ quick tunnel ──▶ gate (port 11435) ──▶ Ollama app (Gemma)
                     └──── if no good answer in 9 s  ──▶ Gemini API
```

- A **tunnel** (`cloudflared`) lets the Worker reach a program on the Mac without opening your router. It only
  makes outgoing connections.
- The **gate** (`mac-mini/gate.mjs`) is a small lock: it lets through only chat requests that carry the two secrets
  the Worker holds. Nobody else can use, download or delete your models through the tunnel.
- A **quick tunnel** gets a new `https://….trycloudflare.com` address every time it starts, so after a restart you
  paste the new address into `wrangler.toml` and deploy again. (A named tunnel with your own domain keeps one
  address; not needed for the demo.)

Tested target: Apple M4 Mac mini, 16 GB or more. The Ollama **app** uses the Mac's GPU (Metal); Docker on a Mac
cannot, so do not run Gemma in Docker here.

## 1. Install Ollama and Gemma (one time)

1. Download Ollama for macOS from ollama.com, drag it to Applications and open it (a llama icon appears in the
   menu bar).
2. Terminal:
   ```
   ollama pull gemma4:e4b        # about 10 GB
   ollama list                   # the NAME must match LLM_MODEL in wrangler.toml
   launchctl setenv OLLAMA_KEEP_ALIVE -1      # keep the model loaded
   launchctl setenv OLLAMA_NUM_PARALLEL 2     # two students at once
   ```
   Quit Ollama from the menu bar and open it again so it picks these up.
3. System Settings → Energy: turn on "Prevent automatic sleeping when the display is off".
4. Install the tunnel and Node: `brew install cloudflared node` (Homebrew from brew.sh if missing).
   Do not install the `ollama` formula from Homebrew; use the app.

## 2. Get the code and check the speed

```
git clone https://github.com/wisitlk/bittersweet-model-local.git
cd bittersweet-model-local
npm install
npm run bench:local        # each reply should say "ok" (under 9 s); run twice, the first load is slower
```

## 3. Start the gate and the tunnel (each demo day)

```
sh mac-mini/start.sh
```

The first run creates `mac-mini/.env` with two random secrets (never shown). It prints `Tunnel address: https://….trycloudflare.com`.
Leave the window open.

## 4. Connect the Worker (first time, and after each restart of step 3)

1. First time only, in a second Terminal window in the repo folder (Cloudflare login needed, see SETUP.md):
   ```
   sh mac-mini/set-worker-secrets.sh
   ```
   It gives the two secrets to the Worker as `LLM_ACCESS_CLIENT_ID` and `LLM_ACCESS_CLIENT_SECRET`.
2. In `wrangler.toml` set `LLM_PROVIDER = "hybrid"` and `LLM_BASE_URL = "<the tunnel address>"`.
   `GEMINI_API_KEY` must already be set (it is the backup).
3. `npm run typecheck && npm test && npm run lint`, then `npm run deploy` (your call).
4. Check: send the bot a message in LINE, and watch `npx wrangler tail`. `hybrid_fallback_gemini` in the log
   means the Mac mini did not answer and Gemini did.

Optional: time the whole path through the tunnel from the Mac mini itself:
```
set -a; . mac-mini/.env; set +a
LLM_BASE_URL=https://<the tunnel address> npm run bench:local
```

## Turning it off

Stop `start.sh` with Ctrl+C: the bot keeps working on Gemini alone (each message first waits for the dead tunnel
to fail, usually under a second). To skip the Mac mini completely, set `LLM_PROVIDER = "gemini"` and deploy.

## Limits

- Per message the Worker makes at most 3 model calls (Mac mini, Gemini, Flash-Lite) inside 23 s; see the budget
  comment in `src/handler.ts`.
- The gate allows 2 chats at a time (`GATE_MAX_CONCURRENT`); a third gets "busy" and goes to Gemini.
- Logs on the Mac show only status codes and times, never what students wrote.
