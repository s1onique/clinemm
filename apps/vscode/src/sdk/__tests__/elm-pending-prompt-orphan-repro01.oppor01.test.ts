/**
 * ACT-CLINEMM-ELM-PENDING-PROMPT-ORPHAN-REPRO01 (OPPOR01)
 *
 * SOURCE-BOUND REPLAY of the live ClineMM incident
 *   sessionId = 1794840293250_5ugld
 * through the REAL production Elm completion-authority seams.
 *
 * WHAT THIS FILE IS
 * -----------------
 * A reproduction-only witness. It replays the OPERATOR-EXPORTED
 * incident records (reduced to the incident session, order/identity
 * preserved) through:
 *
 *   record
 *     -> production AUTHORITY_STAGES filter
 *        (completion-authority-elm-authority-runtime.ts)
 *     -> adaptRecord()                  (completion-authority-elm-replay.ts)
 *     -> Elm authority queue
 *     -> flushElmAuthorityForSession()  (completion-authority-elm-authority-runtime.ts)
 *     -> REAL compiled Elm kernel       (elm/completion-authority/vendor/completion-authority.js)
 *     -> decoded completion decision
 *
 * NO synthetic Elm Model is constructed. NO mock replaces the
 * causally-important production adapter. The kernel is the SAME
 * compiled artifact the shipped extension loads.
 *
 * WHY THE HOLD HAPPENS (the finding this ACT reproduces)
 * -------------------------------------------------------
 * Elm's `Authority.handleAgentTurnDone` (Authority.elm:185-216)
 * consumes a prompt ONLY when it is in state `PromptRunning runRef`
 * whose runRef equals the closing run reference
 * (`consumePromptForRun`, Authority.elm:692-711). A prompt that is
 * still `PromptScheduled` is NOT consumed by `AgentTurnDone` - it
 * stays `PromptScheduled`, and `computeHoldReasons`
 * (Authority.elm:502-518) classifies `PromptScheduled` as
 * `PendingPrompt` AND `ScheduledContinuation`.
 *
 * The ONLY transition that moves a prompt from `PromptScheduled` to
 * `PromptRunning runRef` is `ContinuationStarted promptRef runRef`
 * (Authority.elm:347-385). The only producer of the
 * `continuation_started` capture record is
 * `apps/vscode/src/sdk/canonical-event-subscription.ts:105-121`,
 * which JOINS a held prompt (written by
 * `setHeldContinuationPromptForSession`, called from
 * `continuation-cardinality-authority.session-host-capture.ts:98`
 * on `continuation_scheduled`) with the runId of a canonical
 * `run-started` runtime event for the SAME session.
 *
 * So: if the canonical `run-started` event never arrives for the
 * continuation turn, the join never happens, `continuation_started`
 * is never emitted, the prompt stays `PromptScheduled`, and the
 * later `AgentTurnDone` cannot consume it -> the completion stays
 * HELD on `pending_prompt`.
 *
 * EVIDENCE LABELS (per ACT C7)
 * -----------------------------
 *   REAL                  the exported incident records
 *   REAL_PRODUCTION_SEAM  the real adapter + real Elm kernel
 *   SOURCE_BOUND_PARTIAL  the bundle is truncated (manifest.json
 *                         evidenceLoss=true); this replay uses only
 *                         retained records and never infers identity
 *
 * REPRODUCTION-ONLY. No production code is modified by this ACT.
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { AgentRuntimeEvent, AgentRuntimeStateSnapshot } from "@cline/shared"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { subscribeCanonicalRuntimeEventsToShadow } from "@/sdk/canonical-event-subscription"
import {
	enqueueElmAuthorityRecord,
	flushElmAuthorityForSession,
	getElmAuthorityCompletionDecision,
	resetElmAuthorityForTests,
	setElmAuthorityProvider,
} from "@/sdk/completion-authority-elm-authority-runtime"
import { adaptRecord } from "@/sdk/completion-authority-elm-replay"
import {
	clearContinuationCardinalityAuthorityCapture,
	getContinuationCardinalityAuthorityCaptureRecords,
	setContinuationCardinalityAuthorityCaptureEnabled,
} from "@/sdk/continuation-cardinality-authority"
import { createProductionPendingPromptCapture } from "@/sdk/continuation-cardinality-authority.session-host-capture"

const HERE = fileURLToPath(import.meta.url)
// `HERE` ends with the test FILE NAME, so N ".." segments walk N
// directories up from `src/sdk/__tests__/`. 4 ups == `apps/vscode`
// (the Elm kernel root); 6 ups == the repository root (the evidence
// fixtures root).
const REAL_KERNEL_PATH = join(HERE, "..", "..", "..", "..", "elm", "completion-authority", "vendor", "completion-authority.js")
const FIXTURES_DIR = join(
	HERE,
	"..",
	"..",
	"..",
	"..",
	"..",
	"..",
	".factory",
	"evidence",
	"ACT-CLINEMM-ELM-PENDING-PROMPT-ORPHAN-REPRO01",
	"fixtures",
)

const SESSION_ID = "1794840293250_5ugld"
const PROMPT_P1 = "pending_1794841243556_-tSbr"
const PROMPT_P2 = "pending_1794841410962_5gjid"
const RUN_ID = "run_rCw8nsup"

const CONTINUATION_FIXTURE = join(FIXTURES_DIR, "continuation-events.session.jsonl")
const COMPLETION_AUTHORITY_FIXTURE = join(FIXTURES_DIR, "completion-authority.session.jsonl")

const elmKernelAvailable = existsSync(REAL_KERNEL_PATH)
const fixturesAvailable = existsSync(CONTINUATION_FIXTURE) && existsSync(COMPLETION_AUTHORITY_FIXTURE)

interface CcardRecord {
	seq: number
	at?: number
	stage: string
	origin?: string
	sessionId?: string
	taskId?: string
	promptId?: string
	runId?: string
	jobId?: string
	ownerId?: string
	submitId?: string
	completionId?: string
	/**
	 * Terminal kind. The REAL `terminal_committed` capture does not carry
	 * it today (command-job-manager.ts:2711), so the incident bundle's
	 * records lack it and the REAL adapter rejects them as
	 * INSUFFICIENT_IDENTITY. The adversarial guards supply it so the
	 * REAL adapter is exercised on a fully-identified terminal.
	 */
	terminalKind?: "owned" | "background_not_owned"
}

