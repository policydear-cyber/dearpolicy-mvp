import Link from "next/link";
import { notFound } from "next/navigation";
import { GUIDES, LEARN_GROUPS, TERMS_PAGE, guideBySlug, learnCover, learnDate, readMinutes, termsSorted } from "@/lib/learn/content";
import { LearnNotice } from "@/components/learn-notice";
import { LearnBlockView } from "@/components/learn/blocks";
import { Pictogram } from "@/components/learn/pictogram";

/** One knowledge-library page: a guide, or the A to Z of terms. Static text: no household data, no service calls. */
export function generateStaticParams() {
  return [...GUIDES.map((guide) => ({ slug: guide.slug })), { slug: TERMS_PAGE.slug }];
}
export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = slug === TERMS_PAGE.slug ? TERMS_PAGE : guideBySlug(slug);
  if (!page) return { title: "Learn · DearPolicy" };
  const title = `${page.title} · DearPolicy`;
  // The page's own summary is its search-result description; the canonical address is the guide's own.
  return {
    title,
    description: page.summary,
    alternates: { canonical: `/learn/${page.slug}` },
    openGraph: { title, description: page.summary, url: `/learn/${page.slug}`, siteName: "DearPolicy", type: "article" },
  };
}

function Back() {
  return <Link className="text-link" href="/learn">← All guides</Link>;
}

export default async function LearnGuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (slug === TERMS_PAGE.slug) {
    const terms = termsSorted();
    return (
      <div className="page learn-page learn-guide" data-testid="learn-terms">
        <Back />
        <header className="page-header compact"><div><h1>{TERMS_PAGE.title}</h1><p className="lead">{TERMS_PAGE.summary}</p></div></header>
        <LearnNotice />
        <dl className="learn-terms">
          {terms.map((term) => (
            <div className="learn-term" id={term.id} key={term.id}>
              <dt>{term.term}</dt>
              {term.alsoCalled?.length ? <dd className="learn-also">Also called: {term.alsoCalled.join(", ")}</dd> : null}
              <dd>{term.definition}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }
  const guide = guideBySlug(slug);
  if (!guide) notFound();
  // "Next" stays on the same shelf, so a Singapore article leads to the next Singapore article.
  const shelf = GUIDES.filter((g) => g.group === guide.group);
  const next = shelf[shelf.indexOf(guide) + 1];
  const group = LEARN_GROUPS.find((g) => g.id === guide.group);
  const headingId = (i: number) => `part-${i + 1}`;
  return (
    <div className="page learn-page learn-guide" data-testid="learn-guide">
      <Back />
      <div className="learn-layout">
        <article className="learn-paper" data-cover={learnCover(guide.icon)}>
          <header className="learn-hero">
            <div className="lh-text">
              {group ? <p className="learn-shelf-tag">{group.title}</p> : null}
              <h1>{guide.title}</h1>
              <p className="lead">{guide.summary}</p>
              <p className="lh-meta">{readMinutes(guide)} min read{guide.region ? ` · ${guide.region.name}` : ""}</p>
            </div>
            <div className="lh-picture"><Pictogram icon={guide.icon} size={112} /></div>
          </header>
          <div className="learn-article">
            <LearnNotice />
            {guide.region && guide.checkedOn ? (
              <p className="learn-region" role="note" data-testid="learn-region">
                <strong>{guide.region.name} only.</strong> Facts are from official sources, checked on {learnDate(guide.checkedOn)}. Scheme rules and amounts change, so check the source for the latest before you rely on a figure.
              </p>
            ) : null}
            {guide.sections.map((section, i) => (
              <section className="section" key={section.heading} aria-labelledby={headingId(i)}>
                <h2 id={headingId(i)}>{section.heading}</h2>
                {section.blocks.map((block, j) => <LearnBlockView key={j} block={block} sources={guide.sources} />)}
              </section>
            ))}
            {guide.sources?.length ? (
              <section className="section learn-sources" data-testid="learn-sources">
                <h2>Sources</h2>
                <ol>
                  {guide.sources.map((source, i) => (
                    <li key={source.url} id={`source-${i + 1}`}>
                      <a className="text-link" href={source.url} target="_blank" rel="noopener noreferrer">{source.label}</a>
                      {source.published ? <span> ({source.published})</span> : null}
                    </li>
                  ))}
                </ol>
                {guide.checkedOn ? <p className="note">Checked on {learnDate(guide.checkedOn)}.</p> : null}
              </section>
            ) : null}
          </div>
        </article>
        <aside className="learn-rail" aria-label="On this page">
          <p className="lr-title">On this page</p>
          <ol>
            {guide.sections.map((section, i) => <li key={section.heading}><a href={`#${headingId(i)}`}>{section.heading}</a></li>)}
            {guide.sources?.length ? <li><a href="#source-1">Sources</a></li> : null}
          </ol>
        </aside>
      </div>
      <nav className="learn-next" aria-label="Keep reading">
        {next ? (
          <Link className="learn-sheet" data-cover={learnCover(next.icon)} href={`/learn/${next.slug}`}>
            <span className="lsh-head"><Pictogram icon={next.icon} size={40} /></span>
            <span className="lsh-body"><span className="lsh-kicker">Next on this shelf</span><strong>{next.title}</strong><span className="lsh-sum">{next.summary}</span></span>
          </Link>
        ) : null}
        <p className="note"><Link className="text-link" href={`/learn/${TERMS_PAGE.slug}`}>{TERMS_PAGE.title}</Link></p>
      </nav>
    </div>
  );
}
