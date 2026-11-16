import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { appError, requireAdmin } from "./lib/auth";
import { describeRequest } from "./lib/loans";

/** Every loan and request, for moderation. */
export const allLoans = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db.query("requests").order("desc").take(200);
    const now = Date.now();
    return Promise.all(rows.map((r) => describeRequest(ctx, r, now)));
  },
});

/** People who list tools, with their Trusted Lender flag. */
export const lenders = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").order("desc").take(200);
    const out = [];
    for (const user of users) {
      const tools = await ctx.db
        .query("tools")
        .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
        .collect();
      if (tools.length === 0) continue;
      out.push({
        _id: user._id,
        displayName: user.displayName,
        trustedLender: user.trustedLender,
        listings: tools.length,
      });
    }
    return out;
  },
});

export const setTrustedLender = mutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, { userId, trusted }) => {
    await requireAdmin(ctx);
    const user = await ctx.db.get(userId);
    if (!user) throw appError("NOT_FOUND", "That user no longer exists.");
    await ctx.db.patch(userId, { trustedLender: trusted });
  },
});

/** Automation health: failed n8n runs and webhook deliveries that ran out of retries. */
export const automationHealth = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const failures = await ctx.db.query("automationFailures").order("desc").take(20);
    const undelivered = await ctx.db
      .query("notifications")
      .withIndex("by_status", (q) => q.eq("status", "failed"))
      .order("desc")
      .take(20);
    return {
      failures: failures.map((f) => ({
        _id: f._id,
        workflowName: f.workflowName,
        nodeName: f.nodeName ?? null,
        message: f.message,
        at: f.at,
      })),
      undeliveredNotifications: undelivered.map((n) => ({
        _id: n._id,
        event: n.event,
        attempts: n.attempts,
        lastError: n.lastError ?? null,
      })),
    };
  },
});
