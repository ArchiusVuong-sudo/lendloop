// Tiny .env reader for local scripts, so they never need secrets on the command line.
import { existsSync, readFileSync } from "node:fs";

/** @returns {Record<string, string>} */
export function loadEnvFile(path = ".env.local") {
  if (!existsSync(path)) return {};
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

export function requireEnv(env, name) {
  const value = process.env[name] ?? env[name];
  if (!value) throw new Error(`${name} is missing (expected in .env.local)`);
  return value;
}

/** The Clerk Frontend API host is base64-encoded inside the publishable key. */
export function clerkIssuerFromPublishableKey(pk) {
  const encoded = pk.replace(/^pk_(test|live)_/, "");
  const host = Buffer.from(encoded, "base64").toString("utf8").replace(/\$$/, "");
  return `https://${host}`;
}
