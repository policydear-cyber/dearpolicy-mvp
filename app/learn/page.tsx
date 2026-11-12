import Link from "next/link";
import { GUIDES, TERMS_PAGE } from "@/lib/learn/content";
import { LearnNotice } from "@/components/learn-notice";

/** The knowledge library's index. Static text: it reads no household data and calls no service. */
export const metadata = { title: "Learn · DearPolicy" };

export default function LearnPage() {
  const pages = [...GUIDES.map(({ slug, title, summary }) => ({ slug, title, summary })), TERMS_PAGE];
  return (
    <div className="page learn-page" data-testid="learn-index">
      <header className="page-header compact"><div>
        <h1>Learn the basics</h1>
        <p className="lead">Short guides to how insurance works, so your documents and DearPolicy&rsquo;s answers make more sense.</p>
      </div></header>
      <LearnNotice />
      <ul className="learn-list">
        {pages.map((page) => (
          <li key={page.slug}>
            <Link className="learn-card" href={`/learn/${page.slug}`}>
              <strong>{page.title}</strong>
              <span>{page.summary}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="note">Have a question about your own cover? <Link className="text-link" href="/chat">Ask DearPolicy</Link></p>
    </div>
  );
}
