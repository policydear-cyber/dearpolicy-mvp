/**
 * Round 15: the independent battery's households must never be named in
 * product code. Every person (full and preferred name), insurer, product,
 * policy number and document file name in scripts/fixtures/r7-independent
 * manifests is searched for in lib/ and app/ (whole words, any case); a hit
 * means a rule was written for these fixtures instead of for any family, and
 * fails the suite.
 *
 * Allowed: the names of Singapore's national schemes, which any household's
 * documents use and which the app must know (they are not fixture inventions),
 * and lib/ai/chaos-ingest.ts: the test-only chaos reader (refused outside tests)
 * whose default names belong to the older Round 6/7 fixtures, which happen to
 * share common given names with these households.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { ROOT, HOUSEHOLDS, readManifest } from "./household";

const NOT_PRODUCT = new Set([path.join("lib", "ai", "chaos-ingest.ts")]);
const NATIONAL_SCHEMES = /^(?:CareShield Life|MediShield Life|ElderShield|MediSave|CPF)(?: \(national scheme\))?$/i;

export async function fixtureTerms(): Promise<string[]> {
  const terms = new Set<string>();
  for (const h of HOUSEHOLDS) {
    const m = await readManifest(h);
    for (const p of m.members) for (const n of [p.display_name, p.preferred_name]) if (n && n.trim().length >= 3) terms.add(n.trim());
    for (const d of m.documents) {
      for (const n of [d.insurer, d.product_name, d.policy_number, d.filename.replace(/\.pdf$/i, "")]) if (n && n.trim().length >= 4) terms.add(n.trim());
      // An insurer's own name without its legal suffix ("Kranji Life Assurance" of "Kranji Life Assurance Pte Ltd").
      const bare = (d.insurer ?? "").replace(/\s*\(.*?\)\s*/g, " ").replace(/\b(?:Pte\.?|Ltd\.?|Berhad|Singapore Branch|Limited)\b/gi, " ").replace(/\s+/g, " ").trim();
      if (bare.split(" ").length >= 2) terms.add(bare);
    }
  }
  return [...terms].filter((t) => !NATIONAL_SCHEMES.test(t)).sort();
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) { if (!/node_modules|\.next/.test(name)) walk(p, out); }
    else if (/\.(?:[cm]?[jt]sx?|json|sql|css|md)$/.test(name)) out.push(p);
  }
  return out;
}

/** Every product-code line that names a fixture person, insurer, product, policy number or file. */
export async function fixtureLeaks(dirs = ["lib", "app"]): Promise<string[]> {
  const terms = await fixtureTerms();
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const re = new RegExp("(?<![\\p{L}\\p{N}])(?:" + terms.map(esc).join("|") + ")(?![\\p{L}\\p{N}])", "iu");
  const hits: string[] = [];
  for (const dir of dirs) for (const file of walk(path.resolve(dir))) {
    if (NOT_PRODUCT.has(path.relative(process.cwd(), file))) continue;
    readFileSync(file, "utf8").split("\n").forEach((line, i) => { const m = re.exec(line); if (m) hits.push(path.relative(process.cwd(), file) + ":" + (i + 1) + ": “" + m[0] + "”"); });
  }
  return hits;
}
void ROOT;
