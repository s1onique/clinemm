/**
 * ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
 * (twenty-eighth-pass) - temporary Q1..Q4 W-carrier trace observer
 * for the missing context-gauge live-qualification lane.
 *
 * module-seam default: OFF (fail-closed until activation)
 * dogfood-effective default: ON  (central profile resolver)
 * public-effective default:  OFF (central profile resolver)
 * The distinction matters: the raw module seam starts OFF; the
 * activation helper in `dogfood-diagnostic-profile.ts` flips it
 * to ON at extension activation in dogfood. After that flip, the
 * recorder consults ONLY the activation-frozen bit (no env-var
 * re-read); the env var is read in EXACTLY ONE place.
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
 * DESIGN - frozen module seam; central profile resolver
 * --------------------------------------------------------
 * The diagnostic ENABLEMENT decision lives in
 * `apps/vscode/src/sdk/dogfood-diagnostic-profile.ts` as
 * `resolveEffectiveWCarrierTrace` /
 * `applyWCarrierTraceDiagnosticProfile`. That resolver is the
 * SOLE parser of the env var (`CLINEMM_W_TRACE`) and the SOLE
 * place the dogfood identity bit is consulted. At extension
 * activation the profile helper flips the module-level seam
 * below.
 *
 * This module exposes a frozen module seam (`wCarrierTraceEnabled`)
 * set by `setWCarrierTraceEnabled(enabled: boolean)`. The trace
 * recorder consults ONLY that seam - the env var is NOT read
 * here. This mirrors the THSICAP / turn-state-writer-provenance
 * pattern: the recorder is decision-blind; the activation seam
 * is decision-frozen; post-activation `process.env` mutation
 * has no runtime semantic effect.
 *
 * Precedence (resolved by `dogfood-diagnostic-profile.ts`,
 * top wins; deterministic; fail-closed):
 *
 *   1. Explicit env override:
 *        `=1`/`true`/`yes` -> ON (honored in both profiles)
 *        `=0`/`off`/`false` -> OFF (honored in both profiles;
 *                                override-down in dogfood flips
 *                                the auto-on default off)
 *        garbage / unset -> falls through to (2)
 *   2. Profile default:
 *        `isDogfood === true`  -> ON  (auto-on in dogfood)
 *        `isDogfood === false` -> OFF (public default OFF
 *                                  preserved)
 *
 * The env var is consumed in EXACTLY ONE place
 * (`dogfood-diagnostic-profile.ts`); the recorder and the
 * observer / producer sites read ONLY the frozen module seam.
 *
 * CONSERVATION
 * ------------
 *   - WorkingContextHostCapture._latest assignment semantics
 *     unchanged.
 *   - getStateToPostToWebview producer unchanged.
 *   - Webview React rendering unchanged.
 *   - No public surface change (the module-private seam and the
 *     env-var parser location are the only diffs vs the
 *     previous pass).
 */

import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

const DUMP_FILE = "w-carrier-trace.jsonl"

/**
 * The env-var identifier. Read in EXACTLY ONE place
 * (`dogfood-diagnostic-profile.ts::parseClinemmWTraceEnv`).
 * Re-exported here only so the central resolver can locate
 * the constant without reaching into the runtime module.
 */
export const W_TRACE_ENV_VAR = "CLINEMM_W_TRACE"

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

// ---------------------------------------------------------------------------
// Module-level frozen seam.
// ---------------------------------------------------------------------------
// The dogfood diagnostic profile resolver arms this seam once at
// extension activation. After that, mutating `process.env` has NO
// effect on the trace recorder - the seam is decision-frozen for
// the lifetime of the extension host. This is the same pattern
// as `task-header-selector-input-capture.ts:captureEnabled` and
// `turn-state-writer-provenance.ts`; preserving it here keeps
// `isWCarrierTraceEnabled()` a single-bit read with no I/O.
// ---------------------------------------------------------------------------

/**
 * Module-level capture seam. The dogfood diagnostic profile
 * resolver sets this once at extension activation; production
 * capture consults this helper (NOT the env var directly).
 *
 * MODULE_SEAM_DEFAULT = OFF (fail-closed until activation).
 * DOGFOOD_EFFECTIVE_DEFAULT = ON (set by
 *   `applyWCarrierTraceDiagnosticProfile({...}, isDogfood=true)`
 *   at extension activation in dogfood builds).
 * PUBLIC_EFFECTIVE_DEFAULT = OFF (set by
 *   `applyWCarrierTraceDiagnosticProfile({...}, isDogfood=false)`
 *   at extension activation in public builds).
 */
