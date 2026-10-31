import type { ChatCitation } from "@/types";

/** One row per document, not per passage: the same page cited by several
 * statements is listed once, and a document's pages read as one line
 * ("pages 8, 13"). Tapping a document shows the words it was cited for. */
type SourceDoc = { key: string; policyId: string; name: string; insurer?: string; label?: string; role?: string | null; pages: string[]; excerpts: string[]; documentDate?: string | null; notConfirmedCurrent?: boolean };

const pageText = (c: ChatCitation) => c.pageStart == null ? null : c.pageEnd != null && c.pageEnd !== c.pageStart ? `${c.pageStart}–${c.pageEnd}` : String(c.pageStart);

export function groupSources(citations: ChatCitation[]): SourceDoc[] {
  const docs = new Map<string, SourceDoc>();
  for (const c of citations) {
    const key = c.policyId || c.policyName;
    const doc = docs.get(key) ?? { key, policyId: c.policyId, name: c.policyName, insurer: c.insurer, label: c.evidenceLabel, role: c.documentRole, pages: [], excerpts: [], documentDate: c.documentDate, notConfirmedCurrent: c.notConfirmedCurrent };
    const page = pageText(c);
    if (page && !doc.pages.includes(page)) doc.pages.push(page);
    const excerpt = c.excerpt?.replace(/\s+/g, " ").trim();
    if (excerpt && !doc.excerpts.includes(excerpt)) doc.excerpts.push(excerpt);
    // Any of the document's citations saying it is not confirmed current is enough.
    if (c.notConfirmedCurrent) doc.notConfirmedCurrent = true;
    if (!doc.documentDate && c.documentDate) doc.documentDate = c.documentDate;
    docs.set(key, doc);
  }
  for (const doc of docs.values()) doc.pages.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  return [...docs.values()];
}

/** "product_summary" -> "Product summary". */
const roleWord = (role: string | null | undefined) => role ? role.replaceAll("_", " ").replace(/^\w/, (m) => m.toUpperCase()) : null;

/** `files` maps a document id to its file name in the household's library, so
 * two documents with the same product name (a certificate and its part 2)
 * read as two different rows. */
export function SourceList({ citations, files }: { citations: ChatCitation[]; files?: Record<string, string> }) {
  return <div className="source-list">{groupSources(citations).map((doc) => {
    const pages = doc.pages.length ? `${doc.pages.length > 1 || doc.pages[0].includes("–") ? "pages" : "page"} ${doc.pages.join(", ")}` : "page not recorded";
    const head = <>
      <span className="source-name">{doc.insurer ? doc.insurer + " · " : ""}{doc.name}<small>{[doc.label ?? roleWord(doc.role) ?? "Your uploaded document", files?.[doc.policyId], doc.documentDate ? `dated ${doc.documentDate}` : null].filter(Boolean).join(" · ")}</small></span>
      <b>{pages}</b>
    </>;
    return doc.excerpts.length
      ? <details className="citation source-doc" key={doc.key}><summary>{head}</summary>
          {/* Shown whole: cutting a passage could drop the qualifier at its end. */}
          {doc.excerpts.map((e, i) => <blockquote key={i}>“{e}”</blockquote>)}
          {doc.notConfirmedCurrent && doc.documentDate ? <small className="source-date">{`Dated ${doc.documentDate}.`}</small> : null}
          <a className="source-open" href={`/policies#doc-${doc.policyId}`}>Open in Documents</a>
        </details>
      : <div className="citation source-doc" key={doc.key}>{head}</div>;
  })}</div>;
}
