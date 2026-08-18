// ===========================================================================
// ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-WEBVIEW-SHADOW-PROJECTION-CUTOVER01:
//
// Qualification suite for the webview-facing `selectThinkingPresentation`
// projector. The projector is the single source of truth for the
// `thinkingPresentation` field `SdkController.getStateToPostToWebview`
// publishes; the four webview Thinking consumers (ChatRow `case
// "reasoning"`, RequestStartRow inline shimmer, useThinkingLoaderRow
// loader row, TaskHeader state label — the latter out of scope for
// E7.1) read from this field instead of `turnState.phase` directly.
//
// Frozen contract (mirrors the C25-C5 / ELM-02F dual-source rule):
//
//   shadow available → `source: "shadow"`, `modelStreaming` from
//     `canonicalShadow.execution.modelStreaming`
//
//   shadow absent   → `source: "legacy"`, `modelStreaming` from
//     `currentLegacyPhase === "streaming"`
//
//   `seq` is always the legacy `TurnStateTracker.seq` so the webview
//   stale-push fencing rule continues to work.
//
// Witness matrix (mirrors the ACT §8 requirements):
//
//   T1..T4 — shadow vs legacy branch basic outputs
//   T5     — Hub/Remote absence-state collapse
//   T6/T7  — causal: LEGACY_INDEPENDENCE + NECESSITY dual
//   T8     — SEQ_PROPAGATION across both branches
//   WIRE-* — structural wiring in SdkController + ExtensionMessage
// ===========================================================================

import type { TurnPhase } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { selectThinkingPresentation, type ThinkingPresentationInputs } from "../task-state-shadow-arbiter-mapper"
import { emptyArbiterSnapshot } from "../task-state-shadow-host-wiring"
import type { ArbiterSnapshot } from "../task-state-shadow-recorder"

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function shadowWith(execution: Partial<ArbiterSnapshot["execution"]> = {}): ArbiterSnapshot {
	return {
		...emptyArbiterSnapshot(),
		execution: {
			modelStreaming: false,
			tooling: false,
			awaitingApproval: false,
			...execution,
		},
	}
}

function inputs(overrides: Partial<ThinkingPresentationInputs> = {}): ThinkingPresentationInputs {
	return {
		canonicalShadow: undefined,
		currentLegacyPhase: "idle" as TurnPhase,
		seq: 1,
		...overrides,
	}
}

describe("ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1 / shadow branch", () => {
	it("T1: shadow with modelStreaming=true → source='shadow', modelStreaming=true", () => {
		const out = selectThinkingPresentation(
			inputs({
				canonicalShadow: shadowWith({ modelStreaming: true }),
				currentLegacyPhase: "idle",
				seq: 7,
			}),
		)
		expect(out).toEqual({ modelStreaming: true, source: "shadow", seq: 7 })
	})

	it("T2: shadow with modelStreaming=false → source='shadow', modelStreaming=false", () => {
		const out = selectThinkingPresentation(
			inputs({
				canonicalShadow: shadowWith({ modelStreaming: false }),
				currentLegacyPhase: "streaming",
				seq: 12,
			}),
		)
		expect(out).toEqual({ modelStreaming: false, source: "shadow", seq: 12 })
	})

	it("T2b: shadow with modelStreaming=false IGNORES legacy phase='streaming' (T2_LEGACY_INDEPENDENCE)", () => {
		// The canonical branch reads ONLY from canonicalShadow. The
		// legacy phase is not consulted. Pinning it requires the same
		// shadow + different phase to yield the same modelStreaming.
		const a = selectThinkingPresentation(
			inputs({ canonicalShadow: shadowWith({ modelStreaming: false }), currentLegacyPhase: "streaming", seq: 1 }),
		)
		const b = selectThinkingPresentation(
			inputs({ canonicalShadow: shadowWith({ modelStreaming: false }), currentLegacyPhase: "idle", seq: 1 }),
		)
		expect(a.modelStreaming).toBe(false)
		expect(b.modelStreaming).toBe(false)
		expect(a.source).toBe("shadow")
		expect(b.source).toBe("shadow")
	})
})

describe("ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1 / legacy branch", () => {
	it("T3: shadow undefined + legacy phase='streaming' → source='legacy', modelStreaming=true", () => {
		const out = selectThinkingPresentation(inputs({ canonicalShadow: undefined, currentLegacyPhase: "streaming", seq: 3 }))
		expect(out).toEqual({ modelStreaming: true, source: "legacy", seq: 3 })
	})

	it("T4: shadow undefined + legacy phase='idle' → source='legacy', modelStreaming=false", () => {
		const out = selectThinkingPresentation(inputs({ canonicalShadow: undefined, currentLegacyPhase: "idle", seq: 3 }))
		expect(out).toEqual({ modelStreaming: false, source: "legacy", seq: 3 })
	})

	it("T4b: every non-streaming phase → modelStreaming=false (no implicit promotion)", () => {
		for (const phase of ["idle", "awaiting_approval", "awaiting_followup", "completed", "error", "resumable"] as const) {
			const out = selectThinkingPresentation(inputs({ currentLegacyPhase: phase, seq: 1 }))
			expect(out.modelStreaming, `phase=${phase}`).toBe(false)
			expect(out.source).toBe("legacy")
		}
	})

	it("T5: Hub/Remote absence-state collapse — undefined shadow → legacy fallback", () => {
		// Hub/Remote hosts that omit runtimeSnapshot(); Local sessions
		// with no active AgentRuntime instance yet — both collapse per
		// CONTRACT_2 in the arbiter mapper.
		const out = selectThinkingPresentation(inputs({ canonicalShadow: undefined, currentLegacyPhase: "streaming", seq: 99 }))
		expect(out.source).toBe("legacy")
		expect(out.modelStreaming).toBe(true)
	})
})

