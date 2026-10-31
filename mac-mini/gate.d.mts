import type { Server } from "node:http";

export function createGate(opts: {
  clientId: string | undefined;
  clientSecret: string | undefined;
  upstream: string;
  maxConcurrent?: number;
  timeoutMs?: number;
  log?: (line: string) => void;
}): Server;
