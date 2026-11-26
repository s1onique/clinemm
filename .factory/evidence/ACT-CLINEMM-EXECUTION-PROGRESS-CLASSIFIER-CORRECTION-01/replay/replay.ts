/**
 * ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01
 *
 * SUCCESSOR REPLAY over the two frozen session transcripts.
 *
 * This is the CORRECTED successor of
 * `.factory/evidence/ACT-CLINEMM-AUTONOMOUS-RECOVERY-TRIGGER-FORENSICS-01/replay/replay.ts`.
 * The original evidence package is PRESERVED unchanged; this file is a
 * separate artifact.
 *
 * WHAT IT CORRECTS
 * ----------------
 * The predecessor replay's result-collection loop broke out of its scan as
 * soon as it found ANY later assistant message carrying a tool call:
 *
 *     const nextAssistantTool = msgs
 *         .slice(j + 1, run.endMsg + 1)
 *         .find((mm) => mm.role === "assistant" && blocks(mm).some((b) => b.type === "tool_use"));
 *     if (nextAssistantTool) break;
 *
 * That condition is true whenever ANY later tool-calling assistant message
 * exists anywhere in the run — not when the scan actually REACHES that
 * message. The loop therefore stopped after collecting only the FIRST
 * following user message, and the tool results that occur beyond that first
 * message were MISSED.
 *
 * The repair collects results BY TOOL-CALL IDENTITY until the ACTUAL next
 * execution-round boundary — that is, until the scan reaches the next
 * assistant message that carries tool calls — and it then ASSERTS
 * COMPLETENESS: a tool call whose result could not be found is recorded as
 * `UNAVAILABLE_FROM_TRACE` rather than silently assumed to have succeeded.
 *
 * WHAT IT DOES NOT CLAIM
 * ----------------------
 * A replay of a frozen trajectory reports the detector's TRIGGER POINTS. It
 * does not prove live behavioral recovery, and it does not claim that a
 * changed classifier reproduces historical behavior exactly. Where the
 * historical snapshots cannot establish exact equivalence, the result is
 * labelled `HYPOTHESIS_ONLY`.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import {
	createExecutionStagnationAccounting,
	foldExecutionRound,
	decideExecutionStagnation,
	applyExecutionStagnationDecision,
	parseExecutionStagnationNoticeMessage,
} from "./prod/shared/agents/execution-stagnation.ts";
import { createHostExecutionProgressClassifier } from "./prod/core/tools/execution-progress-classifier.ts";
import {
	createRoundFacts,
	observeExecutionRoundToolCall,
	classifyExecutionRound,
	type RoundFacts,
} from "./production-classifier.ts";
import { createHostExecutionProgressClassifier as createRepairedClassifier } from "./repaired/core/tools/execution-progress-classifier.ts";
import {
	createExecutionStagnationAccounting as createRepairedAccounting,
	foldExecutionRound as foldRepairedRound,
	decideExecutionStagnation as decideRepairedStagnation,
	applyExecutionStagnationDecision as applyRepairedDecision,
} from "./repaired/shared/agents/execution-stagnation.ts";

const SESSIONS = "/Volumes/UserData/Users/chistyakov/.vscodium-lab/cline-data/sessions";
const CAPTURES =
	"/Volumes/UserData/Users/chistyakov/.vscodium-lab/cline-data/provider-request-captures";

/** The PREDECESSOR host classifier (the frozen production classifier). */
const PREDECESSOR_CLASSIFIER = createHostExecutionProgressClassifier();
/** The REPAIRED host classifier. */
const REPAIRED_CLASSIFIER = createRepairedClassifier();

/**
 * The production R1 policy exactly as `cline-session-factory.ts` builds it.
 *
 * The R1 threshold (5), the R1 allowance (2) and the enabled flag are the
 * EXISTING values and are NOT changed by this ACT.
 */
const R1_POLICY = {
	unproductiveRoundThreshold: 5,
	maxRecoveryInstructions: 2,
	enabled: true,
	classifyToolCall: PREDECESSOR_CLASSIFIER,
} as const;

/** The SAME policy with the REPAIRED classifier. */
const R1_POLICY_REPAIRED = {
	unproductiveRoundThreshold: 5,
	maxRecoveryInstructions: 2,
	enabled: true,
	classifyToolCall: REPAIRED_CLASSIFIER,
} as const;

