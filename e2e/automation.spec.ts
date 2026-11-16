import { expect, test } from "@playwright/test";
import {
  convexRun,
  convexSiteUrl,
  convexTable,
  N8N_URL,
  n8nExecute,
  sign,
  signAsConvex,
  signAsN8n,
} from "./helpers";

// Live checks of the n8n <-> Convex integration on the running local stack.
const WEBHOOK_PATH = "/webhook/lendloop-request-events";
// The demo borrower from seed.ts, as `npx convex run --identity` sees them.
const SAM = { issuer: "seed", subject: "sam" };

type Loan = { _id: string; activity: { kind: string; summary: string }[] };

function event(eventId: string) {
  return JSON.stringify({
    eventId,
    type: "request.created",
    occurredAt: new Date().toISOString(),
    request: { id: "live-check", status: "pending", startDate: "2026-12-01", endDate: "2026-12-02" },
    tool: { name: "Live check saw" },
    recipient: { clerkUserId: "user_live_check", displayName: "Live", relation: "owner" },
  });
}

test.describe.serial("n8n integration (live)", () => {
  test("n8n rejects unsigned, tampered, wrong-secret and stale webhook calls", async ({ request }) => {
    const body = event("unused");
    const post = (headers: Record<string, string>, data = body) =>
      request.post(`${N8N_URL}${WEBHOOK_PATH}`, { headers: { "content-type": "application/json", ...headers }, data });

    const unsigned = await post({});
    expect(unsigned.status()).toBe(401);
    expect(await unsigned.json()).toMatchObject({ reason: "missing_headers" });

    const tampered = await post(signAsConvex(WEBHOOK_PATH, body), body.replace("Live check saw", "Free laptop"));
    expect(tampered.status()).toBe(401);
    expect(await tampered.json()).toMatchObject({ reason: "bad_signature" });

    const wrongSecret = await post(sign("not-the-shared-secret", "POST", WEBHOOK_PATH, body));
    expect(wrongSecret.status()).toBe(401);
    expect(await wrongSecret.json()).toMatchObject({ reason: "bad_signature" });

    const stale = await post(signAsConvex(WEBHOOK_PATH, body, Math.floor(Date.now() / 1000) - 600));
    expect(stale.status()).toBe(401);
    expect(await stale.json()).toMatchObject({ reason: "stale" });
  });

  test("Convex rejects tampered and stale calls from n8n", async ({ request }) => {
    const url = `${convexSiteUrl()}/automation/overdue`;
    const tampered = await request.post(url, { headers: signAsN8n("/automation/overdue", "{}"), data: '{"all":true}' });
    expect(tampered.status()).toBe(401);
    const stale = await request.post(url, {
      headers: signAsN8n("/automation/overdue", "{}", Math.floor(Date.now() / 1000) - 600),
      data: "{}",
    });
    expect(stale.status()).toBe(401);
    expect(await stale.json()).toMatchObject({ reason: "stale" });
  });

  test("daily reminder run: one reminder per loan per day, even when run twice", async ({ request }) => {
    const { requestId } = convexRun<{ requestId: string }>("seed:overdueLoan");

    const first = n8nExecute("LendLoopOverdue1");
    expect(first).toContain("Execution was successful");
    expect(first).toMatch(/reminder to=seed_sam loan=/);

    const second = n8nExecute("LendLoopOverdue1");
    expect(second).toContain("Execution was successful");
    expect(second).not.toContain(`loan=${requestId}`);

    const reminders = () =>
      convexRun<Loan[]>("requests:mine", {}, SAM)
        .find((loan) => loan._id === requestId)!
        .activity.filter((a) => a.kind === "reminder");
    expect(reminders()).toHaveLength(1);
    expect(reminders()[0].summary).toMatch(/Overdue reminder sent to borrower/);

    // A retried write-back with the same loan and day is recorded once.
    const day = new Date().toISOString().slice(0, 10);
    const body = JSON.stringify({ requestId, day });
    const retry = await request.post(`${convexSiteUrl()}/automation/reminders`, {
      headers: { "content-type": "application/json", ...signAsN8n("/automation/reminders", body) },
      data: body,
    });
    expect(await retry.json()).toMatchObject({ status: "duplicate", idempotencyKey: `reminder:${requestId}:${day}` });
    expect(reminders()).toHaveLength(1);
  });

  test("a failed run reaches the error workflow and is recorded in Convex", async ({ request }) => {
    const started = Date.now();
    // Signed correctly, but the event does not exist, so the write-back to Convex fails after its retries.
    const body = event(`missing-${started}`);
    const res = await request.post(`${N8N_URL}${WEBHOOK_PATH}`, {
      headers: { "content-type": "application/json", ...signAsConvex(WEBHOOK_PATH, body) },
      data: body,
    });
    expect(res.status()).toBe(202);

    await expect
      .poll(
        () =>
          convexTable<{ workflowName: string; nodeName?: string; at: number }>("automationFailures", 10).find(
            (f) => f.at >= started && f.workflowName === "LendLoop - request notification",
          ),
        { timeout: 60_000, intervals: [3_000] },
      )
      .toMatchObject({ nodeName: "Record in Convex" });
  });
});
