// ===========================================================================
// ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01-CORRECTION01-FIX01
//
// Extension-host runtime for the bounded TaskHeader selector-input diagnostic.
// Provides the operator-visible dump mechanism the predecessor CORRECTION01
// omitted (HALT_CAPTURE_NOT_EXPORTABLE disposition). Mirrors the
// TSWPD runtime pattern exactly:
//
//   - one user action: cline.debug.dumpTaskHeaderSelectorInputDiagnostic
//     serializes the bounded ring to <globalStorageUri>/
//     task-header-selector-input-capture.jsonl
//   - one clear action: cline.debug.clearTaskHeaderSelectorInputDiagnostic
//
// Default off. The gate is the env var
// CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1=<truthy>; the dump command
// is ALWAYS reachable regardless of the gate so an operator can inspect
// an existing ring even after the diagnostic is disabled (mirrors the
// TSWPD / PTAD dump convention).
//
// REMOVAL_TRIGGER (per Factory doctrine on temporary diagnostics):
//   first successful LIVE binding of
//     PUBLICATION_SHADOW_BINDING + LOCAL_SHADOW_TURNSEQ
//     for a recurrence, OR
//   CAPTURE_INSUFFICIENT
// No quiet promotion to architecture; the diagnostic is removed once
// the LIVE binding is mechanically settled OR a successor evidence
// channel supersedes it.
// ===========================================================================

import { mkdir, unlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import {
	clearTaskHeaderSelectorInputRecords as _clearDiagnosticsRecords,
	getTaskHeaderSelectorInputRecords as _getDiagnosticsRecords,
	type TaskHeaderSelectorInputRecord,
} from "./task-header-selector-input-capture"

const DUMP_FILE = "task-header-selector-input-capture.jsonl"

/**
 * Narrow structural type for the bits of vscode.ExtensionContext the
 * diagnostic touches. Mirrors the TSWPD diagnostic context shape
 * structurally so production and test code pass a wider context that
 * satisfies this shape via structural compatibility -- this module does
 * NOT import the vscode module for type information.
 */
export interface TaskHeaderSelectorInputDiagnosticContext {
	readonly globalStorageUri: { readonly fsPath: string }
}

async function ensureDirectory(pathname: string): Promise<void> {
	await mkdir(pathname, { recursive: true })
}

/**
 * Dump the bounded selector-input ring to a JSONL file under the global
 * storage directory. Returns the absolute path and the record count.
 *
 * Unconditional: the operator must be able to inspect any captured
 * records even if the diagnostic was subsequently disabled. The shared
 * module's `getTaskHeaderSelectorInputRecords()` is the single source of
 * truth; this function never touches the ring directly.
 */
export async function dumpExtensionSideTaskHeaderSelectorInputDiagnostic(
	context: TaskHeaderSelectorInputDiagnosticContext,
): Promise<{ file: string; recordCount: number }> {
	const records: readonly TaskHeaderSelectorInputRecord[] = _getDiagnosticsRecords()
	const dir = context.globalStorageUri.fsPath
	await ensureDirectory(dir)
	const file = join(dir, DUMP_FILE)
	const jsonl = records.map((r) => JSON.stringify(r)).join("\n")
	if (records.length === 0) {
		// Write an explicit empty file so the operator does not mistake
		// "missing file" for "extension-not-running".
		await writeFile(file, "", "utf8")
	} else {
		await writeFile(file, jsonl, "utf8")
	}
	return { file, recordCount: records.length }
}

/**
 * Best-effort path to delete the dump file and clear the underlying
 * ring. Returns the absolute path on success.
 *
 * Mirrors the dump command's permissiveness: the operator can always
 * inspect / clear the diagnostic state regardless of whether it is
 * currently enabled.
 */
export async function clearExtensionSideTaskHeaderSelectorInputDiagnostic(
	context: TaskHeaderSelectorInputDiagnosticContext,
): Promise<string> {
	_clearDiagnosticsRecords()
	const dir = context.globalStorageUri.fsPath
	await ensureDirectory(dir)
	const file = join(dir, DUMP_FILE)
	try {
		await unlink(file)
	} catch {
		// ENOENT is fine; the file may not exist yet.
	}
	return file
}
