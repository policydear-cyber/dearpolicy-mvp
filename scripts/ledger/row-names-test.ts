/**
 * Benefit rows printed in other languages, and rows whose name only says "the sum", map to the event they pay instead of
 * "Other benefit"; a fixed figure printed with a period is paid per day or per month, never as a lump sum.
 * Cross-page check, 31 Oct. No database, no model.
 */
import { eventForBenefitName } from "@/lib/ledger/events";
import { fixedPays } from "@/lib/ledger/store";

let pass = 0, fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  if (got === want) pass++; else { fail++; console.log(`FAIL ${label}: got ${String(got)}, want ${String(want)}`); }
};
const ev = (name: string, plan?: string) => eventForBenefitName(name, plan).event;

// Row names in other languages, each case its own household's wording.
const rows: [string, string][] = [
  // Malay / Indonesian
  ["Kanser Tahap Kritikal", "critical_illness"], ["Serangan Jantung", "critical_illness"], ["Strok", "critical_illness"],
  ["Kematian atau Hilang Upaya Menyeluruh dan Kekal", "death"], ["Hilang Upaya Menyeluruh dan Kekal", "tpd"],
  ["Kematian akibat Kemalangan", "accidental_death"], ["Penyakit Kritis Tahap Awal", "early_critical_illness"],
  ["Santunan rawat inap per hari", "hospital_daily_cash"], ["Unit Rawatan Rapi", "icu_daily_cash"], ["Pembedahan", "surgery"],
  ["Meninggal Dunia karena Kecelakaan", "accidental_death"], ["Penyakit Kritis", "critical_illness"], ["Patah Tulang", "fracture"],
  ["Cacat Tetap Total", "tpd"], ["Biaya Pengobatan di Luar Negeri", "travel_medical"], ["Ambulans", "ambulance"],
  // Chinese
  ["身故保险金", "death"], ["重大疾病保险金", "critical_illness"], ["意外身故", "accidental_death"], ["住院日额津贴", "hospital_daily_cash"],
  ["全残保险金", "tpd"], ["癌症", "critical_illness"], ["早期重疾", "early_critical_illness"], ["行李延误", "baggage"], ["航班延误", "travel_delay"],
  // Spanish
  ["Fallecimiento por accidente", "accidental_death"], ["Invalidez total y permanente", "tpd"], ["Enfermedades graves", "critical_illness"],
  ["Gastos médicos en el extranjero", "travel_medical"], ["Renta por invalidez", "disability_income"], ["Cancelación de viaje", "trip_cancellation"],
  // Portuguese
  ["Morte acidental", "accidental_death"], ["Invalidez total e permanente", "tpd"], ["Doenças graves", "critical_illness"], ["Diária por internação", "hospital_daily_cash"],
  // French
  ["Décès accidentel", "accidental_death"], ["Invalidité totale et définitive", "tpd"], ["Frais médicaux à l'étranger", "travel_medical"], ["Bagages", "baggage"],
  // German
  ["Todesfall", "death"], ["Unfalltod", "accidental_death"], ["Schwere Krankheiten", "critical_illness"], ["Krankenhaustagegeld", "hospital_daily_cash"],
  ["Berufsunfähigkeitsrente", "disability_income"],
  // Italian, Vietnamese
  ["Morte da infortunio", "accidental_death"], ["Malattie gravi", "critical_illness"], ["Tử vong do tai nạn", "accidental_death"], ["Bệnh hiểm nghèo", "critical_illness"],
  // English names keep their mapping
  ["Death benefit", "death"], ["Hospital income", "hospital_daily_cash"], ["Disability income benefit", "disability_income"], ["Income protection", "disability_income"],
  ["Total and permanent disability", "tpd"], ["Room and board per day", "hospital_daily_cash"], ["Annual limit", "other"], ["Premium waiver", "other"],
  // Liability to others stays "other" in any language, whatever else it names
  ["Liabiliti Pihak Ketiga (Kematian)", "other"], ["Responsabilidad civil", "other"], ["Responsabilité civile décès", "other"], ["第三者责任 身故", "other"],
  // Words that only look alike stay "other"
  ["Had tahunan", "other"], ["Bilik dan Makan", "other"],
];
for (const [name, want] of rows) eq(name, ev(name), want);

