/** Delivery column (docs/spec.md → Ads): status dot + text, from Meta's statuses. */
export type Delivery = { label: string; tone: "positive" | "info" | "warning" | "negative" | "neutral" };

export function delivery(status: string, effectiveStatus: string, learning: string | null): Delivery {
  if (status === "DELETED" || status === "ARCHIVED") return { label: "Deleted", tone: "neutral" };
  switch (effectiveStatus) {
    case "DISAPPROVED":
      return { label: "Rejected", tone: "negative" };
    case "IN_PROCESS":
    case "PENDING_REVIEW":
      return { label: "In review", tone: "info" };
    case "PAUSED":
    case "CAMPAIGN_PAUSED":
    case "ADSET_PAUSED":
      return { label: "Paused", tone: "neutral" };
    case "WITH_ISSUES":
    case "PENDING_BILLING_INFO":
    case "ACCOUNT_DISABLED":
      return { label: "Not delivering", tone: "warning" };
    case "ACTIVE":
      if (learning === "LEARNING") return { label: "Learning", tone: "info" };
      if (learning === "FAIL") return { label: "Learning limited", tone: "warning" };
      return { label: "Active", tone: "positive" };
    default:
      return { label: effectiveStatus.charAt(0) + effectiveStatus.slice(1).toLowerCase().replace(/_/g, " "), tone: "neutral" };
  }
}
