/**
 * Round 10: questions about the UPLOADS themselves, and about the papers that
 * are not policies -- answered from what was read, in household words.
 *
 *   - "Why couldn't you read my TermGuard PDF?", "which of our documents
 *     couldn't be read?", "is anything still being read?", "what do my
 *     handwritten notes say?", "why didn't my HEIC photo upload?": each upload
 *     that could not be used, why, and what to do (the password, a fresh
 *     download, how to take the photo again).
 *   - "Which upload is the current schedule?", "is the photo the same as the
 *     PDF?", "which policies were in the bundle?", "what were the pages of the
 *     CareCash PDF like?", "which documents are letters?": how the uploads were
 *     read -- copies merged, last year's schedule set aside, a bundle split,
 *     pages out of order.
 *   - "What did the insurer say in the letter?", "why was the claim rejected?",
 *     "how much was the hospital bill?", "what does the app screenshot show?",
 *     "what's in my notes?": quoted from that paper, said for what it is (a
 *     letter, a claim decision, a bill, a screenshot, the family's own notes),
 *     never as cover.
 *
 * Plain code over the stored pages: nothing here is a model's words, and every
 * quoted line carries its page.
 */
import { query } from "@/lib/db/client";
import { activePredicate } from "@/lib/lifecycle/scopes";
import type { ClaimPerson } from "@/lib/claims/person";
import type { ChatAnswer, ChatCitation } from "@/types";
import type { ConversationState } from "./types";
import { NON_COVER_ROLES, ROLE_WORDS, flagUnclearFigures, printedLines, type CorrespondenceRole } from "@/lib/documents/messy";
import { INCOMPLETE_PDF_MESSAGE, PDF_PASSWORD_INCORRECT_MESSAGE, PDF_PASSWORD_REQUIRED_MESSAGE, UNOPENABLE_DOCUMENT_MESSAGE, UNREADABLE_PHOTO_MESSAGE } from "@/lib/documents/processing-errors";
import { householdPersonFromWords } from "./person-words";
import { replacedFigures } from "@/lib/policies/amendments";
import { askedCoverage, bestLines, columnsFor, narrowToColumn, piecesOf, quoted, wordsOf } from "./printed-lines";

export type DocumentAnswer = { summary: string; details: string[]; nextSteps: string[]; citations: ChatCitation[]; personId: string | null; patch: Partial<ConversationState> };
type Doc = { id: string; file: string; role: string | null; status: string; error: string | null; message: string | null; product: string | null; insurer: string | null;
  superseded: boolean; notes: string[]; uploadedTo: string; owners: string[]; created: string };

const personName = (p: ClaimPerson) => p.preferred_name?.trim() || p.display_name;
const isSelf = (p: ClaimPerson) => /^self$/i.test(p.relationship ?? "");
const listOf = (xs: string[]) => xs.length <= 1 ? xs.join("") : xs.slice(0, -1).join(", ") + " and " + xs.at(-1);
const cleanInsurer = (name: string | null) => name ? name.replace(/\s*\((?:fictitious|synthetic)[^)]*\)\s*/gi, " ").trim() : null;
const q = (file: string) => "“" + file + "”";

async function loadDocuments(accountId: string): Promise<Doc[]> {
  const rows = (await query<{ id: string; file: string | null; role: string | null; status: string; error: string | null; message: string | null; product: string | null; insurer: string | null;
    superseded: boolean; notes: unknown; uploaded_to: string; owners: string[] | null; created: string }>(
    `SELECT p.id::text,p.original_filename AS file,p.document_role AS role,p.processing_status AS status,p.processing_error AS error,p.processing_message AS message,p.product_name AS product,p.insurer,
            p.superseded_at IS NOT NULL AS superseded,p.extracted_json->'documentNotes' AS notes,p.family_member_id::text AS uploaded_to,
            ARRAY(SELECT pm.family_member_id::text FROM policy_members pm WHERE pm.policy_id=p.id AND pm.account_id=p.account_id) AS owners,p.created_at::text AS created
       FROM policies p WHERE p.account_id=$1 AND ${activePredicate("p")} ORDER BY p.created_at,p.id`, [accountId]).catch(() => ({ rows: [] }))).rows;
  return rows.map((r) => ({ id: r.id, file: r.file ?? "Document", role: r.role, status: r.status, error: r.error, message: r.message, product: r.product, insurer: r.insurer, superseded: !!r.superseded,
    notes: Array.isArray(r.notes) ? (r.notes as unknown[]).map(String) : [], uploadedTo: r.uploaded_to, owners: r.owners?.length ? r.owners : [r.uploaded_to], created: r.created }));
}
async function pagesOf(accountId: string, ids: string[]): Promise<Map<string, { page: number; text: string }[]>> {
  const out = new Map<string, { page: number; text: string }[]>();
  if (!ids.length) return out;
  const rows = (await query<{ policy_id: string; page_number: number; text: string }>(`SELECT policy_id::text,page_number,text FROM policy_pages WHERE account_id=$1 AND policy_id::text=ANY($2::text[]) ORDER BY page_number`,
    [accountId, ids]).catch(() => ({ rows: [] }))).rows;
  for (const r of rows) (out.get(r.policy_id) ?? out.set(r.policy_id, []).get(r.policy_id)!).push({ page: Number(r.page_number), text: r.text });
  return out;
}

// ---------------------------------------------------------------------------
// What could not be used, and why
// ---------------------------------------------------------------------------
type Unusable = "password" | "incomplete" | "unopenable" | "photo" | "scan" | "processing" | "handwriting";
function unusableKind(d: Doc): Unusable | null {
  if (d.status === "failed") {
    const e = d.error ?? "";
    if (e === PDF_PASSWORD_REQUIRED_MESSAGE || e === PDF_PASSWORD_INCORRECT_MESSAGE || /password/i.test(e)) return "password";
    if (e === INCOMPLETE_PDF_MESSAGE) return "incomplete";
    if (e === UNOPENABLE_DOCUMENT_MESSAGE) return "unopenable";
    if (e === UNREADABLE_PHOTO_MESSAGE) return "photo";
    return "scan";
  }
  if (d.status !== "ready") return "processing";
  if (d.role === "personal_notes" && /handwrit/i.test((d.message ?? "") + " " + d.notes.join(" "))) return "handwriting";
  return null;
}
const PHOTO_TIPS = "lay the page flat in good light with no shadow across it, hold the phone steady and straight above the page, keep the whole page in the frame, and check the photo is sharp before you upload it";
function unusableLine(d: Doc, kind: Unusable, readable?: string[]): string {
  switch (kind) {
    case "password": return q(d.file) + " is locked with a password, so DearPolicy couldn’t read it. Upload it again on the Documents page and type its password when asked — the insurer’s covering email or letter usually says what it is (often an ID number or a date of birth) — or ask the insurer for an unlocked copy.";
    case "incomplete": return q(d.file) + " is incomplete — the file stops part-way, as happens when a download or copy is cut off — so it couldn’t be opened at all. Download it again from the insurer’s email or website (or ask the insurer for a fresh copy) and upload the new file.";
    case "unopenable": return q(d.file) + " couldn’t be opened — the file looks damaged. Upload the original file again, or ask the insurer for a fresh copy.";
    case "photo": return q(d.file) + " is a photo too blurred, dark or faint to read, so nothing in it is available. Take it again: " + PHOTO_TIPS + ". A PDF from the insurer is even better.";
    case "scan": return q(d.file) + " couldn’t be read — DearPolicy found no readable text in it. The original PDF from the insurer, or a clearer scan, would let DearPolicy read it.";
    case "processing": return q(d.file) + " is still being read. Ask again in a few minutes.";
    case "handwriting": return q(d.file) + " is handwritten, and DearPolicy could read only parts of it, so it is kept as your own notes and nothing in it is used as a policy fact."
      + (readable?.length ? " The parts it could read: " + readable.map((l) => "“" + l + "”").join(", ") + "." : "");
  }
}

function cite(d: Doc, label: string, pages: number[]): ChatCitation[] {
  return [...new Set(pages)].map((n) => ({ chunkId: "page:" + d.id + ":" + n, policyId: d.id, policyName: label, pageStart: n, pageEnd: n }));
}

// ---------------------------------------------------------------------------
// The questions
// ---------------------------------------------------------------------------
/** Attributes a schedule or statement prints on a line of its own, which the
 * benefit reader does not carry: answered from that line. */
