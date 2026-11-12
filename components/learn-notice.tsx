import { LEARN_NOTICE } from "@/lib/learn/content";

/** The general-education label every library page carries, so no page reads as advice about the household's own cover. */
export function LearnNotice() {
  return <p className="learn-notice" role="note" data-testid="learn-notice">{LEARN_NOTICE}</p>;
}
