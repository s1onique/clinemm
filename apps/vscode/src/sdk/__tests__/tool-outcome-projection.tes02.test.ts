/**
 * ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-OUTCOME-PROJECTION01 (TES-OUT-01)
 *
 * RED + GREEN suite for the bounded tool-RUNTIME-OUTCOME projection that
 * the TaskHeader renders next to the existing V1 mechanism strip.
 *
 * Load-bearing facts this suite pins (all established empirically against
 * the REAL `AgentRuntime`):
 *
 *   1. `AgentRuntime` emits `tool-started` for EVERY prepared tool call,
 *      INCLUDING the pre-execution control-plane paths (policy-disabled,
 *      host DENY, user reject). The canonical `content_start(tool)` event
 *      the host counts therefore DOES include those calls.
 *   2. `onToolRuntimeOutcome` fires EXACTLY ONCE per tool invocation and
 *      carries the SAME `toolCallId` as the corresponding `tool-started`.
 *   3. `ToolRuntimeOutcome.kind` is the authoritative terminal verdict:
 *      `success` | `failure` | `control_plane`.
 *
 * The projection is therefore a JOIN of two authoritative facts:
 *   counted tool start (identity = `toolCallId`)
 *   + typed terminal runtime outcome (identity = `toolCallId`)
 *
 * No shell-text parsing, no name heuristics, no prose scraping.
 */
import type { ToolRuntimeOutcome } from "@cline/shared"
import { describe, expect, it } from "vitest"
import { TaskTelemetryTracker } from "../task-telemetry-tracker"

/**
 * Build a REAL typed `ToolRuntimeOutcome` value. The shapes below are the
 * production discriminants from
 * `sdk/packages/shared/src/agents/recovery/types.ts` — they are not
 * invented by the test.
 */
function successOutcome(toolCallId: string, toolName = "read_files"): ToolRuntimeOutcome {
	return { kind: "success", toolName, toolCallId }
}

function failureOutcome(toolCallId: string, toolName = "read_files"): ToolRuntimeOutcome {
	return {
		kind: "failure",
		toolName,
		toolCallId,
		failureClass: "tool_execution_error",
		stableCode: "unknown",
		familyConfidence: "fallback",
		familyEligible: false,
	}
}

function controlPlaneOutcome(toolCallId: string, toolName = "run_commands"): ToolRuntimeOutcome {
	return { kind: "control_plane", outcome: "host_policy_denied", toolName, toolCallId }
}

