/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01-C1-CORRECTION01
 *
 * Extension-host runtime for the post-terminal-authority diagnostic. Owns
 * the live-enable toggle, the live-extraction dump, and the wire-flag
 * stamping. This is the ONLY extension-side module that touches
 * `context.workspaceState` for the diagnostic — every other site reads
 * `isPostTerminalAuthorityDiagnosticEnabled()` and respects its answer.
 *
 * Trust binding:
 *   - Default off: `context.workspaceState.get("ptadEnabled")` is
 *     `undefined` for any installation that has never toggled the command,
 *     so the diagnostic stays a complete no-op.
 *   - One user action: `cline.debug.togglePostTerminalAuthorityDiagnostic`
 *     flips the flag, stamps `_ptadEnabled` on every subsequent state push,
 *     and the webview's first state push picks it up.
 *   - One dump action: `cline.debug.dumpPostTerminalAuthorityDiagnostic`
 *     serializes the extension-side ring buffer to
 *     `~/.cline/data/post-terminal-authority-diagnostic-extension.jsonl`,
 *     posts a `clinemm.dumpPostTerminalAuthorityDiagnostic` message to the
 *     webview asking it to flush, and the webview appends its records
 *     to `~/.cline/data/post-terminal-authority-diagnostic-webview.jsonl`
 *     via the `clinemm.appendPostTerminalAuthorityDiagnostic` postMessage
 *     type. Both file paths are returned in a HostProvider notification.
 *
 * The runtime module is intentionally separated from the diagnostic
 * module so the diagnostic stays webview-bundle-safe.
 */

import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import {
	disablePostTerminalAuthorityDiagnostic,
	enablePostTerminalAuthorityDiagnostic,
	getPostTerminalAuthorityDiagnosticRecords,
	type PostTerminalAuthoritySnapshot,
} from "@shared/post-terminal-authority-diagnostic"

/**
 * The single workspace-state key the diagnostic owns. Lives under the
 * workspace (not global) so each workspace's toggles are independent.
 */
const WORKSPACE_STATE_KEY = "ptadEnabled"

const DUMP_FILE_EXTENSION = "post-terminal-authority-diagnostic-extension.jsonl"
const DUMP_FILE_WEBVIEW = "post-terminal-authority-diagnostic-webview.jsonl"

/**
 * Narrow structural type for the bits of vscode.ExtensionContext the
 * diagnostic touches. Defined locally so the runtime module does not
 * import `vscode` for type information. Both production and test code
 * pass a wider context that satisfies this shape via structural
 * compatibility.
 */
export interface PostTerminalAuthorityDiagnosticContext {
	readonly workspaceState: {
		get<T>(key: string): T | undefined
		update(key: string, value: unknown): Thenable<void> | Promise<void>
	}
	readonly globalStorageUri: { readonly fsPath: string }
	readonly subscriptions: { dispose(): void }[]
}

/**
 * Returns `true` iff the user has explicitly enabled the diagnostic for
 * this workspace. The default (`undefined` workspace state) is `false`.
 */
export function isPostTerminalAuthorityDiagnosticWorkspaceEnabled(context: PostTerminalAuthorityDiagnosticContext): boolean {
	const value = context.workspaceState.get<boolean>(WORKSPACE_STATE_KEY)
	return value === true
}

/**
 * Flip the workspace-state flag. Returns the new value. Does NOT enable
 * the ring buffer directly; the SdkController reads this flag on every
 * `getStateToPostToWebview` invocation and enables / disables accordingly.
 */
export async function togglePostTerminalAuthorityDiagnosticWorkspaceEnabled(
	context: PostTerminalAuthorityDiagnosticContext,
): Promise<boolean> {
	const next = !isPostTerminalAuthorityDiagnosticWorkspaceEnabled(context)
	await context.workspaceState.update(WORKSPACE_STATE_KEY, next)
	if (next) {
		enablePostTerminalAuthorityDiagnostic("extension")
	} else {
		disablePostTerminalAuthorityDiagnostic("extension")
	}
	return next
}

/**
 * Dump the extension-side ring buffer to a JSONL file under the global
 * storage directory. Returns the absolute path on success.
 */
export async function dumpExtensionSidePostTerminalAuthorityDiagnostic(
	context: PostTerminalAuthorityDiagnosticContext,
): Promise<string> {
	const records = getPostTerminalAuthorityDiagnosticRecords("extension")
	const file = join(context.globalStorageUri.fsPath, DUMP_FILE_EXTENSION)
	const jsonl = records.map((record) => JSON.stringify(record)).join("\n")
	await writeFile(file, jsonl, "utf8")
	return file
}

/**
 * Append a batch of webview-side records to the webview dump file.
 * Called by the postMessage handler that the webview posts records to.
 */
export async function appendWebviewSidePostTerminalAuthorityDiagnostic(
	context: PostTerminalAuthorityDiagnosticContext,
	records: readonly PostTerminalAuthoritySnapshot[],
): Promise<string> {
	const file = join(context.globalStorageUri.fsPath, DUMP_FILE_WEBVIEW)
	const jsonl = records.map((record) => JSON.stringify(record)).join("\n")
	if (jsonl.length > 0) {
		await writeFile(file, jsonl, "utf8")
	}
	return file
}
