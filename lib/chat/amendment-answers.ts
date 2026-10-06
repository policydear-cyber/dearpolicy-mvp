/**
 * Round 15: questions about a change to a policy -- "what changed in the
 * endorsement?", "when was the sum assured changed?", "did I reduce or increase
 * my cover?", "why does my schedule say 300k?", "is my 2021 schedule still
 * valid?", "which one is correct?", "how much premium am I saving after the
 * reduction?" -- answered from the amending document's own Before / After rows
 * (lib/policies/amendments.ts), with its date and page. The replaced figure is
 * only ever shown as the figure before the change.
 */
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import { replacedFigures, type Replacement } from "@/lib/policies/amendments";
import type { ChatCitation } from "@/types";
import type { RegistryAnswer } from "./registry-answers";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDate = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split("-").map(Number); return d + " " + MONTHS[m - 1] + " " + y; };
const MONEY = /(?:S\$|SGD\s?|US\$|USD\s?)\s?\d[\d,]*(?:\.\d+)?/g;
const money = (n: number, cents: boolean) => "S$" + n.toLocaleString("en-US", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 });

const CHANGE_ASKED = /\b(?:pay|paid|premium|sum (?:assured|insured)|cover(?:age)?)\b[^?]{0,30}\b(?:before|previously|originally|used to)\b|\bwhat did (?:i|we) pay\b[^?]{0,30}\bbefore\b|\bendorsements?\b|\bamend\w*|\balter(?:ed|ation)\b|\b(?:chang\w*|reduc\w*|increas\w*|lower\w*|decreas\w*|cut)\b[^?]{0,40}\b(?:sum (?:assured|insured)|cover\w*|premium|polic(?:y|ies)|life cover|protection)\b|\b(?:sum (?:assured|insured)|cover\w*|premium|polic(?:y|ies))\b[^?]{0,30}\b(?:chang\w*|reduc\w*|increas\w*|lower\w*|decreas\w*)\b|\bschedule\b[^?]{0,50}\b(?:says?|said|shows?|valid|still|correct|wrong|right)\b|\bwhich (?:one|figure|amount|document) is (?:correct|right|current)\b|\b(?:no longer|still) valid\b|\bsaving\b[^?]{0,40}\b(?:reduction|change|premium)\b/i;

