/** A schedule's list of covers is said as the schedule prints it, never as an amount that "could not be read"
 * (live review on 4103e10, finding 2). Made-up rows: other insurers, currencies, date styles and layouts. */
import assert from "node:assert/strict";
import { scheduleCoverLine } from "@/lib/policies/cover-line";

const schedule = (benefitName: string, quote: string, documentRole = "personal_schedule") => scheduleCoverLine({ benefitName, quote, documentRole });

const listed: [string, string, string][] = [
  ["CRITICAL CARE RIDER 7781X", "CRITICAL CARE RIDER 7781X $100,000.00 21 Sep 2020 21 Sep 2092", "$100,000.00"],
  ["Hospital Income Plus", "Hospital Income Plus S$ 50,000 01/03/2024 01/03/2044", "S$ 50,000"],
  ["Pelan Perlindungan Kanser", "Pelan Perlindungan Kanser RM 250,000.00 15 Ogos 2023 15 Ogos 2053", "RM 250,000.00"],
  ["Accidental Death Benefit", "Accidental Death Benefit £75,000 2022-06-30 2042-06-30", "£75,000"],
  ["Term Life Cover", "Term Life Cover HK$1,000,000 1 Jan 2021", "HK$1,000,000"],
  ["Disability Income", "Disability Income USD 200,000.00 Mar 4, 2019 Mar 4, 2049", "USD 200,000.00"],
  ["Lebensversicherung", "Lebensversicherung €150.000,00 01.02.2020 01.02.2050", "€150.000,00"],
  ["Waiver of Premium", "Waiver   of Premium  A$ 30,000  12-Jan-2022  12-Jan-2047", "A$ 30,000"],
];
for (const [name, quote, figure] of listed) assert.deepEqual(schedule(name, quote), { figure }, quote);

const notLines: [string, string, string?][] = [
  // A premium beside the amount: which figure is the cover is a layout guess.
  ["PROTECTOR PLAN ---", "PROTECTOR PLAN --- $100,000.00 21 Sep 2020 21 Sep 2092 $200.00 72"],
  // Words after the figure make it a rule, not a listed amount.
  ["Hospital Cash", "Hospital Cash S$150 per day 01/01/2024 01/01/2034"],
  ["Outpatient", "Outpatient RM 2,000 per year"],
  // No currency mark: a count, a code or units, not an amount.
  ["Rider units", "Rider units 100,000 21 Sep 2020 21 Sep 2092"],
  // Mirror layout: dates first, figure last.
  ["Life Cover", "Life Cover 21 Sep 2020 21 Sep 2092 $100,000.00"],
  // No date at all: a figure inside prose.
  ["Death Benefit", "Death Benefit $100,000.00"],
  // The quote is another row's.
  ["Critical Illness", "Early Critical Illness $25,000 01/01/2024 01/01/2034"],
  // A name that carries its own figure, or a share.
  ["Plan $50,000", "Plan $50,000 $50,000 01/01/2024 01/01/2034"],
  ["50% Cover", "50% Cover $50,000 01/01/2024 01/01/2034"],
  // Two figures before the dates.
  ["Life Cover", "Life Cover $100,000 $5,000 01/01/2024 01/01/2034"],
  // Not a person's own schedule: a brochure's example table.
  ["Life Cover", "Life Cover $100,000 01/01/2024 01/01/2034", "brochure"],
  ["Life Cover", "Life Cover $100,000 01/01/2024 01/01/2034", "policy_wording"],
  // Nameless rows.
  ["N/A", "N/A $100,000 01/01/2024"],
];
for (const [name, quote, role] of notLines) assert.equal(schedule(name, quote, role), null, quote);

console.log(`cover-line-test: ${listed.length} listed, ${notLines.length} left as they were`);
