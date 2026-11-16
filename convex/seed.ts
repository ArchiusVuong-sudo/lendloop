// Local demo data. Internal only: run with `npx convex run seed:demo` (needs deployment access).
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Category, Condition } from "./lib/constants";
import { addDays, utcDay } from "./lib/dates";

async function demoUser(ctx: MutationCtx, key: string, displayName: string): Promise<Id<"users">> {
  const tokenIdentifier = `seed|${key}`;
  const existing = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", tokenIdentifier))
    .unique();
  if (existing) return existing._id;
  return ctx.db.insert("users", {
    tokenIdentifier,
    clerkUserId: `seed_${key}`,
    displayName,
    role: "user",
    trustedLender: false,
  });
}

const DEMO_TOOLS: { name: string; category: Category; condition: Condition; description: string }[] = [
  { name: "Cordless drill", category: "power_tools", condition: "good", description: "18V with two batteries and a bit set." },
  { name: "Hedge trimmer", category: "garden", condition: "fair", description: "Electric, 50 cm blade. Extension cord included." },
  { name: "Stand mixer", category: "kitchen", condition: "like_new", description: "5 L bowl, whisk and dough hook." },
  { name: "Two-person tent", category: "camping", condition: "good", description: "Packs small, fine for summer trips." },
  { name: "Pressure washer", category: "cleaning", condition: "good", description: "Great for decks and bikes." },
  { name: "Socket set", category: "hand_tools", condition: "worn", description: "Metric and imperial, a few sockets missing." },
];

/** Adds demo neighbors, tools and one overdue loan. Safe to run twice. */
export const demo = internalMutation({
  args: {},
  handler: async (ctx) => {
    const sam = await demoUser(ctx, "sam", "Sam");
    const priya = await demoUser(ctx, "priya", "Priya");
    const existing = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", sam))
      .first();
    if (existing) return { status: "already_seeded" };

    const toolIds: Id<"tools">[] = [];
    for (const [i, tool] of DEMO_TOOLS.entries()) {
      toolIds.push(await ctx.db.insert("tools", { ...tool, ownerId: i % 2 === 0 ? sam : priya }));
    }
    const today = utcDay(Date.now());
    await ctx.db.insert("requests", {
      toolId: toolIds[1],
      ownerId: priya,
      borrowerId: sam,
      startDate: addDays(today, -6),
      endDate: addDays(today, -2),
      status: "approved",
      decidedAt: Date.now(),
    });
    return { status: "seeded", tools: toolIds.length };
  },
});

/** A fresh overdue loan between the demo neighbors, for exercising the reminder workflow. */
export const overdueLoan = internalMutation({
  args: {},
  handler: async (ctx) => {
    const sam = await demoUser(ctx, "sam", "Sam");
    const priya = await demoUser(ctx, "priya", "Priya");
    const toolId = await ctx.db.insert("tools", {
      ownerId: priya,
      name: "Wheelbarrow",
      category: "garden",
      condition: "good",
      description: "Demo tool for the overdue reminder run.",
    });
    const today = utcDay(Date.now());
    const requestId = await ctx.db.insert("requests", {
      toolId,
      ownerId: priya,
      borrowerId: sam,
      startDate: addDays(today, -5),
      endDate: addDays(today, -1),
      status: "approved",
      decidedAt: Date.now(),
    });
    return { requestId, toolId };
  },
});