export async function amendmentAnswer(args: { accountId: string; question: string; topic?: string | null }): Promise<RegistryAnswer | null> {
  const text = args.question.trim();
  if (!text || text.split(/\s+/).length > 30) return null;
  // Advice about the change (\"should I increase it back?\", \"was it a mistake?\") is not answered from its rows.
  if (/\bshould (?:i|we)\b|\bmistake\b|\bworth\b|\brecommend\b|\bwhat if\b/i.test(text)) return null;
  // A figure the household quotes that a change replaced (\"my schedule says 300k\") is about that change too.
  const quoted = [...text.matchAll(/\b(\d[\d,]*(?:\.\d+)?)\s*(k)?\b/gi)].map((m) => Number(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1)).filter((n) => n >= 100);
  const bareBefore = /^\s*(?:and\s+|so\s+)?(?:before|previously|originally|last time|the old (?:one|figure|amount))\s*\??\s*$/i.test(text) && !!args.topic;
  // Nothing in the question can be about a change: no database read at all.
  if (!CHANGE_ASKED.test(text) && !quoted.length && !bareBefore) return null;
  const replaced: Map<string, Replacement> = await replacedFigures(args.accountId).catch(() => new Map<string, Replacement>());
  if (!replaced.size) return null;
  const citesOld = [...replaced.values()].some((r) => r.rows.some((row) => quoted.includes(row.before)));
  // "before?", "previously?" right after a question about a plan that was changed: what it was before the change.
  if (!CHANGE_ASKED.test(text) && !citesOld && !bareBefore) return null;
  const docs = (await query<{ id: string; file: string; product: string | null; dated: string | null; role: string | null; insurer: string | null }>(
    `SELECT p.id::text, p.original_filename AS file, p.product_name AS product, coalesce(p.document_date, p.effective_date)::text AS dated, p.document_role AS role, p.insurer
       FROM policies p WHERE p.account_id=$1 AND ${activePredicate("p")} AND p.processing_status='ready'`, [args.accountId]).catch(() => ({ rows: [] }))).rows;
  const byId = new Map(docs.map((d) => [d.id, d]));
  // One change per amending document; the plan the question (or the chat) names, when it names one.
  const changes = new Map<string, { by: string; olds: string[]; rows: { before: number; after: number; label: string; page: number; line: string }[]; date: string; product: string | null }>();
  for (const [oldId, r] of replaced) {
    const c = changes.get(r.byDocId) ?? { by: r.byDocId, olds: [], rows: r.rows, date: r.byDate, product: r.byProduct };
    c.olds.push(oldId); changes.set(r.byDocId, c);
  }
  const named = (q: string) => [...changes.values()].filter((c) => (c.product ?? "").split(/[^\p{L}\p{N}]+/u).some((w) => w.length >= 5 && !/^(?:protect|policy|insurance|assurance|shield|life)$/i.test(w) && new RegExp("\\b" + w + "\\b", "i").test(q)));
  let picked = named(text);
  if (!picked.length && args.topic) picked = named(args.topic);
  if (!picked.length) picked = [...changes.values()];
  if (picked.length !== 1) return null;
  const c = picked[0];
  const by = byId.get(c.by);
  if (!by || !c.rows.length) return null;
  const pageText = (await query<{ text: string }>("SELECT text FROM policy_pages WHERE account_id=$1 AND policy_id=$2 ORDER BY page_number", [args.accountId, c.by]).catch(() => ({ rows: [] }))).rows.map((r) => r.text).join("\n");
  const heads = pageText.split(/\n/).map((l) => l.replace(/\s*\((?:fictitious|fictional|synthetic)[^)]*\)\s*/gi, " ").trim()).filter((l) => l.length <= 90);
  const title = heads.find((l) => /\bendorsement\b/i.test(l)) ?? heads.find((l) => /\balteration\b|\bamendment\b/i.test(l)) ?? null;
  const titleWords = title ? title.replace(/\s*[-–—]\s*.*$/, "").toLowerCase().replace(/\b\w/g, (x) => x.toUpperCase()).replace(/\bNo\b\.?/, "No.") : "The amending document";
  const unchanged = /\b(?:all )?other terms(?: and conditions)?[^.]{0,40}\bunchanged\b|\bremain(?:s)? unchanged\b/i.test(pageText);
  const direction = (row: { before: number; after: number }) => row.after < row.before ? "reduced" : row.after > row.before ? "increased" : "unchanged";
  const cover = c.rows.filter((r) => !/premium/i.test(r.label));
  const premium = c.rows.find((r) => /premium/i.test(r.label));
  const lines = c.rows.map((r) => {
    const printed = r.line.match(MONEY) ?? [];
    return r.label + ": " + (printed[0] ?? money(r.before, false)) + " before the change, " + (printed[1] ?? money(r.after, false)) + " from " + longDate(c.date) + " (" + direction(r) + ").";
  });
  const olds = c.olds.map((id) => byId.get(id)).filter((d): d is NonNullable<typeof d> => !!d);
  const summary = (c.product ?? "The policy") + " was changed by " + (title ? titleWords : "an endorsement") + ", dated " + longDate(c.date) + (by.file ? " (“" + by.file + "”)" : "") + ": "
    + (cover.length ? "the cover was " + direction(cover[0]) + " to " + ((cover[0].line.match(MONEY) ?? [])[1] ?? money(cover[0].after, false)) : "the figures below changed")
    + (premium ? " and the annual premium is now " + ((premium.line.match(MONEY) ?? [])[1] ?? money(premium.after, true)) : "") + ". "
    + (olds.length ? "The earlier " + (olds.length === 1 ? "schedule" : "documents") + " (" + olds.map((d) => "“" + d.file + "”" + (d.dated ? ", dated " + longDate(d.dated) : "")).join("; ") + ") still " + (olds.length === 1 ? "prints" : "print") + " the figures from before the change, which the endorsement replaces"
      + (unchanged ? "; everything else on " + (olds.length === 1 ? "it" : "them") + " stays as printed" : "") + "." : "");
  const details = [...lines];
  const citations: ChatCitation[] = [{ chunkId: "page:" + c.by + ":" + (c.rows[0]?.page ?? 1), policyId: c.by, policyName: c.product ?? by.file, insurer: by.insurer ?? undefined, pageStart: c.rows[0]?.page ?? 1, pageEnd: c.rows[0]?.page ?? 1, documentRole: by.role }];
  return { summary, details, citations, personId: null, topic: c.product ?? undefined };
}
