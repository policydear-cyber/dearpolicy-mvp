/**
 * Round 10 messy-documents suite (npm run r10:messy-docs-test).
 *
 * Real families upload messy documents. A third household (scripts/r10/fixture.ts)
 * uploads phone photos rotated 90 and 180 degrees, a scan with no text layer,
 * one PDF holding three policies, a schedule with its pages out of order, the
 * same schedule as a photo AND a PDF, insurer letters, a claim rejection, a
 * hospital bill, an e-statement of small tables, a password-protected PDF, a
 * truncated PDF, an insurer-app screenshot, a Word file of the son's notes, a
 * 120-page wording, handwritten notes, a blurred photo and an iPhone HEIC --
 * through the REAL upload checks and pipeline, with the deterministic model
 * and a deterministic hosted-OCR stand-in that is faithful but imperfect
 * (S$1,O00, l/1 swaps, broken table columns) and reads only upright pages.
 *
 *   1. Unit controls: the detectors' positive/negative controls, and the
 *      reading fixes' plain-code rules.
 *   2. Reading: every upload ends in a state the household can act on, within
 *      a time limit; rotated pages are read; the bundle is split; the photo of
 *      a schedule is merged with its PDF; letters, bills, rejections, notes,
 *      screenshots and handwriting are never cover; figures a scan prints
 *      unclearly are never stored as clean figures unless the document itself
 *      prints the same figure clearly; out-of-order pages are noticed; every
 *      unreadable upload says why and what to do.
 *   3. Answers: 150+ questions and 10 multi-turn conversations about the
 *      household; every Round 6-10 detector must stay silent and the output
 *      guard must never act.
 *
 * Deterministic and CI-fast. R10_DUMP=<file> writes every turn as JSON lines;
 * R10_ONLY=<substring> filters the battery; R10_SUMMARY=<file> writes counts.
 */
