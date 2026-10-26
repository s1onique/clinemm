/**
 * BENCHMARK-M3-M31-CAUSAL-LEDGER-01
 *
 * A deterministic, dependency-free TypeScript library that reconstructs
 * whether background-command terminal results have been SAFELY OBSERVED
 * before a completion is authorized.
 *
 * The library is a pure function over an arbitrarily-ordered array of
 * untrusted event records:
 *
 *   analyzeTerminalLedger(events: readonly unknown[]): AnalysisReport
 *
 * ## The invariant
 *
 * A completion request is ALLOW-ed only when, for the COMPLETE owner
 * identity `(sessionId, taskId, epoch)` of the request, EVERY job that was
 * registered to that owner BEFORE the request satisfies BOTH conjuncts:
 *
 *   1. terminal containment was confirmed as `gone` (not `failed`), and
 *   2. a terminal observation for that job was consumed AFTER the terminal
 *      confirmation (strictly greater `seq`).
 *
 * The analysis is a replay over the globally ordered `seq` axis. Decisions
 * are emitted at the moment the request is reached in that replay, so later
 * events can never retroactively authorize an earlier request.
 *
 * ## Fail-closed posture
 *
 * The input is untrusted. Any malformed record, conflicting duplicate
 * `eventId`, or conflicting duplicate `seq` invalidates the whole input:
 * the report is marked invalid, every decision is downgraded to HOLD, and
 * deterministic diagnostics describe each problem. An invalid input can
 * NEVER produce an ALLOW.
 *
 * The supplied input array is never mutated.
 */

// =============================================================================
// Public types
// =============================================================================

/** The complete owner identity. All three components must match exactly. */
export interface OwnerIdentity {
	readonly sessionId: string
	readonly taskId: string
	readonly epoch: number
}

/** Terminal containment classification carried by `job_terminal` events. */
export type ContainmentClassification = "gone" | "failed"

/** The four event kinds understood by the ledger. */
export type LedgerEventType = "job_registered" | "job_terminal" | "terminal_observed" | "completion_requested"

/** Why a completion request was held. */
export type BlockingReason =
	/** The job was registered to the owner but no terminal event was seen yet. */
	| "terminal_not_confirmed"
	/** The job reached terminal state but containment was classified `failed`. */
	| "containment_failed"
	/** Terminal containment was confirmed `gone` but no observation was consumed. */
	| "observation_missing"
	/** An observation exists but it was consumed BEFORE the terminal confirmation. */
	| "observation_before_terminal"
	/** The terminal classifications for the job contradicted each other. */
	| "terminal_conflict"

/** One blocking job and the reason it blocks the completion request. */
export interface BlockingJob {
	readonly jobId: string
	readonly reason: BlockingReason
}

/** The verdict for one completion request. */
export type CompletionDecision = "ALLOW" | "HOLD"

/** A decision for one `completion_requested` event. */
export interface CompletionVerdict {
	readonly decisionId: string
	/** The owner that requested completion. */
	readonly owner: OwnerIdentity
	/** The `seq` of the request. */
	readonly seq: number
	/** ALLOW or HOLD. */
	readonly decision: CompletionDecision
	/** Sorted, de-duplicated blocking job IDs (empty when ALLOW). */
	readonly blockingJobIds: readonly string[]
	/** Sorted, de-duplicated reasons aligned with `blockingJobIds`. */
	readonly reasons: readonly BlockingReason[]
	/** Per-job detail, sorted by job ID. */
	readonly blocking: readonly BlockingJob[]
}

/** A machine-readable diagnostic code. */
export type DiagnosticCode =
	| "INPUT_NOT_ARRAY"
	| "EVENT_NOT_OBJECT"
	| "MISSING_FIELD"
	| "INVALID_FIELD_TYPE"
	| "INVALID_FIELD_VALUE"
	| "UNKNOWN_EVENT_TYPE"
	| "DUPLICATE_EVENT_ID_CONFLICT"
	| "DUPLICATE_SEQ_CONFLICT"
	| "TERMINAL_CLASSIFICATION_CONFLICT"
	| "OBSERVATION_FOR_UNKNOWN_JOB"
	| "OBSERVATION_FOR_NONTERMINAL_JOB"
	| "JOB_REGISTERED_TWICE"
	| "TERMINAL_FOR_UNKNOWN_JOB"
	| "DUPLICATE_DECISION_ID"

