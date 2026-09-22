/**
 * ACT-CLINEMM-LONG-HORIZON-CONTINUATION-CARDINALITY-AUTHORITY01
 *
 * Extension-host runtime for the Continuation Cardinality Authority
 * (CCARD) diagnostic. Owns the host-side dump adapter that the
 * operator invokes via the Cline Debug: Dump Continuation Cardinality
 * Authority Command Palette command.
 *
 * Pattern (mirrors the BJLA / BOCOR / TSWPD / THSICAP dump
 * commands):
 *
 *   - The bounded ring + capture helpers live in
 *     ./continuation-cardinality-authority.ts (no vscode import, no
 *     ExtensionContext).
 *   - This module adds ONLY the host-side dump adapter so the
 *     production Command Palette command can serialize the ring + the
 *     per-stage counters to JSONL files under context.globalStorageUri.
 *   - The dump is UNCONDITIONAL (the operator must be able to
 *     inspect any captured records even after the diagnostic is
 *     disabled).
 *   - The dump does NOT clear the ring (dump != clear contract).
 *
 * No toggle command. No enable command. The diagnostic enablement is
 * driven exclusively by the central dogfood profile resolver (see
 * ./dogfood-diagnostic-profile.ts -
 * applyContinuationCardinalityAuthorityDiagnosticProfile). A workspace
 * toggle would violate the "dogfood-only, no operator knob" contract
 * from ACT sec 5.
 *
 * REMOVAL_TRIGGER (per ACT sec 31 / 32): first 1 -> 2 cardinality
 * seam mechanically identified AND ablation returns cardinality to 1
 * (PASS_CONTINUATION_*), OR CAPTURE_INSUFFICIENT, OR
 * HALT_RED_NOT_REPRODUCED. Once the trigger fires, this module, the
 * underlying ring module, the activation helper, the Command Palette
 * registration, the registry entry, and the package.json command
 * declaration MUST be removed TOGETHER (no quiet survival through
 * this ACT).
 */

import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import {
	type ContinuationCardinalityAuthorityRecord,
	getContinuationCardinalityAuthorityCaptureRecords,
	getContinuationCardinalityAuthorityCounters,
} from "./continuation-cardinality-authority"

const DUMP_FILE_RING = "continuation-cardinality-authority.jsonl"
const DUMP_FILE_COUNTERS = "continuation-cardinality-authority.counters.json"

/**
 * Narrow structural type for the bits of vscode.ExtensionContext the
 * diagnostic touches. Mirrors the BJLA / BOCOR / TSWPD / THSICAP
 * runtime context shape structurally so production and test code
 * pass a wider context that satisfies this shape via structural
 * compatibility - this module does NOT import vscode for type
 * information.
 */
export interface ContinuationCardinalityAuthorityDiagnosticContext {
	readonly globalStorageUri: { readonly fsPath: string }
}

async function ensureDirectory(pathname: string): Promise<void> {
	await mkdir(pathname, { recursive: true })
}

/**
 * Dump the bounded CCARD ring + per-stage counters to JSONL / JSON
 * files under the global storage directory. Returns the absolute
 * paths on success.
 *
 * UNCONDITIONAL (the operator must be able to inspect any captured
 * records even after the diagnostic was subsequently disabled). The
 * shared module's readers are the single source of truth; this
 * function never touches the ring directly.
 *
 * dump != clear: the ring is preserved across dumps. An accidental
 * first dump does not destroy evidence.
 */
export async function dumpExtensionSideContinuationCardinalityAuthorityDiagnostic(
	context: ContinuationCardinalityAuthorityDiagnosticContext,
): Promise<{ ringFile: string; countersFile: string; recordCount: number; totalCaptured: number }> {
	const records = getContinuationCardinalityAuthorityCaptureRecords()
	const counters = getContinuationCardinalityAuthorityCounters()
	const dir = context.globalStorageUri.fsPath
	await ensureDirectory(dir)
	const ringFile = join(dir, DUMP_FILE_RING)
	const countersFile = join(dir, DUMP_FILE_COUNTERS)
	const jsonl = records.map((r: ContinuationCardinalityAuthorityRecord) => JSON.stringify(r)).join("\n")
	if (records.length === 0) {
		// Write an explicit empty file so the operator does not mistake
		// missing file for extension-not-running. Mirrors the BJLA /
		// BOCOR dump convention.
		await writeFile(ringFile, "", "utf8")
	} else {
		await writeFile(ringFile, jsonl + "\n", "utf8")
	}
	await writeFile(countersFile, JSON.stringify(counters, null, 2) + "\n", "utf8")
	return { ringFile, countersFile, recordCount: records.length, totalCaptured: counters.total }
}
