"use client";

import { useQuery } from "convex/react";
import { RequestCard } from "@/components/RequestCard";
import { EmptyState, Loading, PageHeader } from "@/components/ui";
import { api } from "@/convex/_generated/api";

export default function MyRequestsPage() {
  const requests = useQuery(api.requests.mine);
  return (
    <>
      <PageHeader title="My requests" subtitle="Tools you asked to borrow and the loans you have out." />
      {requests === undefined ? (
        <Loading />
      ) : requests.length === 0 ? (
        <EmptyState>No requests yet. Find something on the tool board.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {requests.map((r) => (
            <li key={r._id} data-testid="request-card">
              <RequestCard request={r} as="borrower" />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
