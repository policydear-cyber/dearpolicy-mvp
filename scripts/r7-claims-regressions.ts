/**
 * Round 7 claim-conversation suite (npm run r7:claims-test).
 *
 * Drives the REAL chat route through 51 full claim conversations
 * (scripts/r7/claims-battery.ts) over the Round 6 household built with the
 * real ingestion pipeline on PGlite, under the deterministic model stand-in.
 * Every turn goes through the Round 6 rubbish detectors and the Round 7 claim
 * detectors; each conversation is also judged as a whole (re-asked facts,
 * irrelevant questions, benefits that do not fit, who it is about, whether it
 * concludes, employer group cover). Any hit fails the suite. Detector
 * positive controls run first.
 *
 * Round 8: every conversation also fails if a question answered "not sure"
 * is asked again, and 7 what-ifs answer every question "not sure" (as the
 * chat page's answer box sends it, and typed) and must move on.
 *
 * R7_DUMP=<file> writes every turn as JSON lines; R7_ONLY=<substring> runs
 * only matching conversations ("what-if" runs only the what-if checks).
 */
import { writeFileSync, appendFileSync } from "node:fs";
import { NextRequest } from "next/server";
import type { ChatAnswer } from "@/types";

process.env.DEARPOLICY_DETERMINISTIC_MODEL = "synthetic-e2e";
process.env.E2E_RUN_ID = "r7claims";
process.env.DEV_AUTH_ENABLED = "1";
process.env.MODEL_PRESET = process.env.MODEL_PRESET || "openai";
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "sk-test-not-used";
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "ci";
delete process.env.PINECONE_API_KEY; delete process.env.SUPABASE_URL;

