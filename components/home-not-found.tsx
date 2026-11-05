import Link from "next/link";

/** Home's kinds of cover not found for the person, in one line under the tiles of what was found, instead of a tile each
 * repeating the same sentence: what a person has is what Home is for, and up to a dozen "Not found" tiles buried it.
 * Each kind still links to its own Coverage answer. `note`: the line said when some of the person's documents were not
 * fully read (lib/policies/not-fully-read.ts), so "not found" never reads as "not covered". Changes no status. */
export function HomeNotFound({categories,memberId,note}:{categories:string[];memberId:string;note?:string|null}){
  if(!categories.length)return null;
  return <div className="home-not-found" data-testid="home-not-found">
    <p><strong>{note?"Not found in what DearPolicy could read":"Not found in the personal policies you uploaded"}:</strong>{" "}
      {categories.map((c,i)=><span key={c}>{i?", ":""}<Link className="text-link" href={`/coverage?member=${encodeURIComponent(memberId)}&category=${encodeURIComponent(c)}`}>{c}</Link></span>)}.</p>
    <small>{note??"A policy you have not uploaded may still include them."}</small>
  </div>;
}
