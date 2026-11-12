import Link from "next/link";
import { notFound } from "next/navigation";
import { GUIDES, TERMS_PAGE, guideBySlug, termsSorted } from "@/lib/learn/content";
import { LearnNotice } from "@/components/learn-notice";

/** One knowledge-library page: a guide, or the A to Z of terms. Static text: no household data, no service calls. */
export function generateStaticParams() {
  return [...GUIDES.map((guide) => ({ slug: guide.slug })), { slug: TERMS_PAGE.slug }];
}
export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const title = slug === TERMS_PAGE.slug ? TERMS_PAGE.title : guideBySlug(slug)?.title;
  return { title: title ? `${title} · DearPolicy` : "Learn · DearPolicy" };
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
  const index = GUIDES.indexOf(guide);
  const next = GUIDES[index + 1];
  return (
    <div className="page learn-page" data-testid="learn-guide">
      <Back />
      <header className="page-header compact"><div><h1>{guide.title}</h1><p className="lead">{guide.summary}</p></div></header>
      <LearnNotice />
      <article className="learn-article">
        {guide.sections.map((section) => (
          <section className="section" key={section.heading}>
            <h2>{section.heading}</h2>
            {section.blocks.map((block, i) => block.kind === "p" ? <p key={i}>{block.text}</p>
              : block.kind === "example" ? <p key={i} className="learn-example" data-testid="learn-example">{block.text}</p>
              : <ul key={i}>{block.items.map((item, j) => <li key={j}>{item}</li>)}</ul>)}
          </section>
        ))}
      </article>
      <p className="note">
        {next ? <>Next: <Link className="text-link" href={`/learn/${next.slug}`}>{next.title}</Link> · </> : null}
        <Link className="text-link" href={`/learn/${TERMS_PAGE.slug}`}>{TERMS_PAGE.title}</Link>
      </p>
    </div>
  );
}