type Hit = { rule: string; text: string };
type Rec = { conv: string; chaos?: string[]; turn: number; question: string; status: number; summary: string; answer: ChatAnswer | null; hits: Hit[] };
/** Round 8: the chaos model's mutations during this turn (only under R8_CHAOS_SEED). */
const chaosNote = (): string[] | undefined => (globalThis as { __dpChaosLog?: { op: string; mode: string }[] }).__dpChaosLog?.splice(0).map((x) => x.op + ":" + x.mode);
const UNSURE = /^(?:not sure|idk|i dont know|i don't know|dunno|not yet known|unknown)$/i;

async function main() {
  const started = Date.now();
  const watchdog = setTimeout(() => { console.error("WATCHDOG: no completion in 20 minutes"); process.exit(3); }, 20 * 60_000);
  globalThis.fetch = (async (input: RequestInfo | URL) => { throw new Error("network disabled: " + String(input)); }) as typeof fetch;
  const out = console.log;
  console.info = () => undefined; console.debug = () => undefined; console.warn = () => undefined;
  console.log = (...args: unknown[]) => { if (typeof args[0] === "string" && /^(?:\{"|\[telemetry\]|SQL note)/.test(args[0])) return; out(...args); };

  const { detect, visibleFields } = await import("./r6/detectors");
  const D = await import("./r7/claim-detectors");
  const { detectR8 } = await import("./r8/detectors");
  const R9 = await import("./r9/ingest-detectors");
  const R8 = await import("./r8/chaos-mode");
  const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  const controls = selfTest(D);
  if (controls.length) { out("DETECTOR SELF-TEST FAILED:\n- " + controls.join("\n- ")); process.exit(1); }
  out("claim detector self-test: ok");
  const guard = await import("@/lib/chat/output-guard");
  guard.guardInterventions.length = 0;

  const F = await import("./r6/fixture");
  const h = await F.buildHousehold();
  out(`household built in ${Date.now() - started} ms`);
  // Round 8: the same battery with the chaos model in place of the stand-in (scripts/r8-chaos-regressions.ts).
  if (process.env.R8_CHAOS_SEED) Object.assign(process.env, { NODE_ENV: "test", DEARPOLICY_DETERMINISTIC_MODEL: "chaos-" + process.env.R8_CHAOS_SEED });
  await seedLapsedPolicy(h.db, F);
  // ------------------------------------------------ employer group cover (product change), unit level
  const groupFails = await groupCoverChecks(F);
  // Round 9: on a household read under the ingestion chaos stand-in a failed check is a planted fact, counted with the battery's hits.
  if (groupFails.length && !process.env.R9_INGEST_SEED) { out("GROUP COVER CHECKS FAILED:\n- " + groupFails.join("\n- ")); process.exit(1); }
  out("group cover checks: ok");
  const { claimBattery } = await import("./r7/claims-battery");
  const { POST } = await import("@/app/api/chat/route");

  const pages = new Map<string, string>();
  for (const r of (await h.db.query<{ policy_id: string; text: string }>("SELECT policy_id,string_agg(text,E'\\n' ORDER BY page_number) text FROM policy_pages WHERE account_id=$1 GROUP BY 1", [F.ACCOUNT])).rows) pages.set(r.policy_id, r.text);
  const personPolicies = new Map<string, Set<string>>();
  for (const r of (await h.db.query<{ family_member_id: string; policy_id: string }>("SELECT family_member_id,policy_id FROM policy_members WHERE account_id=$1", [F.ACCOUNT])).rows) {
    if (!personPolicies.has(r.family_member_id)) personPolicies.set(r.family_member_id, new Set());
    personPolicies.get(r.family_member_id)!.add(r.policy_id);
  }
  const g0 = { pages, premiumFigures: [] as number[], householdNames: F.PEOPLE.map((p) => p.display_name), foreignNames: ["Goh Boon Kiat", "Boon Kiat"], foreignPolicyIds: new Set([h.docs.other]), personPolicies };
  for (const r of (await h.db.query<{ amount: string }>("SELECT amount::text FROM premium_records WHERE account_id=$1", [F.ACCOUNT])).rows) g0.premiumFigures.push(Number(r.amount));
  // Round 9: under R9_INGEST_SEED, who holds what comes from the household read by the well-behaved stand-in.
  const g = R9.pristineOverride(g0);
  const g9 = await R9.pageTruth(h.db as never, F.ACCOUNT);

  const only = process.env.R7_ONLY, dump = process.env.R7_DUMP;
  if (dump) writeFileSync(dump, "");
  const records: Rec[] = [];
  // A check that something is NEVER offered failing is a planted fact; one that expected a benefit and found none is usefulness lost to a badly read booklet.
  if (groupFails.length) records.push({ conv: "group cover checks", turn: -1, question: "", status: 0, summary: "", answer: null,
    hits: groupFails.map((text) => ({ rule: /\b(?:never|nothing|no GP|no card|only|not covered)\b/i.test(text.split(" (got")[0]) ? "group cover check failed" : "group cover expected but missing", text })) });
  // Round 13: a full list prints every line with its amount; a printed-limit card saying only what a listed
  // line says is left out, and one the list does not print (another person's, another amount) stays.
  {
    const { withoutListedLimitCards } = await import("@/lib/chat/policy-answer");
    const details = ["Mei Ling and Wei Jie · TravelSafe Annual Family — Trip cancellation: S$10,000 (page 3).", "Xin Yi · TravelSafe Annual Family — Baggage: S$5,000 (S$500 per item) (page 3)."];
    const limits = [{ ownerName: "Mei Ling and Wei Jie", benefitTitle: "Trip cancellation", amountText: "S$10,000" }, { ownerName: "Xin Yi", benefitTitle: "Trip cancellation", amountText: "S$5,000" },
      { ownerName: "Xin Yi", benefitTitle: "Baggage", amountText: "S$500" }, { ownerName: "Xin Yi", benefitTitle: "Baggage", amountText: "S$5,000" }];
    withoutListedLimitCards(details, limits);
    const kept = limits.map((l) => l.ownerName + "|" + l.benefitTitle + "|" + l.amountText).join(", ");
    if (kept !== "Xin Yi|Trip cancellation|S$5,000")
      records.push({ conv: "full-list card checks", turn: -1, question: "", status: 0, summary: "", answer: null, hits: [{ rule: "full list repeats its lines as cards", text: "kept: " + kept }] });
  }
  let messages = 0, conversations = 0;
  const turnsPer: number[] = [];
  const send = async (member: string, question: string, conv: { id?: string; rev?: number; personContextMessage?: string; personContextRecordedAt?: string }, personChoiceId?: string) => {
    process.env.DEV_ACCOUNT_ID = F.ACCOUNT;
    const res = await (await import("./r10/meter")).meterTurn(question, () => POST(new NextRequest("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ familyMemberId: member, scope: "member", question, conversationId: conv.id, conversationRevision: conv.rev, asynchronous: false, timeZone: "Asia/Singapore",
        ...(personChoiceId ? { personChoiceId, personContextMessage: conv.personContextMessage, personContextRecordedAt: conv.personContextRecordedAt } : {}) }) })));
    const data = await res.json(); messages++;
    if (res.status === 200) { const a = data.answer as ChatAnswer; conv.id = a.conversationId ?? conv.id; conv.rev = a.conversationRevision ?? conv.rev; conv.personContextMessage = a.personContextMessage; conv.personContextRecordedAt = a.personContextRecordedAt; }
    return { status: res.status, data };
  };

  for (const c of claimBattery()) {
    if (only && !c.name.includes(only)) continue;
    conversations++;
    const conv: { id?: string; rev?: number } = {};
    let member = c.member, userText = "", message = c.opening, choice: string | undefined;
    const used = new Set<number>(); const after = [...(c.after ?? [])];
    const answered = new Map<string, string>(); // question text -> substantive reply
    const unsure = new Set<string>(); // question text answered "not sure": never asked again
    const asked: string[] = [];
    let concluded = false, last: ChatAnswer | null = null, lastQ: { text: string; id: string } | null = null, sentAnswer = false;
    const convRecs: Rec[] = [];
    const generic = genericNeverAsk(c.name);
    let turn = 0;
    try {
      for (; turn < 25; turn++) {
        userText += "\n" + message;
        const r = await send(member, message, conv, choice);
        choice = undefined;
        const a = r.status === 200 ? r.data.answer as ChatAnswer : null;
        const hits: Hit[] = [];
        if (r.status !== 200) hits.push({ rule: "unexpected HTTP status", text: r.status + " " + JSON.stringify(r.data).slice(0, 200) });
        if (a) {
          if (a.resolvedFamilyMemberId) member = a.resolvedFamilyMemberId;
          hits.push(...detect(a, { question: message, userText, claimTurn: true, ms: 0 }, g as never));
          hits.push(...D.detectClaimTurn(a, { death: c.death, serious: c.serious, deny: c.deny, first: turn === 0 }));
          hits.push(...detectR8(a, { userText }, { pages: g.pages, today }));
          hits.push(...R9.detectR9(a, g9));
          if (!c.group && D.shownCards(a).some(D.isGroupCard)) hits.push({ rule: "group cover shown where the booklet does not apply", text: D.shownCards(a).filter(D.isGroupCard).map((i) => i.title).join("; ") });
          // A fact answered with something substantive is never asked again.
          // A correction or a new instruction typed instead of an answer answers nothing.
          if (lastQ && sentAnswer && !UNSURE.test(message.replace(/^[^:]*:\s*/, "").trim()) && !/^(?:actually|sorry|forget|btw|wait)\b/i.test(message)) answered.set(lastQ.text, message);
          // Round 8: "not sure" is an answer too -- accepted, recorded as unknown, and the question is not put again.
          if (lastQ && sentAnswer && UNSURE.test(message.replace(/^[^:]*:\s*/, "").trim())) unsure.add(lastQ.text);
          const q = a.questions[0] ?? (a.factFinding ?? []).flatMap((p) => p.nextQuestions)[0];
          if (q) {
            if (answered.has(q.text)) hits.push({ rule: "re-asked a fact already given", text: q.text + " (answered: " + answered.get(q.text) + ")" });
            if (unsure.has(q.text)) hits.push({ rule: "re-asked a question answered not sure", text: q.text });
            if (c.neverAsk?.test(q.text)) hits.push({ rule: "asked something already given or irrelevant", text: q.text });
            if (generic?.test(q.text)) hits.push({ rule: "asked something irrelevant to the event", text: q.text });
            if (asked.filter((x) => x === q.text).length >= 2) hits.push({ rule: "claim loops: same question three times", text: q.text });
            asked.push(q.text);
          }
          // A question of their own asked mid-claim ("what is MY deductible?") is about them, not the claim.
          const ownQuestion = !!c.interject?.[turn] && /\?\s*$/.test(message) && /\bmy\b/i.test(message);
          if (c.person && !ownQuestion && a.resolvedFamilyMemberId && a.resolvedFamilyMemberId !== c.person && turn > 0 && !/Xin Yi not Mei Ling/.test(userText.split("\n").at(-1) ?? "")) {
            // Only the final person matters for a conversation that switches person mid-way.
            if (!/switch person|abandon/.test(c.name)) hits.push({ rule: "wrong person", text: "resolved " + a.resolvedFamilyMemberId.slice(-3) + " expected " + c.person.slice(-3) });
          }
          if (a.mode === "claim_assessment" && !q) concluded = true;
          last = a;
          lastQ = q ? { text: q.text, id: q.id } : null;
        }
        const rec: Rec = { chaos: chaosNote(), conv: c.name, turn, question: message, status: r.status, summary: a?.summary ?? "", answer: a, hits };
        records.push(rec); convRecs.push(rec);
        if (!a) break;
        // Starting over clears what the interview had asked.
        if (/^(?:forget it|start over|start again)\b/i.test(message)) { asked.length = 0; answered.clear(); unsure.clear(); }
        // ---------------------------------------------------- next message
        sentAnswer = false;
        if (c.interject?.[turn + 1]) { message = c.interject[turn + 1]; continue; }
        const q = a.questions[0] ?? (a.factFinding ?? []).flatMap((p) => p.nextQuestions)[0];
        if (q) {
          const direct = a.questions[0];
          const index = (c.replies ?? []).findIndex(([re], i) => !used.has(i) && re.test(q.text));
          if (index >= 0) used.add(index);
          const reply = index >= 0 ? c.replies![index][1] : "Not sure";
          sentAnswer = true;
          // Someone outside the household: the family says so rather than picking a relative.
          if (q.id === "claim_person" && c.person === null && after.length) { message = after.shift()!; sentAnswer = false; continue; }
          if (q.id === "claim_person") {
            const pick = (a.personCandidates ?? []).find((p) => new RegExp(reply, "i").test(p.label)) ?? (a.personCandidates ?? [])[0];
            if (!pick) break;
            message = pick.label; choice = pick.id; continue;
          }
          // The chat page's answer box sends a free-text answer as "Question: answer".
          if (reply === "Not sure" && c.unsureAs === "restated" && direct && !q.options?.length && q.type !== "yes_no" && q.type !== "choice") { message = q.text.replace(/\?\s*$/, "") + ": Not sure"; continue; }
          message = !direct ? q.text.replace(/\?\s*$/, "") + ": " + reply
            : q.options?.includes(reply) || /^(?:sorry|actually|i dont|idk|just|and|dunno|not sure|yes|ya|no\b|forget)/i.test(reply) || reply.includes(",") ? reply : q.text.replace(/\?\s*$/, "") + ": " + reply;
          continue;
        }
        if (after.length) { message = after.shift()!; continue; }
        break;
      }
    } catch (e) {
      const rec: Rec = { conv: c.name, turn: -1, question: "", status: 0, summary: "", answer: null, hits: [{ rule: "threw", text: (e instanceof Error ? e.stack ?? e.message : String(e)).slice(0, 400) }] };
      records.push(rec); convRecs.push(rec);
    }
    turnsPer.push(convRecs.length);
    const hitsBefore = convRecs.at(-1)!.hits.length;
    // ---------------------------------------------------- whole-conversation checks
    const end = convRecs.at(-1)!;
    const finalAnswer = [...convRecs].reverse().find((r) => r.answer && r.answer.mode === "claim_assessment" && D.shownCards(r.answer).length)?.answer
      ?? [...convRecs].reverse().find((r) => r.answer?.mode === "claim_assessment")?.answer ?? last;
    const convHit = (rule: string, text: string) => end.hits.push({ rule, text: text.slice(0, 300) });
    if (convRecs.length < 10) convHit("conversation shorter than 10 turns", String(convRecs.length));
    // The same long answer three times in one conversation reads as a loop.
    const said = new Map<string, number>();
    for (const r of convRecs) if (r.summary.length > 60) said.set(r.summary, (said.get(r.summary) ?? 0) + 1);
    for (const [text, n] of said) if (n >= 3) convHit("same answer repeated", n + "x: " + text.slice(0, 160));
    if ((c.concludes ?? true) && !concluded) convHit("claim never concludes", (last?.summary ?? "").slice(0, 200));
    if (lastQ && turn >= 25) convHit("claim never concludes", "still asking: " + lastQ.text);
    if (finalAnswer) {
      const all = visibleFields(finalAnswer).map((f) => f.text).join("\n");
      for (const w of c.want ?? []) if (!D.shownCards(finalAnswer).some((i) => w.test(i.title))) convHit("expected benefit missing", w + " in: " + D.shownCards(finalAnswer).map((i) => i.title).join("; "));
      if (c.finalMentions && !convRecs.some((r) => r.answer && c.finalMentions!.test(visibleFields(r.answer).map((f) => f.text).join("\n")))) convHit("answer ignores the event", "expected " + c.finalMentions + " in: " + finalAnswer.summary.slice(0, 200));
      if (c.person === null && D.shownCards(finalAnswer).length) convHit("benefits offered for someone outside the household", D.shownCards(finalAnswer).map((i) => i.title).join("; "));
      if (c.person && finalAnswer.resolvedFamilyMemberId && finalAnswer.resolvedFamilyMemberId !== c.person) convHit("wrong person", "final answer about " + finalAnswer.resolvedFamilyMemberId.slice(-3));
      const groupCards = D.shownCards(finalAnswer).filter(D.isGroupCard);
      if (c.group) {
        if (!groupCards.length) convHit("group cover left out", "no 'Possible cover through' card: " + D.shownCards(finalAnswer).map((i) => i.title).join("; "));
        for (const card of groupCards) {
          const text = card.reason + " " + card.conditions.join(" ");
          if (!/HR\b/.test(text) || !/employ/i.test(text)) convHit("group card without the employer/HR caveat", text);
          if (!/\(page \d+\)|page \d+/.test(text)) convHit("group card without its page", text);
          if (/S\$\s?\d/.test(text) || card.amountText) convHit("group booklet figure shown as a personal amount", text);
          if (!(finalAnswer.citations ?? []).some((x) => x.policyId === h.docs.booklet)) convHit("group card without a citation to the booklet", JSON.stringify((finalAnswer.citations ?? []).map((x) => x.policyName)));
        }
        if (groupCards.length && !D.checklist(finalAnswer).some((d) => /\bHR\b/.test(d))) convHit("group cover not in the document checklist", D.checklist(finalAnswer).join("; "));
        // The claim on record -- and so the printed claim pack -- carries the group card and the HR confirmation too.
        if (groupCards.length && conv.id) {
          const row = (await h.db.query<{ decision_packet: import("@/lib/claims/types").ClaimDecisionPacket | null }>("SELECT decision_packet FROM claim_sessions WHERE account_id=$1 AND conversation_id=$2 ORDER BY updated_at DESC LIMIT 1", [F.ACCOUNT, conv.id])).rows[0];
          const packet = row?.decision_packet;
          if (!packet) convHit("group cover: no claim on record", "conversation " + conv.id);
          else {
            const { claimPackContent } = await import("@/lib/claims/claim-pack");
            const pack = claimPackContent({ packet, claimantName: "Claimant", generatedOn: new Date("2026-10-01") }).sections.flatMap((x) => x.lines).join("\n");
            if (!packet.assessments.some((x) => /^Possible cover through\b/.test(x.title)) || !/Possible cover through/.test(pack)) convHit("group cover missing from the claim pack", packet.assessments.map((x) => x.title).join("; "));
            if (!/\bHR\b/.test(pack)) convHit("HR confirmation missing from the claim pack", pack.slice(0, 300));
          }
        }
        void all;
      }
    }
    // Round 13: the claim pack (the printed sheet) follows the same rule as the answer: every sentence once.
    if (conv.id && finalAnswer?.claimSessionId) {
      const row = (await h.db.query<{ decision_packet: import("@/lib/claims/types").ClaimDecisionPacket | null }>("SELECT decision_packet FROM claim_sessions WHERE account_id=$1 AND conversation_id=$2 ORDER BY updated_at DESC LIMIT 1", [F.ACCOUNT, conv.id])).rows[0];
      if (row?.decision_packet) {
        const { claimPackContent } = await import("@/lib/claims/claim-pack");
        const lines = claimPackContent({ packet: row.decision_packet, claimantName: "Claimant", generatedOn: new Date("2026-10-01") }).sections.flatMap((x) => x.lines);
        const seen = new Map<string, number>();
        for (const line of lines) for (const raw of line.replace(/^\s*(?:•|\d+\.|Condition:|Why it may be relevant:)\s*/, "").split(/(?<=[.!?])\s+/)) {
          if (raw.trim().length < 25) continue;
          const k = D.normalSentence(raw); seen.set(k, (seen.get(k) ?? 0) + 1);
        }
        for (const [k, n] of seen) if (n > 1) convHit("claim pack repeats a sentence", n + "x: " + k);
        // Round 13: every benefit on record that is not ruled out -- a personal one still needing documents
        // included, not only the group card -- is on the sheet with its status, as every card the answer shows.
        const STATUS = / — (?:Likely applicable|Potentially applicable|Needs checking)$/;
        const benefitLines = lines.filter((l) => !/^\s/.test(l) && STATUS.test(l));
        const packTitles = new Set(benefitLines.map((l) => l.replace(STATUS, "").replace(/ \(the policy pays this instead of .*\)$/, "")));
        const recorded = row.decision_packet.assessments.filter((x) => x.status !== "not_applicable");
        for (const x of recorded) if (!packTitles.has(x.title)) convHit("benefit missing from the claim pack", x.title + " (" + x.status + ") not in: " + [...packTitles].join("; ").slice(0, 200));
        if (benefitLines.length !== recorded.length) convHit("claim pack benefit without its status", benefitLines.length + " benefits with a status for " + recorded.length + " on record");
        const recordedTitles = new Set(row.decision_packet.assessments.map((x) => x.title));
        for (const card of D.shownCards(finalAnswer)) if (recordedTitles.has(card.title) && !packTitles.has(card.title)) convHit("card in the answer missing from the claim pack", card.title);
        if (dump) appendFileSync(dump, JSON.stringify({ conv: c.name, pack: lines }) + "\n");
      }
    }
    // Round 13: a hospital stay's claim always asks for the itemised bill and the discharge summary,
    // whichever policy (personal or the employer's group plan) may pay it.
    if (/^hosp:/.test(c.name) && (c.concludes ?? true) && !/\bnot admitted\b/i.test(c.opening) && finalAnswer?.mode === "claim_assessment" && D.shownCards(finalAnswer).length) {
      const docs = D.checklist(finalAnswer);
      if (!docs.some((d) => /itemi[sz]ed/i.test(d) && /bill/i.test(d)) || !docs.some((d) => /discharge summary/i.test(d))) convHit("hospital claim checklist without the bill or discharge summary", docs.join("; ") || "(no checklist)");
    }
    for (const x of convRecs.at(-1)!.hits.slice(hitsBefore)) out("  conversation " + c.name + ": " + x.rule + " — " + x.text.slice(0, 200));
    if (dump) for (const rec of convRecs) appendFileSync(dump, JSON.stringify(rec) + "\n");
  }
  // ---------------------------------------------------- Round 8: "not sure" in a what-if
  // A what-if ("how much can I claim if...") records nothing against a
  // profile, so its question ("Roughly how much would the ambulance charge
  // be?") was never a pending fact: "Not sure" re-ran the what-if and the same
  // question came back every time. Each what-if here answers every question
  // "Not sure" -- as the chat page's answer box sends it, or typed -- and must
  // accept it, move on, never put that question again (not even to the same
  // what-if asked again in other words), and never ask about an ambulance for a
  // planned operation.
  if (!only || only.startsWith("what-if")) {
    // Every free-text what-if question: a reply in either form is read as that reply.
    {
      const R = await import("@/lib/chat/what-if-replies");
      const { whatIfQuestion } = await import("@/lib/policies/benefit-catalog");
      const unit: string[] = [];
      for (const factKey of ["hospitalNights", "hospitalBill", "ambulanceBill", "vehicleRepairBill", "outOfPocket"]) {
        const text = whatIfQuestion(factKey);
        if (!text) { unit.push(factKey + ": no what-if question"); continue; }
        const state = { query: "q", answers: {}, pending: { factKey, text } };
        for (const said of [text.replace(/\?\s*$/, "") + ": Not sure", text + " Not sure", "Not sure", "not sure", "idk", "dunno", "I don't know", "not sure yet", "unknown"])
          if (R.readWhatIfReply(state, said)?.value !== "unknown") unit.push(factKey + ": " + JSON.stringify(said) + " not read as unknown");
        for (const [said, n] of [["about 300", 300], ["S$1,200", 1200], ["3", 3], [text.replace(/\?\s*$/, "") + ": about 2k", 2000]] as [string, number][])
          if (R.readWhatIfReply(state, said)?.value !== n) unit.push(factKey + ": " + JSON.stringify(said) + " not read as " + n);
        for (const said of ["what documents do i need?", "what if I break my leg?", "ok thanks"])
          if (R.readWhatIfReply(state, said)) unit.push(factKey + ": " + JSON.stringify(said) + " taken as a reply");
        if (R.readWhatIfReply({ query: "q", answers: {} }, "Not sure")) unit.push("a reply read with no question open");
      }
      for (const t of ["I am having knee surgery next week, how much would my policy pay?", "my knee operation is scheduled next month", "planned cataract surgery in December"])
        if (!R.describesPlannedProcedure(t)) unit.push("planned operation not recognised: " + t);
      for (const t of ["what if I need an ambulance after a road accident?", "if I am hospitalised after an accident", "emergency surgery next week after a fall"])
        if (R.describesPlannedProcedure(t)) unit.push("emergency read as planned: " + t);
      if (unit.length) { out("WHAT-IF REPLY CHECKS FAILED:\n- " + unit.join("\n- ")); process.exitCode = 1; }
      else out("what-if reply checks: ok");
    }
    type W = { name: string; member: string; opening: string; form: "restated" | "bare"; never?: RegExp; denyCard?: RegExp; then?: string; figure?: string };
    const cases: W[] = [
      { name: "what-if: hospital stay after an accident (answer box)", member: F.MEILING, opening: "how much can I claim if I'm hospitalised after an accident?", form: "restated", then: "and what if I'm hospitalised after an accident overseas?" },
      { name: "what-if: ambulance after a road accident (typed)", member: F.MEILING, opening: "what if I need an ambulance after a road accident, how much can claim?", form: "bare", then: "what if it was a motorcycle accident instead, how much can claim?" },
      { name: "what-if: planned knee surgery (answer box)", member: F.MEILING, opening: "I am having knee surgery next week, how much would my policy pay?", form: "restated", never: /ambulance/i, denyCard: /ambulance/i },
      { name: "what-if: planned knee operation (typed)", member: F.MEILING, opening: "my knee operation is scheduled next month, how much would my plans pay?", form: "bare", never: /ambulance/i, denyCard: /ambulance/i },
      { name: "what-if: hospital stay of 5 days (answer box)", member: F.MEILING, opening: "if I am hospitalised for 5 days how much can I claim?", form: "restated" },
      { name: "what-if: child hospitalised (typed)", member: F.XINYI, opening: "how much can we claim if Xin Yi is hospitalised for dengue?", form: "bare" },
      { name: "what-if: a figure, then not sure (answer box)", member: F.MEILING, opening: "how much can I claim if I'm hospitalised after an accident?", form: "restated", figure: "about 300" },
    ];
    let questioned = 0;
    for (const w of cases) {
      conversations++;
      const conv: { id?: string; rev?: number } = {};
      const convRecs: Rec[] = [];
      const asked: string[] = []; const unsure = new Set<string>();
      let message = w.opening, lastSummary = "", concluded = false, open: string | null = null;
      for (let turn = 0; turn < 8; turn++) {
        const r = await send(w.member, message, conv);
        const a = r.status === 200 ? r.data.answer as ChatAnswer : null;
        const hits: Hit[] = [];
        if (!a) hits.push({ rule: "unexpected HTTP status", text: r.status + " " + JSON.stringify(r.data).slice(0, 200) });
        else {
          hits.push(...detect(a, { question: message, userText: message, claimTurn: true, ms: 0 }, g as never));
          hits.push(...D.detectClaimTurn(a, { first: turn === 0 }));
          hits.push(...detectR8(a, { userText: message }, { pages: g.pages, today }));
          hits.push(...R9.detectR9(a, g9));
          const q = a.questions[0];
          if (q) {
            if (unsure.has(q.text)) hits.push({ rule: "re-asked a question answered not sure", text: q.text });
            else if (asked.includes(q.text)) hits.push({ rule: "what-if question asked twice", text: q.text });
            if (w.never?.test(q.text)) hits.push({ rule: "asked something irrelevant to the event", text: q.text });
            asked.push(q.text);
          }
          if (w.denyCard) for (const card of D.shownCards(a)) if (w.denyCard.test(card.title)) hits.push({ rule: "benefit does not fit the event", text: card.title });
          if (turn > 0 && a.summary === lastSummary) hits.push({ rule: "same answer to a reply (the reply was ignored)", text: a.summary.slice(0, 200) });
          lastSummary = a.summary;
          if (a.mode === "claim_assessment" && !q) concluded = true;
          open = q?.text ?? null;
        }
        const rec: Rec = { chaos: chaosNote(), conv: w.name, turn, question: message, status: r.status, summary: a?.summary ?? "", answer: a, hits };
        records.push(rec); convRecs.push(rec);
        const q = a?.questions[0];
        if (!a || !q) break;
        const reply = w.figure && turn === 0 && !q.options?.length ? w.figure : "Not sure";
        message = w.form === "restated" && q.type === "text" && !q.options?.length ? q.text.replace(/\?\s*$/, "") + ": " + reply : reply;
        if (reply === "Not sure") unsure.add(q.text);
      }
      if (asked.length) questioned++;
      turnsPer.push(convRecs.length);
      const end = convRecs.at(-1)!;
      if (open) end.hits.push({ rule: "what-if never moves on", text: "still asking after 8 turns: " + open });
      else if (asked.length && !concluded) end.hits.push({ rule: "what-if never moves on", text: (end.summary || "").slice(0, 200) });
      if (w.then) {
        // The same what-if in other words: what was answered "not sure" is not put again.
        const r = await send(w.member, w.then, conv);
        const a = r.status === 200 ? r.data.answer as ChatAnswer : null;
        const hits: Hit[] = [];
        if (!a) hits.push({ rule: "unexpected HTTP status", text: String(r.status) });
        else {
          hits.push(...detect(a, { question: w.then, userText: w.then, claimTurn: true, ms: 0 }, g as never));
          hits.push(...detectR8(a, { userText: w.then }, { pages: g.pages, today }));
          hits.push(...R9.detectR9(a, g9));
          if (a.questions[0] && unsure.has(a.questions[0].text)) hits.push({ rule: "re-asked a question answered not sure", text: a.questions[0].text });
        }
        const rec: Rec = { chaos: chaosNote(), conv: w.name, turn: convRecs.length, question: w.then, status: r.status, summary: a?.summary ?? "", answer: a, hits };
        records.push(rec); convRecs.push(rec);
      }
      for (const x of convRecs.flatMap((r) => r.hits)) out("  what-if " + w.name + ": " + x.rule + " — " + x.text.slice(0, 200));
      if (dump) for (const rec of convRecs) appendFileSync(dump, JSON.stringify(rec) + "\n");
    }
    // The checks above only bite if the what-ifs actually ask something.
    if (!R8.chaosSeed() && questioned < 4) { out("FAIL: only " + questioned + " what-if(s) asked a question; the not-sure checks need at least 4"); process.exitCode = 1; }
    else out("what-if not-sure checks: " + cases.length + " what-ifs, " + questioned + " asked a question");
  }
  // ---------------------------------------------------- report
  const byRule = new Map<string, number>();
  for (const r of records) for (const x of r.hits) byRule.set(x.rule, (byRule.get(x.rule) ?? 0) + 1);
  const failing = records.filter((r) => r.hits.some((x) => R8.isFailure(x.rule)));
  for (const r of failing.slice(0, Number(process.env.R7_SHOW ?? 60))) out(`\n✗ ${r.conv} #${r.turn} > ${r.question.slice(0, 120)}\n  < ${r.summary.slice(0, 300)}\n  - ` + r.hits.map((x) => x.rule + ": " + x.text).join("\n  - "));
  out("\n=== detector hits by rule ===");
  for (const [rule, n] of [...byRule].sort((a, b) => b[1] - a[1])) out(String(n).padStart(4) + "  " + rule);
  out(`\n${conversations} conversations, ${messages} messages (${Math.min(...turnsPer)}-${Math.max(...turnsPer)} turns each); ${failing.length} turns with hits; total ${Math.round((Date.now() - started) / 1000)} s`);
  if (!only && !R8.chaosSeed() && conversations < 40) { out("FAIL: at least 40 conversations are required"); process.exitCode = 1; }
  if (failing.length) process.exitCode = 1;
  if (guard.guardInterventions.length) { out("FAIL: the output guard changed " + guard.guardInterventions.length + " answer(s):\n" + guard.guardInterventions.slice(0, 5).map((x) => { let i = 0; while (i < x.before.length && x.before[i] === x.after[i]) i++; return "  before: …" + x.before.slice(Math.max(0, i - 160), i + 200) + "\n  after:  …" + x.after.slice(Math.max(0, i - 160), i + 200); }).join("\n")); process.exitCode = 1; }
  else out("output guard interventions: 0");
  R8.reportChaos(out, "r7-claims", records, guard.guardInterventions.length, messages);
  clearTimeout(watchdog);
  await h.db.close();
}

/** The group booklet rules on the real household rows: who it covers, which
 * rows answer which event, and how the card, citation and checklist read. */
async function groupCoverChecks(F: typeof import("./r6/fixture")): Promise<string[]> {
  const G = await import("@/lib/claims/group-cover");
  const fails: string[] = [];
  const check = (name: string, ok: boolean, got?: unknown) => { if (!ok) fails.push(name + (got === undefined ? "" : " (got " + JSON.stringify(got).slice(0, 300) + ")")); };
  const facts = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { value: v, state: "known", quote: "", recordedAt: "2026-10-01T00:00:00Z", source: "user" }])) as never;
  const names = (rows: { benefitName: string }[]) => rows.map((r) => r.benefitName).join(" | ");
  const [wj] = await G.loadGroupBooklets(F.ACCOUNT, F.WEIJIE);
  const [ml] = await G.loadGroupBooklets(F.ACCOUNT, F.MEILING);
  const [xy] = await G.loadGroupBooklets(F.ACCOUNT, F.XINYI);
  check("employee booklet found with Plan A and employer", !!wj && wj.memberTier === "Plan A" && wj.employer === "Harbourfront Logistics Pte Ltd" && wj.employeeId === F.WEIJIE, wj);
  check("spouse linked as dependant", !!ml && /Dependants/.test(ml.memberTier ?? ""), ml);
  check("nobody else's booklet for Siew Lan or Wei Ming", !(await G.loadGroupBooklets(F.ACCOUNT, F.SIEWLAN)).length && !(await G.loadGroupBooklets(F.ACCOUNT, F.WEIMING)).length);
  check("another household never sees the booklet", !(await G.loadGroupBooklets(F.OTHER_ACCOUNT, F.WEIJIE)).length);
  check("rows printed as not covered are never offered", ![...(wj?.rows ?? []), ...(ml?.rows ?? [])].some((r) => /^Dependants$/.test(r.tier ?? "") && /Group Term Life|Dental|Traditional Chinese/.test(r.benefitName)), ml?.rows.filter((r) => /Dependants/.test(r.tier ?? "")));
  if (wj && ml && xy) {
    const illnessDeath = G.groupRowsForEvent(wj, F.WEIJIE, "accidental_death", facts({ death: true, accidentalDeath: false }));
    check("employee death from illness: group term life only", /Group Term Life/.test(names(illnessDeath)) && !/accident/i.test(names(illnessDeath)), names(illnessDeath));
    const accidentDeath = G.groupRowsForEvent(wj, F.WEIJIE, "accidental_death", facts({ death: true, accidentalDeath: true }));
    check("employee accidental death: term life and accidental death", /Group Term Life/.test(names(accidentDeath)) && /Personal Accident - accidental death/.test(names(accidentDeath)), names(accidentDeath));
    check("employee column only (Plan A, never Plan B/C or dependants)", illnessDeath.every((r) => /^Plan A/.test(r.tier ?? "")), illnessDeath);
    check("dependant death from illness: nothing (term life is not for dependants)", !G.groupRowsForEvent(ml, F.MEILING, "accidental_death", facts({ death: true, accidentalDeath: false })).length);
    const depStay = G.groupRowsForEvent(xy, F.XINYI, "medical_reimbursement", facts({ hospitalised: true, eventType: "illness" }));
    check("dependant hospital stay: dependants column hospital rows", /room and board/i.test(names(depStay)) && depStay.every((r) => /Dependants/.test(r.tier ?? "")) && !/Intensive care/i.test(names(depStay)), depStay);
    check("travel delay: nothing from the booklet", !G.groupRowsForEvent(wj, F.WEIJIE, "travel", facts({ travelEventType: "Flight delay" })).length);
    check("childbirth: nothing from the booklet", !G.groupRowsForEvent(ml, F.MEILING, "medical_reimbursement", facts({ hospitalised: true, maternity: true })).length);
    check("clinic visit for an illness: GP benefit", /General practitioner/.test(names(G.groupRowsForEvent(xy, F.XINYI, null, facts({ eventType: "illness", treatmentType: "Outpatient or clinic" })))));
    check("emergency visit: no GP benefit", !G.groupRowsForEvent(xy, F.XINYI, null, facts({ eventType: "illness", treatmentType: "Emergency department" })).length);
    const tpd = G.groupRowsForEvent(wj, F.WEIJIE, "disability_tpd", facts({ disabled: true, eventType: "accident" }));
    check("employee TPD after an accident: term life TPD and GPA permanent disablement", /total and permanent/.test(names(tpd)) && /permanent disablement/.test(names(tpd)), names(tpd));
    const cover = G.groupCoverFor({ booklets: [wj], person: { id: F.WEIJIE, name: "Wei Jie" }, category: "accidental_death", facts: facts({ death: true, accidentalDeath: false }), eventDate: "2026-09-28" });
    const card = cover.cards[0];
    check("one clearly labelled group card", cover.cards.length === 1 && card.title === "Possible cover through Harbourfront Logistics Pte Ltd" && card.status === "potentially_applicable", cover.cards);
    check("card says employer plan, employment and HR", !!card && /employer’s plan/.test(card.reason) && /still employed/.test(card.reason) && /HR or the insurer/.test(card.reason), card?.reason);
    check("card cites the booklet page and shows no figure", !!card && /\(page 3\)/.test(card.reason) && !card.amountText && !/S\$|\d{2,},\d{3}|salary/i.test(card.reason + card.conditions.join(" ")), card);
    check("citation to the booklet page", cover.citations.some((c) => c.policyId === wj.policyId && c.pageStart === 3 && c.evidenceLabel === "Group benefits booklet"), cover.citations);
    check("HR confirmation for the checklist", cover.documents.some((d) => /HR/.test(d) && /employment/.test(d)), cover.documents);
    const dep = G.groupCoverFor({ booklets: [xy], person: { id: F.XINYI, name: "Xin Yi" }, category: "medical_reimbursement", facts: facts({ hospitalised: true, eventType: "illness" }), eventDate: "2026-09-12" });
    check("dependant card names the employee and the enrolment", /Wei Jie was still employed and Xin Yi was still enrolled as a dependant/.test(dep.cards[0]?.reason ?? "") && /enrolled dependants/.test(dep.cards[0]?.reason ?? ""), dep.cards[0]?.reason);
    const outside = G.groupCoverFor({ booklets: [{ ...wj, effectiveDate: "2027-01-01" }], person: { id: F.WEIJIE, name: "Wei Jie" }, category: "accidental_death", facts: facts({ death: true }), eventDate: "2026-09-28" });
    check("event outside the booklet's dates: no card", !outside.cards.length);
    // A booklet with no printed dates: an event clearly outside its scheme year gets no card; otherwise the card says the dates couldn't be checked.
    const undated = { ...wj, effectiveDate: null, expiryDate: null, documentYear: 2026 };
    check("printed scheme year read from the booklet", wj.documentYear === 2026, wj.documentYear);
    check("undated booklet, event years before its scheme year: no card", !G.groupCoverFor({ booklets: [undated], person: { id: F.WEIJIE, name: "Wei Jie" }, category: "accidental_death", facts: facts({ death: true, accidentalDeath: false }), eventDate: "2019-05-01" }).cards.length);
    check("undated booklet, event years after its scheme year: no card", !G.groupCoverFor({ booklets: [undated], person: { id: F.WEIJIE, name: "Wei Jie" }, category: "accidental_death", facts: facts({ death: true, accidentalDeath: false }), eventDate: "2031-02-01" }).cards.length);
    const inYear = G.groupCoverFor({ booklets: [undated], person: { id: F.WEIJIE, name: "Wei Jie" }, category: "accidental_death", facts: facts({ death: true, accidentalDeath: false }), eventDate: "2026-09-28" });
    check("undated booklet, event in its scheme year: card that says the dates couldn't be checked", inYear.cards.length === 1 && /couldn’t check/.test(inYear.cards[0].conditions.join(" ")) && /HR/.test(inYear.cards[0].conditions.join(" ")), inYear.cards[0]?.conditions);
    const noInfo = G.groupCoverFor({ booklets: [{ ...undated, documentYear: null }], person: { id: F.WEIJIE, name: "Wei Jie" }, category: "accidental_death", facts: facts({ death: true, accidentalDeath: false }), eventDate: "2019-05-01" });
    check("no date information at all: card kept, dates couldn't be checked", noInfo.cards.length === 1 && /couldn’t check/.test(noInfo.cards[0].conditions.join(" ")), noInfo.cards[0]?.conditions);
    const dated = G.groupCoverFor({ booklets: [{ ...wj, effectiveDate: "2026-01-01", expiryDate: "2026-12-31" }], person: { id: F.WEIJIE, name: "Wei Jie" }, category: "accidental_death", facts: facts({ death: true, accidentalDeath: false }), eventDate: "2026-09-28" });
    check("dated booklet, event inside its dates: no 'couldn't check' caveat", dated.cards.length === 1 && !/couldn’t check/.test(dated.cards[0].conditions.join(" ")), dated.cards[0]?.conditions);
    const answer = { mode: "claim_assessment", summary: "Thanks — that’s what I need for now. For the death, Wei Jie’s policies have a possible benefit: X. This is not a promise of payment: the insurer decides.", details: [], claimItems: [], nextSteps: ["Send these documents for the claim: Death certificate."], confidence: null, citations: [], disclaimer: "", claimSessionId: null, questions: [], knownFacts: [], missingFacts: [] } as unknown as ChatAnswer;
    G.applyGroupCover(answer, cover); G.applyGroupCover(answer, cover);
    check("applied once, however often", answer.claimItems.length === 1 && answer.citations.length === 1 && (answer.nextSteps[0].match(/HR/g) ?? []).length === 1 && (answer.summary.match(/group plan/g) ?? []).length === 1, answer);
    check("group sentence before the closing caveat", /group plan — it is on its own card below, and HR or the insurer can confirm it\. This is not a promise of payment/.test(answer.summary), answer.summary);
    // Round 13: a summary that already names the booklet as the possible benefit is not told about it twice; the card is still added.
    const named = { ...answer, summary: "Wei Jie’s policies have a possible benefit: " + (cover.cards[0]?.coverLabel ?? "?") + " — Death. This is not a promise of payment: the insurer decides.", claimItems: [], citations: [], nextSteps: [] } as unknown as ChatAnswer;
    G.applyGroupCover(named, cover);
    check("booklet already named: card added, no second group sentence", named.claimItems.length === 1 && !/group plan/.test(named.summary), named.summary);
  }
  return fails;
}

