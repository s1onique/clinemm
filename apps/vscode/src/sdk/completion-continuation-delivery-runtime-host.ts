/**
 * ACT-CLINEMM-COMPLETION-CONTINUATION-DELIVERY-SEAM01-CORRECTION01-LIVE-CALLBACK-OUTCOME
 *
 * Extension-host dump adapter for the LIVE callback-outcome counter.
 * Mirrors the Elm SHADOW / ELM authority / CCARD dump convention:
 * unconditional (operator can always inspect whatever the runtime
 * captured), dump != clear (no counter mutation).
 *
 * The runtime module is `vscode`-free; this adapter wires the
 * counter snapshot it exposes (`getCompletionContinuationDeliveryCounters`)
 * to a JSON file under `context.globalStorageUri` and is the
 * host-side endpoint the Command Palette registration calls.
 *
 * The runtime does NOT need a toggle / enable command — it is
 * always collecting so the dump can report a fresh process. There
 * is no toggle command — the diagnostic enablement is owned by the
 * presence of the production callback (see
 * `apps/vscode/src/sdk/SdkController.ts` constructor wire).
 *
 * NOTE: this is a DIAGNOSTIC seam. It does NOT mutate state, does
 * NOT change the callback decision, and does NOT introduce any new
 * protocol surface. It serializes ONLY the existing
 * `CompletionContinuationDeliveryCountersSnapshot` shape produced
 * by `getCompletionContinuationDeliveryCounters()`.
 *
 * REMOVAL_TRIGGER: first of
 *   (a) root cause isolated (the LIVE discriminator converges on a
 *       concrete production divergence that this dump discriminates),
 *   (b) capture insufficient (the counter shape cannot reach one of
 *       the CASE A..H branches — design the successor counter),
 *   (c) successor evidence supersedes it.
 *
 *   Once the trigger fires this adapter + the registry entry + the
 *   package.json declaration + the extension.ts handler MUST be
 *   removed TOGETHER.
 */

import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import {
	type CompletionContinuationDeliveryCountersSnapshot,
	getCompletionContinuationDeliveryCounters,
} from "./completion-continuation-delivery-runtime"

const DUMP_FILE_COUNTERS = "completion-continuation-delivery.counters.json"

/**
 * Narrow structural context type. Mirrors the SHADOW / BJLA /
 * BOCOR / CCARD / ELM-AUTHORITY context shape so production and test
 * code pass a wider `vscode.ExtensionContext` that satisfies this
 * shape via structural compatibility — this module does NOT import
 * vscode for type information.
 */
export interface CompletionContinuationDeliveryDumpContext {
	readonly globalStorageUri: { readonly fsPath: string }
}

async function ensureDirectory(pathname: string): Promise<void> {
	await mkdir(pathname, { recursive: true })
}

/**
 * Dump the LIVE callback-outcome counter snapshot to a JSON file
 * under the global storage directory. Returns the absolute path on
 * success.
 *
 * UNCONDITIONAL (operator can always inspect whatever the runtime
 * captured, even after the diagnostic was subsequently disabled).
 * dump != clear (no counter mutation). Mirrors the SHADOW / ELM
 * authority / CCARD dump convention.
 *
 * The snapshot is always written (never empty) so the operator can
 * distinguish "runtime never observed a callback" (all-zero
 * counters) from "dump never ran" (missing file).
 */
export async function dumpExtensionSideCompletionContinuationDeliveryCounters(
	context: CompletionContinuationDeliveryDumpContext,
): Promise<{ countersFile: string; counters: CompletionContinuationDeliveryCountersSnapshot }> {
	const counters = getCompletionContinuationDeliveryCounters()
	const dir = context.globalStorageUri.fsPath
	await ensureDirectory(dir)
	const countersFile = join(dir, DUMP_FILE_COUNTERS)
	await writeFile(countersFile, `${JSON.stringify(counters, null, 2)}\n`, "utf8")
	return { countersFile, counters }
}
