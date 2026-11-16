import { clerkMiddleware } from "@clerk/nextjs/server";

// Makes the Clerk session available to server code. Pages check access themselves
// (see app/(app)/layout.tsx), and Convex checks every call again.
export default clerkMiddleware();

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
