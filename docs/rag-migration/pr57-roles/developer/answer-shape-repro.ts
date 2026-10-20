/**
 * Answer shape (shorter answers as fields): the statements, bottom line and citations the server sends for the anonymised fracture
 * household's conversations (FR1 and the fx-live-1 repairs), and whether returned = saved = reopened for them. Scripted model, PGlite,
 * no spend. Developer-owned scratch, not a registered test.
 *   node --import tsx docs/rag-migration/pr57-roles/developer/answer-shape-repro.ts [FR1,FX-K6A,...]
 */
import { setEnv, startHarness } from "../../../../scripts/fixtures/rag2-loop/harness";
import * as FX from "../../../../scripts/fixtures/reliable-chat/fracture-conversation";
import { FRACTURE_SCENARIOS } from "../../../../scripts/fixtures/reliable-chat/fracture-scenarios";
import { FX_REPAIR_SCENARIOS } from "../../../../scripts/fixtures/reliable-chat/fx-repairs-scenarios";
import { ScriptedLoopModel } from "@/lib/rag2/loop/scripted-model";
import { alternativeGroupId } from "@/lib/rag2/loop/statement-render";
import { reconcileStatements, sanitizeStoredAnswer } from "@/lib/chat/monetary-boundary";
import { excerptOf } from "@/lib/rag2/evidence";
import { invalidatedAnswer } from "@/lib/chat/stale-answers";
import { buildStatements } from "@/lib/rag2/loop/answer-statements";

