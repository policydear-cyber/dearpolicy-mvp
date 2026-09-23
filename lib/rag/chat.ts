import { retrieveRelevantChunks } from "./retrieve";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { answerFromEvidence } from "./answer";
import { query } from "@/lib/db/client";
import type { StructuredCoverageFact } from "@/types";
import { handleClaimTurn, looksLikeClaimIntent } from "@/lib/claims/orchestrator";
import { answerPortfolioQuestion, looksLikePortfolioQuestion } from "@/lib/coverage/answer";
import { resolveClaimPerson, type ClaimPerson } from "@/lib/claims/person";
import type { ChatAnswer } from "@/types";
import { askContextualDearPolicy,type ChatRequest } from "@/lib/chat/workflow";

export async function askDearPolicy(args:ChatRequest) {
  return askContextualDearPolicy(args);
}

async function confirmedCoverageFacts(accountId: string, familyMemberId: string): Promise<StructuredCoverageFact[]> {
  const result = await query<{
    id: string; policy_id: string; category: string; amount: string | null; currency: string | null;
    product_name: string | null; source_page: number | null; evidence_text: string | null;
    insurer: string | null; policy_name: string | null; policy_number: string | null; document_role: string | null;
  }>(
    `SELECT pc.id,pc.policy_id,pc.category,pc.amount::text,pc.currency,pc.product_name,pc.source_page,pc.evidence_text,
            p.insurer,p.product_name AS policy_name,p.policy_number,p.document_role
     FROM policy_coverages pc
     JOIN policies p ON p.id=pc.policy_id AND p.account_id=pc.account_id AND ${activePredicate("p")}
     WHERE pc.account_id=$1 AND pc.family_member_id=$2 AND pc.confirmed=true AND pc.evidence_verified=true
     ORDER BY p.document_authority DESC,p.effective_date DESC NULLS LAST,p.created_at DESC`,
    [accountId, familyMemberId],
  );
  return result.rows.map((r) => ({
    id: r.id, policyId: r.policy_id, category: r.category, amount: r.amount == null ? null : Number(r.amount), currency: r.currency,
    productName: r.product_name, sourcePage: r.source_page, evidenceText: r.evidence_text, insurer: r.insurer, policyName: r.policy_name,
    policyNumber: r.policy_number, documentRole: r.document_role,
  }));
}

/** Historical guided-session compatibility. New requests use the contextual workflow. */
export async function legacyAskDearPolicy(args: { accountId: string; familyMemberId: string; question: string; claimSessionId?: string | null; timeZone?: string; personContextMessage?: string; personContextRecordedAt?: string; personChoiceId?: string }) {
  const family = await query<ClaimPerson>(`SELECT id,display_name,preferred_name,relationship FROM family_members WHERE account_id=$1 AND ${activePredicate()} ORDER BY created_at`, [args.accountId]);
  const chosen = args.personContextMessage && args.personChoiceId ? family.rows.find(p => p.id === args.personChoiceId) : null;
  const resolution = chosen ? { status: "resolved" as const, person: chosen, explicit: true } : resolveClaimPerson(args.question, family.rows, args.familyMemberId);
  if (resolution.status !== "resolved") {
    const candidates = resolution.candidates;
    const answer: ChatAnswer = { mode: "fact_finding", summary: resolution.status === "ambiguous"
      ? "More than one family profile matches. Which person does this event concern?"
      : `I could not match ${resolution.name} to a family profile. Please choose the correct person or add their profile first.`,
      details: [], claimItems: [], nextSteps: [], confidence: null, citations: [], disclaimer: "A person's identity must be resolved before DearPolicy uses their policies.",
      claimSessionId: null, questions: [{ id: "claim_person", text: "Which family member does this concern?", type: "choice", options: candidates.map(p => p.display_name), why: "This determines whose personal policies apply." }],
      knownFacts: [], missingFacts: ["Person"], personCandidates: candidates.map(p => ({ id: p.id, label: `${p.display_name} · ${p.relationship}` })),
      personContextMessage: args.personContextMessage ?? args.question, personContextRecordedAt: args.personContextRecordedAt ?? new Date().toISOString() };
    return { answer, retrieved: [] };
  }
  const previousMemberId = args.familyMemberId;
  args = { ...args, familyMemberId: resolution.person.id,
    claimSessionId: resolution.person.id !== previousMemberId || args.personContextMessage ? null : args.claimSessionId };
  if (args.personContextMessage) args.question = `${args.personContextMessage}\nPerson confirmed for this event: ${resolution.person.display_name}`;
  const finish = (answer: ChatAnswer, retrieved: unknown[] = []) => ({ answer: { ...answer, resolvedFamilyMemberId: resolution.person.id }, retrieved });
  const claimArgs = { accountId: args.accountId, familyMemberId: args.familyMemberId, message: args.question, personName: resolution.person.display_name,
    timeZone: args.timeZone, ...(args.personContextRecordedAt ? { now: new Date(args.personContextRecordedAt) } : {}) };
  if (args.claimSessionId) {
    const answer = await handleClaimTurn({ ...claimArgs, claimSessionId:args.claimSessionId });
    return finish(answer);
  }
  if (looksLikePortfolioQuestion(args.question)) {
    const answer=await answerPortfolioQuestion(args.accountId,args.familyMemberId,args.question);
    await query(`INSERT INTO chat_messages(account_id,family_member_id,role,content) VALUES($1,$2,'user',$3)`,[args.accountId,args.familyMemberId,args.question]);
    await query(`INSERT INTO chat_messages(account_id,family_member_id,role,content,citations) VALUES($1,$2,'assistant',$3,$4::jsonb)`,[args.accountId,args.familyMemberId,answer.summary,JSON.stringify(answer.citations)]);
    return finish(answer);
  }
  if (looksLikeClaimIntent(args.question)) {
    const answer = await handleClaimTurn({ ...claimArgs, claimSessionId:null });
    return finish(answer);
  }

  const [chunks, coverages] = await Promise.all([
    retrieveRelevantChunks({ accountId:args.accountId,familyMemberId:args.familyMemberId,question:args.question, limit: 12 }),
    confirmedCoverageFacts(args.accountId, args.familyMemberId),
  ]);
  const answer = await answerFromEvidence({ question: args.question, chunks, coverages });

  await query(`INSERT INTO chat_messages(account_id, family_member_id, role, content) VALUES($1,$2,'user',$3)`,[args.accountId,args.familyMemberId,args.question]);
  await query(`INSERT INTO chat_messages(account_id, family_member_id, role, content, citations) VALUES($1,$2,'assistant',$3,$4::jsonb)`,[args.accountId,args.familyMemberId,answer.summary + (answer.details.length ? "\n" + answer.details.join("\n") : ""),JSON.stringify(answer.citations)]);
  return finish(answer, chunks.map(({ text, ...meta }) => meta));
}
