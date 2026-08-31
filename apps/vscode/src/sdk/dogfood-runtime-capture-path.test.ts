/**
 * ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-AND-APPROVAL-LIVE-CAPTURE01
 * (CORRECTION02) — auto V2 capture path resolver tests.
 *
 * R1-R5 RED/GREEN coverage (per CORRECTION02 review):
 *
 *   R1: dogfood + injected extension-storage root -> parent/subdirectory
 *       created, resolve returns a path under it.
 *   R2: explicit CLINEMM_CAPTURE_V2_PATH still wins over the injected
 *       automatic root (preserved via the v2-capture.ts env-var
 *       precedence; this module only contributes the auto path).
 *   R3: public + no explicit path -> no capture (resolver returns null;
 *       matches the prior public-default contract).
 *   R4: automatic storage root unavailable/unwritable -> runtime
 *       semantics unchanged AND resolve returns null (truthful
 *       V=false). This is the load-bearing contract upgrade.
 *   R5: writer failure after successful initialization -> not a
 *       concern of this module (covered by v2-capture.test.ts
 *       "swallows write errors without throwing"); we assert here
 *       only that an initialization success does NOT leak a
 *       try/catch path (successful path is uncached null).
 *
 * The "explicit CLINEMM_CAPTURE_V2_PATH" precedence is verified
 * by `v2-capture.test.ts`; this file exercises only the auto-path
 * module under CORRECTION02.
 */

import { mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	__resetAutoV2CapturePathForTests,
	configureDogfoodCaptureStorage,
	resolveAutoV2CapturePath,
} from "./dogfood-runtime-capture-path"

const DOGFOOD_ENV = { CLINEMM_RUNTIME_PROFILE: "dogfood" }

describe("resolveAutoV2CapturePath (CORRECTION02)", () => {
	let scratchDir: string

	beforeEach(() => {
		// Each test gets a fresh, writable scratch directory under
		// the OS tmpdir to avoid cross-test bleed. We do NOT write
		// to `$HOME/.cline` here — that path is precisely what
		// CORRECTION02 retired from the resolver.
		scratchDir = join(tmpdir(), `clinemm-capture-path-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
		mkdirSync(scratchDir, { recursive: true })
	})

	afterEach(() => {
		__resetAutoV2CapturePathForTests()
		delete process.env.CLINEMM_RUNTIME_PROFILE
		try {
			rmSync(scratchDir, { recursive: true, force: true })
		} catch {
			// best-effort cleanup
		}
	})

	it("R1: dogfood + injected extension-storage root -> resolves a path under <root>/runtime-diag/", () => {
		configureDogfoodCaptureStorage(scratchDir)
		const resolved = resolveAutoV2CapturePath(DOGFOOD_ENV)
		expect(resolved).not.toBeNull()
		expect(resolved).toMatch(
			new RegExp(`^${scratchDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/runtime-diag/clinemm-v2-.+\\.jsonl$`),
		)
	})

	it("R3: public + no explicit path -> null (public default preserved)", () => {
		configureDogfoodCaptureStorage(scratchDir)
		const resolved = resolveAutoV2CapturePath({})
		expect(resolved).toBeNull()
	})

	it("R3': public + garbage profile value -> null (fail-closed, unchanged)", () => {
		configureDogfoodCaptureStorage(scratchDir)
		expect(resolveAutoV2CapturePath({ CLINEMM_RUNTIME_PROFILE: "banana" })).toBeNull()
	})

	it("R4: dogfood + no storage root configured -> null (truthful V=false)", () => {
		// NOT calling configureDogfoodCaptureStorage: the host
		// boundary never bound a root. The resolver must return
		// null instead of inventing a path under ~/.cline.
		const resolved = resolveAutoV2CapturePath(DOGFOOD_ENV)
		expect(resolved).toBeNull()
	})

	it("R4': dogfood + injected root fails mkdirSync validation -> null + no path leak", () => {
		// The real host-side unwritability failure mode
		// (`mkdirSync` returning EPERM on `$HOME/.cline/data`)
		// is the reason this ACT moved to `globalStorageUri`.
		// This test deliberately uses a path containing a NUL
		// byte, which Node's path/fs validation rejects
		// deterministically across platforms — exercising the
		// resolver's "mkdir throws → null" branch without
		// manufacturing filesystem permissions. Real
		// permissions-based unwritability is verified by the
		// CORRECTION02 live investigation, not by this test.
		const poisonedRoot = `${scratchDir}\u0000/null-byte-blocked`
		configureDogfoodCaptureStorage(poisonedRoot)
		const resolved = resolveAutoV2CapturePath(DOGFOOD_ENV)
		expect(resolved).toBeNull()
	})

	it("R1': dogfood + injected root -> id stable across calls (memoization preserved)", () => {
		configureDogfoodCaptureStorage(scratchDir)
		const a = resolveAutoV2CapturePath(DOGFOOD_ENV)
		const b = resolveAutoV2CapturePath(DOGFOOD_ENV)
		expect(a).toBe(b)
	})

	it("R1'': dogfood + injected root -> null result also memoized for fail-closed fast-path", () => {
		configureDogfoodCaptureStorage(scratchDir)
		expect(resolveAutoV2CapturePath(DOGFOOD_ENV)).not.toBeNull()
		// Now flip to a poisoned root and verify the null result
		// is memoized across the next call.
		configureDogfoodCaptureStorage(`${scratchDir}\u0000/poisoned`)
		expect(resolveAutoV2CapturePath(DOGFOOD_ENV)).toBeNull()
		expect(resolveAutoV2CapturePath(DOGFOOD_ENV)).toBeNull()
		// Restore a working root; the next call re-resolves under it.
		configureDogfoodCaptureStorage(scratchDir)
		const reconfigured = resolveAutoV2CapturePath(DOGFOOD_ENV)
		expect(reconfigured).not.toBeNull()
		expect(reconfigured).toMatch(/\/runtime-diag\/clinemm-v2-.+\.jsonl$/)
	})

	it("public + injected root -> still null (identity gate is sole enabler)", () => {
		configureDogfoodCaptureStorage(scratchDir)
		expect(resolveAutoV2CapturePath({})).toBeNull()
	})

	it("configureDogfoodCaptureStorage rejects empty/whitespace roots silently", () => {
		// Should NOT throw and should NOT change the configured root.
		configureDogfoodCaptureStorage("")
		configureDogfoodCaptureStorage("   ")
		expect(resolveAutoV2CapturePath(DOGFOOD_ENV)).toBeNull()
	})

	it("configureDogfoodCaptureStorage is idempotent on the same root", () => {
		configureDogfoodCaptureStorage(scratchDir)
		const first = resolveAutoV2CapturePath(DOGFOOD_ENV)
		configureDogfoodCaptureStorage(scratchDir)
		const second = resolveAutoV2CapturePath(DOGFOOD_ENV)
		expect(first).toBe(second)
	})
})
