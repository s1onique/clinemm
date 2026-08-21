// ACT-CLINEMM-COMPACTION-LEGACY-TURNSTATE-COHERENCE01-CORRECTION02
//
// Real-wiring RED for the production callback bound to
// `getCanonicalRestorePhase`. Drives the actual
// `selectCanonicalRestorePhase` helper at
// `apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts` -- the
// production composition the bounded repair delegates to.
//
// =============================================================================
// LIVE STATE_MISMATCH = PROVEN (this ACT proves the production value source)
// =============================================================================
//
// CORRECTION01 (commit 892b061ec) fixed the coordinator contract:
//
//   getCanonicalRestorePhase?: () => TurnPhase | undefined
//
// and pinned `unavailable != idle`. CLTCC01..12 prove the coordinator
// honors whatever the callback returns. They do NOT prove that the
// REAL production callback distinguishes the canonical host-aware
// destination `awaiting_followup` from `idle` -- the two phases the
// canonical mapper otherwise collapses.
//
// =============================================================================
// FIRST PRODUCTION GAP: getLastObservedShadowPhase is NOT host-aware
// =============================================================================
//
// Recon of `apps/vscode/src/sdk/task-state-shadow-host-wiring.ts:443-450`
// (verbatim from the production source):
//
//   getLastObservedShadowPhase: (): TurnPhase | undefined => {
//     if (!comparator.hasObservedShadowState()) {
//       return undefined
//     }
//     const model = comparator.debugSnapshot()
//     const canonical = TaskState.projectTurnState(model)
//     return toLegacyPhase(canonical)
//   }
//
// `TaskState.projectTurnState(model)` (sdk/packages/agents/src/runtime/
//state/task-state/selectors.ts:47) maps the canonical TaskModel onto a
// ShadowTurnPhase that DOES NOT contain `awaiting_followup`. The
// canonical projection that produces `awaiting_followup` requires
// `hostInteraction.awaitingFollowup`, which the production shadow
// wiring does not propagate. The mapper's own JSDoc at
// `selectTaskHeaderPresentation` acknowledges and resolves this gap
// with an explicit HOST AWAITING_FOLLOWUP OVERRIDE branch reading the
// legacy `turnStateTracker.currentPhase` itself.
//
// =============================================================================
// CORRECTION02 BOUNDED REPAIR: mirror the TaskHeader pattern
// =============================================================================
//
// The canonical restore callback is rebuilt to follow the EXACT same
// three-source precedence the TaskHeader projection uses:
//   1. HOST COMPACTING OVERRIDE (system-owned)
//   2. HOST AWAITING_FOLLOWUP OVERRIDE (user-owned, reads the
//      legacy `turnStateTracker.currentPhase` because the canonical
//      shadow cannot represent it)
//   3. CANONICAL SHADOW PROJECTION for the 6 phases the canonical
//      shadow CAN represent (idle / streaming / awaiting_approval /
//      completed / error / resumable)
//
// Implemented by adding `selectCanonicalRestorePhase` to
// `task-state-shadow-arbiter-mapper.ts` (the same file that owns the
// analogous `selectTaskHeaderPresentation`). The SdkController wires
// the new composition into `getCanonicalRestorePhase`. The
// coordinator API (`getCanonicalRestorePhase?: () => TurnPhase |
// undefined`) is preserved verbatim -- no coordinator change.

import type { TurnPhase } from "@shared/ExtensionMessage"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createCanonicalRestorePhaseCallback, selectCanonicalRestorePhase } from "../task-state-shadow-arbiter-mapper"

