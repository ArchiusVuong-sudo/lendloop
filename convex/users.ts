import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { appError, getViewer } from "./lib/auth";
import { roleValidator } from "./lib/validators";

const FALLBACK_NAME = "Neighbor";

/** Creates or refreshes the caller's row from their Clerk token. New users always get role "user". */
export const ensure = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw appError("UNAUTHENTICATED", "Please sign in.");
    const displayName = (identity.givenName ?? "").trim().slice(0, 40) || FALLBACK_NAME;

    const existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (existing) {
      if (existing.displayName !== displayName) await ctx.db.patch(existing._id, { displayName });
      return existing._id;
    }
    return ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      clerkUserId: identity.subject,
      displayName,
      role: "user",
      trustedLender: false,
    });
  },
});

export const me = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewer(ctx);
    if (!viewer) return null;
    return {
      _id: viewer._id,
      displayName: viewer.displayName,
      role: viewer.role,
      trustedLender: viewer.trustedLender,
    };
  },
});

// Role changes are deliberately not exposed to clients. Run from the CLI (deployment admin only):
//   npx convex run users:list
//   npx convex run users:setRole '{"clerkUserId":"user_...","role":"admin"}'
export const list = internalQuery({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").order("desc").take(50);
    return users.map((u) => ({
      clerkUserId: u.clerkUserId,
      displayName: u.displayName,
      role: u.role,
      createdAt: new Date(u._creationTime).toISOString(),
    }));
  },
});

export const setRole = internalMutation({
  args: { clerkUserId: v.string(), role: roleValidator },
  handler: async (ctx, { clerkUserId, role }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", clerkUserId))
      .unique();
    if (!user) throw appError("NOT_FOUND", "No user with that Clerk id has signed in yet.");
    await ctx.db.patch(user._id, { role });
    return { clerkUserId, role };
  },
});
