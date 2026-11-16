"use client";

import { useQuery } from "convex/react";
import { RequestCard } from "@/components/RequestCard";
import { EmptyState, Loading, PageHeader } from "@/components/ui";
import { api } from "@/convex/_generated/api";

export default function IncomingRequestsPage() {
  const requests = useQuery(api.requests.incoming);
  return (
    <>
      <PageHeader title="Incoming requests" subtitle="Neighbors who want to borrow your tools." />
      {requests === undefined ? (
        <Loading />
      ) : requests.length === 0 ? (
        <EmptyState>Nobody has asked for your tools yet.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {requests.map((r) => (
            <li key={r._id} data-testid="request-card">
              <RequestCard request={r} as="owner" />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
