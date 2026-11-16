import { describe, expect, it } from "vitest";
import { SIGNATURE_HEADER, signedHeaders, TIMESTAMP_HEADER, verifySignature } from "./hmac";

const SECRET = "unit-test-secret";
const NOW = Date.UTC(2026, 2, 10, 12, 0, 0);
const req = { method: "POST", path: "/automation/reminders", body: '{"requestId":"r1","day":"2026-03-10"}' };

async function signedRequest(overrides: { secret?: string; nowMs?: number } = {}) {
  const headers = await signedHeaders(overrides.secret ?? SECRET, { ...req, nowMs: overrides.nowMs ?? NOW });
  return { timestamp: headers[TIMESTAMP_HEADER], signature: headers[SIGNATURE_HEADER] };
}

describe("HMAC request signing", () => {
  it("accepts a fresh, untouched request", async () => {
    const h = await signedRequest();
    expect(h.signature).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(await verifySignature(SECRET, { ...h, ...req }, { nowMs: NOW + 30_000 })).toEqual({ ok: true });
  });

  it("rejects a tampered body", async () => {
    const h = await signedRequest();
    const body = req.body.replace("2026-03-10", "2026-03-11");
    expect(await verifySignature(SECRET, { ...h, ...req, body }, { nowMs: NOW })).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects a tampered signature", async () => {
    const h = await signedRequest();
    const flipped = h.signature.slice(0, -1) + (h.signature.endsWith("0") ? "1" : "0");
    expect(await verifySignature(SECRET, { ...h, signature: flipped, ...req }, { nowMs: NOW })).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects a signature made with another secret", async () => {
    const h = await signedRequest({ secret: "someone-else" });
    expect((await verifySignature(SECRET, { ...h, ...req }, { nowMs: NOW })).ok).toBe(false);
  });

  it("binds the signature to the endpoint", async () => {
    const h = await signedRequest();
    const other = { ...h, ...req, path: "/automation/failures" };
    expect(await verifySignature(SECRET, other, { nowMs: NOW })).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects stale and future timestamps outside the 5 minute window", async () => {
    const h = await signedRequest();
    expect(await verifySignature(SECRET, { ...h, ...req }, { nowMs: NOW + 301_000 })).toEqual({
      ok: false,
      reason: "stale",
    });
    expect(await verifySignature(SECRET, { ...h, ...req }, { nowMs: NOW - 301_000 })).toEqual({
      ok: false,
      reason: "stale",
    });
  });

  it("rejects a replayed signature with a refreshed timestamp", async () => {
    const h = await signedRequest();
    const fresh = String(Number(h.timestamp) + 600);
    expect(await verifySignature(SECRET, { ...h, timestamp: fresh, ...req }, { nowMs: NOW + 600_000 })).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects missing and malformed headers", async () => {
    expect(await verifySignature(SECRET, { timestamp: null, signature: null, ...req })).toEqual({
      ok: false,
      reason: "missing_headers",
    });
    const h = await signedRequest();
    for (const signature of ["abc", h.signature.replace("v1=", "v2="), `v1=${"g".repeat(64)}`]) {
      expect(await verifySignature(SECRET, { ...h, signature, ...req }, { nowMs: NOW })).toEqual({
        ok: false,
        reason: "malformed",
      });
    }
    expect(await verifySignature(SECRET, { ...h, timestamp: "12abc", ...req }, { nowMs: NOW })).toEqual({
      ok: false,
      reason: "malformed",
    });
  });
});