const ATTRIBUTE_Q = /\b(?:policy (?:number|no\.?)(?![\s:]*[A-Z0-9-]{5,})|nominee|nominat\w*|beneficiar\w*|who gets (?:it|the money|the payout)|(?:policy )?loan|borrow|reversionary|terminal bonus|bonus(?:es)? (?:added|declared|history)|premium term|finish paying|stop paying|how many (?:conditions|illnesses)|recuperation)\b/i;
/** "Who does SeniorGuard cover?", "who is on the travel plan?" */
const WHO_COVERS = /\bwho (?:does|do) (?:the |our |my |this |that )?([\w' -]{2,40}?) (?:cover|insure|protect)\b|\bwho(?:['’]s| is| are) (?:covered|insured|named) (?:by|under|on|in) (?:the |our |my )?([\w' -]{2,40})|\b(?:is|are) ([\w' -]{2,30}?) (?:covered|insured|named) (?:by|under|on|in) (?:the |our |my |his |her )?([A-Z][\w' -]{2,40})/i;
const HEIC = /\bheic\b|\bheif\b|\biphone (?:photo|picture|pic)\b|\blive photo\b/i;
const RETAKE = /\b(?:how (?:should|do|can|to) (?:i |we )?(?:take|snap|redo|re-?take|photograph|scan)|retake|re-take|take (?:it|the photo|a photo|the picture) again|photo again|better photo|clearer photo)\b/i;
const UNREADABLE_Q = /\b(?:couldn['’]?t|could not|can['’]?t|cannot|unable to|didn['’]?t|did not|not able to|failed to|won['’]?t)\b[^?.]{0,40}\b(?:read|open|upload|load)\b|\bunreadable\b|\bnot (?:been )?read\b|\bwhy\b[^?.]{0,60}\b(?:not (?:read|work|load)|password|locked|damaged|corrupt\w*|blurr\w*)\b|\bstill (?:being )?(?:read|processed|processing|loading)\b|\bwhat happened to\b|\b(?:password|locked|damaged|corrupt(?:ed)?|blurr?y|blurred)\b[^?.]{0,40}\b(?:pdf|file|photo|document|upload)|\bhandwrit\w*\b/i;
const UPLOAD_WORD = /\b(?:upload(?:ed|s)?|documents?|files?|pdfs?|photos?|pictures?|screenshots?|scans?|scanned|bundle|attachments?|papers?)\b/i;
const UPLOAD_ASK = /\b(?:pages?|order|like|which|list|every|all (?:the )?(?:documents|files|uploads)|same|twice|duplicate|copy|copies|current|latest|newest|contain\w*|in it|order|letters? rather|rather than|how many|from merlion|from (?:the )?insurer|did you use|do you use|which one)\b/i;
const ROLE_ASK: [CorrespondenceRole, RegExp][] = [
  ["claim_decision", /\b(?:reject\w*|declin\w*|turned down|repudiat\w*|claim decision|decision letter|decision on|appeal\w*|claim (?:number|no\.?)|osteoarthritis|unable to admit|fidrec|won['’]?t change its decision|change its decision)\b|\bwhy\b[^?]{0,40}\bclaim\b|\bclaim\b[^?]{0,40}\b(?:rejected|refused|declined)\b|\bhow much did\b[^?]{0,30}\bclaim\b/i],
  ["medical_bill", /\b(?:bill|invoice|gst|surgeon['’]?s? fee|anaesthetist|itemi[sz]ed|hospital charges|owe the hospital|still owe)\b|\bhow (?:many days|long) was\b[^?]{0,40}\bhospital\b/i],
  ["insurer_letter", /\bletter\b|\bwhat(?:['’]s| is)? happen\w*\b[^?]{0,40}\brider\b|\brider\b[^?]{0,30}\bhappen\w*\b|\bpremium\b[^?]{0,40}\b(?:going up|go up|increas\w*|rise|from next|next year|next april|from 1 april)\b|\b(?:going up|increase)\b[^?]{0,30}\bpremium\b|\brider\b[^?]{0,40}\b(?:withdraw\w*|end\w*|stop\w*|go(?:ing)? away|replac\w*|discontinu\w*)\b|\b(?:withdraw\w*|replacement rider|care rider)\b/i],
  ["app_screenshot", /\bscreenshot\b|\b(?:the|merlion['’]?s?|insurer['’]?s?) app\b/i],
  ["personal_notes", /\b(?:my|our|the) (?:own )?notes\b|\b(?:typed|wrote|written|made|jotted) (?:up |down )?(?:some |the |my |our )?notes\b|\bnotes? (?:i|we) (?:wrote|typed|made)\b|\bword (?:file|document|doc)\b|\.docx\b/i],
];

export async function documentQuestionAnswer(args: { accountId: string; question: string; family: ClaimPerson[]; current: ClaimPerson | null; state: ConversationState; subjects?: ClaimPerson[] }): Promise<DocumentAnswer | null> {
  const text = args.question.trim();
  if (!text || text.split(/\s+/).length > 60) return null;
  // (A question about the policies as a set -- lib/chat/registry-answers.ts -- is not an upload to follow up on.)
  const prior = args.state.documents?.kind === "registry" ? undefined : args.state.documents;
  const followUp = !!prior && text.split(/\s+/).length <= 10 && !/\b(?:cover\w*|pays?|premiums?|deductible|limit|benefit)\b/i.test(text)
    && (/^\s*(?:and|what about|how about|why not)\b/i.test(text) || /\b(?:photo|picture|pdf|file|letter|bill|scan|notes?|screenshot|upload|document)\b/i.test(text)
      || (prior.kind === "uploads" && /\b(?:which|ones?|current|same|older|newer|earlier|in it|in them)\b/i.test(text))
      || (prior.kind === "who" && text.split(/\s+/).length <= 6));
  const heic = HEIC.test(text), retake = RETAKE.test(text) && !/\bcover\b/i.test(text);
  const unreadable = UNREADABLE_Q.test(text) || (followUp && prior?.kind === "unreadable");
  // After a letter, "how much is he paying now?", "and from next April?", "deadline?" are about that letter.
  const letterFollow = prior?.kind === "correspondence" && prior.role === "insurer_letter" && text.split(/\s+/).length <= 12
    && /\b(?:paying|pay|premiums?|cost|from next|april|replace\w*|deadline|by when|change\w*|rider|apply|how much)\b/i.test(text) && !/\b(?:bill|claim|screenshot|notes?)\b/i.test(text);
  // "...and how much does his plan cover for that?" after the bill: the bill, against the cover.
  const billFollow = prior?.role === "medical_bill" && /^\s*(?:and|so|then|ok(?:ay)?)\b/i.test(text) && /\b(?:cover\w*|pay\w*|claim\w*)\b/i.test(text);
  let roleAsked: CorrespondenceRole | undefined = billFollow ? "medical_bill" as const : ROLE_ASK.find(([, re]) => re.test(text))?.[0] ?? (letterFollow ? "insurer_letter" : followUp && prior?.kind === "correspondence" ? prior.role as CorrespondenceRole : undefined);
  const figureAsked = [...text.matchAll(/S\$\s?(\d[\d,]*(?:\.\d{1,2})?)(?![\d,])/g)].map((m) => Number(m[1].replace(/,/g, ""))).filter((v) => v > 0);
  const uploadsAsked = UPLOAD_WORD.test(text) && (UPLOAD_ASK.test(text) || /\b(?:i|we)\s+(?:uploaded|sent|attached|scanned|added|put)\b/i.test(text));
  const scanAsked = /\b(?:can you|could you|did you|were you able to)\s+read\b/i.test(text);
  const pageAskedEarly = /\bpage\s+\d{1,3}\b/i.test(text) && /\b(?:printed|says?|read|show|on)\b/i.test(text);
  // "Should I surrender my policy to pay off my loan?" asks for advice, not for a printed line.
  const adviceAsked = /\b(?:should (?:i|we)|is it worth|worth (?:it|keeping)|recommend|advi[cs]e)\b/i.test(text);
  const attributeAsked = !adviceAsked && ATTRIBUTE_Q.test(text) || !adviceAsked && (/\b(?:still pay\w*|paid[- ]up)\b/i.test(text) && /\b(?:whole life|endowment|life (?:plan|policy))\b/i.test(text));
  // "Is Papa covered by SeniorGuard?" asks who; "is heart attack covered by ...?" asks what.
  const whoMatch = text.match(WHO_COVERS);
  const whoAsked = !!whoMatch && (!whoMatch[3] || householdPersonFromWords(whoMatch[3], args.family)?.status === "resolved"
    || args.family.some((p) => [p.display_name, p.preferred_name].some((n) => !!n && n.toLowerCase() === whoMatch[3].trim().toLowerCase())));
  // "When is the next premium?" right after an upload that couldn't be read: about that policy.
  const priorAsk = prior?.kind === "unreadable" && text.split(/\s+/).length <= 10 && /\b(?:premium|sum assured|cover|due|how much|from the policy)\b/i.test(text);
  // A product name ("TermGuard", "CareCash"): it may be a policy known only from a screenshot or an upload that couldn't be read.
  const productNamed = /\b[A-Z][a-z]+[A-Z][a-zA-Z]+\d*\b/.test(text);
  if (!heic && !retake && !unreadable && !roleAsked && !uploadsAsked && !scanAsked && !pageAskedEarly && !(followUp && prior) && !figureAsked.length
    && !/\bclaim\w*\b/i.test(text) && !attributeAsked && !whoAsked && !productNamed && !earlierYearAsked(text) && !priorAsk && !/\binsur(?:e[sd]?|er|ing)\b/i.test(text)) return null;

  const docs = await loadDocuments(args.accountId);
  if (!docs.length && !heic) return null;
  // "How much will SilverShield pay for the knee claim?": a claim the household's claim decision names.
  if (!roleAsked && /\bclaim\w*\b/i.test(text)) {
    const decisions = docs.filter((d) => d.role === "claim_decision" && d.status === "ready");
    if (decisions.length) {
      const pages = await pagesOf(args.accountId, decisions.map((d) => d.id));
      const distinctive = [...wordsOf(text)].filter((w) => w.length >= 4 && !/^(?:claim|insur|plan|polic|much|cover|shield|silvershield|merlion|mama|papa|what|will|does)/.test(w));
      if (decisions.some((d) => (pages.get(d.id) ?? []).some((p) => distinctive.some((w) => wordsOf(p.text).has(w))))) roleAsked = "claim_decision";
    }
  }
  // "Will Papa pay S$2,736 this year?": a figure only a letter, bill or claim decision prints is asked about that paper.
  if (!roleAsked && figureAsked.length) {
    const papers = docs.filter((d) => d.status === "ready" && NON_COVER_ROLES.has(d.role ?? "") && d.role !== "personal_notes");
    const pages = await pagesOf(args.accountId, papers.map((d) => d.id));
    const prints = (d: Doc) => (pages.get(d.id) ?? []).some((p) => figureAsked.some((v) => new RegExp("(?:S\\$|SGD\\s?)?" + v.toLocaleString("en-US").replace(/\./g, "\\.") + "(?:\\.00)?(?![\\d,])").test(p.text)));
    const hit = papers.find(prints);
    if (hit) roleAsked = hit.role as CorrespondenceRole;
  }
  // Who the question is about, when it names someone (or a kinship word); otherwise the whole household.
  const named = householdPersonFromWords(text, args.family);
  const nameHit = args.family.filter((p) => new RegExp("\\b(?:" + [p.display_name, p.preferred_name].filter(Boolean).map((n) => n!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")\\b", "i").test(text));
  const person = named?.status === "resolved" ? named.person : nameHit.length === 1 ? nameHit[0] : /\b(?:my|mine|me|i)\b/i.test(text) && !/\b(?:my|our)\s+(?:mum|mom|mother|mama|dad|father|papa|parents?|son|daughter|wife|husband)\b/i.test(text) && args.current && isSelf(args.current) ? args.current : null;
  const whose = (p: ClaimPerson | null) => !p ? "your household’s" : isSelf(p) ? "your" : personName(p) + "’s";
  const ownerOf = (d: Doc) => args.family.find((p) => d.owners.includes(p.id)) ?? null;
  const forPerson = (d: Doc) => !person || d.owners.includes(person.id);
  // Files the question names (by file name, or a distinctive word of it).
  const fileWords = (d: Doc) => d.file.replace(/\.[a-z0-9]+$/i, "").split(/[^A-Za-z0-9]+/).filter((w) => w.length >= 5 && !/^(?:schedule|policy|photo|scan|final|notes|document|insurance|2026|2025|bundle)$/i.test(w));
  const namedFiles = docs.filter((d) => text.toLowerCase().includes(d.file.toLowerCase()) || fileWords(d).some((w) => new RegExp("\\b" + w + "\\b", "i").test(text)));
  const done = (summary: string, details: string[], citations: ChatCitation[], personId: string | null, patch: Partial<ConversationState>, nextSteps: string[] = []): DocumentAnswer =>
    ({ summary, details, nextSteps, citations, personId, patch });

  // ---- an iPhone HEIC photo: never accepted, so it is not on file at all
  if (heic) return done("Photos an iPhone saves in HEIC format can’t be uploaded yet, so that photo never reached DearPolicy — there is nothing on file from it. Share or export the photo as a JPEG (on the iPhone, Settings › Camera › Formats › Most Compatible makes new photos JPEG), or save the page as a PDF, and upload that.",
    [], [], person?.id ?? null, { documents: { kind: "unreadable", ids: [] } });
  // ---- how to take the photo again
  if (retake && !roleAsked) {
    const photos = docs.filter((d) => unusableKind(d) === "photo" && forPerson(d));
    return done("To get a photo DearPolicy can read: " + PHOTO_TIPS + ". Take one photo per page, and if the insurer sent a PDF, uploading that is better still." + (photos.length ? " Then upload it in place of " + listOf(photos.map((d) => q(d.file))) + "." : ""),
      [], [], person?.id ?? null, { documents: { kind: "unreadable", ids: photos.map((d) => d.id) } });
  }
  // ---- what could not be read, and why
  if (unreadable && !(roleAsked && !/\b(?:read|open|password|locked|damaged|blurr\w*|handwrit\w*|upload\w*)\b/i.test(text))) {
    let wanted = namedFiles.filter((d) => unusableKind(d));
    // "the blurry CareCash photo": the file the question names most closely ("CareCash" alone names two).
    const closeness = (d: Doc) => fileWords(d).filter((w) => new RegExp("\\b" + w + "\\b", "i").test(text)).length
      + (/\bphoto|picture\b/i.test(text) && /\.(?:jpe?g|png|heic|webp)$/i.test(d.file) ? 1 : 0) + (/\bpdf\b/i.test(text) && /\.pdf$/i.test(d.file) ? 1 : 0);
    if (wanted.length > 1) { const top = Math.max(...wanted.map(closeness)); wanted = wanted.filter((d) => closeness(d) === top); }
    const want = (re: RegExp, kinds: Unusable[]) => { if (!wanted.length && re.test(text)) wanted = docs.filter((d) => kinds.includes(unusableKind(d)!) && forPerson(d)); };
    want(/\bpassword|locked\b/i, ["password"]);
    want(/\bhandwrit/i, ["handwriting"]);
    want(/\bblurr|photo|picture\b/i, ["photo"]);
    want(/\bdamaged|corrupt|incomplete|renewal|pdf\b/i, ["incomplete", "unopenable", "scan", "password"]);
    if (!wanted.length && followUp && prior?.ids.length) {
      const before = docs.filter((d) => prior.ids.includes(d.id));
      wanted = before.filter((d) => namedFiles.includes(d) || (/\bphoto|picture\b/i.test(text) && /\.(?:jpe?g|png|heic|webp|tiff?)$/i.test(d.file)) || (/\bpdf\b/i.test(text) && /\.pdf$/i.test(d.file)));
    }
    const listing = !wanted.length;
    if (listing) wanted = docs.filter((d) => unusableKind(d) && unusableKind(d) !== "processing" && forPerson(d) && !d.superseded);
    if (/\bstill (?:being )?(?:read|processed|processing|loading)\b/i.test(text)) {
      const reading = docs.filter((d) => unusableKind(d) === "processing");
      return done(reading.length ? listOf(reading.map((d) => q(d.file))) + (reading.length === 1 ? " is" : " are") + " still being read. Ask again in a few minutes."
        : "No — every upload has finished. Of the " + docs.length + " uploads on file, " + docs.filter((d) => d.status === "ready").length + " were read and " + docs.filter((d) => d.status === "failed").length + " couldn’t be (ask “which documents couldn’t be read?” to see why and what to do).",
        [], [], null, { documents: { kind: "unreadable", ids: reading.map((d) => d.id) } });
    }
    if (!wanted.length) {
      const target = person ? whose(person).replace(/’s$/, "").replace(/^your$/, "you") : "your household";
      return done("Every document on file for " + target + " was read — none was locked, damaged or unreadable.", [], [], person?.id ?? null, { documents: { kind: "unreadable", ids: [] } });
    }
    const handwritten = wanted.filter((d) => unusableKind(d) === "handwriting");
    const pages = await pagesOf(args.accountId, handwritten.map((d) => d.id));
    const lines = wanted.map((d) => unusableLine(d, unusableKind(d)!, unusableKind(d) === "handwriting"
      ? (pages.get(d.id) ?? []).flatMap((p) => printedLines(p.text)).filter((l) => !/\[illegible\]/i.test(l)).slice(0, 3).map(flagUnclearFigures) : undefined));
    const lead = listing ? (wanted.length === 1 ? "One upload " + (person ? "for " + (isSelf(person) ? "you" : personName(person)) + " " : "") + "couldn’t be used:" : wanted.length + " uploads " + (person ? "for " + (isSelf(person) ? "you" : personName(person)) + " " : "") + "couldn’t be used:") : "";
    const owner = wanted.length === 1 ? ownerOf(wanted[0]) : person;
    return done(listing ? lead + " " + lines[0] : lines[0], listing ? lines.slice(1) : lines.slice(1), [], owner?.id ?? null, { documents: { kind: "unreadable", ids: wanted.map((d) => d.id) } });
  }
  // ---- "is it S$12,500?": a figure a scan printed unclearly is never confirmed as that figure
  if (figureAsked.length && !roleAsked) {
    const readDocs = docs.filter((d) => d.status === "ready" && (forPerson(d) || !person));
    const pages = await pagesOf(args.accountId, readDocs.map((d) => d.id));
    for (const d of readDocs) for (const p of pages.get(d.id) ?? []) for (const m of p.text.matchAll(/(?:S\$|SGD\s?|\$)\s?([0-9OoIl|][0-9OoIl|,]*(?:\.[0-9OoIl|]{1,2})?)(?![A-Za-z0-9])/g)) {
      const body = m[1];
      if (!/[OoIl|]/.test(body) || !/\d/.test(body)) continue;
      const clean = Number(body.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1").replace(/,/g, ""));
      const whole = body.split(".")[0], centsOnly = !/[OoIl|]/.test(whole);
      const hit = figureAsked.find((v) => v === clean || (centsOnly && Math.trunc(v) === Number(whole.replace(/,/g, ""))));
      if (hit == null) continue;
      const line = piecesOf(p.text).find((x) => x.includes(m[0])) ?? m[0];
      const owner = ownerOf(d);
      const earlier = d.superseded ? " (an earlier or duplicate upload, kept for reference)" : "";
      const summary = centsOnly
        ? q(d.file) + earlier + " prints S$" + whole + " with cents the scan shows unclearly (“" + body + "”), so the whole-dollar amount is S$" + whole + " and the cents can’t be read with certainty."
        : "I can’t confirm that amount from the documents: the scan of " + q(d.file) + earlier + " prints it unclearly (it shows “" + body + "”), so DearPolicy doesn’t use it as a figure.";
      return done(summary, quoted([{ line, page: p.page }]), cite(d, (d.product ?? d.file) + " (" + d.file + ")", [p.page]), owner?.id ?? person?.id ?? null,
        { documents: { kind: "uploads", ids: [d.id] } }, ["Check it against the paper copy, or ask the insurer to confirm the figure."]);
    }
    if (!uploadsAsked && !unreadable && !scanAsked) return null;
  }
  const policyDocs = docs.filter((d) => d.status === "ready" && !d.superseded && !NON_COVER_ROLES.has(d.role ?? "") && !/policy_wording|product_summary|brochure|benefit_guide/.test(d.role ?? "") && d.product);
  // ---- "does Novena Heights Hospital insure Papa?": the hospital on a bill is not an insurer
  if (!roleAsked && /\binsur(?:e[sd]?|er|ing)\b|\bcover(?:s|ed)?\b/i.test(text)) {
    const bills = docs.filter((d) => d.role === "medical_bill" && d.status === "ready");
    const billPages = await pagesOf(args.accountId, bills.map((d) => d.id));
    const issuer = (d: Doc) => (printedLines((billPages.get(d.id) ?? [])[0]?.text ?? "").find((l) => /\b(?:hospital|clinic|medical cent(?:re|er)|healthcare)\b/i.test(l)) ?? "").replace(/\s*\((?:fictitious|synthetic)[^)]*\)\s*/gi, " ").replace(/\s*(?:pte\.? ltd\.?|ltd\.?)\s*$/i, "").trim();
    const named = bills.find((d) => { const words = issuer(d).split(/\s+/).filter((w) => w.length >= 4 && !/^(?:hospital|clinic|medical|centre|center|healthcare)$/i.test(w)); return words.length > 0 && words.every((w) => new RegExp("\\b" + w + "\\b", "i").test(text)); });
    if (named) {
      const owner = ownerOf(named) ?? person;
      const cover = policyDocs.filter((d) => !owner || d.owners.includes(owner.id)).filter((d) => /shield|hospital|health|medical/i.test((d.product ?? "") + " " + (d.role ?? "")));
      const who = owner ? (isSelf(owner) ? "your" : personName(owner) + "’s") : "the";
      return done(issuer(named) + " is the hospital, not an insurer: " + q(named.file) + " is its bill for " + who + " stay, not a policy, so it adds no cover."
        + (cover.length ? " " + (who === "your" ? "Your" : who.replace(/^./, (c) => c.toUpperCase())) + " hospital cover on file is " + listOf([...new Set(cover.map((d) => d.product!))]) + "." : ""),
        [], [], owner?.id ?? null, { documents: { kind: "correspondence", role: "medical_bill", ids: [named.id] } });
    }
  }
  // ---- "who does SeniorGuard cover?" (and "and the whole life?" after it): the people each policy names
  const productHit = (d: Doc, t: string) => (d.product ?? "").split(/[^A-Za-z]+/).filter((w) => w.length >= 4 && !/^(?:plan|policy|insurance|annual|personal)$/i.test(w)).some((w) => new RegExp("\\b" + w + "\\b", "i").test(t));
  const whoTarget = whoAsked ? policyDocs.filter((d) => productHit(d, text)) : prior?.kind === "who" && followUp ? policyDocs.filter((d) => productHit(d, text) || (/\btravel\b/i.test(text) && /travel/i.test(d.product ?? "")) || (/\blife\b/i.test(text) && /\blife\b/i.test(d.product ?? ""))) : [];
  if (whoTarget.length) {
    const byProduct = new Map<string, Doc[]>();
    for (const d of whoTarget) byProduct.set(d.product!, [...(byProduct.get(d.product!) ?? []), d]);
    const lines = [...byProduct].map(([product, ds]) => {
      const owners = [...new Set(ds.flatMap((d) => d.owners))].map((id) => args.family.find((p) => p.id === id)).filter((p): p is ClaimPerson => !!p);
      return product + " covers " + listOf(owners.map((p) => isSelf(p) ? "you" : personName(p) + " (" + p.display_name + ")")) + ", going by " + (ds.length === 1 ? q(ds[0].file) : "its documents") + ".";
    });
    const owners = [...new Set(whoTarget.flatMap((d) => d.owners))];
    // "Is Papa covered by SeniorGuard?": yes or no for the person asked about, then who it covers.
    const yesNo = !!person && /^\s*(?:is|are)\b/i.test(text) && byProduct.size === 1;
    if (yesNo) lines[0] = (owners.includes(person!.id) ? "Yes — " : "No — ") + lines[0];
    return done(lines[0], lines.slice(1), [], yesNo ? person!.id : owners.length === 1 ? owners[0] : null, { documents: { kind: "who", ids: whoTarget.map((d) => d.id) } });
  }
  // ---- an attribute a schedule or statement prints on a line of its own (policy number, nominee, loan, bonus, premium term)
  if (attributeAsked && !roleAsked) {
    const printed = await printedLinesAnswer({ accountId: args.accountId, question: text, people: person ? [person] : args.subjects?.length ? args.subjects : args.current ? [args.current] : [], family: args.family, attribute: true, topic: args.state.activeQuery ?? null });
    if (printed) return done(printed.summary, printed.details, printed.citations, printed.personId, { documents: { kind: "uploads", ids: [] } });
  }
  // ---- a policy known only from an app screenshot, or from an upload that couldn't be read
  const knownOnly = docs.filter((d) => forPerson(d) && ((d.role === "app_screenshot" && d.status === "ready") || (unusableKind(d) && !["handwriting", "processing"].includes(unusableKind(d)!))));
  const policyWords = (d: Doc) => [...(d.product ?? "").split(/[^A-Za-z]+/), ...d.file.replace(/\.[a-z0-9]+$/i, "").split(/[^A-Za-z]+/)]
    .filter((w) => w.length >= 5 && !/^(?:schedule|policy|locked|damaged|photo|blurry|screenshot|renewal|merlionapp|insurance|notes|scan|statement|certificate)$/i.test(w));
  const priorOnly = prior && text.split(/\s+/).length <= 10 && /\b(?:premium|sum assured|cover|due|how much|from the policy)\b/i.test(text) ? knownOnly.filter((d) => prior.ids.includes(d.id) || (d.role === "app_screenshot" && prior.ids.some((id) => { const x = docs.find((y) => y.id === id); return !!x && (policyWords(x).some((w) => policyWords(d).includes(w)) || (unusableKind(x) === "password" && x.owners.some((o) => d.owners.includes(o)))); }))) : [];
  // A policy also on file as a readable document (the CareCash schedule beside its damaged renewal) is answered from that document.
  const readableCopy = (h: Doc) => docs.some((d) => d.status === "ready" && !d.superseded && !NON_COVER_ROLES.has(d.role ?? "") && d.role !== "app_screenshot"
    && ((!!h.product && d.product === h.product) || policyWords(h).some((w) => policyWords(d).some((x) => x.toLowerCase() === w.toLowerCase()))));
  const onlyHits = roleAsked ? [] : [...new Set([...knownOnly.filter((d) => policyWords(d).some((w) => new RegExp("\\b" + w + "\\b", "i").test(text))), ...priorOnly])].filter((d) => !readableCopy(d));
  if (onlyHits.length) {
    const shots = onlyHits.filter((d) => d.role === "app_screenshot");
    const pages = await pagesOf(args.accountId, shots.map((d) => d.id));
    const details: string[] = [], citations: ChatCitation[] = [];
    for (const d of onlyHits.filter((x) => x.role !== "app_screenshot")) details.push(unusableLine(d, unusableKind(d)!));
    for (const d of shots) {
      const lines = bestLines(pages.get(d.id) ?? [], text, { limit: 3, always: [/\bsum assured|next premium|in force\b/i] });
      const shown = lines.length ? lines : bestLines(pages.get(d.id) ?? [], "", { limit: 3, always: [/\bsum assured|next premium|in force\b/i], min: 2 });
      details.push(q(d.file) + " is a screenshot of " + (cleanInsurer(d.insurer) ? cleanInsurer(d.insurer) + "’s" : "the insurer’s") + " app — a summary from the app, not a policy document — and shows: " + shown.map((l) => "“" + flagUnclearFigures(l.line) + "” (page " + l.page + ")").join("; ") + ".");
      citations.push(...cite(d, "the app screenshot (" + d.file + ")", shown.map((l) => l.page)));
    }
    const name = onlyHits.find((d) => d.product)?.product ?? policyWords(onlyHits[0])[0];
    return done("DearPolicy has no readable policy document for " + name + " yet, so it can’t confirm its cover from the policy itself. Here is what is on file:", details, citations,
      ownerOf(onlyHits[0])?.id ?? person?.id ?? null, { documents: { kind: "unreadable", ids: onlyHits.map((d) => d.id) } }, ["Upload the policy schedule (with its password, if it has one) and DearPolicy will read it."]);
  }
  // ---- the bill, against the cover: what the bill says, what the insurer decided on it, and the plan's own terms
  if (roleAsked === "medical_bill" && /\b(?:cover\w*|pay\w*|claim\w*|insur\w*)\b/i.test(text) && !/\bowe\b/i.test(text)) {
    const bills = docs.filter((d) => d.role === "medical_bill" && d.status === "ready" && forPerson(d));
    const bill = bills[0] ?? docs.find((d) => d.role === "medical_bill" && d.status === "ready");
    if (bill) {
      const owner = ownerOf(bill);
      const decision = docs.find((d) => d.role === "claim_decision" && d.status === "ready" && (!owner || d.owners.includes(owner.id)));
      const pages = await pagesOf(args.accountId, [bill.id, ...(decision ? [decision.id] : [])]);
      const billLines = bestLines(pages.get(bill.id) ?? [], "what is the total amount payable by patient", { limit: 1, always: [/^amount payable by (?:the )?patient|^total charges:/i] });
      const decisionLines = decision ? bestLines(pages.get(decision.id) ?? [], "why was it rejected reason unable to admit", { limit: 2 }).filter((l) => !/S\$\s?0(?:\.00)?\b(?![\d,])/.test(l.line)) : [];
      let plan: { details: string[]; citations: ChatCitation[] } = { details: [], citations: [] };
      if (owner) try {
        const { answerPolicyQuestion } = await import("./policy-answer");
        const r = await answerPolicyQuestion({ accountId: args.accountId, question: "what is the deductible and co-insurance on the hospital plan?", people: [owner] });
        plan = { details: r.answer.details.filter((d) => /\b(?:deductible|co-?insurance|co-?pay\w*)\b/i.test(d)).slice(0, 3), citations: r.answer.citations };
      } catch { /* the bill and the decision still stand */ }
      const insurer = decision ? cleanInsurer(decision.insurer) : null;
      const summary = "A bill isn’t cover: what a plan pays towards it is decided on the claim." + (decision ? " " + (insurer ?? "The insurer") + " declined the claim for this stay (" + q(decision.file) + "), so the plan isn’t paying towards this bill unless that decision changes on review." : "")
        + (plan.details.length ? " For an eligible stay, the plan pays after the deductible and co-insurance below." : "");
      return done(summary, [...quoted(billLines).map((l) => "Bill: " + l), ...quoted(decisionLines).map((l) => "Decision: " + l), ...plan.details],
        [...cite(bill, "the hospital bill (" + bill.file + ")", billLines.map((l) => l.page)), ...(decision ? cite(decision, "the claim decision (" + decision.file + ")", decisionLines.map((l) => l.page)) : []), ...plan.citations],
        owner?.id ?? person?.id ?? null, { documents: { kind: "correspondence", role: "medical_bill", ids: [bill.id] } });
    }
  }
  // ---- a paper that is not a policy: what it says, said for what it is
  if (roleAsked) {
    const notesCheck = roleAsked === "personal_notes" && /\b(?:right|correct|wrong|true|accurate|is that)\b/i.test(text);
    let candidates = docs.filter((d) => d.role === roleAsked && d.status === "ready" && forPerson(d));
    if (!candidates.length && person) candidates = docs.filter((d) => d.role === roleAsked && d.status === "ready");
    if (!candidates.length) return null;
    // "My notes say Papa's deductible is S$3,000 - is that right?", "so my notes are wrong?": the notes' line
    // beside what the insurer's document prints -- the document is what counts.
    if (notesCheck) {
      const own = text.replace(/\b(?:my|our|the) (?:own )?notes?\b|\bnotes? say\b|\b(?:so|is that|are they|right|correct|wrong|true|accurate)\b/gi, " ");
      const topicText = wordsOf(own).size >= 2 ? own : args.state.activeQuery ?? own;
      const notePages = await pagesOf(args.accountId, candidates.map((d) => d.id));
      const figureLine = (d: Doc) => bestLines(notePages.get(d.id) ?? [], topicText, { limit: 3 }).filter((l) => /\d/.test(l.line)).slice(0, 1);
      // The family's notes are about everyone in it, whoever they were uploaded for.
      const allNotes = docs.filter((d) => d.role === "personal_notes" && d.status === "ready");
      for (const [id, pg] of await pagesOf(args.accountId, allNotes.filter((d) => !notePages.has(d.id)).map((d) => d.id))) notePages.set(id, pg);
      const noteDoc = [...candidates, ...allNotes.filter((d) => !candidates.includes(d))].find((d) => figureLine(d).length) ?? null;
      const noteLine = noteDoc ? figureLine(noteDoc) : [];
      const namedNow = args.family.filter((p) => [p.display_name, p.preferred_name].some((n) => !!n && new RegExp("\\b" + n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(topicText)));
      const subject = person && !isSelf(person) ? [person] : namedNow.length === 1 ? namedNow : args.subjects ?? [];
      // What the document prints about the thing, not about the figure the notes give.
      const printed = await printedLinesAnswer({ accountId: args.accountId, question: topicText.replace(/(?:S\$|SGD\s?|\$)\s?\d[\d,.]*/g, " "), people: subject, family: args.family, min: 1 });
      if (!noteDoc || !noteLine.length || !printed) return null;
      return done("Your notes (" + q(noteDoc.file) + ") say " + quoted(noteLine)[0].replace(/ \(page \d+\)\.$/, "") + " — but they are your own notes, not the insurer’s. " + printed.summary.replace(/ prints about that:$/, " prints:"),
        printed.details, printed.citations, printed.personId,
        { documents: { kind: "correspondence", role: "personal_notes", ids: [noteDoc.id] } }, ["Where your notes and the insurer’s document differ, go by the document — and update your notes."]);
    }
    const pages = await pagesOf(args.accountId, candidates.map((d) => d.id));
    // The paper that best fits the question.
    const scoredDocs = candidates.map((d) => ({ d, lines: bestLines(pages.get(d.id) ?? [], text, { limit: 5 }) })).sort((a, b) => (b.lines[0]?.score ?? 0) - (a.lines[0]?.score ?? 0));
    const best = scoredDocs[0];
    const d = best.d, owner = ownerOf(d);
    const ownerWords = owner ? (isSelf(owner) ? "your" : personName(owner) + "’s") : "the";
    const insurer = cleanInsurer(d.insurer);
    const docPages = pages.get(d.id) ?? [];
    const always: Record<CorrespondenceRole, RegExp[]> = {
      claim_decision: [/\b(?:unable to admit|reason:|remains in force)\b/i],
      insurer_letter: [/\b(?:will increase|will be withdrawn|will end|from 1 April|does not change)\b/i],
      medical_bill: [/^total charges:|^amount payable by (?:the )?patient/i],
      app_screenshot: [/\bsum assured|next premium|in force\b/i],
      personal_notes: [],
    };
    const zero = (l: { line: string }) => /S\$\s?0(?:\.00)?\b(?![\d,])/.test(l.line);
    const picked = bestLines(docPages, text, { limit: roleAsked === "medical_bill" || roleAsked === "app_screenshot" ? 3 : 4, always: always[roleAsked] }).filter((l) => !zero(l));
    // Round 11: "how much was the bill?" is the bill's total, whatever single charge the question's other words match.
    if (roleAsked === "medical_bill" && /\bhow much\b|\btotal\b|\bamount\b|\bcost\b/i.test(text) && !picked.some((l) => /total charges|amount payable/i.test(l.line))) {
      const total = bestLines(docPages, "total charges amount payable by patient", { limit: 4 }).filter((l) => /(?:^|— )(?:total charges|amount payable by (?:the )?patient):/i.test(l.line) && !zero(l)).slice(0, 1);
      picked.unshift(...total);
    }
    const lines = picked.length ? picked : bestLines(docPages, "", { limit: 3, always: always[roleAsked], min: 2 }).filter((l) => !zero(l));
    // A decision that pays nothing says so in words (a zero amount reads as a fault).
    const paysNothing = roleAsked === "claim_decision" && docPages.some((p) => /amount (?:payable|approved)\W+S\$\s?0(?:\.00)?\b/i.test(p.text.replace(/\t/g, " ")));
    const label = roleAsked === "insurer_letter" ? (insurer ? insurer + "’s letter" : "the insurer’s letter") : roleAsked === "claim_decision" ? (insurer ? insurer + "’s claim decision" : "the claim decision")
      : roleAsked === "medical_bill" ? "the hospital bill" : roleAsked === "app_screenshot" ? "the app screenshot" : "your own notes";
    const lead: Record<CorrespondenceRole, string> = {
      insurer_letter: "Here is what " + (insurer ? insurer + "’s" : "the insurer’s") + " letter " + q(d.file) + " says" + (owner ? " to " + (isSelf(owner) ? "you" : personName(owner)) : "") + ". It is a letter, not a policy: it tells you about a change, it doesn’t add or confirm cover.",
      claim_decision: "Here is what " + (insurer ? insurer + "’s" : "the insurer’s") + " decision on " + ownerWords + " claim, " + q(d.file) + ", says" + (paysNothing ? " — it declined the claim and is paying nothing on it" : "") + ". Only the insurer decides a claim; you can ask it to review the decision.",
      medical_bill: "Here is what " + ownerWords + " hospital bill " + q(d.file) + " shows. A bill lists charges; it isn’t cover, and what a plan pays towards it is decided on the claim.",
      app_screenshot: q(d.file) + " is a screenshot of " + (insurer ? insurer + "’s" : "the insurer’s") + " app — a summary from the app, not a policy document, so its figures aren’t treated as confirmed cover. It shows:",
      personal_notes: q(d.file) + " is " + (owner && isSelf(owner) ? "your" : "the family’s") + " own notes, not a document from the insurer, so DearPolicy never uses it as a policy fact" + (/handwrit/i.test(d.message ?? "") ? "; it is handwritten and only parts of it could be read" : "") + ". It says:",
    };
    const extra: string[] = [];
    // A screenshot standing in for a policy document that couldn't be read: say so.
    if (roleAsked === "app_screenshot") for (const locked of docs.filter((x) => unusableKind(x) === "password" && x.owners.some((o) => d.owners.includes(o))))
      extra.push("The policy document itself, " + q(locked.file) + ", is locked with a password — upload it again with its password and DearPolicy will read the schedule to confirm.");
    return done(lead[roleAsked], [...quoted(lines), ...extra], cite(d, label + " (" + d.file + ")", lines.map((l) => l.page)), owner?.id ?? person?.id ?? null,
      { documents: { kind: "correspondence", role: roleAsked, ids: [d.id] } });
  }
  // ---- "can you read Mama's scanned CI policy?": how a document was read
  if (scanAsked && !uploadsAsked) {
    const target = (namedFiles.length ? namedFiles : docs.filter((d) => forPerson(d) && d.status === "ready" && /\b(?:scan|photo|ocr|sideways|upside|unclear|turned|out of order)\b/i.test(d.message ?? "") && (!/\bscan/i.test(text) || /scan/i.test(d.message ?? ""))))
      .filter((d) => !d.superseded);
    if (!target.length) return null;
    const lines = target.slice(0, 3).map((d) => howRead(d));
    const cited = target.slice(0, 3).flatMap((d) => cite(d, (d.product ?? d.file) + " (" + d.file + ")", [1]));
    return done(lines[0], lines.slice(1), cited, ownerOf(target[0])?.id ?? person?.id ?? null, { documents: { kind: "uploads", ids: target.map((d) => d.id) } });
  }
  // ---- "what's printed on page 2 of Mama's scanned CI policy?": that page, as read
  const pageAsked = text.match(/\bpage\s+(\d{1,3})\b/i);
  if (pageAsked) {
    const n = Number(pageAsked[1]);
    const words = (d: Doc) => [...(d.product ?? "").split(/[^A-Za-z0-9]+/), ...fileWords(d)].filter((w) => w.length >= 4 && !/^(?:plan|policy|insurance|schedule)$/i.test(w));
    const named = docs.filter((d) => d.status === "ready" && !d.superseded && forPerson(d) && (namedFiles.includes(d) || words(d).some((w) => new RegExp("\\b" + w + "\\b", "i").test(text))
      || (/\bscan\w*\b/i.test(text) && /scan|sideways|upside|unclear/i.test((d.message ?? "") + " " + d.notes.join(" ")) && (!/\b(?:ci|critical)\b/i.test(text) || /critical/i.test(d.product ?? "")))));
    if (named.length === 1) {
      const d = named[0];
      const page = (await pagesOf(args.accountId, [d.id])).get(d.id)?.find((p) => p.page === n);
      if (page) {
        const lines = piecesOf(page.text).slice(0, 8).map((l) => "“" + flagUnclearFigures(l) + "”");
        const turned = d.notes.some((x) => new RegExp("^Page " + n + " was (?:sideways|upside down)").test(x));
        return done("Page " + n + " of " + q(d.file) + (d.product ? " (" + d.product + ")" : "") + (turned ? " — photographed or scanned turned, and read after turning it upright —" : "") + " reads:", lines, cite(d, (d.product ?? d.file) + " (" + d.file + ")", [n]), ownerOf(d)?.id ?? null, { documents: { kind: "uploads", ids: [d.id] } });
      }
    }
  }
  // ---- "what was the premium last year?": the earlier year's schedule, said for what it is
  if (earlierYearAsked(text) && !uploadsAsked && !(followUp && prior?.kind === "uploads") && !roleAsked) {
    const printed = await printedLinesAnswer({ accountId: args.accountId, question: text, people: person ? [person] : args.subjects?.length ? args.subjects : args.current ? [args.current] : [], family: args.family });
    if (printed && /is an earlier schedule/.test(printed.summary)) return done(printed.summary, printed.details, printed.citations, printed.personId, { documents: { kind: "uploads", ids: [] } });
  }
  // ---- the uploads themselves
  if (uploadsAsked || (followUp && prior?.kind === "uploads")) return uploadsAnswer(text, docs, person, namedFiles, ownerOf);
  return null;
}

/** One sentence on how a document that needed help was read. */
function howRead(d: Doc): string {
  const notes = d.notes.join(" ");
  const bits: string[] = [];
  if (/sideways|upside down/i.test(notes)) bits.push("pages photographed or scanned sideways or upside down were turned upright to read them");
  if (/out of order/i.test(notes)) bits.push("its pages are out of order in the file and were read in their printed order");
  const unclear = [...notes.matchAll(/the scan prints “([^”]+)”, which can’t be read with certainty/g)].map((m) => m[1]);
  const settled = [...notes.matchAll(/the scan prints “([^”]+)”; DearPolicy read it as ([^ ]+) because/g)].map((m) => m[2].replace(/[.,]$/, ""));
  if (settled.length) bits.push((settled.length === 1 ? "one figure the scan prints unclearly was read as " : "figures the scan prints unclearly were read as ") + listOf(settled) + " because the document prints the same figure clearly elsewhere");
  if (unclear.length) bits.push("some figures can’t be read with certainty (" + unclear.map((u) => flagUnclearFigures(u)).join("; ") + "), so DearPolicy doesn’t use them — check those against the paper copy");
  return "Yes — DearPolicy read " + q(d.file) + (d.product ? " (" + d.product + ")" : "") + (bits.length ? ": " + bits.join("; ") + "." : ".");
}

function uploadsAnswer(text: string, docs: Doc[], person: ClaimPerson | null, namedFiles: Doc[], ownerOf: (d: Doc) => ClaimPerson | null): DocumentAnswer {
  const forPerson = (d: Doc) => !person || d.owners.includes(person.id);
  const who = (d: Doc) => { const o = ownerOf(d); return o ? (isSelf(o) ? "you" : personName(o)) : "your household"; };
  // Round 15: each upload listed is cited at its first page, as every other answer's documents are.
  const listed = (ids: string[]): ChatCitation[] => docs.filter((d) => ids.includes(d.id) && d.status === "ready").slice(0, 20)
    .map((d) => ({ chunkId: "page:" + d.id + ":1", policyId: d.id, policyName: d.product ?? d.file, ...(d.insurer ? { insurer: cleanInsurer(d.insurer) ?? undefined } : {}), pageStart: 1, pageEnd: 1, documentRole: d.role }));
  const done = (summary: string, details: string[], ids: string[], personId: string | null): DocumentAnswer => ({ summary, details, nextSteps: [], citations: listed(ids), personId, patch: { documents: { kind: "uploads", ids } } });
  const copies = docs.filter((d) => d.superseded && d.notes.some((n) => /^Same schedule as|^An earlier schedule/.test(n)));
  const describeCopy = (d: Doc) => {
    const note = d.notes.find((n) => /^Same schedule as|^An earlier schedule/.test(n)) ?? "";
    const keeper = note.match(/“([^”]+)”/)?.[1];
    return /^Same schedule/.test(note) ? q(d.file) + " is the same schedule as " + q(keeper ?? "the other upload") + " (a photo or scan of it), so DearPolicy keeps one: answers use " + q(keeper ?? "the other upload") + ", which reads more reliably."
      : q(d.file) + " is an earlier schedule of the same policy" + (note.match(/\(ending ([^)]+)\)/) ? ", which ended on " + note.match(/\(ending ([^)]+)\)/)![1] : "") + "; the current one is " + q(keeper ?? "the newer upload") + ", so answers use that. The earlier one is kept for reference.";
  };
  // Copies and earlier schedules: "which upload is the current schedule?", "is the photo the same as the PDF?"
  if ((/\b(?:same|twice|duplicate|copy|copies|current|latest|newest|which one|did you use|do you use|older|earlier|previous|both|and then)\b|\b20\d\d\b/i.test(text)
    || /\bphoto\b[^?]{0,60}\bpdf\b|\bpdf\b[^?]{0,60}\bphoto\b/i.test(text)) && copies.length) {
    const relevant = copies.filter((d) => forPerson(d) && (!namedFiles.length || namedFiles.some((n) => n.id === d.id || d.notes.some((x) => x.includes(n.file)))));
    let shown = relevant.length ? relevant : copies.filter(forPerson);
    // "and the 2025 photo?": the upload of that year.
    const year = text.match(/\b(20\d\d)\b/)?.[1];
    if (year && shown.some((d) => d.file.includes(year) || d.notes.some((n) => n.includes(year)))) shown = shown.filter((d) => d.file.includes(year) || d.notes.some((n) => n.includes(year)));
    if (shown.length) {
      const keeperFile = shown[0].notes.join(" ").match(/“([^”]+)”/)?.[1];
      const keeper = docs.find((d) => d.file === keeperFile);
      const lines = shown.map(describeCopy);
      const lead = keeper && /\bcurrent|latest|newest|which one|use\b/i.test(text) ? "The current schedule is " + q(keeper.file) + (keeper.product ? " (" + keeper.product + ")" : "") + ". " : "";
      return done(lead + lines[0], lines.slice(1), shown.map((d) => d.id), ownerOf(shown[0])?.id ?? null);
    }
  }
  // A file that held several policies.
  const parts = docs.filter((d) => / — part \d+ of \d+ \(pages /.test(d.file));
  const bundles = docs.filter((d) => d.notes.some((n) => /^This file holds \d+ separate policies/.test(n)));
  if (/bundle|\bseveral\b|\bthree\b|\bmultiple\b|more than one|\bin it\b|\bin (?:one|that|the) (?:pdf|file)\b|contain/i.test(text) && bundles.length) {
    const b = bundles.find((x) => namedFiles.some((n) => n.id === x.id)) ?? bundles[0];
    const base = b.file.replace(/\.pdf$/i, "");
    const mine = [b, ...parts.filter((p) => p.file.startsWith(base + " — part "))];
    const n = mine.length;
    const lines = mine.map((d) => (d.product ?? d.file) + " — for " + who(d) + (d === b ? " (pages " + (b.notes.join(" ").match(/pages (\d+–\d+) are read here/)?.[1] ?? "1") + " of the file)" : " (" + (d.file.match(/\((pages [^)]+)\)/)?.[1] ?? "") + ")") + ".");
    const count = n === 3 ? "three" : n === 2 ? "two" : String(n);
    // "Which policies were in it?": the policies first, then how they were read.
    const which = /\b(?:which|what)\b[^?]{0,20}\b(?:policies|plans|ones)\b/i.test(text);
    return done(which ? "These " + count + " policies were in " + q(b.file) + " — DearPolicy read each one on its own, as if they had been uploaded separately:"
      : q(b.file) + " held " + count + " separate policies, so DearPolicy read each one on its own, as if they had been uploaded separately:", lines, mine.map((d) => d.id), null);
  }
  // Pages out of order.
  const outOfOrder = docs.filter((d) => d.notes.some((n) => /out of order/i.test(n)) && forPerson(d));
  if (/\border\b|\bmixed\b|\bshuffl|\bsequence\b|\bpages?\b[^?]{0,40}\blike\b/i.test(text) && outOfOrder.length) {
    const d = namedFiles.find((x) => outOfOrder.includes(x)) ?? outOfOrder[0];
    const note = d.notes.find((n) => /out of order/i.test(n))!;
    return done(note.replace(/^The pages of this file/, "The pages of " + q(d.file)), [], [d.id], ownerOf(d)?.id ?? null);
  }
  // Which uploads are letters, bills, notes, screenshots -- and which are policies.
  const shown = docs.filter((d) => forPerson(d) && (!/\bmerlion\b/i.test(text) || /merlion/i.test((d.insurer ?? "") + " " + d.file)));
  const kind = (d: Doc) => NON_COVER_ROLES.has(d.role ?? "") ? ROLE_WORDS[d.role as CorrespondenceRole] : d.status !== "ready" ? "couldn’t be read" : d.superseded ? "a copy or earlier version" : /policy_wording|product_summary|benefit_guide|brochure/.test(d.role ?? "") ? "general policy wording" : /statement|receipt|renewal/.test(d.role ?? "") ? "a statement or notice" : "a policy";
  const lettersOnly = /\bletters?\b|\brather than\b|not (?:a )?polic/i.test(text);
  // Round 11: "the CareCash photo I uploaded": that upload, and what became of it -- not every file on record.
  const askedWords = (text.match(/[A-Za-z]{4,}/g) ?? []).map((w) => w.toLowerCase()).filter((w) => !/^(?:what|about|that|this|which|uploaded|upload|photo|picture|image|file|document|scan|from|with|have|does|policy|plan|insurance|mama|papa|your|their)$/.test(w));
  const photoAsked = /\b(?:photo|picture|pic|image|snap(?:shot)?)\b/i.test(text);
  const pointed = shown.filter((d) => askedWords.some((w) => (d.file + " " + (d.product ?? "")).toLowerCase().replace(/[^a-z]+/g, " ").split(" ").some((x) => x.length >= 4 && x.startsWith(w.slice(0, 6)))) && (!photoAsked || /\.(?:jpe?g|png|heic|webp)$/i.test(d.file)));
  if (!lettersOnly && pointed.length && pointed.length <= 3 && pointed.length < shown.length && !/\bwhich\b|\bfrom\b|\blist\b|\ball\b/i.test(text)) {
    const lines = pointed.map((d) => q(d.file) + " — " + kind(d) + (d.product && !NON_COVER_ROLES.has(d.role ?? "") ? " (" + d.product + ")" : "") + (person ? "" : ", for " + who(d)) + "." + (d.status !== "ready" && d.error ? " " + d.error : ""));
    return done(lines[0], lines.slice(1), pointed.map((d) => d.id), ownerOf(pointed[0])?.id ?? person?.id ?? null);
  }
  const list = (lettersOnly ? shown.filter((d) => NON_COVER_ROLES.has(d.role ?? "")) : shown);
  if (!list.length) return done("I couldn’t find uploads like that on file.", [], [], person?.id ?? null);
  const lines = list.map((d) => q(d.file) + " — " + kind(d) + (d.product && !NON_COVER_ROLES.has(d.role ?? "") ? " (" + d.product + ")" : "") + (person ? "" : ", for " + who(d)) + ".");
  const target = person ? (isSelf(person) ? "you" : personName(person)) : "your household";
  return done(lettersOnly ? "These uploads are letters, bills, screenshots or notes rather than policies, so none of them is counted as cover:" : list.length + " uploads are on file for " + target + ":", lines.slice(0, 20), list.map((d) => d.id), person?.id ?? null);
}

// ---------------------------------------------------------------------------
// Round 10: a plain question whose answer is printed on a line of the
// person's own documents (a small table of an e-statement, a column the
// schedule's table prints), when the answer would otherwise be "not found".
// ---------------------------------------------------------------------------
const GENERIC_WORDS = new Set("cover covered policy policies plan plans pay paid much insurance benefit benefits amount whole life many does still have has get".split(" ").map((w) => w.replace(/(?:ing|ed|es|s)$/, "")));
const PRODUCT_COMMON = /^(?:plan|policy|insurance|integrated|personal|accident|critical|illness|hospital|income|annual|travel|whole|life|shield|care)$/i;
const PRODUCT_COMMON_WORDS = ["plan", "policy", "insurance", "integrated", "personal", "annual", "whole", "life", "shield"];
/** Plan kinds a question names without the product's name ("Mama's CI plan", "the accident plan"). */
const PLAN_KINDS: [RegExp, RegExp][] = [
  [/\bci\b|critical illness/i, /critical illness/i],
  [/\baccident (?:plan|policy|cover)\b|\bpa (?:plan|policy|premium|cover)\b|\b(?:her|his|my|their|\w+[’']s) pa\b|personal accident/i, /accident/i],
  [/\bhospital (?:cash|income)\b/i, /hospital (?:cash|income)/i],
  [/\btravel\b/i, /travel/i],
  [/\bwhole life\b/i, /whole life/i],
  [/\bshield\b|\bhospital plan\b|\bintegrated\b/i, /shield|integrated/i],
];
/** "last year", "the 2025 schedule": an earlier year's schedule, kept for reference, is what is asked. */
export function earlierYearAsked(text: string, today = new Date()) {
  const year = today.getUTCFullYear();
  return /\blast year\b|\bprevious (?:year|schedule|policy year|period)\b|\bearlier schedule\b|\bold(?:er)? schedule\b/i.test(text)
    || [...text.matchAll(/\b(20\d\d)\b/g)].some((m) => Number(m[1]) < year && !/\b(?:since|from|until|till|to)\s+(?:\d{1,2}\s+\w+\s+)?20\d\d\b/i.test(text));
}
export async function printedLinesAnswer(args: { accountId: string; question: string; people: ClaimPerson[]; family: ClaimPerson[]; attribute?: boolean; topic?: string | null; min?: number; strict?: boolean }): Promise<{ summary: string; details: string[]; citations: ChatCitation[]; personId: string | null } | null> {
  const question = args.question.trim();
  if (!question || question.split(/\s+/).length > 30) return null;
  // Advice is not a line of a document.
  if (/\b(?:should (?:i|we)|is it worth|worth (?:it|keeping)|recommend|advi[cs]e)\b/i.test(question)) return null;
  // "CI" is how families say critical illness.
  // A person's own name is who is asked about, never what ("Wei Jie's deductible" is not a line naming Wei Jie).
  const nameParts = args.family.flatMap((p) => [p.display_name, p.preferred_name ?? "", ...p.display_name.split(/\s+/).filter((w) => w.length >= 3)]).filter((n) => n.trim().length >= 2)
    .sort((a, b) => b.length - a.length);
  const asked = nameParts.reduce((t, n) => t.replace(new RegExp("\\b" + n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?:['’]s)?\\b", "gi"), " "), question).replace(/\bCI\b/g, "critical illness");
  const namesSomeone = asked !== question.replace(/\bCI\b/g, "critical illness")
    || /\b(?:my|our|his|her|their)\s+(?:mum|mom|mother|mama|dad|father|papa|wife|husband|son|daughter|brother|sister|parents?|helper|maid|grand\w+)\b/i.test(question);
  const loaded = await loadDocuments(args.accountId);
  const usable = (d: Doc) => d.status === "ready" && !NON_COVER_ROLES.has(d.role ?? "") && !/policy_wording|product_summary|brochure/.test(d.role ?? "");
  const earlierOnes = earlierYearAsked(question) ? loaded.filter((d) => usable(d) && d.superseded && d.notes.some((n) => /^An earlier schedule/.test(n))) : [];
  const current = loaded.filter((d) => usable(d) && !d.superseded);
  const productWords = (d: Doc) => (d.product ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !PRODUCT_COMMON.test(w));
  const namesIn = (d: Doc, t: string) => productWords(d).some((w) => new RegExp("\\b" + w + "\\b", "i").test(t))
    || PLAN_KINDS.some(([asks, kind]) => asks.test(t) && kind.test(d.product ?? ""));
  const firstPerson = /\b(?:my|mine|i|me)\b/i.test(question);
  // An earlier year's schedule first when an earlier year is asked; the current documents otherwise ("the bonus added in 2024" is on this year's statement).
  const pick = async (all: Doc[]) => {
    const theirs = (people: ClaimPerson[]) => all.filter((d) => people.some((p) => d.owners.includes(p.id)));
    // A short follow-up ("policy number?") is about the plan the chat was on, when the question names none.
    const topic = args.topic && question.split(/\s+/).length <= 6 && !all.some((d) => namesIn(d, asked)) ? args.topic.replace(/\bCI\b/g, "critical illness") : null;
    const names = (d: Doc) => namesIn(d, asked) || (!!topic && namesIn(d, topic));
    const tryDocs = async (docs: Doc[]) => {
      if (!docs.length) return null;
      const pages = await pagesOf(args.accountId, docs.map((d) => d.id));
      const pool = docs.some(names) ? docs.filter(names) : docs;
      let best: { d: Doc; lines: ReturnType<typeof bestLines> } | null = null;
      for (const d of pool) {
        const own = new Set(productWords(d).map((w) => w.replace(/(?:ing|ed|es|s)$/, "")));
        const lines = bestLines(pages.get(d.id) ?? [], asked, { limit: 3, min: args.min ?? 1.5 }).filter((l) => l.hits.some((h) => !own.has(h) && !GENERIC_WORDS.has(h)));
        // The lines must say at least half of what the question turns on ("my CPF MediSave balance" is not a premium line that mentions MediSave).
        const { distinct, covered } = askedCoverage(asked, lines.flatMap((l) => l.hits), new Set([...GENERIC_WORDS, ...all.flatMap((x) => productWords(x).map((w) => w.replace(/(?:ing|ed|es|s)$/, "")))]
          .concat([...PRODUCT_COMMON_WORDS])));
        if (distinct.length && covered.length * 2 < distinct.length) continue;
        // In place of a reply that it can't help, the lines must say everything asked ("the bonus added in 2024"), never one word of it ("the weather").
        if (args.strict && (covered.length < 2 || covered.length < distinct.length)) continue;
        if (lines.length && (!best || Math.max(...lines.map((l) => l.score)) > Math.max(...best.lines.map((l) => l.score)))) best = { d, lines };
      }
      return best;
    };
    let found = await tryDocs(theirs(args.people).filter((d) => !all.some(names) || names(d) || !theirs(args.people).some(names)));
    // Nobody named and nothing of theirs answers it: the household's documents (the one the question names, if it names one).
    if (!found && !firstPerson && !namesSomeone) found = await tryDocs(all.some(names) ? all.filter(names) : all);
    return found;
  };
  const best = (earlierOnes.length ? await pick(earlierOnes) : null) ?? await pick(current);
  if (!best) return null;
  const owner = args.family.find((p) => best!.d.owners.includes(p.id)) ?? args.family.find((p) => p.id === best!.d.uploadedTo) ?? null;
  const whose = owner ? (isSelf(owner) ? "your" : personName(owner) + "’s") : "the";
  const what = best.d.role === "annual_statement" ? " statement" : best.d.role === "renewal_statement" ? " renewal notice" : "";
  const summary = best.d.superseded
    ? q(best.d.file) + " is an earlier schedule of " + whose + " " + (best.d.product ?? "policy") + ", kept for reference (answers about the current year use the newer one). For that earlier year it prints:"
    : "Here is what " + whose + " " + (best.d.product ?? q(best.d.file)) + what + " prints about that:";
  // Round 7 (port): a per-column table row says only the column asked (or this person's, on the household's own group plan), or is not quoted.
  const self = args.family.find((p) => /^self$/i.test(p.relationship ?? ""));
  const columns = args.people.length === 1 && self && best.d.owners.includes(self.id) ? columnsFor(args.people[0].relationship) : [];
  // Round 7 (port): a figure a later endorsement of the same policy replaced is not quoted from the older document as if current.
  const replaced = (await replacedFigures(args.accountId, [best.d.id]).catch(() => new Map())).get(best.d.id);
  const stale = (line: string) => !!replaced && [...line.matchAll(/(?:S\$|SGD\s?|US\$|USD\s?)\s?(\d[\d,]*(?:\.\d+)?)/gi)].some((m) => replaced.amounts.has(Number(m[1].replace(/,/g, ""))));
  const lines = best.lines.flatMap((l) => { const line = narrowToColumn(l.line, question, columns); return line && !stale(line) ? [{ ...l, line }] : []; });
  if (!lines.length) return null;
  best.lines = lines;
  return { summary, details: quoted(best.lines),
    citations: cite(best.d, (best.d.product ?? best.d.file) + " (" + best.d.file + ")", best.lines.map((l) => l.page)), personId: owner?.id ?? null };
}
/** Round 10: an answer that misses what was asked ("instead of the daily rate?", "early cancer" with no
 * amount) while a line of the person's own documents says it: that line, quoted. */
export async function printedRepair(args: { accountId: string; question: string; people: ClaimPerson[]; family: ClaimPerson[]; answerText: string; topic?: string | null }) {
  const said = wordsOf(args.answerText);
  const askedWords = [...wordsOf(args.question.replace(/\bCI\b/g, "critical illness"))].filter((w) => w.length >= 4 && !GENERIC_WORDS.has(w));
  const missing = askedWords.filter((w) => !said.has(w));
  const noFigures = !/(?:S\$|SGD)\s?\d|\d%/.test(args.answerText);
  if (!missing.length && !noFigures) return null;
  const printed = await printedLinesAnswer(args);
  if (!printed) return null;
  const helps = printed.details.some((d) => [...wordsOf(d)].some((w) => missing.includes(w)) || (noFigures && /(?:S\$|SGD)\s?\d|\d%/.test(d) && [...wordsOf(d)].some((w) => askedWords.includes(w))));
  return helps ? printed : null;
}

// ---------------------------------------------------------------------------
// Round 10: "is that from the policy?", "where did that come from?", "which page is that on?" --
// about the answer just given: which document, and which page, it came from. Answered directly
// from that answer's own citations (or the uploads it named), never by repeating it.
export const PROVENANCE_ASKED = /^\s*(?:(?:and|so|ok(?:ay)?|but|wait|hmm|sorry)[,\s]+)*(?:(?:is|was|did|does) (?:that|this|it|that answer|this answer|that figure|that amount|that number)\s+(?:(?:taken|read|copied|coming|come) )?(?:from|in|on|out of|based on)\s+(?:the |my |her |his |our |their |your |a |an )?(?:actual |real |own |insurer['’]s )?(?:policy|policies|policy document|document|schedule|contract|certificate|paperwork|pdf)\b|where (?:did|does|do) (?:that|this|it|you get that|you get this)(?: (?:come|came))?(?: from)?\b|which (?:document|page|file|policy)s? (?:is|was|did|does) (?:that|this|it)\b)[^?]{0,40}\??\s*$/i;

export async function provenanceAnswer(args: { accountId: string; conversationId: string | null | undefined; question: string }): Promise<DocumentAnswer | null> {
  const text = args.question.trim();
  if (!args.conversationId || !PROVENANCE_ASKED.test(text)) return null;
  const last = (await query<{ a: ChatAnswer | null }>(`SELECT last_answer AS a FROM chat_conversations WHERE account_id=$1 AND id::text=$2`, [args.accountId, args.conversationId]).catch(() => ({ rows: [] as { a: ChatAnswer | null }[] }))).rows[0]?.a;
  if (!last?.summary) return null;
  const docs = await loadDocuments(args.accountId);
  const byId = new Map(docs.map((d) => [d.id, d]));
  const isPolicy = (d: Doc) => !NON_COVER_ROLES.has(d.role ?? "") && d.role !== "app_screenshot";
  const what = (d: Doc) => d.role && d.role in ROLE_WORDS ? ROLE_WORDS[d.role as CorrespondenceRole].replace("'", "’") + ", not a policy document" : d.product ? "the " + d.product + " policy document" : "a policy document";
  const pageWords = (ps: number[]) => ps.length === 1 ? "page " + ps[0] : "pages " + listOf(ps.map(String));
  // The pages the answer cited, by document.
  const cited = new Map<string, number[]>();
  for (const c of last.citations ?? []) {
    if (!c.policyId || !byId.has(c.policyId) || c.pageStart == null) continue;
    const ps = cited.get(c.policyId) ?? cited.set(c.policyId, []).get(c.policyId)!;
    if (!ps.includes(c.pageStart)) ps.push(c.pageStart);
  }
  const asksPolicy = /\b(?:policy|policies|schedule|contract|certificate)\b/i.test(text) && /^\s*(?:(?:and|so|ok(?:ay)?|but|wait|hmm|sorry)[,\s]+)*(?:is|was|did|does)\b/i.test(text);
  const personId = last.resolvedFamilyMemberId ?? null;
  if (cited.size) {
    const used = [...cited].map(([id, ps]) => ({ d: byId.get(id)!, ps: ps.sort((x, y) => x - y) }));
    const all = used.every((u) => isPolicy(u.d)), none = used.every((u) => !isPolicy(u.d));
    const lead = asksPolicy ? (all ? "Yes — " : none ? "No — " : "Partly — ") : "";
    const parts = used.map((u) => q(u.d.file) + " (" + what(u.d) + "), " + pageWords(u.ps));
    const citations = used.flatMap((u) => cite(u.d, u.d.product ? u.d.product + " (" + u.d.file + ")" : u.d.file, u.ps));
    return { summary: lead + (lead ? "that" : "That") + " answer came from " + listOf(parts) + ".", details: [], nextSteps: [], citations, personId, patch: {} };
  }
  // No page was cited: the uploads the answer named, for what they are.
  const said = [last.summary, ...(last.details ?? [])].join("\n");
  const named = docs.filter((d) => said.includes(q(d.file)));
  const details: string[] = [], citations: ChatCitation[] = [];
  for (const d of named) {
    if (unusableKind(d)) { details.push(q(d.file) + " couldn’t be read, so nothing in that answer comes from it."); continue; }
    if (d.status !== "ready") continue;
    // An app screenshot is one page.
    const ps = d.role === "app_screenshot" ? [1] : [];
    details.push("It is based on " + q(d.file) + (ps.length ? ", " + pageWords(ps) : "") + " — " + what(d) + ".");
    citations.push(...cite(d, d.role === "app_screenshot" ? "the app screenshot (" + d.file + ")" : d.product ?? d.file, ps));
  }
  const fromPolicy = named.some((d) => isPolicy(d) && d.status === "ready" && !unusableKind(d));
  const summary = fromPolicy ? "That answer didn’t quote a page of any document; it said what is on file. These are the documents it named."
    : (asksPolicy ? "No — that" : "That") + " answer didn’t come from a policy document" + (details.length ? ". Here is what it was based on." : "; it said what is, and isn’t, on file, without quoting any page.");
  return { summary, details, nextSteps: [], citations, personId, patch: {} };
}
