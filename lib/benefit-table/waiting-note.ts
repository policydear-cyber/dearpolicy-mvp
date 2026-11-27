import { printedDay, singaporeDay } from "./dates";

/** A waiting period runs this long at most: a cover that started earlier is past every one (same bound as lib/benefit-table/chat.ts). */
const LONGEST_WAIT_DAYS = 365;

/**
 * The one line a cover card adds when a benefit says it is "subject to the waiting period" and the cover began within the
 * last year. It gives no length, no end date and no verdict: the card cannot know them, so it says a waiting period applies,
 * that the benefit may not be payable yet, and where to ask. A cover with no printed start date, or one that began more than
 * a year ago, gets nothing. Never an amount or a "covered" statement.
 */
export function waitingNote(cover: { startDate: string | null }, rows: { conditions?: string[]; benefit?: string }[], now: Date = new Date()): string | null {
  const since = printedDay(cover.startDate);
  if (since == null) return null;
  const age = singaporeDay(now) - since;
  if (age < 0 || age >= LONGEST_WAIT_DAYS) return null;
  const says = rows.some((r) => [r.benefit ?? "", ...(r.conditions ?? [])].some((t) => /\bwaiting\s+period/i.test(t)));
  return says ? "A waiting period applies to this cover, which began less than a year ago, so some benefits may not be payable yet. Ask DearPolicy how long it runs for this policy." : null;
}
