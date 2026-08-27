/**
 * ACT-CLINEMM-SESSION-AUTONOMY01
 *
 * Unit tests for the session-scoped auto-approval projection.
 * Pure resolvers + the SessionAutoApprovalStore owner class.
 */

import { commandHostAuthorization, DEFAULT_COMMAND_HOST_ALLOW_RULES } from "@cline/core"
import type { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { describe, expect, it } from "vitest"
import {
	deriveExplicitCompletionAuthority,
	isYoloSessionRequested,
	resolveEffectiveAutoApproval,
	resolveEffectiveHostMode,
	resolveSessionHostAuthorization,
	SessionAutoApprovalStore,
	stripRequiresApproval,
} from "./session-auto-approval"

const MINIMAL_SETTINGS: AutoApprovalSettings = {
	...DEFAULT_AUTO_APPROVAL_SETTINGS,
	actions: {
		...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
		readFiles: false,
		editFiles: false,
		useBrowser: false,
		useMcp: true,
		executeSafeCommands: false,
		executeAllCommands: false,
	},
}

describe("resolveEffectiveAutoApproval", () => {
	it("override=none returns the SAME object reference (no allocation)", () => {
		const result = resolveEffectiveAutoApproval(MINIMAL_SETTINGS, "none")
		expect(result).toBe(MINIMAL_SETTINGS)
	})

	it("override=all enables ordinary read/edit/web/mcp categories", () => {
		const result = resolveEffectiveAutoApproval(MINIMAL_SETTINGS, "all")
		expect(result.actions.readFiles).toBe(true)
		expect(result.actions.editFiles).toBe(true)
		expect(result.actions.useBrowser).toBe(true)
		expect(result.actions.useMcp).toBe(true)
	})

	it("override=all does NOT mutate the persisted input", () => {
		const snapshot = JSON.parse(JSON.stringify(MINIMAL_SETTINGS))
		resolveEffectiveAutoApproval(MINIMAL_SETTINGS, "all")
		expect(MINIMAL_SETTINGS).toEqual(snapshot)
	})

	it("override=all returns a new object reference (not the persisted one)", () => {
		const result = resolveEffectiveAutoApproval(MINIMAL_SETTINGS, "all")
		expect(result).not.toBe(MINIMAL_SETTINGS)
		expect(result.actions).not.toBe(MINIMAL_SETTINGS.actions)
	})

	it("override=all preserves the legacy external-file fields exactly", () => {
		const settings: AutoApprovalSettings = {
			...MINIMAL_SETTINGS,
			actions: {
				...MINIMAL_SETTINGS.actions,
				readFilesExternally: false,
				editFilesExternally: false,
			},
		}
		const result = resolveEffectiveAutoApproval(settings, "all")
		expect(result.actions.readFilesExternally).toBe(false)
		expect(result.actions.editFilesExternally).toBe(false)
	})

	it("override=all preserves the persisted executeSafeCommands field (host mode projection happens in resolveEffectiveHostMode)", () => {
		const settings: AutoApprovalSettings = {
			...MINIMAL_SETTINGS,
			actions: {
				...MINIMAL_SETTINGS.actions,
				executeSafeCommands: true,
			},
		}
		const result = resolveEffectiveAutoApproval(settings, "all")
		expect(result.actions.executeSafeCommands).toBe(true)
	})

	it("disable override: exact persisted values restored (fresh persisted object each time)", () => {
		// The ACT contract: the resolver NEVER mutates `persisted`, and
		// the host MUST always pass the canonical persisted settings (not
		// a previously-projected object) into the resolver. When override
		// flips off, the next call with the original persisted settings
		// returns exactly those settings.
		const projected = resolveEffectiveAutoApproval(MINIMAL_SETTINGS, "all")
		// Sanity: projection changed actions.
		expect(projected.actions.readFiles).toBe(true)
		const restored = resolveEffectiveAutoApproval(MINIMAL_SETTINGS, "none")
		expect(restored).toBe(MINIMAL_SETTINGS)
		expect(restored.actions.readFiles).toBe(MINIMAL_SETTINGS.actions.readFiles)
		expect(restored.actions.editFiles).toBe(MINIMAL_SETTINGS.actions.editFiles)
		expect(restored.actions.useBrowser).toBe(MINIMAL_SETTINGS.actions.useBrowser)
		expect(restored.actions.useMcp).toBe(MINIMAL_SETTINGS.actions.useMcp)
		// The previously-projected object must remain untouched and is not
		// used downstream; this proves the resolver doesn't carry state.
		expect(projected.actions.readFiles).toBe(true)
	})

	it("resolver is idempotent: all(all(x)) == all(x)", () => {
		const once = resolveEffectiveAutoApproval(MINIMAL_SETTINGS, "all")
		const twice = resolveEffectiveAutoApproval(once, "all")
		expect(twice.actions).toEqual(once.actions)
	})
})

describe("resolveEffectiveHostMode", () => {
	it("override=all yields 'all' host mode", () => {
		expect(resolveEffectiveHostMode(MINIMAL_SETTINGS, "all")).toBe("all")
	})

	it("override=all yields 'all' even when persisted executeSafeCommands=true (override wins)", () => {
		const settings: AutoApprovalSettings = {
			...MINIMAL_SETTINGS,
			actions: { ...MINIMAL_SETTINGS.actions, executeSafeCommands: true },
		}
		expect(resolveEffectiveHostMode(settings, "all")).toBe("all")
	})

	it("override=none + executeSafeCommands=true => 'safe-only'", () => {
		const settings: AutoApprovalSettings = {
			...MINIMAL_SETTINGS,
			actions: { ...MINIMAL_SETTINGS.actions, executeSafeCommands: true },
		}
		expect(resolveEffectiveHostMode(settings, "none")).toBe("safe-only")
	})

	it("override=none + executeSafeCommands=false => 'manual'", () => {
		expect(resolveEffectiveHostMode(MINIMAL_SETTINGS, "none")).toBe("manual")
	})
})

describe("SessionAutoApprovalStore", () => {
	it("starts inactive", () => {
		const store = new SessionAutoApprovalStore()
		expect(store.getOverride("any-session")).toBe("none")
	})

	it("setOverride('all', sessionId) activates for that session", () => {
		const store = new SessionAutoApprovalStore()
		store.setOverride("sess-A", "all")
		expect(store.getOverride("sess-A")).toBe("all")
	})

	it("setOverride('all', sessionId) does NOT activate for a different session", () => {
		const store = new SessionAutoApprovalStore()
		store.setOverride("sess-A", "all")
		expect(store.getOverride("sess-B")).toBe("none")
	})

	it("CORRECTION02: setOverride('all', undefined) ARMS (does not refuse) and arm survives getOverride", () => {
		const store = new SessionAutoApprovalStore()
		store.setOverride(undefined, "all")
		expect(store.isArmed()).toBe(true)
		// getOverride is PURE: it does NOT consume the arm. The arm survives
		// every read until consumePendingOverride() is called explicitly.
		expect(store.getOverride("any")).toBe("none")
		expect(store.isArmed()).toBe(true)
	})

	it("setOverride('none') clears the active override regardless of sessionId", () => {
		const store = new SessionAutoApprovalStore()
		store.setOverride("sess-A", "all")
		store.setOverride("sess-A", "none")
		expect(store.getOverride("sess-A")).toBe("none")
	})

	it("clearSessionAutoApproval destroys any active override", () => {
		const store = new SessionAutoApprovalStore()
		store.setOverride("sess-A", "all")
		store.clearSessionAutoApproval()
		expect(store.getOverride("sess-A")).toBe("none")
	})

	it("snapshot returns the active override and sessionId", () => {
		const store = new SessionAutoApprovalStore()
		store.setOverride("sess-A", "all")
		expect(store.snapshot()).toEqual({ override: "all", sessionId: "sess-A", armed: "none" })
	})

	it("snapshot is inert when inactive", () => {
		const store = new SessionAutoApprovalStore()
		expect(store.snapshot()).toEqual({ override: "none", sessionId: undefined, armed: "none" })
	})

	// Stale-task-leak proof: a NEW task must NEVER inherit the previous
	// task's override. The store models the active session id explicitly
	// so a new sessionId sees "none".
	it("stale-task leak proof: task A all=true, task B begins => task B override=none", () => {
		const store = new SessionAutoApprovalStore()
		store.setOverride("sess-A", "all")
		// Task B begins with a different sessionId.
		expect(store.getOverride("sess-B")).toBe("none")
	})

	it("stale-task leak proof: clearSessionAutoApproval resets state for next task", () => {
		const store = new SessionAutoApprovalStore()
		store.setOverride("sess-A", "all")
		store.clearSessionAutoApproval()
		// Task B begins; even if it reused "sess-A" identity, the explicit
		// clear from the clearTask choke-point makes the override "none".
		expect(store.getOverride("sess-A")).toBe("none")
	})
	describe("CORRECTION02: pre-arm intent + lifecycle separation", () => {
		it("setOverride(undefined, 'all') arms a one-shot intent (does not bind yet)", () => {
			const store = new SessionAutoApprovalStore()
			store.setOverride(undefined, "all")
			expect(store.isArmed()).toBe(true)
			expect(store.snapshot().armed).toBe("all")
			// No session id yet — so getOverride(undefined) returns "none" without consuming.
			expect(store.getOverride(undefined)).toBe("none")
			expect(store.isArmed()).toBe(true) // still armed: getOverride is pure
		})

		it("setOverride(sessionId, 'all') binds directly without arming", () => {
			const store = new SessionAutoApprovalStore()
			store.setOverride("sess-A", "all")
			expect(store.isArmed()).toBe(false)
			expect(store.getOverride("sess-A")).toBe("all")
		})

		it("getOverride() is PURE: it does NOT consume the arm", () => {
			const store = new SessionAutoApprovalStore()
			store.setOverride(undefined, "all")
			for (let i = 0; i < 5; i++) {
				expect(store.getOverride("sess-A")).toBe("none")
				expect(store.isArmed()).toBe(true)
			}
		})

		it("consumePendingOverride(newSessionId) binds the arm and clears it", () => {
			const store = new SessionAutoApprovalStore()
			store.setOverride(undefined, "all")
			const consumed = store.consumePendingOverride("sess-A")
			expect(consumed).toBe(true)
			expect(store.isArmed()).toBe(false)
			// Now getOverride returns the bound value (pure read).
			expect(store.getOverride("sess-A")).toBe("all")
		})

		it("consumePendingOverride is a no-op when no arm is set", () => {
			const store = new SessionAutoApprovalStore()
			const consumed = store.consumePendingOverride("sess-A")
			expect(consumed).toBe(false)
			expect(store.getOverride("sess-A")).toBe("none")
		})

		it("consumePendingOverride is one-shot: second call returns false", () => {
			const store = new SessionAutoApprovalStore()
			store.setOverride(undefined, "all")
			expect(store.consumePendingOverride("sess-A")).toBe(true)
			expect(store.consumePendingOverride("sess-B")).toBe(false) // arm is gone
		})

		it("clearActiveOverride destroys ONLY the bound override (arm survives)", () => {
			const store = new SessionAutoApprovalStore()
			store.setOverride("sess-A", "all") // bind directly
			store.setOverride(undefined, "all") // also arm
			store.clearActiveOverride()
			expect(store.isArmed()).toBe(true) // arm survives!
			expect(store.getOverride("sess-A")).toBe("none")
		})

		it("clearPendingArm destroys ONLY the arm (bound override survives)", () => {
			const store = new SessionAutoApprovalStore()
			store.setOverride("sess-A", "all") // bind directly
			store.setOverride(undefined, "all") // also arm
			store.clearPendingArm()
			expect(store.isArmed()).toBe(false)
			expect(store.getOverride("sess-A")).toBe("all") // bind survives
		})

		it("clearSessionAutoApproval destroys BOTH (legacy union; full reset)", () => {
			const store = new SessionAutoApprovalStore()
			store.setOverride(undefined, "all") // arms
			store.consumePendingOverride("sess-A") // binds
			store.clearSessionAutoApproval()
			expect(store.isArmed()).toBe(false)
			expect(store.getOverride("sess-A")).toBe("none")
		})

		it("setOverride(undefined, 'none') clears both arm and bind (UI toggle off)", () => {
			const store = new SessionAutoApprovalStore()
			store.setOverride(undefined, "all") // arms
			store.consumePendingOverride("sess-X") // binds
			store.setOverride(undefined, "none")
			expect(store.isArmed()).toBe(false)
			expect(store.getOverride("sess-X")).toBe("none")
		})
	})

	describe("CORRECTION01: stripRequiresApproval", () => {
		it("strips requires_approval when present", () => {
			const input = { command: "ls", requires_approval: true }
			expect(stripRequiresApproval(input)).toEqual({ command: "ls" })
		})

		it("returns the same object when requires_approval is absent", () => {
			const input = { command: "ls" }
			expect(stripRequiresApproval(input)).toBe(input)
		})

		it("returns primitives unchanged", () => {
			expect(stripRequiresApproval(null)).toBe(null)
			expect(stripRequiresApproval(undefined)).toBe(undefined)
			expect(stripRequiresApproval("foo")).toBe("foo")
			expect(stripRequiresApproval(42)).toBe(42)
		})
	})

	describe("CORRECTION02: resolveSessionHostAuthorization composes OVER baseAuth", () => {
		it("returns undefined when override is 'none'", () => {
			const base = commandHostAuthorization({ mode: "manual" })
			expect(resolveSessionHostAuthorization(base, "none")).toBeUndefined()
		})

		it("projects mode:'all' + preserves base explicitAllowRules", () => {
			const base = commandHostAuthorization({
				mode: "safe-only",
				explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
			})
			const composed = resolveSessionHostAuthorization(base, "all")
			expect(composed).toBeDefined()
			expect(composed!.mode).toBe("all")
			expect(composed!.explicitAllowRules).toBeDefined()
			expect(Array.isArray(composed!.explicitAllowRules)).toBe(true)
			expect(composed!.explicitAllowRules!.length).toBeGreaterThan(0)
		})

		it("CORRECTION02: preserves explicitDenyRules from the base (the lattice fix)", () => {
			// Production has no deny rules today, but if any are configured
			// (test or future deny source), the session override must NOT
			// drop them. CORRECTION01 manufactured a fresh authorization and
			// silently discarded deny rules; this test fails CORRECTION01.
			const denyRule = { source: "production_deny", pattern: /^\s*rm\s+-rf/u }
			const base = commandHostAuthorization({
				mode: "manual",
				explicitDenyRules: [denyRule],
			})
			const composed = resolveSessionHostAuthorization(base, "all")
			expect(composed).toBeDefined()
			expect(composed!.explicitDenyRules).toBeDefined()
			expect(composed!.explicitDenyRules).toHaveLength(1)
			expect(composed!.explicitDenyRules![0]).toEqual(denyRule)
		})

		it("falls back to DEFAULT_COMMAND_HOST_ALLOW_RULES only when base has none", () => {
			const base = commandHostAuthorization({ mode: "manual" })
			const composed = resolveSessionHostAuthorization(base, "all")
			expect(composed!.explicitAllowRules).toBeDefined()
			expect(composed!.explicitAllowRules!.length).toBeGreaterThan(0)
		})

		it("does NOT mutate the base authorization", () => {
			const base = commandHostAuthorization({ mode: "manual" })
			const baseSnapshot = JSON.stringify(base)
			resolveSessionHostAuthorization(base, "all")
			expect(JSON.stringify(base)).toBe(baseSnapshot)
		})


// ---------------------------------------------------------------------------
// ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01
//
// RED phase 1: pin `isYoloSessionRequested` against the persisted × override
// truth table. IMPLEMENTATION01 §2 RED (a).
// ---------------------------------------------------------------------------

/**
 * ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01
 *
 * The persisted-YOLO intent is defined over the canonical 5-key
 * semantic action gate. Legacy/compatibility fields
 * (`readFilesExternally`, `editFilesExternally`, `executeAllCommands`)
 * MUST NOT participate in the YOLO semantic — flipping them must not
 * affect classification. This list is the binding product policy;
 * adding a new key here requires an explicit ACT.
 */
const YOLO_REQUEST_ACTION_KEYS = [
	"readFiles",
	"editFiles",
	"executeSafeCommands",
	"useBrowser",
	"useMcp",
] as const satisfies ReadonlyArray<keyof AutoApprovalSettings["actions"]>

const ALL_PERSISTED_ACTIONS_TRUE: AutoApprovalSettings = {
	...DEFAULT_AUTO_APPROVAL_SETTINGS,
	actions: {
		...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
		readFiles: true,
		editFiles: true,
		executeSafeCommands: true,
		useBrowser: true,
		useMcp: true,
	},
}

const MIXED_PERSISTED_ACTIONS: AutoApprovalSettings = {
	...DEFAULT_AUTO_APPROVAL_SETTINGS,
	actions: {
		...DEFAULT_AUTO_APPROVAL_SETTINGS.actions,
		readFiles: true,
		editFiles: false, // <- the one missing gate
		executeSafeCommands: true,
		useBrowser: true,
		useMcp: true,
	},
}

describe("ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01 / isYoloSessionRequested", () => {
	it("RED (a.1): persisted all-5-true + override='none' → true (persisted-only path converges)", () => {
		expect(isYoloSessionRequested(ALL_PERSISTED_ACTIONS_TRUE, "none")).toBe(true)
	})

	it("RED (a.2): persisted mixed + override='all' → true (session override widens intent)", () => {
		expect(isYoloSessionRequested(MIXED_PERSISTED_ACTIONS, "all")).toBe(true)
	})

	it("RED (a.3): persisted mixed + override='none' → false (no persisted, no override)", () => {
		expect(isYoloSessionRequested(MIXED_PERSISTED_ACTIONS, "none")).toBe(false)
	})

	it("RED (a.4): persisted all-5-true + override='all' → true (both routes agree)", () => {
		expect(isYoloSessionRequested(ALL_PERSISTED_ACTIONS_TRUE, "all")).toBe(true)
	})

	it("RED (a.5) schema-coverage: each canonical YOLO_REQUEST_ACTION_KEYS key participates in the conjunction", () => {
		// Flipping any single canonical key to false (while leaving the
		// other four true) must break the persisted-YOLO classification.
		// If a future ACT adds a new semantic YOLO gate, the helper
		// body MUST be updated to include it AND this test MUST be
		// updated to iterate over the new keyset — both moves are
		// required (compile-time contract + test-time contract).
		for (const key of YOLO_REQUEST_ACTION_KEYS) {
			const persisted: AutoApprovalSettings = {
				...ALL_PERSISTED_ACTIONS_TRUE,
				actions: {
					...ALL_PERSISTED_ACTIONS_TRUE.actions,
					[key]: false,
				},
			}
			expect(isYoloSessionRequested(persisted, "none")).toBe(false)
		}
	})

	it("RED (a.6) legacy-key conservation: legacy compatibility fields do NOT affect YOLO classification", () => {
		// Automotive-load-bearing case: with all 5 canonical gates true,
		// flipping each legacy field to false individually (and together)
		// must NOT change the YOLO classification. This prevents
		// historical compatibility knobs (readFilesExternally,
		// editFilesExternally, executeAllCommands) from silently
		// becoming YOLO semantic authority.
		const legacyKeys = [
			"readFilesExternally",
			"editFilesExternally",
			"executeAllCommands",
		] as const
		for (const key of legacyKeys) {
			const persisted: AutoApprovalSettings = {
				...ALL_PERSISTED_ACTIONS_TRUE,
				actions: {
					...ALL_PERSISTED_ACTIONS_TRUE.actions,
					[key]: false,
				},
			}
			expect(isYoloSessionRequested(persisted, "none")).toBe(true)
		}
		// And: all three legacy keys off simultaneously is still YOLO.
		const allLegacyOff: AutoApprovalSettings = {
			...ALL_PERSISTED_ACTIONS_TRUE,
			actions: {
				...ALL_PERSISTED_ACTIONS_TRUE.actions,
				readFilesExternally: false,
				editFilesExternally: false,
				executeAllCommands: false,
			},
		}
		expect(isYoloSessionRequested(allLegacyOff, "none")).toBe(true)
	})
})

// ---------------------------------------------------------------------------
// ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01
//
// RED phase 2: pin `deriveExplicitCompletionAuthority` against the conservation
// matrix. IMPLEMENTATION01 §2 RED (c) negative + positive cases.
//
// The four facts are explicit booleans so the conservation matrix is
// testable without an integration harness.
// ---------------------------------------------------------------------------

const YOLO_PERSISTED = ALL_PERSISTED_ACTIONS_TRUE

describe("ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01 / deriveExplicitCompletionAuthority", () => {
	it("RED (c.1) CAI-13A: YOLO_REQUESTED + SEATBELT NOT selected → authority OFF", () => {
		expect(
			deriveExplicitCompletionAuthority({
				interactive: true,
				persisted: YOLO_PERSISTED,
				override: "none",
				seatbeltSelected: false,
				seatbeltAvailable: false,
			}),
		).toBe(false)
	})

	it("RED (c.2) CAI-13B (LOAD-BEARING): YOLO_REQUESTED + SELECTED + substrate broken → authority OFF", () => {
		expect(
			deriveExplicitCompletionAuthority({
				interactive: true,
				persisted: YOLO_PERSISTED,
				override: "none",
				seatbeltSelected: true,
				seatbeltAvailable: false,
			}),
		).toBe(false)
	})

	it("RED (c.3) CAI-13C: YOLO_REQUESTED + SEATBELT_SELECTED + SEATBELT_AVAILABLE → authority ON (eligibility)", () => {
		expect(
			deriveExplicitCompletionAuthority({
				interactive: true,
				persisted: YOLO_PERSISTED,
				override: "none",
				seatbeltSelected: true,
				seatbeltAvailable: true,
			}),
		).toBe(true)
	})

	it("RED (c.4) non-interactive: even with all Seatbelt facts true, authority OFF", () => {
		expect(
			deriveExplicitCompletionAuthority({
				interactive: false,
				persisted: YOLO_PERSISTED,
				override: "none",
				seatbeltSelected: true,
				seatbeltAvailable: true,
			}),
		).toBe(false)
	})

	it("RED (c.5) manual/mixed persisted + no Seatbelt: authority OFF (CAI-02 conservation)", () => {
		expect(
			deriveExplicitCompletionAuthority({
				interactive: true,
				persisted: MIXED_PERSISTED_ACTIONS,
				override: "none",
				seatbeltSelected: true,
				seatbeltAvailable: true,
			}),
		).toBe(false)
	})

	it("RED (c.6) session override='all' + Seatbelt selected/available: authority ON (CAI-01B)", () => {
		expect(
			deriveExplicitCompletionAuthority({
				interactive: true,
				persisted: MIXED_PERSISTED_ACTIONS,
				override: "all",
				seatbeltSelected: true,
				seatbeltAvailable: true,
			}),
		).toBe(true)
	})
})

	})
})
