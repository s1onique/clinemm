/**
 * ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-AND-APPROVAL-LIVE-CAPTURE01:
 *
 * Tests for the auto V2 capture path resolver.
 */

import { afterEach, describe, expect, it } from "vitest"
import { __resetAutoV2CapturePathForTests, resolveAutoV2CapturePath } from "./dogfood-runtime-capture-path"

describe("resolveAutoV2CapturePath", () => {
	afterEach(() => {
		__resetAutoV2CapturePathForTests()
		delete process.env.CLINEMM_RUNTIME_PROFILE
	})

	it("public + no env -> null", () => {
		expect(resolveAutoV2CapturePath({})).toBeNull()
	})

	it("public + env tries to mark dogfood -> null (fail-closed)", () => {
		expect(resolveAutoV2CapturePath({ CLINEMM_RUNTIME_PROFILE: "banana" })).toBeNull()
	})

	it("dogfood + no env -> resolves an auto path under the data dir", () => {
		const path = resolveAutoV2CapturePath({ CLINEMM_RUNTIME_PROFILE: "dogfood" })
		expect(path).not.toBeNull()
		expect(path).toMatch(/runtime-diag\/clinemm-v2-.*\.jsonl$/)
	})

	it("memoizes the resolved path across calls (id stable)", () => {
		const a = resolveAutoV2CapturePath({ CLINEMM_RUNTIME_PROFILE: "dogfood" })
		const b = resolveAutoV2CapturePath({ CLINEMM_RUNTIME_PROFILE: "dogfood" })
		expect(a).toBe(b)
	})

	it("memoizes a null result for public installs", () => {
		expect(resolveAutoV2CapturePath({})).toBeNull()
		expect(resolveAutoV2CapturePath({})).toBeNull()
	})
})
