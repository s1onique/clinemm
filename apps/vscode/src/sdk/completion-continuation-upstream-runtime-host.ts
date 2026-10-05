/**
 * ACT-CLINEMM-COMPLETION-CONTINUATION-DELIVERY-SEAM01-CORRECTION03-LIVE-UPSTREAM-CALLBACK-DISCRIMINATOR
 *
 * Extension-host dump adapter for the LIVE upstream discriminator.
 * Mirrors the Elm SHADOW / ELM authority / CCARD / CCDO dump convention:
 * unconditional (operator can always inspect whatever the runtime
 * captured), dump != clear (no counter mutation).
 *
 * The runtime module is `vscode`-free; this adapter wires the
 * counter snapshot it exposes (`getCompletionContinuationUpstreamCounters`)
 * to a JSON file under `context.globalStorageUri` and is the
 * host-side endpoint the Command Palette registration calls.
 *
 * The runtime does NOT need a toggle / enable command — it is
 * always collecting so the dump can report a fresh process.
 *
 * NOTE: this is a DIAGNOSTIC seam. It does NOT mutate state, does
 * NOT change the coordinator's evaluation order, and does NOT
 * introduce any new protocol surface. It serializes ONLY the
 * existing `CompletionContinuationUpstreamCountersSnapshot` shape
 * produced by `getCompletionContinuationUpstreamCounters()`.
 *
 * REMOVAL_TRIGGER: first of
 *   (a) root cause isolated (the LIVE discriminator converges on a
 *       concrete U<n> halt from the LIVE CLASSIFICATION TABLE),
 *   (b) capture insufficient (the counter shape cannot reach one of
 *       U0..U11 — design the successor counter),
 *   (c) successor evidence supersedes it.
 *
 *   Once the trigger fires this adapter + the registry entry + the
 *   package.json declaration + the extension.ts handler MUST be
 *   removed TOGETHER.
 */

import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import {
	type CompletionContinuationUpstreamCountersSnapshot,
	getCompletionContinuationUpstreamCounters,
} from "./completion-continuation-upstream-runtime"

const DUMP_FILE_COUNTERS = "completion-continuation-upstream.counters.json"

/**
 * Narrow structural context type. Mirrors the SHADOW / BJLA /
 * BOCOR / CCARD / CCDO context shape so production and test
 * code pass a wider `vscode.ExtensionContext` that satisfies this
 * shape via structural compatibility — this module does NOT import
 * vscode for type information.
 */
export interface CompletionContinuationUpstreamDumpContext {
	readonly globalStorageUri: { readonly fsPath: string }
}

async function ensureDirectory(pathname: string): Promise<void> {
	await mkdir(pathname, { recursive: true })
}

/**
 * Dump the LIVE upstream-discriminator counter snapshot to a JSON
 * file under the global storage directory. Returns the absolute
 * path on success.
 *
 * UNCONDITIONAL (operator can always inspect whatever the runtime
 * captured, even after the diagnostic was subsequently disabled).
 * dump != clear (no counter mutation). Mirrors the SHADOW / ELM
 * authority / CCARD / CCDO dump convention.
 *
 * The snapshot is always written (never empty) so the operator can
 * distinguish "runtime never observed a notification" (all-zero
 * counters) from "dump never ran" (missing file).
 */
export async function dumpExtensionSideCompletionContinuationUpstreamCounters(
	context: CompletionContinuationUpstreamDumpContext,
): Promise<{ countersFile: string; counters: CompletionContinuationUpstreamCountersSnapshot }> {
	const counters = getCompletionContinuationUpstreamCounters()
	const dir = context.globalStorageUri.fsPath
	await ensureDirectory(dir)
	const countersFile = join(dir, DUMP_FILE_COUNTERS)
	await writeFile(countersFile, `${JSON.stringify(counters, null, 2)}\n`, "utf8")
	return { countersFile, counters }
}