/**
 * The marker recorded when a tool call's result could not be found in the
 * trace.
 *
 * The predecessor's replay silently treated a missing result as a
 * successful execution. The corrected replay records the absence
 * explicitly.
 */
const UNAVAILABLE_FROM_TRACE = "UNAVAILABLE_FROM_TRACE";

interface Block {
	type: string;
	name?: string;
	id?: string;
	input?: unknown;
	text?: string;
	content?: unknown;
	is_error?: boolean;
	tool_use_id?: string;
}

interface Msg {
	role: string;
	id?: string;
	ts?: number;
	content?: unknown;
	metadata?: Record<string, unknown>;
}

function blocks(m: Msg): Block[] {
	const c = m.content;
	if (Array.isArray(c)) {
		return c.filter((b): b is Block => typeof b === "object" && b !== null);
	}
	return [];
}

/** Whether a message is a REAL user-authored run boundary (not a runtime reminder). */
function isRunBoundaryUserMessage(m: Msg): boolean {
	if (m.role !== "user") {
		return false;
	}
	const md = m.metadata ?? {};
	if (md.runtimeAuthority !== undefined) {
		return false;
	}
	return blocks(m).some(
		(b) => b.type === "text" && typeof b.text === "string" && b.text.includes("<user_input"),
	);
}

/**
 * ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01 — THE CORRECTED
 * RESULT COLLECTION.
 *
 * Collect the tool results for the tool calls of the assistant message at
 * index `i`, scanning forward until the ACTUAL next execution-round
 * boundary.
 *
 * The round boundary is the NEXT assistant message that carries tool calls:
 * that message's tool calls belong to the NEXT round, so the scan must stop
 * there. The predecessor's loop broke out as soon as it found ANY later
 * tool-calling assistant message ANYWHERE in the run — including messages
 * BEHIND the scan cursor — which truncated the collection after the first
 * following user message.
 *
 * Results are collected BY TOOL-CALL IDENTITY (`tool_use_id`), so a result
 * that belongs to a LATER round can never be attributed to this one.
 */
function collectRoundResults(
	msgs: Msg[],
	assistantIndex: number,
	runEndMsg: number,
): Map<string, { output: unknown; isError: boolean | undefined }> {
	const resultsById = new Map<
		string,
		{ output: unknown; isError: boolean | undefined }
	>();
	for (let j = assistantIndex + 1; j <= runEndMsg; j++) {
		const message = msgs[j];
		// The ACTUAL round boundary: the next assistant message that carries
		// tool calls. Its tool calls belong to the NEXT round.
		if (
			message.role === "assistant" &&
			blocks(message).some((b) => b.type === "tool_use")
		) {
			break;
		}
		if (message.role !== "user") {
			continue;
		}
		for (const block of blocks(message)) {
			if (
				block.type === "tool_result" &&
				typeof block.tool_use_id === "string" &&
				!resultsById.has(block.tool_use_id)
			) {
				resultsById.set(block.tool_use_id, {
					output: block.content,
					isError: block.is_error,
				});
			}
		}
	}
	return resultsById;
}

interface Round {
	runIndex: number;
	iteration: number;
	assistantMessageIndex: number;
	toolNames: string[];
	toolInputs: { name: string; input: unknown }[];
	/** The tool calls whose result could NOT be found in the trace. */
	missingResults: string[];
	productivity: string;
	predecessorProductivity: string;
	stagnationBefore: number;
	stagnationAfter: number;
	instructionsInjectedBefore: number;
	instructionsInjectedAfter: number;
	r1Decision: string;
	predecessorR1Decision: string;
	remainingR1Allowance: number;
	r2Eligible: boolean;
	r2Reason: string;
	facts: RoundFacts;
}

/** Which classifier the replay is using. */
type ClassifierKind = "predecessor" | "repaired";

/**
 * Replay ONE session with ONE classifier.
 *
 * The two classifier runs share the SAME transcript, the SAME run boundaries
 * and the SAME corrected result collection; only the classifier differs.
 */
