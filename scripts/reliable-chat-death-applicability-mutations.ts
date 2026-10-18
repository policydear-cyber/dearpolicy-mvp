/**
 * Mutation proof for scripts/reliable-chat-death-applicability.ts (dj-live-2 repair): each repair is disabled in turn by a one-line source
 * edit (applied to the working tree, then restored byte for byte), and the applicability suite must FAIL. A repair whose removal leaves the
 * suite green is not proved. The final row disables all of them at once (the pre-repair behaviour at the dj-live-2 boundary).
 *   node --import tsx scripts/reliable-chat-death-applicability-mutations.ts            (about 25 seconds per mutation)
 *   MUT=M3,M5 node --import tsx scripts/reliable-chat-death-applicability-mutations.ts     (one mutation)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

type Edit = { file: string; from: string; to: string };
const R = "lib/rag2/";
export const MUTATIONS: { id: string; repair: string; edits: Edit[] }[] = [
  { id: "M1", repair: "server-written benefit_terms are bound only by their own record's ids (model value ids no longer merged away)", edits: [{ file: R + "loop/statement-render.ts", from: "s.evidence_ids = [...new Set(w.evidence_ids)]; s.value_ids = [...new Set(w.value_ids)];", to: "s.evidence_ids = [...new Set([...((s.evidence_ids as string[]) ?? []), ...w.evidence_ids])]; s.value_ids = [...new Set([...((s.value_ids as string[]) ?? []), ...w.value_ids])];" }] },
  { id: "M2", repair: "the composition lookup never deletes a value another statement holds (dedupe clobber)", edits: [{ file: R + "loop/loop.ts", from: "if (!heldBefore.has(d.valueId)) ctx.values.delete(d.valueId); }", to: "ctx.values.delete(d.valueId); }" }] },
  { id: "M3", repair: "a cached person-row value id is reissued when its value no longer exists", edits: [{ file: R + "evaluate.ts", from: "if (known && ctx.values.has(known)) return known;", to: "if (known) return known;" }] },
  { id: "M4", repair: "a citation of a never-issued value id is set aside when issued ones remain", edits: [{ file: R + "loop/compose.ts", from: "const valIds = issuedVals.length ? issuedVals : allValIds;", to: "const valIds = allValIds;" }] },
  { id: "M5", repair: "a death benefit named but whose amount is not shown is completed from its record", edits: [{ file: R + "loop/loop.ts", from: "!(namedIn(r.benefit, shown) && amountShownIn(r, shown))", to: "!namedIn(r.benefit, shown)" }] },
  { id: "M6", repair: "model statements presenting an excluded benefit's amount are left out", edits: [{ file: R + "loop/loop.ts", from: " || (x?.kind !== \"benefit_terms\" && inapplicableIn(String(x?.subject_id ?? sjA), x ?? {}))", to: "" }] },
  { id: "M7", repair: "the fallback completion and its established statements honour applicability", edits: [{ file: R + "loop/loop.ts", from: "&& !texts.includes(e.text) && !inapplicableIn(e.subjectId ?? subject, e))", to: "&& !texts.includes(e.text))" }, { file: R + "loop/loop.ts", from: " && !inapplicableIn(subject, { valueIds: [vid] }));", to: ");" }, { file: R + "loop/loop.ts", from: "if (look?.kind === \"one\" && inapplicableIn(subject, { valueIds: [look.valueId] })) { /* the sum insured of a benefit the report excludes is not shown */ }\n        else if (look?.kind === \"one\") {", to: "if (look?.kind === \"one\") {" }] },
  { id: "M8", repair: "the budget fallback (partial answer) honours applicability", edits: [{ file: R + "loop/loop.ts", from: " && !inapplicableIn(v.subjectId, { valueIds: [id] }))", to: ")" }, { file: R + "loop/loop.ts", from: "&& !inapplicableIn(x.subjectId ?? state.subjectId ?? \"\", x)).slice(-3)", to: ").slice(-3)" }] },
  { id: "M9", repair: "the death-stop fallback decides applicability first and names the excluded benefits", edits: [{ file: R + "loop/loop.ts", from: "    await causeGate(subject);\n    const recs = await recordsFor(ctx, subject)", to: "    const recs = await recordsFor(ctx, subject)" }, { file: R + "loop/loop.ts", from: "const cnStop = await causeNote(subject, dc.extra.map((x) => String(x.benefit ?? \"\"))).catch(() => null);", to: "const cnStop = null as Record<string, unknown>[] | null;" }] },
  { id: "M10", repair: "a certificate summary never lists a person under a withheld benefit", edits: [{ file: R + "loop/loop.ts", from: "withheldRows: (sj: string) => new Set(naRecordsFor(sj).filter((r) => !askedDirectly(r)).map((r) => `${r.policy.id}|${nmL(r.benefit)}`)), ", to: "" }] },
  { id: "M11", repair: "'no amount is given' is never left beside the amount it denies", edits: [{ file: R + "loop/loop.ts", from: "  const dropContradictions = (c: Composed | null | undefined) => {\n    if (!c) return;", to: "  const dropContradictions = (c: Composed | null | undefined) => {\n    if (!c || c) return;" }] },
  { id: "M12", repair: "a directly requested historical amount is separated from this event (no 'no amount is given' for it)", edits: [{ file: R + "loop/loop.ts", from: "const amountDisplayed = (r: BenefitRecord) => { const c", to: "const amountDisplayed = (r: BenefitRecord) => { if (r) return false; const c" }] },
  { id: "M13", repair: "applicability is decided from the benefit's own wording; a product heading alone does not decide", edits: [{ file: R + "benefit-applicability.ts", from: "if (r.applicability !== \"person_row\") return { wording: `${r.benefit} is an accident benefit`, kind: \"benefit_name\" };", to: "return { wording: `${r.benefit} is an accident benefit`, kind: \"benefit_name\" };" }] },
  { id: "M14", repair: "applicability reads the household's reported cause (illness / accident / unknown)", edits: [{ file: R + "benefit-applicability.ts", from: "  return { ...base, status: \"not_applicable\", withhold: true,", to: "  return { ...base, status: \"supported\", withhold: false," }] },
  { id: "M15", repair: "an excluded record's terms are not re-rendered by the retained-terms recovery", edits: [{ file: R + "loop/loop.ts", from: " || (notApplicable.has(`${who}|${c[0].id}`) && !askedDirectly(c[0]))) continue;", to: ") continue;" }] },
];
// layered defences: each of these two repairs masks the other for the replay, so the pair is disabled together as well
const pair = (a: string, b: string) => ({ id: `${a}+${b}`, repair: `${a} and ${b} together (layered defences)`, edits: [...MUTATIONS.find((m) => m.id === a)!.edits, ...MUTATIONS.find((m) => m.id === b)!.edits] });
MUTATIONS.push(pair("M1", "M4"), pair("M3", "M4"), pair("M6", "M15"));

