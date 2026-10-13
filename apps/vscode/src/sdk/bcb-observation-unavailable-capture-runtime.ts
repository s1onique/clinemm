/**
 * ACT-CLINEMM-BCB-CAPTURE01
 *
 * Extension-host runtime for the BCB observation-unavailable capture
 * diagnostic. Owns the live-enable toggle and the live-extraction dump
 * for the bounded ring exposed by
 * `@shared/bcb-observation-unavailable-capture`. This module is the ONLY
 * extension-side module that touches `context.workspaceState` for the
 * diagnostic — every other site reads
 * `isBcbObservationUnavailableCaptureWorkspaceEnabled()` and respects
 * its answer.
 *
 * Trust binding (mirrors turn-state-writer-provenance-runtime.ts):
 *   - Default off: `context.workspaceState.get("bcbObsCapEnabled")` is
 *     `undefined` for any installation that has never toggled the
 *     command, so the diagnostic stays a complete no-op.
 *   - One user action: `cline.debug.toggleBcbObservationUnavailableCapture`
 *     flips the workspace-state flag.
 *   - One dump action: `cline.debug.dumpBcbObservationUnavailableCapture`
 *     serializes the ring to
 *     `<context.globalStorageUri.fsPath>/bcb-observation-unavailable-capture.jsonl`.
 *     The actual on-disk location is whatever VS Code hands us via
 *     `globalStorageUri`; the code contract is the `globalStorageUri`-
 *     derived directory, NOT a hard-coded `~/.cline/data/...` path.
 *   - No duplication: the diagnostic ring, enable/disable seam, and
 *     recorders live in `@shared/bcb-observation-unavailable-capture`.
 *     This module is the host-side adapter that satisfies the Command
 *     Palette contract.
 *
 * No webview counterpart: the BCB capture is a pure host-side concern
 * (the tracked decision lives in the SdkSessionEventCoordinator, which
 * never reaches the webview). The dump is therefore a single-file write
 * — no postMessage handshake.
 */

import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import {
	disableBcbObservationUnavailableCapture,
	enableBcbObservationUnavailableCapture,
	getBcbObservationUnavailableCaptureRecords,
} from "@shared/bcb-observation-unavailable-capture"

/**
 * The single workspace-state key the diagnostic owns. Lives under the
 * workspace (not global) so each workspace's toggles are independent.
 */
const WORKSPACE_STATE_KEY = "bcbObsCapEnabled"

const DUMP_FILE = "bcb-observation-unavailable-capture.jsonl"

/**
 * Narrow structural type for the bits of vscode.ExtensionContext the
 * diagnostic touches. Mirrors TurnStateWriterProvenanceDiagnosticContext
 * structurally so production and test code pass a wider context that
 * satisfies this shape via structural compatibility — this module
 * does NOT import `vscode` for type information.
 */
export interface BcbObservationUnavailableCaptureContext {
	readonly workspaceState: {
		get<T>(key: string): T | undefined
		update(key: string, value: unknown): Thenable<void> | Promise<void>
	}
	readonly globalStorageUri: { readonly fsPath: string }
	readonly subscriptions: { dispose(): void }[]
}

/**
 * Returns `true` iff the user has explicitly enabled the diagnostic
 * for this workspace. The default (`undefined` workspace state) is
 * `false`. Reading this value does NOT itself enable the ring — the
 * caller is responsible for honoring the flag (the dump command is
 * allowed regardless so an operator can inspect an existing ring).
 */
export function isBcbObservationUnavailableCaptureWorkspaceEnabled(context: BcbObservationUnavailableCaptureContext): boolean {
	const value = context.workspaceState.get<boolean>(WORKSPACE_STATE_KEY)
	return value === true
}

/**
 * Flip the workspace-state flag. Returns the new value. Side-effects:
 *   - writes the workspace-state key (`bcbObsCapEnabled` ← next)
 *   - when flipping ON: calls the shared `enable...()` so the next
 *     decision actually records
 *   - when flipping OFF: calls the shared `disable...()` so future
 *     decisions are no-ops (preserves any existing records)
 *
 * The toggle does NOT clear the existing ring on disable; records
 * captured before the toggle remain queryable and dumpable. This
 * matches the post-terminal-authority + turn-state-writer-provenance
 * toggle behavior.
 */
export async function toggleBcbObservationUnavailableCaptureWorkspaceEnabled(
	context: BcbObservationUnavailableCaptureContext,
): Promise<boolean> {
	const next = !isBcbObservationUnavailableCaptureWorkspaceEnabled(context)
	await context.workspaceState.update(WORKSPACE_STATE_KEY, next)
	if (next) {
		enableBcbObservationUnavailableCapture()
	} else {
		disableBcbObservationUnavailableCapture()
	}
	return next
}

/**
 * Ensure the global storage directory exists before writing. The
 * PTAD / TSWPD runtimes use the same pattern; mirroring it here keeps
 * the debug path robust on a fresh install where the directory
 * hasn't been created yet.
 */
async function ensureDirectory(pathname: string): Promise<void> {
	await mkdir(pathname, { recursive: true })
}

/**
 * Dump the bounded BCB observation-unavailable capture ring to a JSONL
 * file under the global storage directory. Returns the absolute path
 * on success.
 *
 * The dump is intentionally unconditional: the operator must be
 * able to inspect any captured records even if the diagnostic was
 * subsequently disabled. The shared module's `getRecords()` is the
 * single source of truth; this function never touches the ring
 * directly.
 *
 * The diagnostic status (enabled / record count) is observable to
 * the operator via the JSONL file content (empty = no captures fired)
 * and via the workspace toggle command's UI message. This module
 * stays host-side I/O only — it does NOT log to the VS Code channel.
 */
export async function dumpExtensionSideBcbObservationUnavailableCapture(
	context: BcbObservationUnavailableCaptureContext,
): Promise<string> {
	const records = getBcbObservationUnavailableCaptureRecords()
	const dir = context.globalStorageUri.fsPath
	await ensureDirectory(dir)
	const file = join(dir, DUMP_FILE)
	const jsonl = records.map((record) => JSON.stringify(record)).join("\n")
	await writeFile(file, jsonl, "utf8")
	return file
}
