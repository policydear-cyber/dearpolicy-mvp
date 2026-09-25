// Next.js calls register() exactly once, automatically, before the server
// starts handling any request (in every runtime that boots -- Node.js and
// Edge). This is the one hook available to make an unsafe production
// configuration a hard startup failure instead of a silent, exploitable
// default: see lib/launch/guards.ts for what "unsafe" means here.
export async function register() {
  const { assertProductionSafe, isProduction } = await import("./lib/launch/guards");
  assertProductionSafe();

  // Not folded into assertProductionSafe()/PRODUCTION_STARTUP_GUARDS
  // itself -- lib/claims/evidence/scan-adapter.ts imports lib/launch/guards
  // (isProduction, truthy), so importing scan-adapter.ts's guard back into
  // guards.ts would create a circular module dependency. A separate
  // dynamic import here avoids that while still making the same class of
  // mistake (an unacknowledged null scanner in production) a hard startup
  // failure, not a silently-quarantined-forever surprise discovered later.
  if (isProduction()) {
    const { checkMalwareScannerConfigured } = await import("./lib/claims/evidence/scan-adapter");
    const scannerCheck = checkMalwareScannerConfigured();
    if (!scannerCheck.ok) {
      throw new Error(`Refusing to start: unsafe production configuration detected.\n  - ${scannerCheck.message}`);
    }
  }
}
