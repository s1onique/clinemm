/**
 * ACT-CLINEMM-LIFECYCLE-EXECUTABLE-PRESENTATION-CONTRACT01
 *
 * PURE claim registry for Chart 04 (Completion Presentation).
 *
 * The seven stable claim ids P-01 … P-07 already exist in
 * `docs/architecture/task-lifecycle/04-completion-presentation.md` and in
 * the canonical ledger `docs/architecture/task-lifecycle/transitions.tsv`.
 * This module is NOT a parallel source of truth for the behaviour: it is the
 * machine-checkable LINK between the ledger row, the production symbol that
 * owns the behaviour, and the executable witness that proves it.
 *
 * Every entry names:
 *   - the production symbol (file + symbol) that owns the behaviour;
 *   - the test seam (the executable witness) that exercises that symbol;
 *   - the observed assertion (the concrete, falsifiable property);
 *   - the evidence level (how the witness reaches production).
 *
 * The module has NO side effects and uses only Node/Bun built-ins so it can
 * be imported by both the vitest conformance suite and the deterministic
 * coverage-report generator script.
 */

/**
 * The nature of a claim. Only genuine TRANSITION claims need a
 * corresponding Mermaid edge; a GUARD / PROJECTION / INVARIANT claim is
 * proven by a contract entry plus an executable assertion.
 */
export type CompletionPresentationClaimKind = "TRANSITION" | "GUARD" | "PROJECTION" | "INVARIANT" | "HISTORICAL_OBSERVATION"

/**
 * How the witness reaches production code.
 *
 *   REAL_PRODUCTION_SEAM — the witness drives the real production symbol
 *                          (translator, coordinator, tracker, reducer,
 *                          framing projection, host store, or the real
 *                          persistence/reopen translation).
 *   INJECTED_DECISION    — the witness drives the real production seam but
 *                          INJECTS the Elm decision at the existing
 *                          provider boundary. This is NOT live Elm
 *                          execution and must not be reported as such.
 *   UNVERIFIED           — no executable witness; the precise gap is named.
 *   LIVE_UNOBSERVABLE    — the property cannot be observed from outside the
 *                          running extension without an installed-extension
 *                          live capture (none is claimed here).
 */
export type CompletionPresentationEvidenceLevel =
	| "REAL_PRODUCTION_SEAM"
	| "INJECTED_DECISION"
	| "UNVERIFIED"
	| "LIVE_UNOBSERVABLE"

export type CompletionPresentationResult = "PASS" | "FAIL" | "UNVERIFIED" | "LIVE_UNOBSERVABLE" | "NOT_APPLICABLE"

export interface CompletionPresentationClaim {
	readonly claim_id: string
	readonly kind: CompletionPresentationClaimKind
	/** The production symbol (path#symbol) that owns the behaviour. */
	readonly production_symbol: string
	/** The executable witness (relative path under the repo root). */
	readonly witness: string
	/** The concrete, falsifiable assertion the witness makes. */
	readonly assertion: string
	/** The observable boundary the witness asserts on. */
	readonly observed_boundary: string
	/** How the witness reaches production. */
	readonly evidence_level: CompletionPresentationEvidenceLevel
	/** Whether the claim is eligible for executable conformance. */
	readonly eligible: boolean
	/** Why the claim is not eligible (only meaningful when `eligible` is false). */
	readonly ineligibility_reason?: string
}

/**
 * The seven Chart 04 claims.
 *
 * These are the SAME ids the ledger (`transitions.tsv`) and the Chart 04
 * document use. No new identifiers are minted to satisfy a coverage counter.
 */
