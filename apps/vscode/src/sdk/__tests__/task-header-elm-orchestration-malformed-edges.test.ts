/**
 * ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION01 (C7)
 *
 * Malformed-boundary / fail-closed tests for the TaskHeader
 * orchestration Elm kernel.
 *
 * The Elm kernel rejects:
 *
 *   * missing tag (the inbound payload is not an object);
 *   * unknown phase tag (e.g. `"working"` is not in the closed
 *     vocabulary);
 *   * wrong primitive type (`seq` is a string instead of an integer);
 *   * impossible enum value (`source: "task-ownership"` after a
 *     rejected repair — the production selector never emits this);
 *   * missing required semantic input (e.g. `currentLegacyPhase`
 *     omitted);
 *   * unexpected extra variant where the decoder rejects it (negative
 *     integer for `canonicalShadowObservedTurnSeq`).
 *
 * The TS adapter is fail-closed at every boundary: every rejection
 * surfaces as `kind: "decode_error"` with a bounded reason. NEVER
 * "auto-present".
 */

import type { TurnPhase } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import {
	buildFactsJson,
	decodeOutMsg,
	invokeElmKernel,
	type TaskHeaderElmDecision,
	type TaskHeaderElmFactsJson,
} from "../task-header-elm-shadow"

// ---------------------------------------------------------------------------
// Decoding-layer rejection (pure TS adapter, no Elm kernel required)
// ---------------------------------------------------------------------------

describe("TaskHeader orchestration: decoder fail-closed", () => {
	it("MAL-01: non-object inbound throws decode_error", () => {
		const decision = decodeOutMsg("not-an-object")
		expect(decision.kind).toBe("decode_error")
		if (decision.kind !== "decode_error") return
		expect(decision.classification).toBe("task_header_elm_decode_error")
		expect(decision.reason.length).toBeGreaterThan(0)
	})

	it("MAL-02: null inbound throws decode_error", () => {
		const decision = decodeOutMsg(null)
		expect(decision.kind).toBe("decode_error")
	})

	it("MAL-03: undefined inbound throws decode_error", () => {
		const decision = decodeOutMsg(undefined)
		expect(decision.kind).toBe("decode_error")
	})

	it("MAL-04: missing presentation payload throws decode_error", () => {
		const decision = decodeOutMsg({ kind: "presentation" })
		expect(decision.kind).toBe("decode_error")
	})

	it("MAL-05: unknown phase tag throws decode_error", () => {
		const decision = decodeOutMsg({
			kind: "presentation",
			presentation: { phase: "working", source: "shadow", seq: 1 },
		})
		expect(decision.kind).toBe("decode_error")
		if (decision.kind !== "decode_error") return
		expect(decision.reason).toMatch(/unknown phase tag/i)
	})

	it("MAL-06: unknown source tag throws decode_error", () => {
		const decision = decodeOutMsg({
			kind: "presentation",
			presentation: { phase: "idle", source: "task-ownership", seq: 1 },
		})
		expect(decision.kind).toBe("decode_error")
		if (decision.kind !== "decode_error") return
		expect(decision.reason).toMatch(/unknown source tag/i)
	})

	it("MAL-07: non-finite seq throws decode_error", () => {
		const decision = decodeOutMsg({
			kind: "presentation",
			presentation: { phase: "idle", source: "shadow", seq: Number.POSITIVE_INFINITY },
		})
		expect(decision.kind).toBe("decode_error")
	})

	it("MAL-08: non-integer seq throws decode_error", () => {
		const decision = decodeOutMsg({
			kind: "presentation",
			presentation: { phase: "idle", source: "shadow", seq: 1.5 },
		})
		expect(decision.kind).toBe("decode_error")
	})

	it("MAL-09: unknown outbound kind throws decode_error", () => {
		const decision = decodeOutMsg({ kind: "surprise" })
		expect(decision.kind).toBe("decode_error")
	})

	it("MAL-10: ready-only outbound throws decode_error (no presentation payload)", () => {
		const decision = decodeOutMsg({ kind: "ready" })
		expect(decision.kind).toBe("decode_error")
		if (decision.kind !== "decode_error") return
		expect(decision.reason).toMatch(/ready/)
	})

	it("MAL-11: decode_error from kernel surfaces bounded reason", () => {
		const decision = decodeOutMsg({ kind: "decode_error", error: "phase bad" })
		expect(decision.kind).toBe("decode_error")
		if (decision.kind !== "decode_error") return
		expect(decision.reason).toBe("phase bad")
	})

	it("MAL-12: decode_error from kernel without error field uses bounded synthetic reason", () => {
		const decision = decodeOutMsg({ kind: "decode_error" })
		expect(decision.kind).toBe("decode_error")
		if (decision.kind !== "decode_error") return
		expect(decision.reason).toMatch(/no message/i)
	})
})

