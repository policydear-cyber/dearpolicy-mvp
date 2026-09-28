/**
 * V1.1 independent evaluation runner.
 *
 *   --api [--out <dir>]        Ingest the whole synthetic dataset (e2e/support/v11-dataset.ts)
 *                              through the REAL processPolicy() into two synthetic households on
 *                              the LOCAL Postgres, ask every evaluation question through the REAL
 *                              chat API route (app/api/chat/route.ts) in-process, delete one
 *                              policy through the REAL DELETE route, reopen a conversation through
 *                              the history route, run the provider-quota case against a fake
 *                              provider that answers 429 insufficient_quota, score everything
 *                              (scripts/v11-eval-score.ts), record model_executions usage for the
 *                              run, then remove the run's synthetic data.
 *   --score <answers.json> [--out <dir>]
 *                              Score an answer set written by the browser journey
 *                              (e2e/tests/v11-journey.spec.ts).
 *   --export <dir>             Write the machine-readable eval set (eval-set.json), the dataset
 *                              manifest with each page's printed text, and the rendered files.
 *
 * Model: the deterministic stand-in (DEARPOLICY_DETERMINISTIC_MODEL=synthetic-e2e). Answers that
 * depend on a production model's reading are therefore a floor, not a ceiling -- recorded as such.
 * Environment: /home/user/e2e.env (local DATABASE_URL, STORAGE_DRIVER=local, E2E_RUN_ID). Run under
 * `flock /home/user/test.lock`. Exit code 1 when any release gate fails.
 */
import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";

process.env.E2E_RUN_ID ||= `v11eval${Date.now().toString(36)}`;
process.env.DEV_AUTH_ENABLED = "1";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };

async function exportSet(dir: string) {
  const { V11_QUESTIONS, COVERAGE, datasetDocs, renderDataset, printedText, PEOPLE, UPLOAD_ORDER } = await import("../e2e/support/v11-dataset");
  await mkdir(path.join(dir, "files"), { recursive: true });
  const rendered = await renderDataset();
  for (const d of rendered) await writeFile(path.join(dir, "files", d.fileName), d.buffer);
  await writeFile(path.join(dir, "eval-set.json"), JSON.stringify({
    description: "DearPolicy V1.1 independent evaluation set. Patterns are case-insensitive RegExp sources. See e2e/support/v11-dataset.ts.",
    people: PEOPLE, uploadOrder: UPLOAD_ORDER, coverage: COVERAGE,
    documents: datasetDocs().map((d) => ({ key: d.key, household: d.household, person: d.person, format: d.format, productName: d.productName, policyNumber: d.policyNumber,
      documentRole: d.documentRole, effectiveDate: d.effectiveDate, expiryDate: d.expiryDate, lifecycle: d.lifecycle, supersedes: d.supersedes ?? null, covers: d.covers, notes: d.notes,
      fileName: rendered.find((r) => r.key === d.key)!.fileName, pages: printedText(d).map((text, i) => ({ page: i + 1, text })) })),
    questions: V11_QUESTIONS,
  }, null, 2));
  console.log(`exported ${rendered.length} documents and ${V11_QUESTIONS.length} questions to ${dir}`);
}

async function scoreFile(file: string, out: string) {
  const { scoreAnswers, scoreMarkdown } = await import("./v11-eval-score");
  const data = JSON.parse(await readFile(file, "utf8"));
  const answers = data.answers ?? data;
  const score = scoreAnswers(answers, { deletedDocs: data.deletedDocs, supersededDocs: data.supersededDocs });
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, "score.json"), JSON.stringify(score, null, 2));
  await writeFile(path.join(out, "report.md"), scoreMarkdown(`V1.1 evaluation — ${data.source ?? path.basename(file)}`, score, answers));
  printSummary(score);
  return score;
}

function printSummary(score: import("./v11-eval-score").Score) {
  console.log("\nRELEASE GATES");
  for (const [g, r] of Object.entries(score.gates)) console.log(`  ${r.pass ? "PASS" : "FAIL"} ${g} (${r.count})`);
  console.log(`TIMING factual p50=${score.timings.factual.p50} p95=${score.timings.factual.p95} (n=${score.timings.factual.n}); interview p50=${score.timings.interview.p50} p95=${score.timings.interview.p95} (n=${score.timings.interview.n})`);
  for (const v of score.violations) console.log(`  VIOLATION ${v.qid} [${v.gate}] ${v.detail}`);
}

