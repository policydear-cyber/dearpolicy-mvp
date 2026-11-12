/** A job run that is not finished and not failed: its work waits on something outside (Baidu reading a document's scanned
 * pages, lib/documents/ocr-baidu.ts background reading), so the SAME job is put back in the queue to run again after
 * `delayMs`, with `payloadPatch` merged into its payload (lib/jobs/queue.ts deferJob). The wait does not use up one of the
 * job's attempts, and the job keeps its idempotency key, so everything that follows a document's reading job (its live
 * state, deletion, Read again) follows it while it waits. Thrown by a job processor; caught by the runner
 * (lib/jobs/worker-runtime.ts claimAndProcessOne). No imports: safe to use anywhere. */
export class JobDeferral extends Error {
  readonly delayMs: number;
  readonly payloadPatch: Record<string, unknown>;
  constructor(delayMs: number, payloadPatch: Record<string, unknown>) {
    super("job deferred");
    this.name = "JobDeferral";
    this.delayMs = Math.max(0, Math.round(delayMs));
    this.payloadPatch = payloadPatch;
  }
}
