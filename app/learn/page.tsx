import Link from "next/link";
import { GUIDES, LEARN_GROUPS, TERMS_PAGE, learnSearchIndex } from "@/lib/learn/content";
import type { LearnIcon } from "@/lib/learn/content";
import { LearnNotice } from "@/components/learn-notice";
import { Pictogram } from "@/components/learn/pictogram";
import { LearnSearch } from "@/components/learn/search";

/** The knowledge library's index: a search box, then the guides on their shelves. Static: no household data, no service calls. */
export const metadata = { title: "Learn · DearPolicy" };

export default function LearnPage() {
  const pages: Array<{ slug: string; title: string; summary: string; icon: LearnIcon; group: string }> = [
    ...GUIDES.map(({ slug, title, summary, icon, group }) => ({ slug, title, summary, icon, group })),
    { ...TERMS_PAGE, icon: "read" },
  ];
  return (
    <div className="page learn-page" data-testid="learn-index">
      <header className="page-header compact"><div>
        <h1>Learn the basics</h1>
        <p className="lead">Short guides to how insurance works, so your documents and DearPolicy&rsquo;s answers make more sense.</p>
      </div></header>
      <LearnNotice />
      <LearnSearch entries={learnSearchIndex()} />
      {LEARN_GROUPS.map((group) => {
        const shelf = pages.filter((page) => page.group === group.id);
        if (!shelf.length) return null;
        return (
          <section className="learn-shelf" key={group.id} aria-labelledby={`shelf-${group.id}`} data-testid={`learn-shelf-${group.id}`}>
            <h2 id={`shelf-${group.id}`}>{group.title}</h2>
            <p className="learn-shelf-blurb">{group.blurb}</p>
            <ul className="learn-list">
              {shelf.map((page) => (
                <li key={page.slug}>
                  <Link className="learn-card" href={`/learn/${page.slug}`}>
                    <Pictogram icon={page.icon} size={44} />
                    <div><strong>{page.title}</strong><span>{page.summary}</span></div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <p className="note">Have a question about your own cover? <Link className="text-link" href="/chat">Ask DearPolicy</Link></p>
    </div>
  );
}
