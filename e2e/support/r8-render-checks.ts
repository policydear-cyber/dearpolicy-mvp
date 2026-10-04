/**
 * Round 8: what a household actually SEES of a chat answer -- checked in the
 * browser, not in the answer JSON. Runs inside the page (page.evaluate) and
 * returns every display defect it finds under `root`:
 *
 *   overflow     the page scrolls sideways, or an element pokes past the
 *                viewport outside a deliberate horizontal scroller
 *   raw-text     markdown symbols, HTML entities, escaped "\n", "[object",
 *                "undefined"/"NaN" shown as text
 *   tap-target   a control smaller than `minTarget` px in either direction
 *   empty        a card, heading, list item, cell or label with no text
 *   duplicate    the same paragraph or card twice in one answer
 *   label        a control with no accessible name
 *   contrast     text below WCAG AA contrast against its background
 *   tofu         CJK text drawn as missing-glyph boxes (no font fallback)
 *   clipped      text cut off inside a box that hides overflow
 *   format       an answer showing a raw ISO date ("2026-09-28") or an
 *                internal code ("per_policy_year") instead of words
 */
export type RenderIssue = { kind: string; detail: string };

export function collectRenderIssues(args: { root: string; minTarget: number }): RenderIssue[] {
  const issues: RenderIssue[] = [];
  const root = document.querySelector(args.root) as HTMLElement | null;
  if (!root) return [{ kind: "missing-root", detail: args.root }];
  const W = document.documentElement.clientWidth;
  const describe = (el: Element) => {
    const cls = typeof (el as HTMLElement).className === "string" ? (el as HTMLElement).className.trim().split(/\s+/).slice(0, 2).join(".") : "";
    return el.tagName.toLowerCase() + (cls ? "." + cls : "") + ` "${(el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60)}"`;
  };
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || (r.width <= 1 && r.height <= 1)) return false; // also screen-reader-only text
    for (let p: Element | null = el; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.display === "none" || s.visibility === "hidden") return false;
      if (p.tagName === "DETAILS" && p !== el && !(p as HTMLDetailsElement).open && !(el.tagName === "SUMMARY" && el.parentElement === p) && !p.querySelector(":scope > summary")?.contains(el)) return false;
    }
    return true;
  };

  // 1. Horizontal overflow.
  if (document.documentElement.scrollWidth > W + 1) issues.push({ kind: "overflow", detail: `page is ${document.documentElement.scrollWidth}px wide in a ${W}px viewport` });
  const inScroller = (el: Element) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX;
      if (o === "auto" || o === "scroll" || o === "hidden" || o === "clip") return true;
    }
    return false;
  };
  for (const el of Array.from(root.querySelectorAll("*"))) {
    const r = el.getBoundingClientRect();
    if (r.width && r.right > W + 1 && visible(el) && !inScroller(el)) { issues.push({ kind: "overflow", detail: describe(el) + ` right=${Math.round(r.right)}` }); break; }
  }

  // 2. Raw markup and encoding leaks in visible text.
  const RAW = /\*\*|__\w|`|(^|\n)\s*#{1,6}\s|\|\s*-{3,}|\s\|\s.+\s\|(\s|$)|\\n|\\u[0-9a-f]{4}|&(?:[a-z]{2,8}|#\d{2,5}|#x[0-9a-f]{2,4});|<\/?[a-z]+[^>]*>|\[object |\bundefined\b|\bNaN\b|\bnull\b/i;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.nodeValue ?? "";
    const parent = n.parentElement;
    if (!parent || parent.closest("textarea,script,style") || !text.trim()) continue;
    const m = text.match(RAW);
    if (m && visible(parent)) issues.push({ kind: "raw-text", detail: `"${m[0]}" in ${describe(parent)}` });
  }

  // 2b. Dates and codes in DearPolicy's own text (a person's own message is
  // shown exactly as they typed it).
  for (const body of Array.from(root.querySelectorAll(".message.assistant .message-body"))) {
    const w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const m = (n.nodeValue ?? "").match(/\b\d{4}-\d{2}-\d{2}\b|\b[a-z]+_[a-z_]+\b/);
      if (m && n.parentElement && visible(n.parentElement)) issues.push({ kind: "format", detail: `"${m[0]}" in ${describe(n.parentElement)}` });
    }
  }

  // 3. Tap targets and 4. accessible names.
  const controls = Array.from(root.querySelectorAll("button,a[href],summary,input:not([type=hidden]),textarea,select"));
  for (const el of controls) {
    if (!visible(el)) continue;
    // WCAG 2.5.8 exceptions: a link inside a sentence, and a checkbox or
    // radio whose label is the tap target (measured instead).
    if (el.tagName === "A" && getComputedStyle(el).display === "inline" && el.parentElement?.closest("p,li") && (el.parentElement.textContent ?? "").trim().length > (el.textContent ?? "").trim().length + 10) continue;
    const box = (el as HTMLInputElement).type === "checkbox" || (el as HTMLInputElement).type === "radio" ? ((el as HTMLInputElement).labels?.[0] ?? el) : el;
    const r = box.getBoundingClientRect();
    if (r.height < args.minTarget - 0.5 || r.width < args.minTarget - 0.5) issues.push({ kind: "tap-target", detail: `${describe(el)} ${Math.round(r.width)}x${Math.round(r.height)}` });
    const name = (el.getAttribute("aria-label") ?? "").trim() || (el.getAttribute("aria-labelledby") ? "x" : "") || (el.textContent ?? "").trim() || (el as HTMLInputElement).labels?.[0]?.textContent?.trim() || (el.getAttribute("title") ?? "").trim() || (el.getAttribute("placeholder") ?? "").trim();
    if (!name) issues.push({ kind: "label", detail: describe(el) });
  }

  // 5. Empty blocks.
  for (const el of Array.from(root.querySelectorAll(".message-body p,.message-body strong,.message-body li,.message-body small,.message-body td,.message-body th,.fact-question,.claim-result,.citation,.known-facts span,summary,h1,h2,h3,.message-label"))) {
    if (visible(el) && !(el.textContent ?? "").trim() && !el.querySelector("img,svg,input,textarea")) issues.push({ kind: "empty", detail: describe(el) + " " + el.outerHTML.slice(0, 80) });
  }

  // 6. Duplicates inside one answer.
  for (const body of Array.from(root.querySelectorAll(".message.assistant .message-body"))) {
    const seen = new Map<string, number>();
    for (const el of Array.from(body.querySelectorAll(":scope > p, .claim-result, .fact-question > strong, .policy-stated-limit, .citation"))) {
      const t = (el.textContent ?? "").trim().replace(/\s+/g, " ");
      if (t.length < 12) continue;
      seen.set(t, (seen.get(t) ?? 0) + 1);
    }
    for (const [t, n] of seen) if (n > 1) issues.push({ kind: "duplicate", detail: `${n}x "${t.slice(0, 80)}"` });
  }

  // 7. Contrast (WCAG AA) for visible text; disabled controls are exempt.
  const parse = (c: string) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = (c: { r: number; g: number; b: number }) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const bgOf = (el: Element) => {
    const layers: { r: number; g: number; b: number; a: number }[] = [];
    for (let p: Element | null = el; p; p = p.parentElement) { const c = parse(getComputedStyle(p).backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; } }
    let out = { r: 255, g: 255, b: 255 };
    for (const l of layers.reverse()) out = { r: l.r * l.a + out.r * (1 - l.a), g: l.g * l.a + out.g * (1 - l.a), b: l.b * l.a + out.b * (1 - l.a) };
    return out;
  };
  const checked = new Set<Element>();
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const el = n.parentElement;
    if (!el || checked.has(el) || !(n.nodeValue ?? "").trim() || !visible(el) || el.closest(":disabled,[aria-disabled=true],textarea")) continue;
    checked.add(el);
    const s = getComputedStyle(el); const fg = parse(s.color); if (!fg) continue;
    let opacity = 1; for (let p: Element | null = el; p; p = p.parentElement) opacity *= Number(getComputedStyle(p).opacity);
    const bg = bgOf(el); const a = fg.a * opacity;
    const blended = { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a) };
    const L1 = lum(blended), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(s.fontSize); const bold = Number(s.fontWeight) >= 700;
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    if (ratio < need - 0.05) issues.push({ kind: "contrast", detail: `${describe(el)} ${ratio.toFixed(2)}:1 (needs ${need}:1)` });
  }

  // 8. CJK glyphs drawn as missing-glyph boxes.
  const cjkEls = Array.from(root.querySelectorAll("*")).filter((el) => Array.from(el.childNodes).some((c) => c.nodeType === 3 && /[\u4e00-\u9fff]/.test(c.nodeValue ?? "")));
  if (cjkEls.length) {
    const canvas = document.createElement("canvas"); canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    const draw = (font: string, ch: string) => { ctx.clearRect(0, 0, 64, 64); ctx.font = font; ctx.fillStyle = "#000"; ctx.textBaseline = "top"; ctx.fillText(ch, 4, 4); return Array.from(ctx.getImageData(0, 0, 64, 64).data).join(","); };
    for (const el of cjkEls.slice(0, 10)) {
      const s = getComputedStyle(el); const font = `${s.fontWeight} 40px ${s.fontFamily}`;
      const ch = ((el.textContent ?? "").match(/[\u4e00-\u9fff]/) ?? ["保"])[0];
      const glyph = draw(font, ch), notdef = draw(font, "\u{10FFFD}");
      if (glyph === notdef || /^(0,)*0$/.test(glyph)) issues.push({ kind: "tofu", detail: describe(el) });
    }
  }

  // 9. Text clipped inside a box that hides its overflow.
  for (const el of Array.from(root.querySelectorAll(".message-body *, .chat-history *"))) {
    const s = getComputedStyle(el);
    if ((s.overflowX === "hidden" || s.overflowY === "hidden" || s.overflow === "clip") && visible(el) && el.textContent?.trim()) {
      const h = el as HTMLElement;
      if (h.scrollWidth > h.clientWidth + 2 || (s.overflowY === "hidden" && h.scrollHeight > h.clientHeight + 2 && !h.matches(".thinking-bar"))) issues.push({ kind: "clipped", detail: describe(el) });
    }
  }
  return issues;
}
