/**
 * Drives battery conversations through the REAL chat route and judges every
 * answer with the Round 6 rubbish detectors. Shared by the Round 6 quality
 * suite (deterministic model) and the Round 7 hostile-model fuzz suite.
 */
import { appendFileSync } from "node:fs";
import { NextRequest } from "next/server";
import type { ChatAnswer } from "@/types";
import type { Conversation } from "../r6/battery";
import type { GroundTruth, Hit } from "../r6/detectors";

export type TurnRecord = { conv: string; turn: number; question: string; status: number; ms: number; summary: string; answer: ChatAnswer | null; error?: unknown; hits: Hit[] };

type F_ = typeof import("../r6/fixture");
type Household = Awaited<ReturnType<F_["buildHousehold"]>>;

/** Ground truth for the detectors, read from the household's database. */
export async function groundTruth(h: Household, F: F_, moneyIn: (t: string) => number[]): Promise<GroundTruth> {
  const pages = new Map<string, string>();
  for (const r of (await h.db.query<{ policy_id: string; text: string }>("SELECT pp.policy_id,string_agg(pp.text,E'\\n' ORDER BY pp.page_number) text FROM policy_pages pp JOIN policies p ON p.id=pp.policy_id WHERE p.account_id=$1 AND p.lifecycle_state='active' GROUP BY 1", [F.ACCOUNT])).rows) pages.set(r.policy_id, r.text);
  const premiumFigures: number[] = [];
  for (const r of (await h.db.query<{ amount: string; notes: string | null }>("SELECT amount::text,notes FROM premium_records WHERE account_id=$1", [F.ACCOUNT])).rows) {
    premiumFigures.push(Number(r.amount)); premiumFigures.push(...moneyIn(r.notes ?? ""));
  }
  const personPolicies = new Map<string, Set<string>>();
  for (const r of (await h.db.query<{ family_member_id: string; policy_id: string }>("SELECT family_member_id,policy_id FROM policy_members WHERE account_id=$1", [F.ACCOUNT])).rows) {
    if (!personPolicies.has(r.family_member_id)) personPolicies.set(r.family_member_id, new Set());
    personPolicies.get(r.family_member_id)!.add(r.policy_id);
  }
  return { pages, premiumFigures: [...new Set(premiumFigures)], householdNames: F.PEOPLE.map((p) => p.display_name), foreignNames: ["Goh Boon Kiat", "Boon Kiat"],
    foreignPolicyIds: new Set([h.docs.other]), personPolicies };
}

export type RunOptions = {
  h: Household; F: F_;
  conversations: Conversation[];
  detect: typeof import("../r6/detectors").detect;
  visibleFields: typeof import("../r6/detectors").visibleFields;
  moneyIn: (t: string) => number[];
  only?: string; dump?: string;
  /** Extra detectors run on every answer (e.g. the fuzz canary check). */
  extra?: (a: ChatAnswer, ctx: { question: string; userText: string; claimTurn: boolean; account: string }) => Hit[];
  /** When it returns true for an answer, an unmet "mentions" expectation is
   * not a hit (an honest "couldn't answer just now" under a failing model). */
  excuseMissingMention?: (a: ChatAnswer) => boolean;
};

