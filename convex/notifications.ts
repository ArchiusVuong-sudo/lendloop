import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { signedHeaders } from "./lib/hmac";

const MAX_ATTEMPTS = 5;
const REQUEST_TIMEOUT_MS = 10_000;

/** 5s, 25s, 2m, 10m between attempts. */
function backoffMs(attempt: number): number {
  return 5_000 * 5 ** (attempt - 1);
}

/**
 * The webhook body. Data minimization: only what a notifier needs to tell one person what
 * happened. No emails, no descriptions, nothing about the other party beyond the tool name.
 */
export const payloadFor = internalQuery({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, { notificationId }) => {
    const notification = await ctx.db.get(notificationId);
    if (!notification || notification.status !== "pending") return null;
    const request = await ctx.db.get(notification.requestId);
    const recipient = await ctx.db.get(notification.recipientId);
    if (!request || !recipient) return null;
    const tool = await ctx.db.get(request.toolId);
    return {
      eventId: notification._id,
      type: notification.event,
      occurredAt: new Date(notification._creationTime).toISOString(),
      request: {
        id: request._id,
        status: request.status,
        startDate: request.startDate,
        endDate: request.endDate,
      },
      tool: { name: tool?.name ?? "Removed listing" },
      recipient: {
        clerkUserId: recipient.clerkUserId,
        displayName: recipient.displayName,
        relation: recipient._id === request.ownerId ? "owner" : "borrower",
      },
    };
  },
});

/** Signs the payload and POSTs it to the n8n webhook. Failures are retried with backoff. */
export const deliver = internalAction({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, { notificationId }) => {
    const payload = await ctx.runQuery(internal.notifications.payloadFor, { notificationId });
    if (!payload) return;

    const url = process.env.N8N_WEBHOOK_URL;
    const secret = process.env.LENDLOOP_WEBHOOK_SECRET;
    let error: string | undefined;
    if (!url || !secret) {
      error = "N8N_WEBHOOK_URL or LENDLOOP_WEBHOOK_SECRET is not set";
    } else {
      const body = JSON.stringify(payload);
      const headers = await signedHeaders(secret, { method: "POST", path: new URL(url).pathname, body });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body,
          signal: controller.signal,
        });
        if (!res.ok) error = `n8n answered HTTP ${res.status}`;
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      } finally {
        clearTimeout(timer);
      }
    }
    await ctx.runMutation(internal.notifications.recordAttempt, { notificationId, error });
  },
});

export const recordAttempt = internalMutation({
  args: { notificationId: v.id("notifications"), error: v.optional(v.string()) },
  handler: async (ctx, { notificationId, error }) => {
    const notification = await ctx.db.get(notificationId);
    if (!notification) return;
    const attempts = notification.attempts + 1;
    if (!error) {
      await ctx.db.patch(notificationId, {
        status: "delivered",
        attempts,
        deliveredAt: Date.now(),
        lastError: undefined,
      });
      return;
    }
    const giveUp = attempts >= MAX_ATTEMPTS;
    await ctx.db.patch(notificationId, {
      status: giveUp ? "failed" : "pending",
      attempts,
      lastError: error.slice(0, 300),
    });
    if (giveUp) {
      console.error(`Notification ${notificationId} failed after ${attempts} attempts: ${error}`);
    } else {
      await ctx.scheduler.runAfter(backoffMs(attempts), internal.notifications.deliver, { notificationId });
    }
  },
});