/** A deterministic, JSON-serializable diagnostic. */
export interface LedgerDiagnostic {
	readonly code: DiagnosticCode
	/** Human-readable, deterministic message. */
	readonly message: string
	/** Index of the offending record in the ORIGINAL input array, when known. */
	readonly inputIndex?: number
	/** `seq` of the offending record, when it could be read. */
	readonly seq?: number
	/** `eventId` of the offending record, when it could be read. */
	readonly eventId?: string
}

/** The machine-readable summary of the analysis. */
export interface AnalysisSummary {
	/** Total records supplied (before duplicate collapse). */
	readonly inputCount: number
	/** Distinct events after identical-duplicate collapse. */
	readonly eventCount: number
	/** Number of identical duplicate records that were collapsed. */
	readonly duplicateCount: number
	/** Number of completion requests that produced a verdict. */
	readonly decisionCount: number
	readonly allowCount: number
	readonly holdCount: number
	/** True when the input passed every validation rule. */
	readonly valid: boolean
}

// =============================================================================
// Internal parsing types
// =============================================================================

interface ParsedEvent {
	readonly kind: LedgerEventType
	readonly seq: number
	readonly eventId: string
	readonly owner: OwnerIdentity
	readonly jobId?: string
	readonly containment?: ContainmentClassification
	readonly decisionId?: string
	/** Index of this record in the original input array. */
	readonly inputIndex: number
}

/** The reason an untrusted record could not be parsed. */
interface ParseFailure {
	readonly diagnostic: LedgerDiagnostic
}

const EVENT_TYPES: readonly LedgerEventType[] = [
	"job_registered",
	"job_terminal",
	"terminal_observed",
	"completion_requested",
]

const CONTAINMENT_CLASSIFICATIONS: readonly ContainmentClassification[] = ["gone", "failed"]

// =============================================================================
// Small, total helpers
// =============================================================================

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0
}

/** A stable string key for an owner identity. */
function ownerKey(owner: OwnerIdentity): string {
	return JSON.stringify([owner.sessionId, owner.taskId, owner.epoch])
}

/** A stable string key for a (owner, job) pair. */
function jobKey(owner: OwnerIdentity, jobId: string): string {
	return `${ownerKey(owner)}${jobId}`
}

/**
 * A stable canonical form of a parsed event, used to decide whether two
 * records with the same `eventId` are *identical* (idempotent) or
 * *conflicting* (invalid input).
 */
function canonicalEvent(event: ParsedEvent): string {
	return JSON.stringify([
		event.kind,
		event.seq,
		event.eventId,
		event.owner.sessionId,
		event.owner.taskId,
		event.owner.epoch,
		event.jobId ?? null,
		event.containment ?? null,
		event.decisionId ?? null,
	])
}

/** Deterministic ordering for diagnostics: by input index, then code, then message. */
function compareDiagnostics(a: LedgerDiagnostic, b: LedgerDiagnostic): number {
	const ai = a.inputIndex ?? -1
	const bi = b.inputIndex ?? -1
	if (ai !== bi) {
		return ai - bi
	}
	if (a.code !== b.code) {
		return a.code < b.code ? -1 : 1
	}
	if (a.message !== b.message) {
		return a.message < b.message ? -1 : 1
	}
	return 0
}

/** Deterministic ordering for blocking jobs: by job ID, then reason. */
function compareBlocking(a: BlockingJob, b: BlockingJob): number {
	if (a.jobId !== b.jobId) {
		return a.jobId < b.jobId ? -1 : 1
	}
	return a.reason < b.reason ? -1 : 1
}

/** The JSON-serializable result of `analyzeTerminalLedger`. */
export interface AnalysisReport {
	/** True when the input is valid AND every decision was ALLOW. */
	readonly ok: boolean
	/** True when the input passed every validation rule. */
	readonly valid: boolean
	readonly summary: AnalysisSummary
	/** Verdicts in ascending `seq` order. */
	readonly decisions: readonly CompletionVerdict[]
	/** Diagnostics in deterministic order. */
	readonly diagnostics: readonly LedgerDiagnostic[]
}

// =============================================================================
// Parsing / validation
// =============================================================================

