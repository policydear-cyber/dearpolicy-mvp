import fs from "node:fs";
import path from "node:path";

let cached: string | null = null;

export function dearPolicyCoreRules() {
  if (cached) return cached;
  const file = path.join(process.cwd(), "config", "RULES.md");
  try {
    cached = fs.readFileSync(file, "utf8").trim();
  } catch {
    cached = "DearPolicy must use only supplied verified insurance evidence, never invent missing facts, and ask targeted questions when material claim facts are missing.";
  }
  return cached;
}