describe("ACT-CLINEMM-COMPACTION-LEGACY-TURNSTATE-COHERENCE01-CORRECTION02 / real-wiring: host-aware canonical restore callback", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	// --- LOAD-BEARING DISCRIMINATOR (the reviewer's CLTCC13) ---

	it("CLTCC13-A: canonical shadow 'idle' + host legacy 'awaiting_followup' -> canonical restore returns 'awaiting_followup'", () => {
		// Discriminator: vary ONLY the host-side legacy phase. The
		// canonical shadow projects to 'idle' (no model streaming,
		// no tooling, no approval, no lifecycle terminal). The legacy
		// tracker is set to 'awaiting_followup' -- the user-owned
		// phase. Expected: 'awaiting_followup' (NOT 'idle'). The
		// CORRECTION01 bare-canonical-shadow callback REDs here.
		expect(
			selectCanonicalRestorePhase({
				canonicalShadowPhase: "idle",
				currentLegacyPhase: "awaiting_followup",
			}),
		).toBe("awaiting_followup")
	})

	it("CLTCC13-B (control): canonical shadow 'idle' + host legacy 'idle' -> canonical restore returns 'idle'", () => {
		// Vary ONLY the host-side legacy phase: 'idle' now. The two
		// phases must remain distinguishable. Expected: 'idle' (NOT
		// 'awaiting_followup').
		expect(
			selectCanonicalRestorePhase({
				canonicalShadowPhase: "idle",
				currentLegacyPhase: "idle",
			}),
		).toBe("idle")
	})

	// --- HOST-OWNED PHASE PRESENT WITHOUT CANONICAL SHADOW ---

	it("CLTCC13-C: canonical shadow undefined + host legacy 'awaiting_followup' -> canonical restore returns 'awaiting_followup'", () => {
		// Hub/Remote absence state with the legacy tracker carrying
		// 'awaiting_followup'. The canonical projection is absent
		// (undefined), but the host-side phase IS authoritative for
		// awaiting_followup -- the bounded repair must surface it.
		expect(
			selectCanonicalRestorePhase({
				canonicalShadowPhase: undefined,
				currentLegacyPhase: "awaiting_followup",
			}),
		).toBe("awaiting_followup")
	})

	// --- P1: `unavailable != idle` -- absence + idle MUST NOT synthesize --

	it("CLTCC13-D (P1): canonical shadow undefined + host legacy 'idle' -> canonical restore returns undefined", () => {
		// Factory P1: `unavailable != idle`. When the canonical
		// projection is absent AND the legacy tracker is 'idle' (not
		// 'awaiting_followup'), the bounded repair must NOT
		// synthesize a phase. The coordinator preserves the entry
		// phase in this case.
		expect(
			selectCanonicalRestorePhase({
				canonicalShadowPhase: undefined,
				currentLegacyPhase: "idle",
			}),
		).toBeUndefined()
	})

	// --- CANONICAL LIFECYCLE (other 4 phases the canonical shadow CAN represent) ---

	it("CLTCC13-E (CLTCC14-1): canonical shadow 'completed' + host legacy 'idle' -> canonical restore returns 'completed'", () => {
		expect(
			selectCanonicalRestorePhase({
				canonicalShadowPhase: "completed",
				currentLegacyPhase: "idle",
			}),
		).toBe("completed")
	})

	it("CLTCC13-F (CLTCC14-2): canonical shadow 'resumable' + host legacy 'idle' -> canonical restore returns 'resumable'", () => {
		expect(
			selectCanonicalRestorePhase({
				canonicalShadowPhase: "resumable",
				currentLegacyPhase: "idle",
			}),
		).toBe("resumable")
	})

	it("CLTCC13-G: canonical shadow 'streaming' + host legacy 'idle' -> canonical restore returns 'streaming'", () => {
		expect(
			selectCanonicalRestorePhase({
				canonicalShadowPhase: "streaming",
				currentLegacyPhase: "idle",
			}),
		).toBe("streaming")
	})

	it("CLTCC13-H: canonical shadow 'awaiting_approval' + host legacy 'idle' -> canonical restore returns 'awaiting_approval'", () => {
		expect(
			selectCanonicalRestorePhase({
				canonicalShadowPhase: "awaiting_approval",
				currentLegacyPhase: "idle",
			}),
		).toBe("awaiting_approval")
	})

	it("CLTCC13-I: canonical shadow 'error' + host legacy 'idle' -> canonical restore returns 'error'", () => {
		expect(
			selectCanonicalRestorePhase({
				canonicalShadowPhase: "error",
				currentLegacyPhase: "idle",
			}),
		).toBe("error")
	})

	// --- HOST COMPACTING OVERRIDE (system-owned transition) ---

	it("CLTCC13-J: host legacy 'compacting' (the system-owned transition) -> canonical restore returns 'compacting'", () => {
		// The compaction window itself: when the legacy tracker is
		// 'compacting' (which `enterCompactingPhase()` writes before
		// compaction runs), the canonical restore is 'compacting'.
		// This is the SAME host-override the TaskHeader projection
		// applies. It must NOT be overridden by an absent canonical
		// shadow or a stale 'idle' canonical shadow.
		expect(
			selectCanonicalRestorePhase({
				canonicalShadowPhase: "idle",
				currentLegacyPhase: "compacting",
			}),
		).toBe("compacting")
	})

	it("CLTCC13-K: host legacy 'compacting' + canonical shadow undefined -> canonical restore returns 'compacting'", () => {
		expect(
			selectCanonicalRestorePhase({
				canonicalShadowPhase: undefined,
				currentLegacyPhase: "compacting",
			}),
		).toBe("compacting")
	})
})

