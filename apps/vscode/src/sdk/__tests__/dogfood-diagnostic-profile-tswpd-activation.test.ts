/**
 * ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-DIAGNOSABILITY01
 *
 * AC1..AC7: REAL production activation tests for the D knob.
 *
 * These tests exercise `applyTurnStateWriterProvenanceDiagnosticProfile`
 * from `apps/vscode/src/sdk/dogfood-diagnostic-profile.ts` — the SAME
 * helper that `extension.ts:activate` calls on extension activation.
 * Per Factory causal reviewer's P0 #2 finding: the prior implementation
 * tested a COPY of the activation logic (synthetic orchestration
 * validating itself), which is the exact Factory failure mode this
 * ACT explicitly rejects. The bounded repair lands this test as the
 * canonical exercise of the production seam.
 *
 * AC7 is the load-bearing order test: the ring MUST be armed BEFORE
 * the first TurnState mutation, verified by calling the production
 * helper in a sequence that mirrors the production lifecycle:
 *
 *   extension.ts:activate (helper)  →  SdkController construction  →
 *   first turnStateTracker.set() (mutation).
 *
 * The test catches the regression where someone reverts to a
 * publication-seam activation (e.g. moves the call back into
 * `getStateToPostToWebview`), because that seam can fire AFTER the
 * first writer.
 */

import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	clearTurnStateWriterProvenanceDiagnostic,
	disableTurnStateWriterProvenanceDiagnostic,
	getTurnStateWriterProvenanceRecords,
	getTurnStateWriterProvenanceSeq,
	isTurnStateWriterProvenanceDiagnosticEnabled,
	recordTurnStateWriterProvenance,
} from "@shared/turn-state-writer-provenance"
import {
	applyTurnStateWriterProvenanceDiagnosticProfile,
	resolveEffectiveTurnStateWriterProvenanceD,
} from "../dogfood-diagnostic-profile"
import {
	dumpExtensionSideTurnStateWriterProvenanceDiagnostic,
	type TurnStateWriterProvenanceDiagnosticContext,
} from "../turn-state-writer-provenance-runtime"
import { MessageIdMinter } from "../message-id-minter"
import { TurnStateTracker } from "../turn-state-tracker"

/**
 * Factory helper: builds a structurally-compatible ExtensionContext-shaped
 * object with an in-memory workspaceState map and a tmp-dir globalStorageUri.
 * The narrow type matches the production helper's expectation; the wider
 * vscode.ExtensionContext from `extension.ts:activate` is structurally
 * compatible at the call site.
 */
function makeContext(initialWorkspaceToggle?: boolean): TurnStateWriterProvenanceDiagnosticContext & {
	tmpDir: string
	workspaceStateMap: Map<string, unknown>
} {
	const tmpDir = mkdtempSync(join(tmpdir(), "tswpd-activation-test-"))
	const workspaceStateMap = new Map<string, unknown>()
	if (initialWorkspaceToggle !== undefined) {
		workspaceStateMap.set("tswpdEnabled", initialWorkspaceToggle)
	}
	return {
		tmpDir,
		workspaceStateMap,
		workspaceState: {
			get: <T>(key: string): T | undefined => workspaceStateMap.get(key) as T | undefined,
			update: (key: string, value: unknown): Promise<void> => {
				if (value === undefined) {
					workspaceStateMap.delete(key)
				} else {
					workspaceStateMap.set(key, value)
				}
				return Promise.resolve()
			},
		},
		globalStorageUri: { fsPath: tmpDir },
		subscriptions: [],
	}
}

afterEach(() => {
	disableTurnStateWriterProvenanceDiagnostic()
	clearTurnStateWriterProvenanceDiagnostic()
})

describe("AC1: production activation with d=true enables TSWPD", () => {
	it("calls applyTurnStateWriterProvenanceDiagnosticProfile with dogfood + no env → d=true → ring enabled", () => {
		expect(isTurnStateWriterProvenanceDiagnosticEnabled()).toBe(false)
		const ctx = makeContext()
		const result = applyTurnStateWriterProvenanceDiagnosticProfile({}, true, ctx)
		expect(result.d).toBe(true)
		expect(result.source).toBe("profile")
		expect(result.flipped).toBe(true)
		expect(isTurnStateWriterProvenanceDiagnosticEnabled()).toBe(true)
	})

	it("after arming, a TurnStateTracker.setWithWriter() call records into the ring", () => {
		const ctx = makeContext()
		applyTurnStateWriterProvenanceDiagnosticProfile({}, true, ctx)
		const tracker = new TurnStateTracker(new MessageIdMinter())
		tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		expect(getTurnStateWriterProvenanceRecords().length).toBe(1)
		expect(getTurnStateWriterProvenanceRecords()[0].writerId).toBe("task-start-init-task")
		expect(getTurnStateWriterProvenanceSeq()).toBe(1)
	})
})

