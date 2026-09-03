/**
 * ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
 * (twenty-sixth-pass) - temporary DEFAULT_OFF observer for the
 * W carrier pipeline.
 *
 * CONTEXT
 * -------
 * Live dogfood qualification at HEAD `6760717c2` reported a
 * symptom: the context-window gauge is completely absent on an
 * active running task. The producer / transport / projection /
 * UI chain carries FOUR transitions:
 *
 *   Q1  did prepareTurn produce currentWorkingContextEstimate?
 *       (captured at AgentRuntime.prepareTurnForModelRequest)
 *   Q2  did AgentRuntime snapshot contain W?
 *       (the value emitted on working-context-state-changed)
 *   Q3  did working-context-state-changed reach SdkController?
 *       (delegate to WorkingContextHostCapture.observe)
 *   Q4  what did getStateToPostToWebview publish?
 *       (number | null | undefined)
 *
 * The carrier starts at `null`. If Q1/Q2/Q3 are silent on the
 * live runtime path, the carrier stays `null`, the producer
 * publishes `null`, and the webview's `null -> hide` contract
 * (reviewer twentieth-pass fallback B) suppresses the bar.
 *
 * DESIGN - one env-var-gated, no-architecture observer
 * ----------------------------------------------------
 * This module adds ONE optional observer function
 * (`recordWCarrierTrace`) and ONE workspace-state toggle, in the
 * same shape as the existing post-terminal-authority diagnostic
 * and the turn-state-writer-provenance diagnostic. The observer
 * is a pure side-channel: it does NOT influence the carrier
 * assignment semantics, the producer's `null` publish, or the
 * webview's render contract. It is a JSONL writer that snapshots
 * Q1..Q4 on each observed event.
 *
 *   - Default OFF: nothing reads `process.env.CLINEMM_W_TRACE`
 *     unless the workspace-state toggle is set.
 *   - One file: `<globalStorageUri.fsPath>/w-carrier-trace.jsonl`
 *   - One event shape: `{ t, kind, ... }` where `kind` is one of
 *     "carrier_observe" or "state_publish".
 *   - Sorted by wall-clock `t`; surviving ordering is sufficient
 *     for the Q1..Q4 cross-reference.
 *   - No estimator imports (transport-only by conservation rule).
 *
 * CONSERVATION
 * ------------
 *   - WorkingContextHostCapture._latest assignment semantics
 *     unchanged.
 *   - getStateToPostToWebview producer unchanged.
 *   - Webview React rendering unchanged.
 *   - No public surface change.
 */

import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

const WORKSPACE_STATE_KEY = "wCarrierTraceEnabled"

const DUMP_FILE = "w-carrier-trace.jsonl"

/**
 * The env-var opt-in. Mirrors `CLINEMM_PTAD` semantics:
 *   - "1" | "true" => enable
 *   - unset / garbage => no env contribution (workspace toggle
 *     decides)
 *   - "0" | "false" => does NOT forcibly disable a persisted
 *     toggle (the existing toggle stays the user preference)
 */
const CLINEMM_W_TRACE_ENV = "CLINEMM_W_TRACE"

/**
 * Narrow structural context type, mirroring the existing
 * diagnostic modules' shape. Production code passes a wider
 * `vscode.ExtensionContext` that satisfies this structurally.
 */
export interface WCarrierTraceContext {
	readonly workspaceState: {
		get<T>(key: string): T | undefined
		update(key: string, value: unknown): Thenable<void> | Promise<void>
	}
	readonly globalStorageUri: { readonly fsPath: string }
	readonly subscriptions: { dispose(): void }[]
}

/**
 * Pure env-var parser. Returns `true` iff `CLINEMM_W_TRACE` is
 * set to `"1"` or `"true"` (case-insensitive). Anything else
 * returns `false`.
 */
export function parseClinemmWTraceEnv(env: NodeJS.ProcessEnv = process.env): boolean {
	const raw = env[CLINEMM_W_TRACE_ENV]
	if (raw === undefined) {
		return false
	}
	const normalized = raw.trim().toLowerCase()
	return normalized === "1" || normalized === "true"
}

/**
 * Returns `true` iff the workspace toggle OR the env var is set.
 * Default off (workspace-state `undefined` + env unset).
 */
export function isWCarrierTraceEnabled(context: WCarrierTraceContext, env: NodeJS.ProcessEnv = process.env): boolean {
	return context.workspaceState.get<boolean>(WORKSPACE_STATE_KEY) === true || parseClinemmWTraceEnv(env)
}

/**
 * Toggle the workspace-state flag. NOT used in this commit; the
 * dump command reads regardless of enable state, mirroring the
 * existing diagnostics.
 */
export async function setWCarrierTraceEnabled(context: WCarrierTraceContext, enabled: boolean): Promise<void> {
	await context.workspaceState.update(WORKSPACE_STATE_KEY, enabled)
}

/**
 * One observable record. Keep the shape minimal: the four
 * required Q1..Q4 facts. Time is the wall-clock millisecond at
 * the moment of capture.
 *
 * `publishedW` covers Q4 exactly: `number` (W published),
 * `null` (carrier holds null at producer time = runtime
 * cleared, webview hides bar), `undefined` (no carrier
 * wired = legacy P fallback path).
 */
export type WCarrierTraceRecord =
	| {
			t: number
			kind: "carrier_observe"
			sessionId: string | undefined
			carrierW: number | null
			eventType: string
			snapshotW: number | undefined
	  }
	| {
			t: number
			kind: "state_publish"
			sessionId: string | undefined
			publishedW: number | null | undefined
	  }

/**
 * The side-channel buffer. Flushed on demand by `dumpWCarrierTrace`.
 * Module-private to keep the API surface tight.
 */
let traceBuffer: WCarrierTraceRecord[] = []

/**
 * Append one record to the trace buffer. No-op when the
 * diagnostic is disabled. Called from:
 *   - WorkingContextHostCapture.observe (carrier_observe)
 *   - getStateToPostToWebview (state_publish)
 * The observer / producer code is responsible for guarding with
 * `isWCarrierTraceEnabled` before invoking this function.
 */
export function recordWCarrierTrace(context: WCarrierTraceContext, record: WCarrierTraceRecord): void {
	if (!isWCarrierTraceEnabled(context)) {
		return
	}
	traceBuffer.push(record)
}

/**
 * Flush the trace buffer to JSONL on disk. Returns the absolute
 * file path that was written, or `undefined` if the diagnostic
 * is disabled.
 *
 * Always overwrites the file (single-snapshot dump; matches the
 * behavior of the existing diagnostics).
 */
export async function dumpWCarrierTrace(context: WCarrierTraceContext): Promise<string | undefined> {
	if (!isWCarrierTraceEnabled(context)) {
		return undefined
	}
	const dir = context.globalStorageUri.fsPath
	const filePath = join(dir, DUMP_FILE)
	const lines = traceBuffer.map((r) => JSON.stringify(r)).join("\n")
	await mkdir(dir, { recursive: true })
	await writeFile(filePath, lines + (lines ? "\n" : ""), "utf8")
	return filePath
}

/**
 * Test seam: reset the buffer between tests so successive runs
 * do not bleed. Production code never calls this.
 */
export function _resetWCarrierTrace(): void {
	traceBuffer = []
}
