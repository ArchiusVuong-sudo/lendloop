import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { loadEnvFile } from "../scripts/env.mjs";

export type TestUser = { key: string; firstName: string; email: string };

// Clerk dev instances accept "+clerk_test" emails with the fixed code 424242, no inbox needed.
export const USERS = {
  lender: { key: "lender", firstName: "Lena", email: "lendloop-lena+clerk_test@example.com" },
  borrower: { key: "borrower", firstName: "Bo", email: "lendloop-bo+clerk_test@example.com" },
  admin: { key: "admin", firstName: "Ada", email: "lendloop-ada+clerk_test@example.com" },
} satisfies Record<string, TestUser>;

export const N8N_URL = process.env.E2E_N8N_URL ?? "http://127.0.0.1:5698";
export const N8N_CONTAINER = process.env.N8N_CONTAINER ?? "lendloop-n8n";

/** Clerk user ids written by global setup, keyed by USERS key. */
export function clerkIds(): Record<string, string> {
  return JSON.parse(process.env.E2E_CLERK_IDS ?? "{}");
}

export function convexRun<T = unknown>(fn: string, args: object = {}, identity?: object): T {
  const argv = ["convex", "run", fn, JSON.stringify(args)];
  if (identity) argv.push("--identity", JSON.stringify(identity));
  const out = execFileSync("npx", argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(out.trim() || "null") as T;
}

export function convexTable<T = Record<string, unknown>>(table: string, limit = 50): T[] {
  const out = execFileSync("npx", ["convex", "data", table, "--format", "jsonArray", "--limit", String(limit)], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out) as T[];
}

/** Runs a workflow once through the n8n CLI (a second task-broker port, since n8n itself is running). */
export function n8nExecute(workflowId: string): string {
  return execFileSync(
    process.env.DOCKER_BIN ?? "docker",
    ["exec", "-e", "N8N_RUNNERS_BROKER_PORT=5681", N8N_CONTAINER, "n8n", "execute", `--id=${workflowId}`],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 20 * 1024 * 1024 },
  );
}

const n8nEnv = () => loadEnvFile("n8n/.env");

export function sign(secret: string, method: string, path: string, body: string, timestamp = Math.floor(Date.now() / 1000)) {
  const ts = String(timestamp);
  const mac = createHmac("sha256", secret).update(`${ts}.${method}.${path}.${body}`).digest("hex");
  return { "x-lendloop-timestamp": ts, "x-lendloop-signature": `v1=${mac}` };
}

/** Signs like Convex does when it calls the n8n webhook. */
export function signAsConvex(path: string, body: string, timestamp?: number) {
  return sign(n8nEnv().LENDLOOP_WEBHOOK_SECRET, "POST", path, body, timestamp);
}

/** Signs like n8n does when it calls Convex. */
export function signAsN8n(path: string, body: string, timestamp?: number) {
  return sign(n8nEnv().LENDLOOP_CONVEX_API_SECRET, "POST", path, body, timestamp);
}

export function convexSiteUrl(): string {
  const url = loadEnvFile(".env.local").NEXT_PUBLIC_CONVEX_SITE_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_SITE_URL missing in .env.local");
  return url;
}