async function apiRun(out: string) {
  const url = process.env.DATABASE_URL ?? "";
  const host = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
  const { deterministicModelEnabled } = await import("@/lib/ai/deterministic-model");
  if (!["localhost", "127.0.0.1"].includes(host) || !deterministicModelEnabled() || (process.env.STORAGE_DRIVER ?? "") !== "local")
    throw new Error("--api needs a LOCAL DATABASE_URL, STORAGE_DRIVER=local and DEARPOLICY_DETERMINISTIC_MODEL=synthetic-e2e with E2E_RUN_ID (source /home/user/e2e.env)");
  const started = new Date();
  const { NextRequest } = await import("next/server");
  const { pool } = await import("@/lib/db/client");
  const { ensureDefaultHousehold } = await import("@/lib/household/repo");
  const { savePolicyFile } = await import("@/lib/storage");
  const { processPolicy } = await import("@/lib/rag/ingest");
  const { supersedePolicyDocument } = await import("@/lib/policies/quarantine/store");
  const { pseudonymizeId } = await import("@/lib/telemetry/pseudonymize");
  const { renderDataset, PEOPLE, UPLOAD_ORDER, V11_QUESTIONS, PREFIX } = await import("../e2e/support/v11-dataset");
  const { scoreAnswers, scoreMarkdown } = await import("./v11-eval-score");
  const cleanup = (await import("../e2e/support/cleanup")).default;
  const rows = async <T = any>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as T[];

  const users = { A: randomUUID(), B: randomUUID() };
  process.env.E2E_USER_A = users.A; process.env.E2E_USER_B = users.B;
  const households = { A: await ensureDefaultHousehold(users.A, `${PREFIX}-Household-A`), B: await ensureDefaultHousehold(users.B, `${PREFIX}-Household-B`) };
  console.log(`run ${PREFIX}: households A=${households.A} B=${households.B}`);
  const memberIds: Record<string, string> = {};
  for (const [key, p] of Object.entries(PEOPLE)) {
    memberIds[key] = randomUUID();
    await pool.query(`INSERT INTO family_members(id,account_id,display_name,preferred_name,relationship) VALUES($1,$2,$3,$4,$5)`, [memberIds[key], households[p.household], p.fullName, p.preferred, p.relationship]);
  }
  const asUser = (h: "A" | "B") => { process.env.DEV_ACCOUNT_ID = users[h]; };

  // ---------------- ingestion
  const rendered = await renderDataset();
  const policyIds: Record<string, string> = {};
  const ingestion: Record<string, unknown>[] = [];
  let failures = 0;
  const report: string[] = [];
  try {
    for (const key of UPLOAD_ORDER) {
      const d = rendered.find((r) => r.key === key)!;
      const account = households[d.household];
      const member = d.person ? memberIds[d.person] : memberIds[d.household === "A" ? "marcus" : "charmaineB"];
      const policyId = randomUUID(); policyIds[key] = policyId;
      const bytes = new Uint8Array(d.buffer);
      const t0 = Date.now();
      const storageKey = await savePolicyFile({ accountId: account, familyMemberId: member, policyId, filename: d.fileName, bytes });
      // Scanner covered by its own suites: documents start cleared (no scanner service in-process).
      await pool.query(`INSERT INTO policies(id,account_id,family_member_id,original_filename,storage_key,file_hash,processing_status,processing_stage,processing_progress,processing_message,quarantine_status,scan_provider,scanned_at,supersedes_id)
        VALUES($1,$2,$3,$4,$5,$6,'queued','queued',1,'Waiting','scan_clean','v11-eval',now(),$7)`,
        [policyId, account, member, d.fileName, storageKey, createHash("sha256").update(bytes).digest("hex"), d.supersedes ? policyIds[d.supersedes] : null]);
      if (d.supersedes) await supersedePolicyDocument({ accountId: account, oldPolicyId: policyIds[d.supersedes], newPolicyId: policyId });
      let threw: string | null = null;
      try {
        await Promise.race([processPolicy({ accountId: account, familyMemberId: member, policyId, storageKey, linkUploadMember: !!d.person }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("processPolicy did not finish within 120 s")), 120_000))]);
      } catch (e) { threw = (e instanceof Error ? e.message : String(e)).split("\n")[0].slice(0, 300); }
      const ms = Date.now() - t0;
      const [p] = await rows(`SELECT processing_status,processing_stage,processing_progress,processing_message,processing_error,needs_review,review_reason,document_role,personal_coverage_confirmed,product_name,policy_number,superseded_at IS NOT NULL AS superseded FROM policies WHERE id=$1`, [policyId]);
      const links = await rows(`SELECT fm.preferred_name AS who,pm.source FROM policy_members pm JOIN family_members fm ON fm.id=pm.family_member_id WHERE pm.policy_id=$1`, [policyId]);
      const benefits = await rows(`SELECT benefit_name,formula_kind,formula_value::float AS value,currency,source_page FROM policy_benefits WHERE policy_id=$1 ORDER BY source_page,benefit_name`, [policyId]);
      const coverages = await rows(`SELECT category,amount::float AS amount,currency,source_page FROM policy_coverages WHERE policy_id=$1`, [policyId]);
      const pages = (await rows<{ n: number }>(`SELECT count(*)::int n FROM policy_pages WHERE policy_id=$1`, [policyId]))[0].n;
      const expectedTerminal = d.lifecycle === "unreadable" ? ["failed", "error"] : ["ready"];
      const terminalOk = expectedTerminal.includes(p.processing_status);
      const expectedLink = d.person ? PEOPLE[d.person].preferred : null;
      const linkOk = !expectedLink || d.lifecycle === "unreadable" || links.some((l) => l.who === expectedLink);
      const rec = { key, file: d.fileName, household: d.household, person: d.person, ms, threw, ...p, links, pages, benefits, coverages, terminalOk, linkOk };
      ingestion.push(rec);
      if (!terminalOk || !linkOk) failures++;
      console.log(`ingest ${key.padEnd(24)} ${String(ms).padStart(6)}ms ${p.processing_status}/${p.processing_stage} links=${links.map((l) => l.who + ":" + l.source).join(",") || "-"} benefits=${benefits.length} pages=${pages}${threw ? " THREW " + threw : ""}${p.processing_error ? " error=" + String(p.processing_error).slice(0, 120) : ""}`);
    }
    // Evidence provenance columns the V1.1 contract adds (COMMON.md interface 1): present or not.
    const evidenceCols = await rows<{ table_name: string; column_name: string }>(`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'
      AND ((table_name IN ('policy_benefits','policy_coverages','coverage_rules') AND column_name IN ('source_text_start','source_text_end','extraction_method','passage_verified','conflict_note'))
        OR (table_name='policies' AND column_name='document_date'))`);
    // What the household sees on the documents list (user-facing processing messages).
    asUser("A");
    const { GET: listPolicies } = await import("@/app/api/policies/route");
    const listed = await (await listPolicies(new NextRequest("http://localhost/api/policies"))).json();
    const userFacing = (listed.policies ?? []).map((p: any) => ({ file: p.original_filename, status: p.processing_status, message: p.processing_message, error: p.processing_error, review: p.review_reason }));

    // ---------------- chat
    const { POST } = await import("@/app/api/chat/route");
    const { DELETE: deletePolicy } = await import("@/app/api/policies/[id]/route");
    const { GET: getSavedChat } = await import("@/app/api/chat/history/[id]/route");
    const docByPolicy = new Map(Object.entries(policyIds).map(([k, v]) => [v, k]));
    const convs: Record<string, { id?: string; rev?: number; last?: any }> = {};
    const answers: import("./v11-eval-score").AnswerRecord[] = [];
    const providerCalls: string[] = [];
    const realFetch = globalThis.fetch;
    let quotaMode = false;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const u = String(input instanceof Request ? input.url : input);
      providerCalls.push((quotaMode ? "[quota] " : "") + u.replace(/\?.*$/, ""));
      if (quotaMode) return new Response(JSON.stringify({ error: { message: "You exceeded your current quota, please check your plan and billing details. For more information on this error, read the docs: https://platform.openai.com/docs/guides/error-codes/api-errors. (organization: org-SynthTestOrg12345)", type: "insufficient_quota", param: null, code: "insufficient_quota" } }),
        { status: 429, headers: { "content-type": "application/json", "x-request-id": "req_synthetic_quota" } });
      throw new Error("network disabled in the v11 evaluation (no provider is reachable)");
    }) as typeof fetch;
    void realFetch;

    const visibleText = (a: any): string => {
      const parts: string[] = [a.summary ?? "", ...(a.details ?? []), ...(a.nextSteps ?? []), a.disclaimer ?? ""];
      for (const q of a.questions ?? []) parts.push(q.text, q.why ?? "", ...(q.options ?? []));
      for (const i of a.claimItems ?? []) parts.push(i.title, i.reason, ...(i.conditions ?? []), i.amountText ?? "");
      for (const c of a.citations ?? []) parts.push(`${c.policyName} ${c.evidenceLabel ?? ""} Page ${c.pageStart}`);
      parts.push(...(a.knownFacts ?? []));
      for (const p of a.factFinding ?? []) parts.push(p.label ?? "", p.subjectName ?? "", ...(p.missingDocuments ?? []), ...(p.reviewerRequirements ?? []), ...(p.nextQuestions ?? []).map((q: any) => q.text + " " + (q.why ?? "")));
      for (const r of a.policyReview ?? []) parts.push(r.ownerName, r.policyName);
      if (a.reviewCoverage?.statement) parts.push(a.reviewCoverage.statement);
      for (const p of a.portfolioItems ?? []) parts.push(p.ownerName, p.policyName, ...(p.coverages ?? []).map((c: any) => `${c.productName ?? c.category} ${c.amount != null ? (c.currency === "SGD" ? "S$" : c.currency === "USD" ? "US$" : "") + Number(c.amount).toLocaleString("en-US") : ""} ${c.currency && !["SGD", "USD"].includes(c.currency) ? c.currency : ""}`));
      for (const l of a.policyStatedLimits ?? []) parts.push(l.amountText, l.benefitTitle, l.quote);
      for (const c of a.personCandidates ?? []) parts.push(c.label);
      return parts.filter(Boolean).join("\n");
    };
    const citationsOf = (a: any) => [...(a.citations ?? []), ...(a.policyStatedLimits ?? []).map((l: any) => l.citation).filter(Boolean)]
      .map((c: any) => ({ doc: (docByPolicy.get(c.policyId) as any) ?? null, policyName: c.policyName ?? "", page: c.pageStart ?? null }));

    const ask = async (q: (typeof V11_QUESTIONS)[number], override?: { text: string; qid: string }) => {
      asUser(q.household);
      const conv = (convs[q.conversation] ??= {});
      const t0 = Date.now();
      let answer: any = null, error: string | null = null;
      const callsBefore = providerCalls.length;
      try {
        const response = await Promise.race([
          POST(new NextRequest("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ familyMemberId: memberIds[q.person], scope: "member", question: override?.text ?? q.text, conversationId: conv.id, conversationRevision: conv.rev, asynchronous: false, timeZone: "Asia/Singapore" }) })),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("no answer within 60 s")), 60_000)),
        ]);
        const data = await response.json();
        if (response.status !== 200) error = `HTTP ${response.status}: ${JSON.stringify(data).slice(0, 400)}`;
        answer = data.answer ?? null;
        if (answer?.conversationId) { conv.id = answer.conversationId; conv.rev = answer.conversationRevision; conv.last = answer; }
      } catch (e) { error = (e instanceof Error ? e.message : String(e)).split("\n")[0]; }
      const ms = Date.now() - t0;
      const next = answer?.questions?.[0]?.text ?? answer?.factFinding?.find((p: any) => p.nextQuestions?.length)?.nextQuestions?.[0]?.text ?? null;
      const rec = { qid: override?.qid ?? q.id, visible: answer ? visibleText(answer) : (error ? "[the app showed an error]: " + error : ""), citations: answer ? citationsOf(answer) : [], ms, error, nextQuestion: next,
        extra: { mode: answer?.mode ?? null, providerCalls: providerCalls.length - callsBefore, claimSessionId: answer?.claimSessionId ?? null, questionCount: answer?.questions?.length ?? 0, sent: override?.text ?? q.text } as Record<string, unknown> };
      answers.push(rec);
      console.log(`${override?.qid ?? q.id} ${String(ms).padStart(6)}ms [${answer?.mode ?? "-"}] ${override?.text ?? q.text}\n    -> ${(rec.visible || "").replace(/\s+/g, " ").slice(0, 260)}${next ? "\n    next: " + next : ""}${error ? "\n    ERROR " + error.slice(0, 200) : ""}`);
      return rec;
    };

    /** Answers the app's pending question the way the chat UI does: an option button sends the option's
     * text; a date/text question (and a fact-finding plan question) sends "<question>: <answer>". */
    const replyFor = (last: any, replies: { match: string; reply: string }[]) => {
      const direct = last?.questions?.[0];
      const plan = last?.factFinding?.find((p: any) => p.nextQuestions?.length)?.nextQuestions?.[0];
      const question = direct ?? plan;
      if (!question) return null;
      const reply = replies.find((r) => new RegExp(r.match, "i").test(question.text))?.reply ?? "Not sure";
      const option = (question.options ?? []).find((o: string) => o.toLowerCase().startsWith(reply.toLowerCase())) ?? null;
      if (direct && direct.type !== "date" && direct.type !== "text" && (option || !(question.options ?? []).length)) return option ?? reply;
      return String(question.text).replace(/\?\s*$/, "") + ": " + (option ?? reply);
    };
    let lastInterviewStep: import("./v11-eval-score").AnswerRecord | null = null;
    const runQuestion = async (q: (typeof V11_QUESTIONS)[number]) => {
      if (!q.mode) return ask(q);
      if (q.mode === "interview") {
        const conv = convs[q.conversation];
        let finished = false;
        for (let step = 1; step <= q.interview!.maxSteps; step++) {
          const text = replyFor(conv?.last, q.interview!.replies);
          if (!text) { finished = true; break; }
          lastInterviewStep = await ask(q, { text, qid: `${q.id}.${step}` });
          if (lastInterviewStep.error) break;
        }
        if (lastInterviewStep) (lastInterviewStep.extra as any).finished = finished || !replyFor(convs[q.conversation]?.last, q.interview!.replies);
        return;
      }
      if (q.mode === "interview_final") {
        if (lastInterviewStep) answers.push({ ...lastInterviewStep, qid: q.id, extra: { ...(lastInterviewStep.extra ?? {}), finalOf: lastInterviewStep.qid } });
        return;
      }
      if (q.mode === "reopen") return reopen(q);
      if (q.mode === "provider_quota_failure") return quota(q);
    };
    // Reopen a conversation through the history route (what the chat page loads) + the claim-event checks.
    const reopen = async (q: (typeof V11_QUESTIONS)[number]) => {
      asUser("A");
      const conv = convs["c-injury"];
      const t0 = Date.now();
      const saved = conv?.id ? await (await getSavedChat(new NextRequest(`http://localhost/api/chat/history/${conv.id}`), { params: Promise.resolve({ id: conv.id }) })).json() : null;
      const msgs = saved?.messages ?? [];
      const lastAnswer = [...msgs].reverse().find((m: any) => m.answer_json)?.answer_json ?? null;
      const events = await rows(`SELECT id,event_summary,status,event_type,conversation_id FROM claim_sessions WHERE account_id=$1 AND family_member_id=$2`, [households.A, memberIds.charmaine]).catch(() => []);
      const claimStatus: Record<string, unknown>[] = [];
      let displayStatus: ((c: any) => any) | null = null;
      try { displayStatus = (await import(/* webpackIgnore: true */ "@/lib/claims/status" as string)).claimDisplayStatus ?? null; } catch { displayStatus = null; }
      const { GET: indicative } = await import("@/app/api/claims/[id]/indicative/route");
      for (const e of events) {
        let hasEstimate: boolean | null = null;
        try { const r = await (await indicative(new NextRequest(`http://localhost/api/claims/${e.id}/indicative`), { params: Promise.resolve({ id: e.id }) })).json(); hasEstimate = r?.estimate?.hasEstimate ?? r?.hasEstimate ?? null; } catch { hasEstimate = null; }
        // What the claims LIST shows: the list API's own `display` (claimDisplayStatus, shared interface 4) when present.
        const listed = await (await (await import("@/app/api/claims/route")).GET(new NextRequest("http://localhost/api/claims"))).json().catch(() => ({}));
        const fromList = (listed?.claims ?? []).find((c: any) => c.id === e.id)?.display ?? null;
        const shown = fromList ?? (displayStatus ? displayStatus({ ...e, hasEvidenceBackedEstimate: hasEstimate === true }) : null);
        claimStatus.push({ summary: e.event_summary, status: e.status, listLabel: shown?.label ?? (e.status === "complete" ? "Assessment ready" : "Fact finding"), labelSource: shown ? "claimDisplayStatus" : "app/claims/page.tsx rule (status==='complete')", hasEstimate, requestedDocuments: shown?.requestedDocuments ?? null });
      }
      const sameLast = !!lastAnswer && lastAnswer.summary === conv?.last?.summary;
      const nextNow = lastAnswer?.questions?.[0]?.text ?? null, nextBefore = conv?.last?.questions?.[0]?.text ?? null;
      answers.push({ qid: q.id, visible: lastAnswer ? visibleText(lastAnswer) : "", citations: lastAnswer ? citationsOf(lastAnswer) : [], ms: Date.now() - t0, nextQuestion: nextNow,
        extra: { sameLastAnswer: sameLast, sameNextQuestion: nextNow === nextBefore, claimEvents: events.length, claimStatus,
          eventNamedAnAccident: events.some((e: any) => /^an accident\.?$/i.test(String(e.event_summary ?? "").trim())),
          eventsNamedAfterReplies: events.map((e: any) => String(e.event_summary ?? "").trim()).filter((sum: string) => sum && answers.some((x) => /^Q1[2-6]/.test(x.qid) && String((x.extra as any)?.sent ?? "").trim() === sum)) } });
      console.log(`${q.id} reopen: sameLast=${sameLast} next ${nextBefore} -> ${nextNow}; claim events=${events.length} ${JSON.stringify(claimStatus)}`);
    };
    // Provider quota failure: every provider call answers 429 insufficient_quota with an organisation id.
    const quota = async (q: (typeof V11_QUESTIONS)[number]) => {
      const saved = { det: process.env.DEARPOLICY_DETERMINISTIC_MODEL, preset: process.env.MODEL_PRESET, key: process.env.OPENAI_API_KEY };
      process.env.DEARPOLICY_DETERMINISTIC_MODEL = ""; process.env.MODEL_PRESET = "openai"; process.env.OPENAI_API_KEY = "sk-synthetic-quota-test-not-a-key";
      quotaMode = true;
      try { await ask(q); } finally {
        quotaMode = false;
        process.env.DEARPOLICY_DETERMINISTIC_MODEL = saved.det; if (saved.preset === undefined) delete process.env.MODEL_PRESET; else process.env.MODEL_PRESET = saved.preset;
        if (saved.key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = saved.key;
      }
    };

    for (const q of V11_QUESTIONS.filter((x) => x.phase === "pre")) await runQuestion(q);
    // Delete Marcus's AccidentGuard through the app's DELETE route, then the post-deletion questions.
    asUser("A");
    const del = await deletePolicy(new NextRequest(`http://localhost/api/policies/${policyIds.accidentMarcus}`, { method: "DELETE" }), { params: Promise.resolve({ id: policyIds.accidentMarcus }) });
    const deletion = { status: del.status, body: await del.json().catch(() => null) };
    console.log(`deleted accidentMarcus: HTTP ${deletion.status}`);
    for (const q of V11_QUESTIONS.filter((x) => x.phase === "post")) await runQuestion(q);

    // ---------------- model usage for this run
    const refs = [pseudonymizeId(households.A), pseudonymizeId(households.B)];
    const usage = await rows(`SELECT operation, resolved_provider, coalesce(resolved_model,requested_model) AS model, status, count(*)::int AS calls, sum(input_tokens)::int AS input_tokens, sum(output_tokens)::int AS output_tokens,
        coalesce(sum(cost_usd),0)::float AS cost_usd, round(avg(latency_ms))::int AS avg_latency_ms, max(attempt_index)::int AS max_attempt_index
      FROM model_executions WHERE household_ref = ANY($1) AND created_at >= $2 GROUP BY 1,2,3,4 ORDER BY 1,3`, [refs, started]);
    const jobs = await rows(`SELECT job_type,status,max(attempt_count)::int AS max_attempts,count(*)::int AS n FROM background_jobs WHERE account_id = ANY($1) GROUP BY 1,2`, [[households.A, households.B]]).catch(() => []);

    const { LEAKS } = await import("./v11-eval-score");
    const ingestViolations: import("./v11-eval-score").Violation[] = [];
    for (const u of userFacing) for (const field of ["message", "error", "review"] as const) {
      const t = String(u[field] ?? ""); if (!t) continue;
      for (const [label, re] of LEAKS) { const m = t.match(re); if (m) ingestViolations.push({ qid: "INGEST", gate: "internal_text", detail: `documents page, ${u.file.replace(PREFIX + "-", "")} (${field}): ${label}: "${m[0]}" in "${t.slice(0, 140)}"` }); }
    }
    const unreadable = userFacing.find((u: any) => /DentalCare-scan/.test(u.file));
    if (unreadable && !(unreadable.error || unreadable.message)) ingestViolations.push({ qid: "INGEST", gate: "blocked_gap", detail: "the unreadable document shows no customer message" });
    const score = scoreAnswers(answers, { extraViolations: ingestViolations });
    const ingestionGate = { pass: failures === 0, count: failures };
    await mkdir(out, { recursive: true });
    const meta = { source: "in-process chat API (app/api/chat/route.ts) on local Postgres, deterministic model stand-in", prefix: PREFIX, started: started.toISOString(), finished: new Date().toISOString(),
      commit: process.env.V11_EVAL_COMMIT ?? null, node: process.version, households, deletion, evidenceColumnsPresent: evidenceCols, providerCallsDuringQuota: providerCalls.filter((c) => c.startsWith("[quota]")) };
    await writeFile(path.join(out, "answers.json"), JSON.stringify({ ...meta, deletedDocs: ["accidentMarcus"], supersededDocs: ["hosp2022"], answers }, null, 2));
    await writeFile(path.join(out, "ingestion.json"), JSON.stringify({ gate: ingestionGate, documents: ingestion, userFacing }, null, 2));
    await writeFile(path.join(out, "model-usage.json"), JSON.stringify({ usage, jobs }, null, 2));
    await writeFile(path.join(out, "score.json"), JSON.stringify({ ...score, ingestionGate }, null, 2));
    report.push(scoreMarkdown(`V1.1 evaluation (in-process API) — ${PREFIX}`, score, answers),
      "", "## Ingestion (terminal state + linking)", "", "| Doc | Status | Stage | Links | Benefits | Pages | ms | Error |", "|---|---|---|---|---|---|---|---|",
      ...ingestion.map((r: any) => `| ${r.key} | ${r.processing_status} | ${r.processing_stage} | ${r.links.map((l: any) => l.who + ":" + l.source).join(", ")} | ${r.benefits.length} | ${r.pages} | ${r.ms} | ${String(r.processing_error ?? r.threw ?? "").slice(0, 80)} |`),
      "", `Evidence provenance columns present: ${evidenceCols.map((c) => c.table_name + "." + c.column_name).join(", ") || "none"}`,
      "", "## Model usage (model_executions, this run)", "", "| Operation | Provider | Model | Status | Calls | In | Out | Cost USD |", "|---|---|---|---|---|---|---|---|",
      ...usage.map((u: any) => `| ${u.operation} | ${u.resolved_provider} | ${u.model} | ${u.status} | ${u.calls} | ${u.input_tokens} | ${u.output_tokens} | ${u.cost_usd} |`),
      "", `Provider calls attempted during the quota case: ${meta.providerCallsDuringQuota.length}`);
    await writeFile(path.join(out, "report.md"), report.join("\n"));
    printSummary(score);
    console.log(`  ${ingestionGate.pass ? "PASS" : "FAIL"} ingestion_terminal_and_linking (${ingestionGate.count})`);
    console.log(`provider calls during the quota case: ${meta.providerCallsDuringQuota.length}`);
    return Object.values(score.gates).every((g) => g.pass) && ingestionGate.pass;
  } finally {
    if (process.env.V11_EVAL_KEEP !== "yes") { await cleanup().catch((e) => console.error("cleanup failed: " + (e instanceof Error ? e.message : e))); }
    else console.log(`V11_EVAL_KEEP=yes: data kept for ${PREFIX} (users A=${users.A} B=${users.B})`);
  }
}

/** Model calls and cost for one run, from model_executions (recorded usage), by operation and model. */
async function usageReport(since: string, journeyFile: string | undefined, out: string) {
  const { pool } = await import("@/lib/db/client");
  const { pseudonymizeId } = await import("@/lib/telemetry/pseudonymize");
  const j = journeyFile ? JSON.parse(await readFile(journeyFile, "utf8")) : {};
  const households = [j.householdA ?? j.ids?.householdA, j.householdB ?? j.ids?.householdB].filter(Boolean) as string[];
  const refs = households.map((h) => pseudonymizeId(h));
  const rows = (await pool.query(`SELECT operation, coalesce(resolved_model,requested_model) AS model, status, count(*)::int AS calls, sum(input_tokens)::int AS input_tokens,
      sum(output_tokens)::int AS output_tokens, coalesce(sum(cost_usd),0)::float AS cost_usd, round(avg(latency_ms))::int AS avg_latency_ms, max(attempt_index)::int AS max_attempt_index
    FROM model_executions WHERE created_at >= $1 AND (household_ref = ANY($2) OR $3::boolean) GROUP BY 1,2,3 ORDER BY 1,2`, [since, refs, !refs.length])).rows;
  const total = rows.reduce((a: any, r: any) => ({ calls: a.calls + r.calls, cost: a.cost + Number(r.cost_usd) }), { calls: 0, cost: 0 });
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, "model-usage.json"), JSON.stringify({ since, households, scope: refs.length ? "this run's households" : "every household since the start (no household ids given)", total, rows }, null, 2));
  await writeFile(path.join(out, "model-usage.md"), ["# Model calls and cost (model_executions)", "", `Since ${since}; ${refs.length ? "households " + households.join(", ") : "all households"}. Total: ${total.calls} calls, $${total.cost.toFixed(6)}.`, "",
    "| Operation | Model | Status | Calls | In | Out | Cost USD | Avg latency ms | Max attempt |", "|---|---|---|---|---|---|---|---|---|",
    ...rows.map((r: any) => `| ${r.operation} | ${r.model} | ${r.status} | ${r.calls} | ${r.input_tokens} | ${r.output_tokens} | ${r.cost_usd} | ${r.avg_latency_ms} | ${r.max_attempt_index} |`)].join("\n"));
  console.log(`model usage since ${since}: ${total.calls} calls, $${total.cost.toFixed(6)}`);
  await pool.end().catch(() => undefined);
}

