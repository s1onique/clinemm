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
import {
	getBackgroundJobLivenessAuthorityCaptureRecords,
	getBackgroundJobLivenessAuthorityProvenanceSnapshot,
} from "./background-job-liveness-authority"

const DUMP_FILE = "background-job-liveness-authority.jsonl"

/**
 * ACT-CLINEMM-CONTAINMENT-FAILURE-PROVENANCE-RETENTION01 (CFPR01).
 *
 * The COMPANION provenance artifact. It sits NEXT TO the original JSONL
 * (which keeps its exact format and consumers) and carries the
 * protected retention that survives the ordinary 256-record FIFO wrap.
 */
const PROVENANCE_DUMP_FILE = "background-job-liveness-authority.provenance.json"

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
): Promise<{ file: string; recordCount: number; provenanceFile: string }> {
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
	// ACT-CLINEMM-CONTAINMENT-FAILURE-PROVENANCE-RETENTION01 (CFPR01):
	// the COMPANION provenance artifact. It is written UNCONDITIONALLY
	// (the operator must be able to inspect whatever was captured even
	// after the diagnostic was disabled) and it does NOT clear the
	// protected store (dump != clear).
	//
	// The serialization is STABLE: the snapshot contains no wall-clock
	// timestamp of its own, so repeated dumps with no new events produce
	// byte-identical artifacts.
	const provenanceFile = join(dir, PROVENANCE_DUMP_FILE)
	const provenance = getBackgroundJobLivenessAuthorityProvenanceSnapshot()
	await writeFile(provenanceFile, `${JSON.stringify(provenance, null, 2)}\n`, "utf8")
	return { file, recordCount: records.length, provenanceFile }
}
