export interface Env {
  DB: D1Database;
  // vars (wrangler.toml)
  LLM_PROVIDER?: string; // "local" (Qwen via Ollama) or "anthropic" (default when unset)
  LLM_BASE_URL?: string; // tunnel address of the Mac's Ollama, e.g. https://llm.example.com
  LLM_MODEL?: string;
  LLM_TIMEOUT_MS?: string;
  CLAUDE_MODEL?: string;
  USER_MSG_LIMIT?: string;
  USER_WINDOW_SECONDS?: string;
  USER_DAILY_LIMIT?: string;
  DAILY_CLAUDE_CAP?: string;
  // secrets
  LINE_CHANNEL_SECRET: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  ANTHROPIC_API_KEY?: string; // only needed when LLM_PROVIDER is not "local"
  LLM_ACCESS_CLIENT_ID?: string; // Cloudflare Access service token for the tunnel
  LLM_ACCESS_CLIENT_SECRET?: string;
  SHEETS_WEBHOOK_URL?: string;
  SHEETS_TOKEN?: string;
}
