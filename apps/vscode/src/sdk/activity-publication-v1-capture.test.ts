/**
 * ACT-CLINEMM-CANCEL-AFFORDANCE-AUTHORITY-RECON — `A` diagnostic
 * probe + diagnostic-profile resolver tests.
 *
 * `A` is the fourth knob in the V/I/A/P diagnostic-profile matrix
 * (`apps/vscode/src/sdk/dogfood-diagnostic-profile.ts`). It is
 * identity-gated (auto-ON in dogfood, OFF in public) and governs the
 * emission of `activity.publication.v1` records at
 * `SdkController.getStateToPostToWebview()`. The gate is enforced
 * mechanically inside the pure builder
 * (`./activity-publication-v1.ts`).
 *
 * Test cases per the bounded ACT contract (revised after the reviewer's
 * P0 #2 finding — A4/A5 are PRODUCTION-SEAM tests against the pure
 * builder, NOT synthetic sink tests against `emitV2Capture`):
 *
 *   A1 dogfood + capture on  -> A=true            (RESOLVER)
 *   A2 public  + capture on  -> A=false           (RESOLVER)
 *   A3 header canonical order = "VIAP"            (FORMATTER)
 *   A4 one publication produces one activity record (BUILDER, production seam)
 *   A5 snapshot-derived fields share publication identity; shadow-derived
 *       fields are recorded with shadowPublicationBinding="UNBOUND" (BUILDER)
 *   S1 sink serializes one record                 (SINK, conservation only)
 *   S2 sink is a no-op when env unset             (SINK, conservation only)
 *   A6 writer failure -> zero state-semantic delta (SINK, conservation only)
 *   A8 existing V/I/P behavior unchanged           (REGRESSION)
 *
 * Evidence labels:
 *   - "RESOLVER" / "FORMATTER" -> proves a specific invariant of the
 *     diagnostic-profile resolver or formatter.
 *   - "BUILDER" -> proves an invariant of the production seam by
 *     exercising the same pure function the production seam calls.
 *   - "SINK" -> proves a conservation property of the V2 capture
 *     sink itself (no-throw on writer failure, no emission when
 *     disabled). NOT proof of the publication contract.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	__resetV2CaptureForTests,
	emitV2Capture,
	isV2CaptureEnabled,
} from "./v2-capture"
import {
	composeEffectiveDiagnosticKnobs,
	formatEffectiveKnobLetters,
	resolveEffectiveDiagnosticKnobs,
} from "./dogfood-diagnostic-profile"
import {
	buildActivityPublicationV1Record,
	type ActivityPublicationSnapshotLike,
} from "./activity-publication-v1"

const EMPTY_PATH: string | null = null
const AUTO_PATH = "/tmp/clinemm-runtime-diag/abc123.jsonl"

/**
 * Helper: build a minimal ActivityPublicationSnapshotLike for the
 * builder tests. Mirrors the shape the production `snapshot` object
 * carries inside `SdkController.getStateToPostToWebview()`.
 */
function makeSnapshot(overrides: Partial<ActivityPublicationSnapshotLike> = {}): ActivityPublicationSnapshotLike {
	return {
		stateVersion: 100,
		epoch: 1,
		currentTaskItem: { id: "task-builder-test" },
		turnState: { phase: "streaming", seq: 1 } as ActivityPublicationSnapshotLike["turnState"],
		thinkingPresentation: {
			modelStreaming: true,
			source: "shadow",
			seq: 1,
		} as unknown as ActivityPublicationSnapshotLike["thinkingPresentation"],
		taskHeaderPresentation: { phase: "streaming", source: "shadow", seq: 1 } as unknown as ActivityPublicationSnapshotLike["taskHeaderPresentation"],
		taskTelemetry: undefined,
		foregroundCommandRunning: false,
		backgroundCommandRunning: false,
		...overrides,
	}
}

