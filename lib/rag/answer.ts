import { z } from "zod";
import { structuredCompletion } from "@/lib/ai/llm";
import { dearPolicyCoreRules } from "@/lib/ai/core-rules";
import type { ChatAnswer, RetrievedChunk, StructuredCoverageFact } from "@/types";

const ClaimItemSchema = z.object({
  title: z.string(),
  status: z.enum(["likely_applicable", "potentially_applicable", "not_applicable", "needs_document"]),
  amountText: z.string().nullable(),
  reason: z.string(),
  conditions: z.array(z.string()),
});

const ModelAnswerSchema = z.object({
  summary: z.string(),
  details: z.array(z.string()),
  claimItems: z.array(ClaimItemSchema).optional().default([]),
  nextSteps: z.array(z.string()).optional().default([]),
  confidence: z.enum(["strong_match", "partial_match", "insufficient_evidence"]),
  sourceChunkIds: z.array(z.string()),
  sourceCoverageIds: z.array(z.string()),
});

export async function answerFromEvidence(args: {
  question: string;
  chunks: RetrievedChunk[];
  coverages: StructuredCoverageFact[];
}): Promise<ChatAnswer> {
  if (!args.chunks.length && !args.coverages.length) {
    return {
      mode:"answer",
      summary: "I couldn't find relevant evidence in this family member's uploaded insurance documents.",
      details: [], claimItems: [], nextSteps: [], confidence: "insufficient_evidence", citations: [],
      disclaimer: "DearPolicy uses uploaded policy evidence and does not invent missing cover.",
      claimSessionId:null, questions:[], knownFacts:[], missingFacts:[],
    };
  }

  const ownership = args.coverages.length
    ? args.coverages.map((c, i) =>
        `[PERSONAL COVER ${i + 1}]\ncoverage_id=${c.id}\ncategory=${c.category}\nproduct=${c.productName ?? "unknown"}\namount=${c.amount == null ? "not stated" : `${c.currency ?? "SGD"} ${c.amount}`}\npolicy=${c.policyNumber ?? c.policyName ?? "unknown"}\nsource_page=${c.sourcePage ?? "unknown"}\nevidence=${c.evidenceText ?? "Personal certificate/schedule confirms this cover."}`,
      ).join("\n\n")
    : "No personally confirmed coverage facts are available.";

  const evidence = args.chunks.length
    ? args.chunks.map((c, i) =>
        `[REFERENCE ${i + 1}]\nchunk_id=${c.id}\ninsurer=${c.insurer ?? "unknown"}\nproduct=${c.productName ?? "unknown"}\ndocument_role=${c.documentRole ?? "unknown"}\npersonal_coverage_confirmed=${c.personalCoverageConfirmed}\npages=${c.pageStart}-${c.pageEnd}\n${c.text}`,
      ).join("\n\n")
    : "No supporting wording was retrieved.";

  const system = `${dearPolicyCoreRules()}\n\nYou are the explanation layer for DearPolicy. This is a normal policy question, not a guided claim intake. Answer only from the supplied personal coverage facts and policy wording. Start with the direct answer. Generic wording may explain an owned product but may never create ownership. Do not introduce any fact that is not present below.`;

  const parsed = await structuredCompletion<z.infer<typeof ModelAnswerSchema>>({
    system,
    user: `QUESTION:\n${args.question}\n\nPERSONAL COVERAGE FACTS:\n${ownership}\n\nSUPPORTING POLICY WORDING:\n${evidence}`,
    schema: ModelAnswerSchema,
    temperature: 0,
    timeoutMs:120_000,
    attempts:1,
    numCtx:3072,
  });

  const chunkMap = new Map(args.chunks.map((c) => [c.id, c]));
  const coverageMap = new Map(args.coverages.map((c) => [c.id, c]));
  const citations = [
    ...parsed.sourceCoverageIds.filter((id) => coverageMap.has(id)).map((id) => {
      const c = coverageMap.get(id)!;
      return { chunkId:`coverage:${c.id}`,policyId:c.policyId,policyName:c.productName ?? c.policyName ?? "Policy",insurer:c.insurer ?? undefined,pageStart:c.sourcePage ?? 1,pageEnd:c.sourcePage ?? 1,documentRole:c.documentRole,personalEvidence:true,evidenceLabel:"Personal cover" };
    }),
    ...parsed.sourceChunkIds.filter((id) => chunkMap.has(id)).map((id) => {
      const c = chunkMap.get(id)!;
      return { chunkId:c.id,policyId:c.policyId,policyName:c.productName ?? "Policy",insurer:c.insurer ?? undefined,pageStart:c.pageStart,pageEnd:c.pageEnd,documentRole:c.documentRole,personalEvidence:c.personalCoverageConfirmed,evidenceLabel:c.personalCoverageConfirmed ? "Personal document" : "Policy wording" };
    }),
  ];

  let confidence: ChatAnswer["confidence"] = parsed.confidence;
  if (confidence === "strong_match" && !parsed.sourceCoverageIds.some((id) => coverageMap.has(id))) confidence = "partial_match";
  if (!citations.length) confidence = "insufficient_evidence";

  return {
    mode:"answer", summary:parsed.summary, details:parsed.details, claimItems:parsed.claimItems, nextSteps:parsed.nextSteps, confidence, citations,
    disclaimer:"DearPolicy explains what the uploaded policy evidence says. Final insurer administration remains subject to the policy terms.",
    claimSessionId:null, questions:[], knownFacts:[], missingFacts:[],
  };
}
