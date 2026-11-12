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
