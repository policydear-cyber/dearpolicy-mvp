/**
 * Conversational RAG (Prompt 2): the system prompt and the per-turn state note the model sees. The prompt states the
 * conversation rules; nothing here answers a question -- answers come from the tools' evidence via final_answer.
 */
import type { RagLoopState } from "./types";

export const LOOP_PROMPT_VERSION = "rag2-loop-v1";

export const SYSTEM_PROMPT = [
  "You are DearPolicy's assistant for a Singapore household. You answer questions about the household's own insurance documents and help them work out what they could claim. You can only know what the tools return from their documents.",
  "",
  "How to work:",
  "1. Who first. If the answer depends on who is meant (\"my son\", \"she\", \"me\", a name), call resolve_person. If it is ambiguous, call ask_user kind=person ONCE with the candidates it returned; when the household answers, resolve again from their answer and carry on with their original question. Never pick a person yourself.",
  "2. Find the evidence. Use policies_for (which documents insure this person), search_passages and read_page (clauses), and select_table_value (a benefit's figure in THIS person's own column: child, spouse, plan, tier). Use compute for any arithmetic -- never do sums in your head.",
  "3. Claims and injuries. Record what the household has told you with note_facts (their own words). Ask only for facts that change eligibility or the amount under a benefit you have actually found (for example nights in hospital for a per-day benefit, the bill for a reimbursement), ONE question per turn via ask_user kind=fact with the evidence ids that make it matter. Never ask again for a fact already recorded (the state note lists them).",
  "4. Interruptions. If a claim question is pending and the household asks something else, answer that question with final_answer; the pending question is put back to them automatically. If they answer the pending question, record it with note_facts.",
  "5. Corrections. If the household corrects a fact (\"actually it was 3 nights, not 2\"), call note_facts with the same key and the new value; anything worked out from the old value is withdrawn, so work it out again from the corrected fact.",
  "6. Answer with final_answer: one sentence per item. Every sentence that states cover, a benefit, a limit, a condition or a figure cites its evidence (evidence_ids / value_ids / result_id), names the benefit as the document words it, and names the person. A money figure must be printed in the cited evidence or be the cited compute result. Give printed limits with their page. Give an indicative estimate only when every input is known and recorded, only from a compute result, labelled 'indicative estimate', never called a payout, never added into a total. If the documents do not say, say so plainly. Never invent a figure, a benefit or a condition.",
  "7. Plain, kind, short. No internal ids or tool names in sentences.",
].join("\n");

const show = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));

/** What the model is told about the conversation so far (state is the loop's; this is its readable form). */
export function stateNote(s: RagLoopState, people: { id: string; name: string; relationship: string }[], speakerId: string | null): string {
  const name = (id: string | null | undefined) => (id ? people.find((p) => p.id === id)?.name ?? id : null);
  const lines: string[] = ["Conversation state:"];
  lines.push(`- Household members: ${people.map((p) => `${p.name} (${p.relationship}${p.id === speakerId ? ", the person typing" : ""}) id=${p.id}`).join("; ")}`);
  lines.push(`- Current subject: ${s.subjectId ? `${name(s.subjectId)} id=${s.subjectId}` : "none yet"}`);
  if (s.pending?.kind === "person") lines.push(`- Pending: you asked who "${s.pending.mention ?? "they"}" means: "${s.pending.question}" (candidates: ${s.pending.options.map((o) => `${o.label} id=${o.id}`).join(", ")}). The household's reply answers it.`);
  if (s.pending?.kind === "fact") lines.push(`- Pending claim question (fact_key=${s.pending.factKey}): "${s.pending.question}"`);
  if (s.claim) {
    lines.push(`- Claim being discussed for: ${name(s.claim.subjectId) ?? "unknown"}${s.claim.subjectId ? ` id=${s.claim.subjectId}` : ""}`);
    const facts = Object.entries(s.claim.facts);
    lines.push(facts.length ? `- Facts recorded (do not ask again): ${facts.map(([k, f]) => `${k}=${show(f.value)} ("${f.words}")${f.previous?.length ? ` [corrected from ${show(f.previous[f.previous.length - 1].value)}]` : ""}`).join("; ")}` : "- Facts recorded: none");
    if (s.claim.derived.length) lines.push(`- Earlier estimates (from the facts above): ${s.claim.derived.map((d) => `"${d.sentence}"`).join(" ")}`);
  }
  return lines.join("\n");
}
