import { query } from "@/lib/db/client";
import { EMPTY_CLAIM_FACTS, type ClaimDecisionPacket, type ClaimFacts, type ClaimQuestion } from "./types";

export type ClaimSessionRow = {
  id: string;
  account_id: string;
  family_member_id: string;
  status: string;
  event_type: string | null;
  event_summary: string | null;
  facts: ClaimFacts;
  pending_question: ClaimQuestion | null;
  decision_packet: ClaimDecisionPacket | null;
  created_at: string;
  updated_at: string;
};

function normalizeFacts(value: unknown): ClaimFacts {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<ClaimFacts>;
  return { ...EMPTY_CLAIM_FACTS, ...raw, injuries: Array.isArray(raw.injuries) ? raw.injuries : [], uncertainFacts:Array.isArray(raw.uncertainFacts)?raw.uncertainFacts:[] };
}

export async function getClaimSession(accountId: string, familyMemberId: string, id: string) {
  const result = await query<ClaimSessionRow>(
    `SELECT id,account_id,family_member_id,status,event_type,event_summary,facts,pending_question,decision_packet,created_at::text,updated_at::text
       FROM claim_sessions WHERE id=$1 AND account_id=$2 AND family_member_id=$3`,
    [id,accountId,familyMemberId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { ...row, facts: normalizeFacts(row.facts) };
}

export async function createClaimSession(accountId: string, familyMemberId: string) {
  const facts = { ...EMPTY_CLAIM_FACTS, injuries: [], uncertainFacts:[] };
  const result = await query<ClaimSessionRow>(
    `INSERT INTO claim_sessions(account_id,family_member_id,facts) VALUES($1,$2,$3::jsonb)
     RETURNING id,account_id,family_member_id,status,event_type,event_summary,facts,pending_question,decision_packet,created_at::text,updated_at::text`,
    [accountId,familyMemberId,JSON.stringify(facts)],
  );
  return { ...result.rows[0], facts };
}

export async function saveClaimSession(args:{
  accountId:string; familyMemberId:string; id:string; status:string; facts:ClaimFacts; pendingQuestion:ClaimQuestion|null;
  eventSummary?:string|null; decisionPacket?:ClaimDecisionPacket|null;
}) {
  await query(
    `UPDATE claim_sessions SET status=$1,event_type=$2,event_summary=$3,facts=$4::jsonb,pending_question=$5::jsonb,decision_packet=$6::jsonb,
            completed_at=CASE WHEN $1='complete' THEN now() ELSE NULL END,updated_at=now()
      WHERE id=$7 AND account_id=$8 AND family_member_id=$9`,
    [args.status,args.facts.eventType,args.eventSummary??null,JSON.stringify(args.facts),args.pendingQuestion?JSON.stringify(args.pendingQuestion):null,args.decisionPacket?JSON.stringify(args.decisionPacket):null,args.id,args.accountId,args.familyMemberId],
  );
}
