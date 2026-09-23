/**
 * ACT-CLINEMM-EXTENSION-HOST-SESSION-EVENT-HOTLOOP01
 *
 * Extension-host runtime for the EHLOOP01 hot-loop counter
 * diagnostic. Owns the host-side dump adapter that the operator
 * invokes via the Cline Debug: Dump Extension Host Hotloop Command
 * Palette command.
 *
 * Pattern (mirrors the TSWPD / THSICAP / W carrier / BOCOR / BJLA
 * / CCARD dump commands):
 *
 *   - The bounded counters live in
 *     ./extension-host-hotloop-diagnostic.ts (no vscode import, no
 *     ExtensionContext).
 *   - This module adds ONLY the host-side dump adapter so the
 *     production Command Palette command can serialize the counter
 *     snapshot to a JSON file under context.globalStorageUri.
 *   - The dump is UNCONDITIONAL (the operator must be able to
 *     inspect any captured counters even after the diagnostic is
 *     disabled).
 *   - The dump does NOT reset the counters (dump != clear contract).
 *
 * No toggle command. No enable command. The diagnostic enablement is
 * driven exclusively by the central dogfood profile resolver (see
 * ./dogfood-diagnostic-profile.ts -
 * applyExtensionHostHotloopDiagnosticProfile). A workspace
 * toggle would violate the "dogfood-only, no operator knob" contract
 * from ACT §8.
 *
 * REMOVAL_TRIGGER (per ACT §34): once the host-stability repair is
 * GREEN on LIVE qualification, OR CAPTURE_INSUFFICIENT is declared,
 * this module + the underlying counter module + the activation
 * helper + the Command Palette registration + the registry entry +
 * the package.json command declaration MUST be removed TOGETHER.
 */

import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { getExtensionHostHotloopDiagnosticSnapshot } from "./extension-host-hotloop-diagnostic"

const DUMP_FILE = "extension-host-hotloop-diagnostic.json"

/**
 * Narrow structural type for the bits of vscode.ExtensionContext the
 * diagnostic touches. Mirrors the THSICAP / TSWPD / W carrier / BOCOR
 * / BJLA / CCARD runtime context shape structurally so production and
 * test code pass a wider context that satisfies this shape via
 * structural compatibility - this module does NOT import vscode for
 * type information.
 */
export interface ExtensionHostHotloopDiagnosticContext {
	readonly globalStorageUri: { readonly fsPath: string }
}

async function ensureDirectory(pathname: string): Promise<void> {
	await mkdir(pathname, { recursive: true })
}

/**
 * Dump the bounded EHLOOP01 counter snapshot to a JSON file under the
 * global storage directory. Returns the absolute path on success.
 *
 * UNCONDITIONAL (the operator must be able to inspect any captured
 * counters even after the diagnostic was subsequently disabled). The
 * shared module's getExtensionHostHotloopDiagnosticSnapshot() is the
 * single source of truth; this function never touches the counters
 * directly.
 *
 * dump != clear: the counters are preserved across dumps. An accidental
 * first dump does not destroy evidence.
 */
export async function dumpExtensionSideExtensionHostHotloopDiagnostic(context: ExtensionHostHotloopDiagnosticContext): Promise<{
	file: string
}> {
	const counters = getExtensionHostHotloopDiagnosticSnapshot()
	const dir = context.globalStorageUri.fsPath
	await ensureDirectory(dir)
	const file = join(dir, DUMP_FILE)
	const payload = {
		dumpedAt: new Date().toISOString(),
		counters,
	}
	await writeFile(file, JSON.stringify(payload, null, 2), "utf8")
	return { file }
}