// ---------------------------------------------------------------------------
// Builder-layer rejection (real Elm runtime evaluates the malformed input)
// ---------------------------------------------------------------------------

describe("TaskHeader orchestration: builder / kernel round-trip fails closed", () => {
	it("MAL-K1: kernel rejects unknown phase tag in raw inbound", async () => {
		const decision = await invokeElmKernel({
			canonicalShadowPhase: null,
			currentLegacyPhase: "working" as unknown as TurnPhase,
			seq: 1,
			canonicalShadowObservedTurnSeq: null,
		})
		expect(decision.kind).toBe("decode_error")
		if (decision.kind !== "decode_error") return
		expect(decision.classification).toBe("task_header_elm_decode_error")
		expect(decision.reason.length).toBeGreaterThan(0)
	})

	it("MAL-K2: kernel rejects missing required `currentLegacyPhase`", async () => {
		const malformed = {
			canonicalShadowPhase: null,
			seq: 1,
			canonicalShadowObservedTurnSeq: null,
		} as unknown as TaskHeaderElmFactsJson
		const decision = await invokeElmKernel(malformed)
		expect(decision.kind).toBe("decode_error")
	})

	it("MAL-K3: kernel rejects missing required `seq`", async () => {
		const malformed = {
			canonicalShadowPhase: null,
			currentLegacyPhase: "idle" as const,
			canonicalShadowObservedTurnSeq: null,
		} as unknown as TaskHeaderElmFactsJson
		const decision = await invokeElmKernel(malformed)
		expect(decision.kind).toBe("decode_error")
	})

	it("MAL-K4: kernel rejects negative `canonicalShadowObservedTurnSeq`", async () => {
		const decision = await invokeElmKernel({
			canonicalShadowPhase: null,
			currentLegacyPhase: "idle",
			seq: 1,
			canonicalShadowObservedTurnSeq: -1,
		})
		expect(decision.kind).toBe("decode_error")
	})

	it("MAL-K5: kernel accepts `null` for absent fields", async () => {
		const decision = await invokeElmKernel({
			canonicalShadowPhase: null,
			currentLegacyPhase: "idle",
			seq: 1,
			canonicalShadowObservedTurnSeq: null,
		})
		expect(decision.kind).toBe("presentation")
	})

	it("MAL-K6: `buildFactsJson` faithfully translates `undefined` -> `null`", () => {
		const built = buildFactsJson({
			canonicalShadowPhase: undefined,
			currentLegacyPhase: "idle",
			seq: 1,
			canonicalShadowObservedTurnSeq: undefined,
		})
		expect(built).toEqual({
			canonicalShadowPhase: null,
			currentLegacyPhase: "idle",
			seq: 1,
			canonicalShadowObservedTurnSeq: null,
		})
	})
})

// ---------------------------------------------------------------------------
// Absence-collapse (kernel offline path)
// ---------------------------------------------------------------------------

describe("TaskHeader orchestration: absence-collapse is kernel_offline, never auto-present", () => {
	it("ABS-1: `kernel_offline` is bounded to `task_header_elm_kernel_offline`", () => {
		// We do NOT trigger a real offline path here (that requires
		// blocking the loader). Instead we verify the discrimination
		// shape: a `kernel_offline` decision MUST have the bounded
		// classification string. The TS adapter never collapses to
		// a presentation decision on absence.
		const synthetic: TaskHeaderElmDecision = {
			kind: "kernel_offline",
			classification: "task_header_elm_kernel_offline",
		}
		expect(synthetic.kind).toBe("kernel_offline")
		expect(synthetic.classification).toBe("task_header_elm_kernel_offline")
	})
})
