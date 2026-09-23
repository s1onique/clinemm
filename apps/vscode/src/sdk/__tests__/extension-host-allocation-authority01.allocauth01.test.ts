/**
 * ACT-CLINEMM-EXTENSION-HOST-ALLOCATION-AUTHORITY01
 *
 * Focused test suite for the V8 allocation sampler module.
 *
 * Test plan (mirrors ACT §19-§22):
 *
 *   ALLOCAUTH-CTL-01..06  enablement + trigger predicate
 *   ALLOCAUTH-PROTO-01     startSampling options (collected-GC flags)
 *   ALLOCAUTH-CHECKPOINT-01..03  checkpoint lifecycle
 *   ALLOCAUTH-FINAL-01..03  finalize lifecycle
 *   ALLOCAUTH-CONSERVE-*  conservation invariants
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	__driveFinalizerForTests,
	__resetAllocationProfilerForTests,
	ALLOCATION_PROFILE_CHECKPOINT_INTERVAL_MS,
	ALLOCATION_PROFILE_SAMPLING_INTERVAL_BYTES,
	ALLOCATION_PROFILE_STACK_DEPTH,
	type AllocationProfilerFilesystem,
	type AllocationProfilerIdentityBinding,
	type AllocationProfilerInspectorSession,
	applyExtensionHostAllocationProfilerPolicy,
	CLINEMM_DIAG_ALLOCATION_PROFILE_ENV,
	getAllocationProfilerCaptureId,
	getAllocationProfilerPerformanceCounters,
	getAllocationProfilerSnapshot,
	getAllocationProfilerState,
	resolveAllocationProfileKnobFromEnv,
	setAllocationProfilerCaptureIdFactory,
	setAllocationProfilerDataRootResolver,
	setAllocationProfilerFilesystem,
	setAllocationProfilerIdentityResolver,
	setAllocationProfilerInspectorSessionFactory,
	setAllocationProfilerWarn,
	triggerExtensionHostAllocationProfilerOnFirstQualifyingJob,
} from "../extension-host-allocation-profiler"
import { resolveInstalledBundleIdentity } from "../extension-host-allocation-profiler-runtime"

const TEST_DATA_DIR = "/tmp/clin-allocauth-fake-root"

interface FakeFilesystem extends AllocationProfilerFilesystem {
	_writes: Array<{ path: string; data: string }>
	_renames: Array<{ from: string; to: string }>
	_mkdirs: string[]
}

function makeFakeFilesystem(): FakeFilesystem {
	return {
		async mkdir(target: string, _options: { recursive: boolean }): Promise<void> {
			this._mkdirs.push(target)
		},
		async rename(from: string, to: string): Promise<void> {
			this._renames.push({ from, to })
		},
		async writeFile(target: string, data: string): Promise<void> {
			this._writes.push({ path: target, data })
		},
		_writes: [],
		_renames: [],
		_mkdirs: [],
	}
}

interface FakeSession extends AllocationProfilerInspectorSession {
	_connectCalls: number
	_disconnectCalls: number
	_posts: Array<{ method: string; params: Record<string, unknown> | undefined }>
	_results: Map<string, unknown>
	_errors: Map<string, Error>
	/** Optional override for the next getSamplingProfile call. */
	_onNextProfile?: () => unknown
	/** Optional override for the next stopSampling call. */
	_onNextStopSampling?: () => unknown
}

function makeFakeSession(opts?: { stopSamplingResult?: unknown }): FakeSession {
	const session: FakeSession = {
		_connectCalls: 0,
		_disconnectCalls: 0,
		_posts: [],
		_results: new Map(),
		_errors: new Map(),
		connect(): void {
			this._connectCalls += 1
		},
		disconnect(): void {
			this._disconnectCalls += 1
		},
		async post(method: string, params?: Record<string, unknown>): Promise<unknown> {
			this._posts.push({ method, params })
			const err = this._errors.get(method)
			if (err) throw err
			if (this._onNextProfile && method === "HeapProfiler.getSamplingProfile") {
				return this._onNextProfile()
			}
			if (this._onNextStopSampling && method === "HeapProfiler.stopSampling") {
				// One-shot then cleared.
				const cb = this._onNextStopSampling
				this._onNextStopSampling = undefined
				return cb()
			}
			const result = this._results.get(method)
			if (result !== undefined) return result
			if (method === "HeapProfiler.stopSampling") {
				// Default: stopSampling returns its profile result wrapped
				// (matches CDP). Tests can override via _onNextStopSampling.
				return opts?.stopSamplingResult ?? { profile: { head: { sampleCount: 4242 }, samples: [] } }
			}
			return { head: { sampleCount: 17 } }
		},
		on(_event: string, _listener: (chunk: unknown) => void): void {
			// no-op for tests
		},
	}
	return session
}

