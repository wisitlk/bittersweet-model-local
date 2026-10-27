export interface Env {
  DB: D1Database;
  // vars (wrangler.toml)
  LLM_PROVIDER?: string; // "gemini", "local" (Qwen via Ollama) or "anthropic" (default when unset)
  GEMINI_MODEL?: string;
  GEMINI_THINKING_LEVEL?: string; // "low" by default; "minimal" where the model supports it
  LLM_BASE_URL?: string; // tunnel address of the Mac's Ollama, e.g. https://llm.example.com
  LLM_MODEL?: string;
  LLM_TIMEOUT_MS?: string;
  CLAUDE_MODEL?: string;
  USER_MSG_LIMIT?: string;
  USER_WINDOW_SECONDS?: string;
  USER_DAILY_LIMIT?: string;
  DAILY_CLAUDE_CAP?: string;
  LIFF_ID?: string; // LINE web app id (not a secret)
  LINE_LOGIN_CHANNEL_ID?: string; // LINE Login channel that owns the LIFF app; ID tokens are checked against it
  // secrets
  LINE_CHANNEL_SECRET: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  ANTHROPIC_API_KEY?: string; // only needed when LLM_PROVIDER is "anthropic" (or unset)
  GEMINI_API_KEY?: string; // only needed when LLM_PROVIDER is "gemini"
  LLM_ACCESS_CLIENT_ID?: string; // Cloudflare Access service token for the tunnel
  LLM_ACCESS_CLIENT_SECRET?: string;
  SHEETS_WEBHOOK_URL?: string;
  SHEETS_TOKEN?: string;
}