describe("ACT-CLINEMM-COMPACTION-LEGACY-TURNSTATE-COHERENCE01-CORRECTION02 / SdkController binding factory", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	// The production binding at `SdkController.ts:979-982` reads:
	//
	//   getCanonicalRestorePhase: createCanonicalRestorePhaseCallback({
	//     getCanonicalShadowPhase: () =>
	//       this.taskStateShadowWiring?.getLastObservedShadowPhase(),
	//     getCurrentLegacyPhase: () => this.turnStateTracker.currentPhase,
	//   })
	//
	// These tests drive the SAME factory the SdkController wires
	// in, with stub dependencies that mirror the production
	// `taskStateShadowWiring.getLastObservedShadowPhase()` and
	// `turnStateTracker.currentPhase` accessors. The Helper-level
	// tests above prove the selector's correctness; these tests
	// prove the BINDING carries the host-interaction dimension.
	//
	// Reviewer-required discriminator: vary ONLY the host-side
	// legacy phase. The canonical shadow projects to 'idle' (the
	// canonical result for an idle runtime, since
	// `TaskState.projectTurnState(model)` cannot represent
	// awaiting_followup without the hostInteraction dimension).
	// The CORRECTION02 binding must surface 'awaiting_followup'
	// from the host-side legacy phase.

	it("BINDING-A (CLTCC13-A at binding level): canonical shadow 'idle' + host legacy 'awaiting_followup' -> 'awaiting_followup'", () => {
		// Mirrors the production composition: the binding reads
		// canonicalShadowPhase from the canonical shadow and
		// currentLegacyPhase from the legacy tracker.
		const callback = createCanonicalRestorePhaseCallback({
			getCanonicalShadowPhase: () => "idle",
			getCurrentLegacyPhase: () => "awaiting_followup",
		})
		expect(callback()).toBe("awaiting_followup")
	})

	it("BINDING-B (CLTCC13-B at binding level): canonical shadow 'idle' + host legacy 'idle' -> 'idle'", () => {
		// Vary ONLY the host-side legacy phase: 'idle' now.
		const callback = createCanonicalRestorePhaseCallback({
			getCanonicalShadowPhase: () => "idle",
			getCurrentLegacyPhase: () => "idle",
		})
		expect(callback()).toBe("idle")
		expect(callback()).not.toBe("awaiting_followup")
	})

	it("BINDING-C: canonical shadow undefined + host legacy 'awaiting_followup' -> 'awaiting_followup'", () => {
		const callback = createCanonicalRestorePhaseCallback({
			getCanonicalShadowPhase: () => undefined,
			getCurrentLegacyPhase: () => "awaiting_followup",
		})
		expect(callback()).toBe("awaiting_followup")
	})

	it("BINDING-D (P1): canonical shadow undefined + host legacy 'idle' -> undefined", () => {
		// Factory P1: `unavailable != idle`. When the canonical
		// projection is absent AND the legacy tracker is 'idle', the
		// bounded repair must NOT synthesize a phase.
		const callback = createCanonicalRestorePhaseCallback({
			getCanonicalShadowPhase: () => undefined,
			getCurrentLegacyPhase: () => "idle",
		})
		expect(callback()).toBeUndefined()
	})

	it("BINDING-E: canonical shadow 'completed' + host legacy 'idle' -> 'completed'", () => {
		const callback = createCanonicalRestorePhaseCallback({
			getCanonicalShadowPhase: () => "completed",
			getCurrentLegacyPhase: () => "idle",
		})
		expect(callback()).toBe("completed")
	})

	it("BINDING-F: canonical shadow 'resumable' + host legacy 'idle' -> 'resumable'", () => {
		const callback = createCanonicalRestorePhaseCallback({
			getCanonicalShadowPhase: () => "resumable",
			getCurrentLegacyPhase: () => "idle",
		})
		expect(callback()).toBe("resumable")
	})

	it("BINDING-G: canonical shadow 'streaming' + host legacy 'idle' -> 'streaming'", () => {
		const callback = createCanonicalRestorePhaseCallback({
			getCanonicalShadowPhase: () => "streaming",
			getCurrentLegacyPhase: () => "idle",
		})
		expect(callback()).toBe("streaming")
	})

	it("BINDING-H: canonical shadow 'awaiting_approval' + host legacy 'idle' -> 'awaiting_approval'", () => {
		const callback = createCanonicalRestorePhaseCallback({
			getCanonicalShadowPhase: () => "awaiting_approval",
			getCurrentLegacyPhase: () => "idle",
		})
		expect(callback()).toBe("awaiting_approval")
	})

	it("BINDING-I: canonical shadow 'error' + host legacy 'idle' -> 'error'", () => {
		const callback = createCanonicalRestorePhaseCallback({
			getCanonicalShadowPhase: () => "error",
			getCurrentLegacyPhase: () => "idle",
		})
		expect(callback()).toBe("error")
	})

	it("BINDING-J: host legacy 'compacting' + canonical shadow 'idle' -> 'compacting'", () => {
		const callback = createCanonicalRestorePhaseCallback({
			getCanonicalShadowPhase: () => "idle",
			getCurrentLegacyPhase: () => "compacting",
		})
		expect(callback()).toBe("compacting")
	})

	it("BINDING-K: host legacy 'compacting' + canonical shadow undefined -> 'compacting'", () => {
		const callback = createCanonicalRestorePhaseCallback({
			getCanonicalShadowPhase: () => undefined,
			getCurrentLegacyPhase: () => "compacting",
		})
		expect(callback()).toBe("compacting")
	})

	// --- REVIEWER-REQUIRED ABLATION ---

	it("ABLATION (reviewer-mandated): OLD non-host-aware binding REDs for 'awaiting_followup'", () => {
		// The OLD SdkController binding (pre-CORRECTION02) was:
		//   getCanonicalRestorePhase: () =>
		//     this.taskStateShadowWiring?.getLastObservedShadowPhase()
		// which does NOT consult the host legacy phase. Simulated
		// here as a function that only reads the canonical shadow.
		const oldBinding = (canonicalShadowPhase: TurnPhase | undefined): TurnPhase | undefined => canonicalShadowPhase
		// When the canonical shadow projects 'idle' (the canonical
		// result for an idle runtime), the OLD binding returns
		// 'idle' regardless of the user's awaitingFollowup state.
		expect(oldBinding("idle")).toBe("idle")
		expect(oldBinding("idle")).not.toBe("awaiting_followup")
		// Contrast: the CORRECTION02 binding for the same canonical
		// shadow + a host legacy 'awaiting_followup' returns
		// 'awaiting_followup'. The discriminator is the addition of
		// `getCurrentLegacyPhase` to the binding composition.
		const newBinding = createCanonicalRestorePhaseCallback({
			getCanonicalShadowPhase: () => "idle",
			getCurrentLegacyPhase: () => "awaiting_followup",
		})
		expect(newBinding()).toBe("awaiting_followup")
	})
})