const only = process.env.MUT;
const run = () => spawnSync("node", ["--import", "tsx", "scripts/reliable-chat-death-applicability.ts"], { encoding: "utf8", env: { ...process.env, SHOW: "" }, maxBuffer: 64 * 1024 * 1024 });
const failures = (out: string) => out.split("\n").filter((l) => l.startsWith("FAIL ")).map((l) => l.slice(5, 90));
const apply = (edits: Edit[]) => {
  const orig = new Map<string, string>();
  for (const e of edits) {
    const cur = orig.get(e.file) ?? readFileSync(e.file, "utf8");
    if (!orig.has(e.file)) orig.set(e.file, cur);
    const at = readFileSync(e.file, "utf8");
    if (at.split(e.from).length !== 2) throw new Error(`mutation text must occur exactly once in ${e.file}: ${e.from.slice(0, 70)}`);
    writeFileSync(e.file, at.replace(e.from, () => e.to));
  }
  return () => { for (const [f, t] of orig) writeFileSync(f, t); };
};
let bad = 0;
const rows: string[] = [];
const todo = [...MUTATIONS.filter((m) => !only || only.split(",").includes(m.id)), ...(only ? [] : [{ id: "ALL", repair: "all of the above at once", edits: MUTATIONS.flatMap((m) => m.edits) }])];
for (const m of todo) {
  const restore = apply(m.edits);
  let out = "", code = 0;
  try { const r = run(); out = r.stdout + r.stderr; code = r.status ?? 1; } finally { restore(); }
  const f = failures(out);
  const proved = code !== 0 && f.length > 0;
  if (!proved) bad++;
  rows.push(`${proved ? "PROVED " : "NOT PROVED"} ${m.id} (${m.repair}) -> ${f.length} failing check(s)${f.length ? ": " + f.slice(0, 4).join(" | ") : ""}`);
  console.log(rows.at(-1));
}
console.log(bad ? `\n${bad} mutation(s) not proved` : "\nevery repair is proved: disabling it fails the suite");
process.exitCode = bad ? 1 : 0;
