/**
 * Death-journey release: the faithful anonymised actual-library household (./actual-lib.ts) with ADJACENT SECTIONS added to the
 * product summary, as labelled CONTROLS (not reproductions): the real pages were not available to this work (the
 * actual-library report named in the request was not attached), so the sections that the report says neighbour the Simple
 * Fracture section -- "Total and Permanent Dismemberment due to Accident" -- and the death sections are written with
 * DELIBERATELY SIMILAR wording and the actual layout conventions of the stored pages (bullet + tab cells, "(% of ...)"
 * headers, wrapped sentences, "Page N of 36" footer). Everything in actual-lib.ts is unchanged; only the product summary
 * gains page 12 and a changed page 13.
 *   INVENTED here: page 12 (Group Term Life / Accidental Death / natural-catastrophe wording) and the Dismemberment section
 *   at the head of page 13, including its "within 365 days" window and "Loss of one leg" row.
 */
import * as A from "./actual-lib";
import type { FxDoc } from "../rag2/household";

export const ACCOUNT = A.ACCOUNT, OTHER_ACCOUNT = A.OTHER_ACCOUNT, M = A.M;

export const PS_P12_DJ = [
  "Insurance Benefits",
  "•\tGroup Term Life: Death or Terminal Illness\t100% of Sum Assured",
  "Death must occur while the Insured Person is covered under the Scheme. The Sum Assured is the amount on the",
  "certificate of the Insured Person.",
  "•\tAccidental Death\t100% of Sum Insured",
  "If an Insured Person sustains bodily injury as a result of an Accident, which results in his death within 365 days",
  "of the Accident, we will pay the Sum Insured.",
  "Page 11 of 36",
].join("\n");

/** The Dismemberment section sits directly above the Simple Fracture section, as the report describes. */
export const PS_P13_DJ = A.PS_P13.replace("(For details on the plan benefits, please refer to aldermoor.example/SCHEMEX)\n", [
  "(For details on the plan benefits, please refer to aldermoor.example/SCHEMEX)",
  "•\tTotal and Permanent Dismemberment due to Accident",
  "If an Insured Person sustains bodily injury as a result of an Accident, which",
  "results in Total and Permanent Dismemberment of the nature mentioned in the table below, within 365 days of the",
  "Accident, we will pay the relevant amount specified in the table below:",
  "Schedule\tCompensation",
  "(% of Sum Insured)",
  "Loss of two limbs or of sight in both eyes\t100%",
  "Loss of one leg\t50%",
  "Loss of one arm\t50%",
  "",
].join("\n"));

export const DOCS: FxDoc[] = A.DOCS.map((d) => d.key === "PRODUCT_SUMMARY" ? { ...d, hash: d.hash + "-dj", pages: { 12: PS_P12_DJ, 13: PS_P13_DJ } } : d);
export const doc = (key: string) => DOCS.find((d) => d.key === key)!;
export const { PS_P13, PA_P8, BK_P9, CERT_P1 } = A;