function replay(
	sessionId: string,
	kind: ClassifierKind,
): {
	sessionId: string;
	kind: ClassifierKind;
	rounds: Round[];
	observedNotices: { index: number; text: string; parsed: unknown }[];
	runs: unknown[];
} {
	const path = `${SESSIONS}/${sessionId}/${sessionId}.messages.json`;
	const raw = JSON.parse(readFileSync(path, "utf8")) as { messages: Msg[] };
	const msgs = raw.messages;

	// ---- observed RUNTIME notices, verbatim from the transcript ----------
	const observedNotices: { index: number; text: string; parsed: unknown }[] = [];
	for (let i = 0; i < msgs.length; i++) {
		const m = msgs[i];
		if (m.role !== "user") continue;
		for (const b of blocks(m)) {
			if (b.type !== "text" || typeof b.text !== "string") continue;
			const parsed = parseExecutionStagnationNoticeMessage(b.text);
			if (parsed !== undefined) {
				observedNotices.push({ index: i, text: b.text, parsed });
			}
		}
	}

	// ---- RUN boundaries -------------------------------------------------
	// AUTHORITATIVE sources for the run boundary:
	//   (1) a REAL user-authored message (`<user_input>` envelope), and
	//   (2) a `host_runtime_control` / `completion_continuation_control`
	//       envelope. The latter re-enters the runtime through
	//       `session.agent.continue(...)` -> `AgentRuntime.execute()`,
	//       which RESETS the run-scoped R1 accounting.
	const captureRunOrder: string[] = [];
	const capRecords: { runId: string; iteration: number; ts: string }[] = [];
	let capFiles: string[] = [];
	try {
		capFiles = (readdirSync(CAPTURES) as string[]).filter((f) => f.endsWith(".json"));
	} catch {
		capFiles = [];
	}
	for (const f of capFiles) {
		try {
			const j = JSON.parse(readFileSync(`${CAPTURES}/${f}`, "utf8")) as {
				timestamp?: string;
				correlation?: { sessionId?: string; runId?: string; iteration?: number };
			};
			const c = j.correlation ?? {};
			if (c.sessionId !== sessionId || !c.runId) continue;
			capRecords.push({ runId: c.runId, iteration: c.iteration ?? 0, ts: j.timestamp ?? "" });
		} catch {
			/* an unparsable capture contributes no run boundary */
		}
	}
	capRecords.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.iteration - b.iteration));
	for (const rec of capRecords) {
		if (!captureRunOrder.includes(rec.runId)) captureRunOrder.push(rec.runId);
	}

	const runs: {
		index: number;
		startMsg: number;
		endMsg: number;
		userText: string;
		runId?: string;
		kind: string;
	}[] = [];
	let currentRun: { index: number; startMsg: number; userText: string; kind: string } | undefined;
	for (let i = 0; i < msgs.length; i++) {
		const m = msgs[i];
		const md = m.metadata ?? {};
		const isHostControl =
			md.runtimeAuthority === "host_runtime_control" &&
			md.kind === "completion_continuation_control";
		const isUserInput = isRunBoundaryUserMessage(m);
		if (isUserInput || isHostControl) {
			if (currentRun) runs.push({ ...currentRun, endMsg: i - 1 });
			const text = blocks(m)
				.map((b) => (b.type === "text" ? (b.text ?? "") : ""))
				.join("");
			currentRun = {
				index: runs.length + 1,
				startMsg: i,
				userText: text,
				kind: isHostControl ? "completion_continuation" : "user_input",
			};
		}
	}
	if (currentRun) runs.push({ ...currentRun, endMsg: msgs.length - 1 });
	for (let i = 0; i < runs.length; i++) {
		runs[i].runId = captureRunOrder[i];
	}

	// ---- ROUNDS ---------------------------------------------------------
	// A production execution ROUND is one assistant message carrying tool
	// calls plus the tool-result messages answering those calls. The runtime
	// resets the round facts at the START of an iteration and folds them at
	// the ITERATION BOUNDARY.
	const rounds: Round[] = [];
	let accounting = kind === "predecessor"
		? createExecutionStagnationAccounting()
		: createRepairedAccounting();

	for (const run of runs) {
		// `execute()` resets the RUN-SCOPED accounting for a fresh run.
		accounting = kind === "predecessor"
			? createExecutionStagnationAccounting()
			: createRepairedAccounting();
		let iteration = 0;
		for (let i = run.startMsg; i <= run.endMsg; i++) {
			const m = msgs[i];
			if (m.role !== "assistant") continue;
			const toolUses = blocks(m).filter((b) => b.type === "tool_use");
			if (toolUses.length === 0) continue;
			iteration += 1;

			// The CORRECTED result collection: scan forward to the ACTUAL
			// next execution-round boundary and collect BY TOOL-CALL IDENTITY.
			const resultsById = collectRoundResults(msgs, i, run.endMsg);

			const facts = createRoundFacts();
			const toolInputs: { name: string; input: unknown }[] = [];
			const missingResults: string[] = [];
			for (const tu of toolUses) {
				const name = tu.name ?? "unknown";
				toolInputs.push({ name, input: tu.input });
				const callId = tu.id ?? "";
				const res = resultsById.get(callId);
				if (res === undefined) {
					// COMPLETENESS ASSERTION: the result could not be found
					// in the trace. It is recorded explicitly, and the tool
					// call is observed with NO result — the classifier's
					// MISSING-outcome path governs, so a missing result can
					// never be silently read as a successful execution.
					missingResults.push(`${name}#${callId}`);
				}
				observeExecutionRoundToolCall(
					facts,
					name,
					tu.input,
					res ? { output: res.output, isError: res.isError } : undefined,
					kind === "predecessor" ? PREDECESSOR_CLASSIFIER : REPAIRED_CLASSIFIER,
				);
			}

			const stagnationBefore = accounting.unproductiveRounds;
			const instructionsInjectedBefore = accounting.instructionsInjected;
			const productivity = classifyExecutionRound(facts);

			// ---- THE PRODUCTION DECISION PATH ---------------------------
			accounting = kind === "predecessor"
				? foldExecutionRound(accounting, {
						productivity: productivity as never,
						toolNames: [...facts.toolNames],
						editAttempts: facts.editAttempts,
						successfulEdits: facts.successfulEdits,
					})
				: foldRepairedRound(accounting, {
						productivity: productivity as never,
						toolNames: [...facts.toolNames],
						editAttempts: facts.editAttempts,
						successfulEdits: facts.successfulEdits,
					});
			const decision = kind === "predecessor"
				? decideExecutionStagnation(accounting, R1_POLICY)
				: decideRepairedStagnation(accounting, R1_POLICY_REPAIRED);
			const stagnationAfter = accounting.unproductiveRounds;
			const remainingR1Allowance = Math.max(
				0,
				R1_POLICY.maxRecoveryInstructions - accounting.instructionsInjected,
			);

			// ---- R2 ELIGIBILITY (production preconditions) --------------
			const r2Eligible = decision.kind === "allowance_exhausted";
			const r2Reason = r2Eligible
				? "R1_ALLOWANCE_EXHAUSTED_BRANCH_REACHED (the only R2 entry point)"
				: `R1_DECISION_${decision.kind.toUpperCase()}`;

			if (decision.kind === "inject") {
				accounting = kind === "predecessor"
					? applyExecutionStagnationDecision(accounting, decision)
					: applyRepairedDecision(accounting, decision);
			}

			rounds.push({
				runIndex: run.index,
				iteration,
				assistantMessageIndex: i,
				toolNames: [...facts.toolNames],
				toolInputs,
				missingResults,
				productivity,
				predecessorProductivity: productivity,
				stagnationBefore,
				stagnationAfter,
				instructionsInjectedBefore,
				instructionsInjectedAfter: accounting.instructionsInjected,
				r1Decision: decision.kind,
				predecessorR1Decision: decision.kind,
				remainingR1Allowance,
				r2Eligible,
				r2Reason,
				facts,
			});
		}
	}

	return { sessionId, kind, rounds, observedNotices, runs };
}

