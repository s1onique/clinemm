/**
 * ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
 * (thirty-second-pass) — ClineMM-private runtime-trace bridge.
 *
 * INTERNAL ONLY. NOT a public SDK API. This module lives in
 * `apps/vscode/src/sdk/` and is intentionally NOT exported
 * from `apps/vscode/src/sdk/index.ts`.
 *
 * COMPOSITION:
 *   The bridge installs the upstream W discriminator
 *   observer (`runtime_w_observe` JSONL row) into the
 *   `@cline/agents` runtime at module-level scope. The
 *   observer is read by `AgentRuntime.notifyRuntimeWTraceObserver`
 *   on every `prepareTurnForModelRequest` invocation. There
 *   is NO public setter on the `AgentRuntime` class — the
 *   observer is installed via a package-internal install
 *   function exported from `@cline/agents/agent-runtime`
 *   (NOT re-exported from the `@cline/agents` package
 *   barrel; the `@cline/agents` public barrel exposes
 *   zero diagnostic symbols).
 *
 * INSTALLATION PATH:
 *   This module imports `installRuntimeWTraceObserver`
 *   from the `@cline/agents` source via a relative
 *   filesystem path that bypasses the package-system
 *   `exports` field entirely. The `@cline/agents` package
 *   `package.json` has no `exports` field entry for this
 *   subpath, so external consumers (CLI, JetBrains, etc.)
 *   cannot reach the install function through
 *   `import("@cline/agents/internal-w-trace")` even if
 *   they discover the file on disk. The ClineMM bridge is
 *   the SOLE intended caller.
 *
 * FAIL-CLOSED:
 *   When the diagnostic is OFF, the host never calls
 *   `installRuntimeWTraceObserverForClineMM`. The runtime
 *   reads the module-level value as `undefined` and the
 *   notify path is a strict no-op. Public builds pay
 *   nothing.
 *
 * @internal
 */
import { isWCarrierTraceEnabled, recordWCarrierTrace } from "./w-carrier-trace-runtime"
import type { WCarrierTraceContext } from "./w-carrier-trace-runtime"

// Package-internal import: the install function is
// exported from `agent-runtime.ts` (a source file inside
// the `@cline/agents` package) but is intentionally
// OMITTED from the package barrel (`index.ts` does NOT
// re-export it). The relative filesystem path bypasses
// the package-system `exports` field entirely, so external
// consumers (CLI, JetBrains, etc.) cannot reach
// `installRuntimeWTraceObserver` through
// `import("@cline/agents/...")`. The path is resolved at
// monorepo build time by `@cline/core`'s `tsconfig` paths
// mapping (`@cline/agents/*` → `../agents/src/*`) and at
// runtime by Node's normal file resolution into
// `node_modules/@cline/agents/dist/agent-runtime.js`.
//
// Package-internal entry point. The `@cline/agents` package
// barrel (`index.ts`) deliberately does NOT re-export
// `installRuntimeWTraceObserver`. The package's `exports`
// field does NOT register a subpath for `internal-w-trace`.
// The bridge imports this file via a RELATIVE FILESYSTEM
// PATH that bypasses the package-resolution system entirely.
// External consumers (CLI, JetBrains, etc.) that publish
// against `@cline/agents` cannot reach this function.
//
// At runtime the path resolves to
// `node_modules/@cline/agents/dist/internal-w-trace.js`
// (built by `@cline/agents/bun.mts`'s secondary build
// entry; not registered in the package's `exports`).
import {
	installRuntimeWTraceObserver,
	type AgentRuntimeWTraceObserver,
	type AgentRuntimeWTraceRecord,
} from "../../../../sdk/packages/agents/dist/internal-w-trace.js"

/**
 * Lazy trace-context accessor. Returns the JSONL target
 * (globalStorageUri + workspaceState) on demand; returns
 * `undefined` when storage is not yet initialized.
 *
 * Captured by closure so the bridge does not need to take
 * the trace context as a constructor argument; the host
 * wires this in once during activation.
 */
export type GetRuntimeWTraceContext = () => WCarrierTraceContext | undefined

/**
 * Install the ClineMM-private runtime trace observer at
 * MODULE-LEVEL scope inside the `@cline/agents` package.
 * The observer is consulted by every `AgentRuntime` instance
 * the host creates (since runtime construction reads the
 * module-level value), regardless of how the runtime is
 * constructed (shared vs temp session hosts). The
 * diagnostic is OFF-by-default; the host calls this ONLY
 * when `isWCarrierTraceEnabled()` returns true.
 *
 * FAIL-CLOSED:
 *   - When `isWCarrierTraceEnabled()` returns false, this
 *     function is a strict no-op (it does NOT call
 *     `installRuntimeWTraceObserver`).
 *   - When `getTraceContext()` returns undefined (storage
 *     not initialized), this function is a strict no-op.
 *
 * The runtime records trace rows into the same
 * `w-carrier-trace.jsonl` JSONL buffer as the existing
 * `carrier_observe` and `state_publish` rows, via the
 * `recordWCarrierTrace` helper. The module-level observer
 * is consulted at every `prepareTurnForModelRequest`.
 *
 * @internal
 *   This is the only entry point the host has to wire the
 *   diagnostic. NOT exported from `apps/vscode/src/sdk/index.ts`.
 */
/**
 * Install the ClineMM-private runtime trace observer.
 *
 * SINGLETON strategy (per the reviewer's RED probe at
 * `agents/dist/red-test.mjs`): the observer slot is a
 * Symbol.for-keyed property on `globalThis`. The Symbol
 * identity is stable across module loads (Symbol.for uses a
 * process-wide registry), so the runtime (which reads from
 * this slot via its `notifyRuntimeWTraceObserver` method)
 * and the bridge (which writes via this helper) ALWAYS hit
 * the SAME slot regardless of how Bun's separate-entry
 * bundling splits the source graph.
 *
 * This is NOT `globalThis` pollution with a string key
 * (which would be the reviewer's "process-global namespace
 * residue" concern); it's a Symbol.for-keyed slot, reachable
 * only by callers that construct the same Symbol.for key.
 *
 * The host (SdkController) calls this ONCE during
 * construction, BEFORE any `ClineCore.create(...)` is invoked.
 * The Symbol.for slot persists for the process lifetime; the
 * runtime reads from it on every `prepareTurnForModelRequest`.
 *
 * FAIL-CLOSED:
 *   - When `isWCarrierTraceEnabled()` returns false, this
 *     function is a strict no-op.
 *   - When `getTraceContext()` returns undefined, this
 *     function is a strict no-op.
 *
 * @internal
 */
export function installRuntimeWTraceObserverForClineMM(
	getTraceContext: GetRuntimeWTraceContext,
): void {
	if (!isWCarrierTraceEnabled()) {
		return
	}
	const ctx = getTraceContext()
	if (!ctx) {
		return
	}
	const observer: AgentRuntimeWTraceObserver = (record: AgentRuntimeWTraceRecord) => {
		recordWCarrierTrace(ctx, {
			t: Date.now(),
			kind: "runtime_w_observe",
			sessionId: record.sessionId,
			iteration: record.iteration,
			resultKind: record.resultKind,
			prepareTurnW: record.prepareTurnW,
			runtimeW: record.runtimeW,
			previousRuntimeW: record.previousRuntimeW,
			willEmit: record.willEmit,
			emitResolved: record.emitResolved,
		})
	}
	installRuntimeWTraceObserver(observer)
}
