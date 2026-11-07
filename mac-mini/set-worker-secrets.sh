#!/bin/sh
# Gives the gate's two secrets to the Cloudflare Worker without showing them on screen.
# Run from the repo folder after `sh mac-mini/start.sh` has created mac-mini/.env (Cloudflare login needed).
set -eu
cd "$(dirname "$0")/.."
[ -f mac-mini/.env ] || { echo "mac-mini/.env is missing: run sh mac-mini/start.sh first"; exit 1; }
set -a
. mac-mini/.env
set +a
printf '%s' "$GATE_CLIENT_ID" | npx wrangler secret put LLM_ACCESS_CLIENT_ID
printf '%s' "$GATE_CLIENT_SECRET" | npx wrangler secret put LLM_ACCESS_CLIENT_SECRET
echo "Done. The Worker now sends these two values to the gate."
