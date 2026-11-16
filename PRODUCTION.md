# Running LendLoop in production

What I would change before real neighbors use it. The local setup favours zero accounts and one command per piece; production needs managed hosting, real secrets handling and someone being told when things break.

## Hosting

- **Next.js:** Vercel (or any Node host) with the production Clerk and Convex env vars. `proxy.ts` and the pages need no change.
- **Convex:** a production deployment (`npx convex deploy` from CI with a deploy key). Production gets its own env vars; dev and prod never share secrets or data.
- **n8n:** n8n Cloud, or self-hosted with Postgres instead of SQLite, queue mode (Redis + separate worker and webhook processes) so a slow run does not block webhooks, behind HTTPS. Only `/webhook/*` is public; the editor sits behind SSO or a VPN.
- **Network:** Convex calls the public n8n webhook URL over HTTPS; n8n calls the Convex `.convex.site` URL. If n8n is self-hosted, restrict egress to the Convex domain.

## Clerk

- A production instance on our own domain (DNS records, production keys), bot protection and email verification on, social sign-in if neighbors want it.
- Recreate the `convex` JWT template there (or switch to Clerk's native Convex integration) and set `CLERK_JWT_ISSUER_DOMAIN` on the Convex production deployment.
- A Clerk `user.deleted` webhook (verified with Svix) that deletes the user's listings, requests and activity in Convex, so account deletion really deletes.

## Secrets and rotation

- Secrets in the platforms' secret stores (Vercel env, Convex env, n8n credentials or the external-secrets vault), never in files on a server.
- Turn `N8N_BLOCK_ENV_ACCESS_IN_NODE` back on and give the Code nodes the HMAC secrets through n8n external secrets (`$secrets.<vault>.<name>`), so workflow editors cannot read the whole process env.
- Rotation without downtime: add a key id header (`x-lendloop-key-id`), let receivers accept the current and the previous secret for a short window, roll the sender, then drop the old secret. Rotate on a schedule and immediately on any suspected leak.
- Replay protection beyond the 5 minute window: keep seen signatures (or event ids) for 5 minutes in n8n's static data or Redis and reject repeats. Hide the `reason` in `401` responses.

## Notifications

- Replace the mock log with a real email step (Resend, SES or Postmark) whose API key is an n8n credential. n8n looks the recipient's address up from Clerk's Backend API at send time with a narrowly scoped key, so emails still never sit in Convex or in the webhook payload.
- Per-user notification preferences and an unsubscribe link.
- Use the event id as the provider's idempotency key so a retried run cannot send the same email twice.

## Monitoring and alerting

- Convex log streams to Datadog or Axiom; Sentry in the Next.js app.
- The n8n error workflow also posts to an on-call Slack channel; alert when undelivered outbox events or recorded failures grow, and when the daily overdue run did not run by 09:00 UTC (dead-man's switch).
- n8n's Prometheus metrics endpoint for queue depth and execution failures.
- Uptime checks on the public page and on the n8n webhook.

## Backups and data

- Scheduled Convex snapshot exports (and restore drills).
- Postgres backups for n8n; workflows stay in git as exported JSON and are deployed by script, not edited live in production.
- A written retention policy: n8n executions 7 days, returned or declined requests anonymised after a set time.

## Hardening

- Rate limits on request creation and listing changes (Convex rate-limiter component).
- An audit log of admin actions (removals, Trusted Lender changes, role grants).
- Neighborhood time zones instead of UTC calendar days for "overdue".
- CI running typecheck, lint, the Convex tests and the e2e smoke against a preview deployment on every pull request.
