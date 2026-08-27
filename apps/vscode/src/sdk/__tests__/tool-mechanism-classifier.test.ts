/**
 * ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-IMPLEMENTATION01 (TES-IMPL-01)
 *
 * Pure-classifier test matrix. Each test is the smallest unit of
 * truth the new TaskHeader mechanism projection depends on:
 *
 *   - Each canonical tool identity maps to its declared bucket.
 *   - Unknown / undefined / empty inputs fall through to "other".
 *   - The `sed -i ...` shell command text is classified as `command`
 *     (NOT `edit`) — we never infer purpose from arguments.
 *   - Mechanism conservation holds for every accumulation profile.
 *   - All standard tools (MCP `server__tool` shape, browser-fetch,
 *     search_*, list_files, etc.) classify deterministically.
 *
 * No React. No DOM. No host runtime. The classifier is the boundary
 * of the new telemetry projection; the host's TaskTelemetryTracker
 * extension is covered by the existing `task-telemetry-tracker.test.ts`
 * suite (extended below).
 */
import { describe, expect, it } from "vitest"
import {
	classifyToolMechanism,
	emptyMechanismSummary,
	isMcpToolName,
	isUsableMechanismProjection,
	mechanismSummaryIsConserved,
	recordMechanism,
} from "../tool-mechanism-classifier"

describe("ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-IMPLEMENTATION01 / classifyToolMechanism", () => {
	it("TES-CLASS-01: editor / apply_patch / write_to_file / replace_in_file / delete_file → edit", () => {
		const editTools = ["editor", "apply_patch", "write_to_file", "replace_in_file", "delete_file"]
		for (const name of editTools) {
			expect(classifyToolMechanism(name)).toBe("edit")
		}
	})

	it("TES-CLASS-02: run_commands / execute_command / cancel_command → command", () => {
		const commandTools = ["run_commands", "execute_command", "cancel_command"]
		for (const name of commandTools) {
			expect(classifyToolMechanism(name)).toBe("command")
		}
	})

	it("TES-CLASS-03: read_files / read_file / list_files / list_code_definition_names → read", () => {
		const readTools = ["read_files", "read_file", "list_files", "list_code_definition_names"]
		for (const name of readTools) {
			expect(classifyToolMechanism(name)).toBe("read")
		}
	})

	it("TES-CLASS-04: fetch_web_content / web_fetch / web_search → read (browser-fetch)", () => {
		// The recon says browser-fetch is a read mechanism (network
		// read of an external resource), not a separate bucket.
		const browserRead = ["fetch_web_content", "web_fetch", "web_search"]
		for (const name of browserRead) {
			expect(classifyToolMechanism(name)).toBe("read")
		}
	})

	it("TES-CLASS-05: search_codebase / search_files → search (distinct from read)", () => {
		// Mechanism ≠ approval policy: `sdk-tool-policies.isReadTool`
		// lumps search_* names in for auto-approval purposes, but the
		// mechanism projection deliberately distinguishes them.
		expect(classifyToolMechanism("search_codebase")).toBe("search")
		expect(classifyToolMechanism("search_files")).toBe("search")
	})

	it("TES-CLASS-06: <server>__<tool> MCP shape → mcp", () => {
		expect(classifyToolMechanism("figma-desktop__get_metadata")).toBe("mcp")
		expect(classifyToolMechanism("github__create_issue")).toBe("mcp")
		expect(isMcpToolName("figma-desktop__get_metadata")).toBe(true)
	})

	it("TES-CLASS-07: unknown registered tool → other", () => {
		expect(classifyToolMechanism("totally_unknown_tool")).toBe("other")
		expect(classifyToolMechanism("some_random_future_tool_name")).toBe("other")
	})

	it("TES-CLASS-08: undefined / empty / non-string inputs → other", () => {
		expect(classifyToolMechanism(undefined)).toBe("other")
		expect(classifyToolMechanism("")).toBe("other")
	})

	it('TES-CLASS-09 (M-killer): `run_commands("sed -i ...")` classifies as COMMAND, not EDIT', () => {
		// The load-bearing test from the recon. A shell command that
		// edits a file is still a `command` mechanism because we
		// never infer semantic purpose from text arguments. The
		// classifier only sees the registered toolName; the input
		// string is not even passed in.
		expect(classifyToolMechanism("run_commands")).toBe("command")
		// And an explicit `apply_patch` is the EDIT mechanism:
		expect(classifyToolMechanism("apply_patch")).toBe("edit")
		// These two would collapse to a single bucket if we ever
		// started inferring purpose from command text. The classifier
		// must NEVER do that — and this test is the witness.
	})

	it("TES-CLASS-10: empty / malformed MCP names do not classify as mcp", () => {
		// No separator at all → not MCP
		expect(classifyToolMechanism("figma-desktop")).toBe("other")
		// Leading separator → malformed, falls through to other
		expect(classifyToolMechanism("__tool")).toBe("other")
		// Trailing separator → malformed, falls through to other
		expect(classifyToolMechanism("server__")).toBe("other")
		expect(isMcpToolName("")).toBe(false)
		expect(isMcpToolName("__tool")).toBe(false)
		expect(isMcpToolName("server__")).toBe(false)
	})
})

