/**
 * ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-AUTHORITY-COUNTER-DUMP01
 *
 * Wiring-invariant tests for the Elm AUTHORITY counter dump
 * command. Mirrors ELS02-16 (the SHADOW dump wiring invariants)
 * so the four production wiring layers — `package.json`
 * declaration, `registry.ts` command id, `extension.ts:activate`
 * registration, and the host-side dump runtime — cannot silently
 * disappear in a future refactor without turning these tests RED.
 *
 * The dump is a DIAGNOSTIC seam: it serializes the existing
 * `getElmAuthorityCounters()` snapshot to
 * <globalStorageUri>/completion-authority-elm-authority.counters.json.
 * It does NOT change runtime semantics, the authority decision,
 * or any protocol surface. It exists only so an operator can tell
 * whether a live Elm authority failure is provider-not-armed,
 * record-not-ingested, HOLD-observed-but-ignored, or
 * fallback/default authorize.
 *
 * REMOVAL_TRIGGER: PASS_LIVE_ELM_AUTHORITY AND the cause is RED
 * on HOLD/FAILURE for operator review, OR successor evidence
 * supersedes. On removal, this test file + the registry entry +
 * the package.json declaration + the extension.ts handler + the
 * host dump runtime MUST be removed TOGETHER.
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(TEST_DIR, "../../../../../")

describe("ELAUTHORITY01 — production activation wiring exists in extension.ts + registry.ts + package.json", () => {
	test("ELAUTHORITY01.A: registry.ts exposes DumpCompletionAuthorityElmAuthority command id", () => {
		const regPath = path.resolve(REPO_ROOT, "apps/vscode/src/registry.ts")
		const source = fs.readFileSync(regPath, "utf8")
		expect(source).toMatch(/DumpCompletionAuthorityElmAuthority\s*:\s*prefix\s*\+/)
	})

	test("ELAUTHORITY01.B: extension.ts:activate registers DumpCompletionAuthorityElmAuthority as a command", () => {
		const extPath = path.resolve(REPO_ROOT, "apps/vscode/src/extension.ts")
		const source = fs.readFileSync(extPath, "utf8")
		expect(source).toMatch(/DumpCompletionAuthorityElmAuthority/)
		expect(source).toMatch(/dumpExtensionSideElmAuthorityCounters/)
	})

	test("ELAUTHORITY01.C: package.json declares the dump command for the contribution point", () => {
		const pkg = JSON.parse(fs.readFileSync(path.resolve(REPO_ROOT, "apps/vscode/package.json"), "utf8")) as {
			contributes?: { commands?: Array<{ command?: string; title?: string }> }
		}
		const entries = pkg.contributes?.commands ?? []
		const entry = entries.find((c) => c.command === "cline.debug.dumpCompletionAuthorityElmAuthority")
		expect(entry).toBeDefined()
		expect(entry?.title).toBe("Cline Debug: Dump Completion Authority Elm Authority")
		expect(entry?.title).not.toBe("Cline Debug: Dump Completion Authority Elm Shadow")
	})

	test("ELAUTHORITY01.D: host-side dump runtime module exists and serializes the counter snapshot", () => {
		const runtimePath = path.resolve(REPO_ROOT, "apps/vscode/src/sdk/completion-authority-elm-authority-runtime-host.ts")
		expect(fs.existsSync(runtimePath)).toBe(true)
		const source = fs.readFileSync(runtimePath, "utf8")
		expect(source).toMatch(/getElmAuthorityCounters/)
		expect(source).toMatch(/completion-authority-elm-authority\.counters\.json/)
		expect(source).not.toMatch(/resetElmAuthorityForTests/)
	})

	test("ELAUTHORITY01.E: host dump writes a well-shaped JSON snapshot matching ElmAuthorityCountersSnapshot", async () => {
		const { dumpExtensionSideElmAuthorityCounters } = await import("../completion-authority-elm-authority-runtime-host")
		const os = await import("node:os")
		const fsPromises = await import("node:fs/promises")
		const tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "elm-authority-dump-"))
		try {
			const { countersFile, counters } = await dumpExtensionSideElmAuthorityCounters({
				globalStorageUri: { fsPath: tmpRoot },
			})
			expect(fs.existsSync(countersFile)).toBe(true)
			const parsed = JSON.parse(fs.readFileSync(countersFile, "utf8")) as Record<string, unknown>
			const expectedKeys = [
				"total",
				"states",
				"decodeErrors",
				"kernelErrors",
				"authorize",
				"hold",
				"failure",
				"fallbackUsed",
				"sessionsActive",
				"lastDecision",
				"lastClassification",
				"lastHoldReasons",
			] as const
			for (const k of expectedKeys) {
				expect(parsed).toHaveProperty(k)
			}
			expect(counters).toEqual(parsed)
			// Default-off runtime: all-zero on a fresh process. This
			// is the "provider not armed" diagnostic shape — the
			// exact file the operator inspects on RED.
			expect(counters.total).toBe(0)
			expect(counters.lastDecision).toBeNull()
			expect(Array.isArray(counters.lastHoldReasons)).toBe(true)
		} finally {
			await fsPromises.rm(tmpRoot, { recursive: true, force: true })
		}
	}, 20_000)
})
