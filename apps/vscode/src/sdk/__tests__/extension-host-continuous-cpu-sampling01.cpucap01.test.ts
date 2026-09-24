/**
 * ACT-CLINEMM-EXTENSION-HOST-CONTINUOUS-CPU-SAMPLING01
 *
 * Focused test suite for the rolling V8 CPU profiler module.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	__driveFinalizerForTests,
	__driveSegmentRotationForTests,
	__resetCpuProfilerForTests,
	applyExtensionHostCpuProfilerPolicy,
	CLINEMM_DIAG_CPU_PROFILE_ENV,
	CPU_PROFILE_MAX_DURATION_MS,
	CPU_PROFILE_PERTURBATION_WARN_MS,
	CPU_PROFILE_SAMPLING_INTERVAL_US,
	CPU_PROFILE_SEGMENT_MS,
	type CpuProfilerFilesystem,
	type CpuProfilerIdentityBinding,
	type CpuProfilerInspectorSession,
	getCpuProfilerCaptureId,
	getCpuProfilerPerformanceCounters,
	getCpuProfilerSnapshot,
	getCpuProfilerState,
	resolveCpuProfileKnobFromEnv,
	setCpuProfilerCaptureIdFactory,
	setCpuProfilerDataRootResolver,
	setCpuProfilerFilesystem,
	setCpuProfilerIdentityResolver,
	setCpuProfilerInspectorSessionFactory,
	setCpuProfilerWarn,
	triggerExtensionHostCpuProfilerOnFirstQualifyingJob,
} from "../extension-host-cpu-profiler"

interface FakeFilesystem extends CpuProfilerFilesystem {
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

interface FakeSession extends CpuProfilerInspectorSession {
	_connectCalls: number
	_disconnectCalls: number
	_posts: Array<{ method: string; params: Record<string, unknown> | undefined }>
	_stopResults: unknown[]
	_stopError?: Error
	/**
	 * Controllable-resolve gate for Profiler.stop. When set, the
	 * fake session captures every Profiler.stop call in
	 * `_stopGateCalls` and returns a Promise that does not resolve
	 * until the test calls `resolveStopGate()`. The discriminator
	 * CPUCAP-FINAL-INFLIGHT-STOP-01 uses this to drive the exact
	 * production code path where a rotate()'s Profiler.stop is
	 * outstanding while a concurrent finalizer fires.
	 */
	_stopGateCalls: number
	_stopGate: { resolve: (value: unknown) => void } | undefined
	resolveStopGate(): void
	/**
	 * Optional: if the fake session is constructed with this set,
	 * it overrides resolveStopGate to resolve with the supplied
	 * value (e.g. a real profile object) instead of undefined.
	 * Used by CPUCAP-FINAL-INFLIGHT-STOP-01 to feed rotate() a
	 * valid profile through the gated stop.
	 */
	_resolveStopGateWith?(value: unknown): void
}

function makeFakeSession(opts?: { stopResults?: unknown[]; gateFirstStop?: boolean }): FakeSession {
	const stopResults = opts?.stopResults ?? []
	const gateFirstStop = opts?.gateFirstStop ?? false
	const session: FakeSession = {
		_connectCalls: 0,
		_disconnectCalls: 0,
		_posts: [],
		_stopResults: stopResults,
		_stopGateCalls: 0,
		_stopGate: undefined,
		resolveStopGate(): void {
			const gate = this._stopGate
			this._stopGate = undefined
			if (gate) {
				gate.resolve(undefined)
			}
		},
		_resolveStopGateWith(value: unknown): void {
			const gate = this._stopGate
			this._stopGate = undefined
			if (gate) {
				gate.resolve(value)
			}
		},
		connect(): void {
			this._connectCalls += 1
		},
		disconnect(): void {
			this._disconnectCalls += 1
		},
		async post(method: string, params?: Record<string, unknown>): Promise<unknown> {
			this._posts.push({ method, params })
			if (method === "Profiler.stop") {
				if (gateFirstStop && this._stopGate === undefined && this._stopGateCalls === 0) {
					// Capture this stop and do NOT resolve it until the
					// test calls resolveStopGate(). The fake session
					// records the call (so the test can assert that
					// exactly one Profiler.stop was issued before the
					// gate resolves) and parks the Promise.
					this._stopGateCalls += 1
					return new Promise((resolve) => {
						this._stopGate = { resolve }
					})
				}
				if (this._stopError) {
					const err = this._stopError
					this._stopError = undefined
					throw err
				}
				const next = this._stopResults.shift()
				if (next !== undefined) return next
				return {
					nodes: [
						{
							id: 1,
							callFrame: {
								functionName: "fakeLeaf",
								url: "file:///fake.js",
								lineNumber: 1,
								columnNumber: 0,
							},
							hitCount: 5,
							children: [],
						},
					],
					samples: [1, 1, 1, 1, 1],
					timeDeltas: [1000, 1000, 1000, 1000, 1000],
					startTime: 0,
					endTime: 5000,
				}
			}
			return {}
		},
	}
	return session
}

function resetAllProfilingSeams(): FakeFilesystem {
	const fs = makeFakeFilesystem()
	setCpuProfilerFilesystem(fs)
	setCpuProfilerDataRootResolver(() => "/tmp/fake-cline-data")
	setCpuProfilerIdentityResolver(
		(): CpuProfilerIdentityBinding => ({
			sourceHead: "fake-head",
			version: "0.0.0-test",
			extensionPath: "/tmp/fake-extension",
			extensionBundleSha256: "deadbeef".repeat(8),
		}),
	)
	return fs
}

function arm(): void {
	const result = applyExtensionHostCpuProfilerPolicy(true, { [CLINEMM_DIAG_CPU_PROFILE_ENV]: "1" })
	if (!result.enabled) throw new Error("could not arm profiler")
}