// A row naming only the sum takes the plan's own main benefit when exactly one plan kind fits the plan's name.
const plans: [string, string, string][] = [
  ["Sum assured", "Heronsgate Joint Life Cover", "death"],
  ["Uang Pertanggungan", "Cendana Proteksi Jiwa", "death"],
  ["Jumlah Diinsuranskan", "Insurans Hayat Bakti", "death"],
  ["Suma asegurada", "Seguro de Vida Andes", "death"],
  ["Somme assurée", "Plan Maladies Graves Sérénité", "critical_illness"],
  ["保额", "安心人寿定期寿险", "death"],
  ["Basic sum insured", "Kestrel Personal Accident Plan", "accidental_death"],
  ["Monthly benefit", "Larkfield Income Protection", "disability_income"],
  ["Monthly benefit", "Income Protection Plan", "disability_income"],
  ["Monthly benefit", "CareShield Life", "long_term_care"],
  // No guess when the plan's name fits no kind, or more than one, or only a kind whose sum is not its main benefit
  ["Sum assured", "Teratai Family Takaful", "other"],
  ["Sum assured", "Life and Critical Illness Plan", "other"],
  ["Sum assured", "Savings Endowment 20", "other"],
  ["Sum assured", undefined as unknown as string, "other"],
  // A name that says more than the sum is not the sum
  ["Sum assured and bonuses", "Heronsgate Joint Life Cover", "other"],
  ["Sum assured", "Seguro de Vida y Accidentes", "other"],
  ["Premium sum", "Heronsgate Joint Life Cover", "other"],
];
for (const [name, plan, want] of plans) eq(`${name} / ${plan}`, ev(name, plan), want);

// A fixed figure printed with a period is paid per period; an income or daily benefit with no period gives no figure.
const pays: [string, string, string, number, string][] = [
  ["disability_income", "Monthly benefit", "Monthly benefit\t£2,400", 2400, "per_month"],
  ["disability_income", "Faedah bulanan", "Faedah bulanan\tRM3.000", 3000, "per_month"],
  ["hospital_daily_cash", "Santunan rawat inap", "Santunan rawat inap per hari\tRp 500.000", 500000, "per_day"],
  ["hospital_daily_cash", "住院津贴", "住院津贴 每日 HK$800", 800, "per_day"],
  ["disability_income", "Income protection", "Income protection\tA$7,500", 7500, "stated"],
  ["hospital_daily_cash", "Hospital cash", "Hospital cash\tS$100", 100, "stated"],
  ["other", "Annual income benefit", "Annual income benefit\tUS$12,000 per year", 12000, "stated"],
  ["death", "Death", "Death\tS$500,000", 500000, "lump_sum"],
  // A premium's period is not the cover's
  ["death", "Death", "Death\tS$500,000 (monthly premium S$50)", 500000, "lump_sum"],
  ["critical_illness", "Penyakit Kritis", "Penyakit Kritis\tRp 200.000.000", 200000000, "lump_sum"],
  // Only a benefit paid per period by its nature takes a period (Critic #270 H1); "24 hours a day" is never one.
  ["death", "死亡保险金", "死亡保险金 HK$1,000,000 每日24小时保障", 1000000, "lump_sum"],
  ["accidental_death", "Accidental Death (24 hours a day)", "Accidental Death (24 hours a day) S$100,000", 100000, "lump_sum"],
  ["death", "Death benefit", "Death benefit S$2,000 per month", 2000, "stated"],
  ["other", "Monthly allowance", "Monthly allowance S$500", 500, "stated"],
];
for (const [event, benefitName, quote, formulaValue, want] of pays)
  eq(`pays ${quote}`, fixedPays(event as never, { benefitName, quote, formulaValue } as never), want);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
