/**
 * ACT-CLINEMM-LIFECYCLE-EXECUTABLE-TURN-PHASE-CONTRACT01
 *
 * PURE claim registry for Chart 01 (Task / Turn Phase).
 *
 * The nine stable claim ids T-01 … T-09 already exist in
 * `docs/architecture/task-lifecycle/01-task-turn-phase.md` and in the
 * canonical ledger `docs/architecture/task-lifecycle/transitions.tsv`.
 * This module is NOT a parallel source of truth for the behaviour: it is
 * the machine-checkable LINK between the ledger row, the production
 * symbol that owns the behaviour, and the executable witness that proves
 * it.
 *
 * Every entry names:
 *   - the production symbol (file + symbol) that owns the behaviour;
 *   - the test seam (the executable witness) that exercises that symbol;
 *   - the observed assertion (the concrete, falsifiable property);
 *   - the observed boundary (WHICH boundary the witness asserts on);
 *   - the evidence level (how the witness reaches production).
 *
 * CLASSIFICATION IS DERIVED FROM THE SOURCE, NOT ASSUMED.
 *
 * The provisional classification in the ACT was:
 *
 *   T-01 TRANSITION  T-02 TRANSITION  T-03 TRANSITION  T-04 TRANSITION
 *   T-05 TRANSITION  T-06 GUARD       T-07 TRANSITION  T-08 TRANSITION
 *   T-09 PROJECTION
 *
 * Recon at the reviewed source HEAD confirmed T-06 is a GUARD (the
 * straggler guard at `sdk-session-event-coordinator.ts:3338` SUPPRESSES a
 * phase write; it performs no transition of its own) and T-09 is a
 * PROJECTION (the TaskHeader label is a function of the committed phase,
 * not a lifecycle state). Both classifications are preserved.
 *
 * The additional ids T-10 … T-14 are the MINIMAL source-bound additions
 * the ACT authorizes ("If additional load-bearing transitions exist, add
 * only the minimal source-bound IDs needed to describe them"). Each one
 * is a GENUINE phase write in the current production source that the
 * pre-existing Chart 01 diagram did NOT represent:
 *
 *   T-10  → compacting            (compaction enter)
 *   T-11  compacting → <restored> (compaction restore)
 *   T-12  → awaiting_approval     (tool approval requested)
 *   T-13  → awaiting_followup     (ask_question / plan_mode_respond)
 *   T-14  awaiting_approval → streaming (approval resolved)
 *
 * Those five are NOT new production behaviour — they are pre-existing
 * production writers that the OLD diagram omitted. No production code is
 * changed by this ACT.
 *
 * The module has NO side effects and uses only Node/Bun built-ins so it
 * can be imported by both the vitest conformance suite and the
 * deterministic coverage-report generator script.
 */

/**
 * The nature of a claim. Only genuine TRANSITION claims need a
 * corresponding Mermaid edge; a GUARD / PROJECTION / INVARIANT claim is
 * proven by a contract entry plus an executable assertion.
 */
export type TurnPhaseClaimKind = "TRANSITION" | "GUARD" | "PROJECTION" | "INVARIANT"

/**
 * How the witness reaches production code.
 *
 *   REAL_PRODUCTION_SEAM — the witness drives the real production symbol
 *                          (tracker, coordinator, selector, reducer, or
 *                          the real projection helper).
 *   INJECTED_DECISION    — the witness drives the real production seam but
 *                          INJECTS the Elm decision at the existing
 *                          provider boundary. This is NOT live Elm
 *                          execution and must not be reported as such.
 *   STRUCTURAL           — the witness asserts a property of the REAL
 *                          production SOURCE (e.g. the Mermaid association
 *                          contract, the eight-phase vocabulary), not a
 *                          runtime behaviour.
 *   UNVERIFIED           — no executable witness; the precise gap is named.
 *   LIVE_UNOBSERVABLE    — the property cannot be observed from outside the
 *                          running extension without an installed-extension
 *                          live capture (none is claimed here).
 */