describe("A1-A3: diagnostic-profile A knob", () => {
	it("A1: dogfood + auto path -> A=true", () => {
		const knobs = resolveEffectiveDiagnosticKnobs({}, true, AUTO_PATH)
		expect(knobs.a).toBe(true)
	})

	it("A2: public + capture on -> A=false (identity is the SOLE gate)", () => {
		const knobs = resolveEffectiveDiagnosticKnobs({ CLINEMM_DIAG_ACTIVITY_STATE_V1: "1" }, false, EMPTY_PATH)
		expect(knobs.a).toBe(false)
	})

	it("A3: header canonical order = VIAPD when all five knobs are ON", () => {
		// ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-DIAGNOSABILITY01: D
		// joined the canonical order V → I → A → P → D. The A3 test
		// pins the new canonical dogfood initial render "VIAPD";
		// a sibling test in `dogfood-diagnostic-profile.test.ts`
		// pins the pre-D "VIAP" for historical-context preservation.
		const knobs = { v: true, i: true, a: true, p: true, d: true }
		expect(formatEffectiveKnobLetters(knobs)).toBe("VIAPD")
	})
})

describe("A4-A5: production seam (pure builder)", () => {
	it("A4: A=true -> exactly one emit, A=false -> skip (no record)", () => {
		// A4 PROOF: the builder returns kind:"emit" exactly when the A
		// knob is true; otherwise it returns kind:"skip" with a
		// reason. This is the production-seam contract: one
		// publication maps to either one emit or zero emits, never
		// two.
		const snapshot = makeSnapshot({ stateVersion: 3208, epoch: 9 })

		// Gate OPEN: A=true -> emit.
		const opened = buildActivityPublicationV1Record({
			snapshot,
			shadow: undefined,
			knobs: { a: true },
			ptadPushId: 3208,
		})
		expect(opened.kind).toBe("emit")
		if (opened.kind !== "emit") throw new Error("type narrow")
		expect(opened.data.publicationId).toBe(3208)
		expect(opened.data.ptadPushId).toBe(3208)

		// Gate CLOSED: A=false -> skip.
		const closed = buildActivityPublicationV1Record({
			snapshot,
			shadow: undefined,
			knobs: { a: false },
			ptadPushId: 3208,
		})
		expect(closed).toEqual({ kind: "skip", reason: "A_DISABLED" })

		// Gate MISSING: a=undefined -> skip.
		const missing = buildActivityPublicationV1Record({
			snapshot,
			shadow: undefined,
			// Cast to bypass the boolean typecheck — the builder must
			// defend against undefined at runtime because the live
			// resolver shape guarantees a boolean, but the contract
			// must not rely on the type alone.
			knobs: { a: undefined as unknown as boolean },
			ptadPushId: 3208,
		})
		expect(missing).toEqual({ kind: "skip", reason: "A_MISSING" })
	})

	it("A5: snapshot-derived fields share publication identity; shadow fields recorded as UNBOUND", () => {
		// A5 PROOF (revised after the reviewer's P0 #1 finding): the
		// builder does NOT claim the shadow-derived fields belong to
		// the same publication generation. The record explicitly
		// stamps `shadowPublicationBinding` so the post-capture join
		// knows the host-authority fields are observation-only.
		const snapshot = makeSnapshot({
			stateVersion: 4096,
			epoch: 7,
			currentTaskItem: { id: "task-shadow-unbound" },
			turnState: { phase: "streaming", seq: 99 } as ActivityPublicationSnapshotLike["turnState"],
			taskHeaderPresentation: { phase: "streaming", source: "shadow", seq: 99 } as unknown as ActivityPublicationSnapshotLike["taskHeaderPresentation"],
			thinkingPresentation: {
				modelStreaming: true,
				source: "shadow",
				seq: 99,
			} as unknown as ActivityPublicationSnapshotLike["thinkingPresentation"],
			foregroundCommandRunning: true,
			backgroundCommandRunning: false,
		})

		const result = buildActivityPublicationV1Record({
			snapshot,
			shadow: {
				execution: { modelStreaming: true } as never,
				recoveryState: "idle" as never,
				status: "running",
				pendingToolCalls: ["tool-X"],
			},
			knobs: { a: true },
			ptadPushId: 4096,
		})

		expect(result.kind).toBe("emit")
		if (result.kind !== "emit") throw new Error("type narrow")

		// Cross-binding honesty stamp.
		expect(result.shadowPublicationBinding).toBe("UNBOUND")
		expect(result.data.shadowPublicationBinding).toBe("UNBOUND")

		// Publication identity (snapshot-derived, by construction
		// same-publication).
		expect(result.data.publicationId).toBe(4096)
		expect(result.data.ptadPushId).toBe(4096)
		expect(result.data.taskId).toBe("task-shadow-unbound")
		expect(result.data.epoch).toBe(7)

		// Snapshot-derived UI authority fields.
		expect(result.data.taskHeaderPhase).toBe("streaming")
		expect(result.data.taskHeaderSource).toBe("shadow")
		expect(result.data.thinkingModelStreaming).toBe(true)
		expect(result.data.thinkingSource).toBe("shadow")
		expect(result.data.foregroundCommandRunning).toBe(true)
		expect(result.data.backgroundCommandRunning).toBe(false)
		expect(result.data.turnPhase).toBe("streaming")

		// Shadow-derived host authority fields — observed, NOT
		// proven same-generation.
		expect(result.data.hostStatus).toBe("running")
		expect(result.data.modelStreaming).toBe(true)
		expect(result.data.toolActive).toBe(true)

		// Webview-side fields remain LIVE_UNOBSERVABLE.
		expect(result.data.cancelVisible).toBe("LIVE_UNOBSERVABLE")
		expect(result.data.cancelEnabled).toBe("LIVE_UNOBSERVABLE")
		expect(result.data.cancelAuthority).toBe("LIVE_UNOBSERVABLE")
		expect(result.data.composerEnabled).toBe("LIVE_UNOBSERVABLE")
		expect(result.data.lastMessageType).toBe("LIVE_UNOBSERVABLE")
		expect(result.data.lastMessageSay).toBe("LIVE_UNOBSERVABLE")
		expect(result.data.lastMessageAsk).toBe("LIVE_UNOBSERVABLE")
		expect(result.data.lastMessagePartial).toBe("LIVE_UNOBSERVABLE")
	})

	it("A5b: shadow undefined at seam -> shadowPublicationBinding=MISSING", () => {
		// Hub/Remote host has no canonical shadow projection; the
		// builder must record this honestly so the post-capture
		// join can distinguish "shadow never observed" from
		// "shadow observed, no generation binding".
		const snapshot = makeSnapshot({ stateVersion: 4097 })
		const result = buildActivityPublicationV1Record({
			snapshot,
			shadow: undefined,
			knobs: { a: true },
			ptadPushId: 4097,
		})
		expect(result.kind).toBe("emit")
		if (result.kind !== "emit") throw new Error("type narrow")
		expect(result.shadowPublicationBinding).toBe("MISSING")
		expect(result.data.shadowPublicationBinding).toBe("MISSING")
		expect(result.data.hostStatus).toBeNull()
		expect(result.data.modelStreaming).toBeNull()
		expect(result.data.toolActive).toBe(false)
	})
})

