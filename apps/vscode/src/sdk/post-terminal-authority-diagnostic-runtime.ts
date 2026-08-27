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

import { mkdir, writeFile } from "node:fs/promises"
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
 * ACT-CLINEMM-PTAD-ENV-OPTIN01:
 *
 * Environment variable that ORs with the persisted workspace toggle so the
 * diagnostic can be armed from extension startup without needing the user to
 * remember to invoke the `cline.debug.togglePostTerminalAuthorityDiagnostic`
 * command before a rare specimen appears.
 *
 * Semantics (additive, default OFF, no forced-disable):
 *
 *   "1" | "true"  -> enables the diagnostic
 *   "0" | "false" -> does NOT forcibly disable a persisted toggle
 *                    (the existing command-toggle stays the user preference)
 *   unset / ""    -> no env contribution; the persisted toggle decides
 *   garbage       -> treated as not-enabled (env source is ignored)
 *
 * `0`/`false` deliberately do NOT override a `true` persisted toggle. The
 * env var is a developer/Factory opt-in, not a second precedence system.
 */
const CLINEMM_PTAD_ENV = "CLINEMM_PTAD"

/**
 * Pure env-var parser. Returns `true` iff the env var is set to `"1"` or
 * `"true"` (case-insensitive). Anything else (unset, empty, `"0"`, `"false"`,
 * `"off"`, garbage) returns `false`.
 *
 * Centralized so capture / sync / dump sites can compose this with the
 * persisted-toggle predicate without sprinkling `process.env` reads.
 */
export function parseClinemmPtadEnv(env: NodeJS.ProcessEnv = process.env): boolean {
	const raw = env[CLINEMM_PTAD_ENV]
	if (raw === undefined) {
		return false
	}
	const normalized = raw.trim().toLowerCase()
	return normalized === "1" || normalized === "true"
}

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
 * ACT-CLINEMM-PTAD-ENV-OPTIN01:
 *
 * Merged enable predicate. Returns `true` iff EITHER the persisted
 * workspace toggle is on OR the `CLINEMM_PTAD` env var is truthy. The env
 * contribution is ADDITIVE: a `CLINEMM_PTAD=0` / `=false` does NOT force
 * the result to `false` when the persisted toggle is `true` (the
 * workspace toggle is the user preference and stays authoritative).
 *
 * Composition order (from the user-facing spec):
 *
 *   persistedToggle=false + env unset      -> false  (unchanged from C1)
 *   persistedToggle=true  + env unset      -> true   (unchanged from C1)
 *   persistedToggle=false + env="1"        -> true   (NEW: env opt-in)
 *   persistedToggle=true  + env="0"        -> true   (env does NOT override)
 *   persistedToggle=false + env=garbage    -> false  (env source ignored)
 *
 * Callers should use THIS predicate (not the bare workspace one) so the
 * env opt-in is honored everywhere the diagnostic is asked whether it
 * should be armed.
 */
export function isPostTerminalAuthorityDiagnosticEffectivelyEnabled(
	context: PostTerminalAuthorityDiagnosticContext,
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	if (isPostTerminalAuthorityDiagnosticWorkspaceEnabled(context)) {
		return true
	}
	return parseClinemmPtadEnv(env)
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
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-REAL-DOGFOOD-POST-TERMINAL-AUTHORITY-SPLIT-TRIAGE01-C1-CORRECTION02:
 * VS Code's API documents that `globalStorageUri` is the URI of the
 * directory "in which the extension can store global state" and that
 * "the directory might not exist on disk and creation is up to the
 * extension". We ensure the directory exists before writing so the
 * C2 smoke cannot ENOENT on a fresh installation.
 */
async function ensureDirectory(pathname: string): Promise<void> {
	await mkdir(pathname, { recursive: true })
}

/**
 * Dump the extension-side ring buffer to a JSONL file under the global
 * storage directory. Returns the absolute path on success.
 */
export async function dumpExtensionSidePostTerminalAuthorityDiagnostic(
	context: PostTerminalAuthorityDiagnosticContext,
): Promise<string> {
	const records = getPostTerminalAuthorityDiagnosticRecords("extension")
	const dir = context.globalStorageUri.fsPath
	await ensureDirectory(dir)
	const file = join(dir, DUMP_FILE_EXTENSION)
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
	const dir = context.globalStorageUri.fsPath
	await ensureDirectory(dir)
	const file = join(dir, DUMP_FILE_WEBVIEW)
	const jsonl = records.map((record) => JSON.stringify(record)).join("\n")
	if (jsonl.length > 0) {
		await writeFile(file, jsonl, "utf8")
	}
	return file
}
