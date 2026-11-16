"use client";

import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { errorMessage } from "@/lib/errors";
import { formatRange, timeAgo } from "@/lib/format";
import { ActivityList, RequestStatusBadge } from "./badges";
import { Button, Card, ErrorText } from "./ui";

export type RequestRow = FunctionReturnType<typeof api.requests.mine>[number];

/** One request or loan. `as` decides which side's actions show; the server re-checks them anyway. */
export function RequestCard({ request, as }: { request: RequestRow; as: "borrower" | "owner" | "admin" }) {
  const approve = useMutation(api.requests.approve);
  const decline = useMutation(api.requests.decline);
  const markReturned = useMutation(api.requests.markReturned);
  const cancel = useMutation(api.requests.cancel);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: (args: { requestId: RequestRow["_id"] }) => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action({ requestId: request._id });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const who =
    as === "borrower"
      ? `from ${request.ownerName}`
      : as === "owner"
        ? `by ${request.borrowerName}`
        : `${request.borrowerName} borrows from ${request.ownerName}`;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{request.toolName}</h2>
          <p className="text-sm text-stone-600">
            {formatRange(request.startDate, request.endDate)} &middot; {who} &middot; requested {timeAgo(request.requestedAt)}
          </p>
        </div>
        <RequestStatusBadge status={request.status} overdue={request.overdue} />
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {as === "owner" && request.status === "pending" && (
          <>
            <Button variant="secondary" disabled={busy} onClick={() => run(decline)}>
              Decline
            </Button>
            <Button disabled={busy} onClick={() => run(approve)}>
              Approve
            </Button>
          </>
        )}
        {as === "owner" && request.status === "approved" && (
          <Button disabled={busy} onClick={() => run(markReturned)}>
            Mark returned
          </Button>
        )}
        {as === "borrower" && request.status === "pending" && (
          <Button variant="secondary" disabled={busy} onClick={() => run(cancel)}>
            Cancel request
          </Button>
        )}
      </div>
      <ErrorText>{error}</ErrorText>
      <ActivityList activity={request.activity} />
    </Card>
  );
}
