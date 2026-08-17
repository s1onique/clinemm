/**
 * General runtime/state — INTERNAL package barrel.
 *
 *   @cline/agents
 *   └─ runtime/state/
 *      ├─ execution-state.ts  (canonical AgentRuntimeExecutionState projection)
 *      └─ index.ts            (this file — internal barrel)
 *
 * SCOPE
 * -----
 * This directory holds the runtime-owned state
 * authorities that are NOT specific to bounded
 * recovery. Recovery lives in `runtime/recovery/`;
 * the execution-state projection is general and
 * lives here.
 *
 * These helpers are INTENTIONALLY package-internal.
 * The only contract type intended for cross-package
 * consumers is `AgentRuntimeExecutionState` itself,
 * which is re-exported from `@cline/shared` and
 * surfaces in the public API as
 * `AgentRuntimeStateSnapshot.execution`. UI and host
 * layers MUST read that field rather than
 * constructing the projection themselves.
 *
 * If a future consumer outside this package needs
 * the projection helper, promote the export
 * deliberately rather than via a chain of barrel
 * re-exports.
 */
export type {
	AgentRuntimeExecutionState,
} from "@cline/shared";

export {
	buildExecutionState,
	isSameExecutionState,
	type ExecutionStateSources,
} from "./execution-state";

// ACT-CLINEMM-ELM-ARCHITECTURE01: shadow TaskState (E0–E4) lives
// alongside this file per the same ownership rule ("general runtime
// state, not under recovery"). Internal only; no public-API expansion
// during shadow mode.
export * as TaskState from "./task-state";
