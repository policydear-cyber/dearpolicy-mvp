/**
 * Checkpoint 14g, Stage 3/9: chat and claim flow.
 *
 * Genuinely NEW coverage relative to scripts/full-household-e2e-
 * regressions.ts, which never touches app/api/chat/** at all and
 * substitutes claim-session creation with a direct
 * lib/claims/session.ts createClaimSession() call. This stage calls the
 * REAL POST /api/chat route (both synchronously and through its real
 * 202/durable-job path, polling the real GET /api/chat/jobs/[id] route),
 * with global.fetch mocked for the AI provider call exactly the way
 * scripts/model-provenance-regressions.ts's own already-accepted pattern
 * does (ANTHROPIC_API_KEY set to a fake value so lib/ai/providers.ts's
 * anthropicMessages() is reached at all; a matching response only for
 * lib/chat/facts.ts's interpretMessage() call, identified by its own
 * system prompt text; every OTHER structuredCompletion() call downstream
 * (policy-analysis, relevance-judge, benefit-catalog explanation, etc.)
 * gets a deliberate failure response, which lib/chat/workflow.ts's own
 * bare try/catch blocks around each of them already swallow by design
 * ("an answer is still better than no answer") -- this is NOT a gap this
 * stage papers over, it is the codebase's own documented fault-tolerance
 * for a document/AI step that did not complete, exercised for real).
 *
 * Checkpoint 16: claim-session creation now goes through the REAL route
 * too, closing the last of the 3 documented E2E substitutions.
 *
 * Confirmed architecturally, not assumed, that there is no dedicated
 * REST route to call for this: grepping the whole tree, createClaimSession()
 * (lib/claims/session.ts) has exactly two callers, lib/claims/record.ts's
 * recordClaim() and the legacy/unused lib/claims/orchestrator.ts's
 * handleClaimTurn() (that second one is dead for real traffic -- see
 * lib/rag/chat.ts's askDearPolicy(), the function app/api/chat/route.ts
 * actually calls: it is only askContextualDearPolicy() from
 * lib/chat/workflow.ts, never the orchestrator's legacyAskDearPolicy()
 * path). app/api/claims/route.ts itself exports GET only. So the real
 * route for this IS the real POST /api/chat route this stage already
 * calls -- recordClaim() is a real, in-process side effect of a real
 * claim being assessed inside lib/chat/workflow.ts's askContextualDearPolicy(),
 * not a separate endpoint.
 *
 * Reaching that real call site needs the household to already have a
 * real, benefit-catalog-indexed ("clean-scanned and read") policy --
 * stage 2's own policy is deliberately quarantine-rejected (zero
 * readable chunks), so it alone never gets there. Rather than run a
 * document through pdf.js/AI extraction for that (the exact sandbox
 * memory ceiling scripts/full-household-e2e-regressions.ts's own header
 * already documents as unsafe here, and the reason that suite substitutes
 * too), this stage seeds a second policy's already-read state directly
 * via SQL -- policy_pages/policy_chunks/policy_coverages/policy_benefits
 * -- the exact same already-accepted fixture pattern
 * scripts/system-database-regressions.ts's own seedReviewFixture() (and
 * its "A correction outranks the parser..." test, which drives this
 * identical benefit shape through this identical real chat route to a
 * real calculated claim) already uses and already proves reaches
 * lib/claims/record.ts's recordClaim() for real. This is a precondition
 * a real upload+extraction pipeline would itself have produced (that
 * pipeline's OWN success path is proven elsewhere: scripts/model-
 * provenance-regressions.ts, scripts/rollout-staleness-regressions.ts) --
 * not a substitute for the operation actually under test here, which is
 * claim-session creation through the real route, exercised for real
 * below.
 */
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { runStage, asUser, requestFor, waitFor, readHandoff, requireHandoff, writeHandoff } from "@/scripts/e2e/shared";
import { claimAndProcessOne } from "@/lib/jobs/worker-runtime";
import { PRODUCTION_JOB_TYPES } from "@/lib/jobs/processors";