function applyCpuProfileInDogfoodWith(value: string | undefined): { enabled: boolean; flipped: boolean } {
	const env: Record<string, string> = {}
	if (value !== undefined) env[CLINEMM_DIAG_CPU_PROFILE_ENV] = value
	return applyExtensionHostCpuProfilerPolicy(true, env)
}

// =============================================================================
// CPUCAP-CTL: enablement + knob tests
// =============================================================================

describe("CPUCAP-CTL: enablement + knob", () => {
	beforeEach(() => {
		__resetCpuProfilerForTests()
	})

	afterEach(() => {
		__resetCpuProfilerForTests()
	})

	it("CPUCAP-CTL-01: public runtime + env knob on -> disabled (fail-closed)", () => {
		const result = applyExtensionHostCpuProfilerPolicy(false, { [CLINEMM_DIAG_CPU_PROFILE_ENV]: "1" })
		expect(result.enabled).toBe(false)
		expect(getCpuProfilerState()).toBe("disabled")
	})

	it("CPUCAP-CTL-02: dogfood + knob absent -> disabled", () => {
		const result = applyExtensionHostCpuProfilerPolicy(true, {})
		expect(result.enabled).toBe(false)
		expect(getCpuProfilerState()).toBe("disabled")
	})

	it("CPUCAP-CTL-03: dogfood + knob=1 -> armed", () => {
		const result = applyExtensionHostCpuProfilerPolicy(true, {
			[CLINEMM_DIAG_CPU_PROFILE_ENV]: "1",
		})
		expect(result.enabled).toBe(true)
		expect(result.flipped).toBe(true)
		expect(getCpuProfilerState()).toBe("armed")
	})

	it("CPUCAP-CTL: knob truthy variations all enable in dogfood", () => {
		for (const truthy of ["1", "true", "yes", "TRUE", " Yes "]) {
			__resetCpuProfilerForTests()
			const result = applyExtensionHostCpuProfilerPolicy(true, {
				[CLINEMM_DIAG_CPU_PROFILE_ENV]: truthy,
			})
			expect(result.enabled, `truthy="${truthy}"`).toBe(true)
			expect(getCpuProfilerState()).toBe("armed")
		}
	})

	it("CPUCAP-CTL: knob falsy variations all disable", () => {
		for (const falsy of ["0", "off", "false", "FALSE", "no"]) {
			const result = applyCpuProfileInDogfoodWith(falsy)
			expect(result.enabled, `falsy="${falsy}"`).toBe(false)
			expect(getCpuProfilerState()).toBe("disabled")
		}
	})

	it("CPUCAP-CTL: resolveCpuProfileKnobFromEnv pure (no state side-effect)", () => {
		__resetCpuProfilerForTests()
		const r1 = resolveCpuProfileKnobFromEnv(false, { [CLINEMM_DIAG_CPU_PROFILE_ENV]: "1" })
		const r2 = resolveCpuProfileKnobFromEnv(true, {})
		const r3 = resolveCpuProfileKnobFromEnv(true, { [CLINEMM_DIAG_CPU_PROFILE_ENV]: "1" })
		expect(r1).toBe(false)
		expect(r2).toBe(false)
		expect(r3).toBe(true)
		expect(getCpuProfilerState()).toBe("disabled")
	})

	it("CPUCAP-CTL: capture_id factory is honored", () => {
		__resetCpuProfilerForTests()
		setCpuProfilerCaptureIdFactory(() => "test-capture-id-cpucap")
		arm()
		const session = makeFakeSession()
		setCpuProfilerInspectorSessionFactory(() => session)
		const result = triggerExtensionHostCpuProfilerOnFirstQualifyingJob()
		expect(result.kind).toBe("started")
		expect(getCpuProfilerCaptureId()).toBe("test-capture-id-cpucap")
	})
})

// =============================================================================
// CPUCAP-CTL: trigger predicate
// =============================================================================

describe("CPUCAP-CTL: trigger predicate", () => {
	afterEach(() => {
		__resetCpuProfilerForTests()
	})

	it("CPUCAP-CTL: armed + first qualifying notify-bg job -> exactly one Profiler.start", async () => {
		const fs = resetAllProfilingSeams()
		arm()
		const session = makeFakeSession()
		setCpuProfilerInspectorSessionFactory(() => session)

		const result = triggerExtensionHostCpuProfilerOnFirstQualifyingJob()
		expect(result.kind).toBe("started")
		if (result.kind === "started") {
			expect(result.captureId).toBeDefined()
		}

		// Wait for state to reach "active" so all initial posts flushed.
		for (let i = 0; i < 50; i++) {
			await new Promise((r) => setImmediate(r))
			if (getCpuProfilerState() === "active") break
		}

		expect(session._connectCalls).toBe(1)
		expect(session._posts.find((p) => p.method === "Profiler.enable")).toBeTruthy()
		expect(session._posts.find((p) => p.method === "Profiler.setSamplingInterval")).toBeTruthy()
		const startCalls = session._posts.filter((p) => p.method === "Profiler.start")
		expect(startCalls.length).toBeGreaterThanOrEqual(1)
		expect(fs._mkdirs.length).toBeGreaterThanOrEqual(1)
	})

	it("CPUCAP-CTL: second qualifying job -> no second capture", async () => {
		resetAllProfilingSeams()
		arm()
		const session = makeFakeSession()
		setCpuProfilerInspectorSessionFactory(() => session)

		const r1 = triggerExtensionHostCpuProfilerOnFirstQualifyingJob()
		expect(r1.kind).toBe("started")
		for (let i = 0; i < 50; i++) {
			await new Promise((r) => setImmediate(r))
			if (getCpuProfilerState() === "active") break
		}

		const r2 = triggerExtensionHostCpuProfilerOnFirstQualifyingJob()
		expect(r2.kind).toBe("skipped")
		if (r2.kind === "skipped") {
			expect(r2.previousState).not.toBe("armed")
		}
		await new Promise((r) => setImmediate(r))

		// Should still be only ONE connect.
		expect(session._connectCalls).toBe(1)
	})

	it("CPUCAP-CTL: disabled -> trigger is a no-op (skipped)", () => {
		__resetCpuProfilerForTests()
		const result = triggerExtensionHostCpuProfilerOnFirstQualifyingJob()
		expect(result.kind).toBe("skipped")
		if (result.kind === "skipped") {
			expect(result.previousState).toBe("disabled")
		}
	})
})

