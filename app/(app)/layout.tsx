import { auth } from "@clerk/nextjs/server";
import { AppNav } from "@/components/AppNav";
import { EnsureUser } from "@/components/EnsureUser";

// Signed-in area: signed-out visitors are sent to /sign-in. This is UX only; every Convex
// function checks identity and role again.
export default async function AppLayout({ children }: LayoutProps<"/">) {
  await auth.protect();
  return (
    <>
      <AppNav />
      <main className="mx-auto w-full max-w-5xl px-6 py-8">
        <EnsureUser>{children}</EnsureUser>
      </main>
    </>
  );
}
