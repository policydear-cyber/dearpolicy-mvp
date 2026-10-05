/**
 * Round 7 product decision (owner chose the recommended option): in death,
 * accident and disability claims, cover found in an employer's group
 * benefits booklet (group term life, group personal accident ...) is shown
 * as a POSSIBLE benefit, to be confirmed with the employer's HR: never left out, never presented as confirmed personal cover, and
 * with an amount only where the booklet prints one for the person's own
 * plan column. Checked in claims (the interview run to its conclusion) and
 * in plain chat answers, on the independent r7 household (Tan Wei Ming,
 * Kallang Freight booklet, Plan 2) and on the Round 6 household (Lim Wei
 * Jie, Harbourfront booklet, Plan A).
 */
import { NextRequest } from "next/server";
import type { ChatAnswer } from "@/types";

type Send = (question: string, conv: { id?: string; rev?: number }, personChoiceId?: string) => Promise<ChatAnswer>;
function sender(account: string, start: string | null): Send {
  // The chat page follows the person each answer was about (setMemberId).
  let member = start;
  return async (question, conv, personChoiceId) => {
    if (!conv.id) member = start;
    process.env.DEV_ACCOUNT_ID = account;
    const { POST } = await import("@/app/api/chat/route");
    const res = await POST(new NextRequest("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ familyMemberId: member, scope: member ? "member" : "family", question, conversationId: conv.id, conversationRevision: conv.rev, asynchronous: false, timeZone: "Asia/Singapore", ...(personChoiceId ? { personChoiceId } : {}) }) }));
    const data = await res.json();
    if (res.status !== 200) throw new Error("chat " + res.status + ": " + JSON.stringify(data).slice(0, 200));
    const a = data.answer as ChatAnswer; conv.id = a.conversationId ?? conv.id; conv.rev = a.conversationRevision ?? conv.rev;
    if (a.resolvedFamilyMemberId) member = a.resolvedFamilyMemberId;
    return a;
  };
}
/** Runs a claim interview to its end, answering each question from `replies`. */
async function driveClaim(send: Send, opening: string, replies: [RegExp, string][], maxTurns = 10): Promise<ChatAnswer[]> {
  const conv: { id?: string; rev?: number } = {};
  const out: ChatAnswer[] = [];
  let message = opening;
  for (let i = 0; i < maxTurns; i++) {
    const a = await send(message, conv);
    out.push(a);
    const q = a.questions?.[0] ?? (a.factFinding ?? []).flatMap((p) => p.nextQuestions)[0];
    if (!q) break;
    const reply = replies.find(([re]) => re.test(q.text))?.[1] ?? "Not sure";
    message = a.questions?.[0] && (q as { options?: string[] }).options?.includes(reply) ? reply : q.text.replace(/\?\s*$/, "") + ": " + reply;
  }
  return out;
}
const REPLIES: [RegExp, string][] = [[/date|when/i, "2026-09-28"], [/accident/i, "Yes"], [/cause/i, "Road accident"], [/where|country|location/i, "Singapore"],
  [/hospital/i, "No"], [/permanent|work again|recover/i, "Yes"]];
const text = (a: ChatAnswer) => [a.summary, ...a.details, ...(a.claimItems ?? []).flatMap((i) => [i.title, i.reason, ...(i.conditions ?? [])]),
  ...(a.policyStatedLimits ?? []).flatMap((l) => [l.benefitTitle, l.amountText])].join("\n");

function checkGroupClaim(label: string, answers: ChatAnswer[], booklet: RegExp, expect: { amounts: string[]; never: string[] }): string[] {
  const out: string[] = [];
  const last = answers.at(-1);
  if (!last) return [label + ": no answer"];
  const all = text(last);
  const group = (last.claimItems ?? []).filter((i) => booklet.test(i.title));
  if (!group.length) out.push(label + ": the employer's group cover was left out of the claim answer: " + last.summary.slice(0, 200));
  for (const i of group) {
    if (!/\bpossible\b/i.test(i.title + " " + i.reason + " " + (i.conditions ?? []).join(" "))) out.push(label + ": group benefit not labelled possible: " + i.title + " — " + i.reason.slice(0, 120));
    if (i.status !== "potentially_applicable") out.push(label + ": group benefit shown as " + i.status + ", not as possible: " + i.title);
    if (i.amountText) out.push(label + ": group benefit carries a claim amount: " + i.title + " " + i.amountText);
  }
  const everything = all + "\n" + (last.nextSteps ?? []).join("\n") + "\n" + JSON.stringify(last.factFinding ?? []) + "\n" + JSON.stringify(last.claimItems ?? []);
  if (group.length && !/\b(?:HR|human resources)\b/.test(everything)) out.push(label + ": the answer never says to confirm the group cover with the employer's HR: " + last.summary.slice(0, 200));
  // (The claim answer may name the group benefit without its booklet amount -- the booklet is the
  // whole scheme's, not a confirmed figure for this person. When an amount IS shown, it must be
  // this person's plan's, never another column's.)
  void expect.amounts;
  for (const amount of expect.never) if (all.includes(amount)) out.push(label + ": another plan column's " + amount + " is shown");
  if ((last.potentialPayoutTotals ?? []).some((t) => expect.amounts.some((a) => t.amountText.includes(a)))) out.push(label + ": a group amount was added into a payout total");
  return out;
}

export async function groupCoverChecks(args: { built: { households: { id: string; account: string; memberIds: Record<string, string> }[] }; log: (...a: unknown[]) => void; part: "r7" | "r6" }): Promise<string[]> {
  const out: string[] = [];
  if (args.part === "r7") {
    const h1 = args.built.households.find((h) => h.id === "H1-tan");
    if (!h1) return out;
    const send = sender(h1.account, null);
    // Death on the road: GTL (any cause) and GPA (accidental death) for Plan 2.
    const death = await driveClaim(send, "Wei Ming died in a road accident on 2026-09-28", REPLIES);
    out.push(...checkGroupClaim("r7 H1 road-accident death", death, /Kallang Freight/i, { amounts: ["S$200,000", "S$250,000"], never: ["S$80,000", "S$100,000"] }));
    // Disability after an accident: GPA permanent disablement, possible.
    const tpd = await driveClaim(send, "I had a motorcycle accident on 2026-09-20 and permanently lost the use of my left arm", REPLIES);
    out.push(...checkGroupClaim("r7 H1 accidental disability", tpd, /Kallang Freight/i, { amounts: [], never: ["S$80,000", "S$100,000"] }));
    // A plain question about death cover names the group cover the same way.
    const plain = await send("What is my death cover?", {});
    const t = text(plain);
    if (!/Kallang Freight/.test(t)) out.push("r7 H1 plain death-cover answer leaves out the group booklet: " + plain.summary.slice(0, 200));
    else if (!/\bpossible\b|\b(?:HR|human resources)\b|\bemployer\b/i.test(t)) out.push("r7 H1 plain death-cover answer does not say the group cover is possible / to confirm with HR: " + plain.summary.slice(0, 240));
    if (/S\$80,000/.test(t)) out.push("r7 H1 plain death-cover answer shows the Plan 1 column (S$80,000)");
    args.log(`group cover (r7): ${death.length + tpd.length + 1} turns checked`);
  } else {
    const F = await import("../r6/fixture");
    const h = await F.buildHousehold();
    const send = sender(F.ACCOUNT, F.MEILING);
    const death = await driveClaim(send, "Wei Jie died in a road accident on 2026-09-28", REPLIES);
    out.push(...checkGroupClaim("r6 Wei Jie road-accident death", death, /Harbourfront/i, { amounts: ["S$300,000"], never: [] }));
    args.log(`group cover (r6): ${death.length} turns checked`);
    await h.db.close();
  }
  return out;
}
