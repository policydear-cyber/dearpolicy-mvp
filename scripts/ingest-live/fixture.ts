/**
 * The live ingestion test's inputs, read tolerantly (agent T authors them; field names may vary slightly).
 *   <fixture>/HOUSEHOLD.json   { members: [{ full_name | displayName | name, relationship, dob | dateOfBirth?, preferred_name? }] }
 *   <fixture>/QUESTIONS.json   { upload_order?, conversation: [{ id, text, answers?: [{ when: <regex>, reply }] }],
 *                                reopen?: [...], delete_source?: <file>, after_delete?: [...] }   (or a bare array of questions)
 *   <fixture>/source/*.pdf     the documents, uploaded through the real upload page
 * EXPECTED.json is NOT here: it is sealed away from the app and copied into the run folder only after the conversations.
 */
import fs from "node:fs";
import path from "node:path";

export type Member = { displayName: string; preferredName: string | null; relationship: string; dateOfBirth: string | null; ref: string | null };
export type Reply = { when: RegExp; reply: string };
export type Question = { id: string; text: string; answers: Reply[]; conversation?: string };
/** One chat (a New chat each): its turns in order; a later turn answers what the chat asked before it. */
export type Conversation = { id: string; turns: Question[] };
export type Questions = { placeholder: boolean; uploadOrder: string[] | null; conversations: Conversation[]; conversation: Question[]; reopen: Question[]; deleteSource: string | null; afterDelete: Question[]; afterDeleteSameConversation: boolean };

const RELATIONSHIPS = ["self", "spouse", "parent", "child", "sibling", "grandparent", "dependant", "other"];
/** The app's relationship for free text such as "Self (policy owner / speaker)", "Spouse of Simon", "Son". */
export function appRelationship(raw: unknown): string {
  const t = String(raw ?? "").toLowerCase();
  if (RELATIONSHIPS.includes(t)) return t;
  if (/\bself\b|policy ?owner|speaker|\bme\b/.test(t)) return "self";
  if (/spouse|wife|husband|partner/.test(t)) return "spouse";
  if (/\bson\b|daughter|child|kid/.test(t)) return "child";
  if (/mother|father|parent|mum|dad/.test(t)) return "parent";
  if (/brother|sister|sibling/.test(t)) return "sibling";
  if (/grand(mother|father|parent)/.test(t)) return "grandparent";
  if (/dependant|dependent/.test(t)) return "dependant";
  return "other";
}
export function readHousehold(fixture: string): Member[] {
  const j = JSON.parse(fs.readFileSync(path.join(fixture, "HOUSEHOLD.json"), "utf8"));
  const list = Array.isArray(j) ? j : j.members ?? j.people ?? [];
  return (list as Record<string, unknown>[]).map((m) => ({
    displayName: String(m.full_name ?? m.displayName ?? m.display_name ?? m.name ?? "").trim(),
    preferredName: (m.preferred_name ?? m.preferredName ?? null) as string | null,
    relationship: appRelationship(m.relationship),
    dateOfBirth: typeof (m.dob ?? m.dateOfBirth ?? m.date_of_birth) === "string" ? String(m.dob ?? m.dateOfBirth ?? m.date_of_birth).slice(0, 10) : null,
    ref: (m.id ?? null) as string | null,
  })).filter((m) => m.displayName);
}
function question(q: Record<string, unknown>, i: number, prefix: string): Question {
  const answers = (Array.isArray(q.answers) ? q.answers : Array.isArray(q.follow_up_answers) ? q.follow_up_answers : []) as Record<string, unknown>[];
  return { id: String(q.id ?? (typeof q.q === "string" && /^[A-Z]+\d+[A-Z]?$/.test(q.q) ? q.q : `${prefix}${i + 1}`)), text: String(q.text ?? q.question ?? q.user ?? (typeof q.q === "string" && !/^[A-Z]+\d+[A-Z]?$/.test(q.q) ? q.q : "")).trim(),
    ...(typeof q.conversation === "string" ? { conversation: q.conversation } : {}),
    answers: answers.map((a) => ({ when: new RegExp(String(a.when ?? a.if_asked ?? "."), "i"), reply: String(a.reply ?? a.answer ?? "") })).filter((a) => a.reply) };
}
export function readQuestions(fixture: string, file = "QUESTIONS.json"): Questions {
  const candidates = [path.join(fixture, file), path.join(fixture, "expected", file)];
  const p = candidates.find((c) => fs.existsSync(c));
  if (!p) throw new Error(`no ${file} in ${fixture}`);
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  const conv = (Array.isArray(j) ? j : j.conversation ?? j.questions ?? []) as Record<string, unknown>[];
  const list = (x: unknown, prefix: string) => (Array.isArray(x) ? x : x ? [x] : []).map((q, i) => question(typeof q === "string" ? { text: q } : q as Record<string, unknown>, i, prefix));
  // Agent T's shape: { conversations: [{ id, turns: [{ q: "Q3", user: "..." }] }] }; the older flat list is one chat.
  const conversations: Conversation[] = Array.isArray(j.conversations)
    ? (j.conversations as Record<string, unknown>[]).map((c, ci) => ({ id: String(c.id ?? `C${ci + 1}`), turns: list(c.turns, `C${ci + 1}T`).filter((q) => q.text) }))
    : [{ id: "C1", turns: list(conv, "Q").filter((q) => q.text) }];
  return {
    placeholder: !!j.placeholder, uploadOrder: Array.isArray(j.upload_order) ? j.upload_order : null,
    conversations, conversation: conversations.flatMap((c) => c.turns), reopen: list(j.reopen ?? j.follow_up, "R").filter((q) => q.text),
    deleteSource: typeof (j.delete_source ?? j.deleteSource) === "string" ? (j.delete_source ?? j.deleteSource) : null,
    afterDelete: list(j.after_delete ?? j.afterDelete, "D").filter((q) => q.text), afterDeleteSameConversation: !!j.after_delete_same_conversation,
  };
}
export function sourceFiles(fixture: string, order: string[] | null): string[] {
  const all = fs.readdirSync(path.join(fixture, "source")).filter((f) => /\.(pdf|png|jpe?g|docx)$/i.test(f)).sort();
  if (!order) return all;
  return [...order.filter((f) => all.includes(f)), ...all.filter((f) => !order.includes(f))];
}
