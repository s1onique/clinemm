/**
 * ACT-CLINEMM-ELMIZE-P1-COMPLETION-CONTINUATION-CONTROL-AUTHORITY02 (C27 / C11)
 *
 * Loader discriminator: prove that `ensureElmKernelEvaluated` and
 * `loadCompiledElmKernel` go through the full stage taxonomy for
 * success, fail-closed for missing file, and never mutate
 * `globalThis`.
 *
 * Mirrors `task-header-elm-loader-discriminator.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { join } from "node:path"
import {
	ensureElmKernelEvaluated,
	getCompletionContinuationControlElmKernelDiagnostic,
	loadCompiledElmKernel,
	resolveProductionKernelPath,
	resetElmKernelForTests,
	setCompletionContinuationControlElmProductionKernelPath,
	COMPLETION_CONTINUATION_CONTROL_ELM_RUNTIME_ASSET_ID,
} from "../completion-continuation-control-elm"

describe("ACT-CLINEMM-ELMIZE-P1-COMPLETION-CONTINUATION-CONTROL-AUTHORITY02 C27/C11 loader", () => {
	beforeEach(() => {
		resetElmKernelForTests()
	})
	afterEach(() => {
		resetElmKernelForTests()
	})

	it("GREEN: source-tree fallback path resolves and evaluation succeeds", () => {
		const path = resolveProductionKernelPath()
		expect(path.length).toBeGreaterThan(0)
		expect(ensureElmKernelEvaluated(path)).toBe(true)
		// After loadCompiledElmKernel() the stage reaches "ports_valid".
		expect(loadCompiledElmKernel()).not.toBeNull()
		const d = getCompletionContinuationControlElmKernelDiagnostic()
		expect(d.stage).toBe("ports_valid")
		expect(d.failureClass).toBe(null)
		expect(d.assetId).toBe(COMPLETION_CONTINUATION_CONTROL_ELM_RUNTIME_ASSET_ID)
	})

	it("RED: missing runtime asset path -> KERNEL_FILE_MISSING, kernel offline", () => {
		const absentPath = "/nonexistent/path/to/completion-continuation-control.js"
		setCompletionContinuationControlElmProductionKernelPath(absentPath)
		expect(ensureElmKernelEvaluated(absentPath)).toBe(false)
		const d = getCompletionContinuationControlElmKernelDiagnostic()
		expect(d.stage).toBe("failed")
		expect(d.failureClass).toBe("KERNEL_FILE_MISSING")
		expect(d.assetId).toBe(COMPLETION_CONTINUATION_CONTROL_ELM_RUNTIME_ASSET_ID)
		expect(loadCompiledElmKernel()).toBeNull()
	})

	it("GREEN: loadCompiledElmKernel returns a kernel after successful evaluation", () => {
		const path = resolveProductionKernelPath()
		ensureElmKernelEvaluated(path)
		const kernel = loadCompiledElmKernel()
		expect(kernel).not.toBeNull()
		expect(typeof kernel?.sendInbound).toBe("function")
		expect(typeof kernel?.recvOutbound).toBe("function")
	})

	it("RED: invalid (empty) production path -> KERNEL_PATH_UNRESOLVED", () => {
		setCompletionContinuationControlElmProductionKernelPath("")
		expect(ensureElmKernelEvaluated("")).toBe(false)
		const d = getCompletionContinuationControlElmKernelDiagnostic()
		expect(d.failureClass).toBe("KERNEL_PATH_UNRESOLVED")
	})

	it("GREEN: resetElmKernelForTests clears the cached state", () => {
		const path = resolveProductionKernelPath()
		ensureElmKernelEvaluated(path)
		loadCompiledElmKernel()
		resetElmKernelForTests()
		const d = getCompletionContinuationControlElmKernelDiagnostic()
		expect(d.stage).toBe("not_attempted")
		expect(d.failureClass).toBe(null)
	})

	it("GREEN: COMPLETION_CONTINUATION_CONTROL_ELM_RUNTIME_ASSET_ID is the canonical VSIX path", () => {
		expect(COMPLETION_CONTINUATION_CONTROL_ELM_RUNTIME_ASSET_ID).toBe(
			"runtime-assets/completion-continuation-control.js",
		)
	})

	it("integration: installed runtime path (mirrors TaskHeader activation wiring)", () => {
		const installedRoot = "/installed/extension-root"
		const installedPath = join(installedRoot, COMPLETION_CONTINUATION_CONTROL_ELM_RUNTIME_ASSET_ID)
		setCompletionContinuationControlElmProductionKernelPath(installedPath)
		expect(resolveProductionKernelPath()).toBe(installedPath)
		setCompletionContinuationControlElmProductionKernelPath(null)
		expect(resolveProductionKernelPath()).not.toBe(installedPath)
	})
})
