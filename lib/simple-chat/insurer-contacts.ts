/**
 * The insurer's contact details (claims or service phone, email, website) shown with an answer's next steps, taken only
 * from what the household's own documents print. The model never writes them here: the server reads them from the stored
 * pages, each with the document and page it is printed on. Any insurer, any layout: a contact is kept only when the words
 * around it say what it is (a claims line, a hotline, customer service, "call us"), and an email or website only when its
 * domain carries the insurer's own name, so a regulator's, an agent's or a hospital's details are never shown as the
 * insurer's. When nothing is found, nothing is shown.
 */
import type { ChatAnswer } from "@/types";
import { moneyFiguresIn } from "@/lib/chat/answer-verification";
import { unreadable, type Household, type HouseholdDocument } from "./library";

import type { InsurerContact, InsurerContactItem as ContactItem } from "@/types";
export type { InsurerContact };

/** A phone number by its shape: groups of digits split by spaces or hyphens, an optional +country code or (area). */
const PHONE = /(?<![\w$£€¥.,/:-])(?:\+\d{1,3}[ -]?)?(?:\(\d{1,4}\)[ -]?)?\d{3,4}(?:[ -]\d{3,4}){1,3}(?![\w%$/]|[.,:]\d|-\d)/g;
/** A number of 7 to 12 digits with no spaces, read as a phone only straight after a phone label ("Tel: 62345678"). */
const LABELLED_BARE = /\b(?:tel(?:ephone)?|phone|hotline|helpline|call(?: us)?(?: at| on)?)\s*(?:no\.?|number)?\s*[:.]?\s*(\+?\d{7,12})(?![\w%$/]|[.,]\d)/gi;
const EMAIL = /(?<![\w.%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![\w-])/g;
const WEBSITE = /(?<![\w@./-])(?:https?:\/\/)?www\.[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?:\/[^\s)<>"'“”,;]*)?|(?<![\w@./-])https?:\/\/[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?:\/[^\s)<>"'“”,;]*)?/gi;

/** Words that say a number is a way to reach the insurer. */
const CONTACT_WORDS = /\b(?:claims?|hotline|helpline|help ?desk|customer (?:service|care|services|centre|center)|contact(?: us| centre| center)?|call(?: us)?|tel(?:ephone)?\.?|phone|enquir(?:y|ies)|emergency|assistance|24[- ]?hours?)\b/i;
/** Words that say a number is someone else's: a regulator or dispute body, an agent or adviser, a hospital or clinic, a fax. */
const NOT_INSURER = /\b(?:fax|facsimile|fidrec|ombudsman|monetary authority|mas|sdic|deposit insurance|life insurance association|general insurance association|lia|gia|dispute|mediation|agent|adviser|advisor|representative|broker|intermediary|hospital|clinic|doctor|physician|police|embassy)\b/i;
/** Words that say a number is an identifier, not a phone: a policy, certificate, member or reference number. */
const IDENTIFIER_LABEL = /\b(?:policy|certificate|cert|member(?:ship)?|account|reference|ref|nric|passport|identity|id|plan|claim)\s*(?:no\.?|number|#)/i;
const CLAIM_WORDS = /\bclaims?\b/i;
const EMERGENCY_WORDS = /\b(?:emergency|assistance|24[- ]?hours?)\b/i;

const GENERIC_NAME_WORDS = new Set("insurance assurance reinsurance life general company co corporation corp limited ltd plc pte berhad bhd inc llc group holdings singapore malaysia international the and of takaful financial services".split(" "));
/** The insurer's own name words ("Harbourline Assurance plc" → harbourline), for matching an email's or website's domain. */
const nameWords = (insurer: string) => insurer.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !GENERIC_NAME_WORDS.has(w));
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
/** Whether a host (www.harbourline.com.sg) carries the insurer's own name. */
function ownDomain(host: string, insurer: string): boolean {
  const h = squash(host.replace(/^www\./i, "").split(".").slice(0, -1).join(".") || host);
  const words = nameWords(insurer);
  if (!words.length || !h) return false;
  const whole = words.join("");
  return words.some((w) => h.includes(w)) || (h.length >= 3 && whole.includes(h.split(/[^a-z0-9]/)[0]));
}

const digits = (s: string) => s.replace(/\D/g, "");
/** The words around a match on its own line: up to 60 characters before and 25 after, cut at a sentence end. */
function around(text: string, at: number, length: number): string {
  const lineStart = text.lastIndexOf("\n", at) + 1;
  const lineEnd = (() => { const e = text.indexOf("\n", at + length); return e < 0 ? text.length : e; })();
  let before = text.slice(Math.max(lineStart, at - 60), at);
  // A sentence end, not an abbreviation's full stop ("Policy No. 1234 5678", "Tel. 6123 4567").
  const ends = [...before.matchAll(/(?<!\b(?:no|nos|tel|ref|st|dr|mr|mrs|ms|co|ltd|pte))[.;]\s+/gi)];
  if (ends.length) { const last = ends[ends.length - 1]; before = before.slice((last.index ?? 0) + last[0].length); }
  let after = text.slice(at + length, Math.min(lineEnd, at + length + 25));
  const end = after.search(/[.;](?:\s|$)/);
  if (end >= 0) after = after.slice(0, end);
  return `${before} ${after}`;
}

type Found = ContactItem & { key: string };

/** The contacts one page prints for an insurer. */
export function contactsOnPage(text: string, page: number, policyName: string, insurer: string): Found[] {
  const out: Found[] = [];
  const money = new Set(moneyFiguresIn(text).map((f) => Math.round(f.value * 100)));
  const addPhone = (raw: string, at: number) => {
    const n = digits(raw);
    if (n.length < 7 || n.length > 15) return;
    // A figure the page prints as money is never a phone number.
    if (money.has(Number(n) * 100)) return;
    const near = around(text, at, raw.length);
    if (!CONTACT_WORDS.test(near) || NOT_INSURER.test(near) || IDENTIFIER_LABEL.test(near)) return;
    const label = CLAIM_WORDS.test(near) ? "Claims" : EMERGENCY_WORDS.test(near) ? "Emergency assistance" : "Phone";
    out.push({ kind: "phone", label, value: raw.trim().replace(/\s+/g, " "), source: { policyName, page }, key: `phone:${n}` });
  };
  for (const m of text.matchAll(PHONE)) addPhone(m[0], m.index ?? 0);
  for (const m of text.matchAll(LABELLED_BARE)) addPhone(m[1], (m.index ?? 0) + m[0].indexOf(m[1]));
  for (const m of text.matchAll(EMAIL)) {
    const value = m[0].replace(/\.$/, "");
    if (!ownDomain(value.split("@")[1], insurer)) continue;
    const near = around(text, m.index ?? 0, value.length);
    out.push({ kind: "email", label: CLAIM_WORDS.test(near) || /claim/i.test(value) ? "Claims email" : "Email", value, source: { policyName, page }, key: `email:${value.toLowerCase()}` });
  }
  for (const m of text.matchAll(WEBSITE)) {
    const value = m[0].replace(/[.)\]]+$/, "");
    const host = value.replace(/^https?:\/\//i, "").split("/")[0];
    if (!ownDomain(host, insurer)) continue;
    out.push({ kind: "website", label: "Website", value, source: { policyName, page }, key: `web:${host.toLowerCase().replace(/^www\./, "")}` });
  }
  return out;
}

/** The insurer a document is from, as one key: "Harbourline Assurance plc" and "HARBOURLINE ASSURANCE" are one insurer. */
const insurerKey = (insurer: string) => nameWords(insurer).join(" ");

/** How many of each kind are shown for one insurer: a claims line, one other phone, an email and a website at most. */
function pick(found: Found[]): ContactItem[] {
  const seen = new Set<string>();
  const unique = found.filter((f) => !seen.has(f.key) && seen.add(f.key));
  const claims = unique.filter((f) => f.kind === "phone" && f.label === "Claims").slice(0, 1);
  const otherPhone = unique.filter((f) => f.kind === "phone" && f.label !== "Claims").slice(0, claims.length ? 1 : 2);
  const email = [...unique.filter((f) => f.kind === "email" && f.label === "Claims email"), ...unique.filter((f) => f.kind === "email" && f.label !== "Claims email")].slice(0, 1);
  const web = unique.filter((f) => f.kind === "website").slice(0, 1);
  return [...claims, ...otherPhone, ...email, ...web].map(({ key: _key, ...item }) => item);
}

/** Whether contact details help this answer: it gives next steps, or the question is about claiming or reaching the insurer. */
const ASKS_CONTACT = /\b(?:claim(?:s|ing)?|contact|call|phone|e-?mail|hotline|helpline|reach|notify|submit|website|what (?:do|should|can) (?:i|we) do|next steps?|how do (?:i|we))\b/i;
export const contactsHelp = (answer: Pick<ChatAnswer, "nextSteps">, question: string) => (answer.nextSteps ?? []).length > 0 || ASKS_CONTACT.test(question);

/**
 * The contacts for the insurers whose documents this answer cites, read from the household's own pages (the cited
 * documents first, then the household's other documents from the same insurer). Documents not read, and copies replaced
 * by a newer one, are not read for contacts. At most three insurers.
 */
export function insurerContactsFor(household: Household, answer: Pick<ChatAnswer, "citations">, docLabel: (d: HouseholdDocument) => string): InsurerContact[] {
  const cited = [...new Set((answer.citations ?? []).map((c) => (c as { policyId?: string }).policyId).filter((id): id is string => !!id))];
  const usable = household.documents.filter((d) => !unreadable(d) && !d.supersededAt && !!d.insurer?.trim());
  const order: { key: string; name: string; docs: HouseholdDocument[] }[] = [];
  for (const id of cited) {
    const d = usable.find((x) => x.policyId === id);
    if (!d) continue;
    const key = insurerKey(d.insurer!);
    if (!key || order.some((o) => o.key === key)) continue;
    // The cited documents of this insurer first, then its other documents.
    const same = usable.filter((x) => insurerKey(x.insurer!) === key);
    const docs = [...same.filter((x) => cited.includes(x.policyId)), ...same.filter((x) => !cited.includes(x.policyId))];
    order.push({ key, name: d.insurer!.trim(), docs });
  }
  return order.slice(0, 3).flatMap((o) => {
    const found = o.docs.flatMap((d) => d.pages.flatMap((p) => contactsOnPage(p.text, p.page, docLabel(d), o.name)));
    const items = pick(found);
    return items.length ? [{ insurer: o.name, items }] : [];
  });
}
