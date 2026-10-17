/**
 * PR #54 (after rc-live-8): the benefit records the model is OFFERED, asserted at the person_benefits boundary (the real
 * tool through the real chat route, scripted model; no model call), over the booklet household with the page faithful
 * to the recorded actual-library passage (scripts/fixtures/reliable-chat/booklet.ts, BOOKLET_CDA=recorded).
 *   BOOKLET_CDA=recorded node --import tsx scripts/reliable-chat-benefit-records.ts      (SHOW=1 prints the records)
 * Both layouts:
 *  - a heading above a paragraph ("Section 5 - <name>" / an unnumbered heading line) printing an amount: a named
 *    benefit with its own conditions and source span, a bare "$" amount marked currency-unresolved;
 *  - a bullet / tab row ("•\t<name>*\tUp to S$2,000"), also wrapped over two lines: its full name, never "•" or "",
 *    with the footnote its marker points to as a condition.
 * Controls: a neighbouring section stays its own record; the separate summary is never merged with the booklet;
 * another person's, a superseded and another household's copy never become Daniel's record; a documented currency.
 */
import { setEnv, startHarness } from "./fixtures/rag2-loop/harness";
import * as B from "./fixtures/reliable-chat/booklet";
import type { ScriptView } from "@/lib/rag2/loop/scripted-model";