function parseOwner(
	raw: unknown,
	base: { inputIndex: number; seq?: number; eventId?: string },
): OwnerIdentity | ParseFailure {
	if (!isPlainRecord(raw)) {
		return {
			diagnostic: {
				code: "INVALID_FIELD_TYPE",
				message: "owner must be an object",
				inputIndex: base.inputIndex,
				...(base.seq === undefined ? {} : { seq: base.seq }),
				...(base.eventId === undefined ? {} : { eventId: base.eventId }),
			},
		}
	}
	const sessionId = raw.sessionId
	const taskId = raw.taskId
	const epoch = raw.epoch
	if (sessionId === undefined || taskId === undefined || epoch === undefined) {
		return {
			diagnostic: {
				code: "MISSING_FIELD",
				message: "owner requires sessionId, taskId and epoch",
				inputIndex: base.inputIndex,
				...(base.seq === undefined ? {} : { seq: base.seq }),
				...(base.eventId === undefined ? {} : { eventId: base.eventId }),
			},
		}
	}
	if (!isNonEmptyString(sessionId) || !isNonEmptyString(taskId)) {
		return {
			diagnostic: {
				code: "INVALID_FIELD_TYPE",
				message: "owner.sessionId and owner.taskId must be non-empty strings",
				inputIndex: base.inputIndex,
				...(base.seq === undefined ? {} : { seq: base.seq }),
				...(base.eventId === undefined ? {} : { eventId: base.eventId }),
			},
		}
	}
	if (typeof epoch !== "number" || !Number.isSafeInteger(epoch)) {
		return {
			diagnostic: {
				code: "INVALID_FIELD_VALUE",
				message: "owner.epoch must be a safe integer",
				inputIndex: base.inputIndex,
				...(base.seq === undefined ? {} : { seq: base.seq }),
				...(base.eventId === undefined ? {} : { eventId: base.eventId }),
			},
		}
	}
	return { sessionId, taskId, epoch }
}

function isOwnerParseFailure(value: OwnerIdentity | ParseFailure): value is ParseFailure {
	return "diagnostic" in value
}

/**
 * Parse one untrusted record. Returns either a parsed event or a diagnostic
 * describing exactly why the record is malformed.
 */
function parseEvent(raw: unknown, inputIndex: number): ParsedEvent | ParseFailure {
	if (!isPlainRecord(raw)) {
		return {
			diagnostic: {
				code: "EVENT_NOT_OBJECT",
				message: "event record must be a plain object",
				inputIndex,
			},
		}
	}

	const rawType = raw.type ?? raw.kind
	if (!isNonEmptyString(rawType)) {
		return {
			diagnostic: {
				code: "MISSING_FIELD",
				message: "event record requires a string `type`",
				inputIndex,
			},
		}
	}
	if (!EVENT_TYPES.includes(rawType as LedgerEventType)) {
		return {
			diagnostic: {
				code: "UNKNOWN_EVENT_TYPE",
				message: `unknown event type "${rawType}"`,
				inputIndex,
			},
		}
	}
	const kind = rawType as LedgerEventType

	const seq = raw.seq
	if (seq === undefined) {
		return {
			diagnostic: {
				code: "MISSING_FIELD",
				message: `event "${kind}" requires a numeric \`seq\``,
				inputIndex,
			},
		}
	}
	if (typeof seq !== "number" || !Number.isSafeInteger(seq)) {
		return {
			diagnostic: {
				code: "INVALID_FIELD_TYPE",
				message: `event "${kind}" requires \`seq\` to be a safe integer`,
				inputIndex,
			},
		}
	}

	const eventId = raw.eventId
	if (eventId === undefined) {
		return {
			diagnostic: {
				code: "MISSING_FIELD",
				message: `event "${kind}" requires a string \`eventId\``,
				inputIndex,
				seq,
			},
		}
	}
	if (!isNonEmptyString(eventId)) {
		return {
			diagnostic: {
				code: "INVALID_FIELD_TYPE",
				message: `event "${kind}" requires \`eventId\` to be a non-empty string`,
				inputIndex,
				seq,
			},
		}
	}

	const ownerRaw = raw.owner ?? raw.ownerIdentity
	const ownerResult = parseOwner(ownerRaw, { inputIndex, seq, eventId })
	if (isOwnerParseFailure(ownerResult)) {
		return ownerResult
	}
	const owner: OwnerIdentity = ownerResult

	const base = { inputIndex, seq, eventId }

	if (kind === "completion_requested") {
		const decisionId = raw.decisionId
		if (decisionId === undefined) {
			return {
				diagnostic: {
					code: "MISSING_FIELD",
					message: 'event "completion_requested" requires a string `decisionId`',
					...base,
				},
			}
		}
		if (!isNonEmptyString(decisionId)) {
			return {
				diagnostic: {
					code: "INVALID_FIELD_TYPE",
					message: 'event "completion_requested" requires `decisionId` to be a non-empty string',
					...base,
				},
			}
		}
		return { kind, seq, eventId, owner, decisionId, inputIndex }
	}

	const jobId = raw.jobId
	if (jobId === undefined) {
		return {
			diagnostic: {
				code: "MISSING_FIELD",
				message: `event "${kind}" requires a string \`jobId\``,
				...base,
			},
		}
	}
	if (!isNonEmptyString(jobId)) {
		return {
			diagnostic: {
				code: "INVALID_FIELD_TYPE",
				message: `event "${kind}" requires \`jobId\` to be a non-empty string`,
				...base,
			},
		}
	}

	if (kind === "job_terminal") {
		const containment = raw.containment ?? raw.classification
		if (containment === undefined) {
			return {
				diagnostic: {
					code: "MISSING_FIELD",
					message: 'event "job_terminal" requires a string `containment`',
					...base,
				},
			}
		}
		if (typeof containment !== "string") {
			return {
				diagnostic: {
					code: "INVALID_FIELD_TYPE",
					message: 'event "job_terminal" requires `containment` to be a string',
					...base,
				},
			}
		}
		if (!CONTAINMENT_CLASSIFICATIONS.includes(containment as ContainmentClassification)) {
			return {
				diagnostic: {
					code: "INVALID_FIELD_VALUE",
					message: `event "job_terminal" has unknown containment classification "${containment}"`,
					...base,
				},
			}
		}
		return {
			kind,
			seq,
			eventId,
			owner,
			jobId,
			containment: containment as ContainmentClassification,
			inputIndex,
		}
	}

	return { kind, seq, eventId, owner, jobId, inputIndex }
}