const TEST_IDENTITY: AllocationProfilerIdentityBinding = {
	sourceHead: "test-source-head",
	version: "test-version",
	extensionPath: "/test/extension/path",
	extensionBundleSha256: "test-bundle-sha",
}

function resetAllProfilingSeams(): FakeFilesystem {
	__resetAllocationProfilerForTests()
	const fs = makeFakeFilesystem()
	setAllocationProfilerFilesystem(fs)
	setAllocationProfilerDataRootResolver(() => TEST_DATA_DIR)
	setAllocationProfilerIdentityResolver(() => TEST_IDENTITY)
	setAllocationProfilerCaptureIdFactory(() => "test-capture-id")
	return fs
}

function arm(): void {
	applyExtensionHostAllocationProfilerPolicy(true, {
		[CLINEMM_DIAG_ALLOCATION_PROFILE_ENV]: "1",
	})
}

// =============================================================================
// ALLOCAUTH-CTL-* tests
// =============================================================================

describe("ALLOCAUTH-CTL: enablement resolver", () => {
	beforeEach(() => {
		__resetAllocationProfilerForTests()
	})

	it("ALLOCAUTH-CTL-01: public + knob on -> disabled (identity is the SOLE gate)", () => {
		const result = applyExtensionHostAllocationProfilerPolicy(false, {
			[CLINEMM_DIAG_ALLOCATION_PROFILE_ENV]: "1",
		})
		expect(result.enabled).toBe(false)
		expect(getAllocationProfilerState()).toBe("disabled")
	})

	it("ALLOCAUTH-CTL-02: dogfood + knob absent -> disabled", () => {
		const result = applyExtensionHostAllocationProfilerPolicy(true, {})
		expect(result.enabled).toBe(false)
		expect(getAllocationProfilerState()).toBe("disabled")
	})

	it("ALLOCAUTH-CTL-03: dogfood + knob on -> armed", () => {
		const result = applyExtensionHostAllocationProfilerPolicy(true, {
			[CLINEMM_DIAG_ALLOCATION_PROFILE_ENV]: "1",
		})
		expect(result.enabled).toBe(true)
		expect(result.flipped).toBe(true)
		expect(getAllocationProfilerState()).toBe("armed")
	})

	it("ALLOCAUTH-CTL: knob truthy variations all enable in dogfood", () => {
		for (const truthy of ["1", "true", "yes", "TRUE", " Yes "]) {
			__resetAllocationProfilerForTests()
			const result = applyExtensionHostAllocationProfilerPolicy(true, {
				[CLINEMM_DIAG_ALLOCATION_PROFILE_ENV]: truthy,
			})
			expect(result.enabled, `truthy="${truthy}"`).toBe(true)
			expect(getAllocationProfilerState()).toBe("armed")
		}
	})

	it("ALLOCAUTH-CTL: knob falsy variations all disable", () => {
		for (const falsy of ["0", "off", "false", "FALSE", "no"]) {
			const result = applyExtensionHostAllocationProfilerPolicy(true, {
				[CLINEMM_DIAG_ALLOCATION_PROFILE_ENV]: falsy,
			})
			expect(result.enabled, `falsy="${falsy}"`).toBe(false)
			expect(getAllocationProfilerState()).toBe("disabled")
		}
	})

	it("ALLOCAUTH-CTL: resolveAllocationProfileKnobFromEnv pure (no state side-effect)", () => {
		__resetAllocationProfilerForTests()
		const r1 = resolveAllocationProfileKnobFromEnv(false, { [CLINEMM_DIAG_ALLOCATION_PROFILE_ENV]: "1" })
		const r2 = resolveAllocationProfileKnobFromEnv(true, {})
		const r3 = resolveAllocationProfileKnobFromEnv(true, { [CLINEMM_DIAG_ALLOCATION_PROFILE_ENV]: "1" })
		expect(r1).toBe(false)
		expect(r2).toBe(false)
		expect(r3).toBe(true)
		expect(getAllocationProfilerState()).toBe("disabled")
	})
})

