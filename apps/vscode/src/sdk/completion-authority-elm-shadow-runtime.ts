/**
 * ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-DEFAULT01-REMOVE-LEGACY-TS-AUTHORITY
 *
 * TEST-FIXTURE ONLY. The Elm completion-authority SHADOW runtime has
 * been RETIRED from production. The file remains in the codebase
 * because `__tests__/completion-authority-elm-shadow02.test.ts`
 * imports it as a pure-Elm-kernel correspondence test fixture.
 * There is NO production wiring in `extension.ts`,
 * `continuation-cardinality-authority.ts`, or anywhere else; the
 * `DumpCompletionAuthorityElmShadow` Command Palette registration
 * and `applyElmShadowDiagnosticProfile` activation helper have been
 * deleted. Tests that import this module exercise the bounded ring
 * + counter snapshot directly; they do not represent production
 * behavior.
 *
 * History note: prior versions of this file wired the dump to a
 * Command Palette registration in `extension.ts:1086-1108`. That
 * registration was removed along with the shadow runtime from
 * production.
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
