/**
 * General runtime/state — public surface.
 *
 *   @cline/agents
 *   └─ runtime/state/
 *      ├─ execution-state.ts            (canonical AgentRuntimeExecutionState projection)
 *      └─ index.ts                      (this file — public surface)
 *
 * This directory is for runtime-owned state authorities
 * that are NOT specific to the bounded-recovery
 * subsystem. Recovery lives in `runtime/recovery/`; the
 * execution-state projection is general and lives here.
 *
 * Contract types live in @cline/shared (no Node builtins).
 */
export type {
	AgentRuntimeExecutionState,
} from "@cline/shared";

export {
	buildExecutionState,
	isSameExecutionState,
	type ExecutionStateSources,
} from "./execution-state";
