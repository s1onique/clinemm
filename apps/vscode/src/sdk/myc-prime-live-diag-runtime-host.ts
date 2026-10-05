/**
 * ACT-MYC-CLINEMM-PRIME-LIVE-DIAG-DUMP-COMMAND-SURFACE01
 *
 * Extension-host dump adapter for the MYC prime live diagnostic
 * singleton. Mirrors the CCARD / CCDO / CCDSO / CCNTUP / EHLOOP /
 * ELM-SHADOW / ELM-AUTHORITY / Lifecycle-Clear dump convention:
 *
 *   - UNCONDITIONAL (operator can always inspect whatever the
 *     recorder captured, even after the diagnostic was subsequently
 *     disabled).
 *   - dump != clear (no snapshot mutation).
 *
 * The recorder module is `vscode`-free; this adapter wires the
 * snapshot it exposes (`getMycPrimeLiveDiag(sessionId)`) to a JSON
 * file under `context.globalStorageUri` and is the host-side
 * endpoint the Command Palette registration calls.
 *
 * The recorder gates internally via `isMycPrimeLiveDiagEnabled()`
 * (set by `applyMycPrimeLiveDiagDiagnosticProfile` from the central
 * dogfood profile resolver at extension activation). When disabled,
 * `getMycPrimeLiveDiag()` returns `undefined`, so the dump serializes
 * a `sessionIdPresent: true` + `snapshotPresent: false` row. The
 * operator can therefore distinguish "diagnostic OFF + nothing
 * captured" from "dump never ran" (missing file).
 *
 * The sessionId is RESOLVED BY THE CALLER (the Command Palette
 * handler in extension.ts). This module does NOT import vscode and
 * does NOT reach into any controller. Manually typing the session id
 * into the palette command would weaken the exact identity proof
 * MYC03 needs: the dump MUST bind to the currently active ClineMM
 * session so the operator can join "the task I just ran" with the
 * diagnostic snapshot.
 *
 * NOTE: this is a DIAGNOSTIC seam. It does NOT mutate state, does
 * NOT change prime injection semantics, and does NOT introduce any
 * new protocol surface. It serializes ONLY the existing
 * `MycPrimeLiveDiagnostic | undefined` shape produced by
 * `getMycPrimeLiveDiag(sessionId)` (wrapped in a small
 * `{ sessionIdPresent, snapshotPresent, snapshot }` envelope so the
 * operator can tell "snapshot never started" from "snapshot started
 * but every field is the unobserved default").
 *
 * REMOVAL_TRIGGER: first successful LIVE binding of MYC03 (the
 * production hook bag carries the prime end-to-end at the host
 * session identity), OR CAPTURE_INSUFFICIENT (the snapshot shape
 * cannot reach any of the four bounded sections — design the
 * successor), OR successor evidence supersedes it. On removal, this
 * adapter + the registry entry + the package.json declaration + the
 * extension.ts handler MUST be removed TOGETHER.
 */

import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { getMycPrimeLiveDiag, type MycPrimeLiveDiagnostic } from "./myc-prime-live-diag"

const DUMP_FILE_COUNTERS = "myc-prime-live.counters.json"

/**
 * Narrow structural context type. Mirrors the CCARD / CCDO / CCDSO /
 * CCNTUP / EHLOOP / ELM-SHADOW / ELM-AUTHORITY / Lifecycle-Clear
 * context shape so production and test code pass a wider
 * `vscode.ExtensionContext` that satisfies this shape via structural
 * compatibility — this module does NOT import vscode for type
 * information.
 */
export interface MycPrimeLiveDiagDumpContext {
	readonly globalStorageUri: { readonly fsPath: string }
}

async function ensureDirectory(pathname: string): Promise<void> {
	await mkdir(pathname, { recursive: true })
}

/**
 * Public envelope wrapping the existing snapshot. Carrying
 * `sessionIdPresent` / `snapshotPresent` booleans lets the operator
 * (and the wiring test) tell the three diagnostic states apart on a
 * single dump:
 *
 *   sessionIdPresent=false / snapshotPresent=false
 *     → caller resolved against no active ClineMM session.
 *
 *   sessionIdPresent=true  / snapshotPresent=false
 *     → diagnostic OFF (or no recorder fired yet for that session).
 *
 *   sessionIdPresent=true  / snapshotPresent=true
 *     → the snapshot at the four MYC prime stages (bind / enter /
 *       acquisition / lookup / injection / capture) is on disk; the
 *       four sections (acquisition / lookup / injection / capture)
 *       and the four optional fields (bind / enter) drive the
 *       MYC03 §17 boundary classifier.
 *
 * The shape is FROZEN: no prime text, no witness text, no prompts,
 * no payload, no paths, no MCP server names. Only the bounded
 * numeric / boolean / status fields the recorder already carries.
 */
export interface MycPrimeLiveDiagDumpResult {
	sessionIdPresent: boolean
	snapshotPresent: boolean
	snapshot?: MycPrimeLiveDiagnostic
}

async function writeDumpFile(dir: string, envelope: MycPrimeLiveDiagDumpResult): Promise<string> {
	await ensureDirectory(dir)
	const countersFile = join(dir, DUMP_FILE_COUNTERS)
	await writeFile(countersFile, `${JSON.stringify(envelope, null, 2)}\n`, "utf8")
	return countersFile
}

/**
 * Dump the MYC prime live diagnostic snapshot for the given sessionId
 * to a JSON file under the global storage directory. Returns the
 * absolute path on success.
 *
 * UNCONDITIONAL (operator can always inspect whatever the recorder
 * captured, even after the diagnostic was subsequently disabled).
 * dump != clear (no snapshot mutation). Mirrors the CCARD / CCDO /
 * CCDSO / CCNTUP / EHLOOP / ELM-SHADOW / ELM-AUTHORITY /
 * Lifecycle-Clear dump convention.
 *
 * When the caller passes a falsy sessionId (no active ClineMM
 * session at the moment of the dump), the result carries
 * `sessionIdPresent: false` and an absent `snapshot`. The file is
 * still written so the operator can distinguish "operator dumped
 * with no active task" from "dump never ran".
 *
 * The four-section shape (acquisition / lookup / injection / capture)
 * and the optional bind / enter fields are the existing diagnostic
 * projection — this function does NOT invent a new schema.
 */
export async function dumpExtensionSideMycPrimeLiveDiag(
	context: MycPrimeLiveDiagDumpContext,
	sessionId: string | undefined,
): Promise<{ countersFile: string; result: MycPrimeLiveDiagDumpResult }> {
	const dir = context.globalStorageUri.fsPath
	if (!sessionId) {
		const result: MycPrimeLiveDiagDumpResult = { sessionIdPresent: false, snapshotPresent: false }
		const countersFile = await writeDumpFile(dir, result)
		return { countersFile, result }
	}
	const snapshot = getMycPrimeLiveDiag(sessionId)
	const result: MycPrimeLiveDiagDumpResult = {
		sessionIdPresent: true,
		snapshotPresent: snapshot !== undefined,
		snapshot,
	}
	const countersFile = await writeDumpFile(dir, result)
	return { countersFile, result }
}
