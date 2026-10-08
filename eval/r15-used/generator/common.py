"""Shared helpers for the r15 held-out DearPolicy test set.

Builds PDFs with reportlab, extracts their text with `pdftotext -layout`,
verifies every manifest fact against the extracted page text, checks every
battery expectation is grounded in a verified fact, and writes:

  <HH>/manifest.json
  <HH>/battery.json
  <HH>/docs/<name>.pdf, <name>.pdf.b64, <name>.pdf.extracted.txt

Run any gen_h*.py; each prints "ALL FACTS VERIFIED" or exits non-zero.
"""
import base64
import datetime as dt
import json
import os
import re
import subprocess
import sys
import unicodedata

from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AS_OF = "2026-10-06"
TZ = "Asia/Singapore"
MON = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()
MONTH = ("January February March April May June July August September "
         "October November December").split()

BEHAVIOURS = {
    "answer": "Direct factual answer grounded in an uploaded document; must state the expected facts.",
    "compute": "Answer needs arithmetic or date reasoning over document facts (as-of 2026-10-06, Asia/Singapore); must state the computed figure(s).",
    "clarify": "Question is genuinely ambiguous (which person / which policy / missing key fact). Must ask a clarifying question and must NOT commit to one interpretation's figure.",
    "not_uploaded": "Asks about a policy/document the household has not uploaded. Must say it is not among the uploaded documents (and may suggest uploading); must not invent terms.",
    "not_covered": "The uploaded documents show the person/event is not covered (not named, excluded, not elected, wrong policy type). Must say so plainly.",
    "expired": "The relevant policy has expired / is not in force on the relevant date. Must say so with the end date.",
    "unreadable": "The relevant document could not be read (garbled / password protected). Must say it cannot be read and ask for a readable copy; must not invent contents.",
    "out_of_scope": "Not an insurance-document question (or asks for something the app cannot do). Brief polite redirect; no invented policy facts.",
    "advice_decline": "Asks for a personal recommendation (buy / surrender / switch / which is better for me). May give the relevant document facts but must not make the decision; suggests a licensed adviser or the insurer.",
    "claim_start": "User starts a claim. Must pick the right policy/person and ask the next single needed question (or state what is needed).",
    "claim_step": "Continuation of a claim flow; must use earlier turns, ask the next question or give the estimate when enough facts are in.",
    "correction": "User corrects an earlier fact (person, date, amount). Must update the answer to the corrected facts and drop the old figure.",
}


# ---------------------------------------------------------------- dates
def d(iso):
    return dt.date.fromisoformat(iso)


def dfmt(iso):
    x = d(iso)
    return f"{x.day:02d} {MON[x.month - 1]} {x.year}"


def date_alts(iso):
    x = d(iso)
    return [f"{x.day:02d} {MON[x.month-1]} {x.year}", f"{x.day} {MON[x.month-1]} {x.year}",
            f"{x.day} {MONTH[x.month-1]} {x.year}", f"{x.day:02d} {MONTH[x.month-1]} {x.year}",
            f"{MONTH[x.month-1]} {x.day}, {x.year}", f"{MON[x.month-1]} {x.day}, {x.year}",
            iso, f"{x.day}/{x.month}/{x.year}", f"{x.day:02d}/{x.month:02d}/{x.year}",
            f"{x.year}年{x.month}月{x.day}日"]


def days_between(a, b):
    return (d(b) - d(a)).days


def age_on(dob, on=AS_OF):
    b, o = d(dob), d(on)
    return o.year - b.year - ((o.month, o.day) < (b.month, b.day))


# ---------------------------------------------------------------- matching
NUMLIKE = re.compile(r"^(?:S\$|\$)?\d[\d,]*(?:\.\d+)?%?$")