/** A personal accident plan for Wei Ming whose cover ended on 30 June 2026
 * (no renewal on file): an event after that date is after the cover lapsed. */
async function seedLapsedPolicy(db: import("@electric-sql/pglite").PGlite, F: typeof import("./r6/fixture")) {
  const id = F.uuid(900);
  await db.query(`INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,document_authority,processing_status,original_filename,storage_key,effective_date,renewal_or_expiry_date,extracted_json,quarantine_status,benefits_indexed_at,conditions_indexed_at,ledger_read_at,file_hash)
    VALUES($1,$2,$3,'Orchid Assurance (fictitious)','SafeGuard PA','SGPA-2025-0912','Personal Accident','personal_schedule',true,95,'ready','SafeGuard_PA_Schedule_2025.pdf','sgpa.pdf','2025-07-01','2026-06-30',$4::jsonb,'scan_clean',now(),now(),now(),'sha256:sgpa')`,
    [id, F.ACCOUNT, F.WEIMING, JSON.stringify({ productsMentioned: ["SafeGuard PA"] })]);
  await db.query("INSERT INTO policy_members(policy_id,family_member_id,account_id) VALUES($1,$2,$3)", [id, F.WEIMING, F.ACCOUNT]);
  const pages = ["SafeGuard PA Policy Schedule\nInsured: Lim Wei Ming\nPolicy number SGPA-2025-0912\nPeriod of insurance 1 July 2025 to 30 June 2026",
    "SafeGuard PA - Schedule of Benefits\nFracture benefit S$800 per accident\nAccidental medical expenses up to S$1,500 per accident\nPage 2 of 2"];
  for (const [i, text] of pages.entries()) await db.query("INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,$3,$4)", [F.ACCOUNT, id, i + 1, text]);
  for (const [name, quote, kind, value, traits] of [["Fracture benefit", "Fracture benefit S$800 per accident", "fixed", 800, ["accident", "bodily_injury"]],
    ["Accidental medical expenses", "Accidental medical expenses up to S$1,500 per accident", "expense_cap", 1500, ["accident", "medical_expense"]]] as [string, string, string, number, string[]][])
    await db.query("INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,requires,formula_kind,formula_value,currency,source_page,quote,conditions,requirements,needs_review) VALUES($1,$2,'SafeGuard PA',$3,$4::text[],ARRAY['accident']::text[],$5,$6,'SGD',2,$7,'[]'::jsonb,'[]'::jsonb,false)",
      [F.ACCOUNT, id, name, traits, kind, value, quote]);
}

