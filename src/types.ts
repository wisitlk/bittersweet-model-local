export interface Env {
  DB: D1Database;
  // vars (wrangler.toml)
  CLAUDE_MODEL?: string;
  USER_MSG_LIMIT?: string;
  USER_WINDOW_SECONDS?: string;
  USER_DAILY_LIMIT?: string;
  DAILY_CLAUDE_CAP?: string;
  // secrets
  LINE_CHANNEL_SECRET: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  ANTHROPIC_API_KEY: string;
  SHEETS_WEBHOOK_URL?: string;
  SHEETS_TOKEN?: string;
}
