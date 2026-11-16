// Internal functions behind the signed HTTP endpoints that n8n calls (see http.ts).
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { addDays, daysBetween, utcDay } from "./lib/dates";

const OVERDUE_BATCH = 100;

function reminderKey(requestId: string, day: string) {
  return `reminder:${requestId}:${day}`;
}

const NOTIFICATION_SUMMARY: Record<Doc<"notifications">["event"], string> = {
  "request.created": "Owner notified of the request",
  "request.approved": "Borrower notified: approved",
  "request.declined": "Borrower notified: declined",
  "request.cancelled": "Owner notified: cancelled",
  "request.returned": "Borrower notified: marked returned",
};

/**
 * Up to OVERDUE_BATCH approved loans past their end date that have no reminder for `asOf` yet.
 * Reminded loans are skipped before the batch fills, so `hasMore` callers can page until done.
 */
export const overdueLoans = internalQuery({
  args: { asOf: v.string() },
  handler: async (ctx, { asOf }) => {
    const overdue = ctx.db
      .query("requests")
      .withIndex("by_status_end", (q) => q.eq("status", "approved").lt("endDate", asOf));
    const out = [];
    let hasMore = false;
    for await (const loan of overdue) {
      const alreadyReminded = await ctx.db
        .query("activity")
        .withIndex("by_key", (q) => q.eq("idempotencyKey", reminderKey(loan._id, asOf)))
        .unique();
      if (alreadyReminded) continue;
      const [tool, borrower] = await Promise.all([ctx.db.get(loan.toolId), ctx.db.get(loan.borrowerId)]);
      if (!tool || !borrower) continue;
      if (out.length === OVERDUE_BATCH) {
        hasMore = true;
        break;
      }
      out.push({
        requestId: loan._id,
        toolName: tool.name,
        endDate: loan.endDate,
        daysOverdue: daysBetween(loan.endDate, asOf),
        borrower: { clerkUserId: borrower.clerkUserId, displayName: borrower.displayName },
      });
    }
    return { loans: out, hasMore };
  },
});

/** Idempotent: one reminder row per loan per day, however often n8n retries. */
export const recordReminder = internalMutation({
  args: { requestId: v.string(), day: v.string() },
  handler: async (ctx, { requestId, day }) => {
    const id = ctx.db.normalizeId("requests", requestId);
    const loan = id ? await ctx.db.get(id) : null;
    if (!loan) return { status: "not_found" as const };
    const today = utcDay(Date.now());
    // Accept today or yesterday (a run that started just before midnight UTC).
    if (day !== today && day !== addDays(today, -1)) return { status: "invalid_day" as const };

    const idempotencyKey = reminderKey(loan._id, day);
    const existing = await ctx.db
      .query("activity")
      .withIndex("by_key", (q) => q.eq("idempotencyKey", idempotencyKey))
      .unique();
    if (existing) return { status: "duplicate" as const, idempotencyKey };
    const overdueDays = Math.max(daysBetween(loan.endDate, day), 0);
    await ctx.db.insert("activity", {
      requestId: loan._id,
      kind: "reminder",
      idempotencyKey,
      summary: `Overdue reminder sent to borrower (${overdueDays} day${overdueDays === 1 ? "" : "s"} late)`,
      at: Date.now(),
    });
    return { status: "recorded" as const, idempotencyKey };
  },
});

/** Idempotent per event: n8n confirms it sent the notification for one outbox event. */
export const recordNotification = internalMutation({
  args: { eventId: v.string() },
  handler: async (ctx, { eventId }) => {
    const id = ctx.db.normalizeId("notifications", eventId);
    const notification = id ? await ctx.db.get(id) : null;
    if (!notification) return { status: "not_found" as const };

    const idempotencyKey = `notification:${notification._id}`;
    const existing = await ctx.db
      .query("activity")
      .withIndex("by_key", (q) => q.eq("idempotencyKey", idempotencyKey))
      .unique();
    if (existing) return { status: "duplicate" as const, idempotencyKey };
    await ctx.db.insert("activity", {
      requestId: notification.requestId,
      kind: "notification",
      idempotencyKey,
      summary: NOTIFICATION_SUMMARY[notification.event],
      at: Date.now(),
    });
    return { status: "recorded" as const, idempotencyKey };
  },
});

/** Called by the n8n error workflow. Idempotent per n8n execution id. */
export const recordFailure = internalMutation({
  args: {
    executionId: v.string(),
    workflowName: v.string(),
    nodeName: v.optional(v.string()),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("automationFailures")
      .withIndex("by_execution", (q) => q.eq("executionId", args.executionId))
      .unique();
    if (existing) return { status: "duplicate" as const };
    await ctx.db.insert("automationFailures", {
      executionId: args.executionId.slice(0, 64),
      workflowName: args.workflowName.slice(0, 120),
      nodeName: args.nodeName?.slice(0, 120),
      message: args.message.slice(0, 500),
      at: Date.now(),
    });
    return { status: "recorded" as const };
  },
});
