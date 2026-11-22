/** A person's policies across the stages of their life, for the Life stages page (DC 19 Nov 2026, feedback item 4: "how
 * long more he needs to pay and how much he can receive at maturity or a projection amount at each stage of life").
 *
 * Built only from what the documents print and the server has already checked against its page:
 *  - when each policy's cover ends (lib/policies/policy-dates.ts, including the household's renewal proof or answer);
 *  - when premiums stop, the premium term in its own words, and the maturity date (CheckedCover premiumEndDate,
 *    premiumTerm, maturityDate: lib/benefit-table/check.ts termDates);
 *  - values printed for an age or a policy year (TableRow.valueAt with a "value" or "projected" figure: check.ts valueAt).
 * Nothing is added up, worked out or projected here: no "total still to pay" (premiums change), no value for an age the
 * document does not print, and a projection is always said to be one, with the rate it is illustrated at when printed.
 * A policy whose end is not printed is never treated as ending. Ages come from the person's date of birth on record; with
 * none, the page shows dates only.
 *
 * Pure: no database, no network.  Test: scripts/policies/life-stages-test.ts */

import { dayOf, dayText, type PolicyDate } from "@/lib/policies/policy-dates";
import { currencyOfAmount } from "@/lib/format/currency";

/** One cover line of the person's benefit table, with its printed term dates. */
export type LifeCover = { documentId: string; coverKey: string; name: string; premiumEndDate?: string | null; premiumTerm?: string | null; maturityDate?: string | null; page: number | null };
/** One printed value of the person's table placed by an age or policy year its page prints. */
export type LifeValueRow = { coverKey: string; benefit: string; amount: number; currency: string | null;
  column?: string | null; /** Other policy years where the same running total is printed again (benefit table collapseRepeats). */ repeatedAt?: number[]; /** The verified currency of this value's cover, when its schedule settles one. */ coverCurrency?: string | null;
  kind: "value" | "projected"; basis?: "non_guaranteed" | "illustrated"; age?: number; policyYear?: number; rate?: string; documentId: string; document: string; page: number };

export type LifeEvent = { kind: "premiums_end" | "matures" | "cover_ends"; on: string; onText: string; age: number | null; policy: string; cover: string | null; page: number | null };
export type LifeValue = { benefit: string; amount: number; currency: string | null; projected: boolean; basis: string | null; age: number | null; policyYear: number | null; rate: string | null; /** Later policy years with the same printed amount. */ repeatedAt: number[]; document: string; page: number };
export type LifePolicy = {
  key: string; name: string; insurer: string | null; state: PolicyDate["state"];
  /** The last day of cover as printed, or as the renewal receipt prints it; null when no end is printed. */
  endsOn: string | null; endsText: string | null; endAge: number | null;
  /** When premiums stop, as printed (the latest of its covers), and the premium term in its own words when no date is. */
  premiumsEnd: { on: string; onText: string; age: number | null } | null; premiumTerm: string | null;
  matures: { on: string; onText: string; age: number | null } | null;
  values: LifeValue[];
};
export type LifeStage = {
  /** The stage runs from `from` (today for the first) up to `to` (null for the last stage). */
  from: { on: string; onText: string; age: number | null }; to: { on: string; onText: string; age: number | null } | null;
  /** Policies whose printed cover end is after the stage starts: dates as printed, never a verdict that cover is in force. */
  inPlace: string[];
  /** Renewed policies whose new end date is not printed: said in the first stage only, never carried forward (Critic MED-4). */
  renewedNoEnd: string[];
  /** Policies whose end is not printed: never shown as ending. */
  endNotPrinted: string[];
  /** Policies still paying premiums through the stage, as printed (premium end after it). */
  paying: string[];
  /** What happens at the stage's start, as printed. */
  events: LifeEvent[];
};
export type LifeStages = { age: number | null; policies: LifePolicy[]; /** Policies that print no date, term or value at all: named once, never drawn or repeated in every stage. */ noDates: string[]; stages: LifeStage[]; renewalDue: string[]; notRenewed: string[] };

const isoOf = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);
/** Whole years from a date of birth to a day, or null with no date of birth. */
export function ageOn(born: number | null, day: number): number | null {
  if (born == null || day < born) return null;
  const b = new Date(born * 86_400_000), d = new Date(day * 86_400_000);
  let years = d.getUTCFullYear() - b.getUTCFullYear();
  if (d.getUTCMonth() < b.getUTCMonth() || (d.getUTCMonth() === b.getUTCMonth() && d.getUTCDate() < b.getUTCDate())) years -= 1;
  return years;
}

/** A value printed in a column headed with a bare "$" is in the currency its own cover's schedule settles, when that is a
 * dollar currency (currencyOfAmount); with nothing settled, or no "$" on the row, it stays without one. Never a default. */
export function currencyOfValue(v: Pick<LifeValueRow, "benefit" | "column" | "currency" | "coverCurrency">): string | null {
  if (v.currency) return v.currency;
  return /\$/.test(`${v.benefit} ${v.column ?? ""}`) ? currencyOfAmount("$", v.coverCurrency ?? null) : null;
}

