const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Constant-time comparison of two strings (compares every byte of the expected value). */
function safeEqual(expected: string, given: string): boolean {
  const a = encoder.encode(expected);
  const b = encoder.encode(given);
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** LINE signature = base64(HMAC-SHA256(raw body, channel secret)). */
export async function verifySignature(
  rawBody: Uint8Array,
  channelSecret: string,
  header: string | null,
): Promise<boolean> {
  if (!header || !channelSecret) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(channelSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, rawBody));
  return safeEqual(toBase64(mac), header);
}
