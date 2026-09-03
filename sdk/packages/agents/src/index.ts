/**
 * @cline/agents
 *
 * Browser-safe agent runtime for the next-generation Cline SDK.
 *
 * Exports:
 *   - `AgentRuntime` / `Agent` — the agentic loop class (two names for the
 *     same class). Use `Agent` when supplying provider/model IDs, or
 *     `AgentRuntime` when supplying a pre-built `AgentModel`.
 *   - `createAgentRuntime` / `createAgent` — factory-function equivalents.
 *   - `AgentRuntimeConfig` and its two variants (`AgentRuntimeConfigWithModel`,
 *     `AgentRuntimeConfigWithProvider`) — the discriminated config union.
 *   - `AgentRunInput` / `AgentEventListener` — convenience type aliases.
 *   - `createTool` — re-exported from `@cline/shared` for authoring tools.
 *
 * Shared types (`AgentMessage`, `AgentRunResult`, etc.) should be imported
 * directly from `@cline/shared`.
 */

export type {
	AgentAfterToolResult,
	AgentBeforeModelResult,
	AgentBeforeToolResult,
	AgentMessage,
	AgentMessagePart,
	AgentModel,
	AgentModelFinishReason,
	AgentModelRequest,
	AgentRunResult,
	AgentRuntimeConfig as BaseAgentRuntimeConfig,
	AgentRuntimeEvent,
	AgentRuntimeHooks,
	AgentRuntimeStateSnapshot,
	AgentStopControl,
	AgentTool,
	AgentToolCallPart,
	AgentToolDefinition,
	AgentToolResult,
	AgentUsage,
	ToolApprovalResult,
	ToolPolicy,
} from "@cline/shared";
export { createTool } from "@cline/shared";
export type {
	AgentEventListener,
	AgentRunInput,
	AgentRuntimeConfig,
	AgentRuntimeConfigWithModel,
	AgentRuntimeConfigWithProvider,
} from "./agent-runtime";

// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
// (thirty-third-pass, attempt 2): the runtime-w-observer
// hook is a ClineMM-internal diagnostic, NOT a public SDK API.
// The types `AgentRuntimeWTraceObserver` /
// `AgentRuntimeWTraceRecord` and the install helper
// `installRuntimeWTraceObserver` are defined in
// `./runtime-w-trace-internal` for in-package use (the bridge
// module imports `installRuntimeWTraceObserver` via
// `./internal-w-trace.ts`, which is the SOLE exporter and is
// NOT registered in the package's `exports` field).
// External callers cannot reach them through the package
// barrel.
export {
	Agent,
	AgentRuntime,
	AgentRuntimeAbortError,
	createAgent,
	createAgentRuntime,
} from "./agent-runtime";

// Bounded tool/protocol recovery — runtime policy enforcement for
// AgentRuntime. Contract types live in `@cline/shared`; the state machine
// implementation lives in `@cline/agents/src/runtime/recovery/`.
export * from "./runtime/recovery/index";

/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01 / E0–E4: shadow TaskState (TEA-shaped).
 *
 * @internal
 *
 * PROVISIONAL / INTERNAL-USE-ONLY — not part of the stable SDK surface.
 *
 * This namespace exists so the host boundary (apps/vscode/src/sdk/
 * task-state-shadow.ts) can reach the shadow model from a single
 * import path during shadow-mode qualification. The shadow is
 * observation-only; nothing inside `@cline/agents` writes to the
 * legacy `TurnStateTracker` or `TaskTelemetryTracker`, and the webview
 * does not consume this namespace during E0–E4.
 *
 * Consumers SHOULD NOT depend on this namespace from outside the
 * `@cline/agents` and `apps/vscode` source trees. Treat it as a
 * pre-1.0 internal seam: the shape, members, and stability are
 * deliberately undocumented and may change between ACTs without a
 * deprecation cycle.
 *
 * Public package surface delta (CORRECTION01 R6): yes, the export
 * mechanically exists at the package root. Stability commitment:
 * PROVISIONAL / INTERNAL-USE-ONLY. The dual classification here is
 * intentional — it is real surface for technical reasons, but not
 * stable surface for contractual reasons.
 */
export * as TaskState from "./runtime/state/task-state";
