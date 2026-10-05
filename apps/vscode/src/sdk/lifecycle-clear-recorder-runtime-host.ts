/**
 * ACT-CLINEMM-COMPLETION-AUTHORITY-SESSION-LIFECYCLE01 — CALLER-REASON DISCRIMINATOR.
 *
 * Extension-host dump adapter for the lifecycle-clear counter. Mirrors the
 * CCARD / CCDO / CCDSO / CCNTUP / EHLOOP / ELM SHADOW / ELM AUTHORITY dump
 * convention:
 *   - UNCONDITIONAL (operator can always inspect whatever the runtime captured,
 *     even if the recorder was subsequently disabled).
 *   - dump != clear (no snapshot mutation).
 *
 * The recorder module is `vscode`-free; this adapter wires the snapshot it
 * exposes (`getLifecycleClearSnapshot()`) to a JSON file under
 * `context.globalStorageUri` and is the host-side endpoint the Command
 * Palette registration calls.
 *
 * The recorder does NOT need a toggle / enable command — it gates internally
 * via `isDogfoodRuntime()` (matched to the ccupd01 / CCDO01 gate). In
 * `public` profile the snapshot reports `enabled: false` and `total: 0`,
 * which the dump serializes verbatim so the operator can distinguish
 * `viewer is in public profile` from `clear never fired`.
 *
 * NOTE: this is a DIAGNOSTIC seam. It does NOT mutate state, does NOT change
 * the lifecycle's ordering, and does NOT introduce any new protocol surface.
 * It serializes ONLY the existing `LifecycleClearSnapshot` shape produced by
 * `getLifecycleClearSnapshot()`.
 *
 * REMOVAL_TRIGGER: first of
 *   (a) root cause isolated (the LIVE discriminator converges on a concrete
 *       `lastClearReason` value from the LIVE CLASSIFICATION TABLE),
 *   (b) capture insufficient (the snapshot shape cannot reach any of the
 *       bounded enum values — design the successor counter),
 *   (c) successor evidence supersedes it.
 *
 *   Once the trigger fires this adapter + the registry entry + the
 *   package.json declaration + the extension.ts handler + the production
 *   recorder MUST be removed TOGETHER.
 */

import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { getLifecycleClearSnapshot, type LifecycleClearSnapshot } from "./lifecycle-clear-recorder"

const DUMP_FILE_COUNTERS = "lifecycle-clear.counters.json"

/**
 * Narrow structural context type. Mirrors the CCARD / CCDO / CCDSO / CCNTUP
 * / EHLOOP / ELM-SHADOW / ELM-AUTHORITY context shape so production and test
 * code pass a wider `vscode.ExtensionContext` that satisfies this shape via
 * structural compatibility — this module does NOT import vscode for type
 * information.
 */
export interface LifecycleClearDumpContext {
	readonly globalStorageUri: { readonly fsPath: string }
}

async function ensureDirectory(pathname: string): Promise<void> {
	await mkdir(pathname, { recursive: true })
}

/**
 * Dump the lifecycle-clear snapshot to a JSON file under the global storage
 * directory. Returns the absolute path on success.
 *
 * UNCONDITIONAL (operator can always inspect whatever the recorder captured,
 * even after the diagnostic was disabled). dump != clear (no snapshot
 * mutation). Mirrors the CCARD / CCDO / CCDSO / CCNTUP / EHLOOP / ELM-SHADOW
 * / ELM-AUTHORITY dump convention.
 *
 * The snapshot is always written (never empty) so the operator can
 * distinguish "recorder never observed a clear" (`total: 0`,
 * `lastClearReason: undefined`) from "dump never ran" (missing file).
 */
export async function dumpExtensionSideLifecycleClearSnapshot(
	context: LifecycleClearDumpContext,
): Promise<{ countersFile: string; snapshot: LifecycleClearSnapshot }> {
	const snapshot = getLifecycleClearSnapshot()
	const dir = context.globalStorageUri.fsPath
	await ensureDirectory(dir)
	const countersFile = join(dir, DUMP_FILE_COUNTERS)
	await writeFile(countersFile, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8")
	return { countersFile, snapshot }
}
