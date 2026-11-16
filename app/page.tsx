"use client";

import { SignInButton } from "@clerk/nextjs";
import { Authenticated, AuthLoading, Unauthenticated, useQuery } from "convex/react";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { Badge, EmptyState, Loading } from "@/components/ui";
import { api } from "@/convex/_generated/api";
import { categoryLabel } from "@/convex/lib/constants";

export default function HomePage() {
  const tools = useQuery(api.tools.listPublic);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="flex items-center justify-between">
        <Logo />
        <AuthLoading>
          <span className="text-sm text-stone-500">...</span>
        </AuthLoading>
        <Authenticated>
          <Link href="/tools" className="text-sm font-medium text-emerald-800 hover:underline">
            Open the board
          </Link>
        </Authenticated>
      </header>

      <section className="py-16 text-center">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Borrow what you need. Lend what you don&apos;t.</h1>
        <p className="mx-auto mt-4 max-w-xl text-stone-600">
          LendLoop is a neighborhood board for sharing tools. List the drill you use twice a year, borrow the tent you
          need for one weekend.
        </p>
        <div className="mt-8">
          <Unauthenticated>
            <SignInButton mode="redirect">
              <button className="rounded-lg bg-emerald-700 px-5 py-2.5 font-medium text-white hover:bg-emerald-800">
                Sign in to lend or borrow
              </button>
            </SignInButton>
          </Unauthenticated>
          <Authenticated>
            <Link href="/tools" className="rounded-lg bg-emerald-700 px-5 py-2.5 font-medium text-white hover:bg-emerald-800">
              Go to the tool board
            </Link>
          </Authenticated>
        </div>
      </section>

      <section aria-labelledby="available-heading">
        <h2 id="available-heading" className="mb-4 text-lg font-semibold">
          Available now
        </h2>
        {tools === undefined ? (
          <Loading />
        ) : tools.length === 0 ? (
          <EmptyState>No tools listed yet. Be the first to lend one.</EmptyState>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="public-tools">
            {tools.map((tool, i) => (
              <li key={`${tool.name}-${i}`} data-testid="public-tool" className="flex items-center justify-between rounded-xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
                <span className="font-medium">{tool.name}</span>
                <Badge>{categoryLabel(tool.category)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
