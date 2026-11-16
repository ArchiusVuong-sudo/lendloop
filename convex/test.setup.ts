/// <reference types="vite/client" />
// Shared helpers for convex-test. The double dot keeps Convex from deploying this file.
import { convexTest } from "convex-test";
import { api, internal } from "./_generated/api";
import schema from "./schema";

export const modules = import.meta.glob([
  "./**/*.ts",
  "./_generated/*.js",
  "!./**/*.test.ts",
  "!./**/*.d.ts",
  "!./test.setup.ts",
]);

export const TEST_SECRETS = {
  webhook: "test-webhook-secret-convex-to-n8n",
  convexApi: "test-api-secret-n8n-to-convex",
};

export function setupConvex() {
  return convexTest(schema, modules);
}

export type TestConvex = ReturnType<typeof setupConvex>;

/** Signs a user in (as Clerk would) and registers them, optionally promoting to admin. */
export async function signIn(t: TestConvex, name: string, role: "user" | "admin" = "user") {
  const clerkUserId = `user_${name.toLowerCase()}`;
  const as = t.withIdentity({ subject: clerkUserId, tokenIdentifier: `test|${clerkUserId}`, givenName: name });
  const userId = await as.mutation(api.users.ensure, {});
  if (role === "admin") await t.mutation(internal.users.setRole, { clerkUserId, role });
  return { as, userId, clerkUserId };
}

export const DRILL = {
  name: "Cordless drill",
  category: "power_tools",
  condition: "good",
  description: "18V, two batteries.",
} as const;
