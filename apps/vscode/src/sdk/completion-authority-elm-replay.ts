/**
 * ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-HISTORICAL-REPLAY01
 * Offline replay adapter.
 *
 * Translates frozen REAL JSONL records into factual Elm Msg candidates
 * and drives the COMPILED Elm kernel via JS interop. NO production
 * wiring; no runtime event feed; no effect execution; no diagnostic
 * profile.
 *
 * The job of this module is narrow: classify each historical event as
 *   * DIRECTLY mappable to an Elm Msg with all required identity, or
 *   * INSUFFICIENT_IDENTITY (a required Elm identity field is absent
 *     from the historical record), or
 *   * UNMODELED_EVENT (the historical stage has no Elm Msg candidate),
 *   * DECODER_REJECTED (the Elm kernel rejected the mapped Msg).
 *
 * The adapter MUST NOT manufacture identity for REAL replay. It also
 * MUST NOT rewrite origin values to make them match — provenance
 * mismatches are observed and reported.
 *
 * Adding any effect execution, any live-mode wiring, any logging of
 * PII, or any helper that calls into production code paths is a scope
 * violation per ACT §12 / §30.
 */

export type KernelHandle = {
	send: (msg: Record<string, unknown>) => void
	drainOutbound: () => KernelOutbound[]
}

export type KernelOutbound =
	| { kind: "ready" }
	| { kind: "state"; model: Record<string, unknown>; violation?: string }
	| { kind: "decode_error"; error: string }

export type ReplayEventStatus =
	| "DIRECT"
	| "INSUFFICIENT_IDENTITY"
	| "UNMODELED_EVENT"
	| "DECODER_REJECTED"
	| "PROVENANCE_MISMATCH"
	| "PROVENANCE_PRESERVED"

export type ReplayClassification =
	| "MATCH"
	| "ELM_REJECTS_TS_SEQUENCE"
	| "ELM_ALLOWS_BUT_TS_HELD"
	| "INSUFFICIENT_IDENTITY"
	| "UNMODELED_EVENT"
	| "PROVENANCE_UNRESOLVED"

export type ReplayEvent = {
	seq: number
	at?: number
	sourceStage: string
	sourceOrigin?: string
	classification: ReplayEventStatus
	reason: string
	elmMsg?: Record<string, unknown>
	after?: { model: Record<string, unknown>; violation?: string }
}

export type ReplayResult = {
	sourceTracePath: string
	sourceTraceSha256: string
	eventsTotal: number
	events: ReplayEvent[]
	firstDivergenceSeq: number | null
	firstDivergenceKind: ReplayClassification | null
	firstDivergenceStage: string | null
	finalModel: Record<string, unknown> | null
	tsCompletionCommitted: boolean
	tsCompletionCommittedSeq: number | null
	manufacturedIdentityCount: number
	originRewriteCount: number
	unmodeledEventCount: number
	insufficientIdentityCount: number
	deterministicSha256: string
}

export type AdapterOutcome =
	| { status: "DIRECT"; elmMsg: Record<string, unknown> }
	| { status: "INSUFFICIENT_IDENTITY"; reason: string }
	| { status: "UNMODELED_EVENT"; reason: string }

/**
 * Map a frozen REAL JSONL record to an Elm Msg candidate (or null) and
 * a status. The adapter DOES NOT manufacture identity — if a required
 * Elm identity field is missing from the record, the event is reported
 * as INSUFFICIENT_IDENTITY and no Msg is emitted.
 */
