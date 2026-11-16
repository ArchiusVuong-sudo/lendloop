"use client";

import { UserButton } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { Logo } from "./Logo";

const LINKS = [
  { href: "/tools", label: "All tools" },
  { href: "/listings", label: "My listings" },
  { href: "/requests", label: "My requests" },
  { href: "/incoming", label: "Incoming requests" },
];

export function AppNav() {
  const pathname = usePathname();
  const me = useQuery(api.users.me);
  const links = me?.role === "admin" ? [...LINKS, { href: "/admin", label: "Admin" }] : LINKS;

  return (
    <header className="border-b border-stone-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-3">
        <Logo href="/tools" />
        <nav className="flex flex-wrap gap-1" aria-label="Main">
          {links.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                  active ? "bg-emerald-50 text-emerald-800" : "text-stone-600 hover:bg-stone-100"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-3">
          {me && (
            <span className="text-sm text-stone-600" data-testid="viewer-name">
              {me.displayName}
              {me.role === "admin" && <span className="ml-1 text-xs text-violet-700">(admin)</span>}
            </span>
          )}
          <UserButton />
        </div>
      </div>
    </header>
  );
}