if (B.CDA !== "recorded") { console.error("run with BOOKLET_CDA=recorded"); process.exit(2); }
process.env.DEARPOLICY_CHAT_CONTRACT = "benefits";
setEnv(B as any);
let failed = 0, passed = 0;
const check = (name: string, ok: boolean, detail = "") => { if (ok) passed++; else failed++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? "\n     " + detail.replace(/\n/g, "\n     ") : ""}`); };
type Offered = { policy_id: string; product: string; benefit: string; benefit_id?: string; printed: string; conditions: string[]; page: number; evidence: { excerpt?: string; page?: number }; currency?: string; section?: string };

async function main() {
  const h = await startHarness(B as any);
  process.env.DEARPOLICY_RAG_LOOP = "1";
  const { installLoopModel } = await import("@/lib/rag2/loop/model");
  const { ScriptedLoopModel } = await import("@/lib/rag2/loop/scripted-model");
  /** person_benefits as the model receives it, for one person and topic. */
  const offered = async (subject: string, topic = "death after an accident, funeral expenses"): Promise<Offered[]> => {
    let seen: any = null;
    installLoopModel(new ScriptedLoopModel([{ user: /./, steps: [
      () => [{ name: "person_benefits", arguments: { subject_id: subject, topic } }],
      (v: ScriptView) => { seen = v.turn; return [{ name: "final_answer", arguments: { subject_id: subject, sentences: [{ kind: "uncertainty", text: "Nothing more is established here.", evidence_ids: [] }] } }]; },
    ] }]));
    try { await h.send("What do our documents show for a death after an accident?", {}); } finally { installLoopModel(null); }
    const data = seen?.find((o: any) => o.name === "person_benefits")?.result?.data;
    const list: Offered[] = (data?.documents ?? []).flatMap((d: any) => (d.benefits ?? []).map((b: any) => ({ ...b, policy_id: d.policy_id, product: d.product })));
    if (process.env.SHOW) console.log(JSON.stringify(list.map((x) => [x.product, x.benefit, x.printed, x.conditions, x.page, x.evidence?.excerpt?.slice(0, 120)]), null, 1));
    return list;
  };
  const D = B.M.daniel.id, G = B.M.grace.id;
  const booklet = B.doc("BOOKLET").id, summary = B.doc("SUMMARY").id;
  const named = (l: Offered[], re: RegExp, policy?: string) => l.filter((x) => re.test(x.benefit) && (!policy || x.policy_id === policy));

  const d1 = await offered(D);
  // ---- heading + paragraph (the booklet's Section 5)
  const cda = named(d1, /^Compassionate Death Allowance Benefit$/, booklet);
  check("heading+paragraph: the booklet's allowance is offered as a named benefit with a benefit_id", cda.length === 1 && !!cda[0].benefit_id, JSON.stringify(d1.map((x) => [x.product, x.benefit])));
  const c = cda[0];
  check("heading+paragraph: its conditions are its own paragraph (accidental death, proof of death and the prescribed form, Core / Voluntary)", !!c && c.conditions.join(" ").includes("dies as a result of an Accident") && /prescribed form/.test(c.conditions.join(" ")) && /Core Scheme/.test(c.conditions.join(" ")), JSON.stringify(c));
  check("heading+paragraph: the bare $2,000 is marked currency-unresolved (never S$)", !!c && /2,000/.test(c.printed) && /does not say which currency/.test(c.printed) && !/S\$/.test(c.printed), JSON.stringify(c));
  check("heading+paragraph: its source span is the section (heading through paragraph) on page 9, not the neighbouring section", !!c && c.page === 9 && /Compassionate Death Allowance Benefit/.test(c.evidence?.excerpt ?? "") && /prescribed form/.test(c.evidence?.excerpt ?? "") && !/Repatriation|5,000/.test(c.evidence?.excerpt ?? ""), JSON.stringify(c?.evidence));
  const rep = named(d1, /^Repatriation$/, booklet);
  check("adjacent section: Repatriation is its own record, with its own $5,000 and condition", rep.length === 1 && /5,000/.test(rep[0].printed) && /overseas/.test(rep[0].conditions.join(" ")), JSON.stringify(rep));
  check("adjacent section: none of Repatriation's terms are in the allowance's record", !!c && !/overseas|5,000|body home/.test([c.printed, ...c.conditions].join(" ")), JSON.stringify(c));
  // ---- bullet / tab row (the separate summary)
  const sum = named(d1, /^Compassionate Death Allowance Benefit$/, summary);
  check("bullet/tab row: the summary's row is offered under its full benefit name", sum.length === 1 && /S\$2,000/.test(sum[0].printed), JSON.stringify(d1.filter((x) => x.policy_id === summary)));
  check("bullet/tab row: the footnote its marker points to is its condition (Core / Voluntary)", sum.length === 1 && /Core Scheme or Voluntary Scheme/.test(sum[0].conditions.join(" ")), JSON.stringify(sum));
  check("bullet/tab row: no benefit is ever named by a bullet character or an empty string", d1.every((x) => /[A-Za-z]{3}/.test(x.benefit) && !/^[\s•▪●◦*·–-]*$/.test(x.benefit)), JSON.stringify(d1.map((x) => x.benefit)));
  check("summary and booklet are separate records (their relationship is not established)", !!c && sum.length === 1 && c.benefit_id !== sum[0].benefit_id && !/S\$/.test(c.printed), JSON.stringify([c, sum[0]]));
  // ---- person / version / household controls
  check("version control: the superseded 2022 booklet ($1,500) is never offered", !d1.some((x) => /1,500/.test(x.printed) || x.policy_id === B.doc("OLD_BOOKLET").id), JSON.stringify(d1.map((x) => [x.product, x.printed])));
  check("household control: another household's booklet copy ($3,000) is never offered", !d1.some((x) => /3,000/.test(x.printed) || x.policy_id === B.doc("OTHER_BOOKLET").id), JSON.stringify(d1.map((x) => [x.product, x.printed])));
  const g1 = await offered(G);
  const gc = named(g1, /^Compassionate Death Allowance Benefit$/, booklet);
  check("person control: Grace's record is her own (another benefit_id), from the same wording", gc.length === 1 && !!c && gc[0].benefit_id !== c.benefit_id, JSON.stringify(gc));

  // ---- other layouts, by editing the stored pages (restored after)
  const page = async (policy: string, n: number) => (await h.db.query("SELECT text FROM policy_pages WHERE policy_id=$1 AND page_number=$2", [policy, n])).rows[0].text as string;
  const setPage = (policy: string, n: number, text: string) => h.db.query("UPDATE policy_pages SET text=$3 WHERE policy_id=$1 AND page_number=$2", [policy, n, text]);
  const p9 = await page(booklet, 9), p12 = await page(summary, 12), p1 = await page(booklet, 1);
  try {
    // a differently named paragraph benefit, and an unnumbered heading layout
    await setPage(booklet, 9, p9 + "\nSection 7 - Child Education Benefit\nIf an Insured Person dies as a result of an Accident, we will pay up to $5,000 for each dependent child,\nup to two children, on receipt of proof of death and of each child's age.\nHome Modification Allowance\nIf an Insured Person suffers permanent disablement as a result of an Accident, we will reimburse the cost of\nmodifying the home, up to $10,000.");
    // a wrapped bullet row
    await setPage(summary, 12, p12 + "\n•\tMobility Aid upon Accidental Total &\tUp to S$10,000\nPermanent Disablement*");
    const d2 = await offered(D, "death, accident, child, disablement");
    const ce = named(d2, /^Child Education Benefit$/, booklet);
    check("another paragraph benefit (numbered): offered by its own name, its own amount and conditions", ce.length === 1 && /5,000/.test(ce[0].printed) && /dependent child/.test(ce[0].conditions.join(" ")) && !/funeral|Core Scheme/.test(ce[0].conditions.join(" ")), JSON.stringify(ce));
    const hm = named(d2, /^Home Modification Allowance$/, booklet);
    check("another paragraph benefit (unnumbered heading line): offered by its own name and amount", hm.length === 1 && /10,000/.test(hm[0].printed) && /permanent disablement/.test(hm[0].conditions.join(" ")), JSON.stringify(hm));
    check("adjacent sections stay separate: Repatriation's record does not take the next section's lines", named(d2, /^Repatriation$/, booklet).every((x) => !/child|10,000/i.test([x.printed, ...x.conditions].join(" "))), JSON.stringify(named(d2, /^Repatriation$/, booklet)));
    const wrap = named(d2, /^Mobility Aid upon Accidental Total & Permanent Disablement$/, summary);
    check("wrapped bullet row: offered under its whole wrapped name", wrap.length === 1 && /S\$10,000/.test(wrap[0].printed), JSON.stringify(d2.filter((x) => x.policy_id === summary).map((x) => x.benefit)));
    // a documented currency: the booklet's own statement
    await setPage(booklet, 9, p9); await setPage(summary, 12, p12);
    await setPage(booklet, 1, p1 + "\nCurrency: All amounts in this booklet are in Singapore Dollars.");
    const d3 = await offered(D);
    const cd = named(d3, /^Compassionate Death Allowance Benefit$/, booklet);
    check("established currency: with the booklet's own currency statement, the allowance is S$2,000", cd.length === 1 && /S\$2,000/.test(cd[0].printed) && !/does not say/.test(cd[0].printed), JSON.stringify(cd));
    // a documented currency: the same booklet printing the same benefit and amount with its currency elsewhere
    await setPage(booklet, 1, p1);
    await setPage(booklet, 9, p9 + "\nTable of Benefits\nCompassionate Death Allowance Benefit\tS$2,000");
    const d4 = await offered(D);
    const cs = named(d4, /^Compassionate Death Allowance Benefit$/, booklet).filter((x) => /Section 5/.test(x.evidence?.excerpt ?? "") || /prescribed form/.test(x.conditions.join(" ")));
    check("established currency (the same booklet prints this benefit as S$2,000): the section's record is S$2,000, with that basis", cs.length === 1 && /S\$2,000/.test(cs[0].printed) && /same document prints/.test(cs[0].currency ?? ""), JSON.stringify(cs));
    // a different amount elsewhere in the booklet decides nothing
    await setPage(booklet, 9, p9 + "\nTable of Benefits\nCompassionate Death Allowance Benefit\tS$2,500");
    const d5 = await offered(D);
    const cx = named(d5, /^Compassionate Death Allowance Benefit$/, booklet).filter((x) => /prescribed form/.test(x.conditions.join(" ")));
    check("currency control (the booklet prints the benefit with another amount): the section's bare $2,000 stays currency-unresolved", cx.length === 1 && /does not say which currency/.test(cx[0].printed), JSON.stringify(cx));
  } finally { await setPage(booklet, 9, p9); await setPage(summary, 12, p12); await setPage(booklet, 1, p1); }

  console.log(`\nreliable-chat benefit records (person_benefits boundary): ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
