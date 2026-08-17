/**
 * ACT-CLINEMM-DOGFOOD-CORRECTION04-CLOSE01:
 *
 * Structural wiring sentinel for the C04 root cause.
 *
 * C04 root cause: `SdkController.getStateToPostToWebview()` projected
 * the canonical `turnState` field but omitted `taskTelemetry`. The
 * host-side `TaskTelemetryTracker` was alive and accumulating, yet the
 * webview always received `undefined` for the telemetry strip — which
 * is exactly what manifests as "—" in the Task Header. Component,
 * render, and CSS were all exonerated in the C04 investigation; the
 * missing field on the canonical state producer was the single
 * defect.
 *
 * This file does NOT exercise `getStateToPostToWebview()` end-to-end
 * (instantiating a full `Controller` is expensive and would just
 * re-implement the same projection the production code performs).
 * Instead it pins the projection with four structural witnesses:
 *
 *   1. SOURCE_REGEX_SENTINEL — the literal line
 *        `taskTelemetry: this.taskTelemetry.get(),`
 *      exists in `SdkController.ts`. Removing it makes this file's
 *      first `it()` fail, which is the regression guard the
 *      reviewer asked for.
 *
 *   2. RETURN-BLOCK WITNESS — the projection line lives inside the
 *      `return { ... }` object literal (not in a sibling block).
 *
 *   3. WIRE-TYPE WITNESS — the `taskTelemetry` field on
 *      `ExtensionState` is the canonical `TaskHeaderTelemetryStrip`
 *      shape, so host and webview share the same wire type.
 *
 *   4. PURE_PROJECTION — `TaskTelemetryTracker.get()` returns the
 *      `undefined`-or-`TaskHeaderTelemetryStrip` shape required by
 *      the wire field.
 *
 * EVIDENCE QUALIFICATION:
 *
 *   REAL_CONTROLLER_VERTICAL = NOT_EXECUTED
 *   STRUCTURAL_WIRING_SENTINEL = YES
 *   PURE_TRACKER_PROJECTION = YES
 *   LIVE_DOGFOOD_VERTICAL = required for final acceptance
 *
 * M9 mutation-proof: the SOURCE_REGEX_SENTINEL would fail if a
 * future refactor removes the `taskTelemetry: this.taskTelemetry.get(),`
 * line from `SdkController.getStateToPostToWebview()`. To verify:
 * remove that line and re-run; this file's first `it()` must fail.
 */
import * as fs from "node:fs"
import * as path from "node:path"
import type { ExtensionState, TaskHeaderTelemetryStrip } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { TaskTelemetryTracker } from "./task-telemetry-tracker"

const SdkControllerPath = path.resolve(__dirname, "SdkController.ts")
const SdkControllerSource = fs.readFileSync(SdkControllerPath, "utf8")

function locateGetStateToPostToWebview(source: string): string {
	const start = source.indexOf("async getStateToPostToWebview(): Promise<ExtensionState>")
	if (start < 0) {
		throw new Error("SdkController.getStateToPostToWebview signature not found")
	}
	return source.slice(start)
}

describe("ACT-CLINEMM-DOGFOOD-CORRECTION04-CLOSE01 / structural wiring", () => {
	it("C04-WIRE-1: SdkController.getStateToPostToWebview projects taskTelemetry from the tracker", () => {
		const body = locateGetStateToPostToWebview(SdkControllerSource)
		expect(body).toMatch(/taskTelemetry:\s*this\.taskTelemetry\.get\(\)/)
	})

	it("C04-WIRE-2: the projection is inside the object literal returned by getStateToPostToWebview", () => {
		const body = locateGetStateToPostToWebview(SdkControllerSource)
		const returnBlockMatch = body.match(/return\s*\{([\s\S]*?)\n\s{2,}\}/)
		expect(returnBlockMatch).not.toBeNull()
		const returnBlock = returnBlockMatch?.[1] ?? ""
		expect(returnBlock).toContain("taskTelemetry: this.taskTelemetry.get()")
	})

	it("C04-WIRE-3: tracker.get() returns the strip-or-undefined shape the wire field expects", () => {
		const t = new TaskTelemetryTracker()
		expect(t.get()).toBeUndefined()
		const snap = t.startTask("wiring-1", 1_700_000_000_000) as TaskHeaderTelemetryStrip | undefined
		expect(snap).toBeDefined()
		expect(snap?.startedAt).toBe(1_700_000_000_000)
		expect(snap?.toolCalls).toBe(0)
		expect(snap?.recoveryBudgetFailures).toBe(0)
		expect(snap?.endedAt).toBeUndefined()
	})

	it("C04-WIRE-4: ExtensionState declares taskTelemetry as TaskHeaderTelemetryStrip-or-undefined", () => {
		const extMessagePath = path.resolve(__dirname, "../shared/ExtensionMessage.ts")
		const extMessageSource = fs.readFileSync(extMessagePath, "utf8")
		expect(extMessageSource).toMatch(/taskTelemetry\?:\s*TaskHeaderTelemetryStrip/)
		expect(extMessageSource).toContain("TaskHeaderTelemetryStrip")
	})

	it("C04-WIRE-5: turnState and taskTelemetry are sibling projections on the canonical state", () => {
		const body = locateGetStateToPostToWebview(SdkControllerSource)
		expect(body).toMatch(/turnState:\s*this\.turnStateTracker\.get\(\)/)
		expect(body).toMatch(/taskTelemetry:\s*this\.taskTelemetry\.get\(\)/)
		expect(SdkControllerSource).toMatch(/setGetStateFn\(\(\) => this\.getStateToPostToWebview\(\)\)/)
	})

	it("C04-WIRE-6: a constructed ExtensionState is structurally capable of carrying taskTelemetry", () => {
		const canonicalState: Pick<ExtensionState, "taskTelemetry"> = {
			taskTelemetry: {
				startedAt: 1_700_000_000_000,
				toolCalls: 0,
				recoveryBudgetFailures: 0,
			},
		}
		expect(canonicalState.taskTelemetry?.toolCalls).toBe(0)
	})
})
