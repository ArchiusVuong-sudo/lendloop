// HMAC-SHA256 request signing shared by Convex (both directions) and the tests.
// Web Crypto only, so it runs in the Convex runtime, Node 22 and the edge test runtime.
//
// Signed string: `${timestamp}.${METHOD}.${path}.${rawBody}`
//   - the timestamp (unix seconds) bounds replay to a short window
//   - method and path bind a signature to one endpoint
// Headers: x-lendloop-timestamp: <unix seconds>, x-lendloop-signature: v1=<hex>
// The n8n Code nodes implement the same scheme with node:crypto.

export const TIMESTAMP_HEADER = "x-lendloop-timestamp";
export const SIGNATURE_HEADER = "x-lendloop-signature";
export const SIGNATURE_VERSION = "v1";
export const DEFAULT_TOLERANCE_SECONDS = 300;

export type SignedParts = {
  timestamp: string;
  method: string;
  path: string;
  body: string;
};

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "missing_headers" | "malformed" | "stale" | "bad_signature" };

const encoder = new TextEncoder();

export function canonicalString({ timestamp, method, path, body }: SignedParts): string {
  return `${timestamp}.${method.toUpperCase()}.${path}.${body}`;
}

async function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  if (!secret) throw new Error("HMAC secret is empty");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    usage,
  ]);
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[0-9a-f]{64}$/.test(hex)) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function signParts(secret: string, parts: SignedParts): Promise<string> {
  const key = await hmacKey(secret, "sign");
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(canonicalString(parts)));
  return `${SIGNATURE_VERSION}=${toHex(mac)}`;
}

/** Headers for an outgoing signed request. */
export async function signedHeaders(
  secret: string,
  { method, path, body, nowMs = Date.now() }: { method: string; path: string; body: string; nowMs?: number },
): Promise<Record<string, string>> {
  const timestamp = Math.floor(nowMs / 1000).toString();
  const signature = await signParts(secret, { timestamp, method, path, body });
  return { [TIMESTAMP_HEADER]: timestamp, [SIGNATURE_HEADER]: signature };
}

export async function verifySignature(
  secret: string,
  {
    timestamp,
    signature,
    method,
    path,
    body,
  }: { timestamp: string | null; signature: string | null; method: string; path: string; body: string },
  { nowMs = Date.now(), toleranceSeconds = DEFAULT_TOLERANCE_SECONDS } = {},
): Promise<VerifyResult> {
  if (!timestamp || !signature) return { ok: false, reason: "missing_headers" };
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: "malformed" };
  const prefix = `${SIGNATURE_VERSION}=`;
  const mac = signature.startsWith(prefix) ? fromHex(signature.slice(prefix.length)) : null;
  if (!mac) return { ok: false, reason: "malformed" };

  const ageSeconds = Math.abs(Math.floor(nowMs / 1000) - Number(timestamp));
  if (ageSeconds > toleranceSeconds) return { ok: false, reason: "stale" };

  // crypto.subtle.verify compares in constant time.
  const key = await hmacKey(secret, "verify");
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    mac,
    encoder.encode(canonicalString({ timestamp, method, path, body })),
  );
  return valid ? { ok: true } : { ok: false, reason: "bad_signature" };
}