interface AuthorityConsult {
	eventSeq: number
	timestamp?: string
	epoch?: number
	predicates?: { elmDecision?: string; elmReason?: string }
	elmDecision?: string
	elmReason?: string
}

function readJsonl<T>(path: string): T[] {
	const text = readFileSync(path, "utf8")
	const out: T[] = []
	for (const line of text.split("\n")) {
		const trimmed = line.trim()
		if (trimmed.length === 0) continue
		out.push(JSON.parse(trimmed) as T)
	}
	return out
}

/** Every CCARD record for the incident session, in recorded order. */
function incidentCcardRecords(): CcardRecord[] {
	return readJsonl<CcardRecord>(CONTINUATION_FIXTURE).sort((a, b) => a.seq - b.seq)
}

/** Every recorded completion-authority consult for the incident session. */
function incidentAuthorityConsults(): AuthorityConsult[] {
	return readJsonl<AuthorityConsult>(COMPLETION_AUTHORITY_FIXTURE)
}

/**
 * The production authority-stage filter. Mirrors `AUTHORITY_STAGES`
 * in `completion-authority-elm-authority-runtime.ts`. Expressed as a
 * predicate over SOURCE stage names so the replay can report which
 * records the production runtime would even accept.
 */
const AUTHORITY_STAGES = new Set<string>([
	"task_started",
	"run_turn_started",
	"agent_turn_done",
	"terminal_committed",
	"notify_consume_enter",
	"wake_created",
	"pending_prompt_enqueued",
	"pending_prompt_dequeued",
	"continuation_scheduled",
	"continuation_started",
	"submit_and_exit_seen",
])