/** Questions that never belong to a kind of event. */
function genericNeverAsk(name: string): RegExp | null {
  if (name.startsWith("travel:") && !/medical/.test(name)) return /still alive|diagnos|fracture|discharged|death certificate|which hospital/i;
  if (name.startsWith("death:")) return /still alive|fracture|discharged|What treatment|lasting impairment/i;
  if (name.startsWith("ci:")) return /fracture|trip|accident happen|death certificate/i;
  if (name.startsWith("hosp:") || name.startsWith("maternity") || name.startsWith("child:")) return /still alive|death certificate|trip (?:start|end)|fracture/i;
  if (name.startsWith("acc:")) return /still alive|death certificate|trip (?:start|end)|diagnosed/i;
  return null;
}

function selfTest(D: typeof import("./r7/claim-detectors")): string[] {
  const fails: string[] = [];
  const base = (over: Partial<ChatAnswer>): ChatAnswer => ({ mode: "claim_assessment", summary: "Thanks — that’s what I need for now.", details: [], claimItems: [], nextSteps: [], confidence: null,
    citations: [{ chunkId: "c", policyId: "p1", policyName: "TermSecure 20", pageStart: 2, pageEnd: 2 }], disclaimer: "", claimSessionId: null, questions: [], knownFacts: [], missingFacts: [], ...over });
  const card = (title: string, extra: object = {}) => ({ title, status: "likely_applicable" as const, amountText: null, reason: "Pays a set amount (page 2).", conditions: [], ...extra });
  const expectRule = (name: string, a: ChatAnswer, rule: RegExp, t: Partial<Parameters<typeof D.detectClaimTurn>[1]> = {}) => {
    const hits = D.detectClaimTurn(a, { first: false, ...t });
    if (!hits.some((x) => rule.test(x.rule))) fails.push(name + " not detected (got " + hits.map((x) => x.rule).join(", ") + ")");
  };
  if (D.detectClaimTurn(base({ claimItems: [card("Lim Wei Jie · TermSecure 20 — Sum assured - death")] }), { first: false }).length) fails.push("clean claim answer flagged");
  expectRule("promise", base({ summary: "Good, you will receive S$800,000 for this." }), /payout promised/);
  expectRule("promise 2", base({ summary: "The insurer is guaranteed to pay this claim." }), /payout promised/);
  expectRule("cheerful", base({ summary: "Great news! The policy has a benefit." }), /cheerful/, { serious: true });
  expectRule("no condolence", base({ summary: "What was the date of death?" }), /condolence/, { death: true, first: true });
  expectRule("two asks", base({ summary: "When did it happen? And where?" }), /more than one question/);
  expectRule("duplicate card", base({ claimItems: [card("A · TermSecure 20 — Sum assured - death"), card("B · TermSecure 20 — Sum assured - death")] }), /duplicate card/);
  expectRule("misfit", base({ claimItems: [card("Lim Xin Yi · PA Guardian — Fracture benefit")] }), /does not fit/, { deny: /Fracture/ });
  expectRule("no citation", base({ citations: [], claimItems: [card("X", { reason: "Pays a set amount." })] }), /citation/);
  expectRule("dup document", base({ nextSteps: ["Send these documents for the claim: Specialist's diagnosis report; Histopathology or test results confirming the diagnosis; Specialist's medical report stating the diagnosis and the date it was made; Histology, biopsy or scan report supporting the diagnosis."] }), /duplicate document/);
  expectRule("group figure", base({ claimItems: [card("Possible cover through Harbourfront", { amountText: "S$300,000" })] }), /group booklet figure/);
  expectRule("repeated thanks", base({ summary: "Thanks, noted. Thanks — that’s what I need for now." }), /repeated thanks/);
  if (D.sameDocument("Death certificate", "Police or coroner's report")) fails.push("distinct documents judged the same");
  expectRule("garbled echo", base({ summary: "DearPolicy didn’t find i send the insurer in the parts of your policies read so far." }), /garbled echo/);
  expectRule("generic fallback", base({ summary: "I couldn’t find a benefit in your documents that matches what you described." }), /generic/);
  // Round 13: the claim-answer shape (word ceilings, every sentence once, a page on every card).
  const shape = (name: string, a: ChatAnswer, rule: RegExp) => { if (!D.detectClaimAnswerShape(a).some((x) => rule.test(x.rule))) fails.push(name + " not detected"); };
  if (D.detectClaimAnswerShape(base({ claimItems: [card("A · TermSecure 20 — Sum assured - death"), card("A · TravelSafe — Accidental death", { reason: "Pays a set amount (page 3)." })] })).length) fails.push("clean claim answer flagged by the shape rules");
  shape("main text over the ceiling", base({ claimItems: [card("A · X — Death")], details: ["word ".repeat(D.CLAIM_MAIN_WORDS).trim() + "."] }), /claim answer too long$/);
  shape("cards over the ceiling", base({ claimItems: Array.from({ length: 12 }, (_, n) => card("A · X — Benefit " + n, { reason: "Pays a set amount (page " + (n + 2) + ").", conditions: ["Still needed: " + "detail ".repeat(30).trim() + " " + n + "."] })) }), /too long with its cards/);
  shape("sentence repeated across cards", base({ claimItems: [card("A · X — Death", { conditions: ["Subject to the insurer's assessment and the plan's own terms."] }), card("A · Y — Disability", { reason: "Pays a share of the sum insured (page 4).", conditions: ["Subject to the insurer's assessment and the plan's own terms."] })] }), /repeated sentence in a claim answer/);
  shape("summary said again in the details", base({ summary: "This is not a promise of payment: the insurer decides after assessing the claim.", details: ["This is not a promise of payment: the insurer decides after assessing the claim."], claimItems: [card("A · X — Death")] }), /repeated sentence in a claim answer/);
  shape("card without its page", base({ claimItems: [card("A · X — Death", { reason: "Pays a set amount." })] }), /without its page/);
  shape("cards that read the same", base({ claimItems: [card("A · X — Pre-hospital", { reason: "Pays as charged (page 3)." }), card("A · X — Post-hospital", { reason: "Pays as charged (page 3)." })] }), /no distinguishing content/);
  return fails;
}

main().then(() => process.exit(process.exitCode ?? 0), (e) => { console.error(e); process.exit(2); });