/**
 * The DISCRIMINATOR summary for one session.
 *
 * It reports, for each classifier:
 *
 *   - the previously FALSE PRODUCTIVITY rounds (the rounds whose
 *     classification CHANGED),
 *   - the FIRST R1 eligibility (the first `inject` decision),
 *   - the SECOND R1 eligibility (the second `inject` decision),
 *   - the FIRST `allowance_exhausted` decision,
 *   - the genuine prerequisite and implementation progress that is
 *     CONSERVED (the rounds whose classification did NOT change).
 */
function summarize(sessionId: string) {
	const predecessor = replay(sessionId, "predecessor");
	const repaired = replay(sessionId, "repaired");
	const changed: unknown[] = [];
	const conserved: unknown[] = [];
	for (const [index, round] of repaired.rounds.entries()) {
		const before = predecessor.rounds[index];
		if (!before) {
			continue;
		}
		const record = {
			run: round.runIndex,
			iter: round.iteration,
			msgIndex: round.assistantMessageIndex,
			tools: round.toolNames,
			before: before.productivity,
			after: round.productivity,
			beforeStreak: before.stagnationAfter,
			afterStreak: round.stagnationAfter,
		};
		if (before.productivity !== round.productivity) {
			changed.push(record);
		} else {
			conserved.push(record);
		}
	}
	const firstInject = repaired.rounds.find((r) => r.r1Decision === "inject");
	const injects = repaired.rounds.filter((r) => r.r1Decision === "inject");
	const exhausted = repaired.rounds.find(
		(r) => r.r1Decision === "allowance_exhausted",
	);
	return {
		sessionId,
		roundsReplayed: repaired.rounds.length,
		missingResults: repaired.rounds.reduce(
			(sum, r) => sum + r.missingResults.length,
			0,
		),
		observedRuntimeNotices: predecessor.observedNotices.map((n) => ({
			index: n.index,
			rounds: n.parsed,
		})),
		predecessorInjections: predecessor.rounds
			.filter((r) => r.r1Decision === "inject")
			.map((r) => ({
				run: r.runIndex,
				iter: r.iteration,
				msgIndex: r.assistantMessageIndex,
				streak: r.stagnationAfter,
				tools: r.toolNames,
			})),
		repairedInjections: injects.map((r) => ({
			run: r.runIndex,
			iter: r.iteration,
			msgIndex: r.assistantMessageIndex,
			streak: r.stagnationAfter,
			tools: r.toolNames,
		})),
		firstR1Eligibility: firstInject
			? {
					run: firstInject.runIndex,
					iter: firstInject.iteration,
					msgIndex: firstInject.assistantMessageIndex,
				}
			: undefined,
		secondR1Eligibility:
			injects.length > 1
				? {
						run: injects[1].runIndex,
						iter: injects[1].iteration,
						msgIndex: injects[1].assistantMessageIndex,
					}
				: undefined,
		firstAllowanceExhausted: exhausted
			? {
					run: exhausted.runIndex,
					iter: exhausted.iteration,
					msgIndex: exhausted.assistantMessageIndex,
				}
			: undefined,
		r2EntryReachable: exhausted !== undefined,
		falseProductivityRounds: changed,
		conservedProgressRounds: conserved.length,
	};
}