def norm(s):
    s = unicodedata.normalize("NFKC", str(s)).replace("\u00a0", " ").lower()
    s = re.sub(r"(?<=\d),(?=\d{3}(?!\d))", "", s)          # thousand separators
    s = s.replace("s$", "$").replace("sgd ", "$").replace("sgd", "$")
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def match(text, token):
    """True if token appears in text. Numeric tokens use digit boundaries."""
    t = norm(text)
    k = norm(token)
    if NUMLIKE.match(token.strip()):
        num = k.lstrip("$").rstrip("%")
        pct = k.endswith("%")
        pat = r"(?<![\d.])" + re.escape(num) + r"(?:\.0+)?(?![\d])"
        if pct:
            pat += r"\s*(?:%|per ?cent)"
        return re.search(pat, t) is not None
    return k in t


def expand(group):
    """'a|b|@2026-07-01' -> list of alternatives (dates expanded)."""
    out = []
    for alt in group.split("|"):
        alt = alt.strip()
        if alt.startswith("@"):
            out.extend(date_alts(alt[1:]))
        elif alt:
            out.append(alt)
    return out


# ---------------------------------------------------------------- fonts
_CJK = None


def cjk_font():
    global _CJK
    if _CJK:
        return _CJK
    for path, idx in [("/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf", None),
                      ("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc", 0),
                      ("/usr/share/fonts/truetype/wqy/wqy-microhei.ttc", 0),
                      ("/usr/share/fonts/truetype/arphic/uming.ttc", 0)]:
        if os.path.exists(path):
            kw = {} if idx is None else {"subfontIndex": idx}
            pdfmetrics.registerFont(TTFont("CJK", path, **kw))
            _CJK = "CJK"
            return _CJK
    sys.exit("No TrueType CJK font found (install fonts-droid-fallback or fonts-wqy-zenhei)")


def has_cjk(s):
    return any(ord(ch) >= 0x2E80 for ch in s)


def runs(text, base):
    """Split text into (font, chunk) runs: CJK characters use the CJK font, everything else the base font.
    Keeps Latin digits/letters in a standard font so extraction does not depend on the CJK font's Latin glyphs."""
    out = []
    for ch in text:
        f = cjk_font() if ord(ch) >= 0x2E80 else base
        if out and out[-1][0] == f:
            out[-1][1] += ch
        else:
            out.append([f, ch])
    return out


def text_width(text, base, size):
    return sum(pdfmetrics.stringWidth(chunk, f, size) for f, chunk in runs(text, base))


def draw(c, x, y, text, base, size):
    for f, chunk in runs(text, base):
        c.setFont(f, size)
        c.drawString(x, y, chunk)
        x += pdfmetrics.stringWidth(chunk, f, size)


# ---------------------------------------------------------------- PDF builder
class Doc:
    """Very small layout engine: headings, paragraphs, key/value blocks, tables."""

    def __init__(self, name, issuer, title, ref, footer=None):
        self.name, self.issuer, self.title, self.ref = name, issuer, title, ref
        self.footer = footer or issuer
        self.pages = []
        self.raw = False

    def page(self):
        self.pages.append([])
        return self

    def _add(self, *item):
        if not self.pages:
            self.page()
        self.pages[-1].append(item)
        return self

    def h(self, text, size=11.5):
        return self._add("h", text, size)

    def p(self, text, size=9.2):
        return self._add("p", text, size)

    def kv(self, pairs, x2=215):
        for k, v in pairs:
            self._add("kv", k, v, x2)
        return self

    def table(self, xs, rows, header=True, size=8.8):
        return self._add("t", xs, rows, header, size)

    def sp(self, n=1):
        return self._add("sp", n)

    def render(self, path):
        W, H = A4
        c = canvas.Canvas(path, pagesize=A4)
        c.setTitle(self.title)
        c.setAuthor(self.issuer)
        n = len(self.pages)
        for i, items in enumerate(self.pages, 1):
            c.setFont("Helvetica-Bold", 13)
            c.drawString(50, H - 50, self.issuer)
            draw(c, 50, H - 66, self.title, "Helvetica", 10)
            c.setFont("Helvetica", 8.5)
            c.drawRightString(W - 50, H - 50, self.ref)
            c.line(50, H - 74, W - 50, H - 74)
            y = H - 96
            for it in items:
                kind = it[0]
                if kind == "sp":
                    y -= 8 * it[1]
                elif kind == "h":
                    y -= 4
                    draw(c, 50, y, it[1], "Helvetica-Bold", it[2])
                    y -= it[2] + 6
                elif kind == "p":
                    for line in wrap(it[1], "Helvetica", it[2], W - 100):
                        draw(c, 50, y, line, "Helvetica", it[2])
                        y -= it[2] + 3.5
                    y -= 3
                elif kind == "kv":
                    _, k, v, x2 = it
                    draw(c, 50, y, k, "Helvetica-Bold", 9.2)
                    lines = wrap(v, "Helvetica", 9.2, W - 50 - x2)
                    for j, line in enumerate(lines):
                        draw(c, x2, y, line, "Helvetica", 9.2)
                        if j < len(lines) - 1:
                            y -= 12.5
                    y -= 13.5
                elif kind == "t":
                    _, xs, rows, header, size = it
                    for r, row in enumerate(rows):
                        bold = header and r == 0
                        for x, cell in zip(xs, row):
                            draw(c, x, y, cell, "Helvetica-Bold" if bold else "Helvetica", size)
                        if bold:
                            c.line(50, y - 3, W - 50, y - 3)
                        y -= size + 5
                    y -= 4
                if y < 70:
                    raise SystemExit(f"{self.name}: page {i} overflows; split content")
            c.setFont("Helvetica", 7.5)
            c.drawString(50, 36, self.footer)
            c.drawRightString(W - 50, 36, f"Page {i} of {n}")
            c.showPage()
        c.save()


