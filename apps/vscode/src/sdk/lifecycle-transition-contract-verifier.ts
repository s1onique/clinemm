/**
 * ACT-CLINEMM-LIFECYCLE-TRACEABILITY-01-CORRECTION01.
 *
 * PURE validation core for the bounded C9/C10 transition contract and its
 * Mermaid projection. It intentionally uses only Node/Bun built-ins and has
 * NO side effects, so the mutation tests can exercise the real
 * contract-to-diagram association check by importing it.
 *
 * WHY THIS MODULE EXISTS (the false positive being repaired).
 *
 * The previous validator hardcoded a `requiredStatePairs` map and
 * separately asserted that each transition id appeared *somewhere* in the
 * Mermaid text. Those two checks are INDEPENDENT, so:
 *
 *   - altering a contract `source_state`/`target_state` left verification
 *     green, and
 *   - attaching a transition id to the WRONG edge also escaped detection.
 *
 * Mermaid explicitly associates the text after `:` with the edge that
 * precedes it. The contract-to-diagram synchronization must therefore be
 * checked as an ASSOCIATION between (transition id -> labeled edge) and
 * (contract states -> expected edge endpoints), not as independent
 * substring presence.
 */

/**
 * The contract TSV names its states in prose ("Elm authorized", "C10
 * committed"); the Mermaid projection names them with identifiers
 * ("ElmAuthorized", "PhaseCommitted"). This is the EXPLICIT mapping
 * between the two vocabularies.
 */
export const STATE_ID_BY_CONTRACT_STATE: Readonly<Record<string, string>> = {
	"C9 captured": "C9Captured",
	"Elm consulted": "ElmConsulted",
	"Elm authorized": "ElmAuthorized",
	"Elm hold / Elm failure": "ElmConsulted",
	"C10 committed": "PhaseCommitted",
	"C10 withheld": "C10Withheld",
	"marker published": "MarkerPromoted",
}

export interface MermaidEdge {
	readonly source: string
	readonly target: string
	readonly label: string
}

/**
 * Parse the labeled edges of a Mermaid stateDiagram-v2 projection.
 *
 * Mermaid associates the text after `:` with the edge that precedes it,
 * so the association is the thing that must be verified.
 */
export function parseMermaidTransitionEdges(diagramText: string): MermaidEdge[] {
	const edges: MermaidEdge[] = []
	for (const rawLine of diagramText.split("\n")) {
		const line = rawLine.trim()
		if (!line || line.startsWith("%%")) continue
		const match = /^(\[\*\]|[A-Za-z0-9_]+)\s*-->\s*(\[\*\]|[A-Za-z0-9_]+)\s*:\s*(.+)$/.exec(line)
		if (!match) continue
		edges.push({ source: match[1], target: match[2], label: match[3].trim() })
	}
	return edges
}

/** The transition id is the leading token of the Mermaid edge label. */
export function transitionIdOfLabel(label: string): string | undefined {
	const match = /^([A-Z]-\d{2})\b/.exec(label)
	return match?.[1]
}

export interface LifecycleTransitionContractRow {
	readonly transition_id: string
	readonly source_state: string
	readonly target_state: string
	readonly production_seam: string
	readonly test_reference: string
}

/** Parse the contract TSV (header row excluded) into structured rows. */
export function parseLifecycleTransitionContract(contractText: string): LifecycleTransitionContractRow[] {
	const rows: LifecycleTransitionContractRow[] = []
	for (const line of contractText.trim().split("\n").slice(1)) {
		const cells = line.split("\t")
		const transition_id = cells[0]
		if (!transition_id) continue
		rows.push({
			transition_id,
			source_state: cells[2] ?? "",
			target_state: cells[6] ?? "",
			production_seam: cells[8] ?? "",
			test_reference: cells[9] ?? "",
		})
	}
	return rows
}

/**
 * Verify the contract-to-diagram synchronization by ASSOCIATION.
 *
 * For every transition in the TSV, find the Mermaid edge whose label
 * carries that transition id and assert that the edge's source/target
 * nodes are the ones the contract's `source_state`/`target_state` map
 * to. Returns the list of errors; an empty list means the contract and
 * the diagram are synchronized.
 */
