import Link from "next/link";
import { GUIDES, LEARN_GROUPS, TERMS_PAGE, learnCover, learnSearchIndex, readMinutes, sourceNames } from "@/lib/learn/content";
import type { LearnCover, LearnIcon } from "@/lib/learn/content";
import { LearnNotice } from "@/components/learn-notice";
import { Pictogram } from "@/components/learn/pictogram";
import { LearnSearch } from "@/components/learn/search";

/** The knowledge library's index: a search box, shelf links, then each shelf of guide sheets. Static: no household data, no service calls. */
export const metadata = {
  title: "Learn the basics of insurance · DearPolicy",
  description: "Short, plain-English guides to how insurance works: deductibles, co-insurance, riders, claims, and Singapore schemes such as MediShield Life. Facts cite official sources only.",
  alternates: { canonical: "/learn" },
  openGraph: { title: "Learn the basics of insurance · DearPolicy", description: "Short, plain-English guides to how insurance works, with Singapore schemes explained from official sources.", url: "/learn", siteName: "DearPolicy", type: "website" },
};

type Entry = { slug: string; title: string; summary: string; icon: LearnIcon; group: string; cover: LearnCover; meta: string; minutes?: number };

export default function LearnPage() {
  const pages: Entry[] = [
    ...GUIDES.map((g) => ({
      slug: g.slug, title: g.title, summary: g.summary, icon: g.icon, group: g.group, cover: learnCover(g.icon),
      meta: g.region ? `From ${sourceNames(g).join(" and ")}` : "", minutes: readMinutes(g),
    })),
    { ...TERMS_PAGE, icon: "read", cover: "other", meta: "Glossary" },
  ];
  const shelves = LEARN_GROUPS.map((group) => ({ group, shelf: pages.filter((page) => page.group === group.id) })).filter((s) => s.shelf.length);
  return (
    <div className="page learn-page learn-index" data-testid="learn-index">
      <header className="learn-index-head">
        <h1>Learn</h1>
        <p className="lead">Short guides to how insurance works, with pictures, so your documents and DearPolicy&rsquo;s answers make more sense.</p>
      </header>
      <LearnSearch entries={learnSearchIndex()} />
      <nav className="learn-shelf-nav" aria-label="Shelves">
        {shelves.map(({ group, shelf }) => (
          <a key={group.id} href={`#shelf-${group.id}`}>{group.title} <span>{shelf.length}</span></a>
        ))}
      </nav>
      {shelves.map(({ group, shelf }) => (
        <section className="learn-shelf" key={group.id} aria-labelledby={`shelf-${group.id}`} data-testid={`learn-shelf-${group.id}`}>
          <h2 id={`shelf-${group.id}`}>{group.title}</h2>
          <p className="learn-shelf-blurb">{group.blurb}</p>
          <ul className="learn-list">
            {shelf.map((page) => (
              <li key={page.slug}>
                <Link className="learn-sheet" data-cover={page.cover} href={`/learn/${page.slug}`}>
                  <span className="lsh-head"><Pictogram icon={page.icon} size={40} /></span>
                  <span className="lsh-body">
                    <strong>{page.title}</strong>
                    <span className="lsh-sum">{page.summary}</span>
                    <span className="lsh-foot">{page.meta ? <span>{page.meta}</span> : null}{page.minutes ? <span>{page.minutes} min read</span> : null}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <LearnNotice />
      <p className="note">Have a question about your own cover? <Link className="text-link" href="/chat">Ask DearPolicy</Link></p>
    </div>
  );
}