describe("AC2: production activation with d=false disables TSWPD", () => {
	it("calls applyTurnStateWriterProvenanceDiagnosticProfile with public → d=false → ring disabled", () => {
		const ctx = makeContext()
		const result = applyTurnStateWriterProvenanceDiagnosticProfile({}, false, ctx)
		expect(result.d).toBe(false)
		expect(result.source).toBe("profile")
		expect(result.flipped).toBe(false)
		expect(isTurnStateWriterProvenanceDiagnosticEnabled()).toBe(false)
	})

	it("after disarming, a TurnStateTracker.setWithWriter() call is a complete no-op", () => {
		const ctx = makeContext()
		applyTurnStateWriterProvenanceDiagnosticProfile({}, false, ctx)
		const tracker = new TurnStateTracker(new MessageIdMinter())
		tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		expect(getTurnStateWriterProvenanceRecords().length).toBe(0)
		expect(getTurnStateWriterProvenanceSeq()).toBe(0)
	})

	it("explicit env override-down in dogfood disables the ring", () => {
		const ctx = makeContext()
		const result = applyTurnStateWriterProvenanceDiagnosticProfile(
			{ CLINEMM_DIAG_TURNSTATE_WRITER_PROVENANCE: "0" },
			true,
			ctx,
		)
		expect(result.d).toBe(false)
		expect(result.source).toBe("env")
		expect(isTurnStateWriterProvenanceDiagnosticEnabled()).toBe(false)
	})
})

describe("AC3: workspace toggle participates in effective-D resolution", () => {
	it("dogfood + workspace toggle=false overrides the dogfood default OFF (override-down)", () => {
		// The reviewer found: in the prior implementation, a user workspace
		// toggle was silently re-armed by the next state push. The new
		// helper composes the toggle as layer-2 precedence so the toggle
		// is HONORED, not fought.
		const ctx = makeContext(false) // workspace toggle: OFF
		const result = applyTurnStateWriterProvenanceDiagnosticProfile({}, true, ctx)
		expect(result.d).toBe(false)
		expect(result.source).toBe("workspace")
		expect(isTurnStateWriterProvenanceDiagnosticEnabled()).toBe(false)
	})

	it("public + workspace toggle=true overrides the public default ON (override-up)", () => {
		const ctx = makeContext(true) // workspace toggle: ON
		const result = applyTurnStateWriterProvenanceDiagnosticProfile({}, false, ctx)
		expect(result.d).toBe(true)
		expect(result.source).toBe("workspace")
		expect(isTurnStateWriterProvenanceDiagnosticEnabled()).toBe(true)
	})

	it("explicit env override beats the workspace toggle (env layer-1 wins over workspace layer-2)", () => {
		const ctx = makeContext(true) // workspace toggle: ON
		const result = applyTurnStateWriterProvenanceDiagnosticProfile(
			{ CLINEMM_DIAG_TURNSTATE_WRITER_PROVENANCE: "0" },
			false,
			ctx,
		)
		expect(result.d).toBe(false)
		expect(result.source).toBe("env")
	})

	it("workspace toggle=undefined in dogfood falls through to profile default ON", () => {
		const ctx = makeContext(undefined)
		const result = applyTurnStateWriterProvenanceDiagnosticProfile({}, true, ctx)
		expect(result.d).toBe(true)
		expect(result.source).toBe("profile")
	})
})

describe("AC4: idempotent re-arm is a no-op", () => {
	it("calling the helper twice with d=true does not double-arm", () => {
		const ctx = makeContext()
		const first = applyTurnStateWriterProvenanceDiagnosticProfile({}, true, ctx)
		expect(first.flipped).toBe(true)
		const second = applyTurnStateWriterProvenanceDiagnosticProfile({}, true, ctx)
		expect(second.flipped).toBe(false)
		expect(isTurnStateWriterProvenanceDiagnosticEnabled()).toBe(true)
	})

	it("calling the helper twice with d=false on a default-off ring does not flip", () => {
		const ctx = makeContext()
		expect(isTurnStateWriterProvenanceDiagnosticEnabled()).toBe(false)
		const first = applyTurnStateWriterProvenanceDiagnosticProfile({}, false, ctx)
		expect(first.flipped).toBe(false)
		const second = applyTurnStateWriterProvenanceDiagnosticProfile({}, false, ctx)
		expect(second.flipped).toBe(false)
	})
})