export type TurnPhaseEvidenceLevel =
	| "REAL_PRODUCTION_SEAM"
	| "INJECTED_DECISION"
	| "STRUCTURAL"
	| "UNVERIFIED"
	| "LIVE_UNOBSERVABLE"

export type TurnPhaseResult = "PASS" | "FAIL" | "UNVERIFIED" | "LIVE_UNOBSERVABLE" | "NOT_APPLICABLE"

export interface TurnPhaseClaim {
	readonly claim_id: string
	readonly kind: TurnPhaseClaimKind
	/** The production symbol (path#symbol) that owns the behaviour. */
	readonly production_symbol: string
	/** The executable witness (relative path under the repo root). */
	readonly witness: string
	/** The concrete, falsifiable assertion the witness makes. */
	readonly assertion: string
	/** The observable boundary the witness asserts on. */
	readonly observed_boundary: string
	/** How the witness reaches production. */
	readonly evidence_level: TurnPhaseEvidenceLevel
	/** Whether the claim is eligible for executable conformance. */
	readonly eligible: boolean
	/** Why the claim is not eligible (only meaningful when `eligible` is false). */
	readonly ineligibility_reason?: string
}

/**
 * The eight canonical `TurnPhase` values, in the order they appear in
 * the `TurnPhase` union (`apps/vscode/src/shared/ExtensionMessage.ts`).
 *
 * This list is the G2 vocabulary gate: every value must be accounted for
 * by at least one claim (as a source state, a target state, or an
 * explicitly-mapped projection authority).
 */
export const TURN_PHASE_VOCABULARY = [
	"idle",
	"streaming",
	"awaiting_approval",
	"awaiting_followup",
	"compacting",
	"completed",
	"error",
	"resumable",
] as const

export type TurnPhaseValue = (typeof TURN_PHASE_VOCABULARY)[number]

/** The shared witness path for every Chart 01 claim. */
export const TURN_PHASE_WITNESS = "apps/vscode/src/sdk/__tests__/turn-phase-contract01.tpc01.test.ts"

