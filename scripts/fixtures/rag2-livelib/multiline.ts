/**
 * V1.5 (s52-live-1 follow-up): the live-library household with its Summary of Benefits page 13 laid out the harder way
 * -- the leg row's label wrapped over two lines, the arm row's percentage on its own line, and the Other Fracture table
 * (a percentage of the Sum Insured, with a DIFFERENT leg percentage) printed right below on the same page -- plus a
 * page 14 Dislocation table with a conflicting row (Shoulder 20% and 30%) and an incomplete one (Hip: \"see Note 2\").
 * Synthetic; placeholder names and numbers only. Used by PART=multiline of scripts/rag2-live-verify-regressions.ts.
 */
import * as LH from "./household";

const pad = (cells: string[]) => cells.map((c, i) => (i < cells.length - 1 ? c.padEnd(60) : c)).join("");
export const SUM_P13_MULTILINE = [
  "KestrelOne Public Officers Group Personal Accident - Summary of Benefits   Page 12 of 36",
  "Section D - Simple Fracture",
  "Simple Fracture Benefit Limit: S$5,000",
  "We will pay the percentage of the Simple Fracture Benefit Limit shown below for a Simple Fracture of a nature listed, caused by an Accident.",
  pad(["Bone fractured", "Compensation (% of S$5,000)"]),
  pad(["Skull", "100%"]),
  "Jaw, Pelvis, Leg,",
  pad(["Ankle or Knee", "50%"]),
  "Arm, Wrist or Elbow",
  pad(["", "40%"]),
  pad(["Collarbone or Rib", "20%"]),
  "Section E - Other Fracture",
  "Other Fracture means a fracture that is not a Simple Fracture, including a compound (open) fracture. We will pay the percentage of the Sum Insured shown below.",
  pad(["Bone fractured", "Compensation (% of Sum Insured)"]),
  pad(["Skull (Other Fracture)", "100%"]),
  pad(["Jaw, Pelvis, Leg, Ankle or Knee (Other Fracture)", "60%"]),
  pad(["Arm, Wrist or Elbow (Other Fracture)", "25%"]),
].join("\n");
export const SUM_P14_DISLOCATION = [
  "KestrelOne Public Officers Group Personal Accident - Summary of Benefits   Page 13 of 36",
  "Section F - Dislocation",
  "Dislocation Benefit Limit: S$3,000",
  pad(["Joint dislocated", "Compensation (% of S$3,000)"]),
  pad(["Shoulder", "20%"]),
  pad(["Hip", "see Note 2"]),
  pad(["Shoulder", "30%"]),
  pad(["Finger", "5%"]),
].join("\n");
export const ACCOUNT = LH.ACCOUNT, OTHER_ACCOUNT = LH.OTHER_ACCOUNT, M = LH.M, doc = LH.doc;
export const DOCS = LH.DOCS.map((d) => (d.key === "SUMMARY" ? { ...d, hash: "sha256:livelib-summary-multiline", pages: { ...d.pages, 13: SUM_P13_MULTILINE, 14: SUM_P14_DISLOCATION } } : d));
