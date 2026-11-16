"use client";

import { useAuth } from "@clerk/nextjs";
import { useConvexAuth, useMutation } from "convex/react";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/convex/_generated/api";
import { errorMessage } from "@/lib/errors";
import { ErrorText, Loading } from "./ui";

/** Registers the signed-in Clerk user with Convex once, then renders the app. */
export function EnsureUser({ children }: { children: ReactNode }) {
  const { isSignedIn } = useAuth();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const ensure = useMutation(api.users.ensure);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    ensure()
      .then(() => setReady(true))
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [isAuthenticated, ensure]);

  if (error) return <ErrorText>{error}</ErrorText>;
  if (isSignedIn && !isLoading && !isAuthenticated) {
    return (
      <ErrorText>
        Signed in, but the backend did not accept the session. Check the Clerk JWT template and CLERK_JWT_ISSUER_DOMAIN
        (see README).
      </ErrorText>
    );
  }
  if (!ready) return <Loading />;
  return <>{children}</>;
}
