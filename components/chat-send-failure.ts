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

/** The chat as the server holds it now (GET /api/chat/history/:id). */
export type FreshChat = { revision: number; show: () => void };

/**
 * Sends a chat message, and when the server refuses it as out of date (409, a real stale-chat refusal) asks for the chat
 * as it now stands and sends once more with that revision. The refusal stored nothing, so one more send cannot ask
 * twice. A chat page can be behind its own chat with one tab open (an answer that finished after the page stopped
 * waiting, or after a failed send, moves the chat on); telling the person to reload then looped: every later send
 * was refused the same way (Live tester, 25 Nov). Never retried for an empty household, another refusal, or when the
 * fresh chat cannot be read, and never more than once.
 */
export async function sendWithResync<R extends { status: number; data: { error?: unknown; code?: unknown } }>(
  send: (revision: number | null) => Promise<R>,
  revision: number | null,
  loadFresh: () => Promise<FreshChat | null>,
): Promise<R & { resynced: boolean }> {
  const first = await send(revision);
  const said = typeof first.data?.error === "string" ? first.data.error : "";
  if (revision === null || first.status !== 409 || sendFailure(409, said, first.data?.code) !== "conflict") return { ...first, resynced: false };
  const fresh = await loadFresh().catch(() => null);
  if (!fresh || !Number.isFinite(fresh.revision) || fresh.revision === revision) return { ...first, resynced: false };
  fresh.show();
  return { ...(await send(fresh.revision)), resynced: true };
}
