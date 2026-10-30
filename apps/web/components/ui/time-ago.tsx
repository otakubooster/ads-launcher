import { formatRelativeTime } from "@/lib/format";

/**
 * "5 min ago" that tolerates the server and the browser rendering a few seconds
 * (or time zones) apart; the full date is in the tooltip.
 */
export function TimeAgo({ iso, className }: { iso: string; className?: string }) {
  const date = new Date(iso);
  return (
    <time dateTime={iso} title={date.toLocaleString()} className={className} suppressHydrationWarning>
      {formatRelativeTime(date)}
    </time>
  );
}

/** An absolute date and time in the viewer's locale and time zone. */
export function LocalTime({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {new Date(iso).toLocaleString()}
    </time>
  );
}
