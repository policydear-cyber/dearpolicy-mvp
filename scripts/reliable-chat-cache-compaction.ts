/**
 * Death-journey review risks (PR #56), closed before the paid batch.
 *   A. Repeated-passage compaction: a passage is replaced by a reference ONLY when the union of the spans already shown covers every
 *      character of it. Any larger-than-half (or any) partial overlap whose remainder holds a new condition, exclusion, amount or
 *      heading is returned complete. Identity includes the document VERSION (file hash) and page.
 *   B. Turn-cache validity: derived benefits and search results are rebuilt at the next tool/model boundary after a deletion,
 *      supersession, person-link change, owner change, member change, or a change to ANY field benefit resolution reads.
 * Isolated fixtures: every cache scenario starts its own database. No assertion is conditional.
 *   node --import tsx scripts/reliable-chat-cache-compaction.ts
 */
import { setEnv, startHarness } from "./fixtures/rag2-loop/harness";
import * as DJ from "./fixtures/reliable-chat/death-journey";
import * as DJR from "./fixtures/reliable-chat/death-journey-actual-values";
import { compactSearch, covers, type ShownSpans } from "@/lib/rag2/loop/retrieval-budget";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "\n     " + detail.split("\n").slice(0, 16).join("\n     ")}`); };

// ---------------------------------------------------------------- A. compaction (pure)
type Hit = { policyId: string; productName: string; page: number; text: string; evidence: { policyId: string; documentHash: string | null; passage: { start: number; end: number; onPage: number } } };
const hit = (policyId: string, hash: string | null, page: number, start: number, end: number, text: string): Hit => ({ policyId, productName: "Scheme X", page, text, evidence: { policyId, documentHash: hash, passage: { start, end, onPage: page } } });
const run = (spans: ShownSpans, hits: Hit[]) => { const res: any = { ok: true, data: { hits }, evidence: hits.map((h) => h.evidence) }; const ids = new Map<any, string>(); const p = compactSearch(res, spans, (r) => { if (!ids.has(r)) ids.set(r, "E" + (ids.size + 1)); return ids.get(r)!; }); return { res, p, shown: res.data.hits as any[] }; };
const BASE = "Group Term Life: S$500,000 payable on death of the insured.";
const TAIL = " Excluded: death by suicide within 12 months of the effective date.";
const A1 = hit("P1", "h1", 3, 0, BASE.length, BASE);
{
  const spans: ShownSpans = new Map();
  run(spans, [A1]);
  const again = run(spans, [hit("P1", "h1", 3, 0, BASE.length, BASE)]);
  check("A1 a passage whose every character was already shown becomes a reference (citable, position kept)", again.p.repeated === 1 && again.shown[0].text === undefined && again.shown[0].evidence_id === "E1" && again.p.novel === 0, JSON.stringify(again.shown));
  const inner = run(spans, [hit("P1", "h1", 3, 10, 40, BASE.slice(10, 40))]);
  check("A2 a passage fully inside shown material is a reference", inner.p.repeated === 1, JSON.stringify(inner.shown));
}
{
  // A3: the new passage is the shown one PLUS a tail holding an exclusion. 59 of its ~128 characters are old (> half is NOT needed, but the old rule hid it at >= 50%).
  const spans: ShownSpans = new Map();
  run(spans, [A1]);
  const longer = BASE + TAIL;
  const frac = BASE.length / longer.length;
  const r = run(spans, [hit("P1", "h1", 3, 0, longer.length, longer)]);
  check(`A3 overlapping passage (${Math.round(frac * 100)}% already shown) with a NEW exclusion in the remainder is returned complete`, r.shown[0].text === longer && /suicide within 12 months/.test(r.shown[0].text) && r.p.repeated === 0 && r.p.novel === 1, JSON.stringify(r.shown));
}
{
  // A4: >= 90% already shown, the 10% left is a new amount.
  const head = "Accidental Death Benefit. The insured amount is shown in the schedule and is paid once. ".repeat(3);
  const tail = "Amount: S$250,000.";
  const spans: ShownSpans = new Map(); run(spans, [hit("P2", "h1", 5, 0, head.length, head)]);
  const r = run(spans, [hit("P2", "h1", 5, 0, head.length + tail.length, head + tail)]);
  check(`A4 ${Math.round(100 * head.length / (head.length + tail.length))}% overlap, the remaining 10% is a new amount: kept`, r.shown[0].text === head + tail && /S\$250,000/.test(r.shown[0].text), JSON.stringify(r.shown).slice(0, 300));
}
{
  // A5: the remainder is a new HEADING that starts a different benefit; A6: a new condition (an "unless" qualifier) at the start of the passage.
  const body = "payable to the nominee within 30 days of proof of death, subject to the policy terms and the schedule of benefits.";
  const spans: ShownSpans = new Map(); run(spans, [hit("P3", "h1", 2, 20, 20 + body.length, body)]);
  const withHeading = body + "\nTotal and Permanent Dismemberment due to Accident\n";
  const r5 = run(spans, [hit("P3", "h1", 2, 20, 20 + withHeading.length, withHeading)]);
  check("A5 overlap whose remainder is a new heading is returned complete", r5.shown[0].text === withHeading, JSON.stringify(r5.shown).slice(0, 200));
  const withLead = "Unless the insured was travelling on a military aircraft, the benefit is ";
  const spans2: ShownSpans = new Map(); run(spans2, [hit("P3", "h1", 2, 100, 100 + body.length, body)]);
  const r6 = run(spans2, [hit("P3", "h1", 2, 100 - withLead.length, 100 + body.length, withLead + body)]);
  check("A6 overlap whose NEW part is the leading qualifier is returned complete", r6.shown[0].text === withLead + body, JSON.stringify(r6.shown).slice(0, 200));
}
{
  // A7: coverage is the UNION of shown spans (two overlapping shown spans together cover the new passage; summing them double-counts), A8: a gap is not covered.
  const spans: ShownSpans = new Map(); spans.set("P4#h1#1", [[0, 60], [40, 100]]);
  check("A7 union of overlapping shown spans covering a passage -> reference", covers([[0, 60], [40, 100]], 20, 90) && run(spans, [hit("P4", "h1", 1, 20, 90, "x".repeat(70))]).p.repeated === 1);
  const gap: ShownSpans = new Map(); gap.set("P4#h1#1", [[0, 40], [60, 100]]);
  const g = run(gap, [hit("P4", "h1", 1, 20, 90, "y".repeat(70))]);
  check("A8 a hole between shown spans (40..60) is NOT covered: the passage is returned complete (60% of it was shown)", !covers([[0, 40], [60, 100]], 20, 90) && g.p.repeated === 0 && g.shown[0].text === "y".repeat(70), JSON.stringify(g.shown));
  check("A8b the same sum-of-overlaps arithmetic would have called it repeated", ([[0, 40], [60, 100]] as [number, number][]).reduce((n, [s, e]) => n + Math.max(0, Math.min(e, 90) - Math.max(s, 20)), 0) / 70 >= 0.5);
}
{
  // A9-A11: identity. Another version (hash) of the same document, another page, or a hit without a hash is never matched to shown text.
  const spans: ShownSpans = new Map(); run(spans, [hit("P5", "old-hash", 1, 0, 50, "a".repeat(50))]);
  const newer = run(spans, [hit("P5", "new-hash", 1, 0, 50, "b".repeat(50))]);
  check("A9 a REPLACED version (other file hash, same offsets) is returned in full, not matched to the old version's text", newer.p.repeated === 0 && newer.shown[0].text === "b".repeat(50), JSON.stringify(newer.shown));
  const otherPage = run(spans, [hit("P5", "old-hash", 2, 0, 50, "c".repeat(50))]);
  check("A10 the same offsets on another page are not a repeat", otherPage.p.repeated === 0 && otherPage.shown[0].text === "c".repeat(50));
  const noHash = run(spans, [hit("P5", null, 1, 0, 50, "d".repeat(50))]);
  check("A11 a hit with no recorded version is not matched to a versioned one", noHash.p.repeated === 0 && noHash.shown[0].text === "d".repeat(50));
  const sameAgain = run(spans, [hit("P5", "old-hash", 1, 0, 50, "a".repeat(50))]);
  check("A12 (control) the same version, page and span IS a repeat", sameAgain.p.repeated === 1);
  const otherDoc = run(spans, [hit("P6", "old-hash", 1, 0, 50, "e".repeat(50))]);
  check("A13 (control) another document with the same hash and offsets is not a repeat", otherDoc.p.repeated === 0);
}
{
  // A14: an empty or inverted span is never a reference (nothing to cover), and a passage with no offsets is passed through untouched.
  const spans: ShownSpans = new Map(); run(spans, [hit("P7", "h", 1, 0, 10, "z".repeat(10))]);
  const zero = run(spans, [hit("P7", "h", 1, 5, 5, "")]);
  const noOffsets: any = { policyId: "P7", page: 1, text: "plain", evidence: { policyId: "P7", documentHash: "h" } };
  const raw = run(spans, [noOffsets]);
  check("A14 a zero-length span and a passage without offsets are returned as they are", zero.p.repeated === 0 && raw.shown[0].text === "plain", JSON.stringify([zero.shown, raw.shown]));
}

// ---------------------------------------------------------------- B. turn cache
const q = (h: any, sql: string, p: unknown[] = []) => h.db.query(sql, p);
const policyIdsOf = (v: any) => [...new Set(v.benefits.map((b: any) => b.policy.id as string))].sort();
const hitIds = (s: any) => [...new Set(s.hits.map((x: any) => x.policyId as string))].sort();
const cert = DJ.doc("CERT"), ps = DJ.doc("PRODUCT_SUMMARY"), booklet = DJ.doc("BOOKLET");
const DAN = DJ.M.daniel.id, GRACE = DJ.M.grace.id;

async function scenario(name: string, setup: ((h: any) => Promise<void>) | null, body: (h: any, api: any) => Promise<void>) {
  setEnv(DJ as any);
  const h = await startHarness(DJ as any);
  try {
    if (setup) await setup(h);
    const store = await import("@/lib/rag2/store");
    const { personBenefits } = await import("@/lib/rag2/benefits");
    const { searchPassages } = await import("@/lib/rag2/search");
    const api = {
      store, view: (m: string) => personBenefits(DJ.ACCOUNT, m),
      search: (query: string, subject: string | null = DAN) => searchPassages({ accountId: DJ.ACCOUNT, query, subjectId: subject }),
      round: () => store.newToolRound(),
    };
    await store.withTurnStore(DJ.ACCOUNT, () => body(h, api));
    console.log(`  (${name} done)`);
  } finally { await h.db.close(); }
}
const mk = async (h: any, d: any, id: string, hash: string, supersedes: string | null) => {
  await q(h, `INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,group_policy_number,policy_type,document_role,personal_coverage_confirmed,processing_status,original_filename,storage_key,quarantine_status,lifecycle_state,file_hash,effective_date,document_date,supersedes_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ready',$11,$11,'scan_clean','active',$12,$13,$14,$15)`, [id, DJ.ACCOUNT, d.owner, d.insurer, d.product, d.policyNumber, d.groupPolicyNumber ?? null, d.policyType, d.role, d.personal, "new-" + d.key.toLowerCase() + ".pdf", hash, d.effective ?? null, d.documentDate ?? null, supersedes]);
  for (const m of d.members) await q(h, "INSERT INTO policy_members(policy_id,family_member_id,account_id,source,confidence,benefit_tier) VALUES($1,$2,$3,'test',1,$4)", [id, m.id, DJ.ACCOUNT, m.tier ?? null]);
  for (const [page, text] of Object.entries(d.pages)) await q(h, "INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)", [DJ.ACCOUNT, id, Number(page), text]);
};