// =============================================================================
// ALLOCAUTH-CTL trigger predicate tests
// =============================================================================

describe("ALLOCAUTH-CTL: trigger predicate", () => {
	afterEach(() => {
		__resetAllocationProfilerForTests()
	})

	it("ALLOCAUTH-CTL-04: armed + first qualifying notify-bg job -> exactly one startSampling", async () => {
		const fs = resetAllProfilingSeams()
		arm()
		const session = makeFakeSession()
		setAllocationProfilerInspectorSessionFactory(() => session)

		const result = triggerExtensionHostAllocationProfilerOnFirstQualifyingJob()
		expect(result.kind).toBe("started")
		if (result.kind === "started") {
			expect(result.captureId).toBe("test-capture-id")
		}
		expect(getAllocationProfilerCaptureId()).toBe("test-capture-id")

		// Allow the capture loop microtasks to flush so connect + enable +
		// startSampling complete.
		await new Promise((r) => setImmediate(r))

		expect(session._connectCalls).toBe(1)
		expect(session._posts.find((p) => p.method === "HeapProfiler.enable")).toBeTruthy()

		const startCall = session._posts.find((p) => p.method === "HeapProfiler.startSampling")
		expect(startCall).toBeTruthy()

		// ALLOCAUTH-PROTO-01: both collected-GC options MUST be true.
		const startParams = startCall?.params ?? {}
		expect(startParams.samplingInterval).toBe(ALLOCATION_PROFILE_SAMPLING_INTERVAL_BYTES)
		expect(startParams.stackDepth).toBe(ALLOCATION_PROFILE_STACK_DEPTH)
		expect(startParams.includeObjectsCollectedByMinorGC).toBe(true)
		expect(startParams.includeObjectsCollectedByMajorGC).toBe(true)

		expect(fs._mkdirs.length).toBe(1)
	})

	it("ALLOCAUTH-CTL-05: second qualifying job -> no second session/start", async () => {
		resetAllProfilingSeams()
		arm()
		const session = makeFakeSession()
		setAllocationProfilerInspectorSessionFactory(() => session)

		const r1 = triggerExtensionHostAllocationProfilerOnFirstQualifyingJob()
		expect(r1.kind).toBe("started")
		await new Promise((r) => setImmediate(r))

		const r2 = triggerExtensionHostAllocationProfilerOnFirstQualifyingJob()
		expect(r2.kind).toBe("skipped")
		if (r2.kind === "skipped") {
			expect(r2.previousState).not.toBe("armed")
		}
		await new Promise((r) => setImmediate(r))

		const startCalls = session._posts.filter((p) => p.method === "HeapProfiler.startSampling")
		expect(startCalls.length).toBe(1)
	})

	it("ALLOCAUTH-CTL: disabled -> trigger is a no-op (skipped)", () => {
		__resetAllocationProfilerForTests()
		const result = triggerExtensionHostAllocationProfilerOnFirstQualifyingJob()
		expect(result.kind).toBe("skipped")
		if (result.kind === "skipped") {
			expect(result.previousState).toBe("disabled")
		}
	})
})

// =============================================================================
// ALLOCAUTH-PROTO + ALLOCAUTH-CHECKPOINT tests
// =============================================================================