export const TURN_PHASE_CLAIMS: readonly TurnPhaseClaim[] = [
	{
		claim_id: "T-01",
		kind: "TRANSITION",
		production_symbol:
			"apps/vscode/src/sdk/sdk-session-event-coordinator.ts#handleSessionEvent (pending_prompt_submitted) | apps/vscode/src/sdk/turn-state-tracker.ts#setWithWriter",
		witness: TURN_PHASE_WITNESS,
		assertion:
			"A `pending_prompt_submitted` session event drives the REAL coordinator to request the `streaming` phase, and the REAL tracker commits it: the committed snapshot's phase is `streaming` with a strictly greater seq than the previous committed snapshot, and the writer provenance names the `session-event-pending-prompt-submitted` writer.",
		observed_boundary: "tracker committed snapshot (phase + seq + anchor)",
		evidence_level: "REAL_PRODUCTION_SEAM",
		eligible: true,
	},
	{
		claim_id: "T-02",
		kind: "TRANSITION",
		production_symbol:
			"apps/vscode/src/sdk/sdk-session-event-coordinator.ts#handleSessionEvent (turn_complete) | apps/vscode/src/sdk/sdk-session-event-coordinator.ts#checkElmCompletionAuthority | apps/vscode/src/sdk/turn-state-tracker.ts#setWithWriter",
		witness: TURN_PHASE_WITNESS,
		assertion:
			"The C10 completion commit is authorized ONLY when the current-turn completion facts hold (attempt completion seen AND a terminal response committed AND no error seen) AND no BCB hold applies AND the Elm authority authorizes. The authorized path commits `completed` with a strictly greater seq; the Elm HOLD and the Elm FAILURE paths commit NO `completed` phase.",
		observed_boundary: "tracker committed snapshot + Elm authority decision",
		evidence_level: "INJECTED_DECISION",
		eligible: true,
	},
	{
		claim_id: "T-03",
		kind: "TRANSITION",
		production_symbol:
			"apps/vscode/src/sdk/sdk-session-event-coordinator.ts#handleSessionEvent (turn_complete, no attempt completion)",
		witness: TURN_PHASE_WITNESS,
		assertion:
			"A turn that completes WITHOUT a committed completion attempt commits `awaiting_followup` (not `completed`): the committed snapshot's phase is `awaiting_followup`, no `completed` phase is committed for that turn, and the webview's `turnAllowsFollowup` accepts the phase so the composer stays enabled.",
		observed_boundary: "tracker committed snapshot + webview follow-up selector",
		evidence_level: "REAL_PRODUCTION_SEAM",
		eligible: true,
	},
	{
		claim_id: "T-04",
		kind: "TRANSITION",
		production_symbol:
			"apps/vscode/src/sdk/sdk-session-event-coordinator.ts#handleSessionEvent (turn_complete, wasErrorSeen) | apps/vscode/src/sdk/SdkController.ts#onSendError",
		witness: TURN_PHASE_WITNESS,
		assertion:
			"A turn that surfaced a provider/agent error commits `error` through the `session-event-turn-complete-error` writer, and the phase is DISTINGUISHABLE from the BCB observation-unavailable error: the two writers carry different writer identities and are produced by different causal predicates.",
		observed_boundary: "tracker committed snapshot + writer provenance",
		evidence_level: "REAL_PRODUCTION_SEAM",
		eligible: true,
	},
	{
		claim_id: "T-05",
		kind: "TRANSITION",
		production_symbol:
			"apps/vscode/src/sdk/SdkController.ts#cancelTask | apps/vscode/src/sdk/sdk-task-control-coordinator.ts#cancelTask",
		witness: TURN_PHASE_WITNESS,
		assertion:
			"Cancellation commits `resumable` through the `controller-cancel-task` writer BEFORE the abort is awaited, so the cancel fence is raised with the authoritative phase already committed; the committed snapshot's phase is `resumable` and the seq strictly advanced.",
		observed_boundary: "tracker committed snapshot (phase + seq)",
		evidence_level: "REAL_PRODUCTION_SEAM",
		eligible: true,
	},
	{
		claim_id: "T-06",
		kind: "GUARD",
		production_symbol:
			"apps/vscode/src/sdk/sdk-session-event-coordinator.ts#handleSessionEvent (turn-complete straggler guard)",
		witness: TURN_PHASE_WITNESS,
		assertion:
			'A turn-complete that arrives after a cancellation commits NO phase: the guard (`!activeSession.isRunning && getTurnPhase() === "resumable"`) suppresses the turn-complete phase write, so the cancel-committed `resumable` phase is preserved (same phase, SAME seq — no write at all). This claim carries NO Mermaid edge because it is a suppression, not a transition.',
		observed_boundary: "tracker committed snapshot (unchanged phase AND unchanged seq)",
		evidence_level: "REAL_PRODUCTION_SEAM",
		eligible: true,
	},
	{
		claim_id: "T-07",
		kind: "TRANSITION",
		production_symbol:
			"apps/vscode/src/sdk/sdk-session-event-coordinator.ts#handleSessionEvent (BCB observation-unavailable writer)",
		witness: TURN_PHASE_WITNESS,
		assertion:
			"When the BCB barrier holds AND the resumed turn's tool registry cannot observe held results (`canObserveHeldResults === false`) AND the same obligation was not already marked observation-unavailable, the coordinator commits `error` through the `session-event-bcb-blocked-observation-unavailable` writer. This is a DISTINCT causal predicate and writer identity from the T-04 provider-error path.",
		observed_boundary: "tracker committed snapshot + BCB capture record",
		evidence_level: "REAL_PRODUCTION_SEAM",
		eligible: true,
	},
	{
		claim_id: "T-08",
		kind: "TRANSITION",
		production_symbol:
			"apps/vscode/src/sdk/sdk-session-event-coordinator.ts#handleSessionEvent (pending_prompt_submitted) | apps/vscode/src/sdk/sdk-task-start-coordinator.ts#initTask",
		witness: TURN_PHASE_WITNESS,
		assertion:
			"T-08 is a GROUPED contract over FOUR genuinely distinct source states (`awaiting_followup`, `completed`, `error`, `resumable`). Each source state is exercised SEPARATELY: a `pending_prompt_submitted` event from each source commits `streaming` with a strictly greater seq. The grouped contract is NOT a slash-delimited runtime phase — the four source states are four separate runtime phases and four separate witnesses.",
		observed_boundary: "tracker committed snapshot (phase + seq)",
		evidence_level: "REAL_PRODUCTION_SEAM",
		eligible: true,
	},
	{
		claim_id: "T-09",
		kind: "PROJECTION",
		production_symbol:
			"apps/vscode/webview-ui/src/components/chat/task-header/taskHeaderTelemetryHelpers.ts#stateLabel | apps/vscode/webview-ui/src/components/chat/task-header/taskHeaderTelemetryHelpers.ts#taskHeaderPresentationStateLabel",
		witness: TURN_PHASE_WITNESS,
		assertion:
			"The TaskHeader label is a PROJECTION of the committed phase, not a lifecycle state. `stateLabel` maps all eight phases to their exact label/glyph/live triple (Working/Approval/Your turn/Compacting/Complete/Error/Paused/Idle), and the production entry point `taskHeaderPresentationStateLabel` reads the canonical `taskHeaderPresentation` projection (host/shadow/legacy authority) when present and falls back to the legacy phase only when the projection is absent. This claim carries NO Mermaid edge.",
		observed_boundary: "webview projection helper + host projection selector",
		evidence_level: "REAL_PRODUCTION_SEAM",
		eligible: true,
	},
	{
		claim_id: "T-10",
		kind: "TRANSITION",
		production_symbol: "apps/vscode/src/sdk/sdk-compaction-coordinator.ts#enterCompactingPhase",
		witness: TURN_PHASE_WITNESS,
		assertion:
			"The production compaction path enters `compacting` through the REAL `SdkCompactionCoordinator.enterCompactingPhase` before the compaction divider is emitted; the entry phase AND its anchor are captured and the committed snapshot's phase is `compacting` with a strictly greater seq. The phase is a host-owned SYSTEM transition, not a human wait.",
		observed_boundary: "tracker committed snapshot (phase + seq + anchor)",
		evidence_level: "REAL_PRODUCTION_SEAM",
		eligible: true,
	},
	{
		claim_id: "T-11",
		kind: "TRANSITION",
		production_symbol: "apps/vscode/src/sdk/sdk-compaction-coordinator.ts#enterCompactingPhase (returned restore closure)",
		witness: TURN_PHASE_WITNESS,
		assertion:
			"The terminal compaction event restores the phase that was current on entry: the restore closure writes the captured entry phase AND its anchor back through the tracker (a strictly greater seq), for a terminal entry phase. The restore is a host-owned write, not a shadow projection.",
		observed_boundary: "tracker committed snapshot (phase + seq + anchor)",
		evidence_level: "REAL_PRODUCTION_SEAM",
		eligible: true,
	},
	{
		claim_id: "T-12",
		kind: "TRANSITION",
		production_symbol: "apps/vscode/src/sdk/sdk-interaction-coordinator.ts#handleRequestToolApproval",
		witness: TURN_PHASE_WITNESS,
		assertion:
			"A tool approval request drives the REAL interaction coordinator to request `awaiting_approval` with the approval ask message's ts as the anchor; the committed snapshot's phase is `awaiting_approval` and its anchorTs is the ask message's ts. This is a pre-existing production writer the pre-existing Chart 01 diagram omitted.",
		observed_boundary: "tracker committed snapshot (phase + seq + anchor)",
		evidence_level: "REAL_PRODUCTION_SEAM",
		eligible: true,
	},
	{
		claim_id: "T-13",
		kind: "TRANSITION",
		production_symbol: "apps/vscode/src/sdk/sdk-interaction-coordinator.ts#handleAskQuestion",
		witness: TURN_PHASE_WITNESS,
		assertion:
			"An `ask_question` drives the REAL interaction coordinator to request `awaiting_followup` with the ask message's ts as the anchor; the committed snapshot's phase is `awaiting_followup`. This phase is DISTINCT from `awaiting_approval` (a different writer identity and a different anchor source).",
		observed_boundary: "tracker committed snapshot (phase + seq + anchor)",
		evidence_level: "REAL_PRODUCTION_SEAM",
		eligible: true,
	},
	{
		claim_id: "T-14",
		kind: "TRANSITION",
		production_symbol: "apps/vscode/src/sdk/sdk-interaction-coordinator.ts#resolvePendingToolApproval",
		witness: TURN_PHASE_WITNESS,
		assertion:
			"Resolving a pending tool approval (approve OR deny) drives the REAL interaction coordinator to request `streaming` with the anchor cleared; the committed snapshot's phase is `streaming` and its anchorTs is undefined.",
		observed_boundary: "tracker committed snapshot (phase + seq + anchor)",
		evidence_level: "REAL_PRODUCTION_SEAM",
		eligible: true,
	},
]