/** The latest printed day among some texts, with its text, or null. */
function latest(texts: (string | null | undefined)[]): number | null {
  const days = texts.map(dayOf).filter((d): d is number => d != null);
  return days.length ? Math.max(...days) : null;
}

/** The person's policies and their life stages. `dates`: the person's policy dates (keys already as the page shows them);
 * `coverKeyDocs`: each table cover's own document, so a value row printed on an illustration is placed on the policy whose
 * schedule holds that cover. */
export function lifeStages(input: { dates: PolicyDate[]; covers: LifeCover[]; values: LifeValueRow[]; dateOfBirth: string | null; today: number }): LifeStages {
  const born = dayOf(input.dateOfBirth);
  const at = (day: number) => ({ on: isoOf(day), onText: dayText(day), age: ageOn(born, day) });
  const docOfCover = new Map(input.covers.map((c) => [c.coverKey, c.documentId]));
  const shown = input.dates.filter((p) => p.state !== "not_renewed" && p.state !== "renewal_due");
  const all: LifePolicy[] = shown.map((p) => {
    const docs = new Set(p.documentIds);
    const covers = input.covers.filter((c) => docs.has(c.documentId));
    const end = p.state === "renewed" ? dayOf(p.renewal?.until ?? null) : dayOf(p.endsOn);
    const premiumDay = latest(covers.map((c) => c.premiumEndDate));
    const terms = [...new Set(covers.map((c) => c.premiumTerm?.trim()).filter((t): t is string => !!t))];
    const maturityDay = latest(covers.map((c) => c.maturityDate));
    const values = input.values.filter((v) => docs.has(docOfCover.get(v.coverKey) ?? "") && (v.age != null || v.policyYear != null))
      .map((v): LifeValue => ({ benefit: v.benefit, amount: v.amount, currency: currencyOfValue(v), projected: v.kind === "projected", basis: v.kind === "projected" ? (v.basis ?? "illustrated") : null,
        age: v.age ?? null, policyYear: v.policyYear ?? null, rate: v.rate ?? null, repeatedAt: v.repeatedAt ?? [], document: v.document, page: v.page }))
      .sort((a, b) => (a.policyYear ?? a.age ?? 0) - (b.policyYear ?? b.age ?? 0) || Number(a.projected) - Number(b.projected));
    return { key: p.key, name: p.name, insurer: p.insurer, state: p.state, endsOn: end != null ? isoOf(end) : null, endsText: end != null ? dayText(end) : null, endAge: end != null ? ageOn(born, end) : null,
      premiumsEnd: premiumDay != null ? at(premiumDay) : null, premiumTerm: premiumDay == null && terms.length === 1 ? terms[0] : null,
      matures: maturityDay != null ? at(maturityDay) : null, values };
  });

  // A policy that prints no date, term or value says nothing about any stage: named once, not in every stage.
  const undated = (p: LifePolicy) => !p.endsOn && !p.premiumsEnd && !p.matures && !p.premiumTerm && !p.values.length && p.state !== "renewed";
  const policies = all.filter((p) => !undated(p));
  const noDates = all.filter(undated).map((p) => p.name);

  // Stage boundaries: each printed event still ahead (premiums stop, matures, cover ends).
  const events: (LifeEvent & { day: number })[] = [];
  for (const p of policies) {
    const add = (kind: LifeEvent["kind"], on: string | null) => {
      const day = dayOf(on);
      if (day != null && day > input.today) events.push({ kind, day, on: isoOf(day), onText: dayText(day), age: ageOn(born, day), policy: p.name, cover: null, page: null });
    };
    add("premiums_end", p.premiumsEnd?.on ?? null); add("matures", p.matures?.on ?? null); add("cover_ends", p.endsOn);
  }
  events.sort((a, b) => a.day - b.day);
  const bounds = [...new Set(events.map((e) => e.day))];
  const starts = [input.today, ...bounds];
  const endDay = (p: LifePolicy) => dayOf(p.endsOn);
  const stages: LifeStage[] = starts.map((from, i) => {
    const to = bounds[i] ?? null;
    const inPlace = policies.filter((p) => { const e = endDay(p); return e != null && e > from; }).map((p) => p.name);
    const renewedNoEnd = i === 0 ? policies.filter((p) => endDay(p) == null && p.state === "renewed").map((p) => p.name) : [];
    const endNotPrinted = policies.filter((p) => endDay(p) == null && p.state !== "renewed").map((p) => p.name);
    const paying = policies.filter((p) => { const d = dayOf(p.premiumsEnd?.on ?? null); return d != null && d > from && (endDay(p) == null || endDay(p)! > from); }).map((p) => p.name);
    return { from: at(from), to: to != null ? at(to) : null, inPlace, renewedNoEnd, endNotPrinted, paying,
      events: i === 0 ? [] : events.filter((e) => e.day === from).map(({ day: _day, ...e }) => e) };
  });
  return { age: ageOn(born, input.today), policies, noDates, stages,
    renewalDue: input.dates.filter((p) => p.state === "renewal_due").map((p) => p.name),
    notRenewed: input.dates.filter((p) => p.state === "not_renewed").map((p) => p.name) };
}
