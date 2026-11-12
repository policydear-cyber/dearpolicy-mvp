import Link from "next/link";
import { learnTermsIn } from "@/lib/learn/match";
import { termHref } from "@/lib/learn/content";

/**
 * A quiet "Learn the basics" row under an answer, linking the glossary terms the answer itself uses. It only offers
 * general explanations: the answer text is never changed, and nothing is shown when the answer uses none of the terms.
 */
export function LearnLinks({ texts }: { texts: Array<string | null | undefined> }) {
  const terms = learnTermsIn(texts);
  if (!terms.length) return null;
  return (
    <div className="learn-links" data-testid="learn-links">
      <span>Learn the basics:</span>
      {terms.map((term) => <Link key={term.id} href={termHref(term)} data-testid="learn-link">{term.term}</Link>)}
    </div>
  );
}
