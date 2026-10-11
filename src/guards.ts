export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Error class name only (never the message, which could contain secrets or text). */
export function errName(err: unknown): string {
  return err instanceof Error ? err.name : "unknown";
}
