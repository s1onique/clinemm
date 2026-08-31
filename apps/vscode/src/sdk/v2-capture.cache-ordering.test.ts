/**
 * ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-AND-APPROVAL-LIVE-CAPTURE01
 * CORRECTION03 — cache-coherence between the emitter
 * (`v2-capture.cachedPath`) and the dogfood auto-path resolver
 * (`dogfood-runtime-capture-path.cachedAutoPath`).
 *
 * Structural hypothesis (proven by this file's RED): on the
 * pre-CORRECTION03 production code, `configureDogfoodCaptureStorage()`
 * only invalidates `cachedAutoPath`. If `resolveCapturePath()` runs
 * BEFORE the host binds a storage root and the auto-path resolver
 * returns null (because `configuredStorageRoot` is undefined), the
 * emitter's `cachedPath` became `null` permanently and no subsequent
 * emit produced JSONL, even though the header resolver still saw the
 * freshly bound root. The CORRECTION03 repair in
 * `v2-capture.ts:resolveCapturePath` removes that negative write so
 * transient absence remains retryable.
 *
 * The RED test below reproduces the production chronology
 * (`resolve -> bind -> emit`) WITHOUT calling
 * `__resetV2CaptureForTests()` between steps 1 and 2 — that would
 * erase the bug we are trying to reproduce.
 *
 * ## Runner discipline (per `.clinerules/bun-and-node.md`)
 *
 * This file imports `bun:test` and is picked up by
 * `scripts/run-bun-unit-tests.ts`. The vitest sibling
 * `v2-capture.test.ts` always sets `CLINEMM_CAPTURE_V2_PATH` in its
 * outer `beforeEach`, so the auto-path branch (the only branch that
 * exercises the cache-coherence defect) is never reached there.
 * Splitting the RED into a `bun:test` file keeps the auto-path branch
 * observable in isolation and lets us run the cache hazard under
 * `bun test` directly without needing the Node-based vitest harness.
 *
 * `v2-capture.ts` is intentionally `vscode`-free (per
 * `dogfood-runtime-capture-path.ts:130-134` — the capture modules
 * receive an opaque root path, never the `vscode` API), so bun:test
 * is the correct runner for these RED/control cases.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import {
	__resetAutoV2CapturePathForTests,
	configureDogfoodCaptureStorage,
} from "./dogfood-runtime-capture-path"
import {
	__resetV2CaptureForTests,
	emitCaptureAttach,
	emitV2Capture,
	isV2CaptureEnabled,
	newV2CorrelationId,
	v2CommandDigest,
} from "./v2-capture"

describe("ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-AND-APPROVAL-LIVE-CAPTURE01 CORRECTION03 / v2-capture x dogfood auto-path", () => {
	let scratchDir: string
	let originalProfile: string | undefined
	let originalExplicitPath: string | undefined

	beforeEach(() => {
		originalProfile = process.env.CLINEMM_RUNTIME_PROFILE
		originalExplicitPath = process.env.CLINEMM_CAPTURE_V2_PATH
		scratchDir = mkdtempSync(join(tmpdir(), "clinemm-cache-ordering-"))
		// Drive the dogfood identity gate and CLEAR the explicit
		// env-var so the auto-path branch is the only one that can
		// produce a path.
		process.env.CLINEMM_RUNTIME_PROFILE = "dogfood"
		delete process.env.CLINEMM_CAPTURE_V2_PATH
		// Fresh start for BOTH caches so this describe has no
		// bleed from the explicit-path tests in v2-capture.test.ts.
		// The RED test itself does NOT call reset between its
		// three steps — that would erase the bug we are trying to
		// reproduce.
		__resetV2CaptureForTests()
		__resetAutoV2CapturePathForTests()
	})

	afterEach(() => {
		__resetV2CaptureForTests()
		__resetAutoV2CapturePathForTests()
		if (originalProfile === undefined) {
			delete process.env.CLINEMM_RUNTIME_PROFILE
		} else {
			process.env.CLINEMM_RUNTIME_PROFILE = originalProfile
		}
		if (originalExplicitPath === undefined) {
			delete process.env.CLINEMM_CAPTURE_V2_PATH
		} else {
			process.env.CLINEMM_CAPTURE_V2_PATH = originalExplicitPath
		}
		try {
			rmSync(scratchDir, { recursive: true, force: true })
		} catch {
			// best-effort cleanup
		}
	})

	it("T-CACHE-ORDERING: emitter bound AFTER first negative resolve must still materialize JSONL", () => {
		// ----- Step 1: trigger the REAL resolver BEFORE the host
		// binds a storage root. Production chronology this mirrors:
		// `resolveCapturePath()` called eagerly (e.g. at module
		// load time, or by a startup probe) before `activate()`
		// runs `configureDogfoodCaptureStorage(globalStorageUri.fsPath)`.
		const enabledBeforeBind = isV2CaptureEnabled()
		// Pre-fix, this assertion was the RED witness: the dogfood
		// auto-path resolver returned null because
		// `configuredStorageRoot` was undefined, and
		// `resolveCapturePath()` permanently memoized that null.
		// Post-CORRECTION03, the negative result is no longer
		// memoized, but step 1 still returns false here because
		// the root truly is unbound at this point.
		expect(enabledBeforeBind).toBe(false)

		// ----- Step 2: host binds the storage root (production
		// analog: `activate()` calling
		// `configureDogfoodCaptureStorage(globalStorageUri.fsPath)`).
		configureDogfoodCaptureStorage(scratchDir)

		// ----- Step 3: emit AGAIN, with NO cache reset. Pre-fix,
		// the bug surfaced here: the emitter's `cachedPath` was
		// still null, so this emit was a no-op even though the
		// auto-path resolver could now successfully mint a path
		// under `<scratchDir>/runtime-diag/`. Post-CORRECTION03,
		// `isV2CaptureEnabled()` flips true and the emit lands.
		expect(isV2CaptureEnabled()).toBe(true)
		emitCaptureAttach()

		// Post-fix expectation: the runtime-diag directory exists
		// under the bound root and contains the attach record.
		const runtimeDiagDir = join(scratchDir, "runtime-diag")
		expect(existsSync(runtimeDiagDir)).toBe(true)
		const files = readdirSync(runtimeDiagDir)
		expect(files.length).toBeGreaterThan(0)
		const firstFile = join(runtimeDiagDir, files[0])
		const contents = readFileSync(firstFile, "utf8").trim()
		expect(contents.length).toBeGreaterThan(0)
		const record = JSON.parse(contents.split("\n")[0])
		expect(record.codePoint).toBe("capture.attach.v1")
		expect(record.scope).toBe("process")
	})

	it("T-CACHE-ORDERING (negative variant): emitV2Capture is also stuck after bind", () => {
		// The bug is not specific to emitCaptureAttach — every
		// emitter routes through `resolveCapturePath()`. This
		// second RED exercises `emitV2Capture` directly to prove
		// the defect is at the resolver layer, not the attach
		// helper.
		expect(isV2CaptureEnabled()).toBe(false)
		configureDogfoodCaptureStorage(scratchDir)
		expect(isV2CaptureEnabled()).toBe(true)
		emitV2Capture({
			codePoint: "approval.entry.v2",
			correlationId: newV2CorrelationId(),
			commandDigest: v2CommandDigest("pwd; pwd"),
			data: { toolName: "run_commands", isCommand: true },
		})
		const runtimeDiagDir = join(scratchDir, "runtime-diag")
		expect(existsSync(runtimeDiagDir)).toBe(true)
		const files = readdirSync(runtimeDiagDir)
		expect(files.length).toBeGreaterThan(0)
	})

	it("C1: public profile + configured root -> no automatic JSONL (identity gate preserved)", () => {
		// Flip identity gate OFF, bind the root, then emit. Capture
		// must remain OFF because the resolver is gated on dogfood
		// identity. Guards against a repair that accidentally
		// widens the activation surface.
		delete process.env.CLINEMM_RUNTIME_PROFILE
		__resetV2CaptureForTests()
		__resetAutoV2CapturePathForTests()
		configureDogfoodCaptureStorage(scratchDir)
		emitCaptureAttach()
		const runtimeDiagDir = join(scratchDir, "runtime-diag")
		expect(existsSync(runtimeDiagDir)).toBe(false)
		expect(isV2CaptureEnabled()).toBe(false)
	})

	it("C2: explicit CLINEMM_CAPTURE_V2_PATH still wins over auto path (precedence preserved)", () => {
		// Even with the bug fixed, the operator-set env var must
		// still take precedence. Guards against a repair that
		// "always prefers the auto path" and silently regresses
		// the opt-in contract.
		const explicitPath = join(scratchDir, "explicit.jsonl")
		process.env.CLINEMM_CAPTURE_V2_PATH = explicitPath
		__resetV2CaptureForTests()
		configureDogfoodCaptureStorage(scratchDir)
		emitCaptureAttach()
		expect(existsSync(explicitPath)).toBe(true)
		// Auto-path directory must NOT have been created.
		expect(existsSync(join(scratchDir, "runtime-diag"))).toBe(false)
	})

	it("C3: configure root BEFORE first emitter -> JSONL materializes (happy-path control)", () => {
		// Happy-path control: if the host binds the root first,
		// the cache is populated positively on the very first
		// resolve and JSONL is written. MUST pass on both pre-fix
		// and post-CORRECTION03 HEAD; isolates the bug to the
		// ordering, not the mechanism.
		configureDogfoodCaptureStorage(scratchDir)
		emitCaptureAttach()
		const runtimeDiagDir = join(scratchDir, "runtime-diag")
		expect(existsSync(runtimeDiagDir)).toBe(true)
		const files = readdirSync(runtimeDiagDir)
		expect(files.length).toBeGreaterThan(0)
	})
})
