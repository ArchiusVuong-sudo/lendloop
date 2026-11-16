// Shared by Convex functions and the UI, so labels and validators never drift apart.

export const CATEGORIES = [
  { value: "power_tools", label: "Power tools" },
  { value: "hand_tools", label: "Hand tools" },
  { value: "garden", label: "Garden" },
  { value: "kitchen", label: "Kitchen" },
  { value: "camping", label: "Camping" },
  { value: "cleaning", label: "Cleaning" },
  { value: "other", label: "Other" },
] as const;

export const CONDITIONS = [
  { value: "like_new", label: "Like new" },
  { value: "good", label: "Good" },
  { value: "fair", label: "Fair" },
  { value: "worn", label: "Worn but works" },
] as const;

export type Category = (typeof CATEGORIES)[number]["value"];
export type Condition = (typeof CONDITIONS)[number]["value"];

export const REQUEST_STATUSES = ["pending", "approved", "declined", "cancelled", "returned"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const NOTIFICATION_EVENTS = [
  "request.created",
  "request.approved",
  "request.declined",
  "request.cancelled",
  "request.returned",
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export const LIMITS = {
  toolName: { min: 2, max: 60 },
  description: { max: 280 },
  maxLoanDays: 30,
} as const;

export function categoryLabel(value: string): string {
  return CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

export function conditionLabel(value: string): string {
  return CONDITIONS.find((c) => c.value === value)?.label ?? value;
}
