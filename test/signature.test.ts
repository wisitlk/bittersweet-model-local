import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifySignature } from "../src/signature";

const secret = "test-channel-secret";
const body = new TextEncoder().encode(JSON.stringify({ destination: "U1", events: [] }));
const good = createHmac("sha256", secret).update(body).digest("base64");

describe("verifySignature", () => {
  it("accepts the correct signature", async () => {
    expect(await verifySignature(body, secret, good)).toBe(true);
  });

  it("rejects a signature made with another secret", async () => {
    const other = createHmac("sha256", "wrong").update(body).digest("base64");
    expect(await verifySignature(body, secret, other)).toBe(false);
  });

  it("rejects when the body was changed after signing", async () => {
    const tampered = new TextEncoder().encode(JSON.stringify({ destination: "U1", events: [{}] }));
    expect(await verifySignature(tampered, secret, good)).toBe(false);
  });

  it("rejects a missing, empty or truncated header", async () => {
    expect(await verifySignature(body, secret, null)).toBe(false);
    expect(await verifySignature(body, secret, "")).toBe(false);
    expect(await verifySignature(body, secret, good.slice(0, -2))).toBe(false);
  });

  it("rejects everything when the secret is not configured", async () => {
    expect(await verifySignature(body, "", good)).toBe(false);
  });
});