export async function runConversations(o: RunOptions): Promise<{ records: TurnRecord[]; messages: number }> {
  const { h, F, detect, visibleFields } = o;
  const { POST } = await import("@/app/api/chat/route");
  let gMain = await groundTruth(h, F, o.moneyIn);
  const records: TurnRecord[] = [];
  let messages = 0;
  const accountOf = (c: { account?: string }) => c.account === "empty" ? F.EMPTY_ACCOUNT : c.account === "other" ? F.OTHER_ACCOUNT : F.ACCOUNT;
  const memberOf = (m: string | null) => m === "EMPTY" ? F.EMPTY_PERSON : m === "OTHER" ? F.OTHER_PERSON : m;
  const send = async (account: string, member: string | null, scope: string | undefined, question: string, conv: { id?: string; rev?: number; personContextMessage?: string; personContextRecordedAt?: string }, personChoiceId?: string) => {
    process.env.DEV_ACCOUNT_ID = account;
    const t0 = Date.now();
    const res = await POST(new NextRequest("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ familyMemberId: member, scope: scope ?? (member ? "member" : "family"), question, conversationId: conv.id, conversationRevision: conv.rev, asynchronous: false, timeZone: "Asia/Singapore",
        ...(personChoiceId ? { personChoiceId, personContextMessage: conv.personContextMessage, personContextRecordedAt: conv.personContextRecordedAt } : {}) }) }));
    const ms = Date.now() - t0;
    const data = await res.json();
    messages++;
    if (res.status === 200) { const a = data.answer as ChatAnswer; conv.id = a.conversationId ?? conv.id; conv.rev = a.conversationRevision ?? conv.rev;
      conv.personContextMessage = a.personContextMessage; conv.personContextRecordedAt = a.personContextRecordedAt; }
    return { status: res.status, data, ms };
  };
  const judge = (name: string, turn: number, question: string, userText: string, claimTurn: boolean, r: { status: number; data: { answer?: ChatAnswer; error?: string }; ms: number }, expect?: { status?: number } & Record<string, unknown>, account = F.ACCOUNT) => {
    // Seen from another household, this household's people and documents are the foreign ones.
    const g = account === F.OTHER_ACCOUNT ? { ...gMain, pages: new Map<string, string>(), premiumFigures: [], foreignNames: F.PEOPLE.flatMap((p) => [p.display_name, p.preferred_name]),
      foreignPolicyIds: new Set(Object.entries(h.docs).filter(([k]) => k !== "other").map(([, v]) => v)), personPolicies: new Map<string, Set<string>>() }
      : account === F.EMPTY_ACCOUNT ? { ...gMain, pages: new Map<string, string>(), premiumFigures: [], foreignPolicyIds: new Set(Object.values(h.docs)), personPolicies: new Map<string, Set<string>>() } : gMain;
    const hits: Hit[] = [];
    const wantStatus = expect?.status ?? 200;
    if (r.status !== wantStatus) hits.push({ rule: "unexpected HTTP status", text: r.status + " " + JSON.stringify(r.data).slice(0, 200) });
    if (r.status !== 200) {
      const msg = String(r.data?.error ?? "");
      if (!msg || /Invalid request|issues|zod|Chat failed/i.test(msg) && r.status !== 400) hits.push({ rule: "error message not plain", text: msg });
    }
    const a = r.status === 200 ? r.data.answer! : null;
    if (a) {
      const e = (expect ?? {}) as { mentions?: RegExp | RegExp[]; asksPerson?: boolean };
      const mentions = Array.isArray(e.mentions) ? e.mentions : e.mentions ? [e.mentions] : [];
      hits.push(...detect(a, { question, userText, claimTurn, ms: r.ms, expect: { ...(expect as object), mentions: undefined } as never }, g));
      if (o.extra) hits.push(...o.extra(a, { question, userText, claimTurn, account }));
      const all = visibleFields(a).map((f) => f.text).join("\n");
      const excused = o.excuseMissingMention?.(a) ?? false;
      for (const m of mentions) if (!m.test(all) && !excused) hits.push({ rule: "answer ignores the question", text: "expected " + m + " in: " + a.summary.slice(0, 200) });
      if (e.asksPerson && a.questions[0]?.id !== "claim_person" && !excused) hits.push({ rule: "ambiguous person not asked", text: a.summary.slice(0, 200) });
    }
    const rec: TurnRecord = { conv: name, turn, question, status: r.status, ms: r.ms, summary: a?.summary ?? String(r.data?.error ?? ""), answer: a, hits };
    records.push(rec);
    if (o.dump) appendFileSync(o.dump, JSON.stringify(rec) + "\n");
    return a;
  };

  for (const c of o.conversations) {
    if (o.only && !c.name.includes(o.only)) continue;
    if (c.before === "delete-travel") { await h.db.query("UPDATE policies SET lifecycle_state='soft_deleted' WHERE id=$1", [h.docs.travel]); gMain = await groundTruth(h, F, o.moneyIn); }
    if (c.before === "restore-travel") { await h.db.query("UPDATE policies SET lifecycle_state='active' WHERE id=$1", [h.docs.travel]); gMain = await groundTruth(h, F, o.moneyIn); }
    const account = accountOf(c), member = memberOf(c.member);
    const conv: { id?: string; rev?: number } = {};
    let userText = "";
    let currentMember = member;
    try {
      if (c.turns) {
        for (const [i, t] of c.turns.entries()) {
          userText += "\n" + t.say;
          const r = await send(account, currentMember, c.scope, t.say, conv);
          // The chat page follows the person the answer was about (setMemberId).
          if (r.status === 200 && r.data.answer?.resolvedFamilyMemberId) currentMember = r.data.answer.resolvedFamilyMemberId;
          const a = judge(c.name, i, t.say, userText, false, r, t.expect as never, account);
          if (!a && r.status === 200) break;
        }
      } else if (c.claim) {
        let message = c.claim.opening; const used = new Set<number>(); const asked: string[] = []; let choice: string | undefined;
        for (let turn = 0; turn < (c.claim.maxTurns ?? 9); turn++) {
          userText += "\n" + message;
          const r = await send(account, currentMember, c.scope, message, conv, choice);
          if (r.status === 200 && r.data.answer?.resolvedFamilyMemberId) currentMember = r.data.answer.resolvedFamilyMemberId;
          choice = undefined;
          const a = judge(c.name, turn, message, userText, true, r, c.claim.expect as never, account);
          if (!a) break;
          const direct = a.questions[0];
          const q = direct ?? (a.factFinding ?? []).flatMap((p) => p.nextQuestions)[0];
          if (!q) {
            if (c.claim.finalMentions && !(o.excuseMissingMention?.(a) ?? false)) { const all = visibleFields(a).map((f) => f.text).join("\n"); if (!c.claim.finalMentions.test(all)) records.at(-1)!.hits.push({ rule: "answer ignores the question", text: "claim ended without " + c.claim.finalMentions + ": " + a.summary.slice(0, 200) }); }
            break;
          }
          const again = asked.filter((x) => x === q.text).length;
          if (again >= 2) { records.at(-1)!.hits.push({ rule: "same claim question asked three times", text: q.text }); break; }
          asked.push(q.text);
          const index = c.claim.replies.findIndex(([re], i) => !used.has(i) && re.test(q.text));
          if (index >= 0) used.add(index);
          const reply = index >= 0 ? c.claim.replies[index][1] : "Not sure";
          // As app/chat/page.tsx sends it: a person card is a tap on a person;
          // a direct card's option is sent as tapped; anything typed into a
          // card, and every tap on the plan's own question, is "Question: answer".
          if (q.id === "claim_person") {
            const pick = (a.personCandidates ?? []).find((p) => new RegExp(reply, "i").test(p.label)) ?? (a.personCandidates ?? [])[0];
            if (!pick) break;
            message = pick.label; choice = pick.id;
          } else if (!direct) message = q.text.replace(/\?\s*$/, "") + ": " + reply;
          else message = q.options?.includes(reply) || /^(?:sorry|actually|i dont|idk|just|and|dunno|not sure|yes he)\b/i.test(reply) || reply.includes(",") ? reply : q.text.replace(/\?\s*$/, "") + ": " + reply;
        }
      }
    } catch (e) {
      const rec: TurnRecord = { conv: c.name, turn: -1, question: "", status: 0, ms: 0, summary: "", answer: null, hits: [{ rule: "threw", text: (e instanceof Error ? e.stack ?? e.message : String(e)).slice(0, 400) }] };
      records.push(rec); if (o.dump) appendFileSync(o.dump, JSON.stringify(rec) + "\n");
    }
  }
  return { records, messages };
}
