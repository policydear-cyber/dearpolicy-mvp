/**
 * Round 10: grows a fixture household to scale (10 people, 40 documents) by
 * cloning its own documents -- every row the real ingestion pipeline wrote
 * for them (pages, chunks, benefits, cover, conditions, premiums, ledger
 * rows) -- onto five more people, with each clone's names, policy numbers
 * and ids rewritten so every clone is a distinct person's distinct policy.
 * Quotes stay verifiable: the same rewrite applies to the page text and to
 * every quote taken from it.
 */
import { createHash } from "node:crypto";

type Db = { query: <T = Record<string, unknown>>(q: string, p?: unknown[]) => Promise<{ rows: T[] }> };
export type ScalePerson = { id: string; display_name: string; preferred_name: string; relationship: string };
export const SCALE_PEOPLE: ScalePerson[] = [
  { id: "70000000-0000-4000-8000-000000000001", display_name: "Chua Hui Min", preferred_name: "Hui Min", relationship: "other" },
  { id: "70000000-0000-4000-8000-000000000002", display_name: "Ong Kok Leong", preferred_name: "Kok Leong", relationship: "other" },
  { id: "70000000-0000-4000-8000-000000000003", display_name: "Teo Rui En", preferred_name: "Rui En", relationship: "other" },
  { id: "70000000-0000-4000-8000-000000000004", display_name: "Koh Bee Leng", preferred_name: "Bee Leng", relationship: "other" },
  { id: "70000000-0000-4000-8000-000000000005", display_name: "Ho Zhi Hao", preferred_name: "Zhi Hao", relationship: "other" },
];
const TABLES = ["policy_pages", "policy_chunks", "policy_benefits", "policy_coverages", "policy_cover_conditions", "policy_reference_coverages", "policy_detected_people", "premium_records", "coverage_rules"];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const newId = (seed: string) => { const h = createHash("sha256").update(seed).digest("hex"); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`; };

async function columns(db: Db, table: string) {
  return (await db.query<{ column_name: string; data_type: string; is_generated: string; is_identity: string; column_default: string | null }>(
    "SELECT column_name,data_type,is_generated,is_identity,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position", [table])).rows
    .filter((c) => c.is_generated !== "ALWAYS" && !(c.data_type === "bigint" && /nextval/.test(c.column_default ?? "")) && c.is_identity !== "YES");
}

/** Adds SCALE_PEOPLE to `account` and clones its documents onto them until it holds `documents` documents. */
export async function scaleHousehold(db: Db, account: string, people: ScalePerson[], opts: { documents?: number } = {}) {
  const target = opts.documents ?? 40;
  const t0 = Date.now();
  for (const p of SCALE_PEOPLE) await db.query("INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", [p.id, account, p.display_name, p.preferred_name, p.relationship]);
  const sources = (await db.query<{ id: string; policy_number: string | null; processing_status: string }>(
    "SELECT id::text,policy_number,processing_status FROM policies WHERE account_id=$1 AND lifecycle_state='active' ORDER BY processing_status='ready' DESC,created_at,id", [account])).rows;
  const count = async () => Number((await db.query<{ n: number }>("SELECT count(*)::int n FROM policies WHERE account_id=$1 AND lifecycle_state='active'", [account])).rows[0].n);
  let have = await count();
  // Every name the source documents print, longest first so "Tan Mei Ling" is replaced before "Mei Ling".
  const names = people.flatMap((p) => [p.display_name, p.preferred_name]).filter(Boolean).sort((a, b) => b.length - a.length);
  const cols = new Map<string, Awaited<ReturnType<typeof columns>>>();
  for (const t of ["policies", "policy_members", ...TABLES]) cols.set(t, await columns(db, t));
  const insert = async (table: string, row: Record<string, unknown>) => {
    const cs = cols.get(table)!.filter((c) => c.column_name in row).map((c) => c.column_name);
    await db.query(`INSERT INTO ${table}(${cs.join(",")}) SELECT ${cs.join(",")} FROM jsonb_populate_record(NULL::${table},$1::jsonb) ON CONFLICT DO NOTHING`, [JSON.stringify(row)]);
  };
  let round = 0;
  outer: for (;;) {
    for (const person of SCALE_PEOPLE) {
      for (const src of sources) {
        if (have >= target) break outer;
        const tag = `${person.id}:${src.id}:${round}`;
        const pid = newId(tag);
        const rewrite = (json: string) => {
          let s = json.split(src.id).join(pid);
          for (const p of people) s = s.split(p.id).join(person.id);
          for (const n of names) s = s.replace(new RegExp("\\b" + esc(n) + "\\b", "g"), people.some((p) => p.display_name === n) ? person.display_name : person.preferred_name);
          if (src.policy_number) s = s.split(src.policy_number).join(src.policy_number + "-" + (SCALE_PEOPLE.indexOf(person) + 1) + (round ? String.fromCharCode(65 + round) : ""));
          return s;
        };
        const pol = (await db.query<{ j: Record<string, unknown> }>("SELECT to_jsonb(p) j FROM policies p WHERE id=$1", [src.id])).rows[0].j;
        const p2 = JSON.parse(rewrite(JSON.stringify(pol))) as Record<string, unknown>;
        p2.id = pid; p2.family_member_id = person.id; p2.file_hash = p2.file_hash ? "sha256:" + pid : null; p2.supersedes_id = null;
        p2.storage_key = String(p2.storage_key ?? "x.pdf");
        await insert("policies", p2);
        await insert("policy_members", { policy_id: pid, family_member_id: person.id, account_id: account, source: "r10-scale" });
        for (const table of TABLES) {
          const rows = (await db.query<{ j: Record<string, unknown> }>(`SELECT to_jsonb(t) j FROM ${table} t WHERE account_id=$1 AND policy_id=$2`, [account, src.id]).catch(() => ({ rows: [] }))).rows;
          for (const { j } of rows) {
            const r = JSON.parse(rewrite(JSON.stringify(j))) as Record<string, unknown>;
            if (typeof r.id === "string") r.id = newId(tag + ":" + table + ":" + String(j.id));
            if ("source_document_id" in r && r.source_document_id) r.source_document_id = pid;
            if ("dedupe_key" in r && r.dedupe_key) r.dedupe_key = String(r.dedupe_key) + ":" + pid;
            await insert(table, r);
          }
        }
        have++;
      }
    }
    round++;
    if (round > 10) break;
  }
  people.push(...SCALE_PEOPLE.filter((p) => !people.some((q) => q.id === p.id)));
  return { people: people.length, documents: await count(), ms: Date.now() - t0 };
}
