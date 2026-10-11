import type { Env } from "../src/types";
import { createFakeD1 } from "./fakeD1";

/** A Worker env with a fresh fake D1 and dummy secrets (Sheets configured). */
export function makeEnv(over: Partial<Env> = {}): Env {
  return {
    DB: createFakeD1(),
    LINE_CHANNEL_SECRET: "s",
    LINE_CHANNEL_ACCESS_TOKEN: "tok",
    ANTHROPIC_API_KEY: "key",
    SHEETS_WEBHOOK_URL: "https://sheets.example/exec",
    SHEETS_TOKEN: "shared",
    ...over,
  };
}
