/**
 * ACT-CLINEMM-BACKGROUND-COMMAND-LIVENESS-AUTHORITY-SPLIT01
 *
 * Extension-host runtime for the Background Job Liveness Authority
 * (BJLA) diagnostic. Owns the host-side dump adapter that the
 * operator invokes via the Cline Debug: Dump Background Job Liveness
 * Authority Command Palette command.
 *
 * Pattern (mirrors the TSWPD / THSICAP / W carrier / BOCOR dump
 * commands):
 *
 *   - The bounded ring + capture helpers live in
 *     ./background-job-liveness-authority.ts (no vscode import, no
 *     ExtensionContext).
 *   - This module adds ONLY the host-side dump adapter so the
 *     production Command Palette command can serialize the ring to a
 *     JSONL file under context.globalStorageUri.
 *   - The dump is UNCONDITIONAL (the operator must be able to
 *     inspect any captured records even after the diagnostic is
 *     disabled).
 *   - The dump does NOT clear the ring (dump != clear contract).
 *
 * No toggle command. No enable command. The diagnostic enablement is
 * driven exclusively by the central dogfood profile resolver (see
 * ./dogfood-diagnostic-profile.ts -
 * applyBackgroundJobLivenessAuthorityDiagnosticProfile). A workspace
 * toggle would violate the "dogfood-only, no operator knob" contract
 * from ACT sec 5.
 *
 * REMOVAL_TRIGGER (per ACT sec 37): first successful LIVE
 * classification AND qualification of the bounded repair, OR
 * CAPTURE_INSUFFICIENT. Once the trigger fires, this module, the
 * underlying ring module, the activation helper, the Command
 * Palette registration, the registry entry, and the package.json
 * command declaration MUST be removed TOGETHER (no quiet survival
 * through this ACT).
 */

import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { getBackgroundJobLivenessAuthorityCaptureRecords } from "./background-job-liveness-authority"

const DUMP_FILE = "background-job-liveness-authority.jsonl"

/**
 * Narrow structural type for the bits of vscode.ExtensionContext the
 * diagnostic touches. Mirrors the THSICAP / TSWPD / W carrier / BOCOR
 * runtime context shape structurally so production and test code
 * pass a wider context that satisfies this shape via structural
 * compatibility - this module does NOT import vscode for type
 * information.
 */
export interface BackgroundJobLivenessAuthorityDiagnosticContext {
	readonly globalStorageUri: { readonly fsPath: string }
}

async function ensureDirectory(pathname: string): Promise<void> {
	await mkdir(pathname, { recursive: true })
}

/**
 * Dump the bounded BJLA ring to a JSONL file under the global
 * storage directory. Returns the absolute path on success.
 *
 * UNCONDITIONAL (the operator must be able to inspect any captured
 * records even after the diagnostic was subsequently disabled). The
 * shared module's getBackgroundJobLivenessAuthorityCaptureRecords()
 * is the single source of truth; this function never touches the
 * ring directly.
 *
 * dump != clear: the ring is preserved across dumps. An accidental
 * first dump does not destroy evidence.
 */
export async function dumpExtensionSideBackgroundJobLivenessAuthorityDiagnostic(
	context: BackgroundJobLivenessAuthorityDiagnosticContext,
): Promise<{ file: string; recordCount: number }> {
	const records = getBackgroundJobLivenessAuthorityCaptureRecords()
	const dir = context.globalStorageUri.fsPath
	await ensureDirectory(dir)
	const file = join(dir, DUMP_FILE)
	const jsonl = records.map((r) => JSON.stringify(r)).join("\n")
	if (records.length === 0) {
		// Write an explicit empty file so the operator does not mistake
		// missing file for extension-not-running. Mirrors the THSICAP /
		// BOCOR dump convention.
		await writeFile(file, "", "utf8")
	} else {
		await writeFile(file, jsonl + "\n", "utf8")
	}
	return { file, recordCount: records.length }
}
