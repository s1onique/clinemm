/**
 * ACT-CLINEMM-LIFECYCLE-TRACEABILITY-01-CORRECTION01
 *
 * MUTATION TESTS for the contract-to-Mermaid synchronization validator.
 *
 * THE DEFECT THIS CORRECTION REPAIRS.
 *
 * `scripts/verify-lifecycle-transition-contract.ts` previously used a
 * hardcoded `requiredStatePairs` map and SEPARATELY asserted that each
 * transition id appeared *somewhere* in the Mermaid text. Those two checks
 * are independent, so BOTH of the following escaped detection:
 *
 *   1. altering a contract `source_state` / `target_state` — the contract
 *      and the diagram could disagree while verification stayed green; and
 *   2. attaching a transition id to the WRONG edge — the ids were still
 *      "present", just attached to the wrong association.
 *
 * Mermaid explicitly associates the text after `:` with the edge that
 * precedes it, so the relationship — not the presence of matching strings
 * — is what must be checked.
 *
 * These tests drive the REAL, extracted verification core
 * (`apps/vscode/src/sdk/lifecycle-transition-contract-verifier.ts`) against
 * the REAL contract TSV, the REAL Mermaid projection, and the REAL
 * transition ledger, and then apply mutations that MUST be rejected.
 */

import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
	parseLifecycleTransitionContract,
	parseMermaidTransitionEdges,
	transitionIdOfLabel,
	verifyLifecycleTransitionContract,
} from "../lifecycle-transition-contract-verifier"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..")
const contractPath = resolve(repoRoot, "docs/acts/ACT-CLINEMM-LIFECYCLE-TRACEABILITY-01/transition-contract.tsv")
const diagramPath = resolve(repoRoot, "docs/acts/ACT-CLINEMM-LIFECYCLE-TRACEABILITY-01/c9-c10-traceability.mmd")
const ledgerPath = resolve(repoRoot, "docs/architecture/task-lifecycle/transitions.tsv")

const contractText = readFileSync(contractPath, "utf8")
const diagramText = readFileSync(diagramPath, "utf8")
const ledgerTransitionIds = new Set(
	readFileSync(ledgerPath, "utf8")
		.trim()
		.split("\n")
		.slice(1)
		.map((line) => line.split("\t")[0]),
)

function verify(overrides: { contractText?: string; diagramText?: string } = {}) {
	return verifyLifecycleTransitionContract({
		contractText: overrides.contractText ?? contractText,
		diagramText: overrides.diagramText ?? diagramText,
		ledgerTransitionIds,
	})
}

/** Replace the contract's `source_state` (column 3) for one transition. */
function mutateContractSourceState(text: string, transitionId: string, newSourceState: string): string {
	const lines = text.trim().split("\n")
	const index = lines.findIndex((line) => line.startsWith(`${transitionId}\t`))
	if (index < 0) throw new Error(`transition ${transitionId} not found in the contract`)
	const cells = lines[index].split("\t")
	cells[2] = newSourceState
	lines[index] = cells.join("\t")
	return lines.join("\n")
}

/** Replace the contract's `target_state` (column 7) for one transition. */
function mutateContractTargetState(text: string, transitionId: string, newTargetState: string): string {
	const lines = text.trim().split("\n")
	const index = lines.findIndex((line) => line.startsWith(`${transitionId}\t`))
	if (index < 0) throw new Error(`transition ${transitionId} not found in the contract`)
	const cells = lines[index].split("\t")
	cells[6] = newTargetState
	lines[index] = cells.join("\t")
	return lines.join("\n")
}

/** Replace the label of the Mermaid edge whose label starts with `transitionId`. */
function mutateEdgeLabel(text: string, transitionId: string, newLabel: string): string {
	const lines = text.trim().split("\n")
	// The label is the text after the FIRST ":" of a labeled edge line.
	const index = lines.findIndex((line) => {
		const separator = line.indexOf(":")
		if (separator < 0) return false
		return transitionIdOfLabel(line.slice(separator + 1).trim()) === transitionId
	})
	if (index < 0) throw new Error(`no Mermaid edge carries the label ${transitionId}`)
	const separator = lines[index].indexOf(":")
	lines[index] = `${lines[index].slice(0, separator)}: ${newLabel}`
	return lines.join("\n")
}

