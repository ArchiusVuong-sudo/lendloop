import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { appError, requireViewer } from "./lib/auth";
import { LIMITS } from "./lib/constants";
import { addDays, daysBetween, isIsoDay, rangesOverlap, utcDay } from "./lib/dates";
import { approvedLoans, assertTransition, describeRequest, enqueueNotification } from "./lib/loans";

async function loadRequest(ctx: QueryCtx, requestId: Id<"requests">) {
  const request = await ctx.db.get(requestId);
  if (!request) throw appError("NOT_FOUND", "That request no longer exists.");
  return request;
}

async function assertNoOverlap(ctx: QueryCtx, request: Pick<Doc<"requests">, "toolId" | "startDate" | "endDate">) {
  const clash = (await approvedLoans(ctx, request.toolId)).find((loan) =>
    rangesOverlap(loan.startDate, loan.endDate, request.startDate, request.endDate),
  );
  if (clash) {
    throw appError("CONFLICT", `The tool is already lent out from ${clash.startDate} to ${clash.endDate}.`);
  }
}

/** Ownership check, then the state machine, then the write and the n8n event. */
async function transition(
  ctx: MutationCtx,
  requestId: Id<"requests">,
  actor: "owner" | "borrower",
  to: "approved" | "declined" | "cancelled" | "returned",
) {
  const viewer = await requireViewer(ctx);
  const request = await loadRequest(ctx, requestId);
  const allowed = actor === "owner" ? request.ownerId === viewer._id : request.borrowerId === viewer._id;
  if (!allowed) {
    throw appError(
      "FORBIDDEN",
      actor === "owner" ? "Only the tool's owner can do this." : "Only the borrower can do this.",
    );
  }
  assertTransition(request.status, to);
  if (to === "approved") {
    // A request whose dates are over would become an overdue loan at once. Same one-day slack as create.
    if (request.endDate < addDays(utcDay(Date.now()), -1)) {
      throw appError("CONFLICT", "The requested dates have already passed.");
    }
    await assertNoOverlap(ctx, request);
  }

  const now = Date.now();
  await ctx.db.patch(requestId, {
    status: to,
    ...(to === "returned" ? { returnedAt: now } : { decidedAt: now }),
  });
  await enqueueNotification(ctx, { ...request, status: to }, `request.${to}`);
}

export const create = mutation({
  args: { toolId: v.id("tools"), startDate: v.string(), endDate: v.string() },
  handler: async (ctx, { toolId, startDate, endDate }) => {
    const viewer = await requireViewer(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool) throw appError("NOT_FOUND", "That listing no longer exists.");
    if (tool.ownerId === viewer._id) throw appError("FORBIDDEN", "You cannot borrow your own tool.");

    if (!isIsoDay(startDate) || !isIsoDay(endDate)) throw appError("INVALID", "Dates must be YYYY-MM-DD.");
    if (endDate < startDate) throw appError("INVALID", "The end date must be on or after the start date.");
    // One day of slack so a user behind UTC can still ask for "today".
    if (startDate < addDays(utcDay(Date.now()), -1)) throw appError("INVALID", "The start date is in the past.");
    if (daysBetween(startDate, endDate) + 1 > LIMITS.maxLoanDays) {
      throw appError("INVALID", `Loans can be at most ${LIMITS.maxLoanDays} days.`);
    }

    const duplicate = await ctx.db
      .query("requests")
      .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "pending"))
      .filter((q) => q.eq(q.field("borrowerId"), viewer._id))
      .first();
    if (duplicate) throw appError("CONFLICT", "You already have a pending request for this tool.");
    await assertNoOverlap(ctx, { toolId, startDate, endDate });

    const requestId = await ctx.db.insert("requests", {
      toolId,
      ownerId: tool.ownerId,
      borrowerId: viewer._id,
      startDate,
      endDate,
      status: "pending",
    });
    const request = (await ctx.db.get(requestId))!;
    await enqueueNotification(ctx, request, "request.created");
    return requestId;
  },
});

export const approve = mutation({
  args: { requestId: v.id("requests") },
  handler: (ctx, { requestId }) => transition(ctx, requestId, "owner", "approved"),
});

export const decline = mutation({
  args: { requestId: v.id("requests") },
  handler: (ctx, { requestId }) => transition(ctx, requestId, "owner", "declined"),
});

export const markReturned = mutation({
  args: { requestId: v.id("requests") },
  handler: (ctx, { requestId }) => transition(ctx, requestId, "owner", "returned"),
});

export const cancel = mutation({
  args: { requestId: v.id("requests") },
  handler: (ctx, { requestId }) => transition(ctx, requestId, "borrower", "cancelled"),
});

/** "My requests": what the caller asked to borrow. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireViewer(ctx);
    const rows = await ctx.db
      .query("requests")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", viewer._id))
      .order("desc")
      .take(100);
    const now = Date.now();
    return Promise.all(rows.map((r) => describeRequest(ctx, r, now)));
  },
});

/** "Incoming requests": requests on the caller's tools. */
export const incoming = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireViewer(ctx);
    const rows = await ctx.db
      .query("requests")
      .withIndex("by_owner", (q) => q.eq("ownerId", viewer._id))
      .order("desc")
      .take(100);
    const now = Date.now();
    return Promise.all(rows.map((r) => describeRequest(ctx, r, now)));
  },
});