/** The claim ids that ARE genuine transitions and therefore carry a Mermaid edge. */
export const TURN_PHASE_TRANSITION_CLAIM_IDS: readonly string[] = TURN_PHASE_CLAIMS.filter(
	(claim) => claim.kind === "TRANSITION",
).map((claim) => claim.claim_id)

/** The claim ids that are NOT transitions and therefore carry NO Mermaid edge. */
export const TURN_PHASE_NON_TRANSITION_CLAIM_IDS: readonly string[] = TURN_PHASE_CLAIMS.filter(
	(claim) => claim.kind !== "TRANSITION",
).map((claim) => claim.claim_id)

/**
 * The VERIFIED claim-id -> Mermaid-edge association for Chart 01.
 *
 * ACT-CLINEMM-LIFECYCLE-EXECUTABLE-TURN-PHASE-CONTRACT01: cardinality alone
 * ("each transition id appears on exactly one labeled edge") is
 * INSUFFICIENT — swapping the LABELS of two edges keeps every id present
 * exactly once while inverting the meaning of both transitions. The
 * association must be checked as an ASSOCIATION between (claim id ->
 * labeled edge) and (claim id -> expected edge endpoints), exactly like
 * `verifyLifecycleTransitionContract` does for the c9-c10 diagram.
 *
 * The endpoints below are the VERIFIED Chart 01 edge mappings, each one
 * bound to a production writer by the executable witness suite.
 */
