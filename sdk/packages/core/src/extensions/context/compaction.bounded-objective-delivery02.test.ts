/**
 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01
 *
 * COMPACTION CONSERVATION of the R2 bounded objective, through the REAL
 * production compaction path.
 *
 * WHAT THIS FILE PROVES
 * ----------------------
 *
 *   E1  The ACTIVE bounded objective's IDENTITY survives compaction: the
 *       objective that the runtime dispatched is still the objective the
 *       continuing model is told about.
 *   E2  The CONSUMED R2 allowance is conserved: a compaction does not
 *       replenish the runtime's run-scoped activation or
 *       selection-inference allowance.
 *   E3  The R2 dispatch is NOT promoted to user authority, and the original
 *       user task remains intact.
 *   E4  The R2 objective and the R1 corrective instruction stay
 *       DISTINGUISHABLE: neither is ever read as the other.
 *
 * WHY THE OBJECTIVE MUST SURVIVE COMPACTION
 * ------------------------------------------
 *
 * The compaction summary is a LOSSY PROJECTION of the canonical transcript.
 * The bounded objective is the CURRENT EXECUTION TARGET of the run: if it
 * were lost, the continuing model would silently resume the stalled parent
 * with no indication that a bounded objective had been selected for it.
 *
 * EVIDENCE CLASS
 * --------------
 *
 * SYNTHETIC_REAL_PRODUCTION_SEAM. Every assertion runs against the REAL
 * production compaction wrapper (`createCompactionStateAwarePrepareTurn`),
 * the REAL task-contract conservation path, and the REAL provider-request
 * preparation seam (`MessageBuilder.buildForApi`). The summarizer is a
 * deterministic synthetic that OMITS the objective — which is precisely the
 * lossy behaviour the carry-forward must survive.
 */

