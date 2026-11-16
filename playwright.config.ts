import { defineConfig, devices } from "@playwright/test";

// Runs against the live local stack: Convex (npx convex dev), Next.js on 3417 and n8n on 5698.
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global.setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3417",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3417",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
