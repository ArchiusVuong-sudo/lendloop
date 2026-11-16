import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  categoryValidator,
  conditionValidator,
  notificationEventValidator,
  requestStatusValidator,
  roleValidator,
} from "./lib/validators";

export default defineSchema({
  // Only what the app needs: the Clerk link, a first name to show, the role and the trusted flag.
  // No email, phone or address is stored; Clerk stays the source of truth for contact details.
  users: defineTable({
    tokenIdentifier: v.string(),
    clerkUserId: v.string(),
    displayName: v.string(),
    role: roleValidator,
    trustedLender: v.boolean(),
  })
    .index("by_token", ["tokenIdentifier"])
    .index("by_clerk_user", ["clerkUserId"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category: categoryValidator,
    condition: conditionValidator,
    description: v.string(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_category", ["category"]),

  // A borrow request; once approved it is the loan until it is returned.
  requests: defineTable({
    toolId: v.id("tools"),
    ownerId: v.id("users"),
    borrowerId: v.id("users"),
    startDate: v.string(),
    endDate: v.string(),
    status: requestStatusValidator,
    decidedAt: v.optional(v.number()),
    returnedAt: v.optional(v.number()),
  })
    .index("by_tool_status", ["toolId", "status"])
    .index("by_borrower", ["borrowerId"])
    .index("by_owner", ["ownerId"])
    .index("by_status_end", ["status", "endDate"]),

  // Outbox of request events for the n8n notification webhook, with delivery state for retries.
  notifications: defineTable({
    requestId: v.id("requests"),
    event: notificationEventValidator,
    recipientId: v.id("users"),
    status: v.union(v.literal("pending"), v.literal("delivered"), v.literal("failed")),
    attempts: v.number(),
    lastError: v.optional(v.string()),
    deliveredAt: v.optional(v.number()),
  })
    .index("by_request", ["requestId"])
    .index("by_status", ["status"]),

  // Write-backs from n8n. idempotencyKey is unique, so a retried or repeated call records once.
  activity: defineTable({
    requestId: v.id("requests"),
    kind: v.union(v.literal("notification"), v.literal("reminder")),
    idempotencyKey: v.string(),
    summary: v.string(),
    at: v.number(),
  })
    .index("by_key", ["idempotencyKey"])
    .index("by_request", ["requestId"]),

  // Failed n8n executions reported by the error workflow, shown to admins.
  automationFailures: defineTable({
    executionId: v.string(),
    workflowName: v.string(),
    nodeName: v.optional(v.string()),
    message: v.string(),
    at: v.number(),
  }).index("by_execution", ["executionId"]),
});
