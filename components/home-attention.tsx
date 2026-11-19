"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { NOT_FAMILY_KEY } from "@/components/device-memory";
import { Icon } from "@/components/icons";
import { documentCardTitle } from "@/lib/policies/document-name";


type Policy = {
  id: string; product_name: string | null; original_filename: string | null; insurer?: string | null; document_role?: string | null; policy_number?: string | null; processing_status: string; created_at?: string | null;
  personal_coverage_confirmed: boolean; detected_people: { name: string; matchedFamilyMemberId: string | null }[];
};
type Claim = { id: string; family_member_id: string; conversation_id?: string | null; event_summary: string | null; updated_at: string;
  display?: { label: string; tone: "info" | "waiting" | "ready"; requestedDocuments: string[] } | null };
type Item = { key: string; tone: "warn" | "info"; title: string; detail: string; href: string; action: string };

/** A document's title as its Documents card shows it: never its file name (DC 18 Nov: no file names). */
const docName = (p: Policy) => documentCardTitle(p);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function readJson<T>(key: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(key) || "") as T; } catch { return fallback; } }

/** Home's ask box: Ask DearPolicy is the main feature, so it sits beside the person's cards, never only in the menu (DC
 * 16 Nov). It opens the chat with the question and the person chosen on Home. */
export function HomeAsk({ memberId, name }: { memberId?: string; name?: string | null }) {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  function go(text: string) {
    const params = new URLSearchParams();
    if (text.trim()) params.set("ask", text.trim().slice(0, 2000));
    if (memberId) params.set("member", memberId);
    const query = params.toString();
    router.push(`/chat${query ? `?${query}` : ""}`);
  }
  function ask(e: FormEvent) { e.preventDefault(); go(question); }
  const examples = ["What can I claim for a broken arm?", "Am I covered if I'm hospitalised overseas?", "What do I do after a car accident?"];
  return <section className="home-ask-panel" id="ask" data-testid="home-ask" aria-labelledby="home-ask-title">
    <h2 id="home-ask-title"><span className="title-icon"><Icon name="ask" /></span>Ask DearPolicy</h2>
    <p>Ask anything about {name ? `${name}’s` : "your family’s"} cover, a claim or what to do next. Answers come from your own documents.</p>
    <form className="home-ask" onSubmit={ask} role="search" aria-label="Ask DearPolicy">
      <label htmlFor="home-ask-input" className="sr-only">Your question</label>
      <textarea id="home-ask-input" value={question} maxLength={2000} rows={3} onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); go(question); } }}
        placeholder="Type your question" enterKeyHint="send" />
      <button className="button primary" type="submit"><Icon name="ask" />Ask</button>
    </form>
    <ul className="home-ask-examples" aria-label="Example questions">{examples.map((q) => <li key={q}><button type="button" onClick={() => go(q)}>{q}</button></li>)}</ul>
  </section>;
}

/** What needs the household on Home, under the cards: a document that couldn't be read, a name to confirm, a claim waiting
 * on them. Nothing when nothing needs them (DC 16 Nov: Home only shows what matters). Built only from GET /api/policies and
 * GET /api/claims, the same data the Documents and Claims pages show. */
export function HomeAttention() {
  const [policies, setPolicies] = useState<Policy[] | null>(null);
  const [claims, setClaims] = useState<Claim[] | null>(null);
  const [notFamily, setNotFamily] = useState<string[]>([]);

  useEffect(() => {
    setNotFamily(readJson<string[]>(NOT_FAMILY_KEY, []));
    fetch("/api/policies", { cache: "no-store" }).then((r) => r.json()).then((d) => setPolicies(d.policies ?? [])).catch(() => setPolicies([]));
    fetch("/api/claims", { cache: "no-store" }).then((r) => r.json()).then((d) => setClaims(d.claims ?? [])).catch(() => setClaims([]));
  }, []);

  const items: Item[] = [];
  const all = policies ?? [];
  const failed = all.filter((p) => p.processing_status === "failed");
  if (failed.length) items.push({ key: "failed", tone: "warn", href: failed.length === 1 ? `/policies#doc-${failed[0].id}` : "/policies", action: "Open",
    title: failed.length === 1 ? (!failed[0].product_name?.trim() && !failed[0].insurer?.trim() ? "One document couldn’t be read" : `“${docName(failed[0])}” couldn’t be read`) : `${failed.length} documents couldn’t be read`,
    detail: failed.length === 1 ? "Answers can’t use it until it is read. You can try again or upload a clearer copy." : "Answers can’t use them until they are read. You can try again or upload clearer copies." });
  const names = all.filter((p) => p.personal_coverage_confirmed && p.processing_status === "ready")
    .flatMap((p) => p.detected_people.filter((n) => !n.matchedFamilyMemberId && !notFamily.includes(`${p.id}:${n.name}`)).map((n) => ({ policy: p, name: n.name })));
  if (names.length) items.push({ key: "names", tone: "info", href: `/policies#doc-${names[0].policy.id}`, action: "Confirm",
    title: names.length === 1 ? `Who is “${names[0].name}”?` : `${names.length} names to confirm`,
    detail: names.length === 1 ? `Named in ${docName(names[0].policy)}. DearPolicy won’t use this document for that person until you say who they are.` : "Named in your documents. DearPolicy won’t use those documents for these people until you say who they are." });
  for (const c of claims ?? []) {
    const tone = c.display?.tone;
    if (tone === "waiting" && c.display?.requestedDocuments.length) items.push({ key: `c-${c.id}`, tone: "info", href: `/claims/${c.id}`, action: "Send",
      title: `${plural(c.display.requestedDocuments.length, "document", "documents")} to send`, detail: c.event_summary ?? "For a claim" });
    else if (tone === "info") items.push({ key: `c-${c.id}`, tone: "info", href: c.conversation_id ? `/chat?conversation=${c.conversation_id}` : `/chat?member=${c.family_member_id}`, action: "Continue",
      title: "Questions to answer", detail: c.event_summary ?? "For a claim" });
  }
  const loaded = policies !== null && claims !== null;

  if (!loaded || !items.length) return null;
  return <section className="section home-attention" data-testid="home-attention" aria-label="What needs your attention">
    <h2 className="home-attention-title">Needs your attention <span>{items.length}</span></h2>
    <ul className="home-attention-list">{items.slice(0, 5).map((i) => <li key={i.key} className={i.tone}>
      <Link href={i.href}><span className="home-attention-text"><strong>{i.title}</strong><small>{i.detail}</small></span><span className="home-attention-action">{i.action} ›</span></Link>
    </li>)}</ul>
    {items.length > 5 ? <p className="muted">{plural(items.length - 5, "more item is", "more items are")} on the Documents and Claims pages.</p> : null}
  </section>;
}
