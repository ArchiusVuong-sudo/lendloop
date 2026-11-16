// Signed HTTP endpoints for n8n. Every call must carry a fresh HMAC signature made with
// LENDLOOP_CONVEX_API_SECRET over timestamp, method, path and the raw body (see lib/hmac.ts).
import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction, type ActionCtx } from "./_generated/server";
import { utcDay } from "./lib/dates";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from "./lib/hmac";

type Json = Record<string, unknown>;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function str(body: Json, key: string, max = 200): string | null {
  const value = body[key];
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}

/** Wraps a handler with signature verification and JSON parsing. */
function signed(handler: (ctx: ActionCtx, body: Json) => Promise<Response>) {
  return httpAction(async (ctx, request) => {
    const secret = process.env.LENDLOOP_CONVEX_API_SECRET;
    if (!secret) return json(500, { error: "server_not_configured" });

    const raw = await request.text();
    if (raw.length > 10_000) return json(413, { error: "body_too_large" });
    const result = await verifySignature(secret, {
      timestamp: request.headers.get(TIMESTAMP_HEADER),
      signature: request.headers.get(SIGNATURE_HEADER),
      method: request.method,
      path: new URL(request.url).pathname,
      body: raw,
    });
    if (!result.ok) {
      console.warn(`Rejected ${request.method} ${new URL(request.url).pathname}: ${result.reason}`);
      return json(401, { error: "invalid_signature", reason: result.reason });
    }

    let body: unknown;
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return json(400, { error: "invalid_json" });
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return json(400, { error: "invalid_body" });
    }
    return handler(ctx, body as Json);
  });
}

const http = httpRouter();

// Daily reminder run: which loans are overdue and still need today's reminder. n8n asks again while hasMore.
http.route({
  path: "/automation/overdue",
  method: "POST",
  handler: signed(async (ctx) => {
    const asOf = utcDay(Date.now());
    const { loans, hasMore } = await ctx.runQuery(internal.automation.overdueLoans, { asOf });
    return json(200, { asOf, loans, hasMore });
  }),
});

// Write-back: a reminder was sent. Idempotent per loan per day.
http.route({
  path: "/automation/reminders",
  method: "POST",
  handler: signed(async (ctx, body) => {
    const requestId = str(body, "requestId");
    const day = str(body, "day", 10);
    if (!requestId || !day) return json(400, { error: "requestId and day are required" });
    const result = await ctx.runMutation(internal.automation.recordReminder, { requestId, day });
    if (result.status === "not_found") return json(404, result);
    if (result.status === "invalid_day") return json(422, result);
    return json(200, result);
  }),
});

// Write-back: a request notification was sent. Idempotent per event.
http.route({
  path: "/automation/notifications",
  method: "POST",
  handler: signed(async (ctx, body) => {
    const eventId = str(body, "eventId");
    if (!eventId) return json(400, { error: "eventId is required" });
    const result = await ctx.runMutation(internal.automation.recordNotification, { eventId });
    return json(result.status === "not_found" ? 404 : 200, result);
  }),
});

// The n8n error workflow reports failed executions here. Idempotent per execution.
http.route({
  path: "/automation/failures",
  method: "POST",
  handler: signed(async (ctx, body) => {
    const executionId = str(body, "executionId", 64);
    const workflowName = str(body, "workflowName", 500);
    const message = str(body, "message", 5_000);
    if (!executionId || !workflowName || !message) {
      return json(400, { error: "executionId, workflowName and message are required" });
    }
    const nodeName = str(body, "nodeName", 500) ?? undefined;
    const result = await ctx.runMutation(internal.automation.recordFailure, {
      executionId,
      workflowName,
      nodeName,
      message,
    });
    return json(200, result);
  }),
});

export default http;