describe("ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1 / causal properties", () => {
	it("T7: NECESSITY — different shadow + identical phase → different modelStreaming (shadow wins)", () => {
		const a = selectThinkingPresentation(
			inputs({
				canonicalShadow: shadowWith({ modelStreaming: true }),
				currentLegacyPhase: "idle",
				seq: 1,
			}),
		)
		const b = selectThinkingPresentation(
			inputs({
				canonicalShadow: shadowWith({ modelStreaming: false }),
				currentLegacyPhase: "idle",
				seq: 1,
			}),
		)
		expect(a.modelStreaming).toBe(true)
		expect(b.modelStreaming).toBe(false)
		expect(a.source).toBe("shadow")
		expect(b.source).toBe("shadow")
	})

	it("T8: SEQ_PROPAGATION — seq is the legacy TurnStateTracker.seq across both branches", () => {
		const a = selectThinkingPresentation(
			inputs({ canonicalShadow: shadowWith({ modelStreaming: true }), currentLegacyPhase: "idle", seq: 42 }),
		)
		const b = selectThinkingPresentation(inputs({ canonicalShadow: undefined, currentLegacyPhase: "streaming", seq: 43 }))
		expect(a.seq).toBe(42)
		expect(b.seq).toBe(43)
	})

	it("T9: never throws / never reads global state — pure function over the inputs", () => {
		// Defensive sanity: the projector is pure — same inputs, same
		// output, no exceptions.
		const a = selectThinkingPresentation(inputs({ canonicalShadow: shadowWith({ modelStreaming: true }), seq: 1 }))
		const b = selectThinkingPresentation(inputs({ canonicalShadow: shadowWith({ modelStreaming: true }), seq: 1 }))
		expect(a).toEqual(b)
	})
})

// ===========================================================================
// WIRE-* — structural wiring in SdkController + ExtensionMessage. This is
// the load-bearing structural witness: the literal line that publishes
// the projection MUST exist in SdkController.ts, and it MUST live inside
// the returned object literal.
// ===========================================================================

describe("ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1 / SdkController.wiring", () => {
	it("WIRE-1: getStateToPostToWebview projects thinkingPresentation via selectThinkingPresentation", () => {
		const fs = require("node:fs") as typeof import("node:fs")
		const path = require("node:path") as typeof import("node:path")
		const sdkControllerPath = path.resolve(__dirname, "../SdkController.ts")
		const source = fs.readFileSync(sdkControllerPath, "utf8")
		const start = source.indexOf("async getStateToPostToWebview(): Promise<ExtensionState>")
		expect(start, "SdkController.getStateToPostToWebview signature must exist").toBeGreaterThanOrEqual(0)
		const body = source.slice(start)
		expect(body).toMatch(/thinkingPresentation:\s*selectThinkingPresentation\(/)
	})

	it("WIRE-2: the projection is inside the return { ... } object literal", () => {
		const fs = require("node:fs") as typeof import("node:fs")
		const path = require("node:path") as typeof import("node:path")
		const sdkControllerPath = path.resolve(__dirname, "../SdkController.ts")
		const source = fs.readFileSync(sdkControllerPath, "utf8")
		const start = source.indexOf("async getStateToPostToWebview(): Promise<ExtensionState>")
		const body = source.slice(start)
		const returnBlockMatch = body.match(/return\s*\{([\s\S]*?)\n\s{2,}\}/)
		expect(returnBlockMatch).not.toBeNull()
		const returnBlock = returnBlockMatch?.[1] ?? ""
		expect(returnBlock).toContain("thinkingPresentation: selectThinkingPresentation(")
	})

	it("WIRE-3: ExtensionState declares thinkingPresentation as ThinkingPresentationProjection-or-undefined", () => {
		const fs = require("node:fs") as typeof import("node:fs")
		const path = require("node:path") as typeof import("node:path")
		const extMessagePath = path.resolve(__dirname, "../../shared/ExtensionMessage.ts")
		const extMessageSource = fs.readFileSync(extMessagePath, "utf8")
		expect(extMessageSource).toMatch(/thinkingPresentation\?:\s*ThinkingPresentationProjection/)
		expect(extMessageSource).toContain("ThinkingPresentationProjection")
	})

	it("WIRE-4: ExtensionState field type exports the ThinkingPresentationProjection interface", () => {
		const fs = require("node:fs") as typeof import("node:fs")
		const path = require("node:path") as typeof import("node:path")
		const extMessagePath = path.resolve(__dirname, "../../shared/ExtensionMessage.ts")
		const extMessageSource = fs.readFileSync(extMessagePath, "utf8")
		expect(extMessageSource).toMatch(/export\s+interface\s+ThinkingPresentationProjection\s*\{/)
	})
})