describe("ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-IMPLEMENTATION01 / recordMechanism + conservation", () => {
	it("TES-REC-01: empty summary is conserved (total = 0 = sum of buckets)", () => {
		const empty = emptyMechanismSummary()
		expect(empty).toEqual({
			total: 0,
			edit: 0,
			command: 0,
			read: 0,
			search: 0,
			mcp: 0,
			other: 0,
		})
		expect(mechanismSummaryIsConserved(empty)).toBe(true)
	})

	it("TES-REC-02: full mixed workload (the RED target from the ACT plan) accumulates correctly", () => {
		// The canonical RED fixture from §3 of the ACT plan:
		//   2 editor
		//   1 apply_patch        (also edit)
		//   3 run_commands       (command)
		//   2 read               (read_files / read_file)
		//   1 MCP                (server__tool)
		//   1 unknown            (other)
		// Expected: total=10, edit=3, command=3, read=2, mcp=1, other=1
		const events: Array<string | undefined> = [
			"editor", // +1 edit
			"editor", // +1 edit
			"apply_patch", // +1 edit
			"run_commands", // +1 command
			"run_commands", // +1 command
			"run_commands", // +1 command
			"read_files", // +1 read
			"read_file", // +1 read
			"some_mcp_server__some_tool", // +1 mcp
			"unrecognized_tool", // +1 other
		]
		let summary = emptyMechanismSummary()
		for (const name of events) {
			summary = recordMechanism(summary, name)
		}
		expect(summary).toEqual({
			total: 10,
			edit: 3,
			command: 3,
			read: 2,
			search: 0,
			mcp: 1,
			other: 1,
		})
		expect(mechanismSummaryIsConserved(summary)).toBe(true)
	})

	it("TES-REC-03: undefined toolName events accumulate to `other`", () => {
		let summary = emptyMechanismSummary()
		summary = recordMechanism(summary, undefined)
		summary = recordMechanism(summary, undefined)
		summary = recordMechanism(summary, "")
		expect(summary.other).toBe(3)
		expect(summary.total).toBe(3)
		expect(mechanismSummaryIsConserved(summary)).toBe(true)
	})

	it("TES-REC-04: recordMechanism does NOT mutate its input", () => {
		const before = emptyMechanismSummary()
		const after = recordMechanism(before, "apply_patch")
		// The input summary is unchanged.
		expect(before).toEqual({
			total: 0,
			edit: 0,
			command: 0,
			read: 0,
			search: 0,
			mcp: 0,
			other: 0,
		})
		// The output summary reflects the increment.
		expect(after.edit).toBe(1)
		expect(after.total).toBe(1)
		expect(mechanismSummaryIsConserved(after)).toBe(true)
	})

	it("TES-REC-06: conservation is the property under test — independent arithmetic check", () => {
		// Build a deliberately asymmetric workload: 7 edit, 5 command,
		// 3 read, 2 search, 4 mcp, 1 other → total 22.
		const workload: Array<[string, number]> = [
			["editor", 7],
			["run_commands", 5],
			["read_files", 3],
			["search_files", 2],
			["some_mcp__tool", 4],
			["mystery_tool", 1],
		]
		let summary = emptyMechanismSummary()
		for (const [name, count] of workload) {
			for (let i = 0; i < count; i++) {
				summary = recordMechanism(summary, name)
			}
		}
		expect(summary).toEqual({
			total: 22,
			edit: 7,
			command: 5,
			read: 3,
			search: 2,
			mcp: 4,
			other: 1,
		})
		expect(mechanismSummaryIsConserved(summary)).toBe(true)
		// Independent arithmetic: sum of buckets equals total.
		const sum = summary.edit + summary.command + summary.read + summary.search + summary.mcp + summary.other
		expect(sum).toBe(summary.total)
	})
})

