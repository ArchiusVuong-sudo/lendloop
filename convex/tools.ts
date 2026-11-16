import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { appError, requireViewer } from "./lib/auth";
import { LIMITS } from "./lib/constants";
import { approvedLoans, availabilityOf, deleteToolCascade } from "./lib/loans";
import { categoryValidator, conditionValidator } from "./lib/validators";

const PUBLIC_LIST_LIMIT = 200;

function cleanListing(input: { name: string; description: string }) {
  const name = input.name.trim().replace(/\s+/g, " ");
  const description = input.description.trim();
  if (name.length < LIMITS.toolName.min || name.length > LIMITS.toolName.max) {
    throw appError("INVALID", `Name must be ${LIMITS.toolName.min} to ${LIMITS.toolName.max} characters.`);
  }
  if (description.length > LIMITS.description.max) {
    throw appError("INVALID", `Description must be at most ${LIMITS.description.max} characters.`);
  }
  return { name, description };
}

/** Public, no sign-in: tools free to borrow right now, name and category only. */
export const listPublic = query({
  args: {},
  handler: async (ctx) => {
    const tools = await ctx.db.query("tools").order("desc").take(PUBLIC_LIST_LIMIT);
    const now = Date.now();
    const out: { name: string; category: Doc<"tools">["category"] }[] = [];
    for (const tool of tools) {
      const availability = await availabilityOf(ctx, tool._id, now);
      if (availability.status !== "on_loan") out.push({ name: tool.name, category: tool.category });
    }
    return out;
  },
});

/** Signed-in board: every tool with its availability, optionally one category. */
export const list = query({
  args: { category: v.optional(categoryValidator) },
  handler: async (ctx, { category }) => {
    const viewer = await requireViewer(ctx);
    const tools = category
      ? await ctx.db
          .query("tools")
          .withIndex("by_category", (q) => q.eq("category", category))
          .order("desc")
          .take(PUBLIC_LIST_LIMIT)
      : await ctx.db.query("tools").order("desc").take(PUBLIC_LIST_LIMIT);
    const now = Date.now();
    return Promise.all(
      tools.map(async (tool) => {
        const owner = await ctx.db.get(tool.ownerId);
        const myPending = await ctx.db
          .query("requests")
          .withIndex("by_tool_status", (q) => q.eq("toolId", tool._id).eq("status", "pending"))
          .filter((q) => q.eq(q.field("borrowerId"), viewer._id))
          .first();
        return {
          _id: tool._id,
          name: tool.name,
          category: tool.category,
          condition: tool.condition,
          description: tool.description,
          ownerName: owner?.displayName ?? "Neighbor",
          ownerTrusted: owner?.trustedLender ?? false,
          isMine: tool.ownerId === viewer._id,
          hasPendingRequest: myPending !== null,
          availability: await availabilityOf(ctx, tool._id, now),
        };
      }),
    );
  },
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireViewer(ctx);
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", viewer._id))
      .order("desc")
      .collect();
    const now = Date.now();
    return Promise.all(
      tools.map(async (tool) => {
        const pending = await ctx.db
          .query("requests")
          .withIndex("by_tool_status", (q) => q.eq("toolId", tool._id).eq("status", "pending"))
          .collect();
        return {
          _id: tool._id,
          name: tool.name,
          category: tool.category,
          condition: tool.condition,
          description: tool.description,
          pendingRequests: pending.length,
          availability: await availabilityOf(ctx, tool._id, now),
        };
      }),
    );
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    category: categoryValidator,
    condition: conditionValidator,
    description: v.string(),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const { name, description } = cleanListing(args);
    return ctx.db.insert("tools", {
      ownerId: viewer._id,
      name,
      description,
      category: args.category,
      condition: args.condition,
    });
  },
});

export const update = mutation({
  args: {
    toolId: v.id("tools"),
    name: v.string(),
    category: categoryValidator,
    condition: conditionValidator,
    description: v.string(),
  },
  handler: async (ctx, { toolId, ...args }) => {
    const viewer = await requireViewer(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool) throw appError("NOT_FOUND", "That listing no longer exists.");
    if (tool.ownerId !== viewer._id) throw appError("FORBIDDEN", "You can only edit your own listings.");
    const { name, description } = cleanListing(args);
    await ctx.db.patch(toolId, { name, description, category: args.category, condition: args.condition });
  },
});

/** Owners delete their own listing (not while it is lent out); admins can remove any listing. */
export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const viewer = await requireViewer(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool) throw appError("NOT_FOUND", "That listing no longer exists.");
    const isOwner = tool.ownerId === viewer._id;
    if (!isOwner && viewer.role !== "admin") {
      throw appError("FORBIDDEN", "You can only delete your own listings.");
    }
    if (isOwner && viewer.role !== "admin" && (await approvedLoans(ctx, toolId)).length > 0) {
      throw appError("CONFLICT", "This tool has an approved loan. Mark it returned before deleting.");
    }
    await deleteToolCascade(ctx, toolId);
  },
});
