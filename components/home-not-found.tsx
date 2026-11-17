import Link from "next/link";
import { Icon, coverIcon } from "@/components/icons";

/** The main kinds of cover a household usually considers. Home lists those not found for the person as gaps (DC 17 Nov:
 * "show the user what insurance gaps they do not have, so they can consider getting them"). Add-ons of these (Hospital
 * Cash, Early Critical Illness) and covers only some households need (home, motor, savings) are never called gaps. */
export const GAP_CATEGORIES = ["Hospitalisation", "Death", "Critical Illness", "Total Permanent Disability", "Personal Accident", "Disability Income", "Travel"] as const;

/** The gaps for a person: each main kind with no card, in GAP_CATEGORIES order. A kind found only in wording or a booklet
 * that no plan of the person's is shown to include ("on file") is a gap too: it is not on their own policy. */
export function homeGaps(coverages: { category: string; status: string }[]): string[] {
  const covered = new Set(coverages.filter((c) => c.status === "covered").map((c) => c.category));
  return GAP_CATEGORIES.filter((c) => !covered.has(c));
}

/** Home's gaps, under the cards: "No cover of these kinds was found", never "not covered", since a policy not uploaded
 * may hold it (missing information is not an exclusion). `note`: said when some of the person's documents were not fully
 * read (lib/policies/not-fully-read.ts). Each gap links to its own Coverage answer, which names anything on file for it.
 * No product or insurer is suggested; the Learn guide explains what each kind is for. */
export function HomeNotFound({categories,memberId,name,note}:{categories:string[];memberId:string;name?:string|null;note?:string|null}){
  if(!categories.length)return null;
  const whose=name?`${name}’s documents`:"your documents";
  return <section className="home-gaps" data-testid="home-gaps" aria-labelledby="home-gaps-title">
    <h2 id="home-gaps-title">Gaps to consider</h2>
    <p>{note?`No cover of these kinds was found in what DearPolicy could read of ${whose}.`:`No cover of these kinds was found in ${whose}.`}</p>
    <ul className="home-gap-list">{categories.map(c=><li key={c}><Link className="home-gap" href={`/coverage?member=${encodeURIComponent(memberId)}&category=${encodeURIComponent(c)}`}><Icon name={coverIcon(c)}/>{c}</Link></li>)}</ul>
    {note&&<small>{note}</small>}
    <p className="home-gaps-foot"><Link className="text-link" href="/learn/types-of-cover">What each type of cover is for</Link><span aria-hidden="true"> · </span><Link className="text-link" href="/policies">Have one of these? Upload it</Link></p>
  </section>;
}