export const CHART_01_EXPECTED_EDGES: Readonly<Record<string, { readonly source: string; readonly target: string }>> = {
	"T-01": { source: "idle", target: "streaming" },
	"T-02": { source: "streaming", target: "completed" },
	"T-03": { source: "streaming", target: "awaiting_followup" },
	"T-04": { source: "streaming", target: "error" },
	"T-05": { source: "streaming", target: "resumable" },
	"T-07": { source: "streaming", target: "error" },
	"T-08": { source: "awaiting_followup", target: "streaming" },
	"T-10": { source: "streaming", target: "compacting" },
	"T-11": { source: "compacting", target: "awaiting_followup" },
	"T-12": { source: "streaming", target: "awaiting_approval" },
	"T-13": { source: "streaming", target: "awaiting_followup" },
	"T-14": { source: "awaiting_approval", target: "streaming" },
}

/**
 * T-08 is a GROUPED contract over four genuinely distinct source states.
 *
 * The grouped claim id `T-08` labels the FIRST of the four edges; the
 * remaining three carry the disambiguated ids `T-08a`, `T-08b`, `T-08c`.
 * Keeping the four disambiguated ids separate is what makes the fan-in
 * accurate: a slash-delimited source string is NOT a runtime phase.
 */
export const TURN_PHASE_GROUPED_CLAIM_IDS: readonly string[] = ["T-08a", "T-08b", "T-08c"]