describe("S1, S2, A6: sink conservation tests (not publication evidence)", () => {
	let tmpDir: string
	let capturePath: string
	let originalEnv: string | undefined

	beforeEach(() => {
		originalEnv = process.env.CLINEMM_CAPTURE_V2_PATH
		tmpDir = mkdtempSync(join(tmpdir(), "activity-publication-v1-"))
		capturePath = join(tmpDir, "capture.jsonl")
		process.env.CLINEMM_CAPTURE_V2_PATH = capturePath
		__resetV2CaptureForTests()
	})

	afterEach(() => {
		if (originalEnv === undefined) {
			delete process.env.CLINEMM_CAPTURE_V2_PATH
		} else {
			process.env.CLINEMM_CAPTURE_V2_PATH = originalEnv
		}
		__resetV2CaptureForTests()
		try {
			rmSync(tmpDir, { recursive: true, force: true })
		} catch {
			// best-effort cleanup
		}
	})

	it("S1: sink serializes one record per emit when env var is set", () => {
		// CONSERVATION test only: this proves
		//   emitV2Capture(serializable_record) -> one JSONL line
		// It does NOT prove the production seam produces exactly one
		// emit per publication; that contract is proven by A4 against
		// the pure builder.
		emitV2Capture({
			codePoint: "activity.publication.v1",
			scope: "request",
			data: { publicationId: 1, hostStatus: "idle" },
		})
		const contents = readFileSync(capturePath, "utf8").trim().split("\n")
		expect(contents).toHaveLength(1)
		const record = JSON.parse(contents[0])
		expect(record.codePoint).toBe("activity.publication.v1")
		expect(record.scope).toBe("request")
		expect(record.data.publicationId).toBe(1)
	})

	it("S2: sink is a complete no-op when env var is unset", () => {
		// CONSERVATION test only: proves the sink writes zero records
		// when disabled. Does NOT prove the production seam refrains
		// from calling emitV2Capture when A=false; that contract is
		// proven by A4 against the pure builder.
		delete process.env.CLINEMM_CAPTURE_V2_PATH
		__resetV2CaptureForTests()
		expect(isV2CaptureEnabled()).toBe(false)

		emitV2Capture({
			codePoint: "activity.publication.v1",
			scope: "request",
			data: { publicationId: 1, hostStatus: "idle" },
		})
		expect(existsSync(capturePath)).toBe(false)
	})

	it("A6: sink writer failure -> no throw, no state-semantic delta", () => {
		// CONSERVATION test only: proves the safeAppend swallow
		// contract at the sink layer. Does NOT prove any publication
		// invariant.
		writeFileSync(capturePath, "")
		rmSync(capturePath, { force: true })
		try {
			mkdirSync(capturePath)
		} catch {
			return
		}
		__resetV2CaptureForTests()
		expect(() =>
			emitV2Capture({
				codePoint: "activity.publication.v1",
				scope: "request",
				data: { publicationId: 1, hostStatus: "idle" },
			}),
		).not.toThrow()
		rmSync(capturePath, { recursive: true, force: true })
	})
})