let wCarrierTraceEnabled = false

/**
 * Read the frozen module-level seam. Pure bit read; no env-var
 * reading. The recorder and the observer / producer sites call
 * this helper instead of the previous workspace/env union.
 */
export function isWCarrierTraceEnabled(): boolean {
	return wCarrierTraceEnabled
}

/**
 * Flip the frozen module-level seam. Idempotent. Called from
 * `applyWCarrierTraceDiagnosticProfile` at extension activation.
 * Tests that bypass the activation path call this directly.
 *
 * CONSERVATION: setting `false` does NOT clear the buffer or
 * the dump file - the buffer persists across an OFF flip so a
 * dump after a session still flushes whatever was recorded up
 * to the OFF flip. This matches the existing THSICAP / TSWPD
 * patterns.
 */
export function setWCarrierTraceEnabled(enabled: boolean): void {
	wCarrierTraceEnabled = enabled
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
 * frozen module seam is OFF. Called from:
 *   - WorkingContextHostCapture.observe (carrier_observe)
 *   - getStateToPostToWebview (state_publish)
 * The observer / producer code is responsible for guarding with
 * `isWCarrierTraceEnabled()` before invoking this function. The
 * guard is belt-and-suspenders: this function itself ALSO
 * consults the seam, so a caller that forgets the guard still
 * honors the activation-frozen decision.
 */
export function recordWCarrierTrace(_context: WCarrierTraceContext, record: WCarrierTraceRecord): void {
	if (!isWCarrierTraceEnabled()) {
		return
	}
	traceBuffer.push(record)
}

/**
 * Flush the trace buffer to JSONL on disk. Returns the absolute
 * file path that was written.
 *
 * ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
 * (twenty-ninth-pass) — UNCONDITIONAL DUMP. Mirrors the
 * `dumpExtensionSideTurnStateWriterProvenanceDiagnostic` pattern:
 * the dump is intentionally NOT gated by the module seam. The
 * operator must be able to inspect whatever was captured even
 * after the diagnostic was disabled (e.g. via explicit
 * `CLINEMM_W_TRACE=0` between runs). The recorder's seam gate
 * controls what gets APPENDED to the buffer; the dump flushes
 * whatever is in the buffer at the time of the call.
 *
 * Always overwrites the file (single-snapshot dump; matches the
 * behavior of the existing diagnostics).
 */
export async function dumpWCarrierTrace(context: WCarrierTraceContext): Promise<string> {
	const dir = context.globalStorageUri.fsPath
	const filePath = join(dir, DUMP_FILE)
	const lines = traceBuffer.map((r) => JSON.stringify(r)).join("\n")
	await mkdir(dir, { recursive: true })
	await writeFile(filePath, lines + (lines ? "\n" : ""), "utf8")
	return filePath
}

/**
 * ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
 * (twenty-ninth-pass) — host-side dump entry point. Thin
 * wrapper around `dumpWCarrierTrace` that returns the encoded
 * `WCarrierTraceRecord[]` shape alongside the path so the
 * production command handler can show a useful acknowledgement
 * (record count + first/last timestamps). Mirrors the
 * `dumpExtensionSideTurnStateWriterProvenanceDiagnostic`
 * wrapper used by the TSWPD debug command. Reads the in-memory
 * buffer via the public record-reader rather than touching the
 * module-private buffer.
 */
export function getWCarrierTraceRecords(): readonly WCarrierTraceRecord[] {
	return traceBuffer
}

/**
 * Host-side dump helper. Returns the absolute path on success.
 * Used by `extension.ts:activate` to wire the
 * `cline.debug.dumpWCarrierTrace` command. The dump itself is
 * unconditional (the in-memory buffer is flushed regardless of
 * the module seam) — only the recorder's APPEND path is seam-gated.
 */
export async function dumpExtensionSideWCarrierTraceDiagnostic(context: WCarrierTraceContext): Promise<string> {
	return dumpWCarrierTrace(context)
}

/**
 * Test seam: reset the buffer between tests so successive runs
 * do not bleed. Production code never calls this.
 */
export function _resetWCarrierTrace(): void {
	traceBuffer = []
	wCarrierTraceEnabled = false
}
