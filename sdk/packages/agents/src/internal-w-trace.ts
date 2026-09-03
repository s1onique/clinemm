/**
 * ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
 * (thirty-third-pass) — PACKAGE-INTERNAL entry point for the
 * runtime trace observer install helper.
 *
 * Singleton strategy: the install helper writes to a
 * `Symbol.for("@cline/agents__wTraceObserver")` keyed slot
 * on `globalThis`. Both the main bundle (which evaluates
 * `AgentRuntime`) and this secondary entry reach the SAME
 * Symbol identity (because `Symbol.for(key)` returns the
 * same Symbol across module loads via a process-wide
 * registry), so writes and reads share one slot.
 *
 * This file is the SOLE exporter of
 * `installRuntimeWTraceObserver` for consumers OUTSIDE the
 * `@cline/agents` source tree. The ClineMM-private bridge
 * in `apps/vscode/src/sdk/w-carrier-runtime-trace-bridge.ts`
 * imports this file via a relative filesystem path
 * (`../../../../sdk/packages/agents/dist/internal-w-trace.js`)
 * at runtime.
 *
 * CRITICAL: this file is NOT in the `@cline/agents` package
 * barrel (`index.ts` does NOT re-export
 * `installRuntimeWTraceObserver`), and the agent package's
 * `package.json` `exports` field does NOT register a subpath
 * for `internal-w-trace.js`. External consumers (CLI,
 * JetBrains, etc.) that publish against the `@cline/agents`
 * package barrel CANNOT reach this function.
 *
 * @internal
 */

export {
	installRuntimeWTraceObserver,
	type AgentRuntimeWTraceObserver,
	type AgentRuntimeWTraceRecord,
} from "./runtime-w-trace-internal"