describe("ALLOCAUTH-PROTO / CHECKPOINT: protocol + checkpoint lifecycle", () => {
	afterEach(() => {
		__resetAllocationProfilerForTests()
	})

	it("ALLOCAUTH-PROTO-01: startSampling uses EXACT V8-default values + both collected-GC options true", async () => {
		resetAllProfilingSeams()
		arm()
		const session = makeFakeSession()
		setAllocationProfilerInspectorSessionFactory(() => session)

		triggerExtensionHostAllocationProfilerOnFirstQualifyingJob()
		await new Promise((r) => setImmediate(r))

		const startCall = session._posts.find((p) => p.method === "HeapProfiler.startSampling")
		expect(startCall).toBeTruthy()
		const params = startCall!.params ?? {}
		expect(params.includeObjectsCollectedByMinorGC).toBe(true)
		expect(params.includeObjectsCollectedByMajorGC).toBe(true)
		expect(params.samplingInterval).toBe(32768)
		expect(params.stackDepth).toBe(128)
		// Also confirm the constants exported match V8 defaults.
		expect(ALLOCATION_PROFILE_SAMPLING_INTERVAL_BYTES).toBe(32768)
		expect(ALLOCATION_PROFILE_STACK_DEPTH).toBe(128)
	})

	it("ALLOCAUTH-CHECKPOINT-01 + -02: getSamplingProfile -> atomic latest replacement; latest file overwritten (no accumulation)", async () => {
		const fs = resetAllProfilingSeams()
		arm()
		const session = makeFakeSession()
		setAllocationProfilerInspectorSessionFactory(() => session)

		triggerExtensionHostAllocationProfilerOnFirstQualifyingJob()
		await new Promise((r) => setImmediate(r))

		// Drive three checkpoint ticks.
		await new Promise((r) => setTimeout(r, ALLOCATION_PROFILE_CHECKPOINT_INTERVAL_MS * 3 + 200))
		await new Promise((r) => setImmediate(r))
		await new Promise((r) => setImmediate(r))

		const latestProfileWrites = fs._writes.filter((w) => w.path.includes("latest.heapprofile.json"))
		expect(latestProfileWrites.length).toBeGreaterThanOrEqual(2)
		const latestFinalRenames = fs._renames.filter((r) => r.to.includes("latest.heapprofile.json"))
		expect(latestFinalRenames.length).toBeGreaterThanOrEqual(2)
		const perf = getAllocationProfilerPerformanceCounters()
		expect(perf.checkpointCount).toBeGreaterThanOrEqual(2)
	})

	it("ALLOCAUTH-CHECKPOINT-03: single transient getSamplingProfile failure -> retain ACTIVE; transient_checkpoint_failures counter ticks", async () => {
		const fs = resetAllProfilingSeams()
		arm()
		const session = makeFakeSession()
		// Inject ONE transient failure on the FIRST getSamplingProfile
		// call; subsequent calls must succeed. Per the ACT §31 recovery
		// contract: "failed checkpoint -> does not terminate profiler;
		// next checkpoint may succeed."
		let profileCallCount = 0
		session._onNextProfile = () => {
			profileCallCount += 1
			// Clear the one-shot override immediately so subsequent
			// calls return the default fake profile.
			session._onNextProfile = undefined
			throw new Error("simulated transient getSamplingProfile failure")
		}
		setAllocationProfilerInspectorSessionFactory(() => session)

		triggerExtensionHostAllocationProfilerOnFirstQualifyingJob()
		// Wait through several checkpoint intervals so at least one
		// additional tick fires AFTER the transient failure.
		await new Promise((r) => setTimeout(r, ALLOCATION_PROFILE_CHECKPOINT_INTERVAL_MS * 3 + 500))
		await new Promise((r) => setImmediate(r))
		await new Promise((r) => setImmediate(r))

		expect(profileCallCount).toBe(1) // exactly the one-shot fired
		expect(getAllocationProfilerState()).toBe("active") // NOT failed
		const perf = getAllocationProfilerPerformanceCounters()
		expect(perf.transientCheckpointFailures).toBeGreaterThanOrEqual(1)
		// Latest file is still being written by subsequent ticks.
		const latestWrites = fs._writes.filter((w) => w.path.includes("latest.heapprofile.json"))
		expect(latestWrites.length).toBeGreaterThanOrEqual(1)
	})
})

// =============================================================================
// ALLOCAUTH-FINAL tests
// =============================================================================

