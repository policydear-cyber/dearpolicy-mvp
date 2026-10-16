/**
 * Reliable chat: suites written for the earlier model-facing operand assembly (calculate lump_sum / hospital_cash with
 * model-chosen value ids) import this FIRST so they keep exercising that contract while they are ported. Non-production
 * only (chatContract() ignores it when NODE_ENV=production). Suites of the migrated path set
 * DEARPOLICY_CHAT_CONTRACT=benefits instead. `grep -l fixtures/legacy-contract scripts` lists what is not yet ported.
 */
process.env.DEARPOLICY_CHAT_CONTRACT ??= "legacy-operands";
export {};
