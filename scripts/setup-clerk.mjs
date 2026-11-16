// One-time local setup: create the "convex" JWT template on the Clerk dev instance and
// point the Convex deployment at its issuer. Reads keys from .env.local, never prints them.
import { execFileSync } from "node:child_process";
import { clerkIssuerFromPublishableKey, loadEnvFile, requireEnv } from "./env.mjs";

const env = loadEnvFile();
const secretKey = requireEnv(env, "CLERK_SECRET_KEY");
const issuer = clerkIssuerFromPublishableKey(requireEnv(env, "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"));

// Data minimization: the token carries only the audience and a first name for display.
const template = {
  name: "convex",
  claims: { aud: "convex", given_name: "{{user.first_name}}" },
  lifetime: 60,
  allowed_clock_skew: 5,
};

async function clerk(path, init = {}) {
  const res = await fetch(`https://api.clerk.com/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`Clerk API ${init.method ?? "GET"} ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

const existing = (await clerk("/jwt_templates")).find((t) => t.name === template.name);
if (existing) {
  await clerk(`/jwt_templates/${existing.id}`, { method: "PATCH", body: JSON.stringify(template) });
  console.log("Updated Clerk JWT template 'convex'");
} else {
  await clerk("/jwt_templates", { method: "POST", body: JSON.stringify(template) });
  console.log("Created Clerk JWT template 'convex'");
}

execFileSync("npx", ["convex", "env", "set", "CLERK_JWT_ISSUER_DOMAIN", issuer], { stdio: "inherit" });
console.log(`Convex now trusts tokens from ${issuer}`);
