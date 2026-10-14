/**
 * V1.4 (after s50-live-1): a run refuses to start unless the SHA it will record IS the checked-out code.
 *
 * s50-live-1 recorded 4e35f58 from a stale RAG2_LIVE_TESTED_SHA while the working tree was 402399a. The recorded SHA
 * is now checked against the code before any model call:
 *  - in a git checkout (CI): HEAD must equal the recorded SHA (or be a request commit on it that changes only a
 *    run-request.json), and no tracked file may differ from HEAD;
 *  - without git (the sandbox): a manifest of the recorded commit's tree ({ sha, files: { path: blob sha } }, written
 *    from GitHub's tree of that commit) must name the same SHA, and every source file it lists under the checked
 *    roots must have that git blob hash locally; no source file outside the manifest may exist under those roots;
 *  - the production build (.next/BUILD_ID) must be newer than every checked source file.
 * Pure checks over the file system; no model or network call.
 */
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const CHECKED_ROOTS = ["app", "lib", "components", "scripts", "e2e", "middleware.ts", "instrumentation.ts", "package.json", "next.config.ts", "next.config.js", "next.config.mjs", "tsconfig.json"];
const SKIP = /(^|\/)(node_modules|\.next)(\/|$)|tsconfig\.tsbuildinfo$/;

export const blobSha = (buf: Buffer) => crypto.createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf])).digest("hex");
export type Manifest = { sha: string; files: Record<string, string> };

function walk(cwd: string, rel: string, out: string[]) {
  const p = path.join(cwd, rel);
  if (!fs.existsSync(p) || SKIP.test(rel)) return;
  const st = fs.statSync(p);
  if (st.isFile()) { out.push(rel); return; }
  for (const e of fs.readdirSync(p)) walk(cwd, rel ? `${rel}/${e}` : e, out);
}
const inRoots = (f: string) => CHECKED_ROOTS.some((r) => f === r || f.startsWith(r + "/")) && !SKIP.test(f);

export function checkProvenance(a: { recordedSha: string | null; cwd?: string; manifest?: Manifest | null; buildIdFile?: string | null; git?: (cmd: string) => string | null }): { ok: true; via: "git" | "manifest"; checked: number } | { ok: false; reason: string } {
  const cwd = a.cwd ?? process.cwd();
  if (!a.recordedSha || !/^[0-9a-f]{40}$/.test(a.recordedSha)) return { ok: false, reason: "no full 40-character tested SHA to record (set RAG2_LIVE_TESTED_SHA)" };
  const git = a.git ?? ((c: string) => { try { return execSync(c, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } });
  let via: "git" | "manifest"; let files: string[] = [];
  const head = git("git rev-parse HEAD");
  if (head) {
    if (head !== a.recordedSha) {
      // CI's request commit: the tested code is HEAD's parent and the request commit changes only a run-request.json.
      const parent = git("git rev-parse HEAD^1");
      const diff = parent === a.recordedSha ? (git(`git diff --name-only ${parent} HEAD`) ?? "").split("\n").filter(Boolean) : null;
      if (!diff || !diff.length || !diff.every((f) => /(^|\/)run-request\.json$/.test(f))) return { ok: false, reason: `recorded SHA ${a.recordedSha} is not the checked-out HEAD ${head}${parent === a.recordedSha ? " (HEAD changes more than a run request on top of it)" : ""}` };
    }
    const dirty = git("git status --porcelain --untracked-files=no") ?? "";
    const changed = dirty.split("\n").map((l) => l.slice(3).trim()).filter((f) => f && inRoots(f));
    if (changed.length) return { ok: false, reason: `the checkout differs from ${a.recordedSha} in ${changed.length} tracked file(s): ${changed.slice(0, 5).join(", ")}` };
    via = "git"; files = (git("git ls-files") ?? "").split("\n").filter(inRoots);
  } else {
    const m = a.manifest;
    if (!m) return { ok: false, reason: "no git checkout and no tree manifest (RAG2_LIVE_TREE_MANIFEST) for the recorded SHA" };
    if (m.sha !== a.recordedSha) return { ok: false, reason: `the tree manifest is for ${m.sha}, not the recorded SHA ${a.recordedSha}` };
    const expected = Object.entries(m.files).filter(([f]) => inRoots(f));
    const mismatched: string[] = [];
    for (const [f, sha] of expected) {
      const p = path.join(cwd, f);
      if (!fs.existsSync(p)) { mismatched.push(`${f} (missing)`); continue; }
      if (blobSha(fs.readFileSync(p)) !== sha) mismatched.push(f);
    }
    const local: string[] = []; for (const r of CHECKED_ROOTS) walk(cwd, r, local);
    const extra = local.filter((f) => !(f in m.files));
    if (mismatched.length || extra.length) return { ok: false, reason: `the working tree is not ${a.recordedSha}: ${mismatched.length} file(s) differ${mismatched.length ? ` (${mismatched.slice(0, 5).join(", ")})` : ""}, ${extra.length} file(s) not in that commit${extra.length ? ` (${extra.slice(0, 5).join(", ")})` : ""}` };
    via = "manifest"; files = expected.map(([f]) => f);
  }
  if (a.buildIdFile !== null) {
    const b = path.join(cwd, a.buildIdFile ?? ".next/BUILD_ID");
    if (!fs.existsSync(b)) return { ok: false, reason: "no production build (.next/BUILD_ID) to test" };
    const built = fs.statSync(b).mtimeMs;
    const newer = files.filter((f) => !f.startsWith("scripts/") && !f.startsWith("e2e/") && fs.existsSync(path.join(cwd, f)) && fs.statSync(path.join(cwd, f)).mtimeMs > built);
    if (newer.length) return { ok: false, reason: `the production build is older than ${newer.length} source file(s) (${newer.slice(0, 5).join(", ")}): rebuild before the run` };
  }
  return { ok: true, via, checked: files.length };
}
