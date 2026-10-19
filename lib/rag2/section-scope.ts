/**
 * Death-journey release: a stored page holds several benefits' sections one after another, and a retrieved passage can
 * straddle two of them (the tail of the Total and Permanent Dismemberment table and the head of the Simple Fracture section).
 * A condition, a "why it matters" line or a supporting sentence belongs to the benefit whose own section prints it: this
 * module splits a passage into the sections it spans -- headings detected by the existing heading rule -- so a caller can
 * restrict itself to the section of the benefit it is about, never to a neighbour's accident-related sentence.
 */
import { isHeadingLine } from "./headings";
import { familiesOf, familiesIntersect, type Family } from "./event-relations";

export type Section = { heading: string | null; start: number; end: number; families: Set<Family> };

const MARKER = /^(?:[•·▪●■\-]\s*|\d{1,2}[.)]\s+|[A-Za-z][.)]\s+|(?:section|part|clause)\s+\w+\s*[-–:.]\s*)/i;
const SMALL = new Set(["and", "or", "of", "the", "to", "for", "in", "on", "a", "an", "due", "by", "with", "upon", "at", "as"]);
/** A SECTION heading: the existing heading rule, and either a bullet / number / letter marker or a title-cased line of
 * two or more words that is not a table row (a header such as "Schedule<TAB>Compensation" names no section). */
export function isSectionHeading(line: string, next?: string | null, prev?: string | null): boolean {
  const raw = line.trim();
  if (/^page\s+\d+/i.test(raw)) return false;
  // (a title-cased line straight under a table row is that row's wrapped label -- "Mobility aid upon Accidental Total &" / "Permanent Disablement*")
  if (prev != null && /\t|\S {3,}\S/.test(prev) && !MARKER.test(raw)) return false;
  if (!raw || /\t|\S {3,}\S/.test(raw.replace(/^[•·▪●■]\s*/, "")) && !MARKER.test(raw)) return false;
  const body = raw.replace(MARKER, "").trim();
  if (/\t|\S {3,}\S/.test(body)) return false;
  if (!isHeadingLine(body, next ?? null)) return false;
  const words = body.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 14 || /^\(/.test(body)) return false;
  if (MARKER.test(raw) && raw !== body) return /^[A-Z0-9“"(]/.test(body);
  const cap = words.filter((w) => /^[A-Z0-9]/.test(w) || SMALL.has(w.toLowerCase())).length;
  return cap / words.length >= 0.85 && /^[A-Z]/.test(body);
}

/** The sections spanned by [start, end) of `pageText`. The piece before the first heading inside the range belongs to the
 * nearest heading ABOVE the range (null when there is none on the page). Offsets are page offsets. */
export function sectionsInRange(pageText: string, start: number, end: number): Section[] {
  const lines: { s: number; e: number; t: string }[] = [];
  let at = 0;
  for (const t of pageText.split("\n")) { lines.push({ s: at, e: at + t.length, t }); at += t.length + 1; }
  const isHead = (i: number) => isSectionHeading(lines[i].t, lines[i + 1]?.t ?? null, lines[i - 1]?.t ?? null);
  let lead: string | null = null;
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i].s < start && isHead(i)) { lead = lines[i].t.trim(); break; }
  const cuts: { at: number; heading: string }[] = [];
  for (let i = 0; i < lines.length; i++) if (lines[i].s >= start && lines[i].s < end && isHead(i)) cuts.push({ at: lines[i].s, heading: lines[i].t.trim() });
  const out: Section[] = [];
  const mk = (heading: string | null, s: number, e: number) => { if (e > s) out.push({ heading, start: s, end: e, families: familiesOf(heading ?? "") }); };
  if (!cuts.length) { mk(lead, start, end); return out; }
  if (cuts[0].at > start) mk(lead, start, cuts[0].at);
  cuts.forEach((c, i) => mk(c.heading, c.at, cuts[i + 1]?.at ?? end));
  return out;
}

/** The part of a passage that belongs to the benefit the question is about: the sections whose heading names a family of
 * the event. Null = nothing to restrict (one section, or an event with no family); `none` = the passage spans sections and
 * none of them is the event's, so it supports nothing about this benefit and must not be cited for it. */
export function scopeToEvent(pageText: string, start: number, end: number, event: ReadonlySet<Family>): { ranges: { start: number; end: number; heading: string | null }[] } | "none" | null {
  if (!event.size) return null;
  const secs = sectionsInRange(pageText, start, end);
  // A section whose heading names no event family ("3. Scope of cover", "4. Benefit conditions") is neutral: it is nobody's
  // neighbour in particular, so it neither supports nor contradicts the event. Only a section whose heading names ANOTHER
  // benefit's family is foreign.
  const mine = secs.filter((s) => familiesIntersect(s.families, event));
  const foreign = secs.filter((s) => s.families.size && !familiesIntersect(s.families, event));
  const neutral = secs.filter((s) => !s.families.size);
  if (!foreign.length) return null;
  const keep = mine.length ? mine : neutral;
  if (!keep.length) return "none";
  return { ranges: keep.map((s) => ({ start: s.start, end: s.end, heading: s.heading })) };
}
