export interface Env {
  DB: D1Database;
  // vars (wrangler.toml)
  LLM_PROVIDER?: string; // "gemini", "hybrid" (Mac mini first, Gemini backup), "local" or "anthropic" (default)
  GEMINI_MODEL?: string;
  GEMINI_THINKING_LEVEL?: string; // "low" by default; "minimal" where the model supports it
  GEMINI_FALLBACK_MODEL?: string; // backup model on overload or timeout; "none" = retry the main model instead
  GEMINI_FALLBACK_THINKING?: string;
  LLM_BASE_URL?: string; // tunnel address of the Mac mini's gate, e.g. https://xyz.trycloudflare.com
  LLM_MODEL?: string;
  LLM_TIMEOUT_MS?: string;
  CLAUDE_MODEL?: string;
  USER_MSG_LIMIT?: string;
  USER_WINDOW_SECONDS?: string;
  USER_DAILY_LIMIT?: string;
  DAILY_CLAUDE_CAP?: string;
  LIFF_ID?: string; // LINE web app id (not a secret)
  FDA_NOTIFICATION_NO?: string; // Thai FDA cosmetic notification; with PROMPTPAY_ID set, the web app sells (src/checkout.ts)
  PROMPTPAY_ID?: string; // shop PromptPay phone or tax id for the payment QR
  LINE_LOGIN_CHANNEL_ID?: string; // LINE Login channel that owns the LIFF app; ID tokens are checked against it
  // secrets
  LINE_CHANNEL_SECRET: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  ANTHROPIC_API_KEY?: string; // only needed when LLM_PROVIDER is "anthropic" (or unset)
  GEMINI_API_KEY?: string; // needed when LLM_PROVIDER is "gemini" or "hybrid"
  LLM_ACCESS_CLIENT_ID?: string; // shared secret pair the Mac mini gate checks
  LLM_ACCESS_CLIENT_SECRET?: string;
  SHEETS_WEBHOOK_URL?: string;
  SHEETS_TOKEN?: string;
}
