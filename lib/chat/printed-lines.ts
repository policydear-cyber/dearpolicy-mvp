/**
 * Round 10: the lines a page prints, as a person reads them -- table rows with
 * each value under its own column heading (and the heading's currency when the
 * heading prints it: "Amount (S$)"), whole sentences, no page furniture -- and
 * the lines that answer a question, by the words they share with it. Plain
 * code; every line is quoted verbatim from its page. Used by
 * lib/chat/document-questions.ts and lib/chat/policy-answer.ts.
 */
import { cleanScannedLine, looksScanned } from "./scanned-text";
import { flagUnclearFigures, printedLines } from "@/lib/documents/messy";
// ---------------------------------------------------------------------------
// Lines from a paper, by what the question asks
// ---------------------------------------------------------------------------
const STOP = new Set("the a an and or of to in on at for is are was were be been it its this that what which who whom how why when where does do did can could would should will i me my we our us you your he his she her they them their papa mama dad mum mother father please tell say says said about there any from with as by".split(" "));
const SYNONYMS: [RegExp, string[]][] = [
  [/\breject\w*|declin\w*|turn\w* down|why\b/i, ["reason", "unable", "admit", "regret", "pre-existing", "preexisting"]],
  [/\bappeal\w*|disagree|won['’]?t change|review/i, ["appeal", "review", "fidrec", "disagree", "dissatisfied"]],
  [/\bcancel\w*|still (?:valid|active|covered)|in force|no (?:hospital )?cover|mean (?:he|she|papa|mama)? ?has no/i, ["force", "remains", "cancel"]],
  [/\bdeadline|by when|how long/i, ["within", "days", "before"]],
  [/\b(?:length|how long)\b[^?]*\btrip|\btrip\b[^?]*\b(?:length|how long)\b/i, ["duration", "maximum", "days"]],
  // Round 7 (port): "what documents for a claim?" is answered by the line listing them.
  [/\b(?:documents?|papers?|paperwork|what (?:do i|to) (?:need|submit|send|attach))\b/i, ["submit", "invoice", "invoices", "receipt", "receipts", "certificate", "report", "proof", "itemised", "bill", "bills", "form"]],
  // "what does TPD mean?": the definition the document prints.
  [/\bdefinition|\bdefined?\b|\bmean(?:s|ing)?\b|what counts as/i, ["means", "defined", "definition", "unable", "least"]],
  [/\bgoing up|increase\w*|rise|more|next (?:year|april)|from next/i, ["increase", "premium", "from", "2027"]],
  [/\breplace\w*|instead|switch/i, ["replacement", "switch", "care"]],
  [/\bowe|still (?:have to )?pay|due\b/i, ["payable", "due", "patient"]],
  [/\bhow much\b.*\bbill\b|\bbill\b.*\bhow much\b|\btotal\b/i, ["total", "charges", "payable"]],
  [/\bdays?\b.*\bhospital\b|\bhow long\b.*\b(?:hospital|ward)/i, ["admission", "discharge", "days"]],
  [/\bclaim (?:number|no)/i, ["claim", "number"]],
  [/\bclaimed?\b/i, ["claimed", "amount"]],
  [/\bwhen\b.*\bdiagnos/i, ["diagnosed"]],
  [/\bsum assured|life cover|how much cover/i, ["sum", "assured"]],
  [/\bnominee|who gets\b/i, ["nomination", "nominee", "share"]],
  [/\bborrow|loan/i, ["loan", "maximum", "outstanding"]],
  [/\bworth|surrender/i, ["surrender", "value", "total"]],
  [/\bpass(?:es)? away|\bdies?\b|\bdeath\b/i, ["death", "benefit", "total"]],
  [/\bpaid[- ]up|still pay|finish paying|stop paying|premium term/i, ["paid", "further", "premiums", "premium", "term", "fully"]],
  [/\bstart\w*|began|commence\w*/i, ["start", "date", "commencement"]],
  [/\bward\b/i, ["ward", "class"]],
  [/\b(?:a|per|each) day\b|\bdaily\b/i, ["daily", "day", "per"]],
  [/\bpaying now\b|\bpay(?:ing)? (?:at the moment|currently)\b|\bcurrent(?:ly)? pay|\bhow much (?:is|does) (?:he|she|it|papa|mama) pay/i, ["current", "premium", "annual"]],
  [/\bmedical (?:limit|cover|expenses?)\b|\btravel medical\b/i, ["medical", "expenses", "overseas"]],
  [/\bicu\b|intensive care/i, ["intensive", "care", "unit", "maximum"]],
  [/\bhow many (?:days|conditions)|maximum days|per admission/i, ["maximum", "days", "admission", "conditions"]],
  [/\bwaiting period/i, ["waiting", "period"]],
  [/\bpolicy number|policy no\b/i, ["policy", "number"]],
  [/\bbonus/i, ["bonus", "reversionary", "terminal", "added"]],
  [/\bguaranteed/i, ["guaranteed"]],
  [/\btcm\b|chinese medicine/i, ["traditional", "chinese", "medicine"]],
  [/\bpremium\b.*\b(?:due|next)|next premium/i, ["next", "premium", "due"]],
];
/** How much of what a question asks the chosen lines say: each word the question turns on (`ignore`
 * holds the plan's and the people's own names) counts once, said outright or through its synonyms. */
export function askedCoverage(question: string, hits: Iterable<string>, ignore: Set<string> = new Set()) {
  const said = new Set(hits);
  const distinct = [...wordsOf(question)].filter((w) => !ignore.has(w) && !/^\d+$/.test(w));
  const covered = distinct.filter((w) => said.has(w) || SYNONYMS.some(([re, extra]) => re.test(question) && re.test(w) && extra.some((x) => said.has(x.replace(/(?:ing|ed|es|s)$/, "")))));
  return { distinct, covered };
}
export function wordsOf(s: string) {
  return new Set(s.toLowerCase().replace(/[’']s\b/g, "").split(/[^a-z0-9$-]+/).map((w) => w.replace(/^-+|-+$/g, "")).filter((w) => w.length > 2 && !STOP.has(w))
    .map((w) => w.replace(/(?:ing|ed|es|s)$/, "")));
}
const CURRENCY_HEAD = /^(?:(?:amount|value|total|bonus added)\s*)?\(?\s*(S\$|SG\$|SGD)\s*\)?$|\((S\$|SGD)\)\s*$/i;
/** Column headings that only say "the value is here" (they add nothing to a row). */
const PLAIN_HEAD = /^(?:amount|value|limit|limits|amount payable|details?|benefit|item|s\$|sgd|\(s\$\))$/i;
/** A page as quotable pieces: table rows ("label: value", each value under
 * its column heading -- with the heading's currency when the heading prints
 * it, "Amount (S$)"), and whole sentences, without page furniture. A heading
 * row on its own says nothing and is not a piece. */
export function piecesOf(text: string): string[] {
  const lines = printedLines(text).filter((l) => !/synthetic test document|^page \d+( of \d+)?$/i.test(l));
  const out: string[] = [];
  let para = "", header: string[] | null = null;
  const flush = () => { if (para) out.push(...para.split(/(?<=[.!?])\s+(?=[A-Z(“"])/)); para = ""; };
  const money = (cell: string, head: string | undefined) => {
    const mark = head ? CURRENCY_HEAD.exec(head.trim()) : null;
    return mark && /^\d[\d,]*(?:\.\d{1,2})?$/.test(cell) ? (/SGD/i.test(mark[1] ?? mark[2] ?? "") ? "SGD " : "S$") + cell : cell;
  };
  const headName = (head: string | undefined) => (head ?? "").replace(/\s*\((?:S\$|SGD)\)\s*$/i, "").replace(/^(?:S\$|SGD)$/i, "").trim();
  for (const line of lines) {
    if (!line.includes("\t")) { header = null; para = para ? para + " " + line : line; if (/[.!?:]$/.test(line) || line.length < 60) flush(); continue; }
    flush();
    const cells = line.split("\t").map((c) => c.trim()).filter(Boolean);
    // A heading row: no figures in its value cells (a currency mark is not a figure).
    // A heading row: every value cell is a column heading ("Amount (S$)", "Share", "Annual premium from 1 April 2027").
    const noFigures = (c: string) => !/\d/.test(c.replace(/\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/g, ""));
    const short = (c: string) => c.replace(/\([^)]*\)/g, "").trim().split(/\s+/).length <= 6 && !/\bbirth\b/i.test(c);
    if (cells.length >= 2 && cells.slice(1).every((c) => c.length <= 70 && noFigures(c) && short(c) && !/[.;]$/.test(c)
      && /\b(?:amount|value|limits?|share|qty|quantity|rate|maximum|minimum|days?|premium|bonus|added|year|date|period|charges|percentage|payable|sum)\b|^\(?\s*(?:S\$|SGD)\s*\)?$/i.test(c))) { header = cells; continue; }
    // Round 11: a benefit table's own heading row ("Benefit · Private hospital · Restructured hospital (A ward) · Notes"):
    // each value then reads under its column's name, not as a run of unnamed cells.
    if (cells.length >= 3 && /^(?:benefits?|rider benefit|item|section|cover|event caused by an accident)(?:\s*\([^)]*\))?$/i.test(cells[0]) && cells.slice(1).every((c) => c.length <= 60 && !/(?:S\$|SGD|\d{2,}|%)/.test(c) && !/[.;]$/.test(c))) { header = cells; continue; }
    if (cells.length === 1) { out.push(cells[0]); continue; }
    if (cells.length === 2) {
      const h = header && header.length === 2 ? header : null;
      const named = h && !PLAIN_HEAD.test(h[1].trim()) && !CURRENCY_HEAD.test(h[1].trim()) ? headName(h[1]) : "";
      out.push((h && !PLAIN_HEAD.test(h[0].trim()) && h[0].length <= 30 ? h[0] + " — " : "") + cells[0] + ": " + (named ? named + " " : "") + money(cells[1], h?.[1]));
      continue;
    }
    if (header && header.length === cells.length) { out.push(cells[0] + ": " + cells.slice(1).map((c, i) => ({ c, h: header![i + 1] }))
      // A footnote number under "Notes" is a pointer to small print, not a value.
      .filter(({ c, h }) => !(/^notes?$/i.test(h.trim()) && /^\d+(?:,\s*\d+)*$/.test(c)))
      .map(({ c, h }) => (headName(h) && !PLAIN_HEAD.test(h.trim()) ? headName(h) + " " : "") + money(c, h)).join("; ")); continue; }
    out.push(cells.join(" · "));
  }
  flush();
  return out.map((p) => p.replace(/\s+/g, " ").trim()).filter((p) => p.length >= 6 && p.length <= 420);
}
/** "What did the letter say?": nothing in particular is asked, so the paper's key lines are what is wanted. */
const GENERIC_ASK = /^\s*(?:so\s+|and\s+|ok(?:ay)?,?\s+)?(?:what (?:did|does|do) (?:the |it |they |that |this |\w+['’]s )?(?:\w+ ){0,3}(?:say|said|tell|mean|show)|what(?:['’]s| is) in\b|read (?:me )?(?:the|that|it)|summar|what about the\b)/i;
export function bestLines(pages: { page: number; text: string }[], question: string, opts: { limit?: number; always?: RegExp[]; min?: number } = {}) {
  const asked = wordsOf(question);
  // A word printed on few lines tells more than one printed everywhere ("GST" beats "bill").
  const every = pages.flatMap((p) => piecesOf(p.text).map((piece) => wordsOf(piece)));
  const spread = (w: string) => every.filter((ws) => ws.has(w)).length || 1;
  const wantsFigure = /\bhow much\b|\bamount\b|\bfee\b|\bgst\b|\btotal\b|\bcost\b|\bvalue\b|\bworth\b|\bowe\b/i.test(question);
  for (const [re, extra] of SYNONYMS) if (re.test(question)) for (const w of extra) asked.add(w.replace(/(?:ing|ed|es|s)$/, ""));
  const scored: { line: string; page: number; score: number; order: number; hits: string[]; under?: string }[] = [];
  let order = 0;
  for (const p of pages) {
    // Round 7 (port): the exclusions heading a line sits under ("GENERAL EXCLUSIONS", "We will not pay for:").
    let heading: string | null = null;
    for (const piece of piecesOf(p.text)) {
    if (isTitle(piece) || /:\s*$/.test(piece)) { if (isTitle(piece) || EXCLUSION_HEAD.test(piece)) heading = isTitle(piece) || !heading || !EXCLUSION_HEAD.test(heading) ? piece.replace(/:\s*$/, "") : heading; }
    const under = heading && EXCLUSION_HEAD.test(heading) && !EXCLUSION_HEAD.test(piece) && piece !== heading ? heading : undefined;
    const w = wordsOf(piece);
    const hits = [...w].filter((x) => asked.has(x));
    let score = hits.length + hits.reduce((sum, h) => sum + 1 / spread(h), 0) / 2;
    if (wantsFigure && hits.length && /(?:S\$|SGD)\s?\d/.test(piece)) score += 0.75;
    if ((!question.trim() || GENERIC_ASK.test(question)) && opts.always?.some((re) => re.test(piece))) score += 2;
    scored.push({ line: piece, page: p.page, score, order: order++, hits, ...(under ? { under } : {}) });
    }
  }
  // A title on its own ("Policy loan", "WANDERER ANNUAL TRAVEL - CERTIFICATE OF INSURANCE") names a
  // section; it never answers a question while a line under it can.
  for (const s of scored) if (isTitle(s.line)) s.score -= 1;
  // Letterhead, addresses, sign-offs and a date on its own line answer nothing.
  for (const s of scored) if (FURNITURE.test(s.line)) s.score -= 2;
  const min = opts.min ?? 1;
  const asksPercent = /%|\bper ?cent|\brate\b|\bshare\b|\bco-?insurance\b|\bproportion\b/i.test(question);
  return scored.filter((s) => s.score >= min).sort((a, b) => b.score - a.score || a.order - b.order).slice(0, opts.limit ?? 4).sort((a, b) => a.order - b.order)
    .map((s) => asksPercent ? s : { ...s, line: withoutBarePercent(s.line) });
}
const isTitle = (piece: string) => !/[.!?:;]/.test(piece) && !/(?:S\$|SGD)\s?\d/.test(piece) && (piece.split(/\s+/).length <= 4 && !/\d/.test(piece) || piece === piece.toUpperCase());
const FURNITURE = /\((?:fictitious|synthetic)[^)]*\)\s*$|\bSingapore \d{6}\b|^(?:customer (?:care|service)|claims department|yours (?:sincerely|faithfully)|dear (?:mr|mrs|ms|mdm|dr|sir|madam)\b|tel(?:ephone)?\b|www\.)|^\d{1,2} (?:January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/i;
/** A percentage with nothing it is a percentage of ("GST 9%", "Share 100%", "bonus rate 1.6%")
 * says nothing on its own: a table row keeps its figures and loses that cell when
 * the question did not ask for a rate. A sentence ("co-insurance of 10%") is left whole. */
const BASED = /%\s*(?:of|on)\b|co-?insurance|co-?pay|pro-?ration|discount|no-claim|interest|return|assumed|premiums? paid|rider pays|you pay|a year|per (?:year|annum)/i;
export function withoutBarePercent(piece: string): string {
  if (!/\d%/.test(piece) || BASED.test(piece)) return piece;
  const at = piece.indexOf(": ");
  if (at < 0) return piece;
  const head = piece.slice(0, at).replace(/\s*\b\d+(?:\.\d+)?%/g, "").trim();
  const kept = piece.slice(at + 2).split(/;\s*/).filter((seg) => !/\d%/.test(seg) || /(?:S\$|SGD)\s?\d/.test(seg))
    .map((seg) => seg.replace(/\s*\b(?:rate\s+)?\d+(?:\.\d+)?%/g, "").trim()).filter(Boolean);
  return kept.length ? head + ": " + kept.join("; ") : head;
}
/** Round 7 (port): a row of a table with a column per member type or plan, narrowed to the column asked
 * ("Child room and board?" -> "Daily room & board (max 120 days) — Child: S$300"). A row whose columns are
 * not named, or none of whose columns is the one asked, is not quoted (null): it would show other columns'
 * figures as if they were the household's. Any other line is returned as it is. */
export function narrowToColumn(line: string, question: string, columns: string[] = []): string | null {
  const money = (t: string) => new Set(t.match(/(?:S\$|SGD\s?|US\$|USD\s?)\s?\d[\d,]*(?:\.\d+)?/gi) ?? []).size;
  const at = line.indexOf(": ");
  const cells = at > 0 ? line.slice(at + 2).split(/;\s*/) : [];
  // (Only columns per member type or plan: "Before / After", "Private / Restructured" rows are left as printed.)
  const named = cells.length >= 2 && cells.every((c) => /^(?:employee|spouse|child(?:ren)?|each child|member|dependants?|adult|plan [a-z0-9]{1,3})\s+(?:S\$|SGD|US\$|USD|\d|company|nil|covered|not covered|as charged)/i.test(c));
  if (named && money(line) >= 2) {
    // The column the question names comes first; the person's own column only when it names none.
    const asked = (question.toLowerCase().match(/\b(?:employee|spouse|wife|husband|child(?:ren)?|kids?|son|daughter|plan \w+|member)\b/g) ?? [])
      .map((w) => w.replace(/^(?:children|kids?|son|daughter)$/, "child").replace(/^(?:wife|husband)$/, "spouse"));
    const want = asked.length ? asked : columns.map((w) => w.toLowerCase());
    const pick = cells.find((c) => want.some((w) => c.toLowerCase().startsWith(w)));
    if (!pick) return null;
    const [, head, value] = pick.match(/^(.*?)\s+((?:S\$|SGD|US\$|USD|\d|company|nil|covered|not covered|as charged).*)$/i) ?? [];
    return head ? line.slice(0, at) + " — " + head + ": " + value : null;
  }
  if (/ · /.test(line) && money(line) >= 2) return null;
  return line;
}
/** The column a person's figures are in, by how they relate to the employee (member) of a group plan. */
export function columnsFor(relationship: string | null | undefined): string[] {
  const r = (relationship ?? "").toLowerCase();
  return /^(?:spouse|wife|husband)$/.test(r) ? ["spouse"] : /^(?:child|son|daughter)$/.test(r) ? ["child"] : r === "self" ? ["employee", "member"] : [];
}
const EXCLUSION_HEAD = /\bexclu\w*|\b(?:will|do|does) not (?:pay|cover)\b|\bnot covered\b/i;
export function quoted(lines: { line: string; page: number; under?: string }[]) {
  // "Loan outstanding: S$0.00" reads as nil: a zero is not an amount anyone is owed or paid.
  // Round 7 (port): a line OCR read from a scan is shown cleaned of the scanner's noise, and says so.
  return lines.flatMap((l) => { const scanned = looksScanned(l.line), line = scanned ? cleanScannedLine(l.line) : l.line; if (!line) return [];
    return ["“" + flagUnclearFigures(line.replace(/[.;\s]+$/, "")).replace(/:\s*(?:S\$|SGD\s?)0(?:\.00)?(?![\d.,])/g, ": nil") + "”" + (scanned ? " (read from a scanned page; check it against the original)" : "")
      + (l.under ? " — listed under “" + (l.under === l.under.toUpperCase() ? l.under.charAt(0) + l.under.slice(1).toLowerCase() : l.under) + "”" : "") + " (page " + l.page + ")."]; });
}
