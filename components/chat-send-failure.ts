/** Why a chat message was not sent, from the server's reply (app/api/chat/route.ts) or from a failed answer's message.
 * A 409 is not always "changed in another tab": a household with nobody in it is refused with 409 and code
 * "no_family_members" (TE, 12 Nov: every new household's first message read "This chat was updated in another tab").
 * That refusal keeps the server's own words and gets a link to add family members; only a real stale-chat refusal
 * reads as a conflict. */
export type SendFailure = "no_family" | "conflict" | "other";

const NO_FAMILY_CODE = "no_family_members";
/** The answer-time refusal for the same case (lib/chat/workflow.ts, lib/simple-chat/hook.ts and the flagged loop hook). */
const NO_FAMILY_TEXT = /^Add a family member first\b/i;
/** Words of the server's stale-chat refusals (lib/chat/store.ts ChatConflict). */
const CONFLICT_TEXT = /chat changed|reopen it|changed while|changed underneath/i;

/** status: the HTTP status, or null for a failure that only has a message (a failed answer job). */
export function sendFailure(status: number | null, text: string, code?: unknown): SendFailure {
  if (code === NO_FAMILY_CODE || NO_FAMILY_TEXT.test(text.trim())) return "no_family";
  if (status === 409 || CONFLICT_TEXT.test(text)) return "conflict";
  return "other";
}

/**
 * After a refused send (the page is behind its own chat), what the page takes from the chat as the server holds it now
 * (GET /api/chat/history/:id): the current revision, the chat's own person and where older messages start. A chat page can
 * be behind its own chat with one tab open (an answer that finished after the page stopped waiting, or after a failed
 * send, moves the chat on); without this every later send was refused the same way until a manual reload (Live tester,
 * 25 Nov). The message is NOT sent again for the person: the refused send stored nothing but did count as a question on
 * a plan with limits, a late answer may have moved the chat to another person or asked a question the household has not
 * seen, so the person reads the chat as it now stands and sends again themselves (Critic #594).
 */
export type CaughtUp = { revision: number; memberId: string; cursor: string | null };
export function catchUpState(chat: { conversation?: { revision?: unknown; family_member_id?: unknown } | null; nextCursor?: unknown } | null | undefined): CaughtUp | null {
  const revision = Number(chat?.conversation?.revision);
  if (!chat?.conversation || !Number.isFinite(revision) || revision < 0) return null;
  const member = chat.conversation.family_member_id;
  return { revision, memberId: typeof member === "string" ? member : "", cursor: typeof chat.nextCursor === "string" ? chat.nextCursor : null };
}

/**
 * True when the chat as the server holds it already carries this very message as the household's latest: an earlier send of
 * it was stored, but its answer never reached this page. The server saves a message and its answer together, so the chat
 * ends with the answer; the household's own latest message is the last "user" one. Sending it again would ask twice, so the
 * page does not offer to (Test engineer F1, #594). Compared as typed (outer spaces ignored): a different wording, case or
 * mark is a different message, and an equal message from earlier turns does not count.
 */
export function alreadySentLast(history: ReadonlyArray<{ role: string; content: unknown }>, text: string): boolean {
  const lastSent = [...history].reverse().find((m) => m.role === "user");
  return !!lastSent && String(lastSent.content).trim() === text.trim();
}
