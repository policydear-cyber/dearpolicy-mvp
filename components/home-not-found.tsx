import Link from "next/link";
import { Icon, coverIcon } from "@/components/icons";

/** The main kinds of cover a household usually considers. Home lists those not found for the person as gaps (DC 17 Nov:
 * "show the user what insurance gaps they do not have, so they can consider getting them"). Add-ons of these (Hospital
 * Cash, Early Critical Illness) and covers only some households need (home, motor, savings) are never called gaps. */
export const GAP_CATEGORIES = ["Hospitalisation", "Death", "Critical Illness", "Total Permanent Disability", "Personal Accident", "Disability Income", "Travel"] as const;

/** A relationship that names a child or other dependant (Family's free-text label), who earns no income to protect. */
const DEPENDANT = /\b(child|son|daughter|kid|baby|infant|dependant|dependent|grand(?:son|daughter|child))\b/i;

/** The gaps for a person, in GAP_CATEGORIES order: `missing`, main kinds with nothing found; `onFile`, kinds found only in
 * wording or a booklet that no plan of the person's is shown to include (Critic #519 M1: these WERE found in the
 * documents, so they are never said to be missing, only not on the person's own policy). Disability Income is never a gap
 * for a child or other dependant. */
export function homeGaps(coverages: { category: string; status: string }[], relationship?: string | null): { missing: string[]; onFile: string[] } {
  const status = new Map(coverages.map((c) => [c.category, c.status]));
  const kinds = GAP_CATEGORIES.filter((c) => !(c === "Disability Income" && DEPENDANT.test(relationship ?? "")));
  const open = kinds.filter((c) => status.get(c) !== "covered");
  return { missing: open.filter((c) => status.get(c) !== "on_file"), onFile: open.filter((c) => status.get(c) === "on_file") };
}

/** Home's gaps, under the cards: "No cover of these kinds was found", never "not covered", since a policy not uploaded
 * may hold it (missing information is not an exclusion). `note`: said when some of the person's documents were not fully
 * read (lib/policies/not-fully-read.ts). Each gap links to its own Coverage answer, which names anything on file for it.
 * No product or insurer is suggested; the Learn guide explains what each kind is for. */
export function HomeNotFound({missing,onFile=[],memberId,name,note}:{missing:string[];onFile?:string[];memberId:string;name?:string|null;note?:string|null}){
  if(!missing.length&&!onFile.length)return null;
  const whose=name?`${name}\u2019s documents`:"your documents";
  const own=name?`${name}\u2019s own policy`:"your own policy";
  const chips=(list:string[])=><ul className="home-gap-list">{list.map(c=><li key={c}><Link className="home-gap" href={`/coverage?member=${encodeURIComponent(memberId)}&category=${encodeURIComponent(c)}`}><Icon name={coverIcon(c)}/>{c}</Link></li>)}</ul>;
  return <section className="home-gaps" data-testid="home-gaps" aria-labelledby="home-gaps-title">
    <h2 id="home-gaps-title">Gaps to consider</h2>
    {!!missing.length&&<><p>{note?`No cover of these kinds was found in what DearPolicy could read of ${whose}.`:`No cover of these kinds was found in ${whose}.`}</p>{chips(missing)}</>}
    {!!onFile.length&&<><p>{`Found only in a booklet or wording, not on ${own}:`}</p>{chips(onFile)}</>}
    {note&&<small>{note}</small>}
    <p className="home-gaps-foot"><Link className="text-link" href="/learn/types-of-cover">What each type of cover is for</Link><span aria-hidden="true"> · </span><Link className="text-link" href="/policies">Have one of these? Upload it</Link></p>
  </section>;
}
