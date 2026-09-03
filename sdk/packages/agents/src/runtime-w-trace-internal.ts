/**
 * ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
 * (thirty-third-pass, attempt 2) — PACKAGE-INTERNAL
 * runtime-trace observer install helper.
 *
 * Singleton strategy: the observer slot is a Symbol.for-keyed
 * property on `globalThis`. `Symbol.for(key)` returns the SAME
 * Symbol identity across module evaluations (Node.js and
 * browsers maintain a process-wide registry for Symbol.for),
 * so the runtime (which reads from this slot via its
 * `notifyRuntimeWTraceObserver` method) and the bridge (which
 * writes via this helper) hit the SAME slot regardless of how
 * Bun's separate-entry bundling splits the source graph.
 *
 * The Symbol key is a long, package-prefixed identifier
 * (`"@cline/agents__wTraceObserver"`), ensuring collision-
 * free identification. The slot is NOT a string-keyed
 * globalThis property (which would be the reviewer's
 * "process-global namespace residue" concern); it's a
 * Symbol-keyed slot, reachable only by callers that
 * construct the same Symbol.for key.
 *
 * @internal
 */

/**
 * Frozen discriminator payload emitted by the runtime's
 * `notifyRuntimeWTraceObserver` per
 * `prepareTurnForModelRequest` invocation. The discriminator
 * distinguishes the four A1–A4 scenarios from the causal
 * review (see `agent-runtime.runtime-w-observe.test.ts`):
 *
 *   A1 producer published W?        <- `prepareTurnW`
 *   A2 runtime captured W?         <- `runtimeW`
 *   A3 emit-decision helper chose
 *      to attempt a publish?       <- `willEmit`
 *   A4 emit() resolved without
 *      an error?                   <- `emitResolved`
 *
 * ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
 * (thirty-sixth-pass): this interface is the SINGLE
 * declaration authority for the W-trace discriminator type.
 * The previous shape split the authority across
 * `agent-runtime.ts` and `runtime-w-trace-internal.ts`
 * (`agent-runtime.ts` imported the type from
 * `runtime-w-trace-internal.ts` and `runtime-w-trace-internal.ts`
 * re-imported it from `agent-runtime.ts`), producing TS2303
 * (circular import alias) and TS2459 (locally declared, not
 * exported) on a clean detached-tree package build. Both
 * types now live here; `agent-runtime.ts` imports them
 * from this module.
 *
 * `resultKind` discriminates `prepare_turn_undefined_result`
 * (the `previousRuntimeW` carry-over branch when
 * `currentWorkingContextEstimate` is `undefined`) from
 * the `prepare_turn` row emitted on the normal path.
 *
 * @internal
 */
export interface AgentRuntimeWTraceRecord {
	sessionId: string | undefined;
	iteration: number;
	resultKind: "prepare_turn" | "prepare_turn_undefined_result";
	prepareTurnW: number | undefined;
	runtimeW: number | undefined;
	previousRuntimeW: number | undefined;
	willEmit: boolean;
	emitResolved: boolean;
}

/**
 * Observer callback type.
 *
 * @internal
 */
export type AgentRuntimeWTraceObserver = (record: AgentRuntimeWTraceRecord) => void

/**
 * The Symbol.for key used for the observer slot. MUST match
 * the symbol defined in `agent-runtime.ts`'s top-level
 * (`Symbol.for("@cline/agents__wTraceObserver")`). The slot is
 * shared between the runtime's read site and this helper's
 * write site via Symbol.for's process-wide registry.
 *
 * If you change this key, you MUST also change the key in
 * `agent-runtime.ts`. They are intentionally two declarations
 * of the SAME symbol identity, not two separate symbols.
 */
const W_TRACE_OBSERVER_SLOT = Symbol.for("@cline/agents__wTraceObserver")

/**
 * Install the singleton observer. Writes to the
 * Symbol.for-keyed slot on `globalThis`. The runtime reads
 * from the same slot on every `prepareTurnForModelRequest`.
 *
 * Synchronous (no dynamic import needed) because the Symbol
 * is stable across module loads — both the runtime's read
 * site (in `agent-runtime.ts`) and this helper's write site
 * resolve to the SAME symbol identity via `Symbol.for(key)`.
 *
 * The previous attempt (a `private static __wTraceObserver`
 * field on the `AgentRuntime` class) failed the RED probe
 * because Bun's separate-entry bundling produces TWO
 * independent copies of the `AgentRuntime` class — one in
 * `dist/index.js` and one in `dist/internal-w-trace.js`.
 * Each class has its own static field copy (before the
 * Symbol.for singleton fix), so writes from the
 * bridge and reads from the runtime never meet.
 */
export function installRuntimeWTraceObserver(
	observer: AgentRuntimeWTraceObserver | undefined,
): void {
	(globalThis as {
		[symbol: symbol]: AgentRuntimeWTraceObserver | undefined;
	})[W_TRACE_OBSERVER_SLOT] = observer
}
