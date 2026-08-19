/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-LIVE-CONTEXT-DIMENSIONS01-C1-FIXUP01
 *
 * Extension-host runtime for the per-boundary request-site capture
 * layer (LCD01). Owns the live-extraction dump path.
 *
 * Trust binding:
 *   - Same toggle as the existing PostTerminalAuthorityDiagnostic:
 *     the wire bit `_ptadEnabled` (workspace state `ptadEnabled`)
 *     flips both ring buffers on/off. ONE user action enables both
 *     traces; the toggle is the proven operational path. The
 *     LCD01 schema module exposes `enable / disable / isEnabled` so
 *     the SdkController and webview can co-flip with PTAD without
 *     taking on a second workspace-state key.
 *   - One dump action: `cline.debug.dumpLiveContextDimensions01`
 *     posts a `clinemm.dumpLiveContextDimensions01` message to the
 *     webview asking it to flush, and the webview appends its
 *     records to `~/.cline/data/live-context-dimensions01-webview.jsonl`
 *     via the `clinemm.appendLiveContextDimensions01` postMessage
 *     type. There is no extension-side ring buffer for LCD01 — the
 *     diagnostic is webview-only by design (it captures per-boundary
 *     observations that originate on the webview side). The
 *     extension-side runtime is therefore just a thin shim that
 *     accepts the webview-flushed records and writes them to disk.
 *
 * The runtime module is intentionally separated from the diagnostic
 * module so the diagnostic stays webview-bundle-safe.
 */

import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import {
	getLiveContextDimensions01CaptureRecords,
	type LiveContextDimensions01Capture,
} from "@shared/live-context-dimensions01-capture"

/**
 * The JSONL file name the webview-side records are flushed to under
 * `globalStorageUri`. Mirrors the naming convention of the existing
 * PTAD webview dump file.
 */
const DUMP_FILE_WEBVIEW = "live-context-dimensions01-webview.jsonl"

/**
 * Narrow structural type for the bits of vscode.ExtensionContext the
 * LCD01 runtime touches. Defined locally so the runtime module does
 * not import `vscode` for type information. Both production and
 * test code pass a wider context that satisfies this shape via
 * structural compatibility.
 */
export interface LiveContextDimensions01RuntimeContext {
	readonly globalStorageUri: { readonly fsPath: string }
}

/**
 * Narrow structural validator: returns `true` iff the unknown input
 * has the LCD01 record shape. Casts are intentional; the gRPC layer
 * is type-erased for the postMessage path and the structural check
 * is the only sound gate.
 */
function isLiveContextDimensions01Like(value: unknown): value is LiveContextDimensions01Capture {
	if (typeof value !== "object" || value === null) {
		return false
	}
	const candidate = value as Record<string, unknown>
	return (
		typeof candidate.kind === "string" &&
		typeof candidate.capturedAt === "number" &&
		typeof candidate.captureSeq === "number" &&
		typeof candidate.correlation === "object" &&
		candidate.correlation !== null
	)
}

/**
 * Ensures the directory exists before writing so the dump cannot
 * ENOENT on a fresh installation.
 */
async function ensureDirectory(pathname: string): Promise<void> {
	await mkdir(pathname, { recursive: true })
}

/**
 * Append a batch of webview-side records to the LCD01 webview dump
 * file. Called by the postMessage handler that the webview posts
 * records to. Mirrors the PTAD `appendWebviewSidePostTerminalAuthorityDiagnostic`
 * API surface.
 *
 * Always writes the file (even when the records array is empty or all
 * records fail structural validation), so the dogfood user can
 * confirm the dump actually ran. The dump timestamp is implicit in
 * the file's mtime.
 */
export async function appendWebviewSideLiveContextDimensions01(
	context: LiveContextDimensions01RuntimeContext,
	records: readonly unknown[],
): Promise<string> {
	const typedRecords = records.filter(isLiveContextDimensions01Like)
	const dir = context.globalStorageUri.fsPath
	await ensureDirectory(dir)
	const file = join(dir, DUMP_FILE_WEBVIEW)
	const jsonl = typedRecords.map((record) => JSON.stringify(record)).join("\n")
	await writeFile(file, jsonl, "utf8")
	return file
}

/**
 * Convenience helper used by integration tests: read the current
 * webview-side buffer and flush it directly to disk without going
 * through the postMessage hop. The production dump command uses the
 * postMessage path; this helper exists so a unit test can verify
 * the JSONL shape without spinning up a webview.
 */
export async function dumpWebviewSideLiveContextDimensions01ForTesting(
	context: LiveContextDimensions01RuntimeContext,
): Promise<string> {
	const records = getLiveContextDimensions01CaptureRecords()
	return appendWebviewSideLiveContextDimensions01(context, records)
}
