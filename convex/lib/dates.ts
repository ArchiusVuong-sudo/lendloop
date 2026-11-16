// Loan dates are plain calendar days (YYYY-MM-DD). "Today" is the UTC calendar day.

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDay(value: string): boolean {
  if (!ISO_DAY.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
  return utcDay(new Date(`${day}T00:00:00Z`).getTime() + days * DAY_MS);
}

export function daysBetween(fromDay: string, toDay: string): number {
  return Math.round(
    (new Date(`${toDay}T00:00:00Z`).getTime() - new Date(`${fromDay}T00:00:00Z`).getTime()) / DAY_MS,
  );
}

/** Two inclusive day ranges overlap when neither ends before the other starts. */
export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}
