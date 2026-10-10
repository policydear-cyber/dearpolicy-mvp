/** Types for scripts/trial/isolation.mjs (plain Node, run by scripts/trial/start.sh before anything else). */
export declare const TRIAL_MAX_ALLOCATION_USD: number;
export declare const LOCAL_HOSTS: Set<string>;
export declare class TrialRefusal extends Error {}
export type TrialAllocation = { id: string; usd: number };
export type LocalTrialLedger = { capUsd: number; spentUsd: number; inflightUsd: number; calls?: number; refusals?: number; startedAt: string; restarts?: number; allocationId: string; codespace: string };
export declare function remoteDatabaseProblem(name: string, value: string | undefined | null): string | null;
export declare function checkEnvironment(env: Record<string, string | undefined>): void;
export declare function openAllocation(ledger: unknown): TrialAllocation;
export declare function readLocalLedger(file: string, allocation: TrialAllocation, codespace: string | undefined): LocalTrialLedger | null;
export declare function trialIsolation(env: Record<string, string | undefined>, root: string): { cap: number; allocation: string; spent: number };
