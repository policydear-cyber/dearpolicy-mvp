/** Background Baidu reading: what a document's reading carries from one run to the next while Baidu reads its scanned
 * pages (lib/documents/ocr-baidu.ts completePdfPagesWithBaidu). It is kept in the reading job's own payload
 * (background_jobs.payload.baiduWait), so it holds no page text, no link and no token: only page numbers, Baidu's job ids,
 * the storage key of a staged copy still to remove, and times. No imports: the job processor reads it cheaply. */

/** One Baidu job that a run submitted and a later run looks at again. */
export type BaiduWaitJob = {
  /** The document's page numbers the job reads, in order. */
  pages: number[];
  /** Baidu's own job id. */
  jobId: string;
  /** When it was submitted (ms since 1970). */
  submittedAt: number;
  /** The staged copy Baidu downloads the pages from (link submit), until it is removed. */
  stagedKey?: string;
};
export type BaiduWaitState = {
  /** When the reading first tried Baidu (ms since 1970): the waiting window counts from here. */
  since: number;
  /** How many times the reading has been put back to wait. */
  runs: number;
  jobs: BaiduWaitJob[];
  /** Pages Baidu could not read (a failed job, a refused request): the AI reader reads them at the end. */
  gaveUp: number[];
};

/** How long a reading waits before it looks again, after its 1st, 2nd... wait: soon at first, then every 5 minutes. */
export const BAIDU_WAIT_DELAYS_MS = [20_000, 40_000, 60_000, 120_000, 180_000, 300_000];
export function baiduWaitDelayMs(runs: number): number {
  return BAIDU_WAIT_DELAYS_MS[Math.min(Math.max(runs - 1, 0), BAIDU_WAIT_DELAYS_MS.length - 1)];
}

const pageList = (v: unknown): number[] | null =>
  Array.isArray(v) && v.length <= 5_000 && v.every((n) => Number.isInteger(n) && n > 0) ? (v as number[]) : null;
const time = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
/** A staged copy's key exactly as lib/storage/supabase.ts ocrHandoffObjectKey makes it, never "..". */
const HANDOFF_KEY = /^(?!.*\.\.)[A-Za-z0-9._-]{1,80}\/ocr-handoff\/[A-Za-z0-9._-]{1,80}\/pages\.pdf$/;

/** The state from a job payload, or null when there is none or it is not exactly this shape (a payload is never trusted:
 * a job id goes into a Baidu URL, a key into a storage delete). */
export function parseBaiduWaitState(raw: unknown): BaiduWaitState | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const since = time(o.since), gaveUp = pageList(o.gaveUp);
  if (since === null || gaveUp === null || !Number.isInteger(o.runs) || (o.runs as number) < 0 || (o.runs as number) > 1_000 || !Array.isArray(o.jobs) || o.jobs.length > 200) return null;
  const jobs: BaiduWaitJob[] = [];
  for (const j of o.jobs as Record<string, unknown>[]) {
    const pages = pageList(j?.pages), submittedAt = time(j?.submittedAt);
    if (!pages?.length || submittedAt === null || typeof j.jobId !== "string" || !/^[A-Za-z0-9_.-]{1,128}$/.test(j.jobId)) return null;
    if (j.stagedKey !== undefined && (typeof j.stagedKey !== "string" || !HANDOFF_KEY.test(j.stagedKey))) return null;
    jobs.push({ pages, jobId: j.jobId, submittedAt, ...(j.stagedKey ? { stagedKey: j.stagedKey as string } : {}) });
  }
  return { since, runs: o.runs as number, jobs, gaveUp };
}

/** Thrown by the scanned-page reading (lib/documents/ocr.ts) when Baidu has not finished yet and the reading should wait
 * and look again, instead of the AI reader reading the pages now. `pages`: the pages still waiting. */
export class BaiduReadingPending extends Error {
  readonly state: BaiduWaitState;
  readonly pages: number[];
  constructor(state: BaiduWaitState, pages: number[]) {
    super("Baidu reading still pending");
    this.name = "BaiduReadingPending";
    this.state = state;
    this.pages = pages;
  }
}
