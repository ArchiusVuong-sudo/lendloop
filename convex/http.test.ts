import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import { signedHeaders } from "./lib/hmac";
import { DRILL, setupConvex, signIn, TEST_SECRETS, type TestConvex } from "./test.setup";

// Convex time only moves forward, so each test starts on Mar 1 and moves ahead.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-01T12:00:00Z"));
  vi.stubEnv("LENDLOOP_CONVEX_API_SECRET", TEST_SECRETS.convexApi);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function post(t: TestConvex, path: string, payload: unknown, secret = TEST_SECRETS.convexApi) {
  const body = JSON.stringify(payload);
  const headers = await signedHeaders(secret, { method: "POST", path, body });
  return t.fetch(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
}

/** An approved loan that ended two days ago. */
async function overdueLoan(t: TestConvex) {
  const owner = await signIn(t, "Ana");
  const borrower = await signIn(t, "Ben");
  const toolId = await owner.as.mutation(api.tools.create, DRILL);
  const requestId = await borrower.as.mutation(api.requests.create, {
    toolId,
    startDate: "2026-03-02",
    endDate: "2026-03-08",
  });
  await owner.as.mutation(api.requests.approve, { requestId });
  vi.setSystemTime(new Date("2026-03-10T12:00:00Z"));
  return { owner, borrower, requestId };
}

async function activityRows(t: TestConvex) {
  return t.run((ctx) => ctx.db.query("activity").collect());
}

describe("signed endpoints", () => {
  it("rejects unsigned, tampered, wrong-secret and stale calls with 401", async () => {
    const t = setupConvex();
    const path = "/automation/overdue";

    const unsigned = await t.fetch(path, { method: "POST", body: "{}" });
    expect(unsigned.status).toBe(401);
    expect(await unsigned.json()).toMatchObject({ reason: "missing_headers" });

    const headers = await signedHeaders(TEST_SECRETS.convexApi, { method: "POST", path, body: "{}" });
    const tampered = await t.fetch(path, { method: "POST", headers, body: '{"x":1}' });
    expect(tampered.status).toBe(401);
    expect(await tampered.json()).toMatchObject({ reason: "bad_signature" });

    expect((await post(t, path, {}, "not-the-secret")).status).toBe(401);

    const old = await signedHeaders(TEST_SECRETS.convexApi, {
      method: "POST",
      path,
      body: "{}",
      nowMs: Date.now() - 10 * 60_000,
    });
    const stale = await t.fetch(path, { method: "POST", headers: old, body: "{}" });
    expect(stale.status).toBe(401);
    expect(await stale.json()).toMatchObject({ reason: "stale" });
  });

  it("answers 500 instead of trusting anyone when the secret is not configured", async () => {
    const t = setupConvex();
    vi.stubEnv("LENDLOOP_CONVEX_API_SECRET", "");
    expect((await post(t, "/automation/overdue", {})).status).toBe(500);
  });
});

describe("overdue reminders", () => {
  it("lists overdue loans with only the fields a reminder needs", async () => {
    const t = setupConvex();
    const { requestId } = await overdueLoan(t);
    const res = await post(t, "/automation/overdue", {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      asOf: "2026-03-10",
      loans: [
        {
          requestId,
          toolName: "Cordless drill",
          endDate: "2026-03-08",
          daysOverdue: 2,
          borrower: { clerkUserId: "user_ben", displayName: "Ben" },
        },
      ],
    });
  });

  it("write-back is idempotent per loan per day, and the loan leaves today's list", async () => {
    const t = setupConvex();
    const { borrower, requestId } = await overdueLoan(t);

    const first = await post(t, "/automation/reminders", { requestId, day: "2026-03-10" });
    expect(await first.json()).toMatchObject({ status: "recorded" });
    const retry = await post(t, "/automation/reminders", { requestId, day: "2026-03-10" });
    expect(await retry.json()).toMatchObject({ status: "duplicate" });
    expect(await activityRows(t)).toHaveLength(1);

    // A second daily run the same day has nothing left to remind.
    expect((await (await post(t, "/automation/overdue", {})).json()).loans).toEqual([]);

    // The next day gets its own reminder.
    vi.setSystemTime(new Date("2026-03-11T08:00:00Z"));
    expect(await (await post(t, "/automation/reminders", { requestId, day: "2026-03-11" })).json()).toMatchObject({
      status: "recorded",
    });
    expect(await activityRows(t)).toHaveLength(2);

    // The borrower sees it on the loan ("Reminder sent ... ago").
    const [loan] = await borrower.as.query(api.requests.mine, {});
    expect(loan.overdue).toBe(true);
    expect(loan.activity[0].summary).toMatch(/Overdue reminder sent/);
  });

  it("rejects unknown loans and days outside today or yesterday", async () => {
    const t = setupConvex();
    const { requestId } = await overdueLoan(t);
    expect((await post(t, "/automation/reminders", { requestId: "nope", day: "2026-03-10" })).status).toBe(404);
    expect((await post(t, "/automation/reminders", { requestId, day: "2026-03-01" })).status).toBe(422);
    expect((await post(t, "/automation/reminders", { requestId })).status).toBe(400);
  });
});

describe("notification and failure write-backs", () => {
  it("records one activity row per notification event", async () => {
    const t = setupConvex();
    await overdueLoan(t);
    const [event] = await t.run((ctx) => ctx.db.query("notifications").collect());

    for (const expected of ["recorded", "duplicate", "duplicate"]) {
      const res = await post(t, "/automation/notifications", { eventId: event._id });
      expect(await res.json()).toMatchObject({ status: expected });
    }
    const rows = await activityRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "notification", summary: "Owner notified of the request" });
    expect((await post(t, "/automation/notifications", { eventId: "missing" })).status).toBe(404);
  });

  it("records each failed n8n execution once and shows it to admins", async () => {
    const t = setupConvex();
    const admin = await signIn(t, "Ada", "admin");
    const failure = { executionId: "42", workflowName: "LendLoop - overdue reminders", nodeName: "Fetch", message: "boom" };
    expect(await (await post(t, "/automation/failures", failure)).json()).toEqual({ status: "recorded" });
    expect(await (await post(t, "/automation/failures", failure)).json()).toEqual({ status: "duplicate" });
    const health = await admin.as.query(api.admin.automationHealth, {});
    expect(health.failures).toHaveLength(1);
    expect(health.failures[0]).toMatchObject({ workflowName: failure.workflowName, message: "boom" });
  });
});