def wrap(text, font, size, width):
    if has_cjk(text):
        lines, cur = [], ""
        for ch in text:
            if text_width(cur + ch, font, size) > width:
                lines.append(cur)
                cur = ch
            else:
                cur += ch
        return lines + ([cur] if cur else [])
    lines, cur = [], ""
    for w in text.split(" "):
        cand = (cur + " " + w).strip()
        if text_width(cand, font, size) > width and cur:
            lines.append(cur)
            cur = w
        else:
            cur = cand
    return lines + ([cur] if cur else [])


def render_garbled(path, title, pages_text):
    """A PDF whose extractable text is mojibake (simulates a locked / badly encoded scan)."""
    W, H = A4
    c = canvas.Canvas(path, pagesize=A4)
    c.setTitle(title)
    for txt in pages_text:
        y = H - 60
        c.setFont("Courier", 8)
        for line in txt:
            c.drawString(40, y, line)
            y -= 11
        c.showPage()
    c.save()


# ---------------------------------------------------------------- extraction
def extract_pages(pdf):
    out = subprocess.run(["pdftotext", "-layout", pdf, "-"], capture_output=True, text=True, check=True).stdout
    pages = out.split("\f")
    if pages and not pages[-1].strip():
        pages = pages[:-1]
    return out, pages


# ---------------------------------------------------------------- battery builder
class Battery:
    def __init__(self, hh):
        self.hh = hh
        self.singles = []
        self.convs = []

    def q(self, intent, behaviour, refs, expected, msgs, forbidden=(), note=""):
        for m in msgs:
            tags = []
            if isinstance(m, tuple):
                m, tags = m[0], list(m[1:])
            self.singles.append({
                "id": f"{self.hh}-S{len(self.singles)+1:03d}",
                "intent": intent,
                "message": m,
                "behaviour": behaviour,
                "expected": [expand(g) for g in expected],
                "forbidden": list(forbidden),
                "fact_refs": list(refs),
                "tags": tags,
                **({"note": note} if note else {}),
            })

    def conv(self, title, turns, tags=()):
        cid = f"{self.hh}-C{len(self.convs)+1:02d}"
        out = []
        for i, t in enumerate(turns, 1):
            user, beh, refs, exp = t[:4]
            forb = t[4] if len(t) > 4 else ()
            note = t[5] if len(t) > 5 else ""
            out.append({"turn": i, "user": user, "behaviour": beh,
                        "expected": [expand(g) for g in exp], "forbidden": list(forb),
                        "fact_refs": list(refs), **({"note": note} if note else {})})
        self.convs.append({"id": cid, "title": title, "tags": list(tags), "turns": out})


