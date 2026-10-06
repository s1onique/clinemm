/**
 * ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION02-CORRECTION03-KERNEL-OFFLINE-DISCRIMINATOR
 *
 * RED-1..RED-7: bounded loader-stage discriminator tests.
 *
 * Each test forces one exact loader-stage failure and proves the
 * resulting `TaskHeaderElmDecision` becomes `kernel_offline`
 * (preserving the public contract) AND the diagnostic carries the
 * bounded `failureClass` matching the ACT §C1 stage taxonomy.
 *
 * EVIDENCE CLASSIFICATION: SYNTHETIC_REAL.
 *
 * The tests invoke the REAL `invokeElmKernel` production seam
 * against a synthetic bundle written into a per-test temp
 * directory. The seam is the new production-side kernel-path
 * resolver (`setTaskHeaderElmProductionKernelPath`); no global
 * state mutation, no `globalThis.Elm` leak. The diagnostic surface
 * is the real `getTaskHeaderElmKernelDiagnostic()` module getter.
 *
 * Required test coverage (per ACT §C5):
 *
 *   RED-1: kernel path points to absent file -> KERNEL_FILE_MISSING
 *   RED-2: bundle evaluates but throws -> KERNEL_EVAL_FAILED
 *   RED-3: bundle evaluates but does not create namespace.Elm -> KERNEL_EXPORT_MISSING
 *   RED-4: bundle creates namespace.Elm but no Main.init -> KERNEL_MAIN_INIT_MISSING
 *   RED-5: Main.init returns an app with no ports -> KERNEL_PORTS_INVALID
 *   RED-6: happy loader path -> READY + presentation decision
 *   RED-7: production-path contract: staging writes to
 *   runtime-assets/task-header-orchestration.js
 *
 * Cache test contract:
 *
 *   Each test calls `resetElmKernelForTests()` in `beforeEach` so
 *   the loader's `_kernelEvaluatedOnce` cache from a different RED
 *   scenario does not contaminate the next test's diagnostic.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
	getTaskHeaderElmKernelDiagnostic,
	invokeElmKernel,
	resetElmKernelForTests,
	setTaskHeaderElmProductionKernelPath,
	TASK_HEADER_ELM_RUNTIME_ASSET_ID,
	type TaskHeaderElmFactsJson,
} from "../task-header-elm-shadow"

const LIVE_SPECIMEN: TaskHeaderElmFactsJson = {
	canonicalShadowPhase: "idle",
	currentLegacyPhase: "streaming",
	seq: 4293,
	canonicalShadowObservedTurnSeq: null,
}

let tmpRoot: string | null = null

function freshTmp(): string {
	const root = mkdtempSync(join(tmpdir(), "task-header-elm-loader-discriminator-"))
	tmpRoot = root
	return root
}

function writeBundle(relName: string, contents: string): string {
	if (!tmpRoot) throw new Error("freshTmp() must be called first")
	const path = join(tmpRoot, relName)
	writeFileSync(path, contents, "utf8")
	return path
}

beforeEach(() => {
	resetElmKernelForTests()
	freshTmp()
})

describe("ACT-CLINEMM-...-CORRECTION03 / RED-1: KERNEL_FILE_MISSING", () => {
	it("RED-1: production kernel path resolves to a non-existent file -> kernel_offline + KERNEL_FILE_MISSING", async () => {
		if (!tmpRoot) throw new Error("tmpRoot not initialized")
		const absentPath = join(tmpRoot, "does-not-exist.js")
		setTaskHeaderElmProductionKernelPath(absentPath)
		const result = await invokeElmKernel(LIVE_SPECIMEN)
		expect(result.kind).toBe("kernel_offline")
		if (result.kind !== "kernel_offline") return
		expect(result.classification).toBe("task_header_elm_kernel_offline")
		const diagnostic = getTaskHeaderElmKernelDiagnostic()
		expect(diagnostic.stage).toBe("failed")
		expect(diagnostic.failureClass).toBe("KERNEL_FILE_MISSING")
		expect(diagnostic.assetId).toBe(TASK_HEADER_ELM_RUNTIME_ASSET_ID)
		expect(diagnostic.fileReadable).toBe(false)
		expect(diagnostic.bundleByteSize).toBeNull()
	})
})

describe("ACT-CLINEMM-...-CORRECTION03 / RED-2: KERNEL_EVAL_FAILED", () => {
	it("RED-2: synthetic kernel eval failure -> KERNEL_EVAL_FAILED", async () => {
		const bundlePath = writeBundle("eval-throw.js", "throw new Error('synthetic kernel eval failure');")
		setTaskHeaderElmProductionKernelPath(bundlePath)
		const result = await invokeElmKernel(LIVE_SPECIMEN)
		expect(result.kind).toBe("kernel_offline")
		if (result.kind !== "kernel_offline") return
		expect(result.classification).toBe("task_header_elm_kernel_offline")
		const diagnostic = getTaskHeaderElmKernelDiagnostic()
		expect(diagnostic.stage).toBe("failed")
		expect(diagnostic.failureClass).toBe("KERNEL_EVAL_FAILED")
		expect(diagnostic.fileReadable).toBe(true)
		expect(diagnostic.bundleByteSize).not.toBeNull()
		expect(diagnostic.bundleByteSize).toBeGreaterThan(0)
		expect(diagnostic.errorName).toBe("Error")
	})
})

describe("ACT-CLINEMM-...-CORRECTION03 / RED-3: KERNEL_EXPORT_MISSING", () => {
	it("RED-3: bundle evaluates but does not create namespace.Elm -> KERNEL_EXPORT_MISSING", async () => {
		const bundlePath = writeBundle("no-export.js", "this.OtherThing = { Main: { init: function () { return {}; } } };")
		setTaskHeaderElmProductionKernelPath(bundlePath)
		const result = await invokeElmKernel(LIVE_SPECIMEN)
		expect(result.kind).toBe("kernel_offline")
		if (result.kind !== "kernel_offline") return
		expect(result.classification).toBe("task_header_elm_kernel_offline")
		const diagnostic = getTaskHeaderElmKernelDiagnostic()
		expect(diagnostic.stage).toBe("failed")
		expect(diagnostic.failureClass).toBe("KERNEL_EXPORT_MISSING")
		expect(diagnostic.fileReadable).toBe(true)
		expect(diagnostic.bundleByteSize).not.toBeNull()
	})
})

describe("ACT-CLINEMM-...-CORRECTION03 / RED-4: KERNEL_MAIN_INIT_MISSING", () => {
	it("RED-4: bundle sets namespace.Elm but Main.init is missing -> KERNEL_MAIN_INIT_MISSING", async () => {
		const bundlePath = writeBundle("no-init.js", "this.Elm = { Main: {} };")
		setTaskHeaderElmProductionKernelPath(bundlePath)
		const result = await invokeElmKernel(LIVE_SPECIMEN)
		expect(result.kind).toBe("kernel_offline")
		if (result.kind !== "kernel_offline") return
		expect(result.classification).toBe("task_header_elm_kernel_offline")
		const diagnostic = getTaskHeaderElmKernelDiagnostic()
		expect(diagnostic.stage).toBe("failed")
		expect(diagnostic.failureClass).toBe("KERNEL_MAIN_INIT_MISSING")
	})
})

describe("ACT-CLINEMM-...-CORRECTION03 / RED-5: KERNEL_PORTS_INVALID", () => {
	it("RED-5: Main.init returns an app with no ports -> KERNEL_PORTS_INVALID", async () => {
		const bundlePath = writeBundle("no-ports.js", "this.Elm = { Main: { init: function (_flags) { return {}; } } };")
		setTaskHeaderElmProductionKernelPath(bundlePath)
		const result = await invokeElmKernel(LIVE_SPECIMEN)
		expect(result.kind).toBe("kernel_offline")
		if (result.kind !== "kernel_offline") return
		expect(result.classification).toBe("task_header_elm_kernel_offline")
		const diagnostic = getTaskHeaderElmKernelDiagnostic()
		expect(diagnostic.stage).toBe("failed")
		expect(diagnostic.failureClass).toBe("KERNEL_PORTS_INVALID")
	})
})

describe("ACT-CLINEMM-...-CORRECTION03 / RED-6: happy loader path", () => {
	it("RED-6: synthetic valid Elm app returns a presentation decision + READY stage", async () => {
		const bundlePath = writeBundle(
			"happy-path.js",
			`this.Elm = {
  Main: {
    init: function (_flags) {
      var cb = null;
      return {
        ports: {
          inbound: {
            send: function (v) {
              // Echo a presentation-shaped object through the outbound
              // callback so the loader's recvOutbound() returns a valid
              // presentation message.
              if (cb) {
                cb({
                  kind: "presentation",
                  presentation: { phase: "idle", source: "shadow", seq: v.seq },
                });
              }
            },
          },
          outbound: {
            subscribe: function (fn) { cb = fn; },
          },
        },
      };
    },
  },
};
`,
		)
		setTaskHeaderElmProductionKernelPath(bundlePath)
		const result = await invokeElmKernel(LIVE_SPECIMEN)
		expect(result.kind).toBe("presentation")
		const diagnostic = getTaskHeaderElmKernelDiagnostic()
		expect(["ports_valid", "ready"]).toContain(diagnostic.stage)
		expect(diagnostic.failureClass).toBeNull()
	})
})

describe("ACT-CLINEMM-...-CORRECTION03 / RED-7: production path contract", () => {
	it("RED-7: stable asset identifier is runtime-assets/task-header-orchestration.js", () => {
		expect(TASK_HEADER_ELM_RUNTIME_ASSET_ID).toBe("runtime-assets/task-header-orchestration.js")
	})

	it("RED-7b: simulated installed-extension layout - staged asset is found", async () => {
		const installedRoot = mkdtempSync(join(tmpdir(), "task-header-elm-installed-"))
		try {
			const runtimeAssetsDir = join(installedRoot, "runtime-assets")
			// Ensure the runtime-assets directory exists before
			// writing the staged asset. mkdtempSync only creates the
			// root directory, not subdirectories.
			require("node:fs").mkdirSync(runtimeAssetsDir, { recursive: true })
			writeFileSync(
				join(runtimeAssetsDir, "task-header-orchestration.js"),
				"this.Elm = { Main: { init: function (_f) { var cb=null; return { ports: { inbound: { send: function (v){ if(cb) cb({ kind: 'presentation', presentation: { phase: 'idle', source: 'shadow', seq: v.seq } }); } }, outbound: { subscribe: function (fn) { cb = fn; } } } }; } } };",
				"utf8",
			)
			setTaskHeaderElmProductionKernelPath(join(installedRoot, "runtime-assets", "task-header-orchestration.js"))
			const result = await invokeElmKernel(LIVE_SPECIMEN)
			expect(result.kind).not.toBe("kernel_offline")
			const diagnostic = getTaskHeaderElmKernelDiagnostic()
			expect(diagnostic.failureClass).toBeNull()
			expect(["ports_valid", "ready"]).toContain(diagnostic.stage)
		} finally {
			rmSync(installedRoot, { recursive: true, force: true })
		}
	})
})

afterEach(() => {
	resetElmKernelForTests()
	setTaskHeaderElmProductionKernelPath(null)
	if (tmpRoot) {
		rmSync(tmpRoot, { recursive: true, force: true })
		tmpRoot = null
	}
})
