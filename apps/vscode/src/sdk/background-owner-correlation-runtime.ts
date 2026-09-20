/**
 * ACT-CLINEMM-BACKGROUND-COMMAND-OWNER-CORRELATION-CAPTURE01
 *
 * Extension-host runtime for the Background Owner Correlation (BOCOR)
 * diagnostic. Owns the host-side dump adapter that the operator
 * invokes via the Cline Debug: Dump Background Owner Correlation
 * Command Palette command.
 *
 * Pattern (mirrors the TSWPD / THSICAP / W carrier dump commands):
 *
 *   - The bounded ring + capture helpers live in
 *     ./background-owner-correlation.ts (no vscode import, no
 *     ExtensionContext).
 *   - This module adds ONLY the host-side dump adapter so the
 *     production Command Palette command can serialize the ring to
 *     a JSONL file under context.globalStorageUri.
 *   - The dump is UNCONDITIONAL (the operator must be able to inspect
 *     any captured records even after the diagnostic is disabled).
 *   - The dump does NOT clear the ring (dump != clear contract).
 *
 * No toggle command. No enable command. The diagnostic enablement
 * is driven exclusively by the central dogfood profile resolver
 * (see ./dogfood-diagnostic-profile.ts -
 * applyBackgroundOwnerCorrelationDiagnosticProfile). A workspace
 * toggle would violate the "dogfood-only, no operator knob"
 * contract from ACT sec 5.
 *
 * REMOVAL_TRIGGER (per ACT sec 37): first successful LIVE binding
 * of the LIVE cause AND qualification of the bounded repair, OR
 * CAPTURE_INSUFFICIENT. Once the trigger fires, this module,
 * the underlying ring module, the activation helper, the
 * Command Palette registration, the registry entry, and the
 * package.json command declaration MUST be removed TOGETHER
 * (no quiet survival through this ACT).
 */

import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { getBackgroundOwnerCorrelationCaptureRecords } from "./background-owner-correlation"

const DUMP_FILE = "background-owner-correlation.jsonl"

/**
 * Narrow structural type for the bits of vscode.ExtensionContext
 * the diagnostic touches. Mirrors the THSICAP / TSWPD runtime
 * context shape structurally so production and test code pass a
 * wider context that satisfies this shape via structural
 * compatibility - this module does NOT import vscode for type
 * information.
 */
export interface BackgroundOwnerCorrelationDiagnosticContext {
	readonly globalStorageUri: { readonly fsPath: string }
}

async function ensureDirectory(pathname: string): Promise<void> {
	await mkdir(pathname, { recursive: true })
}

/**
 * Dump the bounded BOCOR ring to a JSONL file under the global
 * storage directory. Returns the absolute path on success.
 *
 * UNCONDITIONAL (the operator must be able to inspect any captured
 * records even after the diagnostic was subsequently disabled).
 * The shared module's getBackgroundOwnerCorrelationCaptureRecords()
 * is the single source of truth; this function never touches the
 * ring directly.
 *
 * dump != clear: the ring is preserved across dumps. An accidental
 * first dump does not destroy evidence.
 */
export async function dumpExtensionSideBackgroundOwnerCorrelationDiagnostic(
	context: BackgroundOwnerCorrelationDiagnosticContext,
): Promise<{ file: string; recordCount: number }> {
	const records = getBackgroundOwnerCorrelationCaptureRecords()
	const dir = context.globalStorageUri.fsPath
	await ensureDirectory(dir)
	const file = join(dir, DUMP_FILE)
	const jsonl = records.map((r) => JSON.stringify(r)).join("\n")
	if (records.length === 0) {
		// Write an explicit empty file so the operator does not mistake
		// missing file for extension-not-running. Mirrors the THSICAP
		// dump convention.
		await writeFile(file, "", "utf8")
	} else {
		await writeFile(file, jsonl + "\n", "utf8")
	}
	return { file, recordCount: records.length }
}
