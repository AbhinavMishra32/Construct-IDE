export function relativeTime(value: string | null | undefined): string {
  const parsed = Date.parse(value ?? "");
  if (!Number.isFinite(parsed)) return "";
  const minutes = Math.max(0, Math.floor((Date.now() - parsed) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(parsed).toLocaleDateString([], { month: "short", day: "numeric" });
}

/**
 * {@link relativeTime} with the words removed: "now", "12m", "3h", "4d", "Mar 4".
 *
 * A metadata column only reads as a column if every value fits it, and "just now"
 * is three times the width of "3h ago". Six characters is the ceiling here, so the
 * timestamps line up on their right edge instead of fraying.
 */
export function shortTime(value: string | null | undefined): string {
  const parsed = Date.parse(value ?? "");
  if (!Number.isFinite(parsed)) return "";
  const minutes = Math.max(0, Math.floor((Date.now() - parsed) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(parsed).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function initials(value: string): string {
  const parts = value.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join("") || "?";
}
