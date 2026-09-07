/**
 * ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01 / Phase B
 *
 * RED -> GREEN witness for MP-R4, MP-R5, MP-R6, MP-R9, MP-R17
 * session/default-binding invariants.
 *
 * Production seams driven (this file):
 *   writeActiveProfileIdToHistoryItem  = REAL_PRODUCTION_SEAM
 *   readActiveProfileIdFromHistoryItem = REAL_PRODUCTION_SEAM
 *   resolveActiveProfileIdForResume    = REAL_PRODUCTION_SEAM
 *   resolveActiveProfileIdForNewTask   = REAL_PRODUCTION_SEAM
 *   readDefaultModelProfileId          = REAL_PRODUCTION_SEAM
 *   writeDefaultModelProfileId         = REAL_PRODUCTION_SEAM
 *   isKnownProfileId                   = REAL_PRODUCTION_SEAM
 *
 * Collaborators stubbed: the global-state shim (a plain JS object
 * satisfying the typed reader/writer signature).
 */

import { describe, expect, it } from "vitest"
import type { HistoryItem } from "@shared/HistoryItem"
import {
	isKnownProfileId,
	readActiveProfileIdFromHistoryItem,
	readDefaultModelProfileId,
	resolveActiveProfileIdForNewTask,
	resolveActiveProfileIdForResume,
	writeActiveProfileIdToHistoryItem,
	writeDefaultModelProfileId,
} from "../profile-store/session-binding"

function makeProfiles(): Record<string, { profileId: string }> {
	return {
		"prof-A": { profileId: "prof-A" },
		"prof-B": { profileId: "prof-B" },
	}
}

function makeHistoryItem(overrides: Partial<HistoryItem> = {}): HistoryItem {
	return {
		id: "task-A",
		ts: 1,
		task: "Task A",
		tokensIn: 0,
		tokensOut: 0,
		totalCost: 0,
		...overrides,
	}
}

interface GlobalStateShim {
	values: Record<string, unknown>
	getGlobalStateKey(key: string): unknown
	setGlobalState(key: string, value: unknown): void
}

function makeGlobalState(): GlobalStateShim {
	const shim: GlobalStateShim = {
		values: {},
		getGlobalStateKey(key) {
			return shim.values[key]
		},
		setGlobalState(key, value) {
			shim.values[key] = value
		},
	}
	return shim
}