# ---------------------------------------------------------------- build + verify
def build(hh, meta, docs, facts, derived, traps, battery, not_uploaded):
    base = os.path.join(ROOT, hh)
    ddir = os.path.join(base, "docs")
    os.makedirs(ddir, exist_ok=True)
    errors = []
    page_text = {}
    doc_meta = []
    for doc in docs:
        path = os.path.join(ddir, doc.name)
        if getattr(doc, "garbled", None):
            render_garbled(path, doc.title, doc.garbled)
        else:
            doc.render(path)
        full, pages = extract_pages(path)
        with open(path + ".extracted.txt", "w", encoding="utf-8") as f:
            f.write(full)
        with open(path, "rb") as f:
            b = f.read()
        with open(path + ".b64", "w") as f:
            f.write(base64.b64encode(b).decode())
        page_text[doc.name] = pages
        doc_meta.append({"file": f"docs/{doc.name}", "pages": len(pages), **doc.meta})

    # ---- facts
    fact_by_id = {}
    for fa in facts:
        if fa["id"] in fact_by_id:
            errors.append(f"duplicate fact id {fa['id']}")
        fact_by_id[fa["id"]] = fa
        pages = page_text.get(fa["doc"])
        if pages is None:
            errors.append(f"{fa['id']}: unknown doc {fa['doc']}")
            continue
        if fa["page"] < 1 or fa["page"] > len(pages):
            errors.append(f"{fa['id']}: page {fa['page']} out of range")
            continue
        ptxt = norm(pages[fa["page"] - 1])
        evs = fa["evidence"] if isinstance(fa["evidence"], list) else [fa["evidence"]]
        for ev in evs:
            if norm(ev) not in ptxt and norm(ev).replace(" ", "") not in ptxt.replace(" ", ""):
                errors.append(f"{fa['id']}: evidence not on {fa['doc']} p{fa['page']}: {ev!r}")
        if fa.get("check_value", True):
            v = str(fa["value"])
            ok = any(match(ev, alt) for ev in evs for alt in (date_alts(v) if re.match(r"^\d{4}-\d\d-\d\d$", v) else [v]))
            if not ok:
                errors.append(f"{fa['id']}: value {v!r} not found in its evidence")
        for ab in fa.get("absent_from_doc", []):
            alltxt = norm(" ".join(pages))
            if norm(ab) in alltxt:
                errors.append(f"{fa['id']}: {ab!r} expected absent from {fa['doc']} but present")

    # ---- derived
    def V(fid):
        v = fact_by_id[fid]["value"] if fid in fact_by_id else der_by_id[fid]["value"]
        if isinstance(v, (int, float)):
            return v
        s = str(v).replace("S$", "").replace(",", "").replace("%", "")
        try:
            return float(s) if "." in s else int(s)
        except ValueError:
            return v

    der_by_id = {}
    for dv in derived:
        der_by_id[dv["id"]] = dv
        for dep in dv["from"]:
            if dep not in fact_by_id and dep not in der_by_id:
                errors.append(f"{dv['id']}: unknown dependency {dep}")
        try:
            got = dv["calc"](V)
        except Exception as e:  # noqa
            errors.append(f"{dv['id']}: calc error {e}")
            continue
        want = dv["value"]
        if isinstance(want, str) and re.match(r"^\d{4}-\d\d-\d\d$", want):
            got = str(got)
        elif isinstance(want, (int, float)):
            got = round(got, 2)
        if got != want:
            errors.append(f"{dv['id']}: computed {got!r} != stated {want!r}")

    # ---- battery grounding
    def ground(refs):
        parts = []
        for r in refs:
            if r in fact_by_id:
                fa = fact_by_id[r]
                parts.append(str(fa["value"]))
                v = str(fa["value"])
                if re.match(r"^\d{4}-\d\d-\d\d$", v):
                    parts.extend(date_alts(v))
                evs = fa["evidence"] if isinstance(fa["evidence"], list) else [fa["evidence"]]
                parts.extend(evs)
                parts.extend(fa.get("aliases", []))
            elif r in der_by_id:
                v = der_by_id[r]["value"]
                parts.append(f"{v:,}" if isinstance(v, int) else str(v))
                if isinstance(v, str) and re.match(r"^\d{4}-\d\d-\d\d$", v):
                    parts.extend(date_alts(v))
                parts.extend(der_by_id[r].get("aliases", []))
            else:
                errors.append(f"battery ref to unknown fact {r}")
        return " || ".join(parts)

    def check_item(iid, item):
        if item["behaviour"] not in BEHAVIOURS:
            errors.append(f"{iid}: unknown behaviour {item['behaviour']}")
        g = ground(item["fact_refs"])
        for grp in item["expected"]:
            if not any(match(g, alt) for alt in grp):
                errors.append(f"{iid}: expected {grp[:3]} not grounded in refs {item['fact_refs']}")
        for fb in item["forbidden"]:
            for grp in item["expected"]:
                if any(norm(fb) == norm(a) for a in grp):
                    errors.append(f"{iid}: forbidden {fb!r} equals an expected value")
        if item["behaviour"] in ("answer", "compute") and not item["expected"]:
            errors.append(f"{iid}: {item['behaviour']} item without expected facts")
        if item["behaviour"] in ("answer", "compute") and not item["fact_refs"]:
            errors.append(f"{iid}: {item['behaviour']} item without fact refs")

    seen_msgs = set()
    for s in battery.singles:
        check_item(s["id"], s)
        key = norm(s["message"])
        if key in seen_msgs:
            errors.append(f"{s['id']}: duplicate message {s['message']!r}")
        seen_msgs.add(key)
    for cv in battery.convs:
        if not (8 <= len(cv["turns"]) <= 30):
            errors.append(f"{cv['id']}: {len(cv['turns'])} turns (need 8-30)")
        for t in cv["turns"]:
            check_item(f"{cv['id']}.t{t['turn']}", t)

    if len(battery.singles) < 150:
        errors.append(f"only {len(battery.singles)} single messages (need >=150)")
    if len(battery.convs) < 15:
        errors.append(f"only {len(battery.convs)} conversations (need >=15)")

    if errors:
        print(f"{hh}: {len(errors)} VERIFICATION ERRORS")
        for e in errors:
            print("  -", e)
        sys.exit(1)

    manifest = {
        "household_id": hh,
        "as_of": AS_OF,
        "timezone": TZ,
        **meta,
        "documents": doc_meta,
        "not_uploaded": not_uploaded,
        "facts": [{k: v for k, v in fa.items() if k not in ("check_value",)} for fa in facts],
        "derived_facts": [{k: v for k, v in dv.items() if k != "calc"} for dv in derived],
        "traps": traps,
    }
    with open(os.path.join(base, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    bat = {
        "household_id": hh,
        "as_of": AS_OF,
        "timezone": TZ,
        "behaviour_types": BEHAVIOURS,
        "matching": "expected = list of groups; each group passes if ANY alternative appears in the reply "
                    "(case-insensitive; S$/$ and thousand separators normalised; numbers matched on digit boundaries). "
                    "forbidden = strings a correct reply to THIS message must not contain.",
        "counts": {"singles": len(battery.singles), "conversations": len(battery.convs),
                   "conversation_turns": sum(len(c["turns"]) for c in battery.convs)},
        "singles": battery.singles,
        "conversations": battery.convs,
    }
    with open(os.path.join(base, "battery.json"), "w", encoding="utf-8") as f:
        json.dump(bat, f, indent=2, ensure_ascii=False)
    print(f"{hh}: {len(docs)} docs, {len(facts)} facts, {len(derived)} derived, "
          f"{len(battery.singles)} singles, {len(battery.convs)} conversations "
          f"({bat['counts']['conversation_turns']} turns)")
    print("ALL FACTS VERIFIED")


def F(fid, doc, page, value, evidence, person=None, topic=None, **kw):
    out = {"id": fid, "doc": doc, "page": page, "value": value,
           "evidence": evidence, "person": person, "topic": topic}
    out.update(kw)
    return out


def DV(fid, value, frm, calc, explain, aliases=()):
    return {"id": fid, "value": value, "from": list(frm), "calc": calc, "explain": explain,
            "aliases": list(aliases)}
