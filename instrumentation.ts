// Next.js calls register() exactly once, automatically, before the server
// starts handling any request (in every runtime that boots -- Node.js and
// Edge). This is the one hook available to make an unsafe production
// configuration a hard startup failure instead of a silent, exploitable
// default: see lib/launch/guards.ts for what "unsafe" means here.
export async function register() {
  const { assertProductionSafe, isProduction, telemetryIntentionallyDisabled, TELEMETRY_INTENTIONALLY_DISABLED_WARNING } = await import("./lib/launch/guards");
  assertProductionSafe();
  if (telemetryIntentionallyDisabled()) {
    // Deliberately loud and deliberately content-free: a fixed string, no
    // environment values, identifiers or request data.
    console.warn(`\n${"=".repeat(78)}\n[dearpolicy] WARNING: ${TELEMETRY_INTENTIONALLY_DISABLED_WARNING}\n${"=".repeat(78)}\n`);
  }

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
  // Prototype document-safety mode: loud, fixed, content-free banner in
  // every environment where it is active, so no run of this server can be
  // mistaken for one whose uploads are malware-scanned.
  const { malwareScanningIntentionallyDisabled, PROTOTYPE_SCANNING_DISABLED_WARNING } = await import("./lib/scanning/adapter");
  if (malwareScanningIntentionallyDisabled()) {
    console.warn(`\n${"=".repeat(78)}\n${PROTOTYPE_SCANNING_DISABLED_WARNING}\n${"=".repeat(78)}\n`);
  }
}
