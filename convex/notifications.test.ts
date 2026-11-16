import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "./lib/hmac";
import { DRILL, setupConvex, signIn, TEST_SECRETS, type TestConvex } from "./test.setup";

const WEBHOOK_URL = "http://n8n.test/webhook/lendloop-request-events";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-10T12:00:00Z"));
  vi.stubEnv("N8N_WEBHOOK_URL", WEBHOOK_URL);
  vi.stubEnv("LENDLOOP_WEBHOOK_SECRET", TEST_SECRETS.webhook);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function createRequest(t: TestConvex) {
  const owner = await signIn(t, "Ana");
  const borrower = await signIn(t, "Ben");
  const toolId = await owner.as.mutation(api.tools.create, DRILL);
  await borrower.as.mutation(api.requests.create, { toolId, startDate: "2026-03-11", endDate: "2026-03-12" });
}

describe("request notifications to n8n", () => {
  it("sends a signed, minimal payload and marks it delivered", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response("{}", { status: 202 });
      }),
    );
    const t = setupConvex();
    await createRequest(t);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toBe(WEBHOOK_URL);
    const headers = init.headers as Record<string, string>;
    const body = init.body as string;
    expect(
      await verifySignature(TEST_SECRETS.webhook, {
        timestamp: headers[TIMESTAMP_HEADER],
        signature: headers[SIGNATURE_HEADER],
        method: "POST",
        path: "/webhook/lendloop-request-events",
        body,
      }),
    ).toEqual({ ok: true });

    const payload = JSON.parse(body);
    expect(Object.keys(payload).sort()).toEqual(["eventId", "occurredAt", "recipient", "request", "tool", "type"]);
    expect(payload).toMatchObject({
      type: "request.created",
      request: { status: "pending", startDate: "2026-03-11", endDate: "2026-03-12" },
      tool: { name: "Cordless drill" },
      recipient: { clerkUserId: "user_ana", displayName: "Ana", relation: "owner" },
    });
    expect(Object.keys(payload.tool)).toEqual(["name"]);
    expect(body).not.toMatch(/@|description|borrowerName/);

    const [row] = await t.run((ctx) => ctx.db.query("notifications").collect());
    expect(row).toMatchObject({ status: "delivered", attempts: 1 });
  });

  it("retries with backoff, then gives up visibly", async () => {
    const fetchMock = vi.fn(async () => new Response("down", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const t = setupConvex();
    const admin = await signIn(t, "Ada", "admin");
    await createRequest(t);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(fetchMock).toHaveBeenCalledTimes(5);
    const [row] = await t.run((ctx) => ctx.db.query("notifications").collect());
    expect(row).toMatchObject({ status: "failed", attempts: 5, lastError: "n8n answered HTTP 503" });
    const health = await admin.as.query(api.admin.automationHealth, {});
    expect(health.undeliveredNotifications).toHaveLength(1);
  });

  it("does not call out when the webhook is not configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("N8N_WEBHOOK_URL", "");
    const t = setupConvex();
    await createRequest(t);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetchMock).not.toHaveBeenCalled();
    const [row] = await t.run((ctx) => ctx.db.query("notifications").collect());
    expect(row.status).toBe("failed");
  });
});
