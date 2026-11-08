#!/bin/sh
# Starts the lock (gate) and a Cloudflare quick tunnel on the Mac mini, and prints the public address.
# Ollama (the app in the menu bar) must already be running. Stop everything with Ctrl+C.
# The first run creates mac-mini/.env with two random secrets; they are never printed.
set -eu
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  umask 077
  {
    echo "GATE_CLIENT_ID=$(openssl rand -hex 16)"
    echo "GATE_CLIENT_SECRET=$(openssl rand -hex 32)"
  } > .env
  echo "Created mac-mini/.env with new secrets. Give them to the Worker once: sh mac-mini/set-worker-secrets.sh"
fi
set -a
. ./.env
set +a

command -v cloudflared >/dev/null || { echo "cloudflared is missing: brew install cloudflared"; exit 1; }
curl -fsS http://127.0.0.1:11434/api/version >/dev/null || { echo "Ollama is not running: open the Ollama app first"; exit 1; }

node gate.mjs &
GATE=$!
LOG=$(mktemp)
cloudflared tunnel --no-autoupdate --url http://127.0.0.1:11435 >"$LOG" 2>&1 &
TUNNEL=$!
trap 'kill $GATE $TUNNEL 2>/dev/null; rm -f "$LOG"' EXIT INT TERM

url=""
for _ in $(seq 1 30); do
  url=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG" | head -1 || true)
  [ -n "$url" ] && break
  sleep 1
done
if [ -z "$url" ]; then echo "The tunnel did not start; its log:"; cat "$LOG"; exit 1; fi

echo
echo "Tunnel address: $url"
echo "Put it in wrangler.toml as LLM_BASE_URL, then deploy. It changes every time this script restarts."
echo "Leave this window open during the demo. Ctrl+C stops the gate and the tunnel."
wait $TUNNEL
