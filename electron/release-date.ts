/**
 * Release dates as the sources give them — tag text ("2019-05-03",
 * "2019-05-03T00:00:00Z", "2019-5", "2019"), Jellyfin's PremiereDate, an
 * OpenSubsonic ItemDate ({ year, month, day }) — as one sortable string:
 * "YYYY-MM-DD", or "YYYY-MM" / "YYYY" when that is all that is known.
 * Pure, no electron imports (the tests load it).
 */
export function isoDate(value: unknown): string | undefined {
  if (value && typeof value === "object") {
    const d = value as { year?: unknown; month?: unknown; day?: unknown };
    return fromParts(d.year, d.month, d.day);
  }
  if (typeof value !== "string") return undefined;
  const m = /^\s*(\d{4})(?:[-/.](\d{1,2})(?:[-/.](\d{1,2}))?)?/.exec(value);
  return m ? fromParts(m[1], m[2], m[3]) : undefined;
}

function fromParts(year: unknown, month: unknown, day: unknown): string | undefined {
  const y = Number(year);
  // Jellyfin's "no date" is 0001-01-01.
  if (!Number.isInteger(y) || y < 1000 || y > 2999) return undefined;
  const m = Number(month);
  if (!Number.isInteger(m) || m < 1 || m > 12) return String(y);
  const mm = String(m).padStart(2, "0");
  const d = Number(day);
  if (!Number.isInteger(d) || d < 1 || d > 31) return `${y}-${mm}`;
  return `${y}-${mm}-${String(d).padStart(2, "0")}`;
}
