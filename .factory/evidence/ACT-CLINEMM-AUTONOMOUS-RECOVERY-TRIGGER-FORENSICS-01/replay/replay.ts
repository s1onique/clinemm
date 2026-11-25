/**
 * ACT-CLINEMM-AUTONOMOUS-RECOVERY-TRIGGER-FORENSICS-01
 *
 * Replay of the PRODUCTION R1/R2 decision machinery over the two frozen
 * session transcripts.
 *
 * The script NEVER reimplements the classifier: it imports the REAL
 * production modules from the session's own source version.
 */
import { readFileSync, readdirSync } from "node:fs";
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

const SESSIONS = "/Volumes/UserData/Users/chistyakov/.vscodium-lab/cline-data/sessions";

const HOST_CLASSIFIER = createHostExecutionProgressClassifier();

/** The production R1 policy exactly as `cline-session-factory.ts` builds it. */
const R1_POLICY = {
	unproductiveRoundThreshold: 5,
	maxRecoveryInstructions: 2,
	enabled: true,
	classifyToolCall: HOST_CLASSIFIER,
} as const;

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

interface Round {
	runIndex: number;
	iteration: number;
	assistantMessageIndex: number;
	toolNames: string[];
	toolInputs: { name: string; input: unknown }[];
	productivity: string;
	stagnationBefore: number;
	stagnationAfter: number;
	instructionsInjectedBefore: number;
	instructionsInjectedAfter: number;
	r1Decision: string;
	remainingR1Allowance: number;
	r2Eligible: boolean;
	r2Reason: string;
	facts: RoundFacts;
}

function replay(sessionId: string) {
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
	//       which RESETS the run-scoped R1 accounting
	//       (`this.executionStagnation = createExecutionStagnationAccounting()`).
	// The provider-request captures additionally carry a `runId` per
	// dispatched request, used here as the cross-check.
	const CAPTURES =
		"/Volumes/UserData/Users/chistyakov/.vscodium-lab/cline-data/provider-request-captures";
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
	capRecords.sort((a, b) =>
		a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.iteration - b.iteration,
	);
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
	let accounting = createExecutionStagnationAccounting();

	for (const run of runs) {
		// `execute()` resets the RUN-SCOPED accounting for a fresh run.
		accounting = createExecutionStagnationAccounting();
		let iteration = 0;
		for (let i = run.startMsg; i <= run.endMsg; i++) {
			const m = msgs[i];
			if (m.role !== "assistant") continue;
			const toolUses = blocks(m).filter((b) => b.type === "tool_use");
			if (toolUses.length === 0) continue;
			iteration += 1;

			// Collect the tool results delivered before the NEXT assistant
			// tool-calling message (the production round boundary).
			const resultsById = new Map<string, { output: unknown; isError: boolean | undefined }>();
			for (let j = i + 1; j <= run.endMsg; j++) {
				const rm = msgs[j];
				if (rm.role === "user") {
					for (const b of blocks(rm)) {
						if (b.type === "tool_result" && typeof b.tool_use_id === "string") {
							if (!resultsById.has(b.tool_use_id)) {
								resultsById.set(b.tool_use_id, { output: b.content, isError: b.is_error });
							}
						}
					}
				}
				const nextAssistantTool = msgs
					.slice(j + 1, run.endMsg + 1)
					.find((mm) => mm.role === "assistant" && blocks(mm).some((b) => b.type === "tool_use"));
				if (nextAssistantTool) break;
			}

			const facts = createRoundFacts();
			const toolInputs: { name: string; input: unknown }[] = [];
			const resultSummary: { name: string; output: unknown; isError: boolean | undefined }[] = [];
			for (const tu of toolUses) {
				const name = tu.name ?? "unknown";
				toolInputs.push({ name, input: tu.input });
				const res = resultsById.get(tu.id ?? "");
				resultSummary.push({ name, output: res?.output, isError: res?.isError });
				observeExecutionRoundToolCall(
					facts,
					name,
					tu.input,
					res ? { output: res.output, isError: res.isError } : undefined,
					HOST_CLASSIFIER,
				);
			}

			const stagnationBefore = accounting.unproductiveRounds;
			const instructionsInjectedBefore = accounting.instructionsInjected;
			const productivity = classifyExecutionRound(facts);

			// ---- THE PRODUCTION DECISION PATH ---------------------------
			accounting = foldExecutionRound(accounting, {
				productivity: productivity as never,
				toolNames: [...facts.toolNames],
				editAttempts: facts.editAttempts,
				successfulEdits: facts.successfulEdits,
			});
			const decision = decideExecutionStagnation(accounting, R1_POLICY);
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
				accounting = applyExecutionStagnationDecision(accounting, decision);
			}

			rounds.push({
				runIndex: run.index,
				iteration,
				assistantMessageIndex: i,
				toolNames: [...facts.toolNames],
				toolInputs,
				productivity,
				stagnationBefore,
				stagnationAfter,
				instructionsInjectedBefore,
				instructionsInjectedAfter: accounting.instructionsInjected,
				r1Decision: decision.kind,
				remainingR1Allowance,
				r2Eligible,
				r2Reason,
				facts,
			});
		}
	}

	return { sessionId, rounds, observedNotices, runs };
}

const out: Record<string, unknown> = {};
for (const id of ["1795612311440_l9mhl", "1795619309746_8h3tn"]) {
	const r = replay(id);
	out[id] = {
		runs: r.runs.map((x) => ({
			index: x.index,
			runId: x.runId,
			kind: x.kind,
			startMsg: x.startMsg,
			endMsg: x.endMsg,
			userTextHead: x.userText.slice(0, 160),
		})),
		observedNotices: r.observedNotices.map((n) => ({ index: n.index, parsed: n.parsed, text: n.text })),
		rounds: r.rounds.map((rd) => ({
			run: rd.runIndex,
			iter: rd.iteration,
			msgIndex: rd.assistantMessageIndex,
			tools: rd.toolNames,
			productivity: rd.productivity,
			editAttempts: rd.facts.editAttempts,
			successfulEdits: rd.facts.successfulEdits,
			executedCommands: rd.facts.executedCommands,
			awaiting: rd.facts.awaitingBackgroundWork,
			stagBefore: rd.stagnationBefore,
			stagAfter: rd.stagnationAfter,
			injBefore: rd.instructionsInjectedBefore,
			injAfter: rd.instructionsInjectedAfter,
			remainingAllowance: rd.remainingR1Allowance,
			r1Decision: rd.r1Decision,
			r2Eligible: rd.r2Eligible,
			r2Reason: rd.r2Reason,
		})),
	};
}
console.log(JSON.stringify(out, null, 2));