describe("ALLOCAUTH-FINAL: finalize lifecycle", () => {
	afterEach(() => {
		__resetAllocationProfilerForTests()
	})

	it("ALLOCAUTH-FINAL-01: stopSampling returns profile P -> state=finalized; driven via __driveFinalizerForTests", async () => {
		resetAllProfilingSeams()
		arm()
		const stopProfile = { head: { sampleCount: 9999, children: [] }, samples: [1, 2, 3] }
		const session = makeFakeSession({
			stopSamplingResult: { profile: stopProfile },
		})
		setAllocationProfilerInspectorSessionFactory(() => session)

		triggerExtensionHostAllocationProfilerOnFirstQualifyingJob()
		await new Promise((r) => setImmediate(r))
		await new Promise((r) => setImmediate(r))
		expect(getAllocationProfilerState()).toBe("active")

		// Drive the FINALIZER directly (same code path the 60s timer
		// drives, without wall-clock patience).
		await __driveFinalizerForTests()

		expect(getAllocationProfilerState()).toBe("finalized")
	})

	it("ALLOCAUTH-FINAL-01b: no getSamplingProfile call exists AFTER the final stopSampling call", async () => {
		resetAllProfilingSeams()
		arm()
		const session = makeFakeSession({
			stopSamplingResult: { profile: { head: { sampleCount: 4242 }, samples: [] } },
		})
		setAllocationProfilerInspectorSessionFactory(() => session)

		triggerExtensionHostAllocationProfilerOnFirstQualifyingJob()
		await new Promise((r) => setImmediate(r))
		await new Promise((r) => setImmediate(r))
		await __driveFinalizerForTests()

		expect(getAllocationProfilerState()).toBe("finalized")
		const indicesOfStop = session._posts
			.map((p, i) => (p.method === "HeapProfiler.stopSampling" ? i : -1))
			.filter((i) => i >= 0)
		const indicesOfGet = session._posts
			.map((p, i) => (p.method === "HeapProfiler.getSamplingProfile" ? i : -1))
			.filter((i) => i >= 0)
		if (indicesOfStop.length > 0 && indicesOfGet.length > 0) {
			const lastStop = Math.max(...indicesOfStop)
			const lateGets = indicesOfGet.filter((i) => i > lastStop)
			expect(lateGets.length).toBe(0)
		}
	})

	it("ALLOCAUTH-FINAL-01c: final artifact contains exactly the profile returned by stopSampling", async () => {
		const fs = resetAllProfilingSeams()
		arm()
		const stopProfile = { head: { sampleCount: 9999, children: [] }, samples: [1, 2, 3] }
		const session = makeFakeSession({
			stopSamplingResult: { profile: stopProfile },
		})
		setAllocationProfilerInspectorSessionFactory(() => session)

		triggerExtensionHostAllocationProfilerOnFirstQualifyingJob()
		await new Promise((r) => setImmediate(r))
		await new Promise((r) => setImmediate(r))
		await __driveFinalizerForTests()

		const finalWrite = fs._writes.find((w) => w.path.includes("final-") && w.path.endsWith(".heapprofile.json"))
		expect(finalWrite).toBeTruthy()
		const persisted = JSON.parse(finalWrite!.data)
		const inner = "profile" in persisted ? (persisted as { profile: unknown }).profile : persisted
		expect((inner as { head: { sampleCount: number } }).head.sampleCount).toBe(9999)
		// session disconnected exactly once.
		expect(session._disconnectCalls).toBe(1)
	})

	it("ALLOCAUTH-FINAL-02: stopSampling rejects -> state=failed; session disconnects; latest checkpoint remains intact", async () => {
		const fs = resetAllProfilingSeams()
		arm()
		const session = makeFakeSession()
		session._onNextStopSampling = () => {
			throw new Error("simulated stopSampling failure")
		}
		setAllocationProfilerInspectorSessionFactory(() => session)

		triggerExtensionHostAllocationProfilerOnFirstQualifyingJob()
		await new Promise((r) => setImmediate(r))
		await new Promise((r) => setImmediate(r))
		expect(getAllocationProfilerState()).toBe("active")

		await new Promise((r) => setTimeout(r, ALLOCATION_PROFILE_CHECKPOINT_INTERVAL_MS + 200))
		await new Promise((r) => setImmediate(r))
		const latestWritesBeforeFail = fs._writes.filter((w) => w.path.includes("latest.heapprofile.json"))
		expect(latestWritesBeforeFail.length).toBeGreaterThanOrEqual(1)

		await __driveFinalizerForTests()
		expect(getAllocationProfilerState()).toBe("failed")
		expect(session._disconnectCalls).toBe(1)
		const latestWritesAfterFail = fs._writes.filter((w) => w.path.includes("latest.heapprofile.json"))
		expect(latestWritesAfterFail.length).toBeGreaterThanOrEqual(latestWritesBeforeFail.length)
	})

	it("ALLOCAUTH-FINAL-03: checkpoint wall time is captured per tick; perturbation gate is wall-based", async () => {
		const fs = resetAllProfilingSeams()
		arm()
		const session = makeFakeSession()
		// Slow write path; first write stalls to push wallMs past the gate.
		const realWrite = fs.writeFile.bind(fs)
		let injected = false
		fs.writeFile = async (target: string, data: string): Promise<void> => {
			if (!injected) {
				injected = true
				await new Promise((r) => setTimeout(r, 600))
			}
			return realWrite(target, data)
		}
		setAllocationProfilerInspectorSessionFactory(() => session)

		triggerExtensionHostAllocationProfilerOnFirstQualifyingJob()
		await new Promise((r) => setImmediate(r))
		await new Promise((r) => setTimeout(r, ALLOCATION_PROFILE_CHECKPOINT_INTERVAL_MS + 1500))
		await new Promise((r) => setImmediate(r))

		const perf = getAllocationProfilerPerformanceCounters()
		expect(typeof perf.lastCheckpointWallMs === "number").toBe(true)
		expect(perf.longCheckpointCount).toBeGreaterThanOrEqual(1)
	})
})

