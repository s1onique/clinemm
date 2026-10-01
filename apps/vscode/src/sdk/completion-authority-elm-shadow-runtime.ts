/**
 * ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SHADOW02-CORRECTION01
 *
 * Extension-host dump adapter for the Elm completion-authority
 * shadow observer. Mirrors the BJLA / BOCOR / CCARD dump pattern:
 * unconditional (operator can always inspect whatever was captured),
 * dump != clear (no ring mutation).
 *
 * The shadow module is unaware of vscode; it exposes the bounded
 * ring + counter snapshot via pure functions. This module wires
 * those to JSONL / JSON files under context.globalStorageUri and is
 * the host-side endpoint the Command Palette registration calls.
 *
 * The runtime does NOT enable the shadow; enablement is owned
 * exclusively by `applyElmShadowDiagnosticProfile` in
 * dogfood-diagnostic-profile.ts, called from extension.ts:activate
 * BEFORE SdkController construction.
 */

import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import {
	type ElmShadowCountersSnapshot,
	getElmShadowCounters,
	getElmShadowRing,
} from "./completion-authority-elm-shadow"

const DUMP_FILE_RING = "completion-authority-elm-shadow.jsonl"
const DUMP_FILE_COUNTERS = "completion-authority-elm-shadow.counters.json"

/**
 * Narrow structural context type. Mirrors the BJLA / BOCOR / CCARD
 * runtime context shape so production and test code pass a wider
 * vscode.ExtensionContext that satisfies this shape via structural
 * compatibility — this module does NOT import vscode for type
 * information.
 */
export interface ElmShadowDiagnosticContext {
	readonly globalStorageUri: { readonly fsPath: string }
}

async function ensureDirectory(pathname: string): Promise<void> {
	await mkdir(pathname, { recursive: true })
}

/**
 * Dump the bounded Elm-shadow ring + counter snapshot to JSONL / JSON
 * files under the global storage directory. Returns the absolute
 * paths on success.
 *
 * UNCONDITIONAL (operator can always inspect whatever was captured
 * even after the diagnostic was subsequently disabled). dump !=
 * clear (no shadow ring mutation). Mirrors the BJLA / BOCOR / CCARD
 * dump convention.
 */
export async function dumpExtensionSideElmShadowDiagnostic(
	context: ElmShadowDiagnosticContext,
): Promise<{ ringFile: string; countersFile: string; recordCount: number; counters: ElmShadowCountersSnapshot }> {
	const records = getElmShadowRing()
	const counters = getElmShadowCounters()
	const dir = context.globalStorageUri.fsPath
	await ensureDirectory(dir)
	const ringFile = join(dir, DUMP_FILE_RING)
	const countersFile = join(dir, DUMP_FILE_COUNTERS)
	if (records.length === 0) {
		// Write an explicit empty file so the operator does not mistake
		// missing file for extension-not-running.
		await writeFile(ringFile, "", "utf8")
	} else {
		const jsonl = records.map((r) => JSON.stringify(r)).join("\n")
		await writeFile(ringFile, jsonl + "\n", "utf8")
	}
	await writeFile(countersFile, `${JSON.stringify(counters, null, 2)}\n`, "utf8")
	return { ringFile, countersFile, recordCount: records.length, counters }
}