describe("ACT-CLINEMM-LIFECYCLE-TRACEABILITY-01-CORRECTION01 contract/Mermaid association", () => {
	it("GREEN: the real contract and the real Mermaid projection are synchronized", () => {
		const result = verify()
		expect(result.errors).toEqual([])
		expect(result.transitionIds.sort()).toEqual(["A-03", "A-04", "A-05", "P-06"])
	})

	it("parses the labeled edges and associates each label with its own edge", () => {
		const edges = parseMermaidTransitionEdges(diagramText)
		const a03 = edges.filter((edge) => transitionIdOfLabel(edge.label) === "A-03")
		expect(a03).toHaveLength(1)
		expect(a03[0].source).toBe("ElmConsulted")
		expect(a03[0].target).toBe("ElmAuthorized")
	})

	// ------------------------------------------------------------------
	// MUTATION TESTS — each mutation MUST be rejected.
	// ------------------------------------------------------------------

	it("MUT-01: rejects a contract whose source_state is altered", () => {
		// A-03's source is "Elm consulted". Claim it is "C9 captured" and
		// the contract no longer agrees with the labeled edge.
		const mutated = mutateContractSourceState(contractText, "A-03", "C9 captured")
		const result = verify({ contractText: mutated })
		expect(result.errors.length).toBeGreaterThan(0)
		expect(result.errors.join("\n")).toContain("A-03")
	})

	it("MUT-02: rejects a contract whose target_state is altered", () => {
		const mutated = mutateContractTargetState(contractText, "A-04", "C10 withheld")
		const result = verify({ contractText: mutated })
		expect(result.errors.length).toBeGreaterThan(0)
		expect(result.errors.join("\n")).toContain("A-04")
	})

	it("MUT-03: rejects swapped transition IDs on existing Mermaid edges", () => {
		// Mutate two distinct edges by their endpoints.
		// Do NOT locate the second edge by an already-mutated ID.
		const mutatedDiagram = diagramText
			.replace(/(ElmConsulted\s*-->\s*ElmAuthorized\s*:\s*)A-03\b/, "$1A-04")
			.replace(/(ElmAuthorized\s*-->\s*PhaseCommitted\s*:\s*)A-04\b/, "$1A-03")

		const edges = parseMermaidTransitionEdges(mutatedDiagram)

		const endpointsFor = (id: string) =>
			edges.filter((edge) => transitionIdOfLabel(edge.label) === id).map((edge) => `${edge.source} --> ${edge.target}`)

		// Verify the mutation itself: both IDs survive exactly once,
		// but each is now attached to the other's edge.
		expect(endpointsFor("A-03")).toEqual(["ElmAuthorized --> PhaseCommitted"])
		expect(endpointsFor("A-04")).toEqual(["ElmConsulted --> ElmAuthorized"])

		// Both associations must be rejected independently.
		const { errors } = verify({ diagramText: mutatedDiagram })

		expect(errors).toEqual(
			expect.arrayContaining([
				expect.stringContaining("A-03: Mermaid edge is"),
				expect.stringContaining("A-04: Mermaid edge is"),
			]),
		)

		// Rejection must NOT result from missing transition IDs.
		expect(errors.some((error) => error.includes("absent from Mermaid projection"))).toBe(false)
	})

	it("MUT-04: rejects two Mermaid edges carrying the same transition id", () => {
		const lines = diagramText.trim().split("\n")
		const duplicated = [...lines, "    ElmConsulted --> ElmAuthorized : A-03 authorize"]
		const result = verify({ diagramText: duplicated.join("\n") })
		expect(result.errors.length).toBeGreaterThan(0)
		expect(result.errors.join("\n")).toContain("expected exactly one")
	})

	it("MUT-05: rejects a Mermaid edge whose label id is removed entirely", () => {
		const mutatedDiagram = mutateEdgeLabel(diagramText, "P-06", "same-ts marker promotion")
		const result = verify({ diagramText: mutatedDiagram })
		expect(result.errors.length).toBeGreaterThan(0)
		expect(result.errors.join("\n")).toContain("P-06")
	})

	it("MUT-06: rejects a diagram that is not a stateDiagram-v2", () => {
		const result = verify({ diagramText: diagramText.replace("stateDiagram-v2", "flowchart TD") })
		expect(result.errors.join("\n")).toContain("stateDiagram-v2")
	})

	it("the contract parser exposes the exact source and target states the validator compares", () => {
		const rows = parseLifecycleTransitionContract(contractText)
		const a03 = rows.find((row) => row.transition_id === "A-03")
		expect(a03?.source_state).toBe("Elm consulted")
		expect(a03?.target_state).toBe("Elm authorized")
	})
})
