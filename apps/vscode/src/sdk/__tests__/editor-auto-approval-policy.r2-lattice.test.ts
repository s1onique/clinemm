/**
 * R2 — pure edit-auto-approval lattice test (PHASE 2 / REVIEW CYCLE).
 *
 * ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01 PHASE 2.
 *
 * 6-row lattice frozen in phase0-reconfirmation.md §3:
 *
 *   | base edit | class       | external | result |
 *   | --------- | ----------- | -------- | ------ |
 *   | false     | inside      | any      | ASK    |
 *   | false     | outside     | any      | ASK    |
 *   | true      | inside      | any      | ALLOW  |
 *   | true      | outside     | false    | ASK    |
 *   | true      | outside     | true     | ALLOW  |
 *   | any       | unavailable | any      | ASK    |
 *
 * Layer boundary: `evaluateEditAutoApproval` is a PURE function with no fs I/O.
 * Tests run synchronously and exercise the function in isolation.
 */

import { describe, expect, it } from "vitest"
import { type EditApprovalContext, evaluateEditAutoApproval } from "../editor-auto-approval-policy"

function ctx(o: Partial<EditApprovalContext>): EditApprovalContext {
	return {
		editFiles: o.editFiles ?? true,
		editFilesExternally: o.editFilesExternally ?? false,
		classification: o.classification ?? "inside",
	}
}

describe("ACT-CLINEMM-EDITOR-EFFECTIVE-DESTINATION-APPROVAL01 R2 — pure lattice", () => {
	it("editFiles=false + inside + external=true => ASK (base-disabled dominates)", () => {
		const r = evaluateEditAutoApproval(ctx({ editFiles: false, classification: "inside", editFilesExternally: true }))
		expect(r.kind).toBe("ask")
	})

	it("editFiles=false + outside + external=false => ASK (base-disabled dominates)", () => {
		const r = evaluateEditAutoApproval(ctx({ editFiles: false, classification: "outside", editFilesExternally: false }))
		expect(r.kind).toBe("ask")
	})

	it("editFiles=true + inside + external=false => ALLOW", () => {
		const r = evaluateEditAutoApproval(ctx({ editFiles: true, classification: "inside", editFilesExternally: false }))
		expect(r.kind).toBe("allow")
	})

	it("editFiles=true + inside + external=true => ALLOW (external is moot when inside)", () => {
		const r = evaluateEditAutoApproval(ctx({ editFiles: true, classification: "inside", editFilesExternally: true }))
		expect(r.kind).toBe("allow")
	})

	it("editFiles=true + outside + external=false => ASK (load-bearing case)", () => {
		const r = evaluateEditAutoApproval(ctx({ editFiles: true, classification: "outside", editFilesExternally: false }))
		expect(r.kind).toBe("ask")
		if (r.kind === "ask") {
			expect(r.reason).toMatch(/outside/)
		}
	})

	it("editFiles=true + outside + external=true => ALLOW (explicit external authority)", () => {
		const r = evaluateEditAutoApproval(ctx({ editFiles: true, classification: "outside", editFilesExternally: true }))
		expect(r.kind).toBe("allow")
	})

	it("unavailable + editFiles=true + external=true => ASK (fail closed)", () => {
		const r = evaluateEditAutoApproval(ctx({ editFiles: true, classification: "unavailable", editFilesExternally: true }))
		expect(r.kind).toBe("ask")
		if (r.kind === "ask") {
			expect(r.reason).toMatch(/unavailable/i)
		}
	})

	it("unavailable + editFiles=false => ASK (fail closed)", () => {
		const r = evaluateEditAutoApproval(ctx({ editFiles: false, classification: "unavailable" }))
		expect(r.kind).toBe("ask")
	})
})
