/** Day boundaries and times in the admin console: Singapore, DearPolicy's home market. */
export const ADMIN_TIME_ZONE = "Asia/Singapore";

/** "18 Nov 2026, 16:49" in Singapore time; "—" when there is no date. */
export function when(value: string | null | undefined): string {
  if (!value) return "—";
  // Postgres text: "2026-11-18 16:49:58.123+00" -> ISO "2026-11-18T16:49:58.123+00:00".
  const iso = value.trim().replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00").replace(/([+-]\d\d)(\d\d)$/, "$1:$2");
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: ADMIN_TIME_ZONE });
}

/** "18 Nov" for a plain YYYY-MM-DD day. */
export function day(value: string): string {
  const d = new Date(value + "T00:00:00Z");
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** US$ with enough places to show small model costs. */
export function usd(v: number): string {
  return "US$" + v.toFixed(v > 0 && v < 0.1 ? 4 : 2);
}

/** The first 8 characters of an id, enough to tell households apart on screen. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

export function plural(n: number, one: string, many = one + "s"): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}