async function main() {
  const keep = setInterval(() => undefined, 1000);
  const stamp = (process.env.E2E_RUN_ID ?? "").replace(/[^A-Za-z0-9]/g, "");
  if (process.argv.includes("--export")) { await exportSet(arg("--export")!); clearInterval(keep); return; }
  if (process.argv.includes("--usage")) { await usageReport(arg("--since")!, arg("--journey"), arg("--out") ?? path.resolve("docs/verification/v11/usage-" + stamp)); clearInterval(keep); return; }
  if (process.argv.includes("--score")) { const s = await scoreFile(arg("--score")!, arg("--out") ?? path.resolve("docs/verification/v11/score-" + stamp)); clearInterval(keep); process.exit(Object.values(s.gates).every((g) => g.pass) ? 0 : 1); }
  if (process.argv.includes("--api")) {
    const ok = await apiRun(arg("--out") ?? path.resolve("docs/verification/v11/api-" + stamp));
    clearInterval(keep);
    const { pool } = await import("@/lib/db/client"); await pool.end().catch(() => undefined);
    process.exit(ok ? 0 : 1);
  }
  console.log("usage: --api [--out dir] | --score <answers.json> [--out dir] | --export <dir>"); clearInterval(keep); process.exit(2);
}
main().catch((e) => { console.error(e instanceof Error ? e.stack : e); process.exit(2); });
