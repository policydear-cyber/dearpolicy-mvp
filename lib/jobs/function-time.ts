/** When the serverless function running a job is stopped (5 Nov: a 47-page wording's table reading was cut off at the
 * function's limit, and neither its reading nor its "could not be read" note was saved). Work that can run long (the
 * benefit table's reading) stops in time to save what it must. Only on Vercel, whose routes that run jobs all allow
 * FUNCTION_LIMIT_MS (maxDuration 300); a standalone worker or a script has no limit. */
import { AsyncLocalStorage } from "node:async_hooks";

export const FUNCTION_LIMIT_MS = 300_000;
const scope = new AsyncLocalStorage<{ deadline: number }>();

/** Runs `fn` with the deadline of a function that started at `startedAt` (ms since 1970); off Vercel, `fn` alone. An
 * outer deadline is kept: a job batch inside a function that started earlier is stopped when that function is. */
export function withFunctionDeadline<T>(startedAt: number, fn: () => Promise<T>, env: NodeJS.ProcessEnv = process.env): Promise<T> {
  if (!env.VERCEL) return fn();
  const outer = scope.getStore()?.deadline;
  const deadline = Math.min(outer ?? Infinity, startedAt + FUNCTION_LIMIT_MS);
  return scope.run({ deadline }, fn);
}
/** The deadline of the function running this code, or `fallbackStart` + FUNCTION_LIMIT_MS on Vercel when no job runner
 * set one; undefined off Vercel. */
export function functionDeadline(fallbackStart: number, env: NodeJS.ProcessEnv = process.env): number | undefined {
  if (!env.VERCEL) return undefined;
  return scope.getStore()?.deadline ?? fallbackStart + FUNCTION_LIMIT_MS;
}
