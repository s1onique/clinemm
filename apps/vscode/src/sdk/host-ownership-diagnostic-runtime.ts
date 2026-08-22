/**
 * ACT-CLINEMM-TASK-INTERACTION-OWNERSHIP-PROJECTION01-LIVE-CAPTURE01-CORRECTION01
 *
 * Extension-host runtime for the host-ownership diagnostic. Mirrors the
 * bounded command pattern already used by TSWPD
 * (`apps/vscode/src/sdk/turn-state-writer-provenance-runtime.ts`) and
 * PTAD:
 *
 *   - `cline.debug.toggleHostOwnershipDiagnostic`
 *       workspace-scoped, default OFF, flips the workspace-state flag
 *       and enables / disables the ring.
 *   - `cline.debug.dumpHostOwnershipDiagnostic`
 *       serializes the bounded ring to
 *       `<context.globalStorageUri.fsPath>/host-ownership-diagnostic.jsonl`
 *       and shows the operator the absolute path.
 *
 * Pure host-side diagnostic -- no webview counterpart. The synchronized
 * capture runs inside `SdkController.getStateToPostToWebview()` so the
 * JSONL records are stamped with `stateVersion` + `_ptadPushId` + the
 * six raw host facts + the DIAGNOSTIC_DERIVATION_ONLY `candidateAwaitingFollowup`
 * (HYPOTHESIS_ONLY formula).
 *
 * Trust binding:
 *   - Default off: `context.workspaceState.get("hostOwnershipDiagnosticEnabled")`
 *     is `undefined` for any installation that has never toggled the
 *     command, so the diagnostic stays a complete no-op.
 *   - Removal trigger (Factory C1: GO EVIDENCE §12): first of (root
 *     cause classified, capture insufficient, successor evidence
 *     supersedes this diagnostic). Removal sequence is documented in
 *     the evidence doc.
 */

import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import {
	disableHostOwnershipDiagnostic,
	enableHostOwnershipDiagnostic,
	getHostOwnershipDiagnostic,
} from "@shared/host-ownership-diagnostic"

const WORKSPACE_STATE_KEY = "hostOwnershipDiagnosticEnabled"

const DUMP_FILE = "host-ownership-diagnostic.jsonl"

/**
 * Narrow structural type for the bits of vscode.ExtensionContext the
 * diagnostic touches. Mirrors the TSWPD context shape so production
 * and test code pass a wider context that satisfies this shape via
 * structural compatibility -- this module does NOT import `vscode`
 * for type information.
 */
export interface HostOwnershipDiagnosticContext {
	readonly workspaceState: {
		get<T>(key: string): T | undefined
		update(key: string, value: unknown): Thenable<void> | Promise<void>
	}
	readonly globalStorageUri: { readonly fsPath: string }
	readonly subscriptions: { dispose(): void }[]
}

/**
 * Returns `true` iff the user has explicitly enabled the diagnostic
 * for this workspace. Default (`undefined` workspace state) is `false`.
 * Reading this value does NOT itself enable the ring -- the SdkController
 * reads this flag on every `getStateToPostToWebview` invocation and
 * enables / disables accordingly.
 */
export function isHostOwnershipDiagnosticWorkspaceEnabled(
	context: HostOwnershipDiagnosticContext,
): boolean {
	const value = context.workspaceState.get<boolean>(WORKSPACE_STATE_KEY)
	return value === true
}

/**
 * Flip the workspace-state flag. Returns the new value. Also enables
 * or disables the ring buffer directly so the next capture call sees
 * the new state without waiting for the SdkController's state-post
 * sync.
 */
export async function toggleHostOwnershipDiagnosticWorkspaceEnabled(
	context: HostOwnershipDiagnosticContext,
): Promise<boolean> {
	const next = !isHostOwnershipDiagnosticWorkspaceEnabled(context)
	await context.workspaceState.update(WORKSPACE_STATE_KEY, next)
	if (next) {
		enableHostOwnershipDiagnostic()
	} else {
		disableHostOwnershipDiagnostic()
	}
	return next
}

/**
 * Mirrors the PTAD / TSWPD mkdir-recursive pattern. Ensures the
 * `globalStorageUri` directory exists before writing so a fresh install
 * cannot ENOENT.
 */
async function ensureDirectory(pathname: string): Promise<void> {
	await mkdir(pathname, { recursive: true })
}

/**
 * Dump the host-ownership ring to a JSONL file under the global
 * storage directory. Returns the absolute path on success. The dump
 * is allowed even when the diagnostic is disabled so an operator can
 * inspect an existing ring (matches the PTAD contract).
 */
export async function dumpExtensionSideHostOwnershipDiagnostic(
	context: HostOwnershipDiagnosticContext,
): Promise<string> {
	const records = getHostOwnershipDiagnostic()
	const dir = context.globalStorageUri.fsPath
	await ensureDirectory(dir)
	const file = join(dir, DUMP_FILE)
	const jsonl = records.map((record) => JSON.stringify(record)).join("\n")
	await writeFile(file, jsonl, "utf8")
	return file
}
