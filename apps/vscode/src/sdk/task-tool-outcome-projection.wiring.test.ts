/**
 * ACT-CLINEMM-TASK-HEADER-TOOL-OUTCOME-PROJECTION01
 *
 * END-TO-END wiring sentinel for the optional TaskHeader tool-outcome
 * projection.
 *
 * The chain this file pins (each link is a real production seam, not a
 * re-implementation):
 *
 *   1. The runtime fires `onToolRuntimeOutcome` with the AUTHORITATIVE
 *      `ToolRuntimeOutcome` and the tool call's own `toolCallId`.
 *   2. The SDK's hook merges PRESERVE that observation hook (the two
 *      chokepoints that used to drop it are pinned by the SDK-side
 *      tests in `sdk/packages/core`).
 *   3. `SdkSessionConfigBuilder` attaches the host observer to the
 *      session's hook bag.
 *   4. `SdkController` correlates the outcome to the tool START BY ID
 *      and records it on the host-owned `TaskTelemetryTracker`.
 *   5. `TaskTelemetryTracker` projects the OPTIONAL `outcomes` summary
 *      on the wire strip, conserving against `toolCalls`.
 *
 * The test exercises links 1, 4 and 5 against the REAL production
 * classes (`TaskTelemetryTracker`, `classifyToolOutcomeKind`) and
 * pins links 2 and 3 structurally (the SDK merge lives in another
 * package and is pinned by its own test suites).
 *
 * EVIDENCE QUALIFICATION:
 *   REAL_TRACKER_PROJECTION = YES
 *   REAL_CLASSIFIER = YES
 *   STRUCTURAL_WIRING_SENTINEL = YES
 *   LIVE_UI_ACCEPTANCE = NOT_EXECUTED (requires a live VS Code host)
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, expect, it } from "vitest"
import { classifyToolOutcomeKind, TaskTelemetryTracker } from "./task-telemetry-tracker"

const SdkControllerPath = path.resolve(__dirname, "SdkController.ts")
const SdkControllerSource = fs.readFileSync(SdkControllerPath, "utf8")
const SessionConfigBuilderPath = path.resolve(__dirname, "sdk-session-config-builder.ts")
const SessionConfigBuilderSource = fs.readFileSync(SessionConfigBuilderPath, "utf8")

describe("ACT-CLINEMM-TASK-HEADER-TOOL-OUTCOME-PROJECTION01 / end-to-end wiring", () => {
	it("WIRE-01: the tool START is recorded WITH its authoritative tool-call id", () => {
		const tracker = new TaskTelemetryTracker()
		tracker.startTask("task-a")
		tracker.recordToolStartedWithId("call-1", "read_files")

		const snap = tracker.get()
		expect(snap?.toolCalls).toBe(1)
		expect(snap?.outcomes?.total).toBe(1)
		expect(snap?.outcomes?.pending).toBe(1)
	})

	it("WIRE-02: the authoritative runtime outcome correlates BY ID and conserves", () => {
		const tracker = new TaskTelemetryTracker()
		tracker.startTask("task-a")
		tracker.recordToolStartedWithId("call-1", "read_files")
		tracker.recordToolStartedWithId("call-2", "run_commands")
		// The runtime's OWN kind spelling.
		tracker.recordToolOutcome("call-1", "success")
		tracker.recordToolOutcome("call-2", "control_plane")

		const snap = tracker.get()
		expect(snap?.outcomes).toEqual({
			total: 2,
			succeeded: 1,
			failed: 0,
			pending: 0,
			controlPlane: 1,
			unknown: 0,
		})
		expect(snap?.outcomes?.total).toBe(snap?.toolCalls)
	})

	it("WIRE-03: the runtime and wire kind spellings never disagree", () => {
		expect(classifyToolOutcomeKind("success")).toBe("succeeded")
		expect(classifyToolOutcomeKind("succeeded")).toBe("succeeded")
		expect(classifyToolOutcomeKind("failure")).toBe("failed")
		expect(classifyToolOutcomeKind("failed")).toBe("failed")
		expect(classifyToolOutcomeKind("control_plane")).toBe("control_plane")
		expect(classifyToolOutcomeKind("nonsense")).toBe("unknown")
	})

	it("WIRE-04: a control-plane denial is NEVER counted as a success or a failure", () => {
		const tracker = new TaskTelemetryTracker()
		tracker.startTask("task-a")
		tracker.recordToolStartedWithId("call-1", "run_commands")
		tracker.recordToolOutcome("call-1", "control_plane")

		const snap = tracker.get()
		expect(snap?.outcomes?.succeeded).toBe(0)
		expect(snap?.outcomes?.failed).toBe(0)
		expect(snap?.outcomes?.controlPlane).toBe(1)
	})

	it("WIRE-05: the projection is ABSENT (not zero-filled) before any tool start", () => {
		const tracker = new TaskTelemetryTracker()
		tracker.startTask("task-a")
		expect(tracker.get()?.outcomes).toBeUndefined()
	})

	it("WIRE-06: SdkController records the tool start WITH its id (no double-count)", () => {
		// The production seam must call the COMBINED recorder, not the
		// name-only one — otherwise the tool start would either be
		// double-counted or lose its correlation anchor.
		expect(SdkControllerSource).toMatch(/recordToolStartedWithId\(\s*event\.toolCallId\s*,\s*event\.toolName\s*\)/)
		// The name-only recorder must NOT also be called on the same path.
		expect(SdkControllerSource).not.toMatch(/recordToolStartedWithName\(\s*event\.toolName\s*\)/)
	})

	it("WIRE-07: SdkController correlates the runtime outcome BY ID onto the tracker", () => {
		expect(SdkControllerSource).toMatch(/onToolRuntimeOutcome:\s*\(context\)\s*=>/)
		expect(SdkControllerSource).toMatch(/recordToolOutcome\(\s*toolCallId\s*,\s*outcome\.kind\s*\)/)
	})

	it("WIRE-08: SdkSessionConfigBuilder attaches the observation hook to the session hook bag", () => {
		expect(SessionConfigBuilderSource).toMatch(/onToolRuntimeOutcome:\s*\(context\)\s*=>/)
		// The observation hook must be attached to the SAME bag as the
		// file-hook adapter so the SDK's merge fans it out.
		expect(SessionConfigBuilderSource).toMatch(/config\.hooks\s*=\s*\{/)
	})
})
