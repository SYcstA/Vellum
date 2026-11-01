/** Typed hour/minute -> zero-padded "HH"/"mm", or null if it is not a whole number in 0..max. */
export function parseTimePart(text: string, max: number): string | null {
  const t = text.trim();
  if (!/^\d{1,2}$/.test(t)) return null;
  const n = Number(t);
  return n <= max ? String(n).padStart(2, "0") : null;
}
