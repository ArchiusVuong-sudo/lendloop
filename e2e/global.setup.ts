import { clerkSetup } from "@clerk/testing/playwright";
import { loadEnvFile } from "../scripts/env.mjs";
import { USERS } from "./helpers";

/** Gets a Clerk testing token and makes sure the three test users exist on the dev instance. */
export default async function globalSetup() {
  const env = loadEnvFile(".env.local");
  const secretKey = process.env.CLERK_SECRET_KEY ?? env.CLERK_SECRET_KEY;
  const publishableKey = process.env.CLERK_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!secretKey || !publishableKey) throw new Error("Clerk keys missing: run `npx clerk init` (see README)");
  process.env.CLERK_SECRET_KEY = secretKey;
  process.env.CLERK_PUBLISHABLE_KEY = publishableKey;
  await clerkSetup();

  const api = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`https://api.clerk.com/v1${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`Clerk ${path}: ${res.status} ${await res.text()}`);
    return res.json();
  };

  const ids: Record<string, string> = {};
  for (const user of Object.values(USERS)) {
    const found = await api(`/users?email_address=${encodeURIComponent(user.email)}`);
    const existing = found[0];
    ids[user.key] = existing
      ? existing.id
      : (
          await api("/users", {
            method: "POST",
            body: JSON.stringify({
              email_address: [user.email],
              first_name: user.firstName,
              skip_password_requirement: true,
            }),
          })
        ).id;
  }
  process.env.E2E_CLERK_IDS = JSON.stringify(ids);
}
