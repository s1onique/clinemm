/**
 * ACT-CLINEMM-TURNSTATE-WRITER-PROVENANCE-COMMAND-SURFACE01
 *
 * Extension-host runtime for the legacy TurnState writer-provenance
 * diagnostic. Owns the live-enable toggle and the live-extraction dump
 * for the bounded ring exposed by
 * `@shared/turn-state-writer-provenance`. This module is the ONLY
 * extension-side module that touches `context.workspaceState` for
 * the writer-provenance diagnostic — every other site reads
 * `isTurnStateWriterProvenanceDiagnosticEnabled()` and respects its
 * answer.
 *
 * Trust binding (mirrors post-terminal-authority-diagnostic-runtime.ts):
 *   - Default off: `context.workspaceState.get("tswpdEnabled")` is
 *     `undefined` for any installation that has never toggled the
 *     command, so the diagnostic stays a complete no-op.
 *   - One user action: `cline.debug.toggleTurnStateWriterProvenanceDiagnostic`
 *     flips the workspace-state flag.
 *   - One dump action: `cline.debug.dumpTurnStateWriterProvenanceDiagnostic`
 *     serializes the ring to `<context.globalStorageUri.fsPath>/turn-state-writer-provenance.jsonl`.
 *     The actual on-disk location is whatever VS Code hands us via
 *     `globalStorageUri` (e.g. `~/.vscode/extensions/<publisher>.<name>/globalStorage`
 *     on a default Linux install, or `~/.config/Code/User/globalStorage/...`
 *     depending on the user's setup); the code contract is the
 *     `globalStorageUri`-derived directory, NOT a hard-coded
 *     `~/.cline/data/...` path.
 *   - No duplication: the diagnostic ring, enable/disable seam, and
 *     writers live in `@shared/turn-state-writer-provenance`. This
 *     module is the host-side adapter that satisfies the Command
 *     Palette contract.
 *
 * No webview counterpart: the writer-provenance diagnostic is a
 * pure host-side concern (the tracked object is the SdkController's
 * legacy TurnStateTracker, which never reaches the webview). The
 * dump is therefore a single-file write — no postMessage handshake.
 */

import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import {
	disableTurnStateWriterProvenanceDiagnostic,
	enableTurnStateWriterProvenanceDiagnostic,
	getTurnStateWriterProvenanceRecords,
} from "@shared/turn-state-writer-provenance"

/**
 * The single workspace-state key the diagnostic owns. Lives under the
 * workspace (not global) so each workspace's toggles are independent.
 */
const WORKSPACE_STATE_KEY = "tswpdEnabled"

const DUMP_FILE = "turn-state-writer-provenance.jsonl"

/**
 * Narrow structural type for the bits of vscode.ExtensionContext the
 * diagnostic touches. Mirrors PostTerminalAuthorityDiagnosticContext
 * structurally so production and test code pass a wider context that
 * satisfies this shape via structural compatibility — this module
 * does NOT import `vscode` for type information.
 */
export interface TurnStateWriterProvenanceDiagnosticContext {
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
export function isTurnStateWriterProvenanceDiagnosticWorkspaceEnabled(
	context: TurnStateWriterProvenanceDiagnosticContext,
): boolean {
	const value = context.workspaceState.get<boolean>(WORKSPACE_STATE_KEY)
	return value === true
}

/**
 * Flip the workspace-state flag. Returns the new value. Side-effects:
 *   - writes the workspace-state key (`tswpdEnabled` ← next)
 *   - when flipping ON: calls the shared `enable...()` so the next
 *     mutation actually records
 *   - when flipping OFF: calls the shared `disable...()` so future
 *     mutations are no-ops (preserves any existing records)
 *
 * The toggle does NOT clear the existing ring on disable; records
 * captured before the toggle remain queryable and dumpable. This
 * matches the post-terminal-authority toggle's behavior.
 */
export async function toggleTurnStateWriterProvenanceDiagnosticWorkspaceEnabled(
	context: TurnStateWriterProvenanceDiagnosticContext,
): Promise<boolean> {
	const next = !isTurnStateWriterProvenanceDiagnosticWorkspaceEnabled(context)
	await context.workspaceState.update(WORKSPACE_STATE_KEY, next)
	if (next) {
		enableTurnStateWriterProvenanceDiagnostic()
	} else {
		disableTurnStateWriterProvenanceDiagnostic()
	}
	return next
}

/**
 * Ensure the global storage directory exists before writing. The
 * PTAD runtime uses the same pattern; mirroring it here keeps the
 * two debug paths robust on a fresh install where the directory
 * hasn't been created yet.
 */
async function ensureDirectory(pathname: string): Promise<void> {
	await mkdir(pathname, { recursive: true })
}

/**
 * Dump the bounded writer-provenance ring to a JSONL file under the
 * global storage directory. Returns the absolute path on success.
 *
 * The dump is intentionally unconditional: the operator must be
 * able to inspect any captured records even if the diagnostic was
 * subsequently disabled. The shared module's `getRecords()` is the
 * single source of truth; this function never touches the ring
 * directly.
 */
export async function dumpExtensionSideTurnStateWriterProvenanceDiagnostic(
	context: TurnStateWriterProvenanceDiagnosticContext,
): Promise<string> {
	const records = getTurnStateWriterProvenanceRecords()
	const dir = context.globalStorageUri.fsPath
	await ensureDirectory(dir)
	const file = join(dir, DUMP_FILE)
	const jsonl = records.map((record) => JSON.stringify(record)).join("\n")
	await writeFile(file, jsonl, "utf8")
	return file
}
