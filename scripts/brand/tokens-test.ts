/**
 * Brand tokens guard (docs/brand.md).
 *
 * 1. Every colour lives in the token blocks at the top of app/globals.css:
 *    no hex, rgb() or named colour anywhere else in the stylesheet, and no
 *    colour literal in a page or component (the browser theme colour in
 *    app/layout.tsx must equal --bg in each theme).
 * 2. Every var(--x) the app uses is defined, so nothing silently falls back
 *    to an off-brand colour or to nothing in dark mode.
 * 3. Each colour role meets WCAG AA in light and dark: 4.5:1 for text,
 *    3:1 for dots, edges and input borders.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync("app/globals.css", "utf8");
const lightStart = css.indexOf(":root {");
const darkStart = css.indexOf(':root[data-theme="dark"] {');
const lightBlock = css.slice(lightStart, css.indexOf("}", lightStart));
const darkBlock = css.slice(darkStart, css.indexOf("}", darkStart));
const rest = css.slice(css.indexOf("}", darkStart) + 1);

function tokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const light = tokens(lightBlock);
const dark = { ...light, ...tokens(darkBlock) };

function resolve(theme: Record<string, string>, name: string, depth = 0): string {
  const v = theme[name];
  assert.ok(v, `${name} is defined`);
  const ref = /^var\((--[a-z0-9-]+)\)$/.exec(v);
  if (ref && depth < 5) return resolve(theme, ref[1], depth + 1);
  return v;
}
function rgb(hex: string): number[] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  assert.match(h, /^[0-9a-f]{6}$/i, `${hex} is a plain hex colour`);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|:\s*(white|black|red|green|blue|crimson|gray|grey|orange)\b/;

test("1. no colour literal outside the token blocks", () => {
  const offenders = rest.split("\n").map((line, i) => [line, i] as const).filter(([line]) => COLOUR.test(line.replace(/\/\*.*?\*\//g, "")));
  assert.deepEqual(offenders.map(([l]) => l.trim()), [], "use a token from the top of app/globals.css");

  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { if (p !== join("app", "api")) walk(p); }
      else if (/\.tsx?$/.test(name)) files.push(p);
    }
  };
  walk("app"); walk("components");
  const inline = files.flatMap((f) => readFileSync(f, "utf8").split("\n")
    .filter((l) => /(color|background|border|fill|stroke)[A-Za-z]*\s*[:=]/i.test(l) && /["'`](#[0-9a-fA-F]{3,8}|rgba?\(|crimson|red|white|black)\b/.test(l))
    .map((l) => `${f}: ${l.trim().slice(0, 120)}`))
    .filter((l) => !l.startsWith(join("app", "layout.tsx")));
  assert.deepEqual(inline, [], "pages and components use var(--token), never a colour literal");

  const layout = readFileSync(join("app", "layout.tsx"), "utf8");
  assert.ok(layout.includes(`color: "${resolve(light, "--bg")}"`), "light browser theme colour equals --bg");
  assert.ok(layout.includes(`color: "${resolve(dark, "--bg")}"`), "dark browser theme colour equals dark --bg");
});

test("2. every var(--token) the app uses is defined", () => {
  const defined = new Set([...Object.keys(light), ...Object.keys(dark), ...[...css.matchAll(/(--[a-z0-9-]+):/g)].map((m) => m[1])]);
  const files = [join("app", "globals.css")];
  const walk = (dir: string) => { for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(n)) files.push(p); } };
  walk("app"); walk("components");
  // A component may set a custom property itself, e.g. style={{ "--tab": 1 }}.
  for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(/["'](--[a-z0-9-]+)["']\s*:/g)) defined.add(m[1]);
  const missing = new Set<string>();
  for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(/var\((--[a-z0-9-]+)/g)) if (!defined.has(m[1])) missing.add(`${m[1]} (${f})`);
  assert.deepEqual([...missing], []);
});

// [foreground, background, minimum, what the household sees]
const PAIRS: Array<[string, string, number, string]> = [
  ["--ink", "--bg", 4.5, "body text"],
  ["--ink-2", "--surface", 4.5, "secondary text on a card"],
  ["--muted", "--bg", 4.5, "muted text on the page"],
  ["--muted", "--surface", 4.5, "muted text on a card"],
  ["--muted", "--bg-2", 4.5, "muted text in the sidebar"],
  ["--brand-ink", "--bg", 4.5, "a link"],
  ["--brand-ink", "--surface", 4.5, "a link on a card"],
  ["--brand-ink", "--brand-tint", 4.5, "the active nav item"],
  ["--on-brand", "--brand", 4.5, "text on a brand fill"],
  ["--accent-ink", "--accent", 4.5, "a primary button"],
  ["--money", "--surface", 4.5, "a documented figure on a card"],
  ["--money", "--accent-tint", 4.5, "a documented figure in a total"],
  ["--good-text", "--good-tint", 4.5, "a confirmed chip"],
  ["--good-text", "--surface", 4.5, "confirmed text"],
  ["--unresolved-text", "--unresolved-tint", 4.5, "a to-confirm chip"],
  ["--unresolved-text", "--surface", 4.5, "not-settled text on a card"],
  ["--unresolved-text", "--surface-2", 4.5, "not-settled text in a quiet block"],
  ["--unresolved-line", "--surface", 3, "the dashed edge of a not-settled item"],
  ["--unresolved-line", "--unresolved-tint", 3, "the dashed edge on its own tint"],
  ["--warn-text", "--warn-tint", 4.5, "a warning box"],
  ["--warn-text", "--surface", 4.5, "warning text on a card"],
  ["--critical", "--critical-tint", 4.5, "an error box"],
  ["--critical", "--surface", 4.5, "error text on a card"],
  ["--info-text", "--info-tint", 4.5, "a neutral notice"],
  ["--input-line", "--surface", 3, "an input border"],
  ["--good", "--surface", 3, "a confirmed dot"],
  ["--unresolved", "--surface", 3, "a not-settled dot or edge"],
  ["--warn", "--surface", 3, "a warning dot"],
  ["--critical", "--surface", 3, "an error dot"],
];

for (const [name, theme] of [["light", light], ["dark", dark]] as const) {
  test(`3. WCAG AA colour roles, ${name}`, () => {
    const fails = PAIRS.map(([fg, bg, min, what]) => ({ what, fg, bg, min, r: contrast(resolve(theme, fg), resolve(theme, bg)) }))
      .filter((p) => p.r < p.min).map((p) => `${p.what}: ${p.fg} on ${p.bg} is ${p.r.toFixed(2)}:1, needs ${p.min}:1`);
    assert.deepEqual(fails, []);
  });
}

test("4. the four status roles are told apart by more than hue", () => {
  const roles = ["--good-text", "--unresolved-text", "--warn-text", "--critical"];
  for (const theme of [light, dark]) {
    const seen = new Set(roles.map((r) => resolve(theme, r).toLowerCase()));
    assert.equal(seen.size, roles.length, "each status role has its own colour");
  }
  assert.match(css, /\.to-confirm \{[^}]*dashed/, "a to-confirm item has a dashed edge, not only a colour");
});

// Which meaning gets which role. A failure the household can retry is never
// drawn as calm uncertainty; uncertainty is never drawn as a failure.
const ROLE_OF: Array<[RegExp, string, string]> = [
  [/\.unread-documents\.stalled \{[^}]*/, "--critical", "a read that failed, with Try again, is an error"],
  [/\.status\.failed \{[^}]*/, "--critical", "a document that couldn't be read is an error"],
  [/\.accuracy-warning\.danger \{[^}]*/, "--critical", "a file refused by the scan is an error"],
  [/\.alert\.error \{[^}]*/, "--critical", "an error box"],
  [/\.document-found\.warn \{[^}]*/, "--warn", "benefits that failed to read need the household"],
  [/\.usage-warnings \{[^}]*/, "--warn", "a limit close to running out"],
  [/\.status\.ready\.partial \{[^}]*/, "--unresolved", "Read in part is not settled"],
  [/\.to-confirm \{[^}]*/, "--unresolved", "an amount to confirm is not settled"],
  [/\.coverage-unconfirmed \{[^}]*/, "--unresolved", "a printed amount whose wording isn't read"],
  [/\.estimate-basis\.indicative \{[^}]*/, "--unresolved", "an illustration is not a settled amount"],
  [/\.unread-documents \{[^}]*/, "--info", "still being read is neutral news"],
  [/\.status\.ready \{[^}]*/, "--good", "a read document is confirmed"],
];
test("5. each meaning keeps its role", () => {
  const wrong = ROLE_OF.flatMap(([rule, role, why]) => {
    const body = rule.exec(rest)?.[0] ?? "";
    return body.includes(`var(${role}`) ? [] : [`${why}: expected ${role} in "${body.slice(0, 90)}"`];
  });
  assert.deepEqual(wrong, []);
});