describe("ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-OUTCOME-PROJECTION01 / tool outcome projection", () => {
	it("TESOUT-01 (RED): three counted starts + one success + one failure + one pending projects to 1/1/1/0", () => {
		const tracker = new TaskTelemetryTracker()
		tracker.startTask("task-a", 1_700_000_000_000)

		// Three canonical tool starts (the host observes `content_start(tool)`).
		tracker.recordToolStartedWithIdentity("read_files", "call-1")
		tracker.recordToolStartedWithIdentity("read_files", "call-2")
		tracker.recordToolStartedWithIdentity("run_commands", "call-3")

		// Two authoritative terminal outcomes.
		tracker.recordToolRuntimeOutcome(successOutcome("call-1"))
		tracker.recordToolRuntimeOutcome(failureOutcome("call-2"))

		// `call-3` never reached a terminal outcome.
		const strip = tracker.get()
		expect(strip?.toolCalls).toBe(3)
		expect(strip?.outcome).toEqual({
			succeeded: 1,
			failed: 1,
			pending: 1,
			unknown: 0,
		})
	})

	it("TESOUT-02: the outcome projection is conserved against toolCalls", () => {
		const tracker = new TaskTelemetryTracker()
		tracker.startTask("task-a")
		tracker.recordToolStartedWithIdentity("read_files", "c1")
		tracker.recordToolStartedWithIdentity("read_files", "c2")
		tracker.recordToolStartedWithIdentity("read_files", "c3")
		tracker.recordToolRuntimeOutcome(successOutcome("c1"))
		tracker.recordToolRuntimeOutcome(failureOutcome("c2"))
		tracker.recordToolRuntimeOutcome(controlPlaneOutcome("c3"))
		const outcome = tracker.get()?.outcome
		expect(outcome).toBeDefined()
		const sum = (outcome?.succeeded ?? 0) + (outcome?.failed ?? 0) + (outcome?.pending ?? 0) + (outcome?.unknown ?? 0)
		expect(sum).toBe(tracker.get()?.toolCalls)
	})

	it("TESOUT-03: a start without a stable identity is classified unknown, never joined chronologically", () => {
		const tracker = new TaskTelemetryTracker()
		tracker.startTask("task-a")
		tracker.recordToolStartedWithName("read_files")
		tracker.recordToolStartedWithName("read_files")
		// An outcome that arrives later cannot be safely attributed to either
		// start — the tracker must NOT join it.
		tracker.recordToolRuntimeOutcome(successOutcome("no-identity"))
		const outcome = tracker.get()?.outcome
		expect(outcome?.succeeded).toBe(0)
		expect(outcome?.unknown).toBe(2)
		expect(outcome?.pending).toBe(0)
	})

	it("TESOUT-04: a duplicate terminal outcome for the same call does not double count", () => {
		const tracker = new TaskTelemetryTracker()
		tracker.startTask("task-a")
		tracker.recordToolStartedWithIdentity("read_files", "c1")
		tracker.recordToolRuntimeOutcome(successOutcome("c1"))
		tracker.recordToolRuntimeOutcome(successOutcome("c1"))
		const outcome = tracker.get()?.outcome
		expect(outcome?.succeeded).toBe(1)
		expect(outcome?.pending).toBe(0)
		expect(outcome?.unknown).toBe(0)
	})

	it("TESOUT-05: a foreign outcome cannot discharge local pending work", () => {
		const tracker = new TaskTelemetryTracker()
		tracker.startTask("task-a")
		tracker.recordToolStartedWithIdentity("read_files", "local-1")
		// A terminal outcome from a different session / task identity.
		tracker.recordToolRuntimeOutcome(successOutcome("foreign-1"))
		const outcome = tracker.get()?.outcome
		expect(outcome?.succeeded).toBe(0)
		expect(outcome?.pending).toBe(1)
		expect(outcome?.failed).toBe(0)
		expect(outcome?.unknown).toBe(0)
	})

	it("TESOUT-06: parallel siblings attribute independently", () => {
		const tracker = new TaskTelemetryTracker()
		tracker.startTask("task-a")
		tracker.recordToolStartedWithIdentity("read_files", "p1")
		tracker.recordToolStartedWithIdentity("read_files", "p2")
		tracker.recordToolStartedWithIdentity("read_files", "p3")
		tracker.recordToolRuntimeOutcome(failureOutcome("p2"))
		tracker.recordToolRuntimeOutcome(successOutcome("p1"))
		const outcome = tracker.get()?.outcome
		expect(outcome?.succeeded).toBe(1)
		expect(outcome?.failed).toBe(1)
		expect(outcome?.pending).toBe(1)
	})

	it("TESOUT-07: a control-plane outcome is neither success nor failure", () => {
		const tracker = new TaskTelemetryTracker()
		tracker.startTask("task-a")
		tracker.recordToolStartedWithIdentity("run_commands", "c1")
		tracker.recordToolRuntimeOutcome(controlPlaneOutcome("c1"))
		const outcome = tracker.get()?.outcome
		expect(outcome?.succeeded).toBe(0)
		expect(outcome?.failed).toBe(0)
		expect(outcome?.pending).toBe(0)
		expect(outcome?.unknown).toBe(1)
	})

	it("TESOUT-08: same-task continuation preserves the cumulative projection", () => {
		const tracker = new TaskTelemetryTracker()
		tracker.startTask("task-a", 1_700_000_000_000)
		tracker.recordToolStartedWithIdentity("read_files", "c1")
		tracker.recordToolRuntimeOutcome(successOutcome("c1"))
		const before = tracker.get()?.outcome
		tracker.startTask("task-a", 1_700_000_000_500)
		const after = tracker.get()?.outcome
		expect(after).toEqual(before)
		expect(after?.succeeded).toBe(1)
	})

	it("TESOUT-09: a new task identity resets the projection", () => {
		const tracker = new TaskTelemetryTracker()
		tracker.startTask("task-a")
		tracker.recordToolStartedWithIdentity("read_files", "c1")
		tracker.recordToolRuntimeOutcome(successOutcome("c1"))
		tracker.startTask("task-b")
		const outcome = tracker.get()?.outcome
		expect(outcome?.succeeded).toBe(0)
		expect(outcome?.failed).toBe(0)
		expect(outcome?.pending).toBe(0)
		expect(outcome?.unknown).toBe(0)
		expect(tracker.get()?.toolCalls).toBe(0)
	})

	it("TESOUT-10: the legacy no-argument recordToolStarted() still increments toolCalls", () => {
		const tracker = new TaskTelemetryTracker()
		tracker.startTask("task-a")
		tracker.recordToolStarted()
		expect(tracker.get()?.toolCalls).toBe(1)
		expect(tracker.get()?.outcome?.unknown).toBe(1)
	})

	it("TESOUT-11: the mechanism projection is untouched by the outcome projection", () => {
		const tracker = new TaskTelemetryTracker()
		tracker.startTask("task-a")
		tracker.recordToolStartedWithIdentity("read_files", "c1")
		tracker.recordToolStartedWithIdentity("run_commands", "c2")
		tracker.recordToolRuntimeOutcome(successOutcome("c1"))
		const mechanism = tracker.get()?.mechanism
		expect(mechanism?.total).toBe(2)
		expect(mechanism?.read).toBe(1)
		expect(mechanism?.command).toBe(1)
	})

	it("TESOUT-12: an outcome observed before any task is ignored", () => {
		const tracker = new TaskTelemetryTracker()
		tracker.recordToolRuntimeOutcome(successOutcome("c1"))
		expect(tracker.get()).toBeUndefined()
	})
})

