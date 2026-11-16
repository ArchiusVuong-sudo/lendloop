import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { NotificationEvent, RequestStatus } from "./constants";
import { appError } from "./auth";
import { utcDay } from "./dates";

// The request state machine. Anything not listed is rejected.
//   pending  -> approved | declined (owner) | cancelled (borrower)
//   approved -> returned (owner)
const TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  pending: ["approved", "declined", "cancelled"],
  approved: ["returned"],
  declined: [],
  cancelled: [],
  returned: [],
};

export function assertTransition(from: RequestStatus, to: RequestStatus) {
  if (!TRANSITIONS[from].includes(to)) {
    throw appError("CONFLICT", `A ${from} request cannot be marked ${to}.`);
  }
}

export type Availability =
  | { status: "available" }
  | { status: "reserved"; from: string }
  | { status: "on_loan"; until: string };

export async function approvedLoans(ctx: QueryCtx, toolId: Id<"tools">) {
  return ctx.db
    .query("requests")
    .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "approved"))
    .collect();
}

/** Availability today: on loan if an approved loan has started, reserved if one is coming up. */
export async function availabilityOf(ctx: QueryCtx, toolId: Id<"tools">, nowMs: number): Promise<Availability> {
  const today = utcDay(nowMs);
  const loans = await approvedLoans(ctx, toolId);
  const current = loans.find((l) => l.startDate <= today);
  if (current) return { status: "on_loan", until: current.endDate };
  const next = loans.map((l) => l.startDate).sort()[0];
  return next ? { status: "reserved", from: next } : { status: "available" };
}

export function isOverdue(request: Doc<"requests">, nowMs: number): boolean {
  return request.status === "approved" && request.endDate < utcDay(nowMs);
}

/** Queue an event for the n8n notification webhook. Delivery runs in an action with retries. */
export async function enqueueNotification(
  ctx: MutationCtx,
  request: Doc<"requests">,
  event: NotificationEvent,
) {
  const recipientId =
    event === "request.created" || event === "request.cancelled" ? request.ownerId : request.borrowerId;
  const notificationId = await ctx.db.insert("notifications", {
    requestId: request._id,
    event,
    recipientId,
    status: "pending",
    attempts: 0,
  });
  await ctx.scheduler.runAfter(0, internal.notifications.deliver, { notificationId });
}

/** Recent automation activity for a loan, newest first (the "Reminder sent 2 days ago" line). */
export async function recentActivity(ctx: QueryCtx, requestId: Id<"requests">, limit = 3) {
  const rows = await ctx.db
    .query("activity")
    .withIndex("by_request", (q) => q.eq("requestId", requestId))
    .order("desc")
    .take(limit);
  return rows.map((a) => ({ kind: a.kind, summary: a.summary, at: a.at }));
}

/** Deletes a tool and everything hanging off it, so no orphaned personal data stays behind. */
export async function deleteToolCascade(ctx: MutationCtx, toolId: Id<"tools">) {
  const requests = await ctx.db
    .query("requests")
    .withIndex("by_tool_status", (q) => q.eq("toolId", toolId))
    .collect();
  for (const request of requests) {
    for (const table of ["notifications", "activity"] as const) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_request", (q) => q.eq("requestId", request._id))
        .collect();
      for (const row of rows) await ctx.db.delete(row._id);
    }
    await ctx.db.delete(request._id);
  }
  await ctx.db.delete(toolId);
}

/** A request as the UI shows it: names only, no contact details. */
export async function describeRequest(ctx: QueryCtx, request: Doc<"requests">, nowMs: number) {
  const [tool, owner, borrower] = await Promise.all([
    ctx.db.get(request.toolId),
    ctx.db.get(request.ownerId),
    ctx.db.get(request.borrowerId),
  ]);
  return {
    _id: request._id,
    toolName: tool?.name ?? "Removed listing",
    ownerName: owner?.displayName ?? "Neighbor",
    borrowerName: borrower?.displayName ?? "Neighbor",
    startDate: request.startDate,
    endDate: request.endDate,
    status: request.status,
    overdue: isOverdue(request, nowMs),
    requestedAt: request._creationTime,
    activity: await recentActivity(ctx, request._id),
  };
}