process.env.DEARPOLICY_CHAT_CONTRACT = "benefits";
const want = (process.argv[2] ?? "").split(",").filter(Boolean);
// (key order is not content: a saved answer comes back from jsonb with its keys in another order)
const canon = (v: any): any => Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, canon(v[k])])) : v;
const shape = (a: any) => JSON.stringify(canon({ summary: a.summary, details: a.details, bottomLine: a.bottomLine ?? null, statements: a.statements ?? null, citations: (a.citations ?? []).map((c: any) => c.chunkId) }));
let failed = 0;
async function main() {
  setEnv(FX as any);
  const h = await startHarness(FX as any);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  for (const sc of [...FRACTURE_SCENARIOS(), ...FX_REPAIR_SCENARIOS()] as any[]) {
    if (want.length && !want.includes(sc.id)) continue;
    installLoopModel(new ScriptedLoopModel(sc.turns));
    let conv: { id?: string; rev?: number } = {};
    try {
      for (const [i, m] of sc.messages.entries()) {
        const a = await h.send(m, conv);
        conv = { id: a.conversationId!, rev: a.conversationRevision! };
        const saved = (await h.savedAnswer(a.conversationId!)).answer;
        const reopened = sanitizeStoredAnswer(JSON.parse(JSON.stringify(saved)));
        const same = shape(a) === shape(saved) && shape(saved) === shape(reopened);
        if (!same) { failed++; if (process.env.SHAPE_DEBUG) { const x = JSON.parse(shape(a)), y = JSON.parse(shape(saved)), z = JSON.parse(shape(reopened)); for (const k of Object.keys(x)) { if (JSON.stringify(x[k]) !== JSON.stringify(y[k])) console.log("  DIFF returned/saved", k, JSON.stringify(x[k]).slice(0, 300), "||", JSON.stringify(y[k]).slice(0, 300)); if (JSON.stringify(y[k]) !== JSON.stringify(z[k])) console.log("  DIFF saved/reopened", k, JSON.stringify(y[k]).slice(0, 300), "||", JSON.stringify(z[k]).slice(0, 300)); } } }
        const paras = [a.summary, ...(a.details ?? [])].filter((p: string) => p.trim());
        const covered = (a.statements ?? []).map((s: any) => s.fullText).join("\n") === paras.join("\n");
        if (!covered) failed++;
        console.log(`\n=== ${sc.id} turn ${i + 1}: ${m}\n  returned = saved = reopened: ${same}   statements cover every paragraph: ${covered}`);
        console.log(`  BOTTOM LINE: ${a.bottomLine ?? "(none)"}`);
        for (const s of a.statements ?? []) {
          console.log(`  [${s.kind}]${s.group ? ` {${s.group.id}}` : ""} ${s.text}${s.amount ? `\n      amount ${s.amount.text} (currency ${s.amount.currencyResolved ? "stated" : "NOT stated"}${s.amount.illustration ? ", illustration" : ""}) for ${s.personName}${s.basis ? `; basis ${s.basis}` : ""}${s.asOf ? `; as of ${s.asOf}` : ""}` : ""}`);
          for (const c of s.conditions ?? []) console.log(`      condition: ${c}`);
          if (s.source) console.log(`      source: ${s.source.policyName}${s.source.page ? ` p.${s.source.page}` : ""}${s.source.rowLabel ? ` row “${s.source.rowLabel}”` : ""}${s.source.footnote ? ` footnote ${s.source.footnote.marker}: ${s.source.footnote.text}` : ""} cites ${JSON.stringify(s.source.citationIds)}`);
        }
        // (an excerpt never stops mid-sentence: "... are not" with "covered" on the next line)
        for (const c of a.citations ?? []) if (/\b(?:are|is|not|of|and|or|the|to|any)\s*$/i.test(c.excerpt ?? "")) { failed++; console.log(`  FAIL excerpt cut mid-sentence: ${JSON.stringify(c.excerpt)}`); }
        // (a statement's fields never state a number its paragraph does not; every amount it prints is on its card)
        for (const s of a.statements ?? []) if (s.amount && !s.personName) { failed++; console.log(`  FAIL amount without its person: ${s.text}`); }
        for (const c of a.citations ?? []) console.log(`  CITE ${c.chunkId} p.${c.pageStart}: ${JSON.stringify(c.excerpt).slice(0, 220)}`);
      }
    } finally { installLoopModel(null); }
  }
  // Unit checks of the shared pieces.
  const page = ["#", "Arm , Elbow, Wrist or Ribs\t25%", "#", "For the avoidance of doubt, any fractures of thumb, finger and palm are not", "covered", "•\tDisappearance\t100% of Sum Insured"].join("\n");
  const sp = excerptOf("For the avoidance of doubt, any fractures of thumb, finger and palm are not", page);
  const ok1 = sp.replace(/\s+/g, " ") === "For the avoidance of doubt, any fractures of thumb, finger and palm are not covered" && excerptOf("Arm , Elbow, Wrist or Ribs\t25%", page) === "Arm , Elbow, Wrist or Ribs\t25%";
  console.log(`\nUNIT excerpt runs to the end of its sentence (and a table row stays one row): ${ok1} (${JSON.stringify(sp)})`); if (!ok1) failed++;
  const amountCut: any = { summary: "If it applies to Grace, the illustration is S$1,250: 25% of S$5,000; subject to the S$100 deductible.", details: [], claimItems: [], nextSteps: [], citations: [], questions: [], mode: "answer",
    statements: [{ id: "x", kind: "calculation", text: "The illustration is S$1,250.", fullText: "If it applies to Grace, the illustration is S$1,250: 25% of S$5,000; subject to the S$100 deductible.", personName: "Grace", amount: { text: "S$1,250", currencyResolved: true, illustration: true }, basis: "25% of S$5,000", conditions: [] }],
    bottomLine: "Grace gets S$1,250." };
  reconcileStatements(amountCut);
  const ok2 = !amountCut.statements[0].amount && amountCut.statements[0].text === amountCut.summary && amountCut.bottomLine === null;
  console.log(`UNIT a card that leaves out a condition's amount (S$100) is sent as plain text, and an unqualified bottom line is dropped: ${ok2}`); if (!ok2) failed++;
  const extra: any = { ...JSON.parse(JSON.stringify(amountCut)), statements: [{ id: "x", kind: "calculation", text: "The illustration is S$9,999.", fullText: amountCut.summary, personName: "Grace", amount: { text: "S$9,999", currencyResolved: true, illustration: true }, basis: null, conditions: ["subject to the S$100 deductible"] }] };
  reconcileStatements(extra);
  const ok3 = !extra.statements[0].amount && extra.statements[0].text === amountCut.summary;
  console.log(`UNIT a card stating an amount its paragraph does not is sent as plain text: ${ok3}`); if (!ok3) failed++;
  // Critic R23-1: an out-of-date answer (every reason) keeps no card and no bottom line, on return and after reconcile.
  const ok4 = (["policy_deleted", "documents_added"] as const).every((r) => { const a: any = invalidatedAnswer(JSON.parse(JSON.stringify({ ...amountCut, statements: [{ id: "x", kind: "fact", text: "t", fullText: "t", conditions: [] }], bottomLine: "Grace's documents print S$1,250." })), r); reconcileStatements(a); return Array.isArray(a.statements) && a.statements.length === 0 && a.bottomLine === null; });
  console.log(`UNIT an invalidated answer (deleted or added documents) has no statements and no bottom line: ${ok4}`); if (!ok4) failed++;
  // Critic R23-2: only the calculations the relation note rendered are an either/or group; a third, independent one stays outside it.
  const P = ["If it applies to Grace, the Policy A illustration is S$1,250: 25% of S$5,000.", "If it applies to Grace, the Policy B illustration is S$2,000: 20% of S$10,000.", "If it applies to Grace, the Policy C hospital cash is S$300: S$100 a day for 3 days."];
  const grp = { id: "alt:g", kind: "either_or" as const, note: "These are alternatives from different documents, never a total." };
  const draft = (short: string, amt: string, basis: string, group?: any): any => ({ kind: "calculation", short, personName: "Grace", amount: { text: amt, currencyResolved: true, illustration: true }, basis, conditions: [], group, source: null });
  const three: any = { summary: P[0], details: [P[1], P[2]], claimItems: [], nextSteps: ["Contact the insurer."], citations: [], questions: [], mode: "answer" };
  buildStatements(three, null, new Map([[P[0], draft("Policy A: S$1,250", "S$1,250", "25% of S$5,000", grp)], [P[1], draft("Policy B: S$2,000", "S$2,000", "20% of S$10,000", grp)], [P[2], draft("Policy C hospital cash: S$300", "S$300", "S$100 a day for 3 days")]]), []);
  const st = three.statements ?? [];
  const ok5 = st.length === 3 && st[0].group?.id === "alt:g" && st[1].group?.id === "alt:g" && !st[2].group && !!st[2].amount && !/either/.test(three.bottomLine ?? "");
  console.log(`UNIT only the relation note's calculations are grouped; a third independent one is not, and the bottom line says no "either": ${ok5} (${JSON.stringify(three.bottomLine)})`); if (!ok5) failed++;
  // Critic R24-2 / Evidence Reviewer 16: two injuries for one person -- a hip and an arm -- are two separate either/or pairs, never one
  // choice across four amounts. (A live turn naming both parts at once asks which first -- evaluate_benefit's case_conflict -- so the
  // grouping is checked where it is decided: the group id, then the statements and bottom line built from four such cards.)
  const gid = (row: string) => alternativeGroupId("g", ["ps", "bs"], row);
  const ok6 = gid("Arm , Elbow, Wrist or Ribs") === gid("Arm, Elbow, Wrist or Ribs (Other Fracture)") && gid("Hip") === gid("Hip (Other Fracture)") && gid("Hip") !== gid("Arm, Elbow, Wrist or Ribs") && alternativeGroupId("g", ["ps", "bs"], "") === null && alternativeGroupId("g", ["ps", "bs"], "Hip") !== alternativeGroupId("g", ["ps", "other"], "Hip");
  const Q = ["If it applies to Grace, the Product Summary arm illustration is S$1,250: 25% of S$5,000.", "If it applies to Grace, the certificate arm illustration is S$120,000: 20% of S$600,000.", "If it applies to Grace, the Product Summary hip illustration is S$3,750: 75% of S$5,000.", "If it applies to Grace, the certificate hip illustration is S$300,000: 50% of S$600,000."];
  const four: any = { summary: Q[0], details: Q.slice(1), claimItems: [], nextSteps: ["Contact the insurer."], citations: [], questions: [], mode: "answer" };
  const g4 = (id: string | null) => ({ id, kind: "either_or" as const, note: "These are alternatives from different documents, never a total." });
  buildStatements(four, null, new Map([[Q[0], draft("Simple Fracture · Arm", "S$1,250", "25% of S$5,000", g4(gid("Arm , Elbow, Wrist or Ribs")))], [Q[1], draft("Other Fracture · Arm", "S$120,000", "20% of S$600,000", g4(gid("Arm, Elbow, Wrist or Ribs (Other Fracture)")))], [Q[2], draft("Simple Fracture · Hip", "S$3,750", "75% of S$5,000", g4(gid("Hip")))], [Q[3], draft("Other Fracture · Hip", "S$300,000", "50% of S$600,000", g4(gid("Hip (Other Fracture)")))]]), []);
  const gs = new Map<string, number>(); for (const x of four.statements ?? []) if (x.group) gs.set(x.group.id, (gs.get(x.group.id) ?? 0) + 1);
  const ok7 = ok6 && gs.size === 2 && [...gs.values()].every((n) => n === 2) && !/\beither\b/.test(four.bottomLine ?? "") && /for each injury/.test(four.bottomLine ?? "");
  console.log(`UNIT two injuries (hip and arm) give two separate either/or pairs, never one choice across four amounts: ${ok7} (${JSON.stringify([...gs])}; ${JSON.stringify(four.bottomLine)})`); if (!ok7) failed++;
  console.log(failed ? `\n${failed} FAILED` : "\nall consistent");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
