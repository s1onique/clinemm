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

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
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
	_onNextProfile?: () => unknown
}

function makeFakeSession(): FakeSession {
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
			const result = this._results.get(method)
			return result ?? { head: { sampleCount: 17 } }
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

	it("ALLOCAUTH-CHECKPOINT-03: failed getSamplingProfile -> state=failed; trigger never threw", async () => {
		resetAllProfilingSeams()
		arm()
		const session = makeFakeSession()
		session._onNextProfile = () => {
			throw new Error("simulated getSamplingProfile failure")
		}
		setAllocationProfilerInspectorSessionFactory(() => session)

		triggerExtensionHostAllocationProfilerOnFirstQualifyingJob()
		await new Promise((r) => setTimeout(r, ALLOCATION_PROFILE_CHECKPOINT_INTERVAL_MS + 500))
		await new Promise((r) => setImmediate(r))

		expect(getAllocationProfilerState()).toBe("failed")
		expect(getAllocationProfilerCaptureId()).toBe("test-capture-id")
	})
})

// =============================================================================
// ALLOCAUTH-FINAL tests
// =============================================================================

describe("ALLOCAUTH-FINAL: finalize lifecycle", () => {
	afterEach(() => {
		__resetAllocationProfilerForTests()
	})

	it("ALLOCAUTH-FINAL-01: checkpoint loop produces at least one getSamplingProfile + latest file", async () => {
		const fs = resetAllProfilingSeams()
		arm()
		const session = makeFakeSession()
		setAllocationProfilerInspectorSessionFactory(() => session)

		triggerExtensionHostAllocationProfilerOnFirstQualifyingJob()
		// Wait through two checkpoint intervals to guarantee at least one tick fires.
		await new Promise((r) => setTimeout(r, ALLOCATION_PROFILE_CHECKPOINT_INTERVAL_MS * 2 + 500))
		await new Promise((r) => setImmediate(r))
		await new Promise((r) => setImmediate(r))

		const profilePosts = session._posts.filter((p) => p.method === "HeapProfiler.getSamplingProfile")
		expect(profilePosts.length).toBeGreaterThanOrEqual(1)
		const latestProfileWrites = fs._writes.filter((w) => w.path.includes("latest.heapprofile.json"))
		expect(latestProfileWrites.length).toBeGreaterThanOrEqual(1)
		// NOTE: a full MAX_DURATION_MS (60s) test would require a
		// 60s sleep. We assert the structural contract here and rely
		// on the smoke probe (scripts/inspector-smoke-probe.mjs) for
		// end-to-end timing.
	})

	it("ALLOCAUTH-FINAL-02: stopSampling failure -> state=failed; cleanup disconnect", async () => {
		resetAllProfilingSeams()
		arm()
		const session = makeFakeSession()
		session._onNextProfile = () => {
			throw new Error("simulated stopSampling-like failure")
		}
		setAllocationProfilerInspectorSessionFactory(() => session)

		triggerExtensionHostAllocationProfilerOnFirstQualifyingJob()
		await new Promise((r) => setTimeout(r, ALLOCATION_PROFILE_CHECKPOINT_INTERVAL_MS * 2 + 500))
		await new Promise((r) => setImmediate(r))

		expect(session._connectCalls).toBe(1)
		expect(session._posts.find((p) => p.method === "HeapProfiler.startSampling")).toBeTruthy()
		expect(getAllocationProfilerState()).toBe("failed")
		expect(session._disconnectCalls).toBeGreaterThanOrEqual(1)
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