/**
 * ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-OUTCOME-PROJECTION01:
 * the semantic boundary between the RUNTIME tool outcome and the
 * SUBPROCESS exit status.
 *
 * A `run_commands` invocation can succeed as a runtime tool operation
 * even when the underlying subprocess exits nonzero. V2 reports the
 * TYPED RUNTIME OUTCOME, never the subprocess exit status. The
 * projection therefore MUST NOT invent a failure for a nonzero shell
 * exit, and MUST NOT claim the shell exited 0.
 */
describe("ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-OUTCOME-PROJECTION01 / runtime vs subprocess boundary", () => {
	it("TESOUT-13: a runtime-success run_commands is `succeeded` regardless of the shell exit status", () => {
		const tracker = new TaskTelemetryTracker()
		tracker.startTask("task-a")
		tracker.recordToolStartedWithIdentity("run_commands", "shell-1")
		// The runtime executed the tool successfully. The shell process
		// exit status is NOT part of the typed runtime outcome and MUST
		// NOT be consulted here.
		tracker.recordToolRuntimeOutcome(successOutcome("shell-1", "run_commands"))
		const outcome = tracker.get()?.outcome
		expect(outcome?.succeeded).toBe(1)
		expect(outcome?.failed).toBe(0)
		expect(outcome?.pending).toBe(0)
		expect(outcome?.unknown).toBe(0)
	})

	it("TESOUT-14: the projection carries no subprocess-exit metadata", () => {
		const tracker = new TaskTelemetryTracker()
		tracker.startTask("task-a")
		tracker.recordToolStartedWithIdentity("run_commands", "shell-1")
		tracker.recordToolRuntimeOutcome(successOutcome("shell-1", "run_commands"))
		const outcome = tracker.get()?.outcome
		// Exactly the four frozen buckets — no exit code, no signal, no
		// duration, no effect class.
		expect(Object.keys(outcome ?? {}).sort()).toEqual(["failed", "pending", "succeeded", "unknown"])
	})

	it("TESOUT-15: a legacy host that never observed an identity keeps the projection conserved", () => {
		const tracker = new TaskTelemetryTracker()
		tracker.startTask("task-a")
		// Legacy no-identity path (the pre-V2 production shape).
		tracker.recordToolStartedWithName("run_commands")
		tracker.recordToolStartedWithName("run_commands")
		const outcome = tracker.get()?.outcome
		expect(outcome?.unknown).toBe(2)
		expect(
			(outcome?.succeeded ?? 0) + (outcome?.failed ?? 0) + (outcome?.pending ?? 0) + (outcome?.unknown ?? 0),
		).toBe(tracker.get()?.toolCalls)
	})
})