interface ReplayStep {
	seq: number
	stage: string
	at?: number
	acceptedByAuthorityStageFilter: boolean
	adapterStatus: string
	adapterReason: string
	elmMsg?: Record<string, unknown>
}

interface ReplayResult {
	steps: ReplayStep[]
	decision: { kind: string; reason?: string; holdReasons?: readonly string[] }
}

/**
 * Replay the incident records through the REAL production path:
 * AUTHORITY_STAGES filter -> adaptRecord() -> enqueueElmAuthorityRecord()
 * -> flushElmAuthorityForSession() -> REAL Elm kernel -> decision.
 *
 * `extra` records are appended AFTER the recorded sequence (used only
 * by the counterfactual arm). The baseline arm passes none.
 */
interface PositionedRecord {
	/** Inject AFTER the record with this seq. */
	afterSeq: number
	record: CcardRecord
}

async function replayThroughProductionSeams(
	sessionId: string,
	records: readonly CcardRecord[],
	extra: readonly PositionedRecord[] = [],
): Promise<ReplayResult> {
	const steps: ReplayStep[] = []
	const byAfterSeq = new Map<number, CcardRecord[]>()
	for (const e of extra) {
		const list = byAfterSeq.get(e.afterSeq) ?? []
		list.push(e.record)
		byAfterSeq.set(e.afterSeq, list)
	}
	const ordered: CcardRecord[] = []
	for (const rec of records) {
		ordered.push(rec)
		for (const injected of byAfterSeq.get(rec.seq) ?? []) {
			ordered.push(injected)
		}
	}
	for (const rec of ordered) {
		const step: ReplayStep = {
			seq: rec.seq,
			stage: rec.stage,
			at: rec.at,
			acceptedByAuthorityStageFilter: AUTHORITY_STAGES.has(rec.stage),
			adapterStatus: "NOT_ATTEMPTED",
			adapterReason: "",
		}
		if (!step.acceptedByAuthorityStageFilter) {
			step.adapterStatus = "FILTERED_OUT"
			step.adapterReason = `stage=${rec.stage} is not in the production AUTHORITY_STAGES set`
			steps.push(step)
			continue
		}
		// The REAL adapter. This is the causally-important boundary:
		// it maps a captured record onto an Elm Msg and refuses to
		// manufacture identity.
		const outcome = adaptRecord(rec as unknown as Record<string, unknown>)
		step.adapterStatus = outcome.status
		if (outcome.status === "DIRECT") {
			step.elmMsg = outcome.elmMsg
			step.adapterReason = `mapped to ${outcome.elmMsg.tag}`
			// The REAL runtime enqueue + flush + kernel.
			enqueueElmAuthorityRecord(rec as unknown as Record<string, unknown>)
			await flushElmAuthorityForSession(sessionId)
		} else {
			step.adapterReason = outcome.reason
		}
		steps.push(step)
	}
	const decision = getElmAuthorityCompletionDecision(sessionId)
	return {
		steps,
		decision: {
			kind: decision.kind,
			...(decision.kind === "hold" ? { reason: decision.reason, holdReasons: decision.holdReasons } : {}),
		},
	}
}

/**
 * The SOURCE-BACKED prompt -> run correlation transitions.
 *
 * BOTH identities are REAL and recorded in the exported incident
 * bundle:
 *   PROMPT_P1 / PROMPT_P2 -- the two `pending_prompt_enqueued` /
 *                           `continuation_scheduled` prompt identities.
 *   RUN_ID               -- the `run_turn_started` runtime run identity
 *                           (and the `agent_turn_done` run identity).
 *
 * NO identity is invented. NO prompt consumption is forced. The
 * transitions travel through the REAL adapter and the REAL Elm kernel.
 */
const CORRELATION_P1: CcardRecord = {
	seq: 1000,
	at: 1794841243557,
	stage: "continuation_started",
	origin: "pending_prompt_drain",
	sessionId: SESSION_ID,
	promptId: PROMPT_P1,
	runId: RUN_ID,
}
const CORRELATION_P2: CcardRecord = {
	seq: 1001,
	at: 1794841410979,
	stage: "continuation_started",
	origin: "pending_prompt_drain",
	sessionId: SESSION_ID,
	promptId: PROMPT_P2,
	runId: RUN_ID,
}

