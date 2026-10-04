/**
 * Round 11 blind evaluation (npm run r11:blind-test).
 *
 * 155 conversations written independently of earlier batteries
 * (scripts/r11/battery.ts), run through the REAL chat route against the three
 * fixture households with the deterministic model stand-in, and judged by
 * scripts/r11/judge.ts: every answer scores 0-2 against expectations taken
 * from the documents themselves (must-mention, must-not-mention, must-cite
 * page, right person) plus plain-reader rules. Fails on any score-0 answer.
 *
 * R11_ONLY=<id substring> runs a subset; R11_DUMP=<file> writes every turn as JSON lines.
 */
import { writeFileSync, appendFileSync } from "node:fs";
import { NextRequest } from "next/server";
import type { ChatAnswer } from "@/types";

Object.assign(process.env, { DEARPOLICY_DETERMINISTIC_MODEL: "synthetic-e2e", E2E_RUN_ID: "r11blind", DEV_AUTH_ENABLED: "1", MODEL_PRESET: process.env.MODEL_PRESET || "gemini", GEMINI_API_KEY: process.env.GEMINI_API_KEY || "ci" });
delete process.env.PINECONE_API_KEY; delete process.env.SUPABASE_URL;

type HHKey = "tl" | "rh" | "ch";

async function main() {
  const started = Date.now();
  const watchdog = setTimeout(() => { console.error("WATCHDOG: no completion in 25 minutes"); process.exit(3); }, 25 * 60_000);
  globalThis.fetch = (async (input: RequestInfo | URL) => { throw new Error("network disabled: " + String(input)); }) as typeof fetch;
  const out = console.log;
  console.info = () => undefined; console.debug = () => undefined; console.warn = () => undefined;
  console.log = (...args: unknown[]) => { if (typeof args[0] === "string" && /^(?:\{"|\[telemetry\]|SQL note)/.test(args[0])) return; out(...args); };

  const { battery } = await import("./r11/battery");
  const { judge, figuresIn, said } = await import("./r11/judge");
  const selfFails = judgeSelfTest(judge);
  if (selfFails.length) { out("JUDGE SELF-TEST FAILED:\n- " + selfFails.join("\n- ")); process.exit(1); }
  out("judge self-test: ok");

  const only = process.env.R11_ONLY, dump = process.env.R11_DUMP;
  if (dump) writeFileSync(dump, "");
  const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  const all = battery();
  const results: { id: string; cat: string; turn: number; say: string; score: number; defects: { major: boolean; rule: string; text: string }[]; summary: string }[] = [];

  const households: [HHKey, () => Promise<{ F: { ACCOUNT: string; PEOPLE: { id: string; display_name: string; preferred_name: string; relationship: string }[] }; db: { query: <T>(s: string, p?: unknown[]) => Promise<{ rows: T[] }> }; foreign: string[]; keys: Record<string, string> }>][] = [
    ["tl", async () => { const F = await import("./r6/fixture"); const h = await F.buildHousehold(); return { F, db: h.db as never, foreign: ["Goh Boon Kiat", "Boon Kiat", "Ong Kai"], keys: { ML: F.MEILING, WJ: F.WEIJIE, XY: F.XINYI, SL: F.SIEWLAN, WM: F.WEIMING } }; }],
    ["rh", async () => { const F = await import("./r7/fixture"); const h = await F.buildHousehold(); return { F, db: h.db as never, foreign: ["Ong Siew Hwa", "Siew Hwa"], keys: { RA: F.RAHMAN, AM: F.AMINAH, IR: F.IRFAN, AI: F.AISYAH, HA: F.HAFIZ, MA: F.MARIA } }; }],
    ["ch", async () => { const F = await import("./r10/fixture"); const h = await F.buildHousehold({ perDocumentTimeoutMs: 90_000 }); return { F, db: h.db as never, foreign: ["Tay Hui Min", "Hui Min"], keys: { KL: F.KOKLEONG, BH: F.BOONHUAT, AL: F.AHLIAN } }; }],
  ];
  const { POST } = await import("@/app/api/chat/route");
  for (const [hh, build] of households) {
    const convs = all.filter((c) => c.hh === hh && (!only || c.id.includes(only)));
    if (!convs.length) continue;
    const t0 = Date.now();
    const H = await build();
    out(`household ${hh} built in ${Date.now() - t0} ms`);
    const pages = (await H.db.query<{ text: string }>("SELECT pp.text FROM policy_pages pp JOIN policies p ON p.id=pp.policy_id WHERE p.account_id=$1", [H.F.ACCOUNT])).rows.map((r) => r.text).join("\n");
    const prem = (await H.db.query<{ amount: string }>("SELECT amount::text amount FROM premium_records WHERE account_id=$1", [H.F.ACCOUNT])).rows.map((r) => Number(r.amount));
    const policyFile = new Map((await H.db.query<{ id: string; f: string }>("SELECT id::text id, coalesce(original_filename,'') || ' ' || coalesce(product_name,'') f FROM policies WHERE account_id=$1", [H.F.ACCOUNT])).rows.map((r) => [r.id, r.f] as [string, string]));
    const people = Object.entries(H.keys).map(([key, id]) => { const p = H.F.PEOPLE.find((x) => x.id === id)!; return { key, self: p.relationship === "self", names: [p.display_name, p.preferred_name, ...(p.relationship === "parent" && hh === "ch" ? [p.preferred_name === "Papa" ? "Dad" : "Mum"] : [])] }; });
    const truth = { people, foreignNames: H.foreign, figures: new Set([...figuresIn(pages), ...prem]), policyFile };
    for (const c of convs) {
      const conv: { id?: string; rev?: number } = {};
      let member = c.member ? H.keys[c.member] : null, userText = "";
      for (const [i, turn] of c.turns.entries()) {
        userText += "\n" + turn.say;
        process.env.DEV_ACCOUNT_ID = H.F.ACCOUNT;
        let status = 0, data: { answer?: ChatAnswer; error?: string } = {}, err = "";
        try {
          const res = await POST(new NextRequest("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ familyMemberId: member, scope: member ? "member" : "family", question: turn.say, conversationId: conv.id, conversationRevision: conv.rev, asynchronous: false, timeZone: "Asia/Singapore" }) }));
          status = res.status; data = await res.json(); err = String(data.error ?? "");
        } catch (e) { err = (e instanceof Error ? e.stack ?? e.message : String(e)).slice(0, 400); }
        const a = status === 200 ? data.answer ?? null : null;
        if (a) { conv.id = a.conversationId ?? conv.id; conv.rev = a.conversationRevision ?? conv.rev; if (a.resolvedFamilyMemberId) member = a.resolvedFamilyMemberId; }
        const expect = turn.expect && (!turn.expect.until || today <= turn.expect.until) ? turn.expect : {};
        const j = judge(a, status, err, { question: turn.say, userText, expect, truth });
        results.push({ id: c.id, cat: c.cat, turn: i + 1, say: turn.say, score: j.score, defects: j.defects, summary: a?.summary ?? err });
        if (dump) appendFileSync(dump, JSON.stringify({ id: c.id, cat: c.cat, turn: i + 1, say: turn.say, score: j.score, defects: j.defects, said: a ? said(a) : err, mode: a?.mode, questions: a?.questions.map((q) => q.text), citations: a?.citations.map((x) => x.policyName + " p" + x.pageStart) }) + "\n");
      }
    }
  }
  // ---- report
  const dist = [0, 0, 0];
  for (const r of results) dist[r.score]++;
  const byRule = new Map<string, number>();
  for (const r of results) for (const d of r.defects) byRule.set((d.major ? "MAJOR " : "minor ") + d.rule, (byRule.get((d.major ? "MAJOR " : "minor ") + d.rule) ?? 0) + 1);
  out(`\n=== ${results.length} turns in ${new Set(results.map((r) => r.id)).size} conversations, ${Math.round((Date.now() - started) / 1000)} s ===`);
  out(`scores: 2=${dist[2]}  1=${dist[1]}  0=${dist[0]}`);
  for (const [k, n] of [...byRule].sort((a, b) => b[1] - a[1])) out(String(n).padStart(4) + "  " + k);
  for (const r of results.filter((x) => x.score < 2)) {
    out(`\n[${r.score}] ${r.id}#${r.turn} (${r.cat}) "${r.say}"`);
    for (const d of r.defects) out(`   ${d.major ? "✗" : "·"} ${d.rule}: ${d.text}`);
  }
  clearTimeout(watchdog);
  const zero = results.filter((r) => r.score === 0).length;
  out(zero ? `\nR11 BLIND TEST FAILED: ${zero} answer(s) scored 0` : "\nR11 BLIND TEST PASSED: no answer scored 0");
  process.exit(zero ? 1 : 0);
}

/** The judge must catch what it claims to catch (controls on hand-made answers). */
function judgeSelfTest(judge: typeof import("./r11/judge").judge): string[] {
  const fails: string[] = [];
  const base = (summary: string, extra: Partial<ChatAnswer> = {}): ChatAnswer => ({ mode: "answer", summary, details: [], claimItems: [], nextSteps: [], confidence: null, citations: [], disclaimer: "", claimSessionId: null, questions: [], knownFacts: [], missingFacts: [], ...extra });
  const truth = { people: [{ key: "A", names: ["Tan Mei Ling", "Mei Ling"], self: true }, { key: "B", names: ["Lim Wei Jie", "Wei Jie"] }], foreignNames: ["Goh Boon Kiat"], figures: new Set([3500, 800000]), policyFile: new Map<string, string>() };
  const run = (a: ChatAnswer, expect = {}, userText = "q") => judge(a, 200, "", { question: "q", userText, expect, truth });
  const cases: [string, ReturnType<typeof run>, (r: ReturnType<typeof run>) => boolean][] = [
    ["clean answer scores 2", run(base("Your deductible is S$3,500 a policy year.")), (r) => r.score === 2],
    ["invented figure", run(base("Your deductible is S$3,000 a policy year.")), (r) => r.defects.some((d) => d.rule === "invented figure")],
    ["leak", run(base("Your deductible is undefined for this policy year.")), (r) => r.score === 0],
    ["repetition", run(base("The deductible is paid once each policy year by you. The deductible is paid once each policy year by you.")), (r) => r.defects.some((d) => d.rule === "repetitive")],
    ["unprinted not covered", run(base("Dental work is not covered under your plan.")), (r) => r.defects.some((d) => /not covered/.test(d.rule))],
    ["printed not covered allowed", run(base("Dental work is not covered under your plan."), { notCoveredOk: true }), (r) => r.score === 2],
    ["wrong person", run(base("Wei Jie has S$800,000 of cover."), { person: ["A"], notPerson: ["B"] }), (r) => r.defects.some((d) => /person/.test(d.rule))],
    ["other household", run(base("Goh Boon Kiat has a policy too.")), (r) => r.defects.some((d) => d.rule === "other household leaked")],
    ["two questions", run(base("A few questions first.", { mode: "fact_finding", questions: [{ id: "a", text: "When?", type: "date", why: "" }, { id: "b", text: "Where?", type: "text", why: "" }] })), (r) => r.score === 0],
    ["must mention", run(base("Your plan has a deductible."), { must: [/3,500/] }), (r) => r.score === 0],
    ["decline", run(base("Sure, here is how to do it."), { decline: true }), (r) => r.score === 0],
    ["missing citation is minor", run(base("Your deductible is S$3,500 a policy year."), { cite: [{ doc: /x/, page: 1 }] }), (r) => r.score === 1],
    ["user's own figure allowed", run(base("Your bill of S$18,000 is being looked at."), {}, "bill is $18,000"), (r) => r.score === 2],
  ];
  for (const [name, r, ok] of cases) if (!ok(r)) fails.push(name + ": " + JSON.stringify(r));
  return fails;
}

main().catch((e) => { console.error(e); process.exit(2); });
