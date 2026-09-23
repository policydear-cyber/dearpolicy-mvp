// Next.js calls register() exactly once, automatically, before the server
// starts handling any request (in every runtime that boots -- Node.js and
// Edge). This is the one hook available to make an unsafe production
// configuration a hard startup failure instead of a silent, exploitable
// default: see lib/launch/guards.ts for what "unsafe" means here.
export async function register() {
  const { assertProductionSafe } = await import("./lib/launch/guards");
  assertProductionSafe();
}
