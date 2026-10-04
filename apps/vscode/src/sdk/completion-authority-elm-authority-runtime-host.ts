/**
 * ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-AUTHORITY-COUNTER-DUMP01
 *
 * Extension-host dump adapter for the SYNCHRONOUS REAL Elm
 * completion-authority runtime. Mirrors the Elm SHADOW dump pattern
 * (`completion-authority-elm-shadow-runtime.ts`): unconditional
 * (operator can always inspect whatever the runtime captured), dump
 * != clear (no counter mutation).
 *
 * The runtime module is `vscode`-free; this adapter wires the
 * counter snapshot it exposes (`getElmAuthorityCounters`) to a JSON
 * file under `context.globalStorageUri` and is the host-side
 * endpoint the Command Palette registration calls.
 *
 * The runtime does NOT enable the authority kernel; enablement is
 * owned exclusively by `applyElmAuthorityProfile` in
 * dogfood-diagnostic-profile.ts, called from extension.ts:activate
 * BEFORE SdkController construction. There is no toggle command —
 * the dump is unconditionally reachable so an operator can inspect
 * the runtime's captured counters whether the kernel is currently
 * armed or not.
 *
 * NOTE: this is a DIAGNOSTIC seam. It does NOT mutate state, does
 * NOT change the authority decision, and does NOT introduce any new
 * protocol surface. It serializes ONLY the existing
 * `ElmAuthorityCountersSnapshot` shape produced by
 * `getElmAuthorityCounters()`.
 *
 * REMOVAL_TRIGGER: PASS_LIVE_ELM_AUTHORITY (first real Elm kernel
 * on the commit path with operator-rendered 1:1 live correspondence)
 * AND the cause is RED on HOLD/FAILURE for operator review, OR
 * successor evidence supersedes. Once the trigger fires this adapter
 * + the registry entry + the package.json declaration + the
 * extension.ts handler MUST be removed TOGETHER.
 */

import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { type ElmAuthorityCountersSnapshot, getElmAuthorityCounters } from "./completion-authority-elm-authority-runtime"

const DUMP_FILE_COUNTERS = "completion-authority-elm-authority.counters.json"

/**
 * Narrow structural context type. Mirrors the SHADOW / BJLA /
 * BOCOR / CCARD runtime context shape so production and test code
 * pass a wider `vscode.ExtensionContext` that satisfies this shape
 * via structural compatibility — this module does NOT import vscode
 * for type information.
 */
export interface ElmAuthorityDumpContext {
	readonly globalStorageUri: { readonly fsPath: string }
}

async function ensureDirectory(pathname: string): Promise<void> {
	await mkdir(pathname, { recursive: true })
}

/**
 * Dump the Elm-authority counter snapshot to a JSON file under the
 * global storage directory. Returns the absolute path on success.
 *
 * UNCONDITIONAL (operator can always inspect whatever the runtime
 * captured, even after the diagnostic was subsequently disabled).
 * dump != clear (no counter mutation). Mirrors the SHADOW dump
 * convention.
 *
 * The snapshot is always written (never empty) so the operator can
 * distinguish "runtime never observed a record" (all-zero counters)
 * from "dump never ran" (missing file).
 */
export async function dumpExtensionSideElmAuthorityCounters(
	context: ElmAuthorityDumpContext,
): Promise<{ countersFile: string; counters: ElmAuthorityCountersSnapshot }> {
	const counters = getElmAuthorityCounters()
	const dir = context.globalStorageUri.fsPath
	await ensureDirectory(dir)
	const countersFile = join(dir, DUMP_FILE_COUNTERS)
	await writeFile(countersFile, `${JSON.stringify(counters, null, 2)}\n`, "utf8")
	return { countersFile, counters }
}