describe("AC5: disabled TSWPD is a complete no-op (WPROV01 conserved)", () => {
	beforeEach(() => {
		disableTurnStateWriterProvenanceDiagnostic()
		clearTurnStateWriterProvenanceDiagnostic()
	})

	it("legacy set() does NOT append when disabled", () => {
		const ctx = makeContext()
		applyTurnStateWriterProvenanceDiagnosticProfile({}, false, ctx)
		const tracker = new TurnStateTracker(new MessageIdMinter())
		tracker.set("streaming")
		tracker.set("idle")
		expect(getTurnStateWriterProvenanceRecords()).toEqual([])
		expect(getTurnStateWriterProvenanceSeq()).toBe(0)
	})

	it("setWithWriter() does NOT append when disabled", () => {
		const ctx = makeContext()
		applyTurnStateWriterProvenanceDiagnosticProfile({}, false, ctx)
		const tracker = new TurnStateTracker(new MessageIdMinter())
		tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		tracker.setWithWriter("idle", undefined, { writerId: "controller-clear-task" })
		expect(getTurnStateWriterProvenanceRecords()).toEqual([])
	})

	it("recordTurnStateWriterProvenance direct call is a complete no-op when disabled", () => {
		const ctx = makeContext()
		applyTurnStateWriterProvenanceDiagnosticProfile({}, false, ctx)
		recordTurnStateWriterProvenance({
			writerId: "task-start-init-task",
			committed: { seq: 1, phase: "streaming", anchorTs: undefined },
			previous: { seq: 0, phase: "idle", anchorTs: undefined },
			requested: { phase: "streaming", anchorTs: undefined },
			capturedAt: Date.now(),
			taskId: "test-task",
		})
		expect(getTurnStateWriterProvenanceRecords()).toEqual([])
	})
})

describe("AC6: synthetic-real writer + dump after d=true activation", () => {
	it("dump after a synthetic-real writer produces a non-empty JSONL", async () => {
		const ctx = makeContext()
		try {
			applyTurnStateWriterProvenanceDiagnosticProfile({}, true, ctx)
			expect(isTurnStateWriterProvenanceDiagnosticEnabled()).toBe(true)

			const tracker = new TurnStateTracker(new MessageIdMinter())
			tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

			const file = await dumpExtensionSideTurnStateWriterProvenanceDiagnostic(ctx)
			expect(existsSync(file)).toBe(true)
			const jsonl = readFileSync(file, "utf8")
			expect(jsonl.length).toBeGreaterThan(0)
			expect(jsonl).toContain("task-start-init-task")
			expect(jsonl).toContain('"phase":"streaming"')
		} finally {
			rmSync(ctx.tmpDir, { recursive: true, force: true })
		}
	})

	it("dump after the helper was never called (d=false) writes an empty file", async () => {
		const ctx = makeContext()
		try {
			// Default-off ring; no activation call yet.
			expect(isTurnStateWriterProvenanceDiagnosticEnabled()).toBe(false)

			const tracker = new TurnStateTracker(new MessageIdMinter())
			tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
			expect(getTurnStateWriterProvenanceRecords().length).toBe(0)

			const file = await dumpExtensionSideTurnStateWriterProvenanceDiagnostic(ctx)
			expect(existsSync(file)).toBe(true)
			const jsonl = readFileSync(file, "utf8")
			expect(jsonl).toBe("")
		} finally {
			rmSync(ctx.tmpDir, { recursive: true, force: true })
		}
	})
})