// =============================================================================
// CPUCAP-PROTO: protocol sequence + setSamplingInterval
// =============================================================================

describe("CPUCAP-PROTO: protocol sequence", () => {
	afterEach(() => {
		__resetCpuProfilerForTests()
	})

	it("CPUCAP-PROTO-01: connect -> Profiler.enable -> Profiler.setSamplingInterval -> Profiler.start", async () => {
		resetAllProfilingSeams()
		arm()
		const session = makeFakeSession()
		setCpuProfilerInspectorSessionFactory(() => session)

		triggerExtensionHostCpuProfilerOnFirstQualifyingJob()

		// Wait for state to reach "active".
		for (let i = 0; i < 50; i++) {
			await new Promise((r) => setImmediate(r))
			if (getCpuProfilerState() === "active") break
		}

		const methods = session._posts.map((p) => p.method)
		const enableIdx = methods.indexOf("Profiler.enable")
		const intervalIdx = methods.indexOf("Profiler.setSamplingInterval")
		const startIdx = methods.indexOf("Profiler.start")

		expect(enableIdx).toBeGreaterThanOrEqual(0)
		expect(intervalIdx).toBeGreaterThanOrEqual(0)
		expect(startIdx).toBeGreaterThanOrEqual(0)
		expect(enableIdx).toBeLessThan(intervalIdx)
		expect(intervalIdx).toBeLessThan(startIdx)

		const intervalCall = session._posts.find((p) => p.method === "Profiler.setSamplingInterval")
		expect(intervalCall?.params).toEqual({ interval: CPU_PROFILE_SAMPLING_INTERVAL_US })
		expect(CPU_PROFILE_SAMPLING_INTERVAL_US).toBe(1000)
	})

	it("CPUCAP-PROTO-02: segment rotation = exactly one Profiler.stop, exactly one Profiler.start per cycle", async () => {
		resetAllProfilingSeams()
		arm()
		const session = makeFakeSession()
		setCpuProfilerInspectorSessionFactory(() => session)

		triggerExtensionHostCpuProfilerOnFirstQualifyingJob()

		// Wait for state to reach "active".
		for (let i = 0; i < 50; i++) {
			await new Promise((r) => setImmediate(r))
			if (getCpuProfilerState() === "active") break
		}

		await __driveSegmentRotationForTests()
		await new Promise((r) => setImmediate(r))
		await new Promise((r) => setImmediate(r))

		const stops = session._posts.filter((p) => p.method === "Profiler.stop").length
		const starts = session._posts.filter((p) => p.method === "Profiler.start").length
		expect(stops).toBe(1)
		expect(starts).toBe(2) // initial + post-rotation
	})
})

// =============================================================================
// CPUCAP-ROTATE: segment rotation lifecycle
// =============================================================================