export const COMPLETION_PRESENTATION_CLAIMS: readonly CompletionPresentationClaim[] = [
	{
		claim_id: "P-01",
		kind: "TRANSITION",
		production_symbol: "apps/vscode/src/sdk/message-translator.ts#agentEventToMessages",
		witness: "apps/vscode/src/sdk/__tests__/completion-presentation-contract01.cpc01.test.ts",
		assertion:
			'The completion tool\'s content_start publishes say:"completion_result" with partial:true and NO isAuthoritativelyCompletedResult marker.',
		observed_boundary: "translator output row (partial:true, marker absent)",
		evidence_level: "REAL_PRODUCTION_SEAM",
		eligible: true,
	},
	{
		claim_id: "P-02",
		kind: "TRANSITION",
		production_symbol:
			"apps/vscode/src/sdk/message-translator.ts#agentEventToMessages (LIVE content_end) | apps/vscode/src/sdk/message-translator.ts#finalizePersistedToolUse (RESTORATION)",
		witness: "apps/vscode/src/sdk/__tests__/completion-presentation-contract01.cpc01.test.ts",
		assertion:
			"On the LIVE SDK path content_end finalizes the row (partial:false) WITHOUT the authority marker; on the RESTORATION path the marker is stamped ONLY from the verified persisted completion identity (explicit isAuthoritativeCompletion bit). The two paths are exercised separately.",
		observed_boundary: "translator output row (live) vs restored row (persistence/reopen)",
		evidence_level: "REAL_PRODUCTION_SEAM",
		eligible: true,
	},
	{
		claim_id: "P-03",
		kind: "GUARD",
		production_symbol:
			"apps/vscode/src/sdk/sdk-session-event-coordinator.ts#handleSessionEvent (the hasCompletionResult filter block)",
		witness: "apps/vscode/src/sdk/__tests__/completion-presentation-contract01.cpc01.test.ts",
		assertion:
			"Where the BCB policy filters a completion row, the current turn publishes NO completion_result row at all (owned running job, held terminal observation, and foreign-session observation cases), so the row cannot present as an authoritative completion. BCB filtration is not conflated with Elm authorization. The foreign-session isolation is proven against the REAL shared production ownership authority (one BackgroundNotifyCoordinator holding obligations of BOTH owners, keyed by the canonical ownerKey(sessionId, taskId)): an outstanding foreign obligation neither holds nor releases the target owner's completion. A deliberately broken session-only ownership discriminator is REJECTED by the same witness.",
		observed_boundary:
			"coordinator message-layer filter (published message set) + shared production ownership authority (ownerKey-scoped held-obligation queries)",
		evidence_level: "INJECTED_DECISION",
		eligible: true,
	},
	{
		claim_id: "P-04",
		kind: "PROJECTION",
		production_symbol: "apps/vscode/webview-ui/src/components/chat/terminalReportFraming.ts#resolveTerminalReportFraming",
		witness: "apps/vscode/src/sdk/__tests__/completion-presentation-contract01.cpc01.test.ts",
		assertion:
			"For modern SDK completion rows the 'Completed' badge requires isAuthoritativelyCompletedResult === true; the legacy ask:\"completion_result\" fallback keeps its independent phase-gated conditions. Plan mode yields no badge, and a row's authority is NOT inferred from the current task phase.",
		observed_boundary: "webview framing projection (resolveTerminalReportFraming)",
		evidence_level: "REAL_PRODUCTION_SEAM",
		eligible: true,
	},
	{
		claim_id: "P-05",
		kind: "INVARIANT",
		production_symbol:
			"apps/vscode/src/sdk/task-proxy.ts#MessageStateHandler.addMessages | apps/vscode/webview-ui/src/components/chat/chat-view/messageReducer.ts#applyMessage",
		witness: "apps/vscode/src/sdk/__tests__/completion-presentation-contract01.cpc01.test.ts",
		assertion:
			"Publishing an update with the same completion-row ts updates the intended row IN PLACE in both the host message store and the real webview reducer: no second visible completion row appears, the original ts is preserved, and the original summary text survives.",
		observed_boundary: "host message store + webview replica (both real seams)",
		evidence_level: "REAL_PRODUCTION_SEAM",
		eligible: true,
	},
	{
		claim_id: "P-06",
		kind: "TRANSITION",
		production_symbol:
			"apps/vscode/src/sdk/sdk-session-event-coordinator.ts#promoteCompletionAuthorityMarker | apps/vscode/src/sdk/sdk-session-event-coordinator.ts#checkElmCompletionAuthority | apps/vscode/src/sdk/turn-state-tracker.ts#setWithWriter",
		witness: "apps/vscode/src/sdk/__tests__/completion-presentation-contract01.cpc01.test.ts",
		assertion:
			"On BOTH the immediate and the deferred C10 paths the order is: Elm authority authorizes -> the completed-phase effect commits -> the current-turn row is promoted -> the webview converges on ONE authoritative row. The trace distinguishes effect request, observed commit, and successful marker publication. A HOLD produces no current-turn authoritative marker, and a failed publication is never recorded as a success.",
		observed_boundary: "coordinator C10 commit + lifecycle causal trace + webview replica",
		evidence_level: "INJECTED_DECISION",
		eligible: true,
	},
	{
		claim_id: "P-07",
		kind: "INVARIANT",
		production_symbol: "apps/vscode/src/sdk/message-translator.ts#sdkMessagesToClineMessages",
		witness: "apps/vscode/src/sdk/__tests__/completion-presentation-contract01.cpc01.test.ts",
		assertion:
			"Reopening a persisted transcript through the REAL restoration translation agrees with the live row: a committed completion retains its authority marker, a held completion acquires none, a historical completion identity is not overwritten by a newer turn, and the legacy semantics are unchanged.",
		observed_boundary: "persistence/reopen translation (sdkMessagesToClineMessages)",
		evidence_level: "REAL_PRODUCTION_SEAM",
		eligible: true,
	},
] as const