export function verifyLifecycleTransitionContract(options: {
	readonly contractText: string
	readonly diagramText: string
	readonly ledgerTransitionIds: ReadonlySet<string>
}): { readonly errors: string[]; readonly transitionIds: string[] } {
	const { contractText, diagramText, ledgerTransitionIds } = options
	const contract = parseLifecycleTransitionContract(contractText)
	const errors: string[] = []
	const ids = new Set<string>()

	for (const row of contract) {
		const id = row.transition_id
		if (ids.has(id)) errors.push(`duplicate transition id: ${id}`)
		ids.add(id)
		if (!ledgerTransitionIds.has(id)) errors.push(`transition ${id} is absent from transitions.tsv`)
		if (!row.test_reference?.includes("__tests__/")) {
			errors.push(`transition ${id} has no executable test reference`)
		}
		if (!row.production_seam?.includes(".ts#")) {
			errors.push(`transition ${id} has no source path and symbol reference`)
		}
	}

	const edges = parseMermaidTransitionEdges(diagramText)
	const edgesByTransitionId = new Map<string, MermaidEdge[]>()
	for (const edge of edges) {
		const transitionId = transitionIdOfLabel(edge.label)
		if (!transitionId) continue
		const existing = edgesByTransitionId.get(transitionId) ?? []
		existing.push(edge)
		edgesByTransitionId.set(transitionId, existing)
	}

	for (const row of contract) {
		const id = row.transition_id
		const sourceState = row.source_state
		const targetState = row.target_state
		const expectedSource = sourceState ? STATE_ID_BY_CONTRACT_STATE[sourceState] : undefined
		const expectedTarget = targetState ? STATE_ID_BY_CONTRACT_STATE[targetState] : undefined
		if (!expectedSource) {
			errors.push(`${id}: no Mermaid state id is mapped for contract source_state "${sourceState}"`)
			continue
		}
		if (!expectedTarget) {
			errors.push(`${id}: no Mermaid state id is mapped for contract target_state "${targetState}"`)
			continue
		}
		const labeled = edgesByTransitionId.get(id)
		if (!labeled || labeled.length === 0) {
			errors.push(`${id}: absent from Mermaid projection (no labeled edge carries this transition id)`)
			continue
		}
		if (labeled.length > 1) {
			errors.push(`${id}: appears on ${labeled.length} Mermaid edges; expected exactly one`)
			continue
		}
		const edge = labeled[0]
		if (edge.source !== expectedSource || edge.target !== expectedTarget) {
			errors.push(
				`${id}: Mermaid edge is ${edge.source} --> ${edge.target}, but the contract requires ${expectedSource} --> ${expectedTarget} (from "${sourceState}" to "${targetState}")`,
			)
		}
	}

	if (!diagramText.includes("stateDiagram-v2")) errors.push("Mermaid projection is not stateDiagram-v2")

	return { errors, transitionIds: [...ids] }
}

/**
 * ACT-CLINEMM-LIFECYCLE-EXECUTABLE-PRESENTATION-CONTRACT01.
 *
 * The EXISTING strict contract-to-Mermaid verifier above covers the SEPARATE
 * `c9-c10-traceability.mmd` file (A-03, A-04, A-05, P-06) — it does NOT
 * cover the full Chart 04 document. This extension checks the Mermaid block
 * that is EMBEDDED in `docs/architecture/task-lifecycle/04-completion-presentation.md`.
 *
 * WHAT IT ASSERTS.
 *
 *   1. Every Chart 04 TRANSITION claim (P-01, P-02, P-03, P-06) appears on
 *      EXACTLY ONE labeled Mermaid edge in the embedded block.
 *   2. Every GUARD / PROJECTION / INVARIANT claim (P-04, P-05, P-07) does
 *      NOT appear as a Mermaid edge — those claims are proven by a contract
 *      entry plus an executable assertion, not by a graph-state transition.
 *   3. The embedded block does not claim that the authority marker is
 *      stamped at the `content_end` publication seam (the historical
 *      defect).
 *
 * ACT-CLINEMM-LIFECYCLE-EXECUTABLE-PRESENTATION-CONTRACT01-CORR01 adds:
 *
 *   4. Every Chart 04 TRANSITION claim labels the CORRECT edge: the labeled
 *      edge's source/target must equal the VERIFIED endpoints in
 *      `CHART_04_EXPECTED_EDGES`. Cardinality alone is insufficient — a
 *      SWAPPED pair of labels keeps every id present exactly once while
 *      inverting the meaning of both transitions. This is the same
 *      false-positive class that the MUT-03 correction closed for the
 *      c9-c10 traceability diagram.
 *
 * This is a DOCUMENTATION-SYNCHRONIZATION guard. It never asserts
 * behaviour: the behaviour is proven by the executable witness suite.
 */

/** The Chart 04 claims that ARE genuine transitions and therefore carry a Mermaid edge. */
export const CHART_04_TRANSITION_CLAIM_IDS: readonly string[] = ["P-01", "P-02", "P-03", "P-06"]

/** The Chart 04 claims that are NOT transitions and therefore carry NO Mermaid edge. */
export const CHART_04_NON_TRANSITION_CLAIM_IDS: readonly string[] = ["P-04", "P-05", "P-07"]

/**
 * The VERIFIED claim-id -> Mermaid-edge association for Chart 04.
 *
 * ACT-CLINEMM-LIFECYCLE-EXECUTABLE-PRESENTATION-CONTRACT01-CORR01: the
 * cardinality-only check ("each transition claim id appears on exactly one
 * labeled edge") is INSUFFICIENT. Swapping the LABELS of two edges keeps
 * every id present exactly once while inverting the meaning of both
 * transitions — the same false-positive class that the MUT-03 correction
 * closed for the c9-c10 traceability diagram.
 *
 * The association must therefore be checked as an ASSOCIATION between
 * (claim id -> labeled edge) and (claim id -> expected edge endpoints),
 * exactly like `verifyLifecycleTransitionContract` does for the c9-c10
 * diagram. The endpoints below are the VERIFIED Chart 04 edge mappings.
 */
