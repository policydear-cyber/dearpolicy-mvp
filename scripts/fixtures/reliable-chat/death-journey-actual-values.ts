/**
 * Death-journey release, reconciled with the actual-library verification report (DearPolicy PR55, 18 Oct 2026): in the actual
 * library the certificate prints Group Term Life S$1,000,000 and Group Personal Accident S$600,000, both dated 06/10/2022.
 * This household is ./death-journey.ts with ONLY the first member's two certificate rows changed to those printed values and
 * that date. ./death-journey.ts keeps its S$500,000 / 01/04/2024 figures as a DELIBERATELY DIFFERENT CONTROL: it is not, and is
 * never described as, a reproduction of the actual values. Everything else (names, policy numbers, wording, the second
 * member's own row) is anonymised and invented exactly as in ./actual-lib.ts.
 */
import * as DJ from "./death-journey";

export const ACCOUNT = DJ.ACCOUNT, OTHER_ACCOUNT = DJ.OTHER_ACCOUNT, M = DJ.M;

const swap = (page: string, amount: string, to: string) =>
  page.replace(new RegExp(`(Lee Wei Ming, Daniel\\t)${amount.replace("$", "\\$")}(\\tAs of\\t)01/04/2024`), (_m, a, b) => `${a}${to}${b}06/10/2022`);
const PAGE1 = swap(swap(DJ.CERT_P1, "S$500,000", "S$1,000,000"), "S$600,000", "S$600,000");
if (PAGE1 === DJ.CERT_P1 || !PAGE1.includes("S$1,000,000")) throw new Error("death-journey-actual-values: the certificate rows were not found");

export const DOCS = DJ.DOCS.map((d) => d.key === "CERT" ? { ...d, hash: d.hash + "-real", effective: "2022-10-06", documentDate: "2022-10-06", pages: { 1: PAGE1 } } : d);
export const doc = (key: string) => DOCS.find((d) => d.key === key)!;