/** All claim ids, in stable order. */
export const COMPLETION_PRESENTATION_CLAIM_IDS: readonly string[] = COMPLETION_PRESENTATION_CLAIMS.map((c) => c.claim_id)

/** Look up a claim by its stable id. */
export function findCompletionPresentationClaim(claimId: string): CompletionPresentationClaim | undefined {
	return COMPLETION_PRESENTATION_CLAIMS.find((c) => c.claim_id === claimId)
}

/** The eligible claims (the denominator of the coverage report). */
export function eligibleCompletionPresentationClaims(): readonly CompletionPresentationClaim[] {
	return COMPLETION_PRESENTATION_CLAIMS.filter((c) => c.eligible)
}

/**
 * The coverage report row for one claim.
 *
 * `result` is the OBSERVED outcome of the executed witness, not a static
 * declaration. The generator script supplies it from the real test run.
 */
export interface CompletionPresentationCoverageRow {
	readonly claim_id: string
	readonly kind: CompletionPresentationClaimKind
	readonly production_symbol: string
	readonly witness: string
	readonly assertion: string
	readonly evidence_level: CompletionPresentationEvidenceLevel
	readonly result: CompletionPresentationResult
}

export interface CompletionPresentationCoverageReport {
	readonly rows: readonly CompletionPresentationCoverageRow[]
	/** Number of claims eligible for executable conformance. */
	readonly eligible_claims: number
	/** Number of eligible claims that have an executable witness with an executed PASS. */
	readonly executable_claims: number
	/** Number of eligible claims that FAILED their witness. */
	readonly failed_claims: number
	/** Number of eligible claims with an explicit non-PASS classification. */
	readonly gap_claims: number
}

/** Build the coverage report rows, binding each claim to its observed result. */
export function buildCompletionPresentationCoverageReport(
	results: Readonly<Record<string, CompletionPresentationResult>>,
): CompletionPresentationCoverageReport {
	const rows: CompletionPresentationCoverageRow[] = COMPLETION_PRESENTATION_CLAIMS.map((claim) => ({
		claim_id: claim.claim_id,
		kind: claim.kind,
		production_symbol: claim.production_symbol,
		witness: claim.witness,
		assertion: claim.assertion,
		evidence_level: claim.evidence_level,
		result: results[claim.claim_id] ?? "UNVERIFIED",
	}))
	const eligible = eligibleCompletionPresentationClaims()
	const eligibleIds = new Set(eligible.map((c) => c.claim_id))
	const eligibleRows = rows.filter((r) => eligibleIds.has(r.claim_id))
	return {
		rows,
		eligible_claims: eligible.length,
		executable_claims: eligibleRows.filter((r) => r.result === "PASS").length,
		failed_claims: eligibleRows.filter((r) => r.result === "FAIL").length,
		gap_claims: eligibleRows.filter((r) => r.result !== "PASS" && r.result !== "FAIL").length,
	}
}

/** Render the coverage report as a deterministic TSV (the machine-readable artifact). */
export function renderCompletionPresentationCoverageReportTsv(report: CompletionPresentationCoverageReport): string {
	const header = ["claim_id", "kind", "production_symbol", "witness", "assertion", "evidence_level", "result"]
	const lines = [header.join("\t")]
	for (const row of report.rows) {
		lines.push(
			[
				row.claim_id,
				row.kind,
				row.production_symbol,
				row.witness,
				row.assertion.replace(/\t+/g, " ").replace(/\n+/g, " "),
				row.evidence_level,
				row.result,
			].join("\t"),
		)
	}
	lines.push("")
	lines.push(`# eligible_claims\t${report.eligible_claims}`)
	lines.push(`# executable_claims\t${report.executable_claims}`)
	lines.push(`# failed_claims\t${report.failed_claims}`)
	lines.push(`# gap_claims\t${report.gap_claims}`)
	return lines.join("\n")
}

/** Render the coverage report as deterministic Markdown. */
export function renderCompletionPresentationCoverageReportMarkdown(report: CompletionPresentationCoverageReport): string {
	const lines: string[] = []
	lines.push("| claim_id | kind | production_symbol | witness | assertion | evidence_level | result |")
	lines.push("|---|---|---|---|---|---|---|")
	for (const row of report.rows) {
		lines.push(
			`| ${row.claim_id} | ${row.kind} | \`${row.production_symbol}\` | \`${row.witness}\` | ${row.assertion.replace(/\|/g, "\\|")} | ${row.evidence_level} | ${row.result} |`,
		)
	}
	lines.push("")
	lines.push(`- eligible claims: **${report.eligible_claims}**`)
	lines.push(`- eligible claims with executable evidence (PASS): **${report.executable_claims}**`)
	lines.push(`- eligible claims that FAILED: **${report.failed_claims}**`)
	lines.push(`- eligible claims with an explicit gap: **${report.gap_claims}**`)
	return lines.join("\n")
}
