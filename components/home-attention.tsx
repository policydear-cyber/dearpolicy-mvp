"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { sgDate } from "@/components/format-date";
import { NOT_FAMILY_KEY } from "@/components/device-memory";

const LAST_VISIT_KEY = "dearpolicy.lastHomeVisit";
/** Reloads within this gap keep the same "since your last visit" baseline. */
const VISIT_GAP_MS = 30 * 60 * 1000;

type Policy = {
  id: string; product_name: string | null; original_filename: string | null; processing_status: string; created_at?: string | null;
  personal_coverage_confirmed: boolean; detected_people: { name: string; matchedFamilyMemberId: string | null }[];
};
type Claim = { id: string; family_member_id: string; conversation_id?: string | null; event_summary: string | null; updated_at: string;
  display?: { label: string; tone: "info" | "waiting" | "ready"; requestedDocuments: string[] } | null };
type Item = { key: string; tone: "warn" | "info"; title: string; detail: string; href: string; action: string };

const docName = (p: Policy) => p.product_name?.trim() || p.original_filename?.trim() || "A document";
const READING = new Set(["queued", "extracting", "indexing", "uploaded", "processing"]);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function readJson<T>(key: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(key) || "") as T; } catch { return fallback; } }

/** What a returning household needs on landing: what changed since the last visit, what needs them, and a box to ask.
 * Built only from GET /api/policies and GET /api/claims, the same data the Documents and Claims pages show. */
export function HomeAttention({ memberId }: { memberId?: string }) {
  const router = useRouter();
  const [policies, setPolicies] = useState<Policy[] | null>(null);
  const [claims, setClaims] = useState<Claim[] | null>(null);
  const [since, setSince] = useState<string | null>(null);
  const [notFamily, setNotFamily] = useState<string[]>([]);
  const [question, setQuestion] = useState("");

  useEffect(() => {
    const previous = readJson<string | null>(LAST_VISIT_KEY, null);
    const now = Date.now();
    if (previous && now - Date.parse(previous) < VISIT_GAP_MS) {
      // Same sitting: keep comparing against the visit before it.
      setSince(readJson<string | null>(`${LAST_VISIT_KEY}.before`, null));
    } else {
      setSince(previous);
      try { if (previous) localStorage.setItem(`${LAST_VISIT_KEY}.before`, JSON.stringify(previous)); localStorage.setItem(LAST_VISIT_KEY, JSON.stringify(new Date(now).toISOString())); } catch { /* storage unavailable */ }
    }
    setNotFamily(readJson<string[]>(NOT_FAMILY_KEY, []));
    fetch("/api/policies", { cache: "no-store" }).then((r) => r.json()).then((d) => setPolicies(d.policies ?? [])).catch(() => setPolicies([]));
    fetch("/api/claims", { cache: "no-store" }).then((r) => r.json()).then((d) => setClaims(d.claims ?? [])).catch(() => setClaims([]));
  }, []);

  function ask(e: FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (question.trim()) params.set("ask", question.trim().slice(0, 2000));
    if (memberId) params.set("member", memberId);
    const query = params.toString();
    router.push(`/chat${query ? `?${query}` : ""}`);
  }

  const items: Item[] = [];
  const all = policies ?? [];
  const failed = all.filter((p) => p.processing_status === "failed");
  if (failed.length) items.push({ key: "failed", tone: "warn", href: failed.length === 1 ? `/policies#doc-${failed[0].id}` : "/policies", action: "Open",
    title: failed.length === 1 ? `“${docName(failed[0])}” couldn’t be read` : `${failed.length} documents couldn’t be read`,
    detail: "Answers can’t use it until it is read. You can try again or upload a clearer copy." });
  const names = all.filter((p) => p.personal_coverage_confirmed && p.processing_status === "ready")
    .flatMap((p) => p.detected_people.filter((n) => !n.matchedFamilyMemberId && !notFamily.includes(`${p.id}:${n.name}`)).map((n) => ({ policy: p, name: n.name })));
  if (names.length) items.push({ key: "names", tone: "info", href: `/policies#doc-${names[0].policy.id}`, action: "Confirm",
    title: names.length === 1 ? `Who is “${names[0].name}”?` : `${names.length} names to confirm`,
    detail: names.length === 1 ? `Named in ${docName(names[0].policy)}. Nothing in it is used for that person until you say.` : "Named in your documents. Nothing is used for those people until you say who they are." });
  for (const c of claims ?? []) {
    const tone = c.display?.tone;
    if (tone === "waiting" && c.display?.requestedDocuments.length) items.push({ key: `c-${c.id}`, tone: "info", href: `/claims/${c.id}`, action: "Send",
      title: `${plural(c.display.requestedDocuments.length, "document", "documents")} to send`, detail: c.event_summary ?? "For a claim" });
    else if (tone === "info") items.push({ key: `c-${c.id}`, tone: "info", href: c.conversation_id ? `/chat?conversation=${c.conversation_id}` : `/chat?member=${c.family_member_id}`, action: "Continue",
      title: "Questions to answer", detail: c.event_summary ?? "For a claim" });
  }
  const reading = all.filter((p) => READING.has(p.processing_status)).length;

  const changes: string[] = [];
  if (since) {
    const added = all.filter((p) => p.created_at && p.created_at > since).length;
    const updated = (claims ?? []).filter((c) => c.updated_at > since).length;
    if (added) changes.push(`${plural(added, "document", "documents")} added`);
    if (updated) changes.push(`${plural(updated, "claim", "claims")} updated`);
  }
  const loaded = policies !== null && claims !== null;

  return <section className="section home-attention" data-testid="home-attention" aria-label="What needs your attention">
    <form className="home-ask" onSubmit={ask} role="search" aria-label="Ask DearPolicy">
      <label htmlFor="home-ask-input">Ask about your family&rsquo;s cover</label>
      <div className="home-ask-row">
        <input id="home-ask-input" type="text" value={question} maxLength={2000} onChange={(e) => setQuestion(e.target.value)} placeholder="For example: what can I claim for a broken arm?" enterKeyHint="go" />
        <button className="button primary" type="submit">Ask</button>
      </div>
    </form>
    {since && loaded ? <p className="home-since" data-testid="home-since">
      {changes.length ? <><b>Since your last visit</b> on {sgDate(since)}: {changes.join(" and ")}.</> : <>Nothing new since your last visit on {sgDate(since)}.</>}
      {reading ? ` ${plural(reading, "document is", "documents are")} still being read.` : ""}
    </p> : reading ? <p className="home-since">{plural(reading, "document is", "documents are")} still being read.</p> : null}
    {loaded ? items.length ? <>
      <h2 className="home-attention-title">Needs your attention <span>{items.length}</span></h2>
      <ul className="home-attention-list">{items.slice(0, 5).map((i) => <li key={i.key} className={i.tone}>
        <Link href={i.href}><span className="home-attention-text"><strong>{i.title}</strong><small>{i.detail}</small></span><span className="home-attention-action">{i.action} ›</span></Link>
      </li>)}</ul>
      {items.length > 5 ? <p className="muted">{plural(items.length - 5, "more item is", "more items are")} on the Documents and Claims pages.</p> : null}
    </> : <p className="home-all-clear" data-testid="home-all-clear">Nothing needs you right now.</p> : null}
  </section>;
}
