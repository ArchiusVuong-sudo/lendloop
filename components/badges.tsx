"use client";

import { formatDay, timeAgo } from "@/lib/format";
import { Badge } from "./ui";

const STATUS_TONE = {
  pending: "amber",
  approved: "green",
  declined: "red",
  cancelled: "neutral",
  returned: "blue",
} as const;

export function RequestStatusBadge({ status, overdue }: { status: keyof typeof STATUS_TONE; overdue?: boolean }) {
  return (
    <span className="inline-flex gap-1.5">
      <Badge tone={STATUS_TONE[status]}>{status === "approved" ? "on loan" : status}</Badge>
      {overdue && <Badge tone="red">overdue</Badge>}
    </span>
  );
}

export type AvailabilityView =
  | { status: "available" }
  | { status: "reserved"; from: string }
  | { status: "on_loan"; until: string };

export function AvailabilityBadge({ availability }: { availability: AvailabilityView }) {
  switch (availability.status) {
    case "available":
      return <Badge tone="green">Available</Badge>;
    case "reserved":
      return <Badge tone="amber">Available, reserved from {formatDay(availability.from)}</Badge>;
    case "on_loan":
      return <Badge tone="violet">On loan until {formatDay(availability.until)}</Badge>;
  }
}

export function TrustedBadge() {
  return <Badge tone="blue">Trusted Lender</Badge>;
}

export function ActivityList({ activity }: { activity: { kind: string; summary: string; at: number }[] }) {
  if (activity.length === 0) return null;
  return (
    <ul className="mt-2 space-y-0.5 border-t border-stone-100 pt-2 text-xs text-stone-500" aria-label="Automation activity">
      {activity.map((a, i) => (
        <li key={i}>
          {a.summary}, {timeAgo(a.at)}
        </li>
      ))}
    </ul>
  );
}