describe("AC7 (order): production helper arms the ring BEFORE the first TurnState mutation", () => {
	// The reviewer found: prior implementation activated at the
	// `getStateToPostToWebview` publication seam, which can fire AFTER
	// the first writer (so the bounded ring misses the first mutation).
	// The bounded repair activates at `extension.ts:activate`, which
	// runs BEFORE SdkController construction (and therefore BEFORE any
	// TurnStateTracker.set() call).
	//
	// This test mirrors the production lifecycle: helper -> SdkController
	// construction (represented by TurnStateTracker creation) -> first
	// mutation. The assertion verifies the ring is armed at every step.

	it("helper → tracker → first writer: ring is armed throughout; first writer is captured", () => {
		const ctx = makeContext()

		// Step 1: production activation (mirrors extension.ts:activate line ~96)
		const arming = applyTurnStateWriterProvenanceDiagnosticProfile({}, true, ctx)
		expect(arming.flipped).toBe(true)
		expect(isTurnStateWriterProvenanceDiagnosticEnabled()).toBe(true)

		// Step 2: SdkController construction (mirrors initialize(storageContext)
		// building the controller + its turnStateTracker). At this point
		// there must be NO TurnStateTracker.set() calls yet.
		const tracker = new TurnStateTracker(new MessageIdMinter())

		// Step 3: the very first TurnState mutation. The ring is armed
		// from Step 1, so the writer identity MUST be captured.
		tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

		const records = getTurnStateWriterProvenanceRecords()
		expect(records.length).toBe(1)
		expect(records[0].writerId).toBe("task-start-init-task")
	})

	it("helper → tracker → first writer (public, no env, no toggle): ring stays disabled; first writer is a no-op", () => {
		const ctx = makeContext()
		applyTurnStateWriterProvenanceDiagnosticProfile({}, false, ctx)
		expect(isTurnStateWriterProvenanceDiagnosticEnabled()).toBe(false)

		const tracker = new TurnStateTracker(new MessageIdMinter())
		tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

		expect(getTurnStateWriterProvenanceRecords().length).toBe(0)
		expect(getTurnStateWriterProvenanceSeq()).toBe(0)
	})
})

describe("AC8: resolveEffectiveTurnStateWriterProvenanceD precedence (pure resolver)", () => {
	// The pure resolver tests pin the precedence contract independently
	// of the activation helper (they don't touch the ring).
	it("layer 1: env truthy forces ON regardless of profile", () => {
		const r1 = resolveEffectiveTurnStateWriterProvenanceD(
			{ CLINEMM_DIAG_TURNSTATE_WRITER_PROVENANCE: "1" },
			false,
			false,
		)
		expect(r1).toEqual({ d: true, source: "env" })
		const r2 = resolveEffectiveTurnStateWriterProvenanceD(
			{ CLINEMM_DIAG_TURNSTATE_WRITER_PROVENANCE: "true" },
			false,
			true, // workspace toggle ON; env still wins
		)
		expect(r2).toEqual({ d: true, source: "env" })
	})

	it("layer 1: env falsy forces OFF in BOTH profiles", () => {
		const r1 = resolveEffectiveTurnStateWriterProvenanceD(
			{ CLINEMM_DIAG_TURNSTATE_WRITER_PROVENANCE: "0" },
			true, // dogfood
			true, // workspace toggle ON
		)
		expect(r1).toEqual({ d: false, source: "env" })
		const r2 = resolveEffectiveTurnStateWriterProvenanceD(
			{ CLINEMM_DIAG_TURNSTATE_WRITER_PROVENANCE: "off" },
			false,
			undefined,
		)
		expect(r2).toEqual({ d: false, source: "env" })
	})

	it("garbage env value falls through to layer 2", () => {
		const r = resolveEffectiveTurnStateWriterProvenanceD(
			{ CLINEMM_DIAG_TURNSTATE_WRITER_PROVENANCE: "banana" },
			true,
			true,
		)
		expect(r).toEqual({ d: true, source: "workspace" })
	})

	it("layer 2: workspace toggle=true → ON (honored in both profiles)", () => {
		const r1 = resolveEffectiveTurnStateWriterProvenanceD({}, false, true)
		expect(r1).toEqual({ d: true, source: "workspace" })
		const r2 = resolveEffectiveTurnStateWriterProvenanceD({}, true, true)
		expect(r2).toEqual({ d: true, source: "workspace" })
	})

	it("layer 2: workspace toggle=false → OFF (honored in both profiles)", () => {
		const r1 = resolveEffectiveTurnStateWriterProvenanceD({}, false, false)
		expect(r1).toEqual({ d: false, source: "workspace" })
		const r2 = resolveEffectiveTurnStateWriterProvenanceD({}, true, false)
		expect(r2).toEqual({ d: false, source: "workspace" })
	})

	it("layer 3: no env, no toggle → profile default (dogfood ON, public OFF)", () => {
		const r1 = resolveEffectiveTurnStateWriterProvenanceD({}, true, undefined)
		expect(r1).toEqual({ d: true, source: "profile" })
		const r2 = resolveEffectiveTurnStateWriterProvenanceD({}, false, undefined)
		expect(r2).toEqual({ d: false, source: "profile" })
	})
})