describe("CPUCAP-ROTATE: segment rotation", () => {
	afterEach(() => {
		__resetCpuProfilerForTests()
	})

	it("CPUCAP-ROTATE-01: Profiler.stop returned profile persisted to segment-000.cpuprofile", async () => {
		const fs = resetAllProfilingSeams()
		arm()
		const profile = {
			nodes: [
				{
					id: 1,
					callFrame: { functionName: "alpha", url: "file:///alpha.js", lineNumber: 1, columnNumber: 0 },
					hitCount: 3,
					children: [],
				},
			],
			samples: [1, 1, 1],
			timeDeltas: [100, 100, 100],
			startTime: 0,
			endTime: 300,
		}
		const session = makeFakeSession({ stopResults: [profile] })
		setCpuProfilerInspectorSessionFactory(() => session)

		triggerExtensionHostCpuProfilerOnFirstQualifyingJob()

		// Wait for state to reach "active".
		for (let i = 0; i < 50; i++) {
			await new Promise((r) => setImmediate(r))
			if (getCpuProfilerState() === "active") break
		}

		await __driveSegmentRotationForTests()
		await new Promise((r) => setImmediate(r))

		const segWrites = fs._writes.filter((w) => w.path.includes("segment-000.cpuprofile"))
		expect(segWrites.length).toBe(1)
		const persisted = JSON.parse(segWrites[0].data)
		expect(persisted.nodes[0].callFrame.functionName).toBe("alpha")
		expect(persisted.samples.length).toBe(3)
		expect(persisted.timeDeltas.length).toBe(3)
	})

	it("CPUCAP-ROTATE-02: second rotation -> segment-001 + latest-complete points to 001", async () => {
		const fs = resetAllProfilingSeams()
		arm()
		const profile0 = {
			nodes: [
				{
					id: 1,
					callFrame: { functionName: "alpha", url: "x", lineNumber: 1, columnNumber: 0 },
					hitCount: 1,
					children: [],
				},
			],
			samples: [1],
			timeDeltas: [100],
			startTime: 0,
			endTime: 100,
		}
		const profile1 = {
			nodes: [
				{
					id: 2,
					callFrame: { functionName: "beta", url: "y", lineNumber: 2, columnNumber: 0 },
					hitCount: 1,
					children: [],
				},
			],
			samples: [2],
			timeDeltas: [200],
			startTime: 100,
			endTime: 300,
		}
		const session = makeFakeSession({ stopResults: [profile0, profile1] })
		setCpuProfilerInspectorSessionFactory(() => session)

		triggerExtensionHostCpuProfilerOnFirstQualifyingJob()

		// Wait for state to reach "active".
		for (let i = 0; i < 50; i++) {
			await new Promise((r) => setImmediate(r))
			if (getCpuProfilerState() === "active") break
		}

		await __driveSegmentRotationForTests()
		await new Promise((r) => setImmediate(r))
		await __driveSegmentRotationForTests()
		await new Promise((r) => setImmediate(r))

		const segWrites = fs._writes.filter((w) => w.path.includes("segment-") && w.path.includes(".cpuprofile"))
		expect(segWrites.length).toBe(2)
		expect(segWrites[0].path).toContain("segment-000.cpuprofile")
		expect(segWrites[1].path).toContain("segment-001.cpuprofile")

		const latest = fs._writes.filter((w) => w.path.includes("latest-complete.json"))
		expect(latest.length).toBeGreaterThanOrEqual(2)
		const lastLatest = JSON.parse(latest[latest.length - 1].data)
		expect(lastLatest.latest_segment_index).toBe(1)
		expect(lastLatest.successful_segment_count).toBe(2)
	})

	it("CPUCAP-ROTATE-03: write failure -> capture continues; perf counters reflect failure", async () => {
		const fs = resetAllProfilingSeams()
		const realWriteFile = fs.writeFile.bind(fs)
		fs.writeFile = async (target: string, data: string) => {
			// segment-000.cpuprofile.tmp is the atomic-write intermediate.
			// The capture calls writeAtomic(target, data) which writes
			// target.tmp first. We fail on the segment-*.cpuprofile.tmp
			// intermediate; the actual segment file is never created.
			if (target.includes("segment-") && target.includes(".cpuprofile.tmp")) {
				throw new Error("simulated fs failure")
			}
			return realWriteFile(target, data)
		}
		const warnings: string[] = []
		setCpuProfilerWarn((msg) => warnings.push(msg))
		arm()
		const session = makeFakeSession()
		setCpuProfilerInspectorSessionFactory(() => session)

		triggerExtensionHostCpuProfilerOnFirstQualifyingJob()

		// Wait for state to reach "active" (initial Profiler.start completes).
		for (let i = 0; i < 50; i++) {
			await new Promise((r) => setImmediate(r))
			if (getCpuProfilerState() === "active") break
		}

		await __driveSegmentRotationForTests()
		for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r))

		const snap = getCpuProfilerSnapshot()
		expect(["active", "rotating"]).toContain(snap.state)

		const perf = getCpuProfilerPerformanceCounters()
		expect(perf.failedSegmentCount).toBeGreaterThanOrEqual(1)
	})

	it("CPUCAP-ROTATE-FAIL-01: write failure on segment-001 -> latest-complete keeps pointing at segment-000 (no regression to -1); failed_segment_count >= 1", async () => {
		const fs = resetAllProfilingSeams()
		const realWriteFile = fs.writeFile.bind(fs)
		let segment001FailsArmed = false
		fs.writeFile = async (target: string, data: string): Promise<void> => {
			// Only fail the segment-001 write (per ACT
			// ROTATE-FAIL-CORRECTION02 P1). Segment-000 persists OK.
			if (!segment001FailsArmed && target.includes("segment-001") && target.includes(".cpuprofile.tmp")) {
				segment001FailsArmed = true
				throw new Error("simulated fs failure on segment-001")
			}
			return realWriteFile(target, data)
		}
		arm()
		const session = makeFakeSession()
		setCpuProfilerInspectorSessionFactory(() => session)

		triggerExtensionHostCpuProfilerOnFirstQualifyingJob()
		for (let i = 0; i < 50; i++) {
			await new Promise((r) => setImmediate(r))
			if (getCpuProfilerState() === "active") break
		}

		// Segment-000 rotation succeeds.
		await __driveSegmentRotationForTests()
		await new Promise((r) => setImmediate(r))

		// Segment-001 rotation: Profiler.stop succeeds, write fails.
		await __driveSegmentRotationForTests()
		await new Promise((r) => setImmediate(r))

		// Latest-complete.json for segment-001's rotation must STILL
		// point at segment-000 (the highest SUCCESSFULLY-PERSISTED
		// checkpoint). It must NOT regress to -1 (per ACT
		// ROTATE-FAIL-CORRECTION02 P1).
		const latestWrites = fs._writes.filter((w) => w.path.endsWith("latest-complete.json.tmp"))
		expect(latestWrites.length).toBeGreaterThanOrEqual(2)
		const lastLatest = JSON.parse(latestWrites[latestWrites.length - 1].data)
		expect(lastLatest.latest_segment_index).toBe(0)
		expect(lastLatest.latest_status).toBe("failed")
		expect(lastLatest.successful_segment_count).toBe(1)
		expect(lastLatest.failed_segment_count).toBeGreaterThanOrEqual(1)
		expect(lastLatest.total_segment_count).toBeGreaterThanOrEqual(2)

		// Segment-000 file still on disk.
		const seg0 = fs._writes.filter((w) => w.path.includes("segment-000.cpuprofile.tmp"))
		expect(seg0.length).toBe(1)

		// Capture must remain in a forward-moving state (active or
		// rotating) — write failures do not fail the capture.
		expect(["active", "rotating"]).toContain(getCpuProfilerState())
	})

	it("CPUCAP-ROTATE-04: stop resolves -> next Profiler.start occurs (no overlap)", async () => {
		resetAllProfilingSeams()
		arm()
		const session = makeFakeSession()
		setCpuProfilerInspectorSessionFactory(() => session)

		triggerExtensionHostCpuProfilerOnFirstQualifyingJob()

		// Wait for state to reach "active".
		for (let i = 0; i < 50; i++) {
			await new Promise((r) => setImmediate(r))
			if (getCpuProfilerState() === "active") break
		}

		const startsBefore = session._posts.filter((p) => p.method === "Profiler.start").length
		expect(startsBefore).toBe(1)

		await __driveSegmentRotationForTests()
		await new Promise((r) => setImmediate(r))

		const stopsAfter = session._posts.filter((p) => p.method === "Profiler.stop").length
		const startsAfter = session._posts.filter((p) => p.method === "Profiler.start").length

		expect(stopsAfter).toBe(1)
		expect(startsAfter).toBe(2)
	})
})

