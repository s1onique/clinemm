/**
 * ACT-CLINEMM-COMPLETION-CONTINUATION-DELIVERY-SEAM01-CORRECTION01-LIVE-CALLBACK-OUTCOME
 *
 * Wiring-invariant tests for the LIVE callback-outcome counter dump
 * command. Mirrors the ELAUTHORITY01 wiring invariant test
 * (completion-authority-elm-authority-counter-dump01.test.ts) so the
 * four production wiring layers — `package.json` declaration,
 * `registry.ts` command id, `extension.ts:activate` registration,
 * and the host-side dump runtime — cannot silently disappear in a
 * future refactor without turning these tests RED.
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
 * + the production-callback instrumentation MUST be removed
 * TOGETHER.
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
