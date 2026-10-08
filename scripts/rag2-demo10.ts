/**
 * The ten required demonstrations, as a runnable transcript (npm run rag2:demo10). TEST-ONLY: PGlite with the real
 * schema, the adversarial suite's two synthetic households (scripts/fixtures/rag2-adv), every turn posted to the REAL
 * chat route (app/api/chat/route.ts) with DEARPOLICY_RAG_LOOP=1 and a SCRIPTED test model (scripts/fixtures/rag2-adv/
 * scenarios.ts). It shows the tools, evidence selection, calculation and save-time gate -- not how a real model behaves.
 *
 * For each demonstration and turn it prints: the household's message; every tool call (arguments in brief, refused or
 * not, result summary); the evidence the reply rests on (document, page, table row / column, passage); the
 * calculation expected (written in the scenario) and the verified calculation record actually saved; and the visible
 * reply exactly as saved in chat_messages. `-- --out <file>` also writes the transcript as Markdown.
 * Exit code 0 always (a transcript, not a test: rag2:adversarial-test holds the assertions).
 */
import { writeFile } from "node:fs/promises";
import type { ChatAnswer } from "@/types";
import { setAdvEnv, startAdvHarness, type AdvHarness } from "./fixtures/rag2-adv/harness";
import { ACCOUNT_N, ACCOUNT_T, DOCS, doc, MEMBERS } from "./fixtures/rag2-adv/household";
import { AdvModel } from "./fixtures/rag2-adv/model";
import * as SC from "./fixtures/rag2-adv/scenarios";

setAdvEnv();
const lines: string[] = [];
const out = (s = "") => { lines.push(s); console.log(s); };
const product = (id: string) => DOCS.find((d) => d.id === id)?.product ?? id;
const person = (id: string | null | undefined) => (id ? MEMBERS.find((m) => m.id === id)?.name ?? id : "-");
const brief = (v: unknown, n = 140) => { const s = typeof v === "string" ? v : JSON.stringify(v); return s.length > n ? s.slice(0, n) + "…" : s; };
const visible = (a: ChatAnswer) => [a.summary, ...(a.details ?? []), ...(a.questions ?? []).map((q) => `[question] ${q.text}`), ...(a.nextSteps ?? []).map((s) => `[next step] ${s}`)].filter(Boolean);

type Demo = { n: number; title: string; scenario: SC.Scenario; between?: (H: AdvHarness, i: number, convId: string) => Promise<void>; after?: (H: AdvHarness) => Promise<void> };
const KS = doc("KIDSAFE").id;
const DEMOS: Demo[] = [
  { n: 1, title: "Factual answer: a cited figure from the right person's column", scenario: SC.S1 },
  { n: 2, title: "Broken arm: asks how it happened where the wording depends on it; nothing inferred", scenario: SC.S2 },
  { n: 3, title: "Hospital stay under the policy's own day-count rule (each complete 24 hours)", scenario: SC.S3 },
  { n: 4, title: "Side question about the speaker during a child's claim", scenario: SC.S4 },
  { n: 5, title: "Stepchild: 'my son' resolved without assuming eligibility", scenario: SC.S5 },
  { n: 6, title: "Corrected discharge date invalidates and recomputes the estimate (first-full-day rule)", scenario: SC.S6b },
  { n: 6, title: "Corrected person (Ethan -> Chloe) invalidates the estimate", scenario: SC.S6a },
  { n: 7, title: "A cap + excess calculation survives the save-time verification", scenario: SC.S7b },
  { n: 8, title: "Missing conditions: useful partial answer, no estimate", scenario: SC.S8 },
  { n: 9, title: "Another household's evidence is inaccessible", scenario: SC.S9loop },
  { n: 10, title: "Evidence of a document deleted mid-conversation cannot support the next answer", scenario: SC.S10,
    between: async (H, _i, convId) => {
      const prior = (await H.saved(ACCOUNT_T, convId)).state?.ragLoop;
      SC.S10_IDS.row = (Object.values(prior?.evidence ?? {}) as any[]).find((e) => /Hospital income/.test(e.table?.rowLabel ?? ""))?.id;
      await H.db.query("UPDATE policies SET lifecycle_state='soft_deleted' WHERE id=$1", [KS]);
      out(`   (between turns: ${product(KS)} was deleted -- lifecycle_state=soft_deleted)`);
    },
    after: async (H) => { await H.db.query("UPDATE policies SET lifecycle_state='active' WHERE id=$1", [KS]); } },
];