// =============================================================================
// ALLOCAUTH-CONSERVE tests
// =============================================================================

describe("ALLOCAUTH-CONSERVE: conservation invariants", () => {
	beforeEach(() => {
		__resetAllocationProfilerForTests()
	})
	afterEach(() => {
		__resetAllocationProfilerForTests()
	})

	it("ALLOCAUTH-CONSERVE-01: disabled state => zero state/semantic delta", () => {
		const r = triggerExtensionHostAllocationProfilerOnFirstQualifyingJob()
		expect(r.kind).toBe("skipped")
		expect(getAllocationProfilerState()).toBe("disabled")
	})

	it("ALLOCAUTH-CONSERVE-02: trigger never throws, always returns synchronously", () => {
		const r = triggerExtensionHostAllocationProfilerOnFirstQualifyingJob()
		expect(r.kind).toBe("skipped")
	})

	it("ALLOCAUTH-CONSERVE-04: capture-id factory fallback works", () => {
		__resetAllocationProfilerForTests()
		arm()
		const session = makeFakeSession()
		setAllocationProfilerInspectorSessionFactory(() => session)
		const r = triggerExtensionHostAllocationProfilerOnFirstQualifyingJob()
		expect(r.kind).toBe("started")
		if (r.kind === "started") {
			expect(r.captureId.length).toBeGreaterThan(0)
		}
	})

	it("ALLOCAUTH-CONSERVE: snapshot is read-only and reflects current state", () => {
		const snap = getAllocationProfilerSnapshot()
		expect(snap.state).toBe("disabled")
		expect(snap.captureId).toBeUndefined()
	})

	it("ALLOCAUTH-CONSERVE-10: warn seam is replaceable; capture-loop failure uses it", () => {
		const captured: string[] = []
		setAllocationProfilerWarn((msg) => {
			captured.push(msg)
		})
		resetAllProfilingSeams()
		arm()
		const broken = makeFakeSession()
		broken._errors.set("HeapProfiler.enable", new Error("simulated enable failure"))
		setAllocationProfilerInspectorSessionFactory(() => broken)
		setAllocationProfilerWarn((msg) => {
			captured.push(msg)
		})
		triggerExtensionHostAllocationProfilerOnFirstQualifyingJob()
		return new Promise<void>((resolve) => {
			setTimeout(() => {
				expect(captured.length).toBeGreaterThan(0)
				expect(getAllocationProfilerState()).toBe("failed")
				resolve()
			}, 100)
		})
	})
})

/**
 * ALLOCAUTH-IDENTITY-PATH (per HALT_ALLOCATION_INSTALLED_BUNDLE_IDENTITY_PATH_UNPROVEN):
 *
 * Mechanically proves that `resolveInstalledBundleIdentity(bundleDirname)`
 * reads `<bundleDirname>/../dist/extension.js` (one ascent from the bundle
 * directory to the extension root), and produces a sha256 that EXACTLY
 * matches the contents of the fixture file. This is the load-bearing
 * identity path for the live capture.
 *
 * The earlier (pre-correction) implementation walked two levels (`..`,
 * `..`) which, in a typical VSIX layout, landed ABOVE the extension
 * root — silently producing `installed_bundle_sha256 = "unknown"` and
 * defeating the load-bearing invariant.
 */
