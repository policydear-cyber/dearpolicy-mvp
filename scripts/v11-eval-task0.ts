/**
 * V1.1 Task 0 -- the eight live defects preserved as executable regression checks.
 *
 * This script runs the checks that do not need a browser, in-process against the LOCAL database
 * with the deterministic model stand-in (same guards as scripts/v11-eval-run.ts):
 *   T0-1  "Josephine broke her arm" must not produce an assessment or a permanent-loss schedule
 *   T0-2  a stored factual question answers fast (p95 <= 8 s; in-process, no provider latency)
 *   T0-3  a provider quota failure (429 insufficient_quota with an organisation id) is a clean,
 *         timely customer message with bounded provider calls and no provider text
 *   T0-4  claims list status vs claim detail estimate agree after a completed interview
 *   T0-5  a fracture claim's requested documents do not describe death documents (data level:
 *         lib/claims/status.ts claimDisplayStatus when it exists; the rendered list is checked by
 *         e2e/tests/v11-journey.spec.ts (Task 0 page checks))
 *   T0-7  usage: model activity is reported, and no hard stop other than the owner's $5 is shown
 * T0-4/5/6/7 on the rendered pages: e2e/tests/v11-journey.spec.ts (Task 0 page checks). T0-8 (login first click):
 * e2e/tests/v11-journey.spec.ts (real sessions).
 * Exit code 1 when any check fails. Results: <out>/task0.json and task0.md.
 */
import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

process.env.E2E_RUN_ID ||= `v11t0${Date.now().toString(36)}`;
process.env.DEV_AUTH_ENABLED = "1";
const OUT = (() => { const i = process.argv.indexOf("--out"); return i >= 0 ? process.argv[i + 1] : path.resolve("docs/verification/v11/task0-" + (process.env.E2E_RUN_ID ?? "")); })();

type Check = { id: string; defect: string; pass: boolean; detail: string; evidence?: unknown };
const checks: Check[] = [];
const record = (c: Check) => { checks.push(c); console.log(`${c.pass ? "PASS" : "FAIL"} ${c.id} ${c.defect}\n     ${c.detail}`); };