describe("A8: existing V/I/P behavior unchanged", () => {
	it("A8a: V knob is still gated on the writer's effective path (no structural drift)", () => {
		const knobs = resolveEffectiveDiagnosticKnobs({}, true, null)
		expect(knobs.v).toBe(false)
		const knobs2 = resolveEffectiveDiagnosticKnobs({}, true, AUTO_PATH)
		expect(knobs2.v).toBe(true)
	})

	it("A8b: I and P precedence is unchanged (decideKnob precedence intact)", () => {
		const knobs = resolveEffectiveDiagnosticKnobs({ CLINEMM_DIAG_INPUT_SHAPE_V2: "0" }, true, AUTO_PATH)
		expect(knobs.i).toBe(false)
		const knobs2 = resolveEffectiveDiagnosticKnobs({ CLINEMM_DIAG_APPROVAL_PUBLICATION_V2: "false" }, true, AUTO_PATH)
		expect(knobs2.p).toBe(false)
	})

	it("A8c: public defaults remain all OFF (no public surface drift)", () => {
		const knobs = composeEffectiveDiagnosticKnobs({}, false, EMPTY_PATH, null)
		expect(knobs).toEqual({ v: false, i: false, a: false, p: false, d: false })
		expect(formatEffectiveKnobLetters(knobs)).toBe("")
	})
})


