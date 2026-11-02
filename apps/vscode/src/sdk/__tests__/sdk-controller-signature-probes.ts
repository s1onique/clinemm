/**
 * ACT-CLINEMM-FORK-UPSTREAM-MERGE01 — shared structural-probe helpers.
 *
 * The upstream merge added OPTIONAL PARAMETERS to two SdkController methods:
 *
 *   - `getStateToPostToWebview(snapshotAttempt = 0): Promise<ExtensionState>`
 *   - `resetMessageTranslatorAndFence(requestedPhase: TurnPhase = "idle"): void`
 *
 * The fork-owned structural-probe tests matched those declarations with a
 * LITERAL string (e.g. `"async getStateToPostToWebview(): Promise<ExtensionState>"`).
 * A literal match is brittle: any additive signature change upstream breaks
 * the probe even though the behaviour the probe cares about is unchanged.
 *
 * These helpers locate the declaration by REGEX instead. They still assert
 * what the probes actually care about:
 *
 *   1. the method EXISTS on SdkController, and
 *   2. it has the EXPECTED RETURN TYPE.
 *
 * They deliberately do NOT weaken the probe into a bare `indexOf(name) > -1`
 * name check — the return type is the load-bearing part of the witness, and
 * the method body is still sliced from the real declaration offset so the
 * body-level regex assertions continue to work.
 */
import { readFileSync } from "node:fs"

/** Absolute path of the SdkController source under test. */
export const SDK_CONTROLLER_PATH = new URL("../SdkController.ts", import.meta.url).pathname

/** Read a source file as UTF-8 text. */
export function readSource(path: string): string {
	return readFileSync(path, "utf8")
}

/**
 * The exact `getStateToPostToWebview` declaration text, or `""` when the
 * method is absent or has an unexpected return type.
 */
export function getStateToPostToWebviewSignature(source: string = readSource(SDK_CONTROLLER_PATH)): string {
	return /async\s+getStateToPostToWebview\s*\([^)]*\)\s*:\s*Promise<ExtensionState>/.exec(source)?.[0] ?? ""
}

/**
 * The exact `resetMessageTranslatorAndFence` declaration text, or `""` when
 * the method is absent or has an unexpected return type.
 */
export function resetMessageTranslatorAndFenceSignature(source: string = readSource(SDK_CONTROLLER_PATH)): string {
	return /resetMessageTranslatorAndFence\s*\([^)]*\)\s*:\s*void/.exec(source)?.[0] ?? ""
}