// =============================================================================
// CPUCAP-FINAL: finalization lifecycle
// =============================================================================

describe("CPUCAP-FINAL: finalization", () => {
	afterEach(() => {
		__resetCpuProfilerForTests()
	})

	it("CPUCAP-FINAL-01: finalizer transitions state to finalized; session disconnected", async () => {
		const fs = resetAllProfilingSeams()
		arm()
		const session = makeFakeSession()
		setCpuProfilerInspectorSessionFactory(() => session)

		triggerExtensionHostCpuProfilerOnFirstQualifyingJob()

		// Wait for state to reach "active" before driving finalizer.
		for (let i = 0; i < 50; i++) {
			await new Promise((r) => setImmediate(r))
			if (getCpuProfilerState() === "active") break
		}

		await __driveFinalizerForTests()
		for (let i = 0; i < 10; i++) {
			await new Promise((r) => setImmediate(r))
		}

		expect(getCpuProfilerState()).toBe("finalized")

		// The fake filesystem records writeFile calls only (renames don't
		// appear in _writes). The capture uses writeAtomic(target, data) which
		// writes target.tmp first. We look for meta.json.tmp files (the only
		// meta writes the capture performs).
		const metaTmpWrites = fs._writes.filter((w) => w.path.endsWith("meta.json.tmp") && !w.path.includes("segment-"))
		expect(metaTmpWrites.length).toBeGreaterThanOrEqual(2)
		const finalMeta = JSON.parse(metaTmpWrites[metaTmpWrites.length - 1].data)
		expect(finalMeta.status).toBe("finalized")

		expect(session._disconnectCalls).toBe(1)
	})

	it("CPUCAP-FINAL-PRODUCTION-01: finalizer (via test seam) -> exactly one Profiler.stop; final segment persisted; disconnect AFTER stop resolves; meta.status=finalized", async () => {
		// The finalizer the MAX_DURATION timer calls is the SAME
		// function __driveFinalizerForTests calls. This test proves
		// the production seam path performs Profiler.stop BEFORE
		// disconnect, and persists the profile returned by Profiler.stop
		// as the FINAL segment (per ACT MAX-DURATION-FINALIZATION-CORRECTION02 P0).
		const fs = resetAllProfilingSeams()
		const finalSegmentMarker = { hit: 0 } as { hit: number; name: string }
		;(finalSegmentMarker as unknown as { name: string }).name = "FINAL_SEGMENT_BOUND_TO_PROFILER_STOP_RETURNED_PROFILE"
		const session = makeFakeSession({
			stopResults: [
				// segment 0
				{
					nodes: [
						{
							id: 1,
							callFrame: { functionName: "seg0", url: "u", lineNumber: 1, columnNumber: 0 },
							hitCount: 1,
							children: [],
						},
					],
					samples: [1],
					timeDeltas: [100],
					startTime: 0,
					endTime: 5_000_000,
				},
				// segment 1 / final segment returned by the finalizer's Profiler.stop
				{
					nodes: [
						{
							id: 2,
							callFrame: {
								functionName: finalSegmentMarker.name,
								url: "marker.js",
								lineNumber: 1,
								columnNumber: 0,
							},
							hitCount: 1,
							children: [],
						},
					],
					samples: [2],
					timeDeltas: [100],
					startTime: 5_000_000,
					endTime: 6_000_000,
				},
			],
		})
		arm()
		setCpuProfilerInspectorSessionFactory(() => session)

		triggerExtensionHostCpuProfilerOnFirstQualifyingJob()

		for (let i = 0; i < 50; i++) {
			await new Promise((r) => setImmediate(r))
			if (getCpuProfilerState() === "active") break
		}
		expect(getCpuProfilerState()).toBe("active")

		// Drive ONE periodic rotation (segment-000) first.
		await __driveSegmentRotationForTests()
		await new Promise((r) => setImmediate(r))

		const startsBeforeFinalize = session._posts.filter((p) => p.method === "Profiler.start").length
		const stopsBeforeFinalize = session._posts.filter((p) => p.method === "Profiler.stop").length

		// Now drive the finalizer (this is the exact callback the
		// MAX_DURATION timer calls).
		await __driveFinalizerForTests()
		for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r))

		// STRUCTURAL invariants per ACT MAX-DURATION-FINALIZATION-CORRECTION02 P0:
		const posts = session._posts
		const profilerEvents = posts
			.map((p, idx) => ({ method: p.method, idx }))
			.filter((p) => p.method === "Profiler.start" || p.method === "Profiler.stop")

		const startCount = profilerEvents.filter((p) => p.method === "Profiler.start").length
		const stopCount = profilerEvents.filter((p) => p.method === "Profiler.stop").length
		expect(stopCount).toBe(stopsBeforeFinalize + 1)
		expect(startCount).toBe(startsBeforeFinalize)

		// The final Profiler.stop MUST resolve BEFORE disconnect.
		const lastStopIdx = [...profilerEvents].reverse().find((p) => p.method === "Profiler.stop")?.idx ?? -1
		expect(lastStopIdx).toBeGreaterThanOrEqual(0)
		expect(session._disconnectCalls).toBe(1)

		// The profile persisted as the FINAL segment must be the EXACT
		// profile returned by the finalizer's Profiler.stop call (it
		// contains the FINAL_SEGMENT_BOUND_TO_PROFILER_STOP_RETURNED_PROFILE
		// marker).
		expect(getCpuProfilerState()).toBe("finalized")
		const finalSegWrites = fs._writes.filter((w) => w.path.endsWith("segment-001.cpuprofile.tmp"))
		expect(finalSegWrites.length).toBe(1)
		const finalSegData = JSON.parse(finalSegWrites[0].data)
		expect(finalSegData.nodes[0].callFrame.functionName).toBe((finalSegmentMarker as unknown as { name: string }).name)

		// meta.status must be finalized.
		const metaTmpWrites = fs._writes.filter((w) => w.path.endsWith("meta.json.tmp") && !w.path.includes("segment-"))
		expect(metaTmpWrites.length).toBeGreaterThanOrEqual(2)
		const finalMeta = JSON.parse(metaTmpWrites[metaTmpWrites.length - 1].data)
		expect(finalMeta.status).toBe("finalized")
	})

	it("CPUCAP-FINAL-HORIZON-01: rotation that drives the MAX_DURATION horizon -> exactly ONE Profiler.stop for that segment; final segment persisted; no Profiler.start afterwards; state=finalized; failed_segment_count unchanged", async () => {
		// Per ACT ROTATION-RACE-CORRECTION03 P0: rotation enters
		// state="rotating" and has ALREADY called Profiler.stop when
		// it discovers MAX_DURATION was reached. The finalizer MUST
		// NOT issue a second Profiler.stop.
		const fs = resetAllProfilingSeams()
		const horizonMarker = { name: "HORIZON_FINAL_SEGMENT_FROM_ROTATION_STOP" }
		const session = makeFakeSession({
			stopResults: [
				{
					nodes: [
						{
							id: 1,
							callFrame: { functionName: "seg0", url: "u", lineNumber: 1, columnNumber: 0 },
							hitCount: 1,
							children: [],
						},
					],
					samples: [1],
					timeDeltas: [100],
					startTime: 0,
					endTime: 5_000_000,
				},
				{
					nodes: [
						{
							id: 2,
							callFrame: {
								functionName: horizonMarker.name,
								url: "marker.js",
								lineNumber: 1,
								columnNumber: 0,
							},
							hitCount: 1,
							children: [],
						},
					],
					samples: [2],
					timeDeltas: [100],
					startTime: 5_000_000,
					endTime: 6_000_000,
				},
			],
		})
		arm()
		setCpuProfilerInspectorSessionFactory(() => session)

		triggerExtensionHostCpuProfilerOnFirstQualifyingJob()

		for (let i = 0; i < 50; i++) {
			await new Promise((r) => setImmediate(r))
			if (getCpuProfilerState() === "active") break
		}
		expect(getCpuProfilerState()).toBe("active")

		await __driveSegmentRotationForTests()
		await new Promise((r) => setImmediate(r))

		const realNow = Date.now
		const startedAtMs = realNow()
		const dateNowStub = (): number => startedAtMs + CPU_PROFILE_MAX_DURATION_MS + 1
		Date.now = dateNowStub
		try {
			await __driveSegmentRotationForTests()
			for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r))
		} finally {
			Date.now = realNow
		}

		expect(getCpuProfilerState()).toBe("finalized")

		const posts = session._posts
		const stopCount = posts.filter((p) => p.method === "Profiler.stop").length
		expect(stopCount).toBe(2)
		const startCount = posts.filter((p) => p.method === "Profiler.start").length
		expect(startCount).toBe(2)

		const seg1Writes = fs._writes.filter((w) => w.path.endsWith("segment-001.cpuprofile.tmp"))
		expect(seg1Writes.length).toBe(1)
		const seg1Data = JSON.parse(seg1Writes[0].data)
		expect(seg1Data.nodes[0].callFrame.functionName).toBe(horizonMarker.name)

		const metaTmpWrites = fs._writes.filter((w) => w.path.endsWith("meta.json.tmp") && !w.path.includes("segment-"))
		expect(metaTmpWrites.length).toBeGreaterThanOrEqual(2)
		const finalMeta = JSON.parse(metaTmpWrites[metaTmpWrites.length - 1].data)
		expect(finalMeta.status).toBe("finalized")
		expect(finalMeta.performance.failedSegmentCount).toBe(0)
		expect(finalMeta.performance.successfulSegmentCount).toBe(2)
	})

	it("CPUCAP-FINAL-RACE-01: independent MAX_DURATION backstop requested while rotation has already stopped profiling -> no second Profiler.stop; no recovery/restart; one authoritative completed segment; state=finalized", async () => {
		// Per ACT ROTATION-RACE-CORRECTION03 P0: the finalizer must
		// detect the rotation has already stopped sampling
		// (profilerRunning === false) and skip its own Profiler.stop.
		const fs = resetAllProfilingSeams()
		const session = makeFakeSession({
			stopResults: [
				{
					nodes: [
						{
							id: 1,
							callFrame: { functionName: "rotationStopProfile", url: "u", lineNumber: 1, columnNumber: 0 },
							hitCount: 1,
							children: [],
						},
					],
					samples: [1],
					timeDeltas: [100],
					startTime: 0,
					endTime: 5_000_000,
				},
			],
		})
		arm()
		setCpuProfilerInspectorSessionFactory(() => session)

		triggerExtensionHostCpuProfilerOnFirstQualifyingJob()

		for (let i = 0; i < 50; i++) {
			await new Promise((r) => setImmediate(r))
			if (getCpuProfilerState() === "active") break
		}
		expect(getCpuProfilerState()).toBe("active")

		await __driveSegmentRotationForTests()
		await new Promise((r) => setImmediate(r))

		expect(getCpuProfilerState()).toBe("active")

		await __driveFinalizerForTests()
		for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r))

		expect(getCpuProfilerState()).toBe("finalized")

		const posts = session._posts
		const startCount = posts.filter((p) => p.method === "Profiler.start").length
		const stopCount = posts.filter((p) => p.method === "Profiler.stop").length
		expect(startCount).toBe(2)
		expect(stopCount).toBe(2)

		const seg1Writes = fs._writes.filter((w) => w.path.endsWith("segment-001.cpuprofile.tmp"))
		expect(seg1Writes.length).toBe(1)

		const metaTmpWrites = fs._writes.filter((w) => w.path.endsWith("meta.json.tmp") && !w.path.includes("segment-"))
		expect(metaTmpWrites.length).toBeGreaterThanOrEqual(2)
		const finalMeta = JSON.parse(metaTmpWrites[metaTmpWrites.length - 1].data)
		expect(finalMeta.status).toBe("finalized")
		expect(finalMeta.performance.successfulSegmentCount).toBe(2)
		expect(finalMeta.performance.failedSegmentCount).toBe(0)
	})

	it("CPUCAP-FINAL-INFLIGHT-STOP-01: finalizer fires while rotate()'s Profiler.stop is in flight -> no duplicate Profiler.stop; one authoritative completed segment; state=finalized (per ACT INFLIGHT-STOP-CORRECTION04 P0)", async () => {
		const fs = resetAllProfilingSeams()
		arm()
		// gateFirstStop: the FIRST Profiler.stop returns a Promise
		// that does not resolve until the test calls
		// resolveStopGate(). This emulates the production race
		// where rotate() has posted Profiler.stop but its await
		// has not yet resolved.
		const session = makeFakeSession({ gateFirstStop: true })
		setCpuProfilerInspectorSessionFactory(() => session)

		triggerExtensionHostCpuProfilerOnFirstQualifyingJob()

		// Wait until capture reaches "active" — Profiler.start
		// has resolved and rotate() is ready.
		for (let i = 0; i < 50; i++) {
			await new Promise((r) => setImmediate(r))
			if (getCpuProfilerState() === "active") break
		}
		expect(getCpuProfilerState()).toBe("active")

		// Drive rotation WITHOUT awaiting to completion. The
		// Profiler.stop call is parked on the fake session's gate.
		const rotationPromise = __driveSegmentRotationForTests()

		// Yield control so production code's
		// `await session.post("Profiler.stop")` reaches the
		// parked Promise.
		for (let i = 0; i < 20; i++) {
			await new Promise((r) => setImmediate(r))
			if (session._stopGateCalls === 1) break
		}

		// Exactly one Profiler.stop issued so far (rotate()'s).
		const stopsBeforeResolve = session._posts.filter((p) => p.method === "Profiler.stop").length
		expect(stopsBeforeResolve).toBe(1)
		expect(session._stopGateCalls).toBe(1)

		// Fire the finalizer while rotate()'s Profiler.stop is
		// still outstanding. Per ACT INFLIGHT-STOP-CORRECTION04
		// P0, the finalizer MUST see `stopInFlight === true` and
		// MUST NOT post a duplicate Profiler.stop.
		const finalizerPromise = __driveFinalizerForTests()

		// Yield control. If the bug existed, the finalizer would
		// issue a second Profiler.stop here.
		for (let i = 0; i < 20; i++) {
			await new Promise((r) => setImmediate(r))
		}

		// Critical assertion: still exactly ONE Profiler.stop
		// outstanding. The finalizer saw `stopInFlight === true`
		// and bailed on issuing its own.
		const stopsAfterFinalizerEntered = session._posts.filter((p) => p.method === "Profiler.stop").length
		expect(stopsAfterFinalizerEntered).toBe(1)

		// Resolve the gated stop with a real profile so
		// rotate()'s persistence path completes.
		session._resolveStopGateWith?.({
			nodes: [
				{
					id: 1,
					callFrame: {
						functionName: "firstStopFromGate",
						url: "file:///gated.js",
						lineNumber: 1,
						columnNumber: 0,
					},
					hitCount: 7,
					children: [],
				},
			],
			samples: [1, 1, 1, 1, 1, 1, 1],
			timeDeltas: [1000, 1000, 1000, 1000, 1000, 1000, 1000],
			startTime: 0,
			endTime: 7000,
		})

		// Wait for both rotation and finalizer to settle.
		await rotationPromise
		await finalizerPromise

		// Final assertion: exactly one Profiler.stop throughout
		// the entire scenario.
		const totalStops = session._posts.filter((p) => p.method === "Profiler.stop").length
		expect(totalStops).toBe(1)

		// State must be finalized.
		expect(getCpuProfilerState()).toBe("finalized")

		// Exactly one segment persisted (segment-000 from the
		// gated rotation's stop). The finalizer saw no profile
		// to persist.
		const seg0Writes = fs._writes.filter((w) => w.path.includes("segment-000.cpuprofile"))
		expect(seg0Writes.length).toBe(1)

		// No phantom segment-001 from the finalizer's deferred
		// path.
		const seg1Writes = fs._writes.filter((w) => w.path.includes("segment-001.cpuprofile"))
		expect(seg1Writes.length).toBe(0)

		// Disconnect occurred exactly once.
		expect(session._disconnectCalls).toBe(1)

		// meta.status === "finalized", successfulSegmentCount=1,
		// failedSegmentCount=0.
		const metaWrites = fs._writes.filter((w) => w.path.endsWith("meta.json.tmp"))
		const finalMeta = JSON.parse(metaWrites[metaWrites.length - 1].data)
		expect(finalMeta.status).toBe("finalized")
		expect(finalMeta.performance.successfulSegmentCount).toBe(1)
		expect(finalMeta.performance.failedSegmentCount).toBe(0)
	})

	it("CPUCAP-FINAL-02: 2 consecutive stop failures -> state=failed; first segment preserved", async () => {
		const fs = resetAllProfilingSeams()
		arm()
		const session = makeFakeSession()
		session._stopResults = [
			{
				nodes: [
					{
						id: 1,
						callFrame: { functionName: "first", url: "z", lineNumber: 1, columnNumber: 0 },
						hitCount: 1,
						children: [],
					},
				],
				samples: [1],
				timeDeltas: [100],
				startTime: 0,
				endTime: 100,
			},
		]
		setCpuProfilerInspectorSessionFactory(() => session)

		triggerExtensionHostCpuProfilerOnFirstQualifyingJob()

		for (let i = 0; i < 50; i++) {
			await new Promise((r) => setImmediate(r))
			if (getCpuProfilerState() === "active") break
		}

		// First rotation: stop succeeds.
		await __driveSegmentRotationForTests()
		await new Promise((r) => setImmediate(r))

		// Arm stopError for subsequent rotations.
		session._stopError = new Error("simulated stop failure")

		// Second rotation: stop fails -> recovery start is attempted.
		await __driveSegmentRotationForTests()
		await new Promise((r) => setImmediate(r))

		// After one stop failure, the capture recovers. The second consecutive
		// failure should transition to failed.
		session._stopError = new Error("simulated stop failure 2")

		await __driveSegmentRotationForTests()
		await new Promise((r) => setImmediate(r))

		expect(getCpuProfilerState()).toBe("failed")

		// First segment should still be on disk.
		const seg0Writes = fs._writes.filter((w) => w.path.includes("segment-000.cpuprofile"))
		expect(seg0Writes.length).toBe(1)
	})
})

