/**
 * ACT-CLINEMM-COMPLETION-CONTINUATION-DELIVERY-SEAM01-CORRECTION01-LIVE-CALLBACK-OUTCOME
 * ACT-CLINEMM-COMPLETION-CONTINUATION-DELIVERY-SEAM01-CORRECTION02-DOGFOOD-DIAGNOSTIC-GATE-AND-ARTIFACT-BINDING
 *
 * Wiring-invariant tests for the LIVE callback-outcome counter dump
 * command AND the dogfood profile resolver that arms it. Mirrors the
 * ELAUTHORITY01 wiring invariant test
 * (completion-authority-elm-authority-counter-dump01.test.ts) so the
 * five production wiring layers — `package.json` declaration,
 * `registry.ts` command id, `extension.ts:activate` registration,
 * the host-side dump runtime, AND the dogfood profile resolver
 * `applyCompletionContinuationDeliveryDiagnosticProfile` — cannot
 * silently disappear in a future refactor without turning these
 * tests RED.
 *
 * The dump is a DIAGNOSTIC seam: it serializes the existing
 * `getCompletionContinuationDeliveryCounters()` snapshot to
 * <globalStorageUri>/completion-continuation-delivery.counters.json.
 * It does NOT change runtime semantics, the callback decision, or
 * any protocol surface. It exists only so an operator can tell
 * which of CASE A..H (LIVE discriminator table §13) production
 * diverges through.
 *
 * REMOVAL_TRIGGER: first of (a) root cause isolated, (b) capture
 * insufficient, (c) successor evidence supersedes. On removal,
 * this test file + the registry entry + the package.json
 * declaration + the extension.ts handler + the host dump runtime
 * + the production-callback instrumentation + the dogfood
 * profile resolver MUST be removed TOGETHER.
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(TEST_DIR, "../../../../../")

describe("CCDCO01 — production activation wiring exists in extension.ts + registry.ts + package.json", () => {
	test("CCDCO01.A: registry.ts exposes DumpCompletionContinuationDelivery command id", () => {
		const regPath = path.resolve(REPO_ROOT, "apps/vscode/src/registry.ts")
		const source = fs.readFileSync(regPath, "utf8")
		expect(source).toMatch(/DumpCompletionContinuationDelivery\s*:\s*prefix\s*\+/)
	})

	test("CCDCO01.B: extension.ts:activate registers DumpCompletionContinuationDelivery as a command", () => {
		const extPath = path.resolve(REPO_ROOT, "apps/vscode/src/extension.ts")
		const source = fs.readFileSync(extPath, "utf8")
		expect(source).toMatch(/DumpCompletionContinuationDelivery/)
		expect(source).toMatch(/dumpExtensionSideCompletionContinuationDeliveryCounters/)
	})

	test("CCDCO01.C: package.json declares the dump command for the contribution point", () => {
		const pkg = JSON.parse(fs.readFileSync(path.resolve(REPO_ROOT, "apps/vscode/package.json"), "utf8")) as {
			contributes?: { commands?: Array<{ command?: string; title?: string }> }
		}
		const entries = pkg.contributes?.commands ?? []
		const entry = entries.find((c) => c.command === "cline.debug.dumpCompletionContinuationDelivery")
		expect(entry).toBeDefined()
		expect(entry?.title).toBe("Cline Debug: Dump Completion Continuation Delivery")
	})

	test("CCDCO01.D: host-side dump runtime module exists and serializes the counter snapshot", () => {
		const runtimePath = path.resolve(REPO_ROOT, "apps/vscode/src/sdk/completion-continuation-delivery-runtime-host.ts")
		expect(fs.existsSync(runtimePath)).toBe(true)
		const source = fs.readFileSync(runtimePath, "utf8")
		expect(source).toMatch(/getCompletionContinuationDeliveryCounters/)
		expect(source).toMatch(/completion-continuation-delivery\.counters\.json/)
		// dump must not call the test-only reset; mirrors the
		// SHADOW / ELM-AUTHORITY convention.
		expect(source).not.toMatch(/resetCompletionContinuationDeliveryForTests/)
	})

	test("CCDCO01.E: host dump writes a well-shaped JSON snapshot matching the diagnostic snapshot", async () => {
		const { dumpExtensionSideCompletionContinuationDeliveryCounters } = await import(
			"../completion-continuation-delivery-runtime-host"
		)
		const { resetCompletionContinuationDeliveryForTests } = await import("../completion-continuation-delivery-runtime")
		const os = await import("node:os")
		const fsPromises = await import("node:fs/promises")
		const tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "ccdco-dump-"))
		try {
			resetCompletionContinuationDeliveryForTests()
			const { countersFile, counters } = await dumpExtensionSideCompletionContinuationDeliveryCounters({
				globalStorageUri: { fsPath: tmpRoot },
			})
			expect(fs.existsSync(countersFile)).toBe(true)
			const parsed = JSON.parse(fs.readFileSync(countersFile, "utf8")) as Record<string, unknown>
			const expectedKeys = [
				"total",
				"callbackEntered",
				"activeSessionMissing",
				"sessionIdMismatch",
				"sdkHostSendEntered",
				"delivered",
				"rejected",
				"sessionGone",
				"noHeldJobIds",
				"sendThrew",
				"lastOutcome",
				"lastRequestedSessionMatched",
				"pendingPromptEnqueuedObserved",
			] as const
			for (const k of expectedKeys) {
				expect(parsed).toHaveProperty(k)
			}
			expect(counters).toEqual(parsed)
			// Fresh process: every counter is zero.
			expect(counters.total).toBe(0)
			expect(counters.callbackEntered).toBe(0)
			expect(counters.lastOutcome).toBeNull()
			expect(counters.lastRequestedSessionMatched).toBeNull()
			expect(counters.pendingPromptEnqueuedObserved).toBeNull()
		} finally {
			await fsPromises.rm(tmpRoot, { recursive: true, force: true })
		}
	}, 20_000)
})

describe("CCDCO01 — CORRECTION02 dogfood profile resolver wiring", () => {
	test("CCDCO01.F: dogfood-diagnostic-profile.ts exposes applyCompletionContinuationDeliveryDiagnosticProfile (mirrors CCARD shape)", () => {
		const profilePath = path.resolve(REPO_ROOT, "apps/vscode/src/sdk/dogfood-diagnostic-profile.ts")
		const source = fs.readFileSync(profilePath, "utf8")
		expect(source).toMatch(
			/export\s+function\s+applyCompletionContinuationDeliveryDiagnosticProfile\s*\(\s*isDogfood:\s*boolean\s*\)/,
		)
		// Must use the runtime seam — never an env override.
		expect(source).toMatch(/setCompletionContinuationDeliveryEnabled\s*\(\s*true\s*\)/)
		expect(source).toMatch(/setCompletionContinuationDeliveryEnabled\s*\(\s*false\s*\)/)
		// Banned tokens per §2: no new env var, no override matrix.
		expect(source).not.toMatch(/CLINEMM_DIAG_COMPLETION_CONTINUATION_DELIVERY/)
		expect(source).not.toMatch(/CLINEMM_ENABLE_CCDCO/)
	})

	test("CCDCO01.G: extension.ts:activate arms the diagnostic via the dogfood resolver at the EARLIEST seam", () => {
		const extPath = path.resolve(REPO_ROOT, "apps/vscode/src/extension.ts")
		const source = fs.readFileSync(extPath, "utf8")
		expect(source).toMatch(/applyCompletionContinuationDeliveryDiagnosticProfile/)
		expect(source).toMatch(
			/applyCompletionContinuationDeliveryDiagnosticProfile\s*\(\s*isDogfoodRuntime\s*\(\s*process\.env\s*\)\s*\)/,
		)
		// Verify the call site is positioned in the activate body
		// (sibling to the CCARD activation), BEFORE the SdkController
		// construction. We assert the apply call appears BEFORE the
		// `setupHostProvider` reference (the load-bearing
		// construction site for the SdkController / vscode host
		// bridge).
		const applyIdx = source.indexOf("applyCompletionContinuationDeliveryDiagnosticProfile(")
		const ccardIdx = source.indexOf("applyContinuationCardinalityAuthorityDiagnosticProfile(")
		const sdkControllerIdx = source.indexOf("setupHostProvider(context)")
		expect(applyIdx).toBeGreaterThan(-1)
		expect(ccardIdx).toBeGreaterThan(-1)
		expect(sdkControllerIdx).toBeGreaterThan(-1)
		expect(applyIdx).toBeLessThan(sdkControllerIdx)
		// Sibling to CCARD (near each other).
		expect(Math.abs(applyIdx - ccardIdx)).toBeLessThan(2000)
	})

	test("CCDCO01.H: runtime exposes setCompletionContinuationDeliveryEnabled + isCompletionContinuationDeliveryEnabled", () => {
		const runtimePath = path.resolve(REPO_ROOT, "apps/vscode/src/sdk/completion-continuation-delivery-runtime.ts")
		const source = fs.readFileSync(runtimePath, "utf8")
		expect(source).toMatch(/export\s+function\s+setCompletionContinuationDeliveryEnabled\s*\(\s*enabled:\s*boolean\s*\)/)
		expect(source).toMatch(/export\s+function\s+isCompletionContinuationDeliveryEnabled\s*\(\s*\)/)
		// Every record function MUST short-circuit on the enabled
		// flag (default-off contract).
		const recordMatches = source.match(/export\s+function\s+record[A-Za-z]+\s*\(\s*\)\s*:\s*void\s*\{[^}]*\}/g) ?? []
		expect(recordMatches.length).toBeGreaterThan(0)
		for (const fn of recordMatches) {
			expect(fn).toMatch(/if\s*\(\s*!\s*_state\.enabled\s*\)\s*return/)
		}
	})

	test("CCDCO01.I: runtime is default-off at module init (counters start at zero, no public knob)", () => {
		const runtimePath = path.resolve(REPO_ROOT, "apps/vscode/src/sdk/completion-continuation-delivery-runtime.ts")
		const source = fs.readFileSync(runtimePath, "utf8")
		// Module-level state must initialize `enabled: false`.
		expect(source).toMatch(/_state:\s*DeliveryState\s*=\s*\{\s*enabled:\s*false/)
		// Banned tokens per §2: no new env var / public config knob.
		expect(source).not.toMatch(/CLINEMM_DIAG_COMPLETION_CONTINUATION_DELIVERY/)
		expect(source).not.toMatch(/process\.env/)
	})
})