export const CHART_04_EXPECTED_EDGES: Readonly<Record<string, { readonly source: string; readonly target: string }>> = {
	"P-01": { source: "[*]", target: "PartialRowPublished" },
	"P-02": { source: "PartialRowPublished", target: "FinalRowPublished" },
	"P-03": { source: "FinalRowPublished", target: "RowFilteredOut" },
	"P-06": { source: "C10Committed", target: "BadgeShown" },
}

/**
 * Extract the mermaid fence(s) from a Markdown document.
 *
 * The extraction is deliberately simple and strict: a fence opens with
 * ```mermaid and closes with the next ``` line.
 */
export function extractMermaidBlocks(markdown: string): string[] {
	const blocks: string[] = []
	const lines = markdown.split("\n")
	let current: string[] | undefined
	for (const line of lines) {
		if (current === undefined) {
			if (line.trim() === "```mermaid") {
				current = []
			}
			continue
		}
		if (line.trim() === "```") {
			blocks.push(current.join("\n"))
			current = undefined
			continue
		}
		current.push(line)
	}
	return blocks
}

/**
 * Verify the Chart 04 document's embedded Mermaid block against the claim
 * taxonomy and the marker-stamping reconciliation.
 */
export function verifyChart04CompletionPresentation(options: {
	readonly markdown: string
	readonly transitionClaimIds: readonly string[]
	readonly nonTransitionClaimIds: readonly string[]
	/**
	 * The VERIFIED claim-id -> expected-edge-endpoints association.
	 *
	 * ACT-CLINEMM-LIFECYCLE-EXECUTABLE-PRESENTATION-CONTRACT01-CORR01: when
	 * supplied, each transition claim's labeled edge must have EXACTLY these
	 * endpoints. This closes the cardinality-only false positive: a swapped
	 * label (both ids present exactly once, each on the other's edge) is
	 * REJECTED as an association mismatch.
	 */
	readonly expectedEdges?: Readonly<Record<string, { readonly source: string; readonly target: string }>>
}): { readonly errors: string[]; readonly mermaidBlockCount: number } {
	const { markdown, transitionClaimIds, nonTransitionClaimIds, expectedEdges } = options
	const errors: string[] = []
	const blocks = extractMermaidBlocks(markdown)
	if (blocks.length === 0) {
		return { errors: ["Chart 04 document has no embedded mermaid block"], mermaidBlockCount: 0 }
	}
	const diagramText = blocks.join("\n")
	const edges = parseMermaidTransitionEdges(diagramText)

	const edgesByClaimId = new Map<string, MermaidEdge[]>()
	for (const edge of edges) {
		const claimId = transitionIdOfLabel(edge.label)
		if (!claimId) continue
		const existing = edgesByClaimId.get(claimId) ?? []
		existing.push(edge)
		edgesByClaimId.set(claimId, existing)
	}

	for (const claimId of transitionClaimIds) {
		const labeled = edgesByClaimId.get(claimId) ?? []
		if (labeled.length === 0) {
			errors.push(`${claimId}: TRANSITION claim is absent from the Chart 04 Mermaid projection`)
			continue
		}
		if (labeled.length > 1) {
			errors.push(`${claimId}: appears on ${labeled.length} Chart 04 Mermaid edges; expected exactly one`)
			continue
		}
		// ACT-CLINEMM-LIFECYCLE-EXECUTABLE-PRESENTATION-CONTRACT01-CORR01:
		// the id must label the CORRECT edge, not merely SOME edge.
		const expected = expectedEdges?.[claimId]
		if (!expected) continue
		const edge = labeled[0]
		if (edge.source !== expected.source || edge.target !== expected.target) {
			errors.push(
				`${claimId}: Mermaid edge is ${edge.source} --> ${edge.target}, but Chart 04 requires ${expected.source} --> ${expected.target}`,
			)
		}
	}
	for (const claimId of nonTransitionClaimIds) {
		const labeled = edgesByClaimId.get(claimId) ?? []
		if (labeled.length > 0) {
			errors.push(
				`${claimId}: is a PROJECTION / INVARIANT / GUARD claim and must NOT carry a Chart 04 Mermaid edge (found ${labeled.length})`,
			)
		}
	}

	// The historical defect must not be re-asserted as current behaviour:
	// the `content_end` publication seam must never be labelled as the
	// place where the authority marker is stamped.
	const finalRowNote = /note right of FinalRowPublished[\s\S]*?end note/.exec(diagramText)?.[0] ?? ""
	if (!finalRowNote) {
		errors.push("Chart 04 Mermaid projection is missing the FinalRowPublished note")
	} else {
		if (/isAuthoritativelyCompletedResult\s*:\s*true/i.test(finalRowNote)) {
			errors.push(
				"Chart 04 Mermaid FinalRowPublished note still asserts the authority marker is stamped at content_end (the historical defect)",
			)
		}
		if (!/NO authority marker/i.test(finalRowNote)) {
			errors.push("Chart 04 Mermaid FinalRowPublished note does not state that the row carries NO authority marker")
		}
	}

	return { errors, mermaidBlockCount: blocks.length }
}