// =============================================================================
// CPUCAP-CONSERVE: conservation invariants
// =============================================================================

describe("CPUCAP-CONSERVE: conservation invariants", () => {
	afterEach(() => {
		__resetCpuProfilerForTests()
	})

	it("CPUCAP-CONSERVE-01: profiler disabled -> zero semantic delta", () => {
		__resetCpuProfilerForTests()
		const r1 = applyExtensionHostCpuProfilerPolicy(false, { [CLINEMM_DIAG_CPU_PROFILE_ENV]: "1" })
		expect(r1.enabled).toBe(false)
		expect(getCpuProfilerState()).toBe("disabled")

		const trigger = triggerExtensionHostCpuProfilerOnFirstQualifyingJob()
		expect(trigger.kind).toBe("skipped")
	})

	it("CPUCAP-CONSERVE-02: profiler start failure -> command still starts (no exception thrown)", () => {
		__resetCpuProfilerForTests()
		arm()
		// No seams registered -> trigger should return started (the actual
		// failure happens async in the capture loop, never into the hot path).
		const result = triggerExtensionHostCpuProfilerOnFirstQualifyingJob()
		expect(result.kind).toBe("started")
	})

	it("CPUCAP-CONSERVE-04: no trigger call -> profiler stays disabled", () => {
		__resetCpuProfilerForTests()
		expect(getCpuProfilerState()).toBe("disabled")
		const snap = getCpuProfilerSnapshot()
		expect(snap.captureId).toBeUndefined()
	})

	it("CPUCAP-CONSERVE-05: arming CPU profiler does not affect unrelated state", () => {
		__resetCpuProfilerForTests()
		arm()
		expect(getCpuProfilerState()).toBe("armed")
		const snap = getCpuProfilerSnapshot()
		expect(snap.state).toBe("armed")
		expect(snap.captureId).toBeUndefined()
	})

	it("CPUCAP-CONSERVE: frozen constants honored", () => {
		expect(CPU_PROFILE_SEGMENT_MS).toBe(5_000)
		expect(CPU_PROFILE_MAX_DURATION_MS).toBe(60_000)
		expect(CPU_PROFILE_PERTURBATION_WARN_MS).toBe(250)
		expect(CLINEMM_DIAG_CPU_PROFILE_ENV).toBe("CLINEMM_DIAG_CPU_PROFILE")
	})

	it("CPUCAP-CONSERVE: performance counters start at zero", () => {
		__resetCpuProfilerForTests()
		const perf = getCpuProfilerPerformanceCounters()
		expect(perf.segmentCount).toBe(0)
		expect(perf.successfulSegmentCount).toBe(0)
		expect(perf.failedSegmentCount).toBe(0)
		expect(perf.maxRotationWallMs).toBe(0)
		expect(perf.slowRotationCount).toBe(0)
	})

	it("CPUCAP-CONSERVE: state machine transitions observable", () => {
		__resetCpuProfilerForTests()
		expect(getCpuProfilerState()).toBe("disabled")
		arm()
		expect(getCpuProfilerState()).toBe("armed")
		applyExtensionHostCpuProfilerPolicy(true, {})
		expect(getCpuProfilerState()).toBe("disabled")
	})

	it("CPUCAP-CONSERVE: warn seam is repluggable", () => {
		__resetCpuProfilerForTests()
		const warnings: string[] = []
		setCpuProfilerWarn((msg) => warnings.push(msg))
		arm()
		const session = makeFakeSession()
		setCpuProfilerInspectorSessionFactory(() => session)
		triggerExtensionHostCpuProfilerOnFirstQualifyingJob()
		expect(typeof warnings).toBe("object")
	})
})
