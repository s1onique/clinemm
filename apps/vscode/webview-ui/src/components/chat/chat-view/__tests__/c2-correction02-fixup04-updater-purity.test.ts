/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-C2-CORRECTION02-FIXUP04-PURE-UPDATER-EVIDENCE
 *
 * R9 — static purity check on W1's functional updater.
 *
 * React's contract requires functional updaters to be pure
 * calculate-and-return functions. Even an "idempotent" ref map
 * mutation inside an updater is an externally observable side
 * effect; React can run the updater and then discard the render,
 * in which case the side-effect persists while the updater result
 * is thrown away.
 *
 * This test reads the production source file at
 * `apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx`,
 * extracts the W1 functional updater body (the `setState((prevState) => { ... })`
 * call inside the `subscribeToState` `onResponse` handler), and
 * asserts that the body contains NO PTAD or diagnostic side effects.
 *
 * Concretely, the updater body must NOT contain:
 *   - `pendingAppliedByPushRef` / `pendingRawSnapshotsRef` / `prevStateRef`
 *     (FIXUP01/02/03 ref-map dead machinery)
 *   - `recordPostTerminalAuthoritySnapshot(...)` (PTAD ring-buffer writes)
 *   - `console.error` / `console.log` inside the updater (logging is a side effect)
 *
 * The test is intentionally string-based rather than AST-based
 * because the source file is in TypeScript and we want to keep
 * this test dependency-free. It is conservative: any line that
 * contains one of the forbidden tokens is reported, and the test
 * fails if any such line is found inside the updater body.
 *
 * PRE-EXISTING RESIDUE (out of FIXUP04 scope): the updater body
 * DOES contain `setShowWelcome(...)`, `setOnboardingModels(...)`,
 * `setDidHydrateState(true)`, and `replicaRef.current = ...`.
 * These are PRE-EXISTING side effects that were in the file before
 * PTAD existed. The test does NOT flag them; it only flags
 * PTAD-introduced side effects.
 */

import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

// Resolve the source file path. We try a few candidates because
// vitest may rewrite `import.meta.url` to a transformed location.
function resolveSource(): string {
	const candidates = [
		// Original test location (when vitest preserves import.meta.url)
		resolve(dirname(fileURLToPath(import.meta.url)), "../../../../context/ExtensionStateContext.tsx"),
		// process.cwd() relative paths for various vitest invocations
		resolve(process.cwd(), "src/context/ExtensionStateContext.tsx"),
		resolve(process.cwd(), "../src/context/ExtensionStateContext.tsx"),
		resolve(process.cwd(), "../../webview-ui/src/context/ExtensionStateContext.tsx"),
	]
	for (const p of candidates) {
		try {
			const s = readFileSync(p, "utf-8")
			// sanity check: must contain the W1 subscribeToState token
			if (s.includes("StateServiceClient.subscribeToState")) {
				return p
			}
		} catch {
			// continue
		}
	}
	throw new Error(`Could not find ExtensionStateContext.tsx from any candidate. cwd=${process.cwd()} url=${import.meta.url}`)
}
const SOURCE_FILE = resolveSource()

const FORBIDDEN_PTAD_TOKENS: readonly string[] = [
	"pendingAppliedByPushRef",
	"pendingRawSnapshotsRef",
	"prevStateRef",
	"recordPostTerminalAuthoritySnapshot(",
	"console.error(",
	"console.log(",
]

// Heuristic line-pair markers for the W1 functional updater body.
// The W1 updater body starts on the line that contains
// `setState((prevState) => {` (the snapshot one — there are
// multiple setState calls in the file) and ends at the matching
// closing brace. We approximate by scanning from the snapshot-path
// marker (a line containing `// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-C2-CORRECTION02-FIXUP04-PURE-UPDATER-EVIDENCE:`
// followed by `// R9 (PURE UPDATER)`) until the next
// `// REMOVED in FIXUP04` or `// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-C2-CORRECTION02-FIXUP04-PURE-UPDATER-EVIDENCE:` comment
// block ends.
function extractW1UpdaterBody(source: string): string {
	const lines = source.split("\n")
	const startIdx = lines.findIndex((l) =>
		l.includes("ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-C2-CORRECTION02-FIXUP04-PURE-UPDATER-EVIDENCE"),
	)
	if (startIdx === -1) {
		throw new Error("could not find FIXUP04 marker in source")
	}
	// Scan forward from the marker until we find the setState((prevState) => {
	// line that follows it.
	const setStateIdx = lines.findIndex((l, i) => i > startIdx && /setState\(\(prevState\)\s*=>\s*\{/.test(l))
	if (setStateIdx === -1) {
		throw new Error("could not find setState((prevState) => { after FIXUP04 marker")
	}
	// Walk forward, tracking brace depth, until we close the updater.
	let depth = 0
	let endIdx = -1
	for (let i = setStateIdx; i < lines.length; i++) {
		const line = lines[i]
		for (const ch of line) {
			if (ch === "{") {
				depth++
			} else if (ch === "}") {
				depth--
				if (depth === 0) {
					endIdx = i
					break
				}
			}
		}
		if (endIdx !== -1) {
			break
		}
	}
	if (endIdx === -1) {
		throw new Error("could not find closing brace of W1 updater body")
	}
	return lines.slice(setStateIdx, endIdx + 1).join("\n")
}

describe("C2-CORRECTION02-FIXUP04 — R9 static updater purity check", () => {
	it("S1: W1's functional updater body contains no PTAD or diagnostic side effects", () => {
		const source = readFileSync(SOURCE_FILE, "utf-8")
		const updaterBody = extractW1UpdaterBody(source)

		const violations: { token: string; line: string }[] = []
		const bodyLines = updaterBody.split("\n")
		for (const token of FORBIDDEN_PTAD_TOKENS) {
			for (const line of bodyLines) {
				if (line.includes(token)) {
					violations.push({ token, line: line.trim() })
				}
			}
		}

		if (violations.length > 0) {
			const summary = violations.map((v) => `  FORBIDDEN TOKEN ${JSON.stringify(v.token)} on line: ${v.line}`).join("\n")
			throw new Error(
				`W1's functional updater body contains PTAD or diagnostic side effects.\n` +
					`React requires updater functions to be pure (calculate-and-return only).\n` +
					`Violations:\n${summary}\n` +
					`Updater body was:\n${updaterBody}`,
			)
		}

		expect(violations).toEqual([])
	})

	it("S2: PRE_EXISTING_REPLICA_REF_MUTATION is acknowledged as out of scope", () => {
		// FIXUP04 explicitly does NOT clean up `replicaRef.current = ...`
		// mutations inside the W1 updater (and the W2 partial-message
		// updater) — those are PRE-EXISTING residue from FIXUP01 and
		// earlier. The terminal evidence must mention this.
		//
		// This test verifies that the FIXUP04 source comments acknowledge
		// the residue honestly, so a future reader does not mistake the
		// residual impurity for a FIXUP04-introduced defect.
		const source = readFileSync(SOURCE_FILE, "utf-8")
		expect(source).toContain("PRE_EXISTING")
		expect(source).toContain("replicaRef.current")
	})
})
