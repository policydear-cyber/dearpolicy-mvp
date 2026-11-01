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
  // A premium, contribution, waiver or value row is never the cover it names, in any language (TE #270 F1)
  ["Pengecualian Sumbangan atas Kematian", "other"], ["Pengecualian Caruman (Hilang Upaya Menyeluruh dan Kekal)", "other"],
  ["Pembebasan Premi karena Penyakit Kritis", "other"], ["Exención de primas por invalidez total y permanente", "other"], ["身故豁免保费", "other"],
  ["Exonération des cotisations en cas de décès", "other"], ["Nilai Tunai Kematian", "other"], ["Pengembalian Premi Kematian", "other"],
  ["身故退还保费", "other"], ["Rückkaufswert bei Todesfall", "other"], ["Beitragsbefreiung bei Berufsunfähigkeit", "other"], ["Waiver of premium on death", "other"],
  // ...but a plan tier or a reimbursement of costs is still a cover
  ["Premium Plan death benefit", "death"], ["Premier Death Benefit", "death"], ["Contribution Takaful death benefit", "death"],
  ["Remboursement des frais médicaux", "hospital_medical_expense"], ["Rückerstattung der Behandlungskosten", "hospital_medical_expense"],
  // A negated accident is death from any other cause, never accidental death (TE #270 F2)
  ["Kematian bukan akibat kemalangan", "death"], ["Muerte no accidental", "death"], ["非意外身故", "death"], ["Non-accidental death", "death"],
  ["Death not caused by an accident", "death"], ["Death (other than by accident)", "death"], ["Kematian selain kemalangan", "death"],
  ["No claim bonus accidental death", "accidental_death"], ["Kematian akibat kemalangan", "accidental_death"], ["意外身故", "accidental_death"],
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

// A row naming only the plan's overall limit is the plan's reimbursed hospital benefit, but only on a plan that is
// exactly one kind and that kind is a hospital plan, in any language. Anywhere else a limit names no event.
const limits: [string, string | undefined, string][] = [
  ["Annual limit", "Harbour Hospital Plan", "hospital_medical_expense"],
  ["Overall annual limit", "Shield Plan Gold", "hospital_medical_expense"],
  ["Annual Limit per policy year", "MediShield Life", "hospital_medical_expense"],
  ["Lifetime limit", "Integrated Shield Plan", "hospital_medical_expense"],
  ["Overall limit of benefits per policy year", "Kingsmere Health Insurance", "hospital_medical_expense"],
  ["Had Tahunan", "Insurans Perubatan Cemerlang", "hospital_medical_expense"],
  ["Had Tahunan", "Takaful Perubatan Mesra", "hospital_medical_expense"],
  ["Batas Manfaat Tahunan", "Asuransi Kesehatan Prima", "hospital_medical_expense"],
  ["Límite anual", "Seguro de Salud Andes", "hospital_medical_expense"],
  ["Plafond annuel", "Assurance Santé Horizon", "hospital_medical_expense"],
  ["Jahreshöchstbetrag", "Krankenversicherung Komfort", "hospital_medical_expense"],
  ["年度限额", "安心医疗保险", "hospital_medical_expense"],
  // Not a hospital plan, more than one kind, no plan name, or a name that says more than the limit: no event
  ["Annual limit", "Heronsgate Joint Life Cover", "other"],
  ["Annual limit", "Kestrel Personal Accident Plan", "other"],
  ["Annual limit", "Wayfarer Travel Plan", "other"],
  ["Annual limit", "Harbour Hospital Cash Plan", "other"],
  // A dental, vision or maternity health plan is not a hospital plan (TE #281 F2)
  ["Annual limit", "Pearl Dental Health Insurance", "other"],
  ["Annual limit", "ClearSight Vision Health Insurance", "other"],
  ["Had Tahunan", "Asuransi Kesehatan Gigi", "other"],
  ["Annual limit", "Bloom Maternity Health Insurance", "other"],
  ["Annual limit", "Hospital and Surgical Plan", "other"],
  ["Annual limit", "Teratai Family Takaful", "other"],
  ["Annual limit", "Savings Endowment 20", "other"],
  ["Annual limit", undefined, "other"],
  ["Had Tahunan", "Insurans Hayat Bakti", "other"],
  ["Room and board limit", "Harbour Hospital Plan", "other"],
  ["Co-insurance limit", "Harbour Hospital Plan", "other"],
  ["Limit of liability", "Harbour Hospital Plan", "other"],
  ["Deductible", "Harbour Hospital Plan", "other"],
  ["Annual premium limit", "Harbour Hospital Plan", "other"],
  // A hospital plan's own "Sum assured" is still not read as a bill limit
  ["Sum assured", "Harbour Hospital Plan", "other"],
];
for (const [name, plan, want] of limits) eq(`limit ${name} / ${plan}`, ev(name, plan as string), want);