// =============================================================================
// Replay state
// =============================================================================

/** Per (owner, job) obligation state. */
interface JobState {
	readonly owner: OwnerIdentity
	readonly jobId: string
	/** `seq` at which the job was registered to this owner. */
	registeredSeq: number
	/** `seq` of the first terminal confirmation for this (owner, job). */
	terminalSeq?: number
	/** The containment classification of the first terminal confirmation. */
	containment?: ContainmentClassification
	/**
	 * Every `seq` at which a terminal observation was consumed for this
	 * (owner, job). Kept as a set so the "consumed AFTER terminal
	 * confirmation" conjunct can be evaluated independently of the order in
	 * which the replay happens to reach the observation.
	 */
	observationSeqs: number[]
	/** True when contradictory terminal classifications were recorded. */
	terminalConflict: boolean
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Reconstruct terminal-observation safety for a ledger of events.
 *
 * @param events Untrusted event records in arbitrary arrival order.
 * @returns A JSON-serializable, deterministic report.
 */
export function analyzeTerminalLedger(events: readonly unknown[]): AnalysisReport {
	const diagnostics: LedgerDiagnostic[] = []
	const inputCount = Array.isArray(events) ? events.length : 0

	if (!Array.isArray(events)) {
		diagnostics.push({
			code: "INPUT_NOT_ARRAY",
			message: "events must be an array",
		})
		return buildInvalidReport(0, 0, 0, diagnostics)
	}

	// --- Parse -------------------------------------------------------------
	const parsed: ParsedEvent[] = []
	for (let index = 0; index < events.length; index += 1) {
		const result = parseEvent(events[index], index)
		if ("diagnostic" in result) {
			diagnostics.push(result.diagnostic)
			continue
		}
		parsed.push(result)
	}

	// --- Collapse identical duplicates; detect conflicting duplicates -------
	//
	// An event is uniquely identified by its `eventId`. Two records sharing an
	// `eventId` are the SAME event if every other field matches (identical
	// duplicate -> idempotent, collapse it) and CONFLICT if any field differs
	// (invalid input). The `seq` axis is checked the same way, because `seq`
	// is globally ordered and therefore unique per event.
	const canonicalByEventId = new Map<string, string>()
	const canonicalBySeq = new Map<number, string>()
	const seenEventIds = new Set<string>()
	const seenSeqs = new Set<number>()
	const deduplicated: ParsedEvent[] = []
	let duplicateCount = 0

	for (const event of parsed) {
		const canonical = canonicalEvent(event)

		const seenEventId = canonicalByEventId.get(event.eventId)
		if (seenEventId === undefined) {
			canonicalByEventId.set(event.eventId, canonical)
		} else if (seenEventId !== canonical) {
			diagnostics.push({
				code: "DUPLICATE_EVENT_ID_CONFLICT",
				message: `eventId "${event.eventId}" is used by conflicting records`,
				inputIndex: event.inputIndex,
				seq: event.seq,
				eventId: event.eventId,
			})
			continue
		}

		const seenSeq = canonicalBySeq.get(event.seq)
		if (seenSeq === undefined) {
			canonicalBySeq.set(event.seq, canonical)
		} else if (seenSeq !== canonical) {
			diagnostics.push({
				code: "DUPLICATE_SEQ_CONFLICT",
				message: `seq ${event.seq} is used by conflicting records`,
				inputIndex: event.inputIndex,
				seq: event.seq,
				eventId: event.eventId,
			})
			continue
		}

		// The record is identical to one already accepted on BOTH axes.
		if (seenEventIds.has(event.eventId) || seenSeqs.has(event.seq)) {
			duplicateCount += 1
			continue
		}

		seenEventIds.add(event.eventId)
		seenSeqs.add(event.seq)
		deduplicated.push(event)
	}

	// --- Sort by seq, then by eventId for total determinism -----------------
	const ordered = [...deduplicated].sort((a, b) => {
		if (a.seq !== b.seq) {
			return a.seq - b.seq
		}
		if (a.eventId !== b.eventId) {
			return a.eventId < b.eventId ? -1 : 1
		}
		return a.inputIndex - b.inputIndex
	})

	// --- Replay ------------------------------------------------------------
	const jobs = new Map<string, JobState>()
	const decisions: CompletionVerdict[] = []
	const decisionIdsSeen = new Map<string, number>()

	for (const event of ordered) {
		if (event.kind === "job_registered") {
			const key = jobKey(event.owner, event.jobId as string)
			const existing = jobs.get(key)
			if (existing === undefined) {
				jobs.set(key, {
					owner: event.owner,
					jobId: event.jobId as string,
					registeredSeq: event.seq,
					observationSeqs: [],
					terminalConflict: false,
				})
			} else if (existing.registeredSeq !== event.seq) {
				diagnostics.push({
					code: "JOB_REGISTERED_TWICE",
					message: `job "${event.jobId}" was registered twice for the same owner`,
					inputIndex: event.inputIndex,
					seq: event.seq,
					eventId: event.eventId,
				})
			}
			continue
		}

		if (event.kind === "job_terminal") {
			const key = jobKey(event.owner, event.jobId as string)
			const state = jobs.get(key)
			if (state === undefined) {
				diagnostics.push({
					code: "TERMINAL_FOR_UNKNOWN_JOB",
					message: `job_terminal for job "${event.jobId}" which was not registered to this owner`,
					inputIndex: event.inputIndex,
					seq: event.seq,
					eventId: event.eventId,
				})
				continue
			}
			const classification = event.containment as ContainmentClassification
			if (state.terminalSeq === undefined) {
				state.terminalSeq = event.seq
				state.containment = classification
			} else if (state.containment !== classification) {
				// Contradictory classifications must not silently overwrite.
				state.terminalConflict = true
				diagnostics.push({
					code: "TERMINAL_CLASSIFICATION_CONFLICT",
					message: `job "${event.jobId}" received contradictory terminal classifications ("${state.containment}" and "${classification}")`,
					inputIndex: event.inputIndex,
					seq: event.seq,
					eventId: event.eventId,
				})
			}
			continue
		}

		if (event.kind === "terminal_observed") {
			const key = jobKey(event.owner, event.jobId as string)
			const state = jobs.get(key)
			if (state === undefined) {
				diagnostics.push({
					code: "OBSERVATION_FOR_UNKNOWN_JOB",
					message: `terminal_observed for unknown job "${event.jobId}"`,
					inputIndex: event.inputIndex,
					seq: event.seq,
					eventId: event.eventId,
				})
				continue
			}
			if (!state.observationSeqs.includes(event.seq)) {
				state.observationSeqs.push(event.seq)
			}
			continue
		}

		// completion_requested
		const decisionId = event.decisionId as string
		const priorDecisionSeq = decisionIdsSeen.get(decisionId)
		if (priorDecisionSeq === undefined) {
			decisionIdsSeen.set(decisionId, event.seq)
		} else {
			diagnostics.push({
				code: "DUPLICATE_DECISION_ID",
				message: `decisionId "${decisionId}" was requested more than once`,
				inputIndex: event.inputIndex,
				seq: event.seq,
				eventId: event.eventId,
			})
		}

		// Collect the owner's jobs registered BEFORE this request.
		const blocking: BlockingJob[] = []
		for (const state of jobs.values()) {
			if (ownerKey(state.owner) !== ownerKey(event.owner)) {
				continue
			}
			if (state.registeredSeq >= event.seq) {
				// Registered at or after the request: not yet an obligation.
				continue
			}
			const classification = classifyBlockingJob(state)
			if (classification !== undefined) {
				blocking.push(classification)
			}
		}
		blocking.sort(compareBlocking)

		const blockingJobIds: string[] = []
		const reasons: BlockingReason[] = []
		for (const item of blocking) {
			if (!blockingJobIds.includes(item.jobId)) {
				blockingJobIds.push(item.jobId)
				reasons.push(item.reason)
			}
		}

		decisions.push({
			decisionId,
			owner: event.owner,
			seq: event.seq,
			decision: blocking.length === 0 ? "ALLOW" : "HOLD",
			blockingJobIds,
			reasons,
			blocking,
		})
	}

	diagnostics.sort(compareDiagnostics)

	if (diagnostics.length > 0) {
		// Invalid input: fail closed. No decision may be ALLOW.
		return buildInvalidReport(inputCount, deduplicated.length, duplicateCount, diagnostics, decisions)
	}

	const allowCount = decisions.filter((d) => d.decision === "ALLOW").length
	const holdCount = decisions.length - allowCount

	return {
		ok: allowCount === decisions.length,
		valid: true,
		summary: {
			inputCount,
			eventCount: deduplicated.length,
			duplicateCount,
			decisionCount: decisions.length,
			allowCount,
			holdCount,
			valid: true,
		},
		decisions,
		diagnostics: [],
	}
}

/**
 * Classify why a single job blocks (or does not block) a completion request.
 */
function classifyBlockingJob(state: JobState): BlockingJob | undefined {
	if (state.terminalConflict) {
		return { jobId: state.jobId, reason: "terminal_conflict" }
	}
	const terminalSeq = state.terminalSeq
	if (terminalSeq === undefined) {
		return { jobId: state.jobId, reason: "terminal_not_confirmed" }
	}
	if (state.containment !== "gone") {
		return { jobId: state.jobId, reason: "containment_failed" }
	}
	// The observation must have been consumed STRICTLY AFTER the terminal
	// confirmation. This is evaluated here (at the request point) rather than
	// during the replay, so the verdict does not depend on the order in which
	// the replay reaches the observation event.
	const consumedAfterTerminal = state.observationSeqs.some((seq) => seq > terminalSeq)
	if (consumedAfterTerminal) {
		// The obligation is DISCHARGED: this job does not block.
		return undefined
	}
	if (state.observationSeqs.length > 0) {
		// An observation exists, but it was consumed BEFORE the terminal
		// confirmation: it is not proof of consumption.
		return { jobId: state.jobId, reason: "observation_before_terminal" }
	}
	return { jobId: state.jobId, reason: "observation_missing" }
}

/**
 * Build the fail-closed report for invalid input. Every decision is
 * downgraded to HOLD and every blocking job is reported.
 */
function buildInvalidReport(
	inputCount: number,
	eventCount: number,
	duplicateCount: number,
	diagnostics: readonly LedgerDiagnostic[],
	decisions: readonly CompletionVerdict[] = [],
): AnalysisReport {
	const downgraded = decisions.map((decision) => {
		const blocking: readonly BlockingJob[] =
			decision.blocking.length > 0
				? decision.blocking
				: decision.blockingJobIds.map((jobId) => ({
						jobId,
						reason: "terminal_not_confirmed" as BlockingReason,
					}))
		return {
			...decision,
			decision: "HOLD" as CompletionDecision,
			blocking,
			blockingJobIds: blocking.map((item) => item.jobId),
			reasons: blocking.map((item) => item.reason),
		}
	})

	return {
		ok: false,
		valid: false,
		summary: {
			inputCount,
			eventCount,
			duplicateCount,
			decisionCount: downgraded.length,
			allowCount: 0,
			holdCount: downgraded.length,
			valid: false,
		},
		decisions: downgraded,
		diagnostics,
	}
}