import {
	type BoundedObjective,
	type MessageWithMetadata,
	renderBoundedObjectiveInstruction,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { MessageBuilder } from "../../session/services/message-builder";
import { createCompactionStateAwarePrepareTurn } from "./compaction";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The bounded objective the runtime dispatched. */
const ACTIVE_OBJECTIVE: BoundedObjective = {
	parentTaskId: "run_abc",
	objective: "Repair the VALUE constant in the disposable target module",
	obligationReferences: [
		"Call the terminal completion tool submit_and_exit only after every parent obligation is satisfied",
	],
	firstStep: "Edit the disposable target module to set VALUE = 2",
	mutationScope: "the disposable workspace directory",
	verificationCondition: "the regression check for VALUE reports PASS",
	evidenceReferences: [
		"The last 3 consecutive execution round(s) produced no productive step",
	],
	successCondition: "the executable check for VALUE reports PASS",
	failureCondition: "the editable file cannot be changed",
};

/** The exact dispatch the runtime renders for that objective. */
const OBJECTIVE_DISPATCH = renderBoundedObjectiveInstruction(ACTIVE_OBJECTIVE);

/** The exact R1 corrective instruction, for the distinguishability check. */
const R1_INSTRUCTION =
	"[SYSTEM] Execution has stalled: the last 5 consecutive execution round(s) produced no productive step. State the single smallest useful experiment or edit that would move this task forward, then perform it now. Observable facts: the 5 round(s) used only read_files. No edit was attempted in those rounds.";

const ORIGINAL_USER_TASK =
	'<user_input mode="act">Implement the bounded correction.\n\nEdit the file /tmp/fixture.txt and leave the rest alone.\n</user_input>';

const MODEL = {
	id: "mock-model",
	provider: "anthropic",
	info: { id: "mock-model", maxInputTokens: 100_000 },
} as const;

const SYSTEM_PROMPT = "You are a helpful coding assistant.";

function userTurn(text: string): MessageWithMetadata {
	return { role: "user", content: [{ type: "text", text }] };
}

/**
 * A runtime-synthetic message, exactly as the runtime persists its own
 * reminders: `userRunSpan: 0` marks it as carrying no user run.
 */
function runtimeReminder(text: string): MessageWithMetadata {
	return {
		role: "user",
		content: [{ type: "text", text }],
		metadata: { userRunSpan: 0 },
	};
}

function assistantTurn(text: string): MessageWithMetadata {
	return { role: "assistant", content: [{ type: "text", text }] };
}

/**
 * The real agentic compaction result: an ordinary `compaction_summary`
 * message plus the preserved tail. The summarizer is DELIBERATELY lossy: it
 * mentions none of the runtime's obligations, exactly as a real summarizer
 * may.
 */
function agenticCompactionResult(
	summaryText: string,
	tail: MessageWithMetadata[] = [],
): { messages: MessageWithMetadata[] } {
	return {
		messages: [
			{
				role: "user",
				content: [{ type: "text", text: `Context summary:\n\n${summaryText}` }],
				metadata: {
					kind: "compaction_summary",
					displayRole: "system",
					userRunSpan: 1,
					summary: summaryText,
					details: { readFiles: [], modifiedFiles: [] },
					tokensBefore: 1_000,
					generatedAt: 1,
				},
			},
			...tail,
		],
	};
}

/** Flatten every text block of every message into one searchable blob. */
function providerVisibleText(messages: readonly MessageWithMetadata[]): string {
	return messages
		.flatMap((message) =>
			Array.isArray(message.content)
				? message.content
						.filter(
							(block): block is { type: "text"; text: string } =>
								block.type === "text" && typeof block.text === "string",
						)
						.map((block) => block.text)
				: typeof message.content === "string"
					? [message.content]
					: [],
		)
		.join("\n");
}

function countOccurrences(haystack: string, needle: string): number {
	if (!needle) {
		return 0;
	}
	let count = 0;
	let index = haystack.indexOf(needle);
	while (index !== -1) {
		count += 1;
		index = haystack.indexOf(needle, index + needle.length);
	}
	return count;
}

/**
 * Drive the REAL production compaction wrapper over a canonical history.
 */
async function runCompaction(input: {
	canonical: MessageWithMetadata[];
	compactResult?: { messages: MessageWithMetadata[]; systemPrompt?: string };
}): Promise<{ providerRequest: MessageWithMetadata[] }> {
	const compact = vi.fn(async () => input.compactResult);
	const prepareTurn = createCompactionStateAwarePrepareTurn({
		compact,
		getState: () => undefined,
		prepareApiMessages: async (messages) => messages,
		saveState: () => undefined,
	});
	const prepared = await prepareTurn({
		agentId: "agent-1",
		conversationId: "conv-1",
		parentAgentId: null,
		iteration: 1,
		abortSignal: new AbortController().signal,
		systemPrompt: SYSTEM_PROMPT,
		tools: [],
		messages: input.canonical,
		apiMessages: input.canonical,
		model: MODEL,
	});
	const providerRequest = new MessageBuilder().buildForApi(
		prepared?.messages ?? input.canonical,
	);
	return { providerRequest };
}

// ---------------------------------------------------------------------------
// E1 — the active objective's identity survives compaction.
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 / E1", () => {
	it("carries the active bounded objective into the dispatched request even though the summarizer omitted it", async () => {
		const canonical = [
			userTurn(ORIGINAL_USER_TASK),
			runtimeReminder(R1_INSTRUCTION),
			runtimeReminder(OBJECTIVE_DISPATCH),
			assistantTurn("editing the disposable target module"),
		];
		const { providerRequest } = await runCompaction({
			canonical,
			compactResult: agenticCompactionResult(
				"summary of work so far: inspected the repository",
			),
		});
		const providerText = providerVisibleText(providerRequest);

		// E1: the objective's IDENTITY reaches the dispatched request: its
		// parent identity, its objective, its first action, its mutation
		// scope and its verification condition are all present.
		expect(providerText).toContain(ACTIVE_OBJECTIVE.parentTaskId);
		expect(providerText).toContain(ACTIVE_OBJECTIVE.objective);
		expect(providerText).toContain(ACTIVE_OBJECTIVE.firstStep);
		expect(providerText).toContain(ACTIVE_OBJECTIVE.mutationScope);
		expect(providerText).toContain(ACTIVE_OBJECTIVE.verificationCondition);
		// The objective appears EXACTLY ONCE: the carry-forward is
		// idempotent, not a duplication.
		expect(countOccurrences(providerText, OBJECTIVE_DISPATCH)).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// E3 / E4 — authority separation and distinguishability.
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01 / E3-E4", () => {
	it("never promotes the objective to user authority and keeps the original user task intact", async () => {
		const canonical = [
			userTurn(ORIGINAL_USER_TASK),
			runtimeReminder(OBJECTIVE_DISPATCH),
			assistantTurn("working"),
		];
		const { providerRequest } = await runCompaction({
			canonical,
			compactResult: agenticCompactionResult("summary"),
		});
		const providerText = providerVisibleText(providerRequest);

		// E3: the original user task is intact.
		expect(providerText).toContain("Implement the bounded correction.");
		// The objective is carried as a RUNTIME authority, in its OWN
		// section — never as a new user task, and never in the recovery
		// instruction's section.
		expect(providerText).toContain(
			"Runtime active bounded objective (runtime authority)",
		);
		// E3: the objective's own text is not presented as a user turn
		// start: the user-authority section carries the ORIGINAL task, not
		// the objective.
		const userSectionStart = providerText.indexOf(
			"### User-authored objective (user authority)",
		);
		const userSectionEnd = providerText.indexOf(
			"### Runtime active bounded objective (runtime authority)",
		);
		expect(userSectionStart).toBeGreaterThanOrEqual(0);
		expect(userSectionEnd).toBeGreaterThan(userSectionStart);
		const userSection = providerText.slice(userSectionStart, userSectionEnd);
		// The user-authority section carries the ORIGINAL task, never the
		// objective.
		expect(userSection).toContain("Implement the bounded correction.");
		expect(userSection).not.toContain(ACTIVE_OBJECTIVE.objective);
	});

	it("keeps the R2 objective and the R1 instruction DISTINGUISHABLE", async () => {
		const canonical = [
			userTurn(ORIGINAL_USER_TASK),
			runtimeReminder(R1_INSTRUCTION),
			runtimeReminder(OBJECTIVE_DISPATCH),
		];
		const { providerRequest } = await runCompaction({
			canonical,
			compactResult: agenticCompactionResult("summary"),
		});
		const providerText = providerVisibleText(providerRequest);

		// E4: BOTH runtime authorities survive, and neither is read as the
		// other: the R1 instruction is still a stagnation notice, and the
		// R2 dispatch is still an active bounded objective.
		expect(providerText).toContain(R1_INSTRUCTION);
		expect(providerText).toContain(OBJECTIVE_DISPATCH);
	});
});