/**
 * A COMPLETE `AgentRuntimeStateSnapshot` carrying the factual runId.
 * The canonical `run-started` event's snapshot is what the production
 * subscription reads the runId from
 * (canonical-event-subscription.ts:80), so the snapshot must be
 * well-formed for the REAL event surface.
 */
function makeRuntimeSnapshot(runId: string): AgentRuntimeStateSnapshot {
	// The canonical `run-started` snapshot is produced by the runtime's own
	// `snapshot()` projection. The production subscription reads ONLY
	// `snapshot.runId` (canonical-event-subscription.ts:80), so the fixture
	// carries a minimal but well-formed projection. The narrow cast is at
	// the FIXTURE boundary, not in any production code path.
	return {
		agentId: "agent-oppor01",
		runId,
		sessionId: undefined,
		conversationId: "conv-oppor01",
		status: "running",
		iteration: 0,
		messages: [],
		pendingToolCalls: [],
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0,
		},
		recovery: {
			state: "idle",
			tracker: {
				state: "idle",
				currentRepairAttempts: 0,
				equivalentRepeatCount: 0,
				blockedExactKeys: [],
				blockedFamilies: [],
			},
			secondStage: "none",
			episodeFailures: 0,
			maxEpisodeFailures: 0,
		},
	} as unknown as AgentRuntimeStateSnapshot
}

beforeEach(() => {
	resetElmAuthorityForTests()
})

afterEach(() => {
	resetElmAuthorityForTests()
})

