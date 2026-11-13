import Link from "next/link";
import { notFound } from "next/navigation";
import { GUIDES, LEARN_GROUPS, TERMS_PAGE, guideBySlug, learnDate, termsSorted } from "@/lib/learn/content";
import { LearnNotice } from "@/components/learn-notice";
import { LearnBlockView } from "@/components/learn/blocks";

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
      <div className="page learn-page" data-testid="learn-terms">
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
  return (
    <div className="page learn-page" data-testid="learn-guide">
      <Back />
      <header className="page-header compact"><div>
        {group ? <p className="learn-shelf-tag">{group.title}</p> : null}
        <h1>{guide.title}</h1><p className="lead">{guide.summary}</p>
      </div></header>
      <LearnNotice />
      {guide.region && guide.checkedOn ? (
        <p className="learn-region" role="note" data-testid="learn-region">
          <strong>{guide.region.name} only.</strong> Facts are from official sources, checked on {learnDate(guide.checkedOn)}. Scheme rules and amounts change, so check the source for the latest before you rely on a figure.
        </p>
      ) : null}
      <article className="learn-article">
        {guide.sections.map((section) => (
          <section className="section" key={section.heading}>
            <h2>{section.heading}</h2>
            {section.blocks.map((block, i) => <LearnBlockView key={i} block={block} sources={guide.sources} />)}
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
      </article>
      <p className="note">
        {next ? <>Next: <Link className="text-link" href={`/learn/${next.slug}`}>{next.title}</Link> · </> : null}
        <Link className="text-link" href={`/learn/${TERMS_PAGE.slug}`}>{TERMS_PAGE.title}</Link>
      </p>
    </div>
  );
}
