import { AppNav } from "@/components/AppNav";
import { EnsureUser } from "@/components/EnsureUser";

// Signed-in area. proxy.ts already redirects signed-out visitors; Convex re-checks every call.
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <AppNav />
      <main className="mx-auto w-full max-w-5xl px-6 py-8">
        <EnsureUser>{children}</EnsureUser>
      </main>
    </>
  );
}
