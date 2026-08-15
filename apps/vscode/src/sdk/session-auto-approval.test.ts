/**
 * ACT-CLINEMM-SESSION-AUTONOMY01
 *
 * Unit tests for the session-scoped auto-approval projection.
 * Pure resolvers + the SessionAutoApprovalStore owner class.
 */

import type { AutoApprovalSettings } from "@shared/AutoApprovalSettings"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@shared/AutoApprovalSettings"
import { describe, expect, it } from "vitest"
import { resolveEffectiveAutoApproval, resolveEffectiveHostMode, SessionAutoApprovalStore } from "./session-auto-approval"

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

	it("setOverride('all', undefined) is refused (sessionId required)", () => {
		const store = new SessionAutoApprovalStore()
		store.setOverride(undefined, "all")
		expect(store.getOverride("any")).toBe("none")
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
		expect(store.snapshot()).toEqual({ override: "all", sessionId: "sess-A" })
	})

	it("snapshot is inert when inactive", () => {
		const store = new SessionAutoApprovalStore()
		expect(store.snapshot()).toEqual({ override: "none", sessionId: undefined })
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
})
