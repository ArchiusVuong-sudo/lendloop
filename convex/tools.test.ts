import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import { DRILL, setupConvex, signIn } from "./test.setup";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-10T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("listings and roles", () => {
  it("requires sign-in to list a tool", async () => {
    const t = setupConvex();
    await expect(t.mutation(api.tools.create, DRILL)).rejects.toThrow(/sign in/i);
  });

  it("public list shows only name and category, and hides tools on loan", async () => {
    const t = setupConvex();
    const ana = await signIn(t, "Ana");
    const ben = await signIn(t, "Ben");
    const drill = await ana.as.mutation(api.tools.create, DRILL);
    await ana.as.mutation(api.tools.create, { ...DRILL, name: "Rake", category: "garden" });

    const before = await t.query(api.tools.listPublic, {});
    expect(before).toHaveLength(2);
    for (const row of before) expect(Object.keys(row).sort()).toEqual(["category", "name"]);

    const requestId = await ben.as.mutation(api.requests.create, {
      toolId: drill,
      startDate: "2026-03-10",
      endDate: "2026-03-12",
    });
    await ana.as.mutation(api.requests.approve, { requestId });
    expect(await t.query(api.tools.listPublic, {})).toEqual([{ name: "Rake", category: "garden" }]);
  });

  it("users can edit and delete only their own listings", async () => {
    const t = setupConvex();
    const ana = await signIn(t, "Ana");
    const ben = await signIn(t, "Ben");
    const toolId = await ana.as.mutation(api.tools.create, DRILL);

    await expect(ben.as.mutation(api.tools.update, { toolId, ...DRILL, name: "Mine now" })).rejects.toThrow(
      /your own listings/,
    );
    await expect(ben.as.mutation(api.tools.remove, { toolId })).rejects.toThrow(/your own listings/);

    await ana.as.mutation(api.tools.update, { toolId, ...DRILL, name: "Impact drill" });
    expect((await ana.as.query(api.tools.mine, {}))[0].name).toBe("Impact drill");
    await ana.as.mutation(api.tools.remove, { toolId });
    expect(await ana.as.query(api.tools.mine, {})).toEqual([]);
  });

  it("an owner cannot delete a listing while it is lent out, an admin can remove any listing", async () => {
    const t = setupConvex();
    const ana = await signIn(t, "Ana");
    const ben = await signIn(t, "Ben");
    const admin = await signIn(t, "Ada", "admin");
    const toolId = await ana.as.mutation(api.tools.create, DRILL);
    const requestId = await ben.as.mutation(api.requests.create, {
      toolId,
      startDate: "2026-03-10",
      endDate: "2026-03-11",
    });
    await ana.as.mutation(api.requests.approve, { requestId });

    await expect(ana.as.mutation(api.tools.remove, { toolId })).rejects.toThrow(/approved loan/);
    await admin.as.mutation(api.tools.remove, { toolId });
    expect(await t.query(api.tools.listPublic, {})).toEqual([]);
    // The cascade leaves no request behind.
    expect(await ben.as.query(api.requests.mine, {})).toEqual([]);
  });

  it("validates listing fields on the server", async () => {
    const t = setupConvex();
    const ana = await signIn(t, "Ana");
    await expect(ana.as.mutation(api.tools.create, { ...DRILL, name: " x " })).rejects.toThrow(/Name must be/);
    await expect(ana.as.mutation(api.tools.create, { ...DRILL, description: "a".repeat(281) })).rejects.toThrow(
      /Description/,
    );
  });

  it("the signed-in board filters by category and shows availability and Trusted Lender", async () => {
    const t = setupConvex();
    const ana = await signIn(t, "Ana");
    const ben = await signIn(t, "Ben");
    const admin = await signIn(t, "Ada", "admin");
    await ana.as.mutation(api.tools.create, DRILL);
    await ana.as.mutation(api.tools.create, { ...DRILL, name: "Tent", category: "camping" });
    await admin.as.mutation(api.admin.setTrustedLender, { userId: ana.userId, trusted: true });

    const camping = await ben.as.query(api.tools.list, { category: "camping" });
    expect(camping.map((tool) => tool.name)).toEqual(["Tent"]);
    expect(camping[0]).toMatchObject({ ownerName: "Ana", ownerTrusted: true, isMine: false });
    expect(camping[0].availability).toEqual({ status: "available" });
  });
});

describe("admin-only functions", () => {
  it("rejects normal users and signed-out callers", async () => {
    const t = setupConvex();
    const ben = await signIn(t, "Ben");
    await expect(ben.as.query(api.admin.allLoans, {})).rejects.toThrow(/Only admins/);
    await expect(ben.as.query(api.admin.lenders, {})).rejects.toThrow(/Only admins/);
    await expect(ben.as.query(api.admin.automationHealth, {})).rejects.toThrow(/Only admins/);
    await expect(
      ben.as.mutation(api.admin.setTrustedLender, { userId: ben.userId, trusted: true }),
    ).rejects.toThrow(/Only admins/);
    await expect(t.query(api.admin.allLoans, {})).rejects.toThrow(/sign in/i);
  });

  it("new users always start as role user", async () => {
    const t = setupConvex();
    const ben = await signIn(t, "Ben");
    expect(await ben.as.query(api.users.me, {})).toMatchObject({ role: "user", trustedLender: false });
  });

  it("admins see every loan and can mark a Trusted Lender", async () => {
    const t = setupConvex();
    const ana = await signIn(t, "Ana");
    const ben = await signIn(t, "Ben");
    const admin = await signIn(t, "Ada", "admin");
    const toolId = await ana.as.mutation(api.tools.create, DRILL);
    await ben.as.mutation(api.requests.create, { toolId, startDate: "2026-03-11", endDate: "2026-03-12" });

    const loans = await admin.as.query(api.admin.allLoans, {});
    expect(loans).toHaveLength(1);
    expect(loans[0]).toMatchObject({ ownerName: "Ana", borrowerName: "Ben", status: "pending" });

    await admin.as.mutation(api.admin.setTrustedLender, { userId: ana.userId, trusted: true });
    expect(await admin.as.query(api.admin.lenders, {})).toEqual([
      expect.objectContaining({ displayName: "Ana", trustedLender: true, listings: 1 }),
    ]);
  });
});
