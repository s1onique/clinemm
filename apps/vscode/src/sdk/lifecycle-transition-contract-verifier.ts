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