export function adaptRecord(record: Record<string, unknown>): AdapterOutcome {
	const stage = String(record.stage ?? record.event ?? "")
	const origin = record.origin === undefined ? undefined : String(record.origin)

	switch (stage) {
		case "run_turn_started":
		case "execute_turn_prelude_enter": {
			if (record.runId === undefined || record.runId === null) {
				return { status: "INSUFFICIENT_IDENTITY", reason: `${stage} has no runId in REAL trace` }
			}
			return {
				status: "DIRECT",
				elmMsg: {
					tag: stage === "run_turn_started" ? "run_started" : "execute_turn_prelude_enter",
					runId: String(record.runId),
					origin: origin ?? "unknown",
				},
			}
		}
		case "agent_turn_done": {
			if (record.runId === undefined || record.runId === null) {
				return { status: "INSUFFICIENT_IDENTITY", reason: "agent_turn_done has no runId in REAL trace" }
			}
			return { status: "DIRECT", elmMsg: { tag: "agent_turn_done", runId: String(record.runId) } }
		}
		case "terminal_committed": {
			if (record.jobId === undefined || record.jobId === null) {
				return { status: "INSUFFICIENT_IDENTITY", reason: "terminal_committed has no jobId in REAL trace" }
			}
			if (record.ownerId === undefined || record.ownerId === null) {
				return {
					status: "INSUFFICIENT_IDENTITY",
					reason: "terminal_committed has no ownerId (REAL schema does not carry it)",
				}
			}
			const kind = originToElmKind(origin)
			if (kind === null) {
				return {
					status: "INSUFFICIENT_IDENTITY",
					reason: `terminal_committed origin=${origin ?? "undefined"} is not Elm TerminalKind enum ("owned" / "background_not_owned")`,
				}
			}
			return {
				status: "DIRECT",
				elmMsg: { tag: "terminal_registered", jobId: String(record.jobId), ownerId: String(record.ownerId), kind },
			}
		}
		case "notify_consume_enter":
		case "wake_created": {
			if (record.jobId === undefined || record.jobId === null) {
				return { status: "INSUFFICIENT_IDENTITY", reason: `${stage} has no jobId in REAL trace` }
			}
			return { status: "DIRECT", elmMsg: { tag: "terminal_observed", jobId: String(record.jobId) } }
		}
		case "pending_prompt_enqueued":
		case "pending_prompt_dequeued":
		case "continuation_scheduled": {
			if (record.promptId === undefined || record.promptId === null) {
				return { status: "INSUFFICIENT_IDENTITY", reason: `${stage} has no promptId` }
			}
			const tag =
				stage === "pending_prompt_enqueued"
					? "pending_prompt_enqueued"
					: stage === "pending_prompt_dequeued"
						? "pending_prompt_dequeued"
						: "continuation_scheduled"
			const elmMsg: Record<string, unknown> = { tag, promptId: String(record.promptId) }
			if (stage === "pending_prompt_enqueued") elmMsg.origin = origin ?? "unknown"
			return { status: "DIRECT", elmMsg }
		}
		case "submit_and_exit_seen": {
			if (record.submitId === undefined || record.submitId === null) {
				return {
					status: "INSUFFICIENT_IDENTITY",
					reason: "submit_and_exit_seen has no submitId (REAL schema does not carry it)",
				}
			}
			return { status: "DIRECT", elmMsg: { tag: "submit_and_exit_seen", submitId: String(record.submitId) } }
		}
		case "task_completion_committed":
		case "completion_presented": {
			if (record.completionId === undefined || record.completionId === null) {
				return { status: "INSUFFICIENT_IDENTITY", reason: `${stage} has no completionId (REAL schema does not carry it)` }
			}
			const tag = stage === "task_completion_committed" ? "task_completion_committed" : "completion_presented"
			return { status: "DIRECT", elmMsg: { tag, completionId: String(record.completionId) } }
		}
		default:
			return { status: "UNMODELED_EVENT", reason: `stage=${stage} has no Elm Msg candidate in the closed Codec tag set` }
	}
}

function originToElmKind(origin: string | undefined): string | null {
	if (origin === undefined) return null
	// Elm TerminalKind closed enum: "owned" / "background_not_owned".
	// REAL origin is e.g. "background_terminal". The two name spaces
	// do NOT intersect.
	if (origin === "owned") return "owned"
	if (origin === "background_not_owned") return "background_not_owned"
	return null
}

// ---------- Replay driver (split to sub-modules) ----------

export {
	adapterIsDeterministic,
	adapterIsExplicitForMissingId,
	adapterIsExplicitForUnknownStage,
	adapterNeverManufacturesIdentity,
	adapterPreservesOrder,
	adapterPreservesOrigin,
} from "./completion-authority-elm-replay.invariants"
export { loadKernel, replayTrace, sha256Hex } from "./completion-authority-elm-replay.kernel"
