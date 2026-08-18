/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.5-C3-C04-SYNTHETIC-REAL-CLASSIFIER-CHAIN
 *
 * C2.5-C3 — C04_SYNTHETIC_REAL_CLASSIFIER_CHAIN.
 *
 * This test qualifies the **classifier contract** against the
 * post-mirror semantic shape. Per the reviewer's R4 freeze in
 * `docs/architecture/elm/task-state-e5-e6-correction02-c25-c2a-correction01-wording-revision.md`:
 *
 *   SYNTHETIC:
 *     getLegacyPhase
 *     getArbiterSnapshot
 *     canonical event stimulus
 *
 *   REAL:
 *     canonical-event handler (the wiring's own `observeCanonicalRuntimeEvent`)
 *     observation ingress (wiring → coordinator)
 *     shadow transition (real `TaskStateShadow`)
 *     differential computation (real `TaskShadowComparator`)
 *     classifier (production `classify()` at task-state-shadow-recorder.ts:521)
 *     recorder (production `TaskShadowRecorder`)
 *
 * C-REAL qualified the `LocalRuntimeHost → subscribeCanonicalRuntimeEventsToShadow →
 * wiring` transport (C-REAL-1..5 PASS). This test deliberately
 * DECOUPLES the classifier+recorder+transport chain from the mirror
 * (per the reviewer's wording "deliberately decouples … so the
 * classifier contract can be qualified in isolation"). The full
 * transport is not re-qualified here; it is exercised from the
 * `wiring.observeCanonicalRuntimeEvent(...)` ingress directly,
 * which is the exact same entry point that
 * `subscribeCanonicalRuntimeEventsToShadow` calls per canonical
 * event.
 *
 * Required positive witness (P):
 *   inputs:
 *     legacyPhase = idle
 *     arbiter.execution.modelStreaming = true
 *     arbiter.execution.awaitingApproval = false
 *     arbiter.pendingToolCalls = []
 *     canonical event causes:
 *       shadowPhase = streaming  (via execution-state-changed edge)
 *   expected:
 *     D01_LEGACY_FALSE_IDLE = 1
 *     arbitration = SHADOW_CORRECT
 *     origin = RUNTIME_CANONICAL
 *     legacyPhase = idle
 *     shadowPhase = streaming
 *     modelStreaming = true
 *     + assert exact injected arbiter input at the same observation
 *
 * Required negative matrix (N1, N2, N3):
 *   N1 (remove legacy side):
 *     legacyPhase = streaming
 *     arbiterActive = true
 *     shadowPhase = streaming
 *     -> D01 = 0
 *     -> classification = D00_AGREE (divergence is undefined when
 *                                    legacy == shadow)
 *
 *   N2 (remove arbiter side):
 *     legacyPhase = idle
 *     arbiterActive = false
 *     shadowPhase = streaming
 *     -> D01 = 0
 *     -> classification = D02_SHADOW_FALSE_ACTIVE
 *     + assert exact injected arbiter input (all-false) at the same observation
 *
 *   N3 (remove shadow side):
 *     legacyPhase = idle
 *     arbiterActive = true
 *     shadowPhase = idle
 *     -> D01 = 0
 *     -> classification = D00_AGREE (no divergence when legacy == shadow)
 *
 * Necessity probe:
 *   All four conjuncts (legacy side, arbiter side, shadow side,
 *   shadow=streaming specifically) independently matter. The
 *   matrix proves input ablation without mutating the production
 *   classifier code.
 *
 * Evidence-strengthening (per reviewer's round-21):
 *   For P and N2, assert not only the retained record's derived
 *   fields (`modelStreaming`, `awaitingApproval`, etc.) but ALSO
 *   the exact injected `arbiter.execution.modelStreaming`,
 *   `arbiter.execution.awaitingApproval`, and
 *   `arbiter.pendingToolCalls` at the same observation. This is
 *   important because `pendingToolCalls.length` participates
 *   directly in `arbiterActive`, while the retained recorder
 *   fields are derived from `observationModel.activity` (which
 *   tracks the SHADOW's projection, not the canonical arbiter).
 *
 * Run with: `bun run test:vitest` (lives under the base vitest
 * config — no @cline-internal/core alias required because this test
 * does not import the production transport; it uses the wiring's
 * canonical-event ingress directly).
 */

import type { AgentRunStatus, AgentRuntimeEvent, AgentRuntimeStateSnapshot } from "@cline/shared"
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import type { TurnPhase } from "@/shared/ExtensionMessage"
import type { TaskShadowHostWiringDeps } from "../task-state-shadow-host-wiring"
import { createTaskShadowHostWiring, emptyArbiterSnapshot } from "../task-state-shadow-host-wiring"
import type { ArbiterSnapshot, TaskShadowRecordInput } from "../task-state-shadow-recorder"

// =========================================================================
// Env-flag hygiene
// =========================================================================
//
// The production wiring is gated by `CLINEMM_TASK_STATE_SHADOW_DIFFERENTIAL`
// (default-on, off when "0"/"false"/"off"). Force it on here so the
// test cannot be silently neutered by an inherited environment.

const ORIGINAL_ENV = process.env.CLINEMM_TASK_STATE_SHADOW_DIFFERENTIAL

beforeEach(() => {
	process.env.CLINEMM_TASK_STATE_SHADOW_DIFFERENTIAL = "1"
})

// afterAll restores the env after the LAST test in this file.

const restoreEnv = () => {
	if (ORIGINAL_ENV === undefined) delete process.env.CLINEMM_TASK_STATE_SHADOW_DIFFERENTIAL
	else process.env.CLINEMM_TASK_STATE_SHADOW_DIFFERENTIAL = ORIGINAL_ENV
}

// =========================================================================
// Canonical-event fixtures
// =========================================================================

function baseSnapshot(): AgentRuntimeStateSnapshot {
	return {
		agentId: "agent_c25_c3",
		runId: "run_c25_c3",
		status: "running",
		iteration: 0,
		messages: [],
		pendingToolCalls: [],
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0,
		},
	}
}

/**
 * Live-runtime snapshot shape (per C1.5 P1 EXPRESSION): every
 * event a real `AgentRuntime` emits carries `execution` and
 * `recovery` on the snapshot. Without `execution`, the shadow's
 * `adaptRuntimeEvent` for `execution-state-changed` short-circuits
 * to no TaskMsg (see shadow-adapter.ts:106-108), and the shadow
 * stays idle.
 */
function liveBaseSnapshot(): AgentRuntimeStateSnapshot {
	return {
		...baseSnapshot(),
		execution: {
			modelStreaming: false,
			tooling: false,
			awaitingApproval: false,
		},
		recovery: {
			state: "idle",
			episodeFailures: 0,
			circuitNoticeCount: 0,
			tracker: {
				state: "idle",
				currentRepairAttempts: 0,
				equivalentRepeatCount: 0,
				blockedExactKeys: [],
				blockedFamilies: [],
			},
			secondStage: "idle",
			maxEpisodeFailures: 3,
		},
	}
}

/**
 * Snapshot variant for the post-edge state: modelStreaming=true.
 * Used by `modelStreamStartedEvent` to set the canonical
 * "current execution state" so the shadow's edge-trigger emits
 * `model_stream_started` (`exec.modelStreaming && !prev.modelStreaming`).
 */
function liveBaseSnapshotStreaming(): AgentRuntimeStateSnapshot {
	return {
		...baseSnapshot(),
		execution: {
			modelStreaming: true,
			tooling: false,
			awaitingApproval: false,
		},
		recovery: {
			state: "idle",
			episodeFailures: 0,
			circuitNoticeCount: 0,
			tracker: {
				state: "idle",
				currentRepairAttempts: 0,
				equivalentRepeatCount: 0,
				blockedExactKeys: [],
				blockedFamilies: [],
			},
			secondStage: "idle",
			maxEpisodeFailures: 3,
		},
	}
}

/**
 * `execution-state-changed` event that flips `modelStreaming` from
 * false → true. The shadow's `adaptRuntimeEvent` is edge-triggered
 * (CORRECTION01 R4), so this single event emits exactly one
 * `model_stream_started` TaskMsg, which advances the shadow's
 * `model.activity.modelStreaming` to true. From there,
 * `projectTurnState` projects the shadow to `streaming`.
 *
 * Subsequent observations then see `shadowPhase === "streaming"`
 * until a terminal event (`run-finished` / `run-failed`) is emitted.
 */
function modelStreamStartedEvent(): AgentRuntimeEvent {
	return {
		type: "execution-state-changed",
		snapshot: liveBaseSnapshotStreaming(),
		previousExecution: {
			modelStreaming: false,
			tooling: false,
			awaitingApproval: false,
		},
	}
}

/**
 * Non-shadow-changing event. The shadow adapter's
 * `adaptRuntimeEvent` produces NO TaskMsg for these kinds
 * (presentation/prose: assistant text, reasoning deltas,
 * usage updates, message-added, turn-started/finished,
 * tool-updated). The shadow stays idle. Useful for N3, which
 * requires `shadowPhase !== streaming` while exercising the
 * full canonical-event chain.
 */
function noopTextEvent(): AgentRuntimeEvent {
	return {
		type: "message-added",
		snapshot: liveBaseSnapshot(),
		message: {
			role: "assistant",
			content: "no-op text — shadow should not transition",
		},
	} as unknown as AgentRuntimeEvent
}

// =========================================================================
// Synthetic arbiter snapshots
// =========================================================================

/**
 * P-input arbiter: modelStreaming=true (canonical arbiter agrees
 * with the shadow's "model is streaming" projection). The classifier
 * reads these as the disjunction:
 *   arbiterActive = modelStreaming ∨ awaitingApproval ∨ pendingToolCalls.length > 0
 */
function arbiterActive(): ArbiterSnapshot {
	return {
		execution: {
			modelStreaming: true,
			tooling: false,
			awaitingApproval: false,
		},
		recoveryState: "idle",
		status: "running",
		pendingToolCalls: [],
	}
}

/**
 * N2-input arbiter: modelStreaming=false, awaitingApproval=false,
 * pendingToolCalls=[] (canonical arbiter agrees with the legacy
 * idle projection — NO active state at the canonical layer). The
 * classifier's D02 branch reads `arbiterActive === false` and
 * returns `D02_SHADOW_FALSE_ACTIVE` because the shadow says
 * streaming while neither legacy nor canonical agree.
 */
function arbiterInactive(): ArbiterSnapshot {
	return {
		execution: {
			modelStreaming: false,
			tooling: false,
			awaitingApproval: false,
		},
		recoveryState: "idle",
		status: "running",
		pendingToolCalls: [],
	}
}

// =========================================================================
// Wiring harness
// =========================================================================
//
// Each test constructs a fresh wiring with controlled
// `getLegacyPhase` and `getArbiterSnapshot` closures. The closures
// capture the test-specific synthetic values; the wiring reads
// them synchronously at the moment of observation (see
// task-state-shadow-coordinator.ts:applyAndRecord).

interface WiringHarness {
	readonly wiring: ReturnType<typeof createTaskShadowHostWiring>
	readonly arbiterSamples: { count: number; last: ArbiterSnapshot | undefined }
}

function makeHarness(args: { legacyPhase: TurnPhase; arbiter: ArbiterSnapshot; sessionId?: string }): WiringHarness {
	const sessionId = args.sessionId ?? "c25-c3-session"
	const arbiterSamples: { count: number; last: ArbiterSnapshot | undefined } = { count: 0, last: undefined }

	const deps: TaskShadowHostWiringDeps = {
		lifecycle: {
			getActiveSession: () => ({ sessionId }) as never,
			setRunning: () => undefined,
		},
		sessionOptions: {
			mcpHub: undefined as never,
			requestToolApproval: (() => undefined) as never,
			askQuestion: (() => undefined) as never,
			onSessionEvent: () => {},
			onSendComplete: async () => {},
			onSendError: async () => {},
		},
		getLegacyPhase: () => args.legacyPhase,
		getArbiterSnapshot: () => {
			arbiterSamples.count += 1
			arbiterSamples.last = args.arbiter
			return args.arbiter
		},
		now: () => 1_700_000_000_000,
	}

	const wiring = createTaskShadowHostWiring(deps)
	return { wiring, arbiterSamples }
}

/**
 * Push a canonical event through the wiring's ingress. The wiring
 * invokes the production coordinator → comparator → recorder →
 * classifier chain. The wiring's session authority gate (C2.4-B
 * FIXUP01) accepts when `lifecycle.getActiveSession()?.sessionId`
 * matches `input.sessionId`.
 */
function observe(wiring: ReturnType<typeof createTaskShadowHostWiring>, event: AgentRuntimeEvent, sessionId = "c25-c3-session") {
	wiring.observeCanonicalRuntimeEvent({
		origin: "RUNTIME_CANONICAL",
		sessionId,
		event,
	})
}

// =========================================================================
// Tests
// =========================================================================

describe("C2.5-C3 — C04_SYNTHETIC_REAL_CLASSIFIER_CHAIN", () => {
	afterAll(() => {
		restoreEnv()
	})

	// ==============================================================
	// P — positive witness
	// ==============================================================
	//
	// idle + streaming shadow + active arbiter
	//   -> D01_LEGACY_FALSE_IDLE = 1, arbitration = SHADOW_CORRECT
	//   -> assert exact injected arbiter fields at the same observation

	it("P: idle + streaming shadow + active arbiter -> D01_LEGACY_FALSE_IDLE = 1, arbitration = SHADOW_CORRECT", () => {
		const injectedArbiter = arbiterActive()
		const { wiring, arbiterSamples } = makeHarness({
			legacyPhase: "idle",
			arbiter: injectedArbiter,
		})

		// Canonical event: edge-triggered model_stream_started
		// (modelStreaming false -> true). Shadow transitions to streaming.
		observe(wiring, modelStreamStartedEvent())

		const counts = wiring.recorderCounts()
		const records = wiring.records()

		// Recorded exactly one observation; it is the divergence (idle != streaming).
		expect(counts.eventsObserved).toBe(1)
		expect(counts.divergences).toBe(1)
		expect(records.length).toBe(1)

		const record = records[0]
		expect(record).toBeDefined()

		// Classification + arbitration.
		expect(record.classification).toBe("D01_LEGACY_FALSE_IDLE")
		expect(record.arbitration).toBe("SHADOW_CORRECT")

		// Retained causal fields.
		expect(record.origin).toBe("RUNTIME_CANONICAL")
		expect(record.legacyPhase).toBe("idle")
		expect(record.shadowPhase).toBe("streaming")
		expect(record.modelStreaming).toBe(true)
		expect(record.awaitingApproval).toBe(false)
		expect(record.activeToolCount).toBe(0)

		// Evidence-strengthening: assert the exact injected arbiter
		// input at the same observation. pendingToolCalls.length
		// participates directly in arbiterActive, while the
		// retained recorder fields above are derived from the
		// shadow's projection. The test fixture has the input
		// available, so there is no reason to infer it.
		expect(arbiterSamples.count).toBe(1)
		expect(arbiterSamples.last).toBeDefined()
		expect(arbiterSamples.last!.execution.modelStreaming).toBe(true)
		expect(arbiterSamples.last!.execution.awaitingApproval).toBe(false)
		expect(arbiterSamples.last!.pendingToolCalls.length).toBe(0)

		// No spurious errors / gaps / violations.
		expect(counts.invariantViolations).toBe(0)
		expect(counts.observerErrors).toBe(0)
		expect(counts.evidenceGaps).toBe(0)
		expect(counts.droppedRecords).toBe(0)

		// Other divergence classes stayed at zero.
		expect(counts.divergenceCountsByClass.D02_SHADOW_FALSE_ACTIVE).toBe(0)
		expect(counts.divergenceCountsByClass.D10_UNKNOWN).toBe(0)
		expect(counts.divergenceCountsByClass.D00_AGREE).toBe(0)

		wiring.dispose()
	})

	// ==============================================================
	// N1 — remove legacy side
	// ==============================================================
	//
	// streaming + streaming shadow + active arbiter
	//   -> D01 = 0
	//   -> classification = D00_AGREE (no divergence when legacy == shadow)

	it("N1: streaming + streaming shadow + active arbiter -> D01 = 0 (D00_AGREE; legacy conjunct matters)", () => {
		const { wiring } = makeHarness({
			legacyPhase: "streaming",
			arbiter: arbiterActive(),
		})

		observe(wiring, modelStreamStartedEvent())

		const records = wiring.records()
		const counts = wiring.recorderCounts()

		// Recorded exactly one observation, but no divergence
		// (legacy == shadow → comparator returns divergence = undefined).
		expect(counts.eventsObserved).toBe(1)
		expect(counts.divergences).toBe(0)
		expect(counts.agreements).toBe(1)
		expect(records.length).toBe(1)

		const record = records[0]
		expect(record).toBeDefined()

		// Classifier short-circuits: divergence is undefined → D00_AGREE.
		expect(record.classification).toBe("D00_AGREE")
		expect(record.arbitration).toBeUndefined()

		// D01 count must be zero (legacy-side conjunct matters:
		// classifier's D01 branch requires legacyPhase === "idle").
		expect(counts.divergenceCountsByClass.D01_LEGACY_FALSE_IDLE).toBe(0)

		// The shadow transitioned to streaming (assertion below proves
		// the canonical event fired); the legacy phase was also
		// "streaming" via the harness, so no divergence was recorded
		// and the recorder's default `shadowPhase: "idle"` /
		// `legacyPhase: "idle"` for undefined-divergence records
		// applies. The discriminator is the classifier output
		// (D00_AGREE) and the agreement count (1), not the
		// defaulted record fields. The shadow's projection
		// `modelStreaming=true` is retained on the record even
		// when divergence is undefined, providing the witness
		// that the shadow DID transition.
		expect(record.shadowPhase).toBe("idle") // default for undefined divergence
		expect(record.legacyPhase).toBe("idle") // default for undefined divergence
		expect(record.modelStreaming).toBe(true) // shadow transitioned
		expect(record.event).toBe("model_stream_started") // canonical TaskMsg

		// No errors / gaps / violations.
		expect(counts.invariantViolations).toBe(0)
		expect(counts.observerErrors).toBe(0)
		expect(counts.evidenceGaps).toBe(0)
		expect(counts.droppedRecords).toBe(0)

		wiring.dispose()
	})

	// ==============================================================
	// N2 — remove arbiter side
	// ==============================================================
	//
	// idle + streaming shadow + inactive arbiter
	//   -> D01 = 0
	//   -> classification = D02_SHADOW_FALSE_ACTIVE
	//   -> assert exact injected arbiter fields (all-false) at the same observation

	it("N2: idle + streaming shadow + inactive arbiter -> D02_SHADOW_FALSE_ACTIVE = 1, D01 = 0 (arbiter conjunct matters)", () => {
		const injectedArbiter = arbiterInactive()
		const { wiring, arbiterSamples } = makeHarness({
			legacyPhase: "idle",
			arbiter: injectedArbiter,
		})

		observe(wiring, modelStreamStartedEvent())

		const counts = wiring.recorderCounts()
		const records = wiring.records()

		expect(counts.eventsObserved).toBe(1)
		expect(counts.divergences).toBe(1)
		expect(records.length).toBe(1)

		const record = records[0]
		expect(record).toBeDefined()

		// Classifier:
		//   D01 skipped: arbiterActive = false
		//   D02 matches: shadow === streaming && legacy !== streaming/completed/error/resumable && arbiterActive === false
		expect(record.classification).toBe("D02_SHADOW_FALSE_ACTIVE")
		expect(record.arbitration).toBe("LEGACY_CORRECT")

		// D01 count must be zero (arbiter-side conjunct matters).
		expect(counts.divergenceCountsByClass.D01_LEGACY_FALSE_IDLE).toBe(0)

		// Evidence-strengthening: assert the exact injected arbiter
		// input at the same observation. All three arbiter fields
		// contribute to `arbiterActive`; verify each is at its
		// injected value.
		expect(arbiterSamples.count).toBe(1)
		expect(arbiterSamples.last).toBeDefined()
		expect(arbiterSamples.last!.execution.modelStreaming).toBe(false)
		expect(arbiterSamples.last!.execution.awaitingApproval).toBe(false)
		expect(arbiterSamples.last!.pendingToolCalls).toEqual([])

		// Retained shadow-derived fields reflect the shadow's
		// streaming projection (which the canonical arbiter
		// disagrees with — that's why D02 fires).
		expect(record.legacyPhase).toBe("idle")
		expect(record.shadowPhase).toBe("streaming")
		expect(record.modelStreaming).toBe(true)

		// No errors / gaps / violations.
		expect(counts.invariantViolations).toBe(0)
		expect(counts.observerErrors).toBe(0)
		expect(counts.evidenceGaps).toBe(0)
		expect(counts.droppedRecords).toBe(0)

		wiring.dispose()
	})

	// ==============================================================
	// N3 — remove shadow side
	// ==============================================================
	//
	// idle + idle shadow + active arbiter
	//   -> D01 = 0
	//   -> classification = D00_AGREE (no divergence when legacy == shadow)
	//
	// The shadow stays idle because the canonical event is a
	// "presentation/prose" event (`message-added` for assistant
	// text) that the shadow's adapter does not translate into a
	// TaskMsg. The shadow's `model.activity.modelStreaming` stays
	// false; `projectTurnState` returns "idle".

	it("N3: idle + idle shadow + active arbiter -> D01 = 0 (D00_AGREE; shadow conjunct matters)", () => {
		const { wiring } = makeHarness({
			legacyPhase: "idle",
			arbiter: arbiterActive(),
		})

		observe(wiring, noopTextEvent())

		const records = wiring.records()
		const counts = wiring.recorderCounts()

		// Recorded one observation, but no divergence
		// (legacy == shadow == idle).
		expect(counts.eventsObserved).toBe(1)
		expect(counts.divergences).toBe(0)
		expect(counts.agreements).toBe(1)
		expect(records.length).toBe(1)

		const record = records[0]
		expect(record).toBeDefined()

		// Classifier short-circuits: divergence is undefined → D00_AGREE.
		expect(record.classification).toBe("D00_AGREE")
		expect(record.arbitration).toBeUndefined()

		// D01 count must be zero (shadow-side conjunct matters:
		// the C04 predicate requires shadowPhase === "streaming";
		// without it, D01 is unreachable regardless of arbiter
		// activity).
		expect(counts.divergenceCountsByClass.D01_LEGACY_FALSE_IDLE).toBe(0)

		// Retained fields reflect idle on both sides.
		expect(record.legacyPhase).toBe("idle")
		expect(record.shadowPhase).toBe("idle")

		// No errors / gaps / violations.
		expect(counts.invariantViolations).toBe(0)
		expect(counts.observerErrors).toBe(0)
		expect(counts.evidenceGaps).toBe(0)
		expect(counts.droppedRecords).toBe(0)

		wiring.dispose()
	})

	// ==============================================================
	// Necessity summary — by input ablation, all three predicate
	// parts independently matter. None of P/N1/N2/N3 yielded D01
	// except P, and the only difference between P and each N is
	// one removed conjunct.
	// ==============================================================

	it("necessity: D01_LEGACY_FALSE_IDLE fires iff legacy=idle AND shadow=streaming AND arbiterActive=true", () => {
		const cases: ReadonlyArray<{
			name: string
			legacyPhase: TurnPhase
			arbiter: ArbiterSnapshot
			event: AgentRuntimeEvent
			expectedD01: number
			expectedClass: "D01_LEGACY_FALSE_IDLE" | "D02_SHADOW_FALSE_ACTIVE" | "D00_AGREE"
		}> = [
			{
				name: "P",
				legacyPhase: "idle",
				arbiter: arbiterActive(),
				event: modelStreamStartedEvent(),
				expectedD01: 1,
				expectedClass: "D01_LEGACY_FALSE_IDLE",
			},
			{
				name: "N1",
				legacyPhase: "streaming",
				arbiter: arbiterActive(),
				event: modelStreamStartedEvent(),
				expectedD01: 0,
				expectedClass: "D00_AGREE",
			},
			{
				name: "N2",
				legacyPhase: "idle",
				arbiter: arbiterInactive(),
				event: modelStreamStartedEvent(),
				expectedD01: 0,
				expectedClass: "D02_SHADOW_FALSE_ACTIVE",
			},
			{
				name: "N3",
				legacyPhase: "idle",
				arbiter: arbiterActive(),
				event: noopTextEvent(),
				expectedD01: 0,
				expectedClass: "D00_AGREE",
			},
		]

		for (const c of cases) {
			// Fresh wiring per case so recorder state is isolated.
			const { wiring } = makeHarness({
				legacyPhase: c.legacyPhase,
				arbiter: c.arbiter,
			})
			observe(wiring, c.event)
			const counts = wiring.recorderCounts()
			const records = wiring.records()
			expect(counts.divergenceCountsByClass[c.expectedClass], `case ${c.name} expected class count`).toBe(1)
			expect(records[0].classification, `case ${c.name} classification`).toBe(c.expectedClass)
			expect(counts.divergenceCountsByClass.D01_LEGACY_FALSE_IDLE, `case ${c.name} D01 count`).toBe(c.expectedD01)
			expect(counts.invariantViolations).toBe(0)
			expect(counts.observerErrors).toBe(0)
			expect(counts.evidenceGaps).toBe(0)
			wiring.dispose()
		}
	})

	// ==============================================================
	// Diagnostic — confirm that the production `classify()` is the
	// writer for D00-D10 (no coordinator D11 override was applied
	// to our test cases).
	// ==============================================================
	//
	// Implementation note: classify() is not directly imported
	// here — the wiring is the production ingress — but the
	// wiring's recorder uses `classify(input)` as the default
	// when no `classificationOverride` is supplied (see
	// task-state-shadow-recorder.ts:330-331). For our cases,
	// `classificationOverride` is computed by `classifyD11` for
	// the host-pre-engaged window (D11); outside that window, it
	// is undefined, so the recorder's built-in `classify()`
	// is the writer for D00-D10.

	it("diagnostic: production classify() is the writer for D00-D10 (no D11 override was applied to P)", () => {
		const { wiring } = makeHarness({
			legacyPhase: "idle",
			arbiter: arbiterActive(),
		})
		observe(wiring, modelStreamStartedEvent())
		const records = wiring.records()
		const record = records[0]
		expect(record).toBeDefined()
		// D11_HOST_PREENGAGED is the only classification the
		// coordinator's D11 override supplies; our test does not
		// enter that window. D01 is therefore the result of the
		// built-in classify(), not a coordinator override.
		expect(record.classification).not.toBe("D11_HOST_PREENGAGED")
		expect(record.classification).toBe("D01_LEGACY_FALSE_IDLE")
		wiring.dispose()
	})

	// ==============================================================
	// Type sanity — the recorder/recorderCounts surfaces that
	// `wiring.records()` and `wiring.recorderCounts()` expose
	// satisfy the production `TaskShadowRecordInput` /
	// `TaskShadowRecorderCounts` shapes.
	// ==============================================================

	it("type sanity: records() / recorderCounts() match production shapes", () => {
		const { wiring } = makeHarness({
			legacyPhase: "idle",
			arbiter: arbiterActive(),
		})
		observe(wiring, modelStreamStartedEvent())
		const records = wiring.records()
		expect(records.length).toBe(1)
		const counts = wiring.recorderCounts()
		expect(typeof counts.eventsObserved).toBe("number")
		expect(typeof counts.divergences).toBe("number")
		expect(typeof counts.divergenceCountsByClass.D01_LEGACY_FALSE_IDLE).toBe("number")
		expect(typeof counts.divergenceCountsByClass.D00_AGREE).toBe("number")
		// Type-only assertion to ensure reach of TaskShadowRecordInput.
		const _shape: TaskShadowRecordInput | undefined = undefined
		void _shape
		void emptyArbiterSnapshot
		// AgentRunStatus is imported for type-only reach; we never
		// construct a value at runtime in this file.
		void {} as unknown as AgentRunStatus
		wiring.dispose()
	})
})