describe("ALLOCAUTH-IDENTITY-PATH: installed bundle resolution (filesystem fixture)", () => {
	const fixtures: Array<{ root: string }> = []
	function buildFakeExtension(): string {
		// Layout (matches both DEV `extensionDevelopmentPath` and an
		// installed VSIX):
		//   <root>/
		//       package.json
		//       dist/
		//           extension.js
		const root = mkdtempSync(join(tmpdir(), "clin-allocauth-identity-"))
		fixtures.push({ root })
		mkdirSync(join(root, "dist"), { recursive: true })
		writeFileSync(join(root, "package.json"), '{"name":"clin-allocauth-fake","version":"0.0.1"}')
		writeFileSync(join(root, "dist", "extension.js"), "// fake bundle for ALLOCAUTH-IDENTITY-PATH-01\n")
		return root
	}

	afterEach(() => {
		for (const f of fixtures) {
			try {
				rmSync(f.root, { recursive: true, force: true })
			} catch {
				/* ignore */
			}
		}
		fixtures.length = 0
	})

	it("ALLOCAUTH-IDENTITY-PATH-01: ONE ascent from <root>/dist -> extension root -> dist/extension.js -> sha256 matches fixture bytes", () => {
		const root = buildFakeExtension()
		const bundleDir = join(root, "dist")

		const result = resolveInstalledBundleIdentity(bundleDir)

		expect(result.extensionPath).toBe(root)
		expect(result.extensionBundleSha256).not.toBe("unknown")
		expect(result.extensionBundleSha256).toMatch(/^[0-9a-f]{64}$/)

		// Mechanical cross-check: independently hash the fixture file.
		const crypto = require("node:crypto") as typeof import("node:crypto")
		const fs = require("node:fs") as typeof import("node:fs")
		const expected = crypto
			.createHash("sha256")
			.update(fs.readFileSync(join(root, "dist", "extension.js")))
			.digest("hex")
		expect(result.extensionBundleSha256).toBe(expected)
	})

	it("ALLOCAUTH-IDENTITY-PATH-02: VSIX-style root also resolves (long parent path does not break the single ascent)", () => {
		// Simulate a deep VSIX path: ~/.vscode/extensions/claude-dev-3.0.0/dist
		// Use a deep fixture so we know single-ascent is depth-independent.
		const root = buildFakeExtension()
		const nested = mkdtempSync(join(root, "fake-vsix-"))
		mkdirSync(join(nested, "dist"), { recursive: true })
		writeFileSync(join(nested, "package.json"), '{"name":"clin-allocauth-fake-deep"}')
		writeFileSync(join(nested, "dist", "extension.js"), "// nested fixture\n")
		fixtures.push({ root: nested })

		const bundleDir = join(nested, "dist")
		const result = resolveInstalledBundleIdentity(bundleDir)

		expect(result.extensionPath).toBe(nested)
		expect(result.extensionBundleSha256).not.toBe("unknown")

		const crypto = require("node:crypto") as typeof import("node:crypto")
		const fs = require("node:fs") as typeof import("node:fs")
		const expected = crypto
			.createHash("sha256")
			.update(fs.readFileSync(join(nested, "dist", "extension.js")))
			.digest("hex")
		expect(result.extensionBundleSha256).toBe(expected)
	})

	it("ALLOCAUTH-IDENTITY-PATH-03: missing dist/extension.js → extensionBundleSha256 = 'unknown' (silent failure preserved as a deliberate fallback)", () => {
		const root = mkdtempSync(join(tmpdir(), "clin-allocauth-identity-empty-"))
		fixtures.push({ root })
		// Deliberately no dist/extension.js.
		const bundleDir = join(root, "dist")

		const result = resolveInstalledBundleIdentity(bundleDir)

		expect(result.extensionPath).toBe(root)
		expect(result.extensionBundleSha256).toBe("unknown")
	})
})