describe("ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01 / Phase B", () => {
	// -------------------------------------------------------------------------
	// Per-task active profile binding
	// -------------------------------------------------------------------------
	describe("per-task active profile binding", () => {
		it("MPQS01_BIND_WRITE_READ_ROUNDTRIP: writeActiveProfileIdToHistoryItem then read returns the same id", () => {
			const original = makeHistoryItem()
			const written = writeActiveProfileIdToHistoryItem(original, "prof-A")
			expect(written.activeProfileId).toBe("prof-A")
			expect(readActiveProfileIdFromHistoryItem(written)).toBe("prof-A")
		})

		it("MPQS01_BIND_WRITE_DOES_NOT_MUTATE_ORIGINAL: writeActiveProfileIdToHistoryItem returns a fresh object", () => {
			const original = makeHistoryItem()
			const written = writeActiveProfileIdToHistoryItem(original, "prof-A")
			expect(written).not.toBe(original)
			expect(original.activeProfileId).toBeUndefined()
		})

		it("MPQS01_BIND_CLEAR_REMOVES_FIELD: passing undefined removes the field entirely", () => {
			const written = writeActiveProfileIdToHistoryItem(makeHistoryItem(), "prof-A")
			const cleared = writeActiveProfileIdToHistoryItem(written, undefined)
			expect(cleared.activeProfileId).toBeUndefined()
			expect("activeProfileId" in cleared).toBe(false)
		})

		it("MPQS01_BIND_EMPTY_STRING_REJECTED: empty string throws", () => {
			expect(() => writeActiveProfileIdToHistoryItem(makeHistoryItem(), "")).toThrow()
		})
	})

	// -------------------------------------------------------------------------
	// Global default profile binding
	// -------------------------------------------------------------------------
	describe("global default profile binding", () => {
		it("MPQS01_DEFAULT_WRITE_READ_ROUNDTRIP: writeDefaultModelProfileId then read returns the same id", () => {
			const shim = makeGlobalState()
			writeDefaultModelProfileId(shim as never, "prof-B")
			expect(readDefaultModelProfileId(shim as never)).toBe("prof-B")
		})

		it("MPQS01_DEFAULT_CLEAR_REMOVES: writeDefaultModelProfileId(undefined) clears the value", () => {
			const shim = makeGlobalState()
			writeDefaultModelProfileId(shim as never, "prof-B")
			writeDefaultModelProfileId(shim as never, undefined)
			expect(readDefaultModelProfileId(shim as never)).toBeUndefined()
		})

		it("MPQS01_DEFAULT_QUICK_SWITCH_DOES_NOT_MUTATE: per-task write does NOT touch global default", () => {
			const shim = makeGlobalState()
			const before = shim.values["defaultModelProfileId"]
			const item = writeActiveProfileIdToHistoryItem(makeHistoryItem(), "prof-A")
			expect(readActiveProfileIdFromHistoryItem(item)).toBe("prof-A")
			expect(shim.values["defaultModelProfileId"]).toBe(before)
		})
	})

	// -------------------------------------------------------------------------
	// Resume precedence (MP-R4, MP-R9, MP-R17)
	// -------------------------------------------------------------------------
	describe("resume precedence", () => {
		it("MPQS01_RESUME_TASK_BINDING_WINS: when both task and default are valid, task wins", () => {
			const item = makeHistoryItem({ activeProfileId: "prof-A" })
			expect(resolveActiveProfileIdForResume(item, "prof-B", makeProfiles())).toBe("prof-A")
		})

		it("MPQS01_RESUME_DEFAULT_WHEN_TASK_MISSING: missing task binding -> default", () => {
			const item = makeHistoryItem()
			expect(resolveActiveProfileIdForResume(item, "prof-B", makeProfiles())).toBe("prof-B")
		})

		it("MPQS01_RESUME_LEGACY_WHEN_NEITHER: neither -> undefined -> legacy", () => {
			const item = makeHistoryItem()
			expect(resolveActiveProfileIdForResume(item, undefined, makeProfiles())).toBeUndefined()
		})

		it("MPQS01_RESUME_DELETED_TASK_PROFILE_FALLS_BACK_TO_DEFAULT: deleted profile in task binding -> default", () => {
			const item = makeHistoryItem({ activeProfileId: "prof-DELETED" })
			expect(resolveActiveProfileIdForResume(item, "prof-B", makeProfiles())).toBe("prof-B")
		})

		it("MPQS01_RESUME_DELETED_BOTH_FALLS_BACK_TO_LEGACY: deleted task binding AND no default -> legacy", () => {
			const item = makeHistoryItem({ activeProfileId: "prof-DELETED" })
			expect(resolveActiveProfileIdForResume(item, undefined, makeProfiles())).toBeUndefined()
		})

		it("MPQS01_RESUME_TASK_A_B_INDEPENDENCE: task A=A, task B=B, resume each -> each restored", () => {
			const profiles = makeProfiles()
			const taskA = writeActiveProfileIdToHistoryItem(makeHistoryItem({ id: "task-A" }), "prof-A")
			const taskB = writeActiveProfileIdToHistoryItem(makeHistoryItem({ id: "task-B" }), "prof-B")
			expect(resolveActiveProfileIdForResume(taskA, "prof-B", profiles)).toBe("prof-A")
			expect(resolveActiveProfileIdForResume(taskB, "prof-A", profiles)).toBe("prof-B")
		})
	})

	// -------------------------------------------------------------------------
	// New-task precedence (MP-R5, MP-R6)
	// -------------------------------------------------------------------------
	describe("new-task precedence", () => {
		it("MPQS01_NEW_TASK_USES_DEFAULT: explicit default -> use default", () => {
			expect(resolveActiveProfileIdForNewTask("prof-A", makeProfiles())).toBe("prof-A")
		})

		it("MPQS01_NEW_TASK_NO_DEFAULT_LEGACY: no default -> undefined -> legacy", () => {
			expect(resolveActiveProfileIdForNewTask(undefined, makeProfiles())).toBeUndefined()
		})

		it("MPQS01_NEW_TASK_DELETED_DEFAULT_LEGACY: default references deleted profile -> legacy", () => {
			expect(resolveActiveProfileIdForNewTask("prof-DELETED", makeProfiles())).toBeUndefined()
		})
	})

	// -------------------------------------------------------------------------
	// isKnownProfileId
	// -------------------------------------------------------------------------
	describe("isKnownProfileId", () => {
		it("MPQS01_KNOWN_TRUE: known id returns true", () => {
			expect(isKnownProfileId("prof-A", makeProfiles())).toBe(true)
		})
		it("MPQS01_KNOWN_FALSE: unknown id returns false", () => {
			expect(isKnownProfileId("prof-X", makeProfiles())).toBe(false)
		})
		it("MPQS01_KNOWN_UNDEFINED_FALSE: undefined returns false", () => {
			expect(isKnownProfileId(undefined, makeProfiles())).toBe(false)
		})
		it("MPQS01_KNOWN_EMPTY_FALSE: empty string returns false", () => {
			expect(isKnownProfileId("", makeProfiles())).toBe(false)
		})
	})
})
