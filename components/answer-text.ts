/**
 * How DearPolicy's own answer text is shown in the chat (Round 8).
 *
 * The answer pipeline writes plain sentences; this is the last step before
 * they reach the screen: a leaked provider error becomes one plain sentence
 * (customerAnswerText) and any YYYY-MM-DD date becomes "28 Sep 2026", the
 * way every other date in the app is written. Composition codes
 * ("per_policy_year", "co_insurance_10_percent") are shown as words.
 */
import { customerAnswerText } from "@/components/customer-text";
import { readableDates } from "@/components/format-date";

export function answerText(text: string): string {
  return readableDates(customerAnswerText(text));
}

export function codeWords(code: string): string {
  const text = code.replaceAll("_", " ").replace(/\s+/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