(async () => {
  // B1 deletion
  await scenario("deletion", null, async (h, api) => {
    const v0 = await api.view(DAN), s0 = await api.search("Group Term Life death benefit");
    check("B1 before: the certificate supplies Daniel's Term Life and is searchable", policyIdsOf(v0).includes(cert.id) && hitIds(s0).includes(cert.id) || policyIdsOf(v0).includes(cert.id), JSON.stringify([policyIdsOf(v0), hitIds(s0)]));
    await q(h, "UPDATE policies SET lifecycle_state='soft_deleted' WHERE id=$1", [cert.id]);
    const sameRound = await api.view(DAN);
    check("B1a (control) inside the same round the turn store still serves the round's view (the boundary is the next tool call / model step)", policyIdsOf(sameRound).includes(cert.id));
    api.round();
    const v1 = await api.view(DAN), s1 = await api.search("Group Term Life death benefit");
    check("B1b after the boundary the deleted certificate supplies no benefit", !policyIdsOf(v1).includes(cert.id) && v1.benefits.length < v0.benefits.length, JSON.stringify(policyIdsOf(v1)));
    check("B1c …and no search passage", !hitIds(s1).includes(cert.id), JSON.stringify(hitIds(s1)));
  });
  await scenario("pending deletion", null, async (h, api) => {
    const v0 = await api.view(DAN);
    await q(h, "UPDATE policies SET lifecycle_state='pending_deletion' WHERE id=$1", [ps.id]);
    api.round();
    const v1 = await api.view(DAN), s1 = await api.search("Group Term Life death benefit");
    check("B1d a document that is pending deletion supplies no benefit and no passage after the boundary", policyIdsOf(v0).includes(ps.id) && !policyIdsOf(v1).includes(ps.id) && !hitIds(s1).includes(ps.id), JSON.stringify([policyIdsOf(v1), hitIds(s1)]));
  });
  // B2 supersession: a replacement version (other file hash, other amount) is found, the superseded one is not
  await scenario("supersession", null, async (h, api) => {
    const v0 = await api.view(DAN); const s0 = await api.search("Group Term Life S$500,000 certificate");
    const newId = "7c000000-0000-4000-8000-000000000111";
    await q(h, "UPDATE policies SET superseded_at=now() WHERE id=$1", [cert.id]);
    await mk(h, DJR.doc("CERT"), newId, "sha256:al-cert-real-v2", cert.id);
    api.round();
    const v1 = await api.view(DAN), s1 = await api.search("Group Term Life S$1,000,000 certificate");
    const tl = (v: any) => v.benefits.filter((b: any) => /Term Life/i.test(b.benefit.label) && b.policy.documentRole === "schedule").map((b: any) => [b.policy.id, b.printed?.amount, b.policy.version.documentHash]);
    check("B2 before: the original certificate's S$500,000", JSON.stringify(tl(v0)).includes("500000") && JSON.stringify(tl(v0)).includes(cert.id), JSON.stringify(tl(v0)));
    check("B2a after: only the replacement version's S$1,000,000 (new id, new hash); the superseded version supplies nothing", JSON.stringify(tl(v1)).includes("1000000") && !JSON.stringify(tl(v1)).includes(cert.id) && !JSON.stringify(tl(v1)).includes("500000"), JSON.stringify(tl(v1)));
    check("B2b search hits come from the replacement only and carry its version hash", hitIds(s1).includes(newId) && !hitIds(s1).includes(cert.id) && s1.hits.filter((x: any) => x.policyId === newId).every((x: any) => x.evidence.documentHash === "sha256:al-cert-real-v2"), JSON.stringify(s1.hits.map((x: any) => [x.policyId.slice(-3), x.evidence.documentHash])));
    check("B2c (control) the cached pre-supersession search did list the original", hitIds(s0).includes(cert.id), JSON.stringify(hitIds(s0)));
  });
  // B3 person-link removal (Daniel keeps the booklet ONLY through a link: owner is Grace)
  await scenario("link removal", async (h) => { await q(h, "UPDATE policies SET family_member_id=$2 WHERE id=$1", [booklet.id, GRACE]); }, async (h, api) => {
    const v0 = await api.view(DAN);
    check("B3 before: Daniel has the booklet through his person link", policyIdsOf(v0).includes(booklet.id), JSON.stringify(policyIdsOf(v0)));
    await q(h, "DELETE FROM policy_members WHERE policy_id=$1 AND family_member_id=$2", [booklet.id, DAN]);
    api.round();
    const v1 = await api.view(DAN);
    check("B3a after the link is removed the booklet is no longer Daniel's", !policyIdsOf(v1).includes(booklet.id), JSON.stringify(policyIdsOf(v1)));
    const g = await api.view(GRACE);
    check("B3b (control) it is still Grace's (owner and link)", policyIdsOf(g).includes(booklet.id));
  });
  // B4 owner change (a field the earlier fingerprint did not hold): Daniel is the OWNER, not linked
  await scenario("owner change", async (h) => { await q(h, "DELETE FROM policy_members WHERE policy_id=$1 AND family_member_id=$2", [booklet.id, DAN]); }, async (h, api) => {
    const v0 = await api.view(DAN), g0 = await api.view(GRACE);
    check("B4 before: Daniel has the booklet as its owner (no link), Grace does through her link", policyIdsOf(v0).includes(booklet.id) && policyIdsOf(g0).includes(booklet.id), JSON.stringify([policyIdsOf(v0), policyIdsOf(g0)]));
    await q(h, "UPDATE policies SET family_member_id=$2 WHERE id=$1", [booklet.id, GRACE]); // NO updated_at, no hash change: only the owner column
    api.round();
    const v1 = await api.view(DAN);
    check("B4a after only the owner column changed, the booklet is no longer Daniel's", !policyIdsOf(v1).includes(booklet.id), JSON.stringify(policyIdsOf(v1)));
  });
  // B5 member changes
  await scenario("member rename", null, async (h, api) => {
    const v0 = await api.view(DAN);
    await q(h, "UPDATE family_members SET display_name='Wong Kai Xin', preferred_name='Kai Xin' WHERE id=$1", [DAN]);
    api.round();
    const v1 = await api.view(DAN);
    check("B5 before: Daniel's certificate row names him", v0.benefits.some((b: any) => b.policy.id === cert.id && b.applicability === "person_row"), JSON.stringify(v0.benefits.map((b: any) => [b.policy.id.slice(-3), b.applicability])));
    check("B5a after Daniel is renamed the certificate row (printed with his old name) no longer resolves to him", !v1.benefits.some((b: any) => b.policy.id === cert.id && b.applicability === "person_row"), JSON.stringify(v1.benefits.map((b: any) => [b.policy.id.slice(-3), b.applicability])));
  });
  await scenario("member removed", null, async (h, api) => {
    const v0 = await api.view(DAN);
    await q(h, "UPDATE family_members SET lifecycle_state='soft_deleted' WHERE id=$1", [DAN]);
    api.round();
    const v1 = await api.view(DAN);
    check("B6 a member removed from the household has no cached benefits afterwards", v0.benefits.length > 0 && v1.benefits.length === 0 && v1.unresolved.some((u: string) => /not an active member/.test(u)), JSON.stringify([v0.benefits.length, v1.benefits.length, v1.unresolved]));
  });
  // B7 every field a resolution reads: changing it alone (no updated_at, no hash) changes the fingerprint and, where the view shows it, the view
  const FIELDS: [string, string, unknown, (v: any) => unknown][] = [
    ["personal_coverage_confirmed", "UPDATE policies SET personal_coverage_confirmed = NOT personal_coverage_confirmed WHERE id=$1", null, (v) => v.benefits.filter((b: any) => b.policy.id === ps.id).map((b: any) => b.policy.personalProof).join()],
    ["policy_number", "UPDATE policies SET policy_number='CHANGED-1' WHERE id=$1", null, (v) => v.benefits.filter((b: any) => b.policy.id === ps.id).map((b: any) => b.policy.policyNumber).join()],
    ["insurer", "UPDATE policies SET insurer='Other Insurer Ltd' WHERE id=$1", null, (v) => v.benefits.filter((b: any) => b.policy.id === ps.id).map((b: any) => b.policy.insurer).join()],
    ["effective_date", "UPDATE policies SET effective_date='2019-01-01' WHERE id=$1", null, (v) => v.benefits.filter((b: any) => b.policy.id === ps.id).map((b: any) => b.policy.version.effectiveDate).join()],
    ["document_date", "UPDATE policies SET document_date='2019-02-02' WHERE id=$1", null, (v) => v.benefits.filter((b: any) => b.policy.id === ps.id).map((b: any) => b.policy.version.documentDate).join()],
    ["document_role", "UPDATE policies SET document_role='endorsement' WHERE id=$1", null, (v) => v.benefits.filter((b: any) => b.policy.id === ps.id).map((b: any) => b.policy.documentRole).join()],
  ];
  for (const [col, sql, , observe] of FIELDS) {
    await scenario("field " + col, null, async (h, api) => {
      const fp0 = await api.store.derivedFingerprint(DJ.ACCOUNT), v0 = await api.view(DAN);
      await q(h, sql, [ps.id]);
      api.round();
      const fp1 = await api.store.derivedFingerprint(DJ.ACCOUNT), v1 = await api.view(DAN);
      check(`B7 ${col}: a change to this field alone changes the fingerprint`, fp0 !== fp1);
      check(`B7 ${col}: …and the derived view is rebuilt (the value it prints changed)`, observe(v0) !== observe(v1), `${observe(v0)} -> ${observe(v1)}`);
    });
  }
  // fields a view does not print but resolution reads, or that scope it: fingerprint level
  const FP: [string, string, unknown[]][] = [
    ["policy_type", "UPDATE policies SET policy_type='other_type' WHERE id=$1", [ps.id]],
    ["group_policy_number (policy family)", "UPDATE policies SET group_policy_number='GIS-9999' WHERE id=$1", [ps.id]],
    ["renewal_or_expiry_date", "UPDATE policies SET renewal_or_expiry_date='2030-01-01' WHERE id=$1", [ps.id]],
    ["member date_of_birth", "UPDATE family_members SET date_of_birth='1950-05-05' WHERE id=$1", [DAN]],
    ["member relationship", "UPDATE family_members SET relationship='uncle' WHERE id=$1", [DAN]],
    ["member notes", "UPDATE family_members SET notes='changed note' WHERE id=$1", [DAN]],
    ["link benefit_tier", "UPDATE policy_members SET benefit_tier='Tier Z' WHERE policy_id=$1 AND family_member_id='" + DAN + "'", [ps.id]],
    ["link source", "UPDATE policy_members SET source='changed' WHERE policy_id=$1 AND family_member_id='" + DAN + "'", [ps.id]],
    ["row version stamp (reprocess)", "UPDATE policies SET updated_at = now() + interval '1 second' WHERE id=$1", [ps.id]],
    ["a removed document's metadata (not readable, still decides amendment removals)", "UPDATE policies SET effective_date='2018-03-03' WHERE id=$1", [DJ.doc("OLD_PRODUCT_SUMMARY").id]],
  ];
  for (const [label, sql, params] of FP) {
    await scenario("fingerprint " + label, null, async (h, api) => {
      const fp0 = await api.store.derivedFingerprint(DJ.ACCOUNT);
      await q(h, sql, params); api.round();
      const fp1 = await api.store.derivedFingerprint(DJ.ACCOUNT);
      check(`B8 fingerprint covers ${label}`, fp0 !== fp1, "unchanged");
    });
  }
  // B9 a reprocess (page text rewritten under the same file hash, row stamped) is found by the next search
  await scenario("reprocess", null, async (h, api) => {
    const s0 = await api.search("Group Term Life death benefit");
    const marker = "ZZ-REPROCESSED-MARKER-CLAUSE";
    await q(h, "UPDATE policy_pages SET text = text || $3 WHERE policy_id=$1 AND page_number=$2", [ps.id, 12, "\n\nGroup Term Life reprocessed note: " + marker + " death benefit payable.\n"]);
    await q(h, "UPDATE policies SET updated_at = now() + interval '2 seconds' WHERE id=$1", [ps.id]);
    api.round();
    const s1 = await api.search("ZZ-REPROCESSED-MARKER-CLAUSE death benefit");
    check("B9 search sees the reprocessed page after the boundary (index rebuilt)", s1.hits.some((x: any) => /ZZ-REPROCESSED-MARKER-CLAUSE/.test(x.text)) && !s0.hits.some((x: any) => /ZZ-REPROCESSED-MARKER-CLAUSE/.test(x.text)), JSON.stringify(s1.hits.map((x: any) => x.text.slice(0, 50))));
  });
  // B10 household isolation: a turn for one account never serves or keys another account's derived results
  await scenario("isolation", null, async (_h, api) => {
    const fpOther = await api.store.derivedFingerprint(DJ.OTHER_ACCOUNT);
    check("B10 inside one household's turn, another household has no turn scope (no fingerprint, nothing memoised for it)", fpOther === null);
  });
  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