/**
 * ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-IMPLEMENTATION01 / wire-boundary
 * validator. The webview trusts the per-mechanism projection only
 * when `isUsableMechanismProjection` returns true. These three tests
 * pin the boundary invariants: cross-field conservation, finite
 * non-negative integers, and bucket-sum conservation.
 */
describe("ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-IMPLEMENTATION01 / wire-boundary validator", () => {
	it("TES-WIRE-01: a valid conserved projection is usable", () => {
		const mechanism = {
			total: 10,
			edit: 3,
			command: 3,
			read: 2,
			search: 0,
			mcp: 1,
			other: 1,
		}
		expect(isUsableMechanismProjection(mechanism, 10)).toBe(true)
	})

	it("TES-WIRE-02: `mechanism.total !== toolCalls` triggers fallback (cross-field conservation)", () => {
		// The classic version-skew case: producer's flat counter and
		// the per-mechanism total disagree. The webview MUST fall back
		// to the legacy flat `🔧 N` rendering rather than display
		// contradictory numbers.
		const mechanism = {
			total: 9, // ≠ toolCalls (10)
			edit: 3,
			command: 3,
			read: 2,
			search: 0,
			mcp: 1,
			other: 0,
		}
		expect(isUsableMechanismProjection(mechanism, 10)).toBe(false)
	})

	it("TES-WIRE-03: bucket sum !== mechanism.total triggers fallback (in-process conservation)", () => {
		const mechanism = {
			total: 10,
			edit: 3,
			command: 3,
			read: 2,
			search: 0,
			mcp: 1,
			other: 0, // sum = 9, total = 10 → not conserved
		}
		expect(isUsableMechanismProjection(mechanism, 10)).toBe(false)
	})

	it("TES-WIRE-04: undefined `mechanism` triggers fallback (Hub/Remote absence)", () => {
		expect(isUsableMechanismProjection(undefined, 7)).toBe(false)
	})

	it("TES-WIRE-05: NaN / Infinity / negative / non-integer values trigger fallback (malformed snapshot)", () => {
		const base = { total: 10, edit: 3, command: 3, read: 2, search: 0, mcp: 1, other: 1 }
		// NaN bucket
		expect(isUsableMechanismProjection({ ...base, edit: Number.NaN }, 10)).toBe(false)
		// Infinity total
		expect(isUsableMechanismProjection({ ...base, total: Number.POSITIVE_INFINITY }, 10)).toBe(false)
		// Negative bucket
		expect(
			isUsableMechanismProjection(
				{ ...base, mcp: -1, other: 2 }, // sum still 10 but mcp < 0
				10,
			),
		).toBe(false)
		// Fractional value
		expect(isUsableMechanismProjection({ ...base, read: 2.5, other: 0.5 }, 10)).toBe(false)
	})

	it("TES-WIRE-06: zero / all-zero projection is usable iff toolCalls is also zero", () => {
		const empty = emptyMechanismSummary()
		expect(isUsableMechanismProjection(empty, 0)).toBe(true)
		expect(isUsableMechanismProjection(empty, 1)).toBe(false)
	})
})