function mockAnthropicFetch() {
  return (async (_url: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String((init as any)?.body ?? "{}"));
    const systemText: string = Array.isArray(body.system) ? String(body.system[0]?.text ?? "") : String(body.system ?? "");
    if (systemText.includes("Interpret this insurance conversation")) {
      const userPayload = JSON.parse(String(body.messages?.[0]?.content ?? "{}"));
      const message: string = String(userPayload.currentMessage ?? "");
      const subject: string = String(userPayload.subjects?.[0]?.id ?? "s1");
      // A real reported illness event -- the exact detection + fact shape
      // scripts/system-database-regressions.ts's own already-accepted
      // interpretation mock uses for this identical message, reused here
      // rather than reinvented, so this is a known-good combination against
      // the real workflow, not a first attempt at one.
      const interpretation = /breast cancer/i.test(message)
        ? {
            intent: "claim",
            newTopic: true,
            searchTerms: ["critical illness", "major cancer"],
            facts: [
              { subjectId: subject, key: "eventType", value: "diagnosis", state: "known", quote: message },
              { subjectId: subject, key: "diagnosis", value: "stage 2 breast cancer", state: "known", quote: message },
            ],
            scenarioCandidates: [
              { subjectId: subject, label: "Breast cancer diagnosis", family: "illness", traits: ["illness", "diagnosis"], quote: message },
            ],
          }
        : { intent: "policy_question", newTopic: true, searchTerms: ["hospitalisation", "coverage"], facts: [] };
      return new Response(
        JSON.stringify({
          id: "msg_e2e_chat_001",
          model: "claude-haiku-4-5-20250620",
          content: [{ type: "text", text: JSON.stringify(interpretation) }],
          stop_reason: "end_turn",
          usage: { input_tokens: 100, output_tokens: 20 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    // Every other structured-completion call in this journey's questions
    // (policy relevance judging, benefit-catalog explanation, etc.)
    // deliberately fails here -- lib/chat/workflow.ts's own bare
    // try/catch blocks around each of those calls are what this
    // exercises for real. Deliberately a 400, NOT a 500/429: those two
    // statuses are exactly what lib/ai/providers.ts's withRetries()
    // treats as "server busy" and retries up to 8 times with exponential
    // backoff (2s,4s,8s,16s,32s,60s,60s -- up to ~182s for a SINGLE
    // call that will never succeed against this mock); measured directly
    // in this checkpoint, several such calls compounding pushed step 4
    // past a 170s wait and even a 200s orchestrator spawnSync timeout,
    // which looked like (but was never) a hang or a concurrency bug. A
    // 400 is a non-retried failure (withRetries() only retries >=500 or
    // 429), so it fails on the FIRST attempt, exactly matching what this
    // step means to exercise (workflow.ts's own swallow-and-continue
    // fault tolerance) without also accidentally exercising provider
    // retry/backoff, which is a real, already-covered behaviour of its
    // own (see lib/ai/providers.ts's withRetries() and its own callers)
    // and not something this stage's mock should trigger by accident.
    // A benefit whose traits directly overlap the reported event (see
    // lib/policies/benefit-catalog.ts's matchBenefits(): weak:!direct)
    // keeps its calculated figure even when this relevance-judge call
    // fails, exactly as lib/policies/relevance-judge.ts's own judgeBatch()
    // catch{return null;} already handles for real production traffic
    // whose reader call fails -- this stage relies on that same real
    // fallback, not a new one.
    return new Response("mocked: no AI provider reachable in this sandbox for this call", { status: 400 });
  }) as typeof fetch;
}

runStage("03-chat-claim-flow", async ({ pool, step }) => {
  const handoff = await readHandoff();
  requireHandoff(handoff, ["ownerId", "householdId", "selfMemberId", "policyId"]);
  const ownerId = String(handoff.ownerId);
  const householdId = String(handoff.householdId);
  const selfMemberId = String(handoff.selfMemberId);
  const policyId = String(handoff.policyId);

  asUser(ownerId);

  const { GET: listPolicies } = await import("@/app/api/policies/route");
  const { POST: postChat } = await import("@/app/api/chat/route");
  const { GET: getChatJob } = await import("@/app/api/chat/jobs/[id]/route");
  const { GET: getClaims } = await import("@/app/api/claims/route");
  const { GET: getClaimSessionRoute } = await import("@/app/api/claims/[id]/route");

  await step("validates stage 2's real output: the uploaded policy is still there, real quarantine-rejected, through the real GET /api/policies route", async () => {
    const res = await listPolicies(requestFor("http://localhost/api/policies", { household: householdId }));
    const body = await res.json();
    const found = (body.policies as Array<{ id: string; quarantine_status: string }>).find((p) => p.id === policyId);
    assert.ok(found, "stage 2's policy must still be readable through the real route");
    assert.equal(found!.quarantine_status, "scan_rejected");
  });

  await step("seeds a second policy's real, already-indexed state directly via SQL (Checkpoint 16: the SAME already-accepted fixture pattern scripts/system-database-regressions.ts's own seedReviewFixture() uses to drive the real claim-recording path -- a precondition a real upload+extraction pipeline would itself have produced, not a substitute for the claim-session-creation route this stage tests below; running real extraction here would revisit the pdf.js memory ceiling documented in scripts/full-household-e2e-regressions.ts's own header)", async () => {
    const cleanPolicyId = randomUUID();
    const referenceDocId = randomUUID();
    const productName = "E2E Fixture Critical Illness";
    const schedule = "The household owner owns " + productName + ". Sum Insured SGD 350000.";
    const wording = productName + ". We pay 100% of Sum Insured for qualifying critical illness. The diagnosis must satisfy the defined illness.";
    const zeroVector = "[" + Array.from({ length: 1024 }, (_, j) => (j === 0 ? 1 : 0)).join(",") + "]";
    for (const doc of [
      { id: cleanPolicyId, text: schedule, personal: true, role: "personal_schedule", authority: 95 },
      { id: referenceDocId, text: wording, personal: false, role: "policy_wording", authority: 60 },
    ]) {
      await pool.query(
        `INSERT INTO policies(id,account_id,family_member_id,insurer,product_name,policy_number,policy_type,document_role,personal_coverage_confirmed,document_authority,processing_status,original_filename,storage_key,effective_date,extracted_json) VALUES($1,$2,$3,'E2E Fixture Insurer',$4,'E2E-CLEAN-1','Critical Illness',$5,$6,$7,'ready',$8,$8,'2022-01-01',$9::jsonb)`,
        [doc.id, householdId, selfMemberId, productName, doc.role, doc.personal, doc.authority, doc.id + ".pdf", JSON.stringify({ productsMentioned: [productName] })],
      );
      await pool.query(`INSERT INTO policy_members(policy_id,family_member_id,account_id) VALUES($1,$2,$3)`, [doc.id, selfMemberId, householdId]);
      await pool.query(`INSERT INTO policy_pages(account_id,policy_id,page_number,text) VALUES($1,$2,1,$3)`, [householdId, doc.id, doc.text]);
      await pool.query(
        `INSERT INTO policy_chunks(id,account_id,family_member_id,policy_id,page_start,page_end,text,embedding) VALUES($1,$2,$3,$4,1,1,$5,$6::vector)`,
        [randomUUID(), householdId, selfMemberId, doc.id, doc.text, zeroVector],
      );
    }
    // Also marks these documents already read for the coverage ledger
    // (lib/ledger/extract.ts's pendingDocumentCount()/readPendingDocuments()
    // gate on ledger_read_at IS NULL): without this, the earlier "Is my
    // hospitalisation covered..." async chat step below sees these newly-
    // inserted documents as unread, and its own background read pass
    // (runAfterResponse()'s fire-and-forget chain) tries to read them for
    // real against whatever provider is configured, outside this stage's
    // mocked fetch -- discovered directly, not assumed, by a first run of
    // this stage genuinely stalling past its orchestrator timeout on real
    // "No API key configured for gemini" ledger-read failures logged after
    // every step had already reported success.
    await pool.query(`UPDATE policies SET benefits_indexed_at=now(),ledger_read_at=now() WHERE id=ANY($1::uuid[])`, [[cleanPolicyId, referenceDocId]]);
    await pool.query(
      `INSERT INTO policy_coverages(id,account_id,policy_id,family_member_id,category,amount,currency,product_name,source_page,evidence_text,evidence_verified,confirmed) VALUES($1,$2,$3,$4,'Critical Illness',350000,'SGD',$5,1,$6,true,true)`,
      [randomUUID(), householdId, cleanPolicyId, selfMemberId, productName, schedule],
    );
    await pool.query(
      `INSERT INTO policy_benefits(account_id,policy_id,product_name,benefit_name,traits,formula_kind,formula_value,currency,source_page,quote,conditions,requirements,needs_review) VALUES($1,$2,$3,'Major Critical Illness',ARRAY['illness','diagnosis']::text[],'sum_insured',1,'SGD',1,$4,'[]'::jsonb,'[]'::jsonb,true)`,
      [householdId, cleanPolicyId, productName, wording],
    );
  });

  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  // Force the "judgement" role (lib/chat/facts.ts's interpretMessage())
  // onto Anthropic -- lib/ai/providers.ts's own DEFAULT_MODEL otherwise
  // routes it to Gemini (a real, current fact discovered while building
  // this stage: the mocked fetch below matches Anthropic's request
  // shape, the same shape scripts/model-provenance-regressions.ts's own
  // accepted mock uses, and gets no match against Gemini's own request
  // shape, which fails closed into the graceful "couldn't read your
  // message" branch instead -- also a real, legitimate path, just not
  // the one this step means to prove).
  process.env.JUDGEMENT_MODEL = "anthropic:claude-haiku-4-5-20250620";
  const originalFetch = global.fetch;
  global.fetch = mockAnthropicFetch();

  let claimSessionId = "";
  try {
    await step("POST /api/chat (synchronous) answers a real, plain policy question through the real chat route and the real runChatWorkflow(), against a mocked AI provider", async () => {
      const res = await postChat(
        requestFor("http://localhost/api/chat", {
          household: householdId,
          method: "POST",
          body: { familyMemberId: selfMemberId, question: "What does my policy cover for hospitalisation?", asynchronous: false },
        }),
      );
      if (res.status !== 200) throw new Error(`expected a real synchronous answer, got ${res.status}: ${await res.text()}`);
      const body = await res.json();
      assert.ok(typeof body.answer?.summary === "string" && body.answer.summary.length > 0, "a real chat answer must carry a real summary");
      assert.equal(body.answer.confidence, "insufficient_evidence", "no clean/readable policy exists in this household yet (the only policy was quarantine-rejected in stage 2), so a real answer must honestly say so rather than fabricate a match");
    });

    let jobId = "";
    await step("POST /api/chat (asynchronous, the real production default) really enqueues a real chat_analysis_jobs row and returns 202", async () => {
      const res = await postChat(
        requestFor("http://localhost/api/chat", {
          household: householdId,
          method: "POST",
          body: { familyMemberId: selfMemberId, question: "Is my hospitalisation covered if I am admitted overnight?" },
        }),
      );
      assert.equal(res.status, 202);
      const body = await res.json();
      jobId = body.jobId;
      assert.ok(jobId);
    });

    await step("a separately-invoked durable worker claims the chat job and it reaches a real terminal state visible through GET /api/chat/jobs/[id]", async () => {
      const config = PRODUCTION_JOB_TYPES.find((candidate) => candidate.jobType === "chat_analysis");
      if (!config) throw new Error('no processor configured for job type "chat_analysis"');
      const outcome = await claimAndProcessOne({ jobType: "chat_analysis", workerId: `e2e-chat-${process.pid}`, process: config.process });
      assert.equal(outcome, "succeeded");
      const job = await waitFor(async () => {
        const res = await getChatJob(requestFor(`http://localhost/api/chat/jobs/${jobId}`, { household: householdId }), { params: Promise.resolve({ id: jobId }) } as any);
        if (res.status !== 200) return undefined;
        const body = await res.json();
        return body.job?.status === "queued" || body.job?.status === "running" ? undefined : body.job;
      }, 60000); // 60s: after the mockAnthropicFetch() 400-vs-500 fix above, a real orchestrated run measured 33s for this step (down from the 150-170s+ the old 500-status mock cost by triggering full provider retry/backoff) -- 60s keeps a real margin over that measurement for this sandbox's own variable shared load without going back to the multi-minute timeouts that were fixing the wrong problem
      assert.ok(["complete", "failed", "cancelled"].includes(job.status), `chat job reached an unexpected terminal status: ${job.status}`);
    });

    await step("a retry after chat commit but before generic-job acknowledgement cannot insert a duplicate reply", async () => {
      const before = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM chat_messages WHERE conversation_id=(SELECT conversation_id FROM chat_analysis_jobs WHERE id=$1)`,
        [jobId],
      );
      assert.equal(before.rows[0].count, "2", "the first worker run must save exactly one user/assistant pair");
      // Recreate the observable durable-queue state left by a worker crash
      // immediately after saveTurn() committed but before completeJob().
      await pool.query(
        `UPDATE background_jobs SET status='failed_retryable',lease_owner=NULL,lease_expires_at=NULL,available_at=now() WHERE job_type='chat_analysis' AND idempotency_key=$1`,
        [jobId],
      );
      const config = PRODUCTION_JOB_TYPES.find((candidate) => candidate.jobType === "chat_analysis");
      if (!config) throw new Error('no processor configured for job type "chat_analysis"');
      const outcome = await claimAndProcessOne({ jobType: "chat_analysis", workerId: `e2e-chat-retry-${process.pid}`, process: config.process });
      assert.equal(outcome, "succeeded");
      const after = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM chat_messages WHERE conversation_id=(SELECT conversation_id FROM chat_analysis_jobs WHERE id=$1)`,
        [jobId],
      );
      assert.equal(after.rows[0].count, "2", "the retry must observe atomic chat completion and perform no second insert");
    });

    await step("POST /api/chat (synchronous) with a real reported illness event reaches the REAL lib/claims/record.ts recordClaim() -> lib/claims/session.ts createClaimSession() through the real route (Checkpoint 16: closes the last documented E2E substitution -- no direct store call here any more)", async () => {
      const res = await postChat(
        requestFor("http://localhost/api/chat", {
          household: householdId,
          method: "POST",
          body: { familyMemberId: selfMemberId, question: "I was diagnosed with stage 2 breast cancer yesterday. What can I claim?", asynchronous: false },
        }),
      );
      if (res.status !== 200) throw new Error(`expected a real synchronous claim answer, got ${res.status}: ${await res.text()}`);
      const body = await res.json();
      const answer = body.answer;
      assert.ok(Array.isArray(answer.claimItems) && answer.claimItems.length > 0, "the seeded benefit's traits (illness, diagnosis) directly overlap the reported event, so a real claim item must be calculated even with the relevance-judge call mocked to fail");
      assert.ok(typeof answer.claimSessionId === "string" && answer.claimSessionId.length > 0, "a real claim assessment with claim items must really call recordClaim() and carry back its real claimSessionId -- this is the real route's own output, not a value this stage invented");
      claimSessionId = answer.claimSessionId;
    });
  } finally {
    global.fetch = originalFetch;
  }

  await step("GET /api/claims lists the claim session through the real route", async () => {
    const res = await getClaims(requestFor("http://localhost/api/claims", { household: householdId }));
    const body = await res.json();
    assert.equal(body.claims.length, 1);
    assert.equal(body.claims[0].id, claimSessionId);
  });

  await step("GET /api/claims/[id] returns the real claim session record through the real route", async () => {
    const res = await getClaimSessionRoute(requestFor(`http://localhost/api/claims/${claimSessionId}`, { household: householdId }), { params: Promise.resolve({ id: claimSessionId }) } as any);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.claim.id, claimSessionId);
  });

  await writeHandoff({ claimSessionId });
});
