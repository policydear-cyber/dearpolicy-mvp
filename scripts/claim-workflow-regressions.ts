import assert from "node:assert/strict";
import { pool } from "@/lib/db/client";
import { legacyAskDearPolicy as askDearPolicy } from "@/lib/rag/chat";
import { EMPTY_CLAIM_FACTS } from "@/lib/claims/types";
import fixture from "./fixtures/singlife-death-wording.json";

/** Retain historical guided-session orchestration and persistence regressions.
 * No Ollama, GPU, production data or running PostgreSQL is required. */
export async function runClaimWorkflowRegressions() {
  const account = "00000000-0000-0000-0000-000000000001";
  const desmond = "00000000-0000-4000-8000-000000000002";
  const charmaine = "00000000-0000-4000-8000-000000000003";
  const other = "00000000-0000-4000-8000-000000000004";
  const anchor = "2026-09-14T12:00:00Z";
  let family = [{ id: desmond, display_name: "Tan Yi Chuen Desmond", preferred_name: "Desmond", relationship: "self" }, { id: charmaine, display_name: "Ong Pei Lin Charmaine", preferred_name: "Charmaine", relationship: "spouse" }];
  let wordingInsurer = "Singlife";
  let wordingGroup: string | null = "G007500";
  let wordingMember = charmaine;
  let expectedMember = charmaine;
  let wordingPersonal = false;
  let wordingRole = "benefit_guide";
  let wordingPages: { pageNumber: number; text: string }[] | null = null;
  let includeWording = true;
  let wordingText = "Group Term Life Death 100% of Sum Insured Group Personal Accident Death due to Accident 100% of Sum Insured";
  let created = 0;
  const sessions = new Map<string, Record<string, unknown>>();
  const savedChats: { person: string; role: string; text: string }[] = [];
  const fixtureQuery = async (sql: string, params: unknown[] = []) => {
    if (/SELECT id FROM family_members/.test(sql)) return { rows: family.filter(p => p.id === params[0] && params[1] === account) };
    if (/FROM family_members WHERE account_id/.test(sql)) { assert.equal(params[0], account); return { rows: family }; }
    if (/INSERT INTO claim_sessions/.test(sql)) {
      assert.equal(params[0], account); const id = `10000000-0000-4000-8000-${String(++created).padStart(12, "0")}`;
      const row = { id, account_id: account, family_member_id: params[1], status: "fact_finding", event_type: null, event_summary: null, facts: JSON.parse(String(params[2])), pending_question: null, decision_packet: null, created_at: anchor, updated_at: anchor };
      sessions.set(id, row); return { rows: [row] };
    }
    if (/FROM claim_sessions WHERE id/.test(sql)) { assert.equal(params[1], account); const row = sessions.get(String(params[0])); return { rows: row?.family_member_id === params[2] ? [row] : [] }; }
    if (/FROM policy_coverages pc/.test(sql)) {
      assert.equal(params[0], account); assert.equal(params[1], expectedMember, "Only the named person's policies may be loaded");
      const base = { policy_id: "certificate", family_member_id: expectedMember, currency: "SGD", source_page: 1, evidence_text: "personal certificate", insurer: "Singapore Life Ltd", policy_name: "MINDEF & MHA Group Insurance", policy_number: "personal", group_policy_number: "G007500", document_role: "certificate", effective_date: "2022-10-06", renewal_or_expiry_date: null };
      return { rows: [{ ...base, id: "gtl", category: "Death", amount: "1000000", coverage_product_name: "Group Term Life" }, { ...base, id: "gpa", category: "Personal Accident", amount: "600000", coverage_product_name: "Group Personal Accident" }] };
    }
    if (/FROM premium_records pr/.test(sql)) { assert.equal(params[0], account); assert.equal(params[1], expectedMember); return { rows: [{ latest: null }] }; }
    if (/FROM policies p JOIN policy_pages pp/.test(sql)) {
      assert.equal(params[0], account); assert.equal(params[1], expectedMember);
      assert.match(sql,/WHERE p.account_id=\$1/);assert.match(sql,/pp.account_id=p.account_id/);
      assert.match(sql,/p.personal_coverage_confirmed=false/);
      const pages=wordingPages??[{pageNumber:2,text:wordingText}];
      return { rows: includeWording && (wordingMember === params[1] || !wordingPersonal) ? pages.map(p=>({ policy_id: "wording", page_number: p.pageNumber, text: p.text, group_policy_number: wordingGroup, insurer: wordingInsurer, product_name: "Benefit Summary", original_filename: "Benefit Summary.pdf", document_role: wordingRole, personal_coverage_confirmed: wordingPersonal, linked_to_member: wordingMember===params[1] })) : [] };
    }
    if (/UPDATE claim_sessions SET/.test(sql)) {
      assert.equal(params[7], account); const row = sessions.get(String(params[6])); assert.ok(row); assert.equal(row.family_member_id, params[8]);
      Object.assign(row, { status: params[0], event_type: params[1], event_summary: params[2], facts: JSON.parse(String(params[3])), pending_question: params[4] ? JSON.parse(String(params[4])) : null, decision_packet: params[5] ? JSON.parse(String(params[5])) : null }); return { rows: [], rowCount: 1 };
    }
    if (/INSERT INTO chat_messages/.test(sql)) { assert.equal(params[0], account); assert.equal(params[1], expectedMember); savedChats.push({ person: String(params[1]), role: sql.includes("'user'") ? "user" : "assistant", text: String(params[3]) }); return { rows: [], rowCount: 1 }; }
    // lib/db/client.ts makes sure the single-household accounts row exists
    // before the app's first real query. It means to skip that against a
    // fixture mock, but the guard it uses is "no DATABASE_URL", and CI sets
    // one -- so every run of this suite died on its very first query instead
    // of on a test. A strict mock has to answer for it like any other
    // statement.
    if (/INSERT INTO accounts/.test(sql)) return { rows: [], rowCount: 0 };
    throw new Error(`Unexpected fixture SQL: ${sql}`);
  };
  const originalQuery = pool.query;
  pool.query = fixtureQuery as typeof pool.query;
  let cases = 0;
  try {
    const request = new Request("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ familyMemberId: desmond, question: "Charmaine died from an accident yesterday. What can I claim?", timeZone: "Asia/Singapore", personContextRecordedAt: anchor }) });
    const result = await askDearPolicy({accountId:account,...await request.json()});
    assert.equal(result.answer.resolvedFamilyMemberId, charmaine); assert.equal(result.answer.mode, "fact_finding"); assert.match(result.answer.summary, /S\$1,000,000/); assert.equal(result.answer.questions[0]?.id, "cause_of_death_document");
    assert.equal(result.answer.claimItems.length, 2); assert.equal(result.answer.citations.filter(c => c.personalEvidence === true).length, 2);
    assert.equal(result.answer.claimItems.find(i => i.title.includes("Term Life"))?.amountText, "S$1,000,000"); assert.equal(result.answer.claimItems.find(i => i.title.includes("Accident"))?.amountText, null);
    assert.equal(sessions.get(result.answer.claimSessionId!)?.event_type, "death"); assert.equal((sessions.get(result.answer.claimSessionId!)?.facts as typeof EMPTY_CLAIM_FACTS).deathDate, "2026-09-13");
    assert.ok(result.answer.details.some((s: string) => s.includes("recent premium"))); cases++;
    // A "Yes" to document availability is never enough on its own: DearPolicy
    // asks for the document itself, and the accidental-death benefit still
    // never joins the total from a chat answer alone.
    const confirmed = await askDearPolicy({ accountId: account, familyMemberId: charmaine, question: "Yes", claimSessionId: result.answer.claimSessionId, timeZone: "Asia/Singapore" });
    assert.equal(confirmed.answer.mode, "fact_finding"); assert.match(confirmed.answer.summary, /S\$1,000,000/); assert.doesNotMatch(confirmed.answer.summary, /1,600,000/);
    assert.equal(confirmed.answer.questions[0]?.id, "cause_of_death_document_upload");
    assert.equal(confirmed.answer.claimItems.find(i => i.title.includes("Accident"))?.amountText, null);
    assert.equal(sessions.get(confirmed.answer.claimSessionId!)?.status, "fact_finding"); cases++;
    const before = created;
    family = [...family, { ...family[1], id: other, relationship: "sibling" }];
    const ambiguous = await askDearPolicy({ accountId: account, familyMemberId: desmond, question: "Charmaine died from an accident yesterday", timeZone: "Asia/Singapore", personContextRecordedAt: anchor });
    assert.equal(ambiguous.answer.questions[0].id, "claim_person"); assert.equal(created, before); assert.equal(ambiguous.answer.claimSessionId, null); assert.equal(ambiguous.answer.personContextMessage, "Charmaine died from an accident yesterday"); cases++;
    const clarified = await askDearPolicy({ accountId: account, familyMemberId: desmond, question: "Ong Pei Lin Charmaine", personChoiceId: charmaine, personContextMessage: ambiguous.answer.personContextMessage, personContextRecordedAt: ambiguous.answer.personContextRecordedAt, timeZone: "Asia/Singapore" });
    assert.equal(clarified.answer.resolvedFamilyMemberId, charmaine); assert.equal(clarified.answer.questions[0]?.id, "cause_of_death_document"); assert.match(clarified.answer.summary, /S\$1,000,000/); assert.equal((sessions.get(clarified.answer.claimSessionId!)?.facts as typeof EMPTY_CLAIM_FACTS).deathDate, "2026-09-13"); cases++;
    const clarifiedConfirmed = await askDearPolicy({ accountId: account, familyMemberId: charmaine, question: "Yes", claimSessionId: clarified.answer.claimSessionId, timeZone: "Asia/Singapore" });
    assert.equal(clarifiedConfirmed.answer.questions[0]?.id, "cause_of_death_document_upload"); assert.doesNotMatch(clarifiedConfirmed.answer.summary, /1,600,000/); cases++;
    family = family.slice(0, 2);
    includeWording = false;
    const missing = await askDearPolicy({ accountId: account, familyMemberId: desmond, question: "Charmaine died from an accident yesterday", timeZone: "Asia/Singapore" });
    assert.equal(missing.answer.claimItems.every(i => i.amountText === null && i.status === "needs_document"), true); assert.doesNotMatch(missing.answer.summary, /1,600,000/); cases++;
    includeWording = true; wordingInsurer = "Another insurer";
    const wrongInsurer = await askDearPolicy({ accountId: account, familyMemberId: desmond, question: "Charmaine died from an accident yesterday", timeZone: "Asia/Singapore" }); assert.equal(wrongInsurer.answer.claimItems.every(i => i.amountText === null), true); cases++;
    wordingInsurer = "Singlife"; wordingGroup = "ANOTHER-GROUP";
    const wrongGroup = await askDearPolicy({ accountId: account, familyMemberId: desmond, question: "Charmaine died from an accident yesterday", timeZone: "Asia/Singapore" }); assert.equal(wrongGroup.answer.claimItems.every(i => i.amountText === null), true); cases++;
    wordingText = `A reference to G007500 does not change this document's stated policy group. ${wordingText}`;
    const contradictedGroup = await askDearPolicy({ accountId: account, familyMemberId: desmond, question: "Charmaine died from an accident yesterday", timeZone: "Asia/Singapore" }); assert.equal(contradictedGroup.answer.claimItems.every(i => i.amountText === null), true);
    wordingGroup = "G007500"; wordingMember = desmond;wordingPersonal=true;wordingRole="certificate";
    const wrongPerson = await askDearPolicy({ accountId: account, familyMemberId: desmond, question: "Charmaine died from an accident yesterday", timeZone: "Asia/Singapore" }); assert.equal(wrongPerson.answer.claimItems.every(i => i.amountText === null), true); cases++;
    assert.ok(savedChats.length > 0 && savedChats.every(c => c.person === charmaine));
    wordingPersonal=false;wordingRole="benefit_guide";
    const shared=await askDearPolicy({accountId:account,familyMemberId:desmond,question:"Charmaine died from an accident yesterday",timeZone:"Asia/Singapore"});
    assert.match(shared.answer.summary,/S\$1,000,000/);
    const sharedConfirmed=await askDearPolicy({accountId:account,familyMemberId:charmaine,question:"Yes",claimSessionId:shared.answer.claimSessionId,timeZone:"Asia/Singapore"});
    assert.equal(sharedConfirmed.answer.questions[0]?.id,"cause_of_death_document_upload");assert.doesNotMatch(sharedConfirmed.answer.summary,/1,600,000/);cases++;
    expectedMember=desmond;wordingMember=other;wordingGroup=null;wordingPages=fixture.benefitSummary.pages;
    const actual=await askDearPolicy({accountId:account,familyMemberId:charmaine,question:"desmond died in a motorbike accident yesterday",timeZone:"Asia/Singapore",personContextRecordedAt:anchor});
    assert.equal(actual.answer.resolvedFamilyMemberId,desmond);assert.equal(actual.answer.mode,"fact_finding");
    assert.match(actual.answer.summary,/S\$1,000,000/);assert.equal(actual.answer.claimItems.find(i=>i.title.includes("Term Life"))?.amountText,"S$1,000,000");assert.equal(actual.answer.claimItems.find(i=>i.title.includes("Accident"))?.amountText,null);
    assert.deepEqual(actual.answer.questions.map(q=>q.id),["competitive_racing"]);
    assert.deepEqual(actual.answer.citations.filter(c=>!c.personalEvidence).map(c=>c.pageStart),[3,5,10]);
    assert.equal((sessions.get(actual.answer.claimSessionId!)?.facts as typeof EMPTY_CLAIM_FACTS).deathDate,"2026-09-13");
    assert.equal((sessions.get(actual.answer.claimSessionId!)?.decision_packet as {ready:boolean}).ready,false);cases++;
    const noRace=await askDearPolicy({accountId:account,familyMemberId:desmond,question:"No",claimSessionId:actual.answer.claimSessionId,timeZone:"Asia/Singapore"});
    assert.equal(noRace.answer.mode,"fact_finding");assert.equal(noRace.answer.questions[0]?.id,"cause_of_death_document");assert.match(noRace.answer.summary,/S\$1,000,000/);
    // The racing exclusion is resolved, but the accidental-death amount still
    // waits on a reviewed, matched cause-of-death document -- saying "Yes"
    // to availability only moves DearPolicy to asking for the document itself.
    const completed=await askDearPolicy({accountId:account,familyMemberId:desmond,question:"Yes",claimSessionId:noRace.answer.claimSessionId,timeZone:"Asia/Singapore"});
    assert.equal(completed.answer.mode,"fact_finding");assert.equal(completed.answer.questions[0]?.id,"cause_of_death_document_upload");assert.match(completed.answer.summary,/S\$1,000,000/);assert.doesNotMatch(completed.answer.summary,/1,600,000/);
    assert.equal(completed.answer.claimItems.find(i=>i.title.includes("Accident"))?.amountText,null);
    const completedSession=sessions.get(completed.answer.claimSessionId!)!;assert.equal((completedSession.facts as typeof EMPTY_CLAIM_FACTS).competitiveRacing,false);assert.equal((completedSession.facts as typeof EMPTY_CLAIM_FACTS).deathDate,"2026-09-13");assert.equal(completedSession.status,"fact_finding");cases++;
    console.log(`DearPolicy API/orchestration/persistence fixture tests passed (${cases} scenarios).`);
  } finally { pool.query = originalQuery; }
}
