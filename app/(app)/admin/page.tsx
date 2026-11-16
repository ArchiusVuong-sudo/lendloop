"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { TrustedBadge } from "@/components/badges";
import { RequestCard } from "@/components/RequestCard";
import { Button, Card, EmptyState, ErrorText, Loading, PageHeader } from "@/components/ui";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { errorMessage } from "@/lib/errors";
import { timeAgo } from "@/lib/format";

export default function AdminPage() {
  const me = useQuery(api.users.me);
  if (me === undefined) return <Loading />;
  if (me?.role !== "admin") {
    return <EmptyState>This page is for admins.</EmptyState>;
  }
  return (
    <>
      <PageHeader
        title="Admin"
        subtitle="Moderate listings from the tool board. Here: every loan, Trusted Lenders and automation health."
      />
      <div className="space-y-10">
        <Lenders />
        <AutomationHealth />
        <AllLoans />
      </div>
    </>
  );
}

function Lenders() {
  const lenders = useQuery(api.admin.lenders);
  const setTrusted = useMutation(api.admin.setTrustedLender);
  const [error, setError] = useState<string | null>(null);

  async function toggle(userId: Id<"users">, trusted: boolean) {
    setError(null);
    try {
      await setTrusted({ userId, trusted });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">Lenders</h2>
      <ErrorText>{error}</ErrorText>
      {lenders === undefined ? (
        <Loading />
      ) : lenders.length === 0 ? (
        <EmptyState>No one has listed a tool yet.</EmptyState>
      ) : (
        <Card className="divide-y divide-stone-100 p-0">
          {lenders.map((lender) => (
            <div key={lender._id} data-testid="lender-row" className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="flex items-center gap-2">
                <span className="font-medium">{lender.displayName}</span>
                <span className="text-sm text-stone-500">
                  {lender.listings} listing{lender.listings > 1 ? "s" : ""}
                </span>
                {lender.trustedLender && <TrustedBadge />}
              </span>
              <Button variant="secondary" onClick={() => toggle(lender._id, !lender.trustedLender)}>
                {lender.trustedLender ? "Remove Trusted Lender" : "Mark as Trusted Lender"}
              </Button>
            </div>
          ))}
        </Card>
      )}
    </section>
  );
}

function AutomationHealth() {
  const health = useQuery(api.admin.automationHealth);
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">Automation health</h2>
      {health === undefined ? (
        <Loading />
      ) : health.failures.length === 0 && health.undeliveredNotifications.length === 0 ? (
        <EmptyState>No failed n8n runs or undelivered notifications.</EmptyState>
      ) : (
        <Card className="space-y-2 text-sm">
          {health.failures.map((f) => (
            <p key={f._id}>
              <span className="font-medium text-red-700">{f.workflowName}</span>
              {f.nodeName && <> at {f.nodeName}</>}: {f.message}{" "}
              <span className="text-stone-500">({timeAgo(f.at)})</span>
            </p>
          ))}
          {health.undeliveredNotifications.map((n) => (
            <p key={n._id}>
              <span className="font-medium text-red-700">Webhook not delivered</span>: {n.event} after {n.attempts}{" "}
              attempts{n.lastError && <> ({n.lastError})</>}
            </p>
          ))}
        </Card>
      )}
    </section>
  );
}

function AllLoans() {
  const loans = useQuery(api.admin.allLoans);
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">All loans and requests</h2>
      {loans === undefined ? (
        <Loading />
      ) : loans.length === 0 ? (
        <EmptyState>No requests yet.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {loans.map((loan) => (
            <li key={loan._id} data-testid="request-card">
              <RequestCard request={loan} as="admin" />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