import { writeFileSync, appendFileSync, readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import type { ChatAnswer } from "@/types";

Object.assign(process.env, { DEARPOLICY_DETERMINISTIC_MODEL: "synthetic-e2e", E2E_RUN_ID: "r10messy", DEV_AUTH_ENABLED: "1", MODEL_PRESET: "gemini", GEMINI_API_KEY: process.env.GEMINI_API_KEY || "ci" });
delete process.env.PINECONE_API_KEY; delete process.env.SUPABASE_URL; delete process.env.OCR_ENABLED;

type Hit = { rule: string; text: string };
type Rec = { conv: string; turn: number; question: string; status: number; ms: number; summary: string; answer: ChatAnswer | null; hits: Hit[] };

/** Reading defects by category, from the stored state of every upload. */
async function readingChecks(h: import("./r10/fixture").Household, F: typeof import("./r10/fixture")) {
  const defects: { category: string; detail: string }[] = [];
  const bad = (category: string, detail: string) => defects.push({ category, detail });
  const q = async <T>(sql: string, p: unknown[] = []) => (await h.db.query<T>(sql, p)).rows;
  type Doc = { id: string; original_filename: string; processing_status: string; processing_message: string | null; processing_error: string | null; document_role: string | null; product_name: string | null;
    personal_coverage_confirmed: boolean; superseded: boolean; review_reason: string | null; notes: string[] | null; family_member_id: string };
  const docs = await q<Doc>(`SELECT id::text,original_filename,processing_status,processing_message,processing_error,document_role,product_name,personal_coverage_confirmed,superseded_at IS NOT NULL superseded,review_reason,
      extracted_json->'documentNotes' notes,family_member_id::text FROM policies WHERE account_id=$1 AND lifecycle_state='active' ORDER BY created_at,id`, [F.ACCOUNT]);
  const byKey = (k: string) => docs.find((d) => d.id === h.docs[k]);
  const pages = async (id: string) => q<{ page_number: number; text: string; m: string | null }>("SELECT page_number,text,to_jsonb(pg)->>'extraction_method' m FROM policy_pages pg WHERE policy_id=$1 ORDER BY page_number", [id]);
  const said = (d: Doc | undefined) => [d?.processing_message, d?.processing_error, d?.review_reason, ...(d?.notes ?? [])].filter(Boolean).join(" | ");
  // ---- no hang: every upload ends ready or failed, quickly
  for (const u of h.uploads) {
    if (u.rejected || u.key === "other") continue;
    const d = docs.find((x) => x.id === u.policyId);
    if (!d || !["ready", "failed"].includes(d.processing_status)) bad("hang in reading", `${u.file}: ${d?.processing_status ?? "missing"} (${u.threw ?? ""})`);
    if (u.ms > 60_000) bad("hang in reading", `${u.file}: ${u.ms} ms`);
    if (/try again automatically|still reading/i.test(said(d)) && !u.threw?.includes("network")) bad("hang in reading", `${u.file} says it will keep reading: ${said(d).slice(0, 160)}`);
  }
  // ---- rotated pages are read
  for (const [k, needle] of [["photo26", /SILVERSHIELD/i], ["photo25", /SILVERSHIELD/i]] as const) {
    const d = byKey(k); const p = d ? await pages(d.id) : [];
    if (!d || d.processing_status !== "ready" || !p.some((x) => needle.test(x.text))) bad("rotated page not read", `${k}: ${d?.processing_status} ${said(d).slice(0, 120)}`);
  }
  const ci = byKey("ciscan"); const ciPages = ci ? await pages(ci.id) : [];
  if (!/SCHEDULE OF BENEFITS/.test(ciPages.find((p) => p.page_number === 2)?.text ?? "")) bad("rotated page not read", "Golden Years scan page 2 (fed in sideways): " + JSON.stringify(ciPages.find((p) => p.page_number === 2)?.text ?? null));
  for (const d of docs) for (const p of (d.processing_status === "ready" ? await pages(d.id) : [])) if (p.m === "ocr" && !p.text.trim()) bad("page silently empty", `${d.original_filename} page ${p.page_number} is stored as read but has no text`);
  // ---- the bundle is split into its three policies, each with its own person
  const fromBundle = docs.filter((d) => d.original_filename.startsWith("Chua_family_policies_bundle") && !d.superseded && d.processing_status === "ready");
  const products = fromBundle.map((d) => d.product_name ?? "").sort();
  if (JSON.stringify(products) !== JSON.stringify(["Heritage Whole Life", "SeniorGuard Personal Accident", "Wanderer Annual Travel"])) bad("bundle not split", "bundle documents: " + JSON.stringify(products));
  const owners = async (id: string) => (await q<{ id: string }>("SELECT family_member_id::text id FROM policy_members WHERE policy_id=$1", [id])).map((r) => r.id).sort();
  for (const [product, who] of [["SeniorGuard Personal Accident", F.AHLIAN], ["Heritage Whole Life", F.BOONHUAT], ["Wanderer Annual Travel", F.KOKLEONG]] as const) {
    const d = fromBundle.find((x) => x.product_name === product);
    if (d && JSON.stringify(await owners(d.id)) !== JSON.stringify([who])) bad("bundle not split", product + " linked to " + JSON.stringify(await owners(d.id)));
  }
  // ---- duplicates across formats merged; the older schedule is not the current one
  const shields = docs.filter((d) => /SilverShield/i.test(d.product_name ?? "") && d.document_role === "personal_schedule" && !d.superseded && d.processing_status === "ready");
  if (shields.length !== 1 || shields[0].id !== h.docs.shield26) bad("duplicates not merged", "current SilverShield schedules: " + shields.map((d) => d.original_filename).join(", "));
  const p26 = byKey("photo26");
  if (p26 && !(p26.superseded && /same|duplicate|copy/i.test(said(p26)))) bad("duplicates not merged", "the photo of the 2026 schedule is not marked as a copy: " + said(p26).slice(0, 160));
  const p25 = byKey("photo25");
  if (p25 && !(p25.superseded && /2025|earlier|older|replaced|newer/i.test(said(p25)))) bad("duplicates not merged", "the 2025 schedule is not marked as replaced: " + said(p25).slice(0, 160));
  // ---- letters, bills, rejections, notes, screenshots and handwriting are never cover
  const roles: [string, RegExp][] = [["letter", /^insurer_letter$/], ["rejection", /^claim_decision$/], ["bill", /^medical_bill$/], ["screenshot", /^app_screenshot$/], ["notes", /^personal_notes$/], ["handwritten", /^personal_notes$/],
    ["wording", /^policy_wording$/], ["estatement", /^annual_statement$/], ["carecash", /^personal_schedule$/], ["ciscan", /^personal_schedule$/], ["shield26", /^personal_schedule$/]];
  for (const [k, role] of roles) { const d = byKey(k); if (d && !role.test(d.document_role ?? "")) bad("document role wrong", `${k}: ${d.document_role}`); }
  for (const k of ["letter", "rejection", "bill", "screenshot", "notes", "handwritten"]) {
    const d = byKey(k); if (!d) continue;
    const covs = await q<{ n: number }>("SELECT count(*)::int n FROM policy_coverages WHERE policy_id=$1", [d.id]);
    const bens = await q<{ n: number }>("SELECT count(*)::int n FROM policy_benefits WHERE policy_id=$1", [d.id]);
    const rules = await q<{ n: number }>("SELECT count(*)::int n FROM coverage_rules WHERE policy_id=$1", [d.id]).catch(() => [{ n: 0 }]);
    if (d.personal_coverage_confirmed || covs[0].n || bens[0].n || rules[0].n) bad("non-policy document treated as cover", `${k}: confirmed=${d.personal_coverage_confirmed} coverages=${covs[0].n} benefits=${bens[0].n} ledger=${rules[0].n}`);
  }
  const prem = await q<{ amount: string; period_start: string | null; src: string }>("SELECT amount::text,period_start::text,source_document_id::text src FROM premium_records WHERE account_id=$1", [F.ACCOUNT]);
  for (const p of prem) if (Number(p.amount) === 2736 && p.period_start !== "2027-04-01") bad("future premium stored as current", JSON.stringify(p));
  for (const p of prem) if (["bill", "rejection", "notes", "handwritten"].some((k) => h.docs[k] === p.src)) bad("non-policy document treated as cover", "premium from " + p.src);
  // ---- figures a scan printed unclearly are never stored as clean figures
  const { ocrTypoTokens } = await import("./r10/detectors");
  for (const d of docs.filter((x) => x.processing_status === "ready")) {
    const pg = await pages(d.id);
    const ocrText = pg.filter((p) => p.m === "ocr").map((p) => p.text).join("\n");
    const transcripts = JSON.parse(readFileSync("scripts/fixtures/r10/transcripts.json", "utf8")) as Record<string, { text: string }[]>;
    const raw = (transcripts[d.original_filename] ?? []).map((p) => p.text).join("\n") || ocrText;
    const all = pg.map((p) => p.text).join("\n");
    for (const t of ocrTypoTokens(raw)) {
      const agreed = new RegExp("S\\$" + t.value.toLocaleString("en-US").replace(/\./g, "\\.") + "(?![\\d,])").test(all.replace(t.token, ""));
      const stored = await q<{ v: string; w: string }>(`SELECT amount::text v,'coverage' w FROM policy_coverages WHERE policy_id=$1 AND evidence_verified UNION ALL SELECT formula_value::text,'benefit' FROM policy_benefits WHERE policy_id=$1 UNION ALL SELECT amount::text,'premium' FROM premium_records WHERE source_document_id=$1`, [d.id]);
      for (const s of stored) {
        if (Number(s.v) === t.value && !agreed) bad("OCR typo stored as a clean figure", `${d.original_filename}: ${t.token} stored as ${s.w} ${s.v}`);
        if (t.prefix != null && Number(s.v) === t.prefix) bad("OCR typo stored as a clean figure", `${d.original_filename}: ${t.token} cut to ${s.w} ${s.v}`);
      }
    }
  }
  if (ci && !(await q<{ n: number }>("SELECT count(*)::int n FROM policy_coverages WHERE policy_id=$1 AND evidence_verified AND amount=50000", [ci.id]))[0].n) bad("OCR figure lost", "Golden Years S$50,000 (printed clearly on page 2) is not a verified cover figure");
  // ---- pages out of order are noticed
  const cc = byKey("carecash");
  if (!cc || !/out of order|order/i.test(said(cc))) bad("page order not handled", "CareCash pages 3, 1, 2: " + said(cc).slice(0, 160));
  // ---- unreadable uploads say why and what to do
  const why: [string, RegExp][] = [["locked", /password/i], ["damaged", /damaged|incomplete|cut off|could not be opened/i], ["blurry", /photo|blurr|dark|light|flat/i], ["handwritten", /handwrit/i]];
  for (const [k, re] of why) { const d = byKey(k); if (!d || !re.test(said(d))) bad("unreadable not explained", `${k}: ${said(d).slice(0, 200)}`); }
  const damaged = byKey("damaged");
  if (damaged && !/download|original|again/i.test(said(damaged))) bad("unreadable not explained", "damaged: no way forward");
  const blurry = byKey("blurry");
  if (blurry && !/light|flat|shadow|whole page|steady|focus/i.test(said(blurry))) bad("unreadable not explained", "blurry photo: no photo tips: " + said(blurry).slice(0, 200));
  const heic = h.uploads.find((u) => u.key === "heic");
  if (!heic?.rejected || !/JPE?G/.test(heic.rejected)) bad("unreadable not explained", "HEIC: " + heic?.rejected);
  // ---- another household's identical upload is not a duplicate of this one's
  const other = (await q<{ superseded: boolean; processing_status: string }>("SELECT superseded_at IS NOT NULL superseded,processing_status FROM policies WHERE id=$1", [h.docs.other]))[0];
  if (!other || other.superseded || other.processing_status !== "ready") bad("duplicates not merged", "another household's copy was touched: " + JSON.stringify(other));
  return defects;
}

async function main() {
  const started = Date.now();
  const watchdog = setTimeout(() => { console.error("WATCHDOG: no completion in 20 minutes"); process.exit(3); }, 20 * 60_000);
  globalThis.fetch = (async (input: RequestInfo | URL) => { throw new Error("network disabled: " + String(input)); }) as typeof fetch;
  const out = console.log;
  console.info = () => undefined; console.debug = () => undefined; console.warn = () => undefined;
  console.log = (...args: unknown[]) => { if (typeof args[0] === "string" && /^(?:\{"|\[telemetry\]|SQL note)/.test(args[0])) return; out(...args); };
  const failures: string[] = [];

  // ---------------------------------------------------- 1. unit controls
  const R10 = await import("./r10/detectors");
  const controls = R10.selfTest();
  if (controls.length) { out("DETECTOR SELF-TEST FAILED:\n- " + controls.join("\n- ")); process.exit(1); }
  const unit = await import("./r10/unit");
  const unitFails = await unit.unitControls();
  if (unitFails.length) failures.push(...unitFails.map((f) => "unit: " + f));
  out("unit controls: " + (unitFails.length ? unitFails.length + " failing" : "ok"));

  // ---------------------------------------------------- 2. reading
  const { detect, moneyIn, visibleFields } = await import("./r6/detectors");
  const { detectR7, repeatedAnswer } = await import("./r7/detectors");
  const { detectR8 } = await import("./r8/detectors");
  const R9 = await import("./r9/ingest-detectors");
  const R9R = await import("./r9/detectors");
  const guard = await import("@/lib/chat/output-guard");
  guard.guardInterventions.length = 0;
  const F = await import("./r10/fixture");
  const h = await F.buildHousehold({ perDocumentTimeoutMs: 90_000 });
  out(`household built in ${Date.now() - started} ms (${h.uploads.length} uploads, slowest ${Math.max(...h.uploads.map((u) => u.ms))} ms)`);
  const defects = await readingChecks(h, F);
  const byCategory = new Map<string, number>();
  for (const d of defects) byCategory.set(d.category, (byCategory.get(d.category) ?? 0) + 1);
  out("\n=== reading defects by category ===");
  for (const [k, n] of [...byCategory].sort((a, b) => b[1] - a[1])) out(String(n).padStart(4) + "  " + k);
  for (const d of defects) out("  ✗ " + d.category + ": " + d.detail);
  if (defects.length) failures.push(defects.length + " reading defect(s)");

  // ---------------------------------------------------- 3. answers
  const { battery } = await import("./r10/battery");
  const { POST } = await import("@/app/api/chat/route");
  const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  const pages = new Map<string, string>(), policyNames = new Map<string, string>();
  for (const r of (await h.db.query<{ policy_id: string; text: string; product: string | null; file: string }>("SELECT pp.policy_id::text policy_id,string_agg(pp.text,E'\\n' ORDER BY pp.page_number) text,max(p.product_name) product,max(p.original_filename) file FROM policy_pages pp JOIN policies p ON p.id=pp.policy_id WHERE p.account_id=$1 AND p.lifecycle_state='active' GROUP BY 1", [F.ACCOUNT])).rows) {
    pages.set(r.policy_id, r.text); policyNames.set(r.policy_id, (r.product ?? r.file) + " | " + r.file);
  }
  const premiumFigures: number[] = [];
  for (const r of (await h.db.query<{ amount: string; notes: string | null }>("SELECT amount::text,notes FROM premium_records WHERE account_id=$1", [F.ACCOUNT])).rows) { premiumFigures.push(Number(r.amount)); premiumFigures.push(...moneyIn(r.notes ?? "")); }
  // The letter's figures are premiums too (current, next year's, the replacement rider's).
  premiumFigures.push(2184, 2736, 1036, 1412, 1800, 384, 1962, 968, 162, 1248, 312, 486, 268, 118.4, 1742.4, 43560);
  const personPolicies = new Map<string, Set<string>>();
  for (const r of (await h.db.query<{ family_member_id: string; policy_id: string }>("SELECT family_member_id::text family_member_id,policy_id::text policy_id FROM policy_members WHERE account_id=$1", [F.ACCOUNT])).rows)
    (personPolicies.get(r.family_member_id) ?? personPolicies.set(r.family_member_id, new Set()).get(r.family_member_id)!).add(r.policy_id);
  const g = { pages, premiumFigures: [...new Set(premiumFigures)], householdNames: F.PEOPLE.map((p) => p.display_name), foreignNames: ["Tay Hui Min", "Hui Min"], foreignPolicyIds: new Set([h.docs.other]), personPolicies,
    selfNames: ["Chua Kok Leong", "Kok Leong"], inactive: [], people: F.PEOPLE.map((p) => ({ id: p.id, names: [p.display_name, p.preferred_name] })), today };
  const g9 = await R9.pageTruth(h.db as never, F.ACCOUNT);
  // Round 10 truth: the unclear figures each scan printed, and which uploads are not policies.
  const transcripts = JSON.parse(readFileSync("scripts/fixtures/r10/transcripts.json", "utf8")) as Record<string, { text: string }[]>;
  const contexts: Record<string, RegExp> = { "GoldenYears_CI_scan.pdf": /Golden Years|critical illness|\bCI\b|cancer|angioplasty|Mama/i, "IMG_20260412_093015.jpg": /SilverShield|policy year limit|Assist Rider|Papa/i,
    "SilverShield_2025_photo.png": /2025|last year/i, "Handwritten_notes.jpg": /handwrit|notes/i };
  const family: Record<string, string[]> = { "IMG_20260412_093015.jpg": ["SilverShield_Schedule_2026.pdf"], "SilverShield_2025_photo.png": [] };
  const textOf = (file: string) => [...(transcripts[file] ?? []).map((p) => p.text), ...[...h.uploads].filter((u) => (family[file] ?? []).includes(u.file)).map((u) => pages.get(u.policyId ?? "") ?? "")].join("\n");
  const typos = Object.keys(transcripts).flatMap((file) => R10.ocrTypoTokens(transcripts[file].map((p) => p.text).join("\n")).map((t) => ({ file, ...t, context: contexts[file] ?? /$^/,
    agreed: new RegExp("S\\$" + t.value.toLocaleString("en-US") + "(?![\\d,])").test(textOf(file).split(t.token).join(" ")) })));
  const notCover = new Map<string, string>([["letter", "insurer letter"], ["rejection", "claim decision"], ["bill", "hospital bill"], ["notes", "family notes"], ["handwritten", "handwritten notes"], ["screenshot", "screenshot"]]
    .filter(([k]) => h.docs[k]).map(([k, v]) => [h.docs[k], v]));
  const g10 = { typos, notCover, duplicatePair: h.docs.photo26 && h.docs.shield26 ? [h.docs.photo26, h.docs.shield26] as [string, string] : null };

  const only = process.env.R10_ONLY, dump = process.env.R10_DUMP;
  if (dump) writeFileSync(dump, "");
  const records: Rec[] = [];
  let messages = 0;
  for (const c of battery()) {
    if (only && !c.name.includes(only)) continue;
    const conv: { id?: string; rev?: number } = {};
    let member = c.member, userText = "", prev: { question: string; key: string } | null = null, prevAnswer: ChatAnswer | null = null;
    for (const [i, t] of c.turns.entries()) {
      userText += "\n" + t.say;
      process.env.DEV_ACCOUNT_ID = F.ACCOUNT;
      const t0 = Date.now();
      let status = 0, data: { answer?: ChatAnswer; error?: string } = {};
      const hits: Hit[] = [];
      try {
        // Round 10: R10_METER writes this turn's cost (scripts/r10/meter.ts), as in the r6/r7/r9 batteries.
        const res = await (await import("./r10/meter")).meterTurn(t.say, () => POST(new NextRequest("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ familyMemberId: member, scope: c.scope ?? (member ? "member" : "family"), question: t.say, conversationId: conv.id, conversationRevision: conv.rev, asynchronous: false, timeZone: "Asia/Singapore" }) })));
        status = res.status; data = await res.json();
      } catch (e) { hits.push({ rule: "threw", text: (e instanceof Error ? e.stack ?? e.message : String(e)).slice(0, 400) }); }
      const ms = Date.now() - t0;
      messages++;
      const e = t.expect ?? {};
      if (status !== (e.status ?? 200) && !hits.length) hits.push({ rule: "unexpected HTTP status", text: status + " " + JSON.stringify(data).slice(0, 200) });
      const a = status === 200 ? data.answer ?? null : null;
      if (a) {
        conv.id = a.conversationId ?? conv.id; conv.rev = a.conversationRevision ?? conv.rev;
        if (a.resolvedFamilyMemberId) member = a.resolvedFamilyMemberId;
        hits.push(...detect(a, { question: t.say, userText, claimTurn: false, ms, expect: { person: e.person } as never }, g));
        hits.push(...detectR7(a, { question: t.say, userText, expectPerson: e.person ?? null }, g));
        hits.push(...detectR8(a, { userText }, g));
        hits.push(...R9.detectR9(a, g9));
        hits.push(...R9R.detectR9(a, { question: t.say, userText, prevAnswer, expect: {} }, { pages, policyNames }));
        hits.push(...R10.detectR10(a, { question: t.say, expect: e }, g10));
        const all = visibleFields(a).map((f) => f.text).join("\n");
        const said = visibleFields(a).filter((f) => !/quote|citation/.test(f.where)).map((f) => f.text).join("\n");
        for (const m of Array.isArray(e.mentions) ? e.mentions : e.mentions ? [e.mentions] : []) if (!m.test(all)) hits.push({ rule: "answer ignores the question", text: "expected " + m + " in: " + a.summary.slice(0, 220) });
        if (e.notMentions) { const m = said.match(e.notMentions); if (m) hits.push({ rule: "answer says what it must not", text: m[0] + " in: " + a.summary.slice(0, 220) }); }
        const same = repeatedAnswer(prev, t.say, a); if (same) hits.push(same);
        prev = { question: t.say, key: a.summary + "\n" + a.details.join("\n") };
        prevAnswer = a;
      }
      const rec: Rec = { conv: c.name, turn: i, question: t.say, status, ms, summary: a?.summary ?? String(data?.error ?? ""), answer: a, hits };
      records.push(rec);
      if (dump) appendFileSync(dump, JSON.stringify(rec) + "\n");
    }
  }
  const byRule = new Map<string, number>();
  for (const r of records) for (const x of r.hits) byRule.set(x.rule, (byRule.get(x.rule) ?? 0) + 1);
  const failing = records.filter((r) => r.hits.length);
  for (const r of failing.slice(0, Number(process.env.R10_SHOW ?? 40))) out(`\n✗ ${r.conv} #${r.turn} > ${r.question.slice(0, 120)}\n  < ${r.summary.slice(0, 300)}\n  - ` + r.hits.map((x) => x.rule + ": " + x.text).join("\n  - "));
  out("\n=== answer detector hits by rule ===");
  for (const [rule, n] of [...byRule].sort((x, y) => y[1] - x[1])) out(String(n).padStart(4) + "  " + rule);
  const convs = new Set(records.map((r) => r.conv)), multi = [...convs].filter((n) => records.filter((r) => r.conv === n).length >= 5).length;
  const times = records.map((r) => r.ms).sort((x, y) => x - y);
  out(`\n${messages} messages in ${convs.size} conversations (${multi} multi-turn); ${failing.length} turns with hits; median ${times[Math.floor(times.length / 2)] ?? 0} ms, max ${times.at(-1) ?? 0} ms; total ${Math.round((Date.now() - started) / 1000)} s`);
  if (!only && messages < 150) failures.push("the battery must send at least 150 messages (sent " + messages + ")");
  if (!only && multi < 10) failures.push("the battery must hold at least 10 multi-turn conversations (has " + multi + ")");
  if (failing.length) failures.push(failing.length + " answer(s) with detector hits");
  if (guard.guardInterventions.length) failures.push("the output guard changed " + guard.guardInterventions.length + " answer(s)");
  else out("output guard interventions: 0");
  if (process.env.R10_SUMMARY) writeFileSync(process.env.R10_SUMMARY, JSON.stringify({ reading: Object.fromEntries(byCategory), readingDefects: defects, answers: Object.fromEntries(byRule), turns: records.length, failingTurns: failing.length, uploads: h.uploads }, null, 1));
  clearTimeout(watchdog);
  await h.db.close();
  if (failures.length) { out("\nFAIL:\n- " + failures.join("\n- ")); process.exitCode = 1; }
  else out("\nr10 messy-documents regressions passed");
}
main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(2); });