describe("OPPOR01 - source-bound replay of the incident session through the REAL Elm authority seams", () => {
	it("OPPOR01-REPLAY: the recorded incident sequence reproduces the hold / pending_prompt decision", async () => {
		if (!elmKernelAvailable || !fixturesAvailable) {
			throw new Error(`OPPOR01 prerequisites missing: kernel=${elmKernelAvailable} fixtures=${fixturesAvailable}`)
		}
		setElmAuthorityProvider(REAL_KERNEL_PATH)

		const records = incidentCcardRecords()
		expect(records.length).toBeGreaterThan(0)

		const { steps, decision } = await replayThroughProductionSeams(SESSION_ID, records)
		const holdReasons = decision.kind === "hold" ? (decision.holdReasons ?? []) : []

		// The recorded production consultations for this session.
		const recordedConsults = incidentAuthorityConsults()

		const report = {
			sessionId: SESSION_ID,
			recordsReplayed: records.length,
			adapterDirect: steps.filter((s) => s.adapterStatus === "DIRECT").length,
			adapterInsufficientIdentity: steps.filter((s) => s.adapterStatus === "INSUFFICIENT_IDENTITY").length,
			adapterUnmodeled: steps.filter((s) => s.adapterStatus === "UNMODELED_EVENT").length,
			filteredOut: steps.filter((s) => s.adapterStatus === "FILTERED_OUT").length,
			continuationStartedDelivered: steps.filter((s) => s.stage === "continuation_started").length,
			finalKind: decision.kind,
			finalHoldReasons: holdReasons,
			recordedConsultCount: recordedConsults.length,
			recordedHoldReasons: Array.from(
				new Set(
					recordedConsults
						.map((c) => c.predicates?.elmReason ?? c.elmReason)
						.filter((r): r is string => typeof r === "string"),
				),
			),
		}
		console.log("OPPOR01-REPLAY-REPORT", JSON.stringify(report, null, 2))

		expect(report.adapterDirect).toBeGreaterThan(0)

		// ---- RED ASSERTION (C3 / R1) -----------------------------
		// The reproduced incident symptom: the REAL Elm kernel,
		// fed the REAL exported incident records through the REAL
		// adapter, holds completion on `pending_prompt`.
		expect(decision.kind).toBe("hold")
		expect(holdReasons).toContain("pending_prompt")
		// The mechanism: NO `continuation_started` transition was
		// ever delivered, so the prompt never reached
		// `PromptRunning` and `AgentTurnDone` could not consume it.
		expect(report.continuationStartedDelivered).toBe(0)
		// The recorded production consultations agree.
		expect(report.recordedHoldReasons).toContain("pending_prompt")
	}, 30_000)

	// ---------------------------------------------------------------------
	// C5 / A2 -- COUNTERFACTUAL: restore ONLY the missing
	// prompt -> run correlation transition, using the SOURCE-BACKED
	// identities that the recorded incident already contains:
	//   promptId = pending_1794841243556_-tSbr   (REAL, recorded)
	//   runId    = run_rCw8nsup                  (REAL, recorded)
	//
	// NO invented IDs. NO forced prompt consumption. The transition goes
	// through the REAL adapter and the REAL Elm kernel.
	// ---------------------------------------------------------------------
	it("OPPOR01-CF: supplying the source-backed continuation_started(promptId, runId) removes the pending_prompt hold", async () => {
		if (!elmKernelAvailable || !fixturesAvailable) {
			throw new Error(`OPPOR01 prerequisites missing: kernel=${elmKernelAvailable} fixtures=${fixturesAvailable}`)
		}
		setElmAuthorityProvider(REAL_KERNEL_PATH)

		const records = incidentCcardRecords()

		// The counterfactual transition. Both identities are REAL and
		// recorded in the incident bundle. The transition is inserted
		// IMMEDIATELY BEFORE the `agent_turn_done` that closes the
		// run, which is exactly where production would have emitted it
		// had the canonical `run-started` join fired.
		const cfTransition = CORRELATION_P1
		const cfTransition2 = CORRELATION_P2

		const { steps, decision } = await replayThroughProductionSeams(SESSION_ID, records, [
			// P1's correlation is injected immediately after P1's
			// `continuation_scheduled` (seq 48) -- exactly where the
			// canonical `run-started` join fires in production.
			{ afterSeq: 48, record: cfTransition },
			// P2's correlation is injected immediately after P2's
			// `continuation_scheduled` (seq 57).
			{ afterSeq: 57, record: cfTransition2 },
		])
		const holdReasons = decision.kind === "hold" ? (decision.holdReasons ?? []) : []

		const cfStep = steps.find((s) => s.stage === "continuation_started")
		console.log(
			"OPPOR01-COUNTERFACTUAL-REPORT",
			JSON.stringify(
				{
					adapterStatus: cfStep?.adapterStatus,
					adapterReason: cfStep?.adapterReason,
					elmMsg: cfStep?.elmMsg,
					finalKind: decision.kind,
					finalHoldReasons: holdReasons,
				},
				null,
				2,
			),
		)

		// The REAL adapter accepted the transition with BOTH identities.
		expect(cfStep?.adapterStatus).toBe("DIRECT")
		expect(cfStep?.elmMsg).toEqual({
			tag: "continuation_started",
			promptId: PROMPT_P1,
			runId: RUN_ID,
		})
		// The `pending_prompt` hold is gone.
		expect(holdReasons).not.toContain("pending_prompt")
	}, 30_000)

	// ---------------------------------------------------------------------
	// C5 / A3 -- NECESSITY: remove the proposed transition again, holding
	// every other input constant. The hold MUST return. This proves the
	// source-backed prompt -> run correlation is NECESSARY for the
	// observed behaviour, not merely correlated with it.
	// ---------------------------------------------------------------------
	it("OPPOR01-NECESSITY: removing the continuation_started correlation restores the pending_prompt hold", async () => {
		if (!elmKernelAvailable || !fixturesAvailable) {
			throw new Error(`OPPOR01 prerequisites missing: kernel=${elmKernelAvailable} fixtures=${fixturesAvailable}`)
		}
		setElmAuthorityProvider(REAL_KERNEL_PATH)

		const records = incidentCcardRecords()

		// A3-1: baseline (no correlation) -> hold.
		const baseline = await replayThroughProductionSeams(SESSION_ID, records)
		expect(baseline.decision.kind).toBe("hold")
		expect(baseline.decision.holdReasons ?? []).toContain("pending_prompt")

		// A3-2: with the correlation -> authorize.
		const withCorrelation = await replayThroughProductionSeams(SESSION_ID, records, [
			{ afterSeq: 48, record: CORRELATION_P1 },
			{ afterSeq: 57, record: CORRELATION_P2 },
		])
		expect(withCorrelation.decision.kind).toBe("authorize")

		// A3-3: REMOVE the correlation again (identical to the
		// baseline) -> the hold returns. This is the necessity
		// statement: the correlation transition is necessary.
		const removed = await replayThroughProductionSeams(SESSION_ID, records)
		expect(removed.decision.kind).toBe("hold")
		expect(removed.decision.holdReasons ?? []).toContain("pending_prompt")

		// A3-4: removing ONLY ONE of the two correlations is NOT
		// sufficient -- the second orphaned prompt keeps the hold.
		const halfRemoved = await replayThroughProductionSeams(SESSION_ID, records, [{ afterSeq: 48, record: CORRELATION_P1 }])
		expect(halfRemoved.decision.kind).toBe("hold")
		expect(halfRemoved.decision.holdReasons ?? []).toContain("pending_prompt")
	}, 40_000)

	// ---------------------------------------------------------------------
	// C5 / A4 -- ADVERSARIAL CONSERVATION.
	//
	// The counterfactual must NOT weaken the Elm model's fail-closed
	// behaviour. Each guard below drives the REAL adapter + REAL Elm
	// kernel and asserts that completion is STILL WITHHELD.
	//
	// These guards do NOT weaken the policy; they PROVE it survives the
	// counterfactual. They also prove the counterfactual is not a
	// blanket "authorize" hack.
	// ---------------------------------------------------------------------
	it("OPPOR01-ADVERSARIAL: the counterfactual does not authorize completion when real obligations remain outstanding", async () => {
		if (!elmKernelAvailable || !fixturesAvailable) {
			throw new Error(`OPPOR01 prerequisites missing: kernel=${elmKernelAvailable} fixtures=${fixturesAvailable}`)
		}
		setElmAuthorityProvider(REAL_KERNEL_PATH)

		const records = incidentCcardRecords()
		const withBoth = [
			{ afterSeq: 48, record: CORRELATION_P1 },
			{ afterSeq: 57, record: CORRELATION_P2 },
		]

		// A4-0: control -- with both correlations and nothing else
		// outstanding, the completion IS authorized. Without this
		// control the guards below would be vacuous.
		const control = await replayThroughProductionSeams(SESSION_ID, records, withBoth)
		expect(control.decision.kind).toBe("authorize")

		// A4-1: a GENUINELY QUEUED prompt (enqueued, never dequeued,
		// never scheduled) still holds. It is enqueued AFTER the
		// correlations are applied, so it cannot be consumed.
		const queued = await replayThroughProductionSeams(SESSION_ID, records, [
			...withBoth,
			{
				afterSeq: 64,
				record: {
					seq: 2001,
					at: 1794841469118,
					stage: "pending_prompt_enqueued",
					origin: "explicit_user",
					sessionId: SESSION_ID,
					promptId: "pending_adversarial_queued",
				},
			},
		])
		expect(queued.decision.kind).toBe("hold")
		expect(queued.decision.holdReasons ?? []).toContain("pending_prompt")

		// A4-2: a SCHEDULED continuation that has NOT started still
		// holds on `scheduled_continuation`.
		const scheduledNotStarted = await replayThroughProductionSeams(SESSION_ID, records, [
			...withBoth,
			{
				afterSeq: 64,
				record: {
					seq: 2002,
					at: 1794841469119,
					stage: "continuation_scheduled",
					origin: "pending_prompt_drain",
					sessionId: SESSION_ID,
					promptId: "pending_adversarial_scheduled",
				},
			},
		])
		expect(scheduledNotStarted.decision.kind).toBe("hold")
		expect(scheduledNotStarted.decision.holdReasons ?? []).toContain("scheduled_continuation")

		// A4-3: a STILL-RUNNING continuation (PromptRunning with no
		// matching agent_turn_done) still holds.
		const running = await replayThroughProductionSeams(SESSION_ID, records, [
			...withBoth,
			{
				afterSeq: 64,
				record: {
					seq: 2003,
					at: 1794841469120,
					stage: "continuation_started",
					origin: "pending_prompt_drain",
					sessionId: SESSION_ID,
					promptId: "pending_adversarial_running",
					runId: "run_adversarial_running",
				},
			},
		])
		expect(running.decision.kind).toBe("hold")
		expect(running.decision.holdReasons ?? []).toContain("scheduled_continuation")

		// A4-4: a FOREIGN prompt id does not settle anything -- the
		// real prompts still hold.
		const foreignPrompt = await replayThroughProductionSeams(SESSION_ID, records, [
			{ afterSeq: 48, record: { ...CORRELATION_P1, seq: 2004, promptId: "pending_foreign_session" } },
		])
		expect(foreignPrompt.decision.kind).toBe("hold")
		expect(foreignPrompt.decision.holdReasons ?? []).toContain("pending_prompt")

		// A4-5: a STALE / FOREIGN run id does not correlate the
		// prompt -- the prompt stays `PromptScheduled` and holds.
		const foreignRun = await replayThroughProductionSeams(SESSION_ID, records, [
			{ afterSeq: 48, record: { ...CORRELATION_P1, seq: 2005, runId: "run_not_the_incident_run" } },
		])
		expect(foreignRun.decision.kind).toBe("hold")
		expect(foreignRun.decision.holdReasons ?? []).toContain("pending_prompt")

		// A4-6: an UNRESOLVED background-job obligation (a real
		// registered+observed owned terminal that the Elm model still
		// counts) keeps the completion withheld. The recorded
		// `terminal_committed` records are rejected by the real
		// adapter (no `terminalKind`), so this guard constructs the
		// terminal WITH the full identity the adapter requires --
		// exercising the REAL adapter, not bypassing it.
		const unresolvedJob = await replayThroughProductionSeams(SESSION_ID, records, [
			...withBoth,
			{
				afterSeq: 3,
				record: {
					seq: 2006,
					at: 1794840293908,
					stage: "terminal_committed",
					origin: "background_terminal",
					sessionId: SESSION_ID,
					jobId: "cmd_adversarial_unresolved",
					ownerId: SESSION_ID,
					terminalKind: "owned",
				},
			},
		])
		expect(unresolvedJob.decision.kind).toBe("hold")
		expect(unresolvedJob.decision.holdReasons ?? []).toContain("unconsumed_terminal_observation")

		// A4-7: a terminal observation that has NOT been consumed
		// still holds.
		const unconsumedTerminal = await replayThroughProductionSeams(SESSION_ID, records, [
			...withBoth,
			{
				afterSeq: 3,
				record: {
					seq: 2007,
					at: 1794840293909,
					stage: "terminal_committed",
					origin: "background_terminal",
					sessionId: SESSION_ID,
					jobId: "cmd_adversarial_terminal",
					ownerId: SESSION_ID,
					terminalKind: "owned",
				},
			},
		])
		expect(unconsumedTerminal.decision.kind).toBe("hold")
		expect(unconsumedTerminal.decision.holdReasons ?? []).toContain("unconsumed_terminal_observation")
	}, 60_000)

	// ---------------------------------------------------------------------
	// C4 -- H1 vs H7 DISCRIMINATOR (producer reachability).
	//
	// H1 = "the producer never emitted `continuation_started`".
	// H7 = "the producer DID emit it but the recorder dropped it".
	//
	// This test drives the REAL production producer seam -- the REAL
	// `createProductionPendingPromptCapture()` (which is the object
	// `LocalRuntimeHost` receives) and the REAL
	// `subscribeCanonicalRuntimeEventsToShadow` (which is what
	// `SdkController.attachCanonicalRuntimeEventSubscription` wires) --
	// and proves that the producer DOES emit `continuation_started` with
	// BOTH identities when the canonical `run-started` event arrives
	// after the `continuation_scheduled`.
	//
	// It then proves the mirror case: when NO canonical `run-started`
	// arrives for the session, NO `continuation_started` is emitted.
	//
	// Together with the recorded incident evidence (the incident bundle
	// contains ZERO `continuation_started` AND only ONE `run_turn_started`
	// for FIVE `execute_turn_prelude_enter` turns), this discriminates
	// H1 (the join did not fire because no `run-started` was observed for
	// the continuation turns) from H7 (the producer is broken and could
	// never have emitted).
	// ---------------------------------------------------------------------
	it("OPPOR01-H1-H7: the REAL producer emits continuation_started only when a canonical run-started joins the held prompt", async () => {
		const capture = createProductionPendingPromptCapture()
		// The production host surface: `LocalRuntimeHost.subscribeRuntimeEvents`
		// invokes the listener with `(sessionId, event)` -- TWO arguments
		// (local-runtime-host.ts:2359). The canonical subscription's
		// signature is `(evtSessionId, event)`, so the stub must match
		// the production call shape exactly.
		const listeners = new Set<(sessionId: string, event: AgentRuntimeEvent) => void>()

		// The REAL host surface the production subscription attaches to.
		// The listener signature matches production exactly: the host
		// invokes it with `(sessionId, event)`
		// (local-runtime-host.ts:2359).
		const host = {
			subscribeRuntimeEvents: (listener: (sessionId: string, event: AgentRuntimeEvent) => void) => {
				listeners.add(listener)
				return () => {
					listeners.delete(listener)
				}
			},
		}

		const unsubscribe = subscribeCanonicalRuntimeEventsToShadow(
			host,
			{
				recorder: {} as never,
				recorderCounts: () => ({}) as never,
				records: () => [],
				observeCanonicalRuntimeEvent: () => {},
				resetForNewTask: () => {},
				dispose: () => {},
				fenceCanonicalRunForContinuation: () => {},
				coordinator: {} as never,
			},
			SESSION_ID,
		)

		try {
			// ---- ARM 1: canonical run-started DOES arrive ----
			setContinuationCardinalityAuthorityCaptureEnabled(true)
			clearContinuationCardinalityAuthorityCapture()

			// The REAL production sequence: `continuation_scheduled`
			// (which also arms the held prompt) then the canonical
			// `run-started`.
			capture.onBeforeDispatch({
				sessionId: SESSION_ID,
				delivery: "queue",
				promptId: PROMPT_P1,
			})
			for (const l of listeners) {
				l(SESSION_ID, { type: "run-started", snapshot: makeRuntimeSnapshot(RUN_ID) })
			}

			const armed = getContinuationCardinalityAuthorityCaptureRecords().filter((r) => r.stage === "continuation_started")
			expect(armed).toHaveLength(1)
			expect(armed[0].promptId).toBe(PROMPT_P1)
			expect(armed[0].runId).toBe(RUN_ID)
			// The REAL adapter accepts it (both identities present).
			expect(adaptRecord(armed[0] as unknown as Record<string, unknown>).status).toBe("DIRECT")

			// ---- ARM 2: NO canonical run-started arrives ----
			setContinuationCardinalityAuthorityCaptureEnabled(true)
			clearContinuationCardinalityAuthorityCapture()

			capture.onBeforeDispatch({
				sessionId: SESSION_ID,
				delivery: "queue",
				promptId: PROMPT_P2,
			})
			// No `run-started` event is delivered for this session.

			const unarmed = getContinuationCardinalityAuthorityCaptureRecords().filter((r) => r.stage === "continuation_started")
			expect(unarmed).toHaveLength(0)
		} finally {
			unsubscribe()
			setContinuationCardinalityAuthorityCaptureEnabled(false)
			clearContinuationCardinalityAuthorityCapture()
		}
	}, 30_000)
})
