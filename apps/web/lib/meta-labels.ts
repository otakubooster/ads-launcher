/** Meta's numeric ad account_status values. */
export const ACCOUNT_STATUS: Record<number, { label: string; tone: "positive" | "warning" | "negative" | "neutral" }> = {
  1: { label: "Active", tone: "positive" },
  2: { label: "Disabled", tone: "negative" },
  3: { label: "Unsettled", tone: "warning" },
  7: { label: "Pending risk review", tone: "warning" },
  8: { label: "Pending settlement", tone: "warning" },
  9: { label: "In grace period", tone: "warning" },
  100: { label: "Pending closure", tone: "warning" },
  101: { label: "Closed", tone: "neutral" },
};

export function accountStatus(code: number) {
  return ACCOUNT_STATUS[code] ?? { label: `Status ${code}`, tone: "neutral" as const };
}
