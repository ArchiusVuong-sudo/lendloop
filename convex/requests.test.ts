import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { DRILL, setupConvex, signIn, type TestConvex } from "./test.setup";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-10T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

async function scenario() {
  const t = setupConvex();
  const owner = await signIn(t, "Ana");
  const borrower = await signIn(t, "Ben");
  const stranger = await signIn(t, "Cleo");
  const toolId = await owner.as.mutation(api.tools.create, DRILL);
  const request = (startDate = "2026-03-11", endDate = "2026-03-13") =>
    borrower.as.mutation(api.requests.create, { toolId, startDate, endDate });
  return { t, owner, borrower, stranger, toolId, request };
}

async function statusOf(t: TestConvex, requestId: Id<"requests">) {
  return t.run(async (ctx) => (await ctx.db.get(requestId))?.status);
}

async function notifications(t: TestConvex) {
  return t.run(async (ctx) => {
    const rows = await ctx.db.query("notifications").collect();
    return Promise.all(
      rows.map(async (n) => ({ event: n.event, to: (await ctx.db.get(n.recipientId))?.displayName })),
    );
  });
}

describe("request state machine", () => {
  it("pending -> approved -> returned, with an n8n event for each step", async () => {
    const { t, owner, borrower, request } = await scenario();
    const requestId = await request();
    expect(await statusOf(t, requestId)).toBe("pending");

    await owner.as.mutation(api.requests.approve, { requestId });
    expect(await statusOf(t, requestId)).toBe("approved");
    expect((await borrower.as.query(api.tools.list, {}))[0].availability).toEqual({
      status: "reserved",
      from: "2026-03-11",
    });

    await owner.as.mutation(api.requests.markReturned, { requestId });
    expect(await statusOf(t, requestId)).toBe("returned");

    expect(await notifications(t)).toEqual([
      { event: "request.created", to: "Ana" },
      { event: "request.approved", to: "Ben" },
      { event: "request.returned", to: "Ben" },
    ]);
  });

  it("owner declines, borrower cancels", async () => {
    const { t, owner, borrower, request } = await scenario();
    const first = await request();
    await owner.as.mutation(api.requests.decline, { requestId: first });
    expect(await statusOf(t, first)).toBe("declined");

    const second = await request();
    await borrower.as.mutation(api.requests.cancel, { requestId: second });
    expect(await statusOf(t, second)).toBe("cancelled");
    expect((await notifications(t)).at(-1)).toEqual({ event: "request.cancelled", to: "Ana" });
  });

  it("rejects transitions the state machine does not allow", async () => {
    const { owner, borrower, request } = await scenario();
    const requestId = await request();
    await expect(owner.as.mutation(api.requests.markReturned, { requestId })).rejects.toThrow(
      /pending request cannot be marked returned/,
    );
    await owner.as.mutation(api.requests.decline, { requestId });
    await expect(owner.as.mutation(api.requests.approve, { requestId })).rejects.toThrow(
      /declined request cannot be marked approved/,
    );
    await expect(borrower.as.mutation(api.requests.cancel, { requestId })).rejects.toThrow(/cannot be marked/);
  });

  it("only the owner decides and only the borrower cancels", async () => {
    const { owner, borrower, stranger, request } = await scenario();
    const requestId = await request();
    for (const fn of [api.requests.approve, api.requests.decline, api.requests.markReturned]) {
      await expect(borrower.as.mutation(fn, { requestId })).rejects.toThrow(/Only the tool's owner/);
      await expect(stranger.as.mutation(fn, { requestId })).rejects.toThrow(/Only the tool's owner/);
    }
    await expect(owner.as.mutation(api.requests.cancel, { requestId })).rejects.toThrow(/Only the borrower/);
    await expect(stranger.as.mutation(api.requests.cancel, { requestId })).rejects.toThrow(/Only the borrower/);
  });

  it("users see only their own requests in My requests and Incoming", async () => {
    const { owner, borrower, stranger, request } = await scenario();
    await request();
    expect(await borrower.as.query(api.requests.mine, {})).toHaveLength(1);
    expect(await owner.as.query(api.requests.incoming, {})).toHaveLength(1);
    expect(await stranger.as.query(api.requests.mine, {})).toEqual([]);
    expect(await stranger.as.query(api.requests.incoming, {})).toEqual([]);
    expect(await owner.as.query(api.requests.mine, {})).toEqual([]);
  });

  it("validates who can borrow and which dates", async () => {
    const { owner, toolId, request } = await scenario();
    await expect(
      owner.as.mutation(api.requests.create, { toolId, startDate: "2026-03-11", endDate: "2026-03-12" }),
    ).rejects.toThrow(/your own tool/);
    await expect(request("2026-03-12", "2026-03-11")).rejects.toThrow(/end date/);
    await expect(request("2026-03-01", "2026-03-02")).rejects.toThrow(/in the past/);
    await expect(request("2026-03-11", "2026-05-01")).rejects.toThrow(/at most 30 days/);
    await expect(request("2026-02-30", "2026-03-02")).rejects.toThrow(/YYYY-MM-DD/);
    await request();
    await expect(request()).rejects.toThrow(/already have a pending request/);
  });

  it("never approves two loans that overlap", async () => {
    const { t, owner, stranger, toolId, request } = await scenario();
    const first = await request("2026-03-11", "2026-03-13");
    const second = await stranger.as.mutation(api.requests.create, {
      toolId,
      startDate: "2026-03-13",
      endDate: "2026-03-15",
    });
    await owner.as.mutation(api.requests.approve, { requestId: first });
    await expect(owner.as.mutation(api.requests.approve, { requestId: second })).rejects.toThrow(/already lent out/);
    expect(await statusOf(t, second)).toBe("pending");
  });
});