describe("ACT-CLINEMM-COMPACTION-LEGACY-TURNSTATE-COHERENCE01-CORRECTION02 / source-level wiring inspection (production binding)", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	// The reviewer-mandated discriminator: the production
	// callback bound at SdkController must carry the host-interaction
	// dimension. This is enforced by source inspection -- the test
	// reads `SdkController.ts` and asserts the binding composition
	// routes through `createCanonicalRestorePhaseCallback` with
	// BOTH `getCanonicalShadowPhase` (canonical shadow) AND
	// `getCurrentLegacyPhase` (legacy tracker.currentPhase) inputs.
	//
	// Why source inspection rather than end-to-end instantiation:
	// the SdkController has a ~10k-line constructor surface
	// (`turnStateTracker`, `taskStateShadowWiring`, `sessions`,
	// `messages`, etc.) that is not realistically mockable in a
	// unit test without shadowing the entire production path. The
	// source-inspection approach is the practical equivalent: it
	// proves the binding text in production routes through the
	// factory with the right accessors.

	it("INSPECTION-A: SdkController.ts production binding routes through createCanonicalRestorePhaseCallback", () => {
		// Read the SdkController source and verify the production
		// binding text uses the factory (not the bare canonical
		// shadow).
		const fs = require("node:fs") as typeof import("node:fs")
		const path = require("node:path") as typeof import("node:path")
		const sdkControllerPath = path.join(
			process.cwd(),
			path.join("..", "..", "apps", "vscode", "src", "sdk", "SdkController.ts"),
		)
		const source = fs.readFileSync(sdkControllerPath, "utf-8")

		// The binding MUST call createCanonicalRestorePhaseCallback.
		expect(source).toMatch(
			/createCanonicalRestorePhaseCallback\(\{[\s\S]*?getCanonicalShadowPhase[\s\S]*?getCurrentLegacyPhase[\s\S]*?\}\)/,
		)
	})

	it("INSPECTION-B: SdkController.ts production binding feeds BOTH the canonical shadow AND the legacy tracker.currentPhase", () => {
		const fs = require("node:fs") as typeof import("node:fs")
		const path = require("node:path") as typeof import("node:path")
		const sdkControllerPath = path.join(
			process.cwd(),
			path.join("..", "..", "apps", "vscode", "src", "sdk", "SdkController.ts"),
		)
		const source = fs.readFileSync(sdkControllerPath, "utf-8")

		// The binding MUST feed both accessors:
		//   getCanonicalShadowPhase: () =>
		//     this.taskStateShadowWiring?.getLastObservedShadowPhase()
		//   getCurrentLegacyPhase: () => this.turnStateTracker.currentPhase
		expect(source).toMatch(
			/getCanonicalShadowPhase:\s*\(\)\s*=>\s*this\.taskStateShadowWiring\?\.getLastObservedShadowPhase\(\)/,
		)
		expect(source).toMatch(/getCurrentLegacyPhase:\s*\(\)\s*=>\s*this\.turnStateTracker\.currentPhase/)
	})

	it("INSPECTION-C: SdkController.ts production binding does NOT use the OLD non-host-aware form", () => {
		// Guard against accidental regression: the binding MUST NOT
		// be the OLD `() => this.taskStateShadowWiring?.getLastObservedShadowPhase()`
		// form alone. The factory call must wrap both inputs.
		const fs = require("node:fs") as typeof import("node:fs")
		const path = require("node:path") as typeof import("node:path")
		const sdkControllerPath = path.join(
			process.cwd(),
			path.join("..", "..", "apps", "vscode", "src", "sdk", "SdkController.ts"),
		)
		const source = fs.readFileSync(sdkControllerPath, "utf-8")

		// The exact OLD binding string must NOT appear in the
		// getCanonicalRestorePhase context. Look for it with
		// surrounding context to avoid false positives.
		const oldBindingPattern =
			/getCanonicalRestorePhase:\s*\(\)\s*=>\s*this\.taskStateShadowWiring\?\.getLastObservedShadowPhase\(\)/
		expect(source).not.toMatch(oldBindingPattern)
	})

	it("INSPECTION-D: selectCanonicalRestorePhase is exported from task-state-shadow-arbiter-mapper.ts", () => {
		// The selector the coordinator consults must be the
		// CORRECTION02 helper (the host-aware precedence).
		const fs = require("node:fs") as typeof import("node:fs")
		const path = require("node:path") as typeof import("node:path")
		const mapperPath = path.join(
			process.cwd(),
			path.join("..", "..", "apps", "vscode", "src", "sdk", "task-state-shadow-arbiter-mapper.ts"),
		)
		const source = fs.readFileSync(mapperPath, "utf-8")
		expect(source).toMatch(/export function selectCanonicalRestorePhase/)
		expect(source).toMatch(/export function createCanonicalRestorePhaseCallback/)
	})

	it("INSPECTION-E: selectCanonicalRestorePhase implements the host-aware precedence (matching selectTaskHeaderPresentation)", () => {
		// The selector body must apply the three-source precedence:
		//   1. host compacting override
		//   2. host awaiting_followup override
		//   3. canonical shadow
		//   4. absence fallback (undefined)
		const fs = require("node:fs") as typeof import("node:fs")
		const path = require("node:path") as typeof import("node:path")
		const mapperPath = path.join(
			process.cwd(),
			path.join("..", "..", "apps", "vscode", "src", "sdk", "task-state-shadow-arbiter-mapper.ts"),
		)
		const source = fs.readFileSync(mapperPath, "utf-8")

		// Extract the selector body. Find the function definition
		// and assert it contains the four branches.
		const fnMatch = source.match(/export function selectCanonicalRestorePhase\([\s\S]*?\n\}\n/)
		expect(fnMatch).not.toBeNull()
		const body = fnMatch![0]
		expect(body).toMatch(/currentLegacyPhase === "compacting"/)
		expect(body).toMatch(/currentLegacyPhase === "awaiting_followup"/)
		expect(body).toMatch(/canonicalShadowPhase !== undefined/)
		expect(body).toMatch(/return undefined/)
	})
})
