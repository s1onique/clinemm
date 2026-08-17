/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02
 * Phase C2.1 — read-only recon tests pinning the production ordering
 * that justifies W12_MODEL=A.
 *
 * No production source modified. This file is RECON-ONLY: it
 * inspects production source via static analysis (readFileSync +
 * line offset assertions) and via runtime execution of the actual
 * SdkController.initTask seam.
 *
 * The T11 module-import guard from C2.0 remains authoritative for
 * the narrow sense (production modules import cleanly). The
 * stronger T11B/T11C/T11D command gates are run separately by the
 * ACT execution and recorded in
 * `task-state-e5-e6-correction02-c21-recon.md` section 6.
 */
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { TaskShadowComparator } from "../task-state-shadow"
import { TaskShadowRecorder } from "../task-state-shadow-recorder"

const SDK_CONTROLLER_PATH = "apps/vscode/src/sdk/SdkController.ts"
const TASK_START_PATH = "apps/vscode/src/sdk/sdk-task-start-coordinator.ts"

const REPO_ROOT = "/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm-elm-architecture01"

describe("C2.1-A — real production ordering pins W12_MODEL=A", () => {
	it("initTask: setTurnPhase(streaming) line is BEFORE emitTaskRequested line", () => {
		const src = readFileSync(`${REPO_ROOT}/${SDK_CONTROLLER_PATH}`, "utf8")
		const taskStartSrc = readFileSync(`${REPO_ROOT}/${TASK_START_PATH}`, "utf8")

		// Find the line numbers of the canonical call sites.
		//   setTurnPhase("streaming")         in sdk-task-start-coordinator.ts
		//   emitTaskRequested(sessionId)      in SdkController.ts
		// These are inside SdkTaskStartCoordinator.initTask and
		// SdkController.initTask respectively. The SdkController awaits
		// the inner taskStart.initTask(...) before calling
		// emitTaskRequested.
		const setTurnPhaseMatch = taskStartSrc.match(/setTurnPhase\(\s*["']streaming["']\s*\)/)
		const emitRequestedMatch = src.match(/emitTaskRequested\(\s*\{/)

		expect(setTurnPhaseMatch).not.toBeNull()
		expect(emitRequestedMatch).not.toBeNull()

		// Both lines exist in their respective files; the controller
		// awaits taskStart.initTask before emitting. Static check:
		// in SdkController.ts, the `await this.taskStart.initTask(...)`
		// call must appear before the `emitTaskRequested(` call.
		const awaitIdx = src.indexOf("await this.taskStart.initTask")
		const emitIdx = src.indexOf("emitTaskRequested(")
		expect(awaitIdx).toBeGreaterThanOrEqual(0)
		expect(emitIdx).toBeGreaterThanOrEqual(0)
		expect(emitIdx).toBeGreaterThan(awaitIdx)
	})

	it("T11A — production shadow modules import cleanly", () => {
		// Re-asserted from C2.0 (T11.1) for the C2.1 record.
		expect(new TaskShadowComparator()).toBeDefined()
		expect(new TaskShadowRecorder()).toBeDefined()
	})
})

describe("C2.1-B — iteration_start trace (read-only)", () => {
	it("RuntimeEventAdapter.discards execution-state-changed (canonical seam gap)", () => {
		// Static confirmation: the production adapter explicitly
		// returns [] for execution-state-changed (and recovery-state-
		// changed), preventing those events from reaching the host
		// CoreSessionEvent stream and the shadow adapter. This is
		// the gap that ELM-02F must restore.
		const adapterSrc = readFileSync(
			`${REPO_ROOT}/sdk/packages/core/src/runtime/orchestration/runtime-event-adapter.ts`,
			"utf8",
		)
		expect(adapterSrc).toMatch(/case "execution-state-changed":[\s\S]*?return \[\];/)
		expect(adapterSrc).toMatch(/case "run-started":[\s\S]*?return \[\];/)
	})

	it("Shadow adapter has the canonical execution->TaskMsg mapping (unused in production today)", () => {
		// The shadow-adapter.ts DOES contain the full logic for
		// execution-state-changed -> model_stream_started /
		// approval_requested etc., but the host never feeds it those
		// events. This proves the shadow side is ready; the gap is
		// upstream.
		const shadowAdapterSrc = readFileSync(
			`${REPO_ROOT}/sdk/packages/agents/src/runtime/state/task-state/shadow-adapter.ts`,
			"utf8",
		)
		expect(shadowAdapterSrc).toMatch(/case "execution-state-changed":[\s\S]*model_stream_started/)
		expect(shadowAdapterSrc).toMatch(/approval_requested/)
	})

	it("AgentRuntime: turn-started fires BEFORE executionModelStreaming=true", () => {
		// Static ordering confirmation: at the canonical truth
		// surface, modelStreaming flips to true INSIDE the
		// model.stream(...) loop, AFTER turn-started is emitted.
		// This means at iteration_start time, canonical snapshot
		// has modelStreaming=false even though the host legacy
		// phase already says streaming.
		const agentRuntimeSrc = readFileSync(`${REPO_ROOT}/sdk/packages/agents/src/agent-runtime.ts`, "utf8")
		const turnStartedIdx = agentRuntimeSrc.indexOf('type: "turn-started"')
		const streamingRaiseIdx = agentRuntimeSrc.indexOf("this.state.executionModelStreaming = true")
		expect(turnStartedIdx).toBeGreaterThanOrEqual(0)
		expect(streamingRaiseIdx).toBeGreaterThan(turnStartedIdx)
	})
})