/**
 * The additional edge association for the three disambiguated T-08
 * source states. These ids are NOT separate CLAIMS — they are the three
 * remaining edges of the single grouped T-08 contract, and each is
 * exercised by its own witness case.
 */
export const CHART_01_GROUPED_EXPECTED_EDGES: Readonly<Record<string, { readonly source: string; readonly target: string }>> = {
	"T-08a": { source: "completed", target: "streaming" },
	"T-08b": { source: "error", target: "streaming" },
	"T-08c": { source: "resumable", target: "streaming" },
}

/** Every edge association the Chart 01 verifier must enforce. */
export const CHART_01_ALL_EXPECTED_EDGES: Readonly<Record<string, { readonly source: string; readonly target: string }>> = {
	...CHART_01_EXPECTED_EDGES,
	...CHART_01_GROUPED_EXPECTED_EDGES,
}

/**
 * The phase vocabulary -> production writers that can commit that phase.
 *
 * This is the R0/G0 ownership map in machine-checkable form. The
 * witness suite asserts that the registry's writer set matches the
 * writer ids the production source actually emits.
 */
export const TURN_PHASE_WRITER_MAP: Readonly<Record<TurnPhaseValue, readonly string[]>> = {
	idle: [
		"task-control-idle-fallback",
		"controller-clear-task",
		"controller-restore-checkpoint",
		"controller-epoch-transition-reseed",
		"followup-on-follow-up-abandoned",
	],
	streaming: [
		"session-event-pending-prompt-submitted",
		"task-start-init-task",
		"task-start-reinit-existing-task",
		"controller-ask-response",
		"controller-edit-message-and-regenerate",
		"interaction-resolve-tool-approval-yes-no",
		"interaction-resolve-ask-question",
		"interaction-resolve-mistake-limit",
		"followup-auto-continue-starting",
	],
	awaiting_approval: ["interaction-handle-tool-approval", "interaction-resolve-tool-approval-message-response"],
	awaiting_followup: [
		"session-event-turn-complete-awaiting-followup",
		"session-event-turn-complete-awaiting-followup-liveness",
		"session-event-turn-complete-resumable-straggler-preserve",
		"interaction-handle-ask-question",
		"interaction-handle-mistake-limit",
	],
	compacting: ["compaction-enter"],
	completed: ["session-event-turn-complete-completed", "task-control-resume-ask"],
	error: [
		"session-event-turn-complete-error",
		"session-event-bcb-blocked-observation-unavailable",
		"controller-on-send-error",
		"controller-emit-cline-auth-error",
		"controller-emit-cline-balance-error",
		"followup-auto-continue-failed",
		"followup-on-resume-failed",
	],
	resumable: [
		"controller-cancel-task",
		"task-control-cancel-no-active-session",
		"task-control-resumable-ask",
		"mode-coordinator-mode-switch-resumable",
		"session-event-turn-complete-containment-failed-resumable",
	],
}

/**
 * The phase-dependent writers.
 *
 * These writers do NOT commit a FIXED phase — they commit the phase
 * that was current when the bounded window opened (the compaction
 * restore writers). They are therefore NOT members of the
 * phase -> writers map; they are listed here so the ownership map
 * accounts for EVERY production writer identity without pretending
 * the restore writes `compacting` back.
 */
export const TURN_PHASE_RESTORE_WRITERS: readonly string[] = [
	"compaction-restore-entry-preserve",
	"compaction-restore-canonical-unavailable-preserve",
	"compaction-restore-canonical-resolved",
]

