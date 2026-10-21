/** Assembles a household snapshot for the simple baseline from copies made through the Supabase connector:
 * a meta.json (members and each document's details, page count and digest) plus one pages-<policyId>.json per
 * document. Each document's pages must match the digest the database computed,
 * md5(string_agg(md5(text), '' ORDER BY page_number)), so a copying error cannot reach a prompt.
 *   node --import tsx scripts/simple-answer/build-snapshot.ts <snapshot-dir> <household.json out> */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Household, HouseholdDocument, HouseholdPage } from "./household";

const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");
export const pagesDigest = (pages: HouseholdPage[]) => md5([...pages].sort((a, b) => a.page - b.page).map((p) => md5(p.text)).join(""));

type Meta = { accountId: string; members: Household["members"]; documents: (Omit<HouseholdDocument, "pages"> & { pages: number; digest: string })[] };

export function buildSnapshot(dir: string): Household {
  const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as Meta;
  const documents = meta.documents.map(({ digest, pages: count, ...doc }) => {
    const pages = (JSON.parse(readFileSync(join(dir, `pages-${doc.policyId}.json`), "utf8")) as HouseholdPage[]).sort((a, b) => a.page - b.page);
    if (pages.length !== count) throw new Error(`${doc.name}: ${pages.length} pages copied, database has ${count}`);
    if (pagesDigest(pages) !== digest) throw new Error(`${doc.name}: copied text does not match the database digest`);
    return { ...doc, pages };
  });
  return { accountId: meta.accountId, members: meta.members, documents };
}

if (require.main === module) {
  const [dir, out] = process.argv.slice(2);
  if (!dir || !out) throw new Error("usage: build-snapshot.ts <snapshot-dir> <household.json out>");
  const household = buildSnapshot(dir);
  writeFileSync(out, JSON.stringify(household));
  console.log(`${household.documents.length} documents, ${household.documents.reduce((n, d) => n + d.pages.length, 0)} pages, all digests match. Wrote ${out}`);
}