// An illness named with its treatment pays the treatment bills, never the illness's lump sum (Critic #281 H: a hospital
// plan's "Annual limit for outpatient cancer drug" was read as a critical illness sum). The illness alone stays a CI.
// Only on a hospital plan (Critic #281 H1): on a CI plan a condition named with its definition wording stays the CI, and
// a CI-plan row is never moved to a reimbursement; with no plan kind the name's own mapping stands.
const treatments: [string, string | undefined, string][] = [
  ["Annual limit for outpatient cancer drug", "Integrated Shield Plan", "hospital_medical_expense"],
  ["Cancer drug treatment", "Harbour Hospital Plan", "hospital_medical_expense"],
  ["Outpatient cancer treatment - chemotherapy and radiotherapy", "MediShield Life", "hospital_medical_expense"],
  ["Rawatan kemoterapi kanser", "Insurans Perubatan", "hospital_medical_expense"],
  ["Tratamiento de cáncer", "Seguro de Salud Andes", "hospital_medical_expense"],
  ["癌症化疗", "医疗保险", "hospital_medical_expense"],
  ["Kidney Failure (requiring dialysis)", "Critical Illness Plan", "critical_illness"],
  ["End-stage kidney failure requiring permanent dialysis", "Early Critical Illness Plan", "critical_illness"],
  ["Major Cancer (requiring treatment)", "Critical Illness Plan", "critical_illness"],
  ["Kanser memerlukan rawatan", "Takaful Penyakit Kritikal", "critical_illness"],
  ["癌症治疗", "重疾险", "critical_illness"],
  ["Cancer treatment benefit", "Cancer Care Plan", "critical_illness"],
  ["Outpatient cancer drug", undefined, "critical_illness"],
  ["Major organ transplant (treatment received)", "Critical Illness Plan", "other"],
  // A treatment alone is a bill benefit on a hospital plan, and never a reimbursement on a CI plan
  ["Kidney dialysis", "Harbour Hospital Plan", "hospital_medical_expense"],
  ["Chemotherapy", "Integrated Shield Plan", "hospital_medical_expense"],
  ["Dialysis", "Critical Illness Plan", "other"],
  ["Cancer drug treatment", "Life and Hospital Plan", "critical_illness"],
  // TE #281 F1: CI-plan rows named with treatment words stay the CI
  ["Cancer treatment benefit", "Lion Critical Illness Plan", "critical_illness"],
  ["Kidney failure treatment benefit", "Lion Critical Illness Plan", "critical_illness"],
  ["Major cancer - 100% of sum assured; minor cancer treatment 25%", "Lion Critical Illness Plan", "critical_illness"],
  ["Cancer", "Living Care Plan", "critical_illness"],
  ["Major cancer", undefined, "critical_illness"],
  ["Kidney failure", undefined, "critical_illness"],
  ["Heart attack of specified severity", undefined, "critical_illness"],
  ["Kanser Tahap Kritikal", undefined, "critical_illness"],
  ["癌症", undefined, "critical_illness"],
  ["Early stage cancer", undefined, "early_critical_illness"],
];
for (const [name, plan, want] of treatments) eq(`treatment ${name} / ${plan}`, ev(name, plan as string), want);

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