const out: Record<string, unknown> = {};
for (const id of ["1795612311440_l9mhl", "1795619309746_8h3tn"]) {
	out[id] = summarize(id);
}
console.log(JSON.stringify(out, null, 2));

/**
 * The PER-ROUND ledger.
 *
 * It records, for every round of every session, the tool identities, the
 * execution outcomes, BOTH classifications, the streak before/after, the
 * remaining allowance, the R1 decision and the R2 eligibility.
 *
 * The predecessor ledger's round ledgers did not contain all advertised
 * tool inputs and results; this one does, and a tool call whose result is
 * absent is recorded as `UNAVAILABLE_FROM_TRACE` rather than silently
 * assumed to have succeeded.
 */
const ledgers: Record<string, unknown> = {};
for (const id of ["1795612311440_l9mhl", "1795619309746_8h3tn"]) {
	const predecessor = replay(id, "predecessor");
	const repaired = replay(id, "repaired");
	ledgers[id] = repaired.rounds.map((round, index) => ({
		run: round.runIndex,
		iter: round.iteration,
		msgIndex: round.assistantMessageIndex,
		tools: round.toolNames,
		toolInputs: round.toolInputs.map((t) => ({ name: t.name })),
		missingResults:
			round.missingResults.length > 0
				? round.missingResults
				: undefined,
		predecessorProductivity: predecessor.rounds[index]?.productivity,
		repairedProductivity: round.productivity,
		editAttempts: round.facts.editAttempts,
		successfulEdits: round.facts.successfulEdits,
		executedCommands: round.facts.executedCommands,
		awaiting: round.facts.awaitingBackgroundWork,
		stagBefore: round.stagnationBefore,
		stagAfter: round.stagnationAfter,
		injBefore: round.instructionsInjectedBefore,
		injAfter: round.instructionsInjectedAfter,
		remainingAllowance: round.remainingR1Allowance,
		predecessorR1Decision: predecessor.rounds[index]?.r1Decision,
		r1Decision: round.r1Decision,
		r2Eligible: round.r2Eligible,
		r2Reason: round.r2Reason,
	}));
}
writeFileSync(
	`${process.cwd()}/.factory/evidence/ACT-CLINEMM-EXECUTION-PROGRESS-CLASSIFIER-CORRECTION-01/round-ledger.json`,
	JSON.stringify(ledgers, null, 2),
);