/**
 * The TaskHeader projection authority per phase.
 *
 * `host` — the host-owned override in `selectTaskHeaderPresentation`
 *          (the canonical shadow cannot represent the phase).
 * `shadow` — the canonical `@cline/agents` TaskStateShadow projection.
 * `legacy` — the absence fallback (Hub/Remote / pre-observation).
 *
 * The authority is a property of the SELECTOR's precedence, not of the
 * phase alone: a phase written by a host override is rendered from the
 * host branch; the OTHER phases are rendered from the shadow when a
 * shadow observation exists and from the legacy fallback otherwise.
 */
export const TURN_PHASE_PROJECTION_AUTHORITY: Readonly<Record<TurnPhaseValue, readonly ("host" | "shadow" | "legacy")[]>> = {
	idle: ["shadow", "legacy"],
	streaming: ["shadow", "legacy"],
	awaiting_approval: ["shadow", "legacy"],
	awaiting_followup: ["host"],
	compacting: ["host"],
	completed: ["shadow", "legacy"],
	error: ["host"],
	resumable: ["host"],
}

/** The claims that are eligible for executable conformance. */
export function eligibleTurnPhaseClaims(): readonly TurnPhaseClaim[] {
	return TURN_PHASE_CLAIMS.filter((claim) => claim.eligible)
}

export interface TurnPhaseCoverageRow {
	readonly claim_id: string
	readonly kind: TurnPhaseClaimKind
	readonly production_symbol: string
	readonly witness: string
	readonly assertion: string
	readonly observed_boundary: string
	readonly evidence_level: TurnPhaseEvidenceLevel
	readonly result: TurnPhaseResult
}

export interface TurnPhaseCoverageReport {
	readonly rows: readonly TurnPhaseCoverageRow[]
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
export function buildTurnPhaseCoverageReport(results: Readonly<Record<string, TurnPhaseResult>>): TurnPhaseCoverageReport {
	const rows: TurnPhaseCoverageRow[] = TURN_PHASE_CLAIMS.map((claim) => ({
		claim_id: claim.claim_id,
		kind: claim.kind,
		production_symbol: claim.production_symbol,
		witness: claim.witness,
		assertion: claim.assertion,
		observed_boundary: claim.observed_boundary,
		evidence_level: claim.evidence_level,
		result: results[claim.claim_id] ?? "UNVERIFIED",
	}))
	const eligible = eligibleTurnPhaseClaims()
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
export function renderTurnPhaseCoverageReportTsv(report: TurnPhaseCoverageReport): string {
	const header = ["claim_id", "kind", "production_symbol", "witness", "observed_boundary", "evidence_level", "result"]
	const lines = [header.join("\t")]
	for (const row of report.rows) {
		lines.push(
			[
				row.claim_id,
				row.kind,
				row.production_symbol,
				row.witness,
				row.observed_boundary,
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
export function renderTurnPhaseCoverageReportMarkdown(report: TurnPhaseCoverageReport): string {
	const lines: string[] = []
	lines.push("| claim_id | kind | production_symbol | witness | observed_boundary | evidence_level | result |")
	lines.push("|---|---|---|---|---|---|---|")
	for (const row of report.rows) {
		lines.push(
			`| ${row.claim_id} | ${row.kind} | \`${row.production_symbol}\` | \`${row.witness}\` | ${row.observed_boundary} | ${row.evidence_level} | ${row.result} |`,
		)
	}
	lines.push("")
	lines.push(`- eligible claims: **${report.eligible_claims}**`)
	lines.push(`- eligible claims with executable evidence (PASS): **${report.executable_claims}**`)
	lines.push(`- eligible claims that FAILED: **${report.failed_claims}**`)
	lines.push(`- eligible claims with an explicit gap: **${report.gap_claims}**`)
	return lines.join("\n")
}