async function main() {
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const H = await startAdvHarness();
  out("# DearPolicy conversational RAG -- the ten required demonstrations");
  out("");
  out("SCRIPTED TEST MODEL through the real chat route (PGlite, DEARPOLICY_RAG_LOOP=1). Synthetic households: Tan (Brightwater KidSafe accident plan, Corallis MediGuard) and Nair (Veridian FamilyFirst hospital cash, Lumora SecureMed; shared login, two stepsons).");
  for (const d of DEMOS) {
    const s = d.scenario, account = s.account === "T" ? ACCOUNT_T : ACCOUNT_N;
    out(""); out(`## ${d.n}. ${d.title}  (scenario ${s.id}, household ${s.account === "T" ? "Tan" : "Nair"})`);
    out(`Expected: ${s.expect.visible.join("; ")}`);
    if (s.expect.calculation) out(`Expected calculation: ${s.expect.calculation}`);
    const model = new AdvModel(s.turns); installLoopModel(model);
    let conv: { id?: string; rev?: number } = {};
    try {
      for (const [i, msg] of s.messages.entries()) {
        if (i && d.between) await d.between(H, i, conv.id!);
        const a = await H.send(account, msg, conv);
        conv = { id: a.conversationId, rev: a.conversationRevision };
        const saved = await H.saved(account, conv.id!);
        const loop = saved.state?.ragLoop, t = loop?.turns?.at(-1);
        out(""); out(`### Turn ${i + 1}`); out(`USER: ${msg}`);
        out("Tool calls:");
        for (const c of t?.toolCalls ?? []) out(`  - ${c.name}(${brief(c.args, 160)}) -> ${c.ok ? "ok" : "REFUSED: " + brief(c.error, 220)}${c.summary ? " " + brief(c.summary, 160) : ""}`);
        out("Evidence selected:");
        const ev = ((t?.evidenceChosen ?? []) as string[]).map((id) => loop.evidence[id]).filter(Boolean);
        if (!ev.length) out("  (none)");
        for (const e of ev) out(`  - [${e.id}] ${product(e.policyId)} p${e.passage.onPage}${e.table ? ` | row "${e.table.rowLabel}" | column "${e.table.columnHeader}"` : ""} | for ${person(e.subjectId)} | "${brief(e.passage.text.replace(/\s+/g, " "), 200)}"`);
        const recs = [...(saved.answer?.computations ?? []), ...(((saved.answer as any)?.calculations ?? []) as any[])];
        out("Calculation (verified record saved):");
        if (!recs.length) out("  (none saved)");
        for (const r of recs as any[]) {
          out(`  - ${r.calculator ?? r.operation}: result ${r.result.currency} ${r.result.value} (rounding ${r.rounding?.mode ?? "-"}/${r.rounding?.precision ?? "-"})`);
          for (const o of r.operands ?? []) out(`      operand: ${o.label ?? o.role ?? "-"} = ${o.value ?? o.amount ?? "-"} ${o.currency ?? ""} [${o.source ?? (o.binding ? "document" : "household")}${o.attribution ? `: "${o.attribution}"` : ""}${o.binding ? `: p${o.binding.pageStart} ${o.binding.column ?? ""}` : ""}]`);
          for (const st of r.steps ?? []) out(`      step: ${typeof st === "string" ? st : brief(st.text ?? st.description ?? st, 200)}`);
        }
        if (t?.dropped?.length) { out("Dropped by the composer:"); for (const x of t.dropped) out(`  - "${brief(x.sentence, 160)}" -- ${brief(x.reason, 200)}`); }
        if (t?.gate?.length) { out("Removed by the save-time gate:"); for (const x of t.gate) out(`  - ${x.figure}: ${brief(x.reason, 200)}`); }
        out("REPLY (as saved):");
        for (const l of visible(saved.answer)) out(`  > ${l}`);
        if (saved.answer?.disclaimer) out(`  (notice) ${saved.answer.disclaimer}`);
      }
    } catch (e) { out(`  ERROR: ${e instanceof Error ? e.message : String(e)}`); }
    installLoopModel(null);
    await d.after?.(H);
  }
  // 9 (tool level): household Tan's tools against household Nair's documents and people.
  const tools = await import("@/lib/rag2/tools");
  const ctx = tools.createToolContext({ accountId: ACCOUNT_T });
  const env = { ...process.env, DEARPOLICY_RAG_TOOLS: "1" } as NodeJS.ProcessEnv;
  const FF = doc("FAMILYFIRST").id;
  out(""); out("## 9 (tool level). Household Tan's tool context against household Nair");
  for (const [name, args] of [["read_page", { policy_id: FF, page: 1 }], ["select_table_value", { policy_id: FF, benefit: "Daily hospital cash", subject_id: MEMBERS.find((m) => m.pref === null && m.name === "Rohan Nair")!.id }], ["search_passages", { query: "daily hospital cash insured child", policy_ids: [FF] }], ["resolve_person", { mention: "Rohan" }]] as [string, Record<string, unknown>][]) {
    const r = await tools.runTool(ctx, name, args, env);
    out(`  - ${name}(${brief(args, 120)}) -> ${r.ok ? brief(r.data, 200) : "refused: " + r.error}`);
  }
  const at = process.argv.indexOf("--out"); if (at > 0 && process.argv[at + 1]) await writeFile(process.argv[at + 1], lines.join("\n") + "\n");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(0); });