async function main() {
  const { deterministicModelEnabled } = await import("@/lib/ai/deterministic-model");
  const host = (() => { try { return new URL(process.env.DATABASE_URL ?? "").hostname; } catch { return ""; } })();
  if (!["localhost", "127.0.0.1"].includes(host) || !deterministicModelEnabled() || process.env.STORAGE_DRIVER !== "local") throw new Error("needs the local synthetic environment (source /home/user/e2e.env)");
  const { NextRequest } = await import("next/server");
  const { pool } = await import("@/lib/db/client");
  const { ensureDefaultHousehold } = await import("@/lib/household/repo");
  const { savePolicyFile } = await import("@/lib/storage");
  const { processPolicy } = await import("@/lib/rag/ingest");
  const { pseudonymizeId } = await import("@/lib/telemetry/pseudonymize");
  const { renderDataset, PEOPLE, PREFIX, V11_QUESTIONS } = await import("../e2e/support/v11-dataset");
  const { LEAKS, moneyIn } = await import("./v11-eval-score");
  const cleanup = (await import("../e2e/support/cleanup")).default;
  const started = new Date();
  const user = randomUUID(); process.env.E2E_USER_A = user; process.env.E2E_USER_B = randomUUID(); process.env.DEV_ACCOUNT_ID = user;
  const household = await ensureDefaultHousehold(user, `${PREFIX}-Household-A`);
  const members: Record<string, string> = {};
  for (const key of ["josephine", "marcus"] as const) {
    members[key] = randomUUID();
    await pool.query(`INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship) VALUES($1,$2,$3,$4,$5)`, [members[key], household, PEOPLE[key].fullName, PEOPLE[key].preferred, PEOPLE[key].relationship]);
  }
  try {
    const docs = (await renderDataset()).filter((d) => ["hosp2025", "accident", "disability", "endowment"].includes(d.key));
    for (const d of docs) {
      const policyId = randomUUID(); const member = members[d.person!]; const bytes = new Uint8Array(d.buffer);
      const storageKey = await savePolicyFile({ accountId: household, familyMemberId: member, policyId, filename: d.fileName, bytes });
      await pool.query(`INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,file_hash,processing_status,processing_stage,processing_progress,processing_message,quarantine_status,scan_provider,scanned_at)
        VALUES($1,$2,$3,$4,$5,$6,'queued','queued',1,'Waiting','scan_clean','v11-task0',now())`, [policyId, household, member, d.fileName, storageKey, createHash("sha256").update(bytes).digest("hex")]);
      await processPolicy({ accountId: household, familyMemberId: member, policyId, storageKey, linkUploadMember: true }).catch((e) => console.log("ingest " + d.key + ": " + (e as Error).message));
    }
    const { POST } = await import("@/app/api/chat/route");
    const providerCalls: string[] = [];
    let quota = false;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      providerCalls.push(String(input instanceof Request ? input.url : input));
      if (quota) return new Response(JSON.stringify({ error: { message: "You exceeded your current quota, please check your plan and billing details. For more information on this error, read the docs: https://platform.openai.com/docs/guides/error-codes/api-errors. (organization: org-SynthTestOrg12345)", type: "insufficient_quota", code: "insufficient_quota" } }), { status: 429, headers: { "content-type": "application/json" } });
      throw new Error("network disabled");
    }) as typeof fetch;
    const send = async (member: string, question: string, conv?: { id?: string; rev?: number }) => {
      const t0 = Date.now();
      const res = await POST(new NextRequest("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ familyMemberId: member, scope: "member", question, conversationId: conv?.id, conversationRevision: conv?.rev, asynchronous: false, timeZone: "Asia/Singapore" }) }));
      const data = await res.json().catch(() => ({}));
      const a = data.answer ?? {};
      if (conv && a.conversationId) { conv.id = a.conversationId; conv.rev = a.conversationRevision; }
      const text = [a.summary, ...(a.details ?? []), ...(a.nextSteps ?? []), ...(a.questions ?? []).flatMap((q: any) => [q.text, q.why]), ...(a.claimItems ?? []).flatMap((i: any) => [i.title, i.reason, i.amountText]),
        ...(a.policyStatedLimits ?? []).map((l: any) => l.amountText), data.error].filter(Boolean).join("\n");
      return { status: res.status, a, text, ms: Date.now() - t0 };
    };

    // T0-1
    {
      const r = await send(members.josephine, "Josephine broke her arm.", {});
      const permanent = r.text.match(/(?<!not the same as )(?:loss of (?:an? )?arm|permanent(?:ly)? (?:loss|disablement|disability)|amputation)/i);
      const amounts = (r.a.claimItems ?? []).filter((i: any) => i.amountText || typeof i.calculatedAmount === "number");
      const assessed = r.a.mode === "claim_assessment" || /assessment ready/i.test(r.text);
      const asksCause = /accident|illness/i.test(r.a.questions?.[0]?.text ?? "");
      record({ id: "T0-1", defect: "\"Josephine broke her arm\" produced an assessment and a permanent-loss schedule", pass: !permanent && !amounts.length && !assessed && asksCause,
        detail: `mode=${r.a.mode}; first question="${r.a.questions?.[0]?.text ?? "-"}"; permanent-loss text=${permanent?.[0] ?? "none"}; claim items with amounts=${amounts.length}`, evidence: r.text.slice(0, 800) });
    }
    // T0-2
    {
      const times: number[] = [];
      for (let i = 0; i < 5; i++) times.push((await send(members.josephine, "What is Josephine's hospital room and board benefit?", {})).ms);
      const sorted = [...times].sort((x, y) => x - y); const p95 = sorted[Math.ceil(0.95 * sorted.length) - 1];
      record({ id: "T0-2", defect: "a factual question took roughly 40 seconds", pass: p95 <= 8000, detail: `5 stored-fact answers in-process: ${times.join(", ")} ms (p95 ${p95} ms; target <= 8000). In-process with the stand-in: excludes network/provider latency -- the browser journey measures the page.` });
    }
    // T0-3
    {
      const saved = { det: process.env.DEARPOLICY_DETERMINISTIC_MODEL, preset: process.env.MODEL_PRESET, key: process.env.OPENAI_API_KEY };
      process.env.DEARPOLICY_DETERMINISTIC_MODEL = ""; process.env.MODEL_PRESET = "openai"; process.env.OPENAI_API_KEY = "sk-synthetic-quota-test-not-a-key";
      quota = true; const before = providerCalls.length;
      let r: Awaited<ReturnType<typeof send>> | null = null; let threw: string | null = null;
      try { r = await Promise.race([send(members.marcus, "What happens when Marcus's endowment plan matures?", {}), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("no response within 30 s")), 30_000))]); }
      catch (e) { threw = (e as Error).message; }
      finally { quota = false; process.env.DEARPOLICY_DETERMINISTIC_MODEL = saved.det; process.env.MODEL_PRESET = saved.preset ?? ""; if (!saved.preset) delete process.env.MODEL_PRESET; if (saved.key) process.env.OPENAI_API_KEY = saved.key; else delete process.env.OPENAI_API_KEY; }
      const calls = providerCalls.length - before;
      const leaks = r ? LEAKS.map(([label, re]) => [label, r!.text.match(re)?.[0]] as const).filter(([, m]) => m) : [];
      const quotaText = r?.text.match(/quota|org-[A-Za-z0-9]|openai|billing|platform\.openai|insufficient_quota|\b429\b/i)?.[0];
      record({ id: "T0-3", defect: "the endowment question exposed a raw OpenAI quota error and organisation identifier", pass: !threw && !quotaText && !leaks.length && calls <= 3 && !!r && r.ms <= 30_000,
        detail: `${threw ? "no answer: " + threw : `HTTP ${r!.status} in ${r!.ms} ms`}; provider calls=${calls} (bound 3); provider text=${quotaText ?? "none"}; leaks=${leaks.map(([l, m]) => l + ":" + m).join(", ") || "none"}`, evidence: r?.text.slice(0, 600) });
    }
    // T0-4 / T0-5: complete the arm-fracture interview, then compare list status and detail estimate.
    {
      const conv: { id?: string; rev?: number } = {};
      const script = V11_QUESTIONS.find((q) => q.id === "Q13")!.interview!.replies;
      let r = await send(members.josephine, "Josephine broke her arm.", conv);
      for (let i = 0; i < 12; i++) {
        const q = r.a.questions?.[0] ?? r.a.factFinding?.find((p: any) => p.nextQuestions?.length)?.nextQuestions?.[0];
        if (!q) break;
        const reply = script.find((x) => new RegExp(x.match, "i").test(q.text))?.reply ?? "Not sure";
        const option = (q.options ?? []).find((o: string) => o.toLowerCase().startsWith(reply.toLowerCase()));
        const direct = r.a.questions?.[0] && q.type !== "date" && q.type !== "text";
        r = await send(members.josephine, direct && (option || !(q.options ?? []).length) ? (option ?? reply) : q.text.replace(/\?\s*$/, "") + ": " + (option ?? reply), conv);
      }
      const events = (await pool.query(`SELECT id,status,event_summary,event_type,facts FROM claim_sessions WHERE account_id=$1 AND family_member_id=$2`, [household, members.josephine])).rows;
      const { GET: indicative } = await import("@/app/api/claims/[id]/indicative/route");
      let displayStatus: ((c: any) => any) | null = null;
      try { displayStatus = (await import("@/lib/claims/status" as string)).claimDisplayStatus ?? null; } catch { displayStatus = null; }
      const rows = [] as { summary: string; status: string; listLabel: string; hasEstimate: boolean | null; requestedDocuments: string[] | null }[];
      for (const e of events) {
        const est = await (await indicative(new NextRequest(`http://localhost/api/claims/${e.id}/indicative`), { params: Promise.resolve({ id: e.id }) })).json().catch(() => ({}));
        // What the claims LIST shows: the list API's own `display` (claimDisplayStatus, shared interface 4) when present.
        const listed = await (await (await import("@/app/api/claims/route")).GET(new NextRequest("http://localhost/api/claims"))).json().catch(() => ({}));
        const fromList = (listed?.claims ?? []).find((c: any) => c.id === e.id)?.display ?? null;
        const shown = fromList ?? (displayStatus ? displayStatus({ ...e, hasEvidenceBackedEstimate: est?.estimate?.hasEstimate === true }) : null);
        rows.push({ summary: e.event_summary, status: e.status, listLabel: shown?.label ?? (e.status === "complete" ? "Assessment ready" : "Fact finding"), hasEstimate: est?.estimate?.hasEstimate ?? null,
          requestedDocuments: shown?.requestedDocuments ?? null });
      }
      const mismatch = rows.filter((x) => /ready/i.test(x.listLabel) && x.hasEstimate === false);
      record({ id: "T0-4", defect: "the claims list said \"Assessment ready\" while the detail page said \"No estimate yet\"", pass: rows.length > 0 && !mismatch.length,
        detail: rows.length ? rows.map((x) => `list "${x.listLabel}" (${displayStatus ? "claimDisplayStatus" : "claims page rule status==='complete'"}) vs detail hasEstimate=${x.hasEstimate}; event "${x.summary}"`).join("; ") : "the completed interview recorded no claim event", evidence: rows });
      if (displayStatus) {
        const death = rows.flatMap((x) => x.requestedDocuments ?? []).filter((t) => /death certificate|coroner/i.test(t));
        record({ id: "T0-5", defect: "a fracture claim's list action described death documents", pass: !death.length, detail: death.length ? `requested for a fracture: ${death.join("; ")}` : "no death documents requested for the fracture claim (claimDisplayStatus)" });
      } else record({ id: "T0-5", defect: "a fracture claim's list action described death documents", pass: false,
        detail: "lib/claims/status.ts claimDisplayStatus does not exist at this commit; the claims list renders a fixed 'Manage claim evidence (death certificate, police report, coroner's report)' action for every claim (app/claims/page.tsx) -- confirmed on the rendered page by e2e/tests/v11-journey.spec.ts (Task 0 page checks)" });
    }
    // T0-7
    {
      const { GET: usageRoute } = await import("@/app/api/usage/route");
      const u = await (await usageRoute(new NextRequest("http://localhost/api/usage"))).json().catch(() => ({}));
      const executions = (await pool.query(`SELECT count(*)::int n FROM model_executions WHERE household_ref=$1 AND created_at >= $2`, [pseudonymizeId(household), started])).rows[0].n;
      const usageRows = (await pool.query(`SELECT count(*)::int n FROM model_usage WHERE account_id=$1 AND at >= $2`, [household, started])).rows[0].n;
      const calls = Number(u?.usage?.calls ?? 0), roles = (u?.usage?.byRole ?? []).length, hardStop = u?.usage?.plan?.hardStopUsd;
      const noCalls = executions > 0 && (calls === 0 || roles === 0);
      const wrongStop = typeof hardStop === "number" && Math.abs(hardStop - 5) > 0.001;
      record({ id: "T0-7", defect: "usage said no model calls despite model activity, and showed a different hard stop than the owner's $5 API budget", pass: !noCalls && !wrongStop,
        detail: `model_executions for this household this run=${executions}; model_usage rows=${usageRows}; /api/usage calls=${calls}, byRole=${roles}; hard stop shown=${hardStop ?? "none"} (owner's provider cap: $5/month)`, evidence: u?.usage ? { calls, roles, plan: u.usage.plan } : u });
    }
    void moneyIn;
  } finally {
    await cleanup().catch((e) => console.error("cleanup failed: " + (e as Error).message));
  }
  await mkdir(OUT, { recursive: true });
  await writeFile(path.join(OUT, "task0.json"), JSON.stringify({ commit: process.env.V11_EVAL_COMMIT ?? null, run: process.env.E2E_RUN_ID, checks }, null, 2));
  await writeFile(path.join(OUT, "task0.md"), ["# Task 0 live-defect regression checks (in-process)", "", "| Check | Defect | Result | Detail |", "|---|---|---|---|",
    ...checks.map((c) => `| ${c.id} | ${c.defect} | ${c.pass ? "PASS" : "**FAIL**"} | ${c.detail.replace(/\|/g, "/")} |`), "",
    "T0-4/T0-5/T0-6/T0-7 rendered pages: e2e/tests/v11-journey.spec.ts (Task 0 page checks). T0-8 login: e2e/tests/v11-journey.spec.ts."].join("\n"));
  await pool.end().catch(() => undefined);
  process.exit(checks.every((c) => c.pass) ? 0 : 1);
}
main().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(2); });
