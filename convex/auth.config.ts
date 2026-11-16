import type { AuthConfig } from "convex/server";

// Convex accepts Clerk tokens minted from the "convex" JWT template (scripts/setup-clerk.mjs).
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
