/**
 * Whether the privacy notice (app/privacy/page.tsx) is published. While its wording still has "To confirm" passages,
 * it stays off the live site: the page answers "not found" and the sign-up and sign-in pages do not link to it.
 * DC flips PRIVACY_NOTICE_FINAL to true once every passage is settled (scripts/privacy/notice-test.ts refuses a final
 * notice with any passage still marked). DEARPOLICY_PRIVACY_PREVIEW=true shows the draft page for review (for example
 * on a local run); it never adds the links.
 *
 * Do not flip it before the deletion work it describes is live: "Removing your information" relies on #267 (deleting a
 * document removes its file and everything read from it) and on the follow-up that removes what stored chat answers
 * and coverage summaries took from a deleted document. Until both are merged, those passages are not true.
 */
export const PRIVACY_NOTICE_FINAL = false;

export function privacyNoticeVisible(env: Record<string, string | undefined> = process.env): boolean {
  return PRIVACY_NOTICE_FINAL || env.DEARPOLICY_PRIVACY_PREVIEW?.trim().toLowerCase() === "true";
}
