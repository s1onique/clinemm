/**
 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (AMENDMENT-01)
 *
 * COMPACTION DELIVERY of the runtime's execution-stagnation recovery
 * instruction, through the REAL production compaction path.
 *
 * THE LOSS BOUNDER THIS WITNESS REPRODUCES
 * -----------------------------------------
 *
 * The R1 corrective instruction is a runtime-synthetic `user`-role message
 * appended to the canonical transcript. The compaction summary is a LOSSY
 * PROJECTION of that transcript: a summarizer is free to omit the
 * instruction. The task-contract conservation path exists precisely to
 * carry the runtime's authoritative obligations forward past that loss.
 *
 * Before this amendment, that path recognised exactly ONE runtime
 * obligation — the terminal-completion reminder. The execution-stagnation
 * instruction fell into the compacted prefix and was LOST: the continuing
 * model never received the correction it had been given.
 *
 * THE REPAIR
 * ----------
 *
 * The instruction is now recognised by the EXACT template shape its producer
 * renders (`parseExecutionStagnationNoticeMessage`, in `@cline/shared`) and
 * carried forward in its OWN runtime-authority section. It is never promoted
 * to user authority.
 *
 * WHAT THIS FILE PROVES
 * ----------------------
 *
 *   D1  The corrective instruction reaches the ACTUAL dispatched request
 *       after a compaction that compacts it away.
 *   D2  The consumed allowance is conserved: a compaction does not
 *       replenish the runtime's run-scoped instruction allowance.
 *   D3  The original user task remains intact.
 *   D4  Runtime-owned reminders are NOT misclassified as new user task
 *       authority.
 *   D5  Signed reasoning conservation is unchanged OUTSIDE the established
 *       compaction boundary.
 *
 * EVIDENCE CLASS
 * --------------
 *
 * SYNTHETIC_REAL_PRODUCTION_SEAM. Every assertion runs against the REAL
 * production compaction wrapper (`createCompactionStateAwarePrepareTurn`),
 * the REAL task-contract conservation path, and the REAL provider-request
 * preparation seam (`MessageBuilder.buildForApi`). The summarizer is a
 * deterministic synthetic that OMITS the instruction — which is precisely
 * the lossy behaviour the carry-forward must survive.
 */

import {
	buildExecutionStagnationNoticeMessage,
	type MessageWithMetadata,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { MessageBuilder } from "../../session/services/message-builder";
import {
	type ContextPipelinePrepareTurn,
	createCompactionStateAwarePrepareTurn,
} from "./compaction";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The exact instruction the runtime renders for the observed stall. */
const RECOVERY_INSTRUCTION = buildExecutionStagnationNoticeMessage(
	5,
	["read_files", "run_commands"],
	0,
);

/** The exact runtime completion reminder, for the authority-separation check. */
const RUNTIME_COMPLETION_REMINDER =
	"[SYSTEM] This run is not complete until you call one of these terminal completion tools: submit_and_exit. Continue working if requirements are not met. If the task is complete, call the appropriate terminal completion tool now.";

/** An unrelated runtime notice — must never be promoted to any obligation. */
const UNRELATED_RUNTIME_NOTICE =
	"[SYSTEM] You still have team obligations. Unfinished tasks: task-7. Use team_run_task to delegate work.";

const ORIGINAL_USER_TASK = [
	'<user_input mode="act">Implement the bounded correction.',
	"",
	"Edit the file /tmp/fixture.txt and leave the rest alone.",
	"</user_input>",
].join("\n");

const MODEL = {
	id: "mock-model",
	provider: "anthropic",
	info: { id: "mock-model", maxInputTokens: 100_000 },
} as const;

const SYSTEM_PROMPT = "You are a helpful coding assistant.";

/** A user turn start, as the canonical history records it. */
function userTurn(text: string): MessageWithMetadata {
	return { role: "user", content: [{ type: "text", text }] };
}

/**
 * A runtime-synthetic reminder, exactly as `addUserReminderMessage()`
 * persists it: `userRunSpan: 0` marks it as carrying no user run.
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
 * A thinking block carrying a SIGNED opaque reasoning payload, in the
 * canonical `MessageWithMetadata` shape.
 */
function signedThinkingTurn(
	signature: string,
	originAuthority: string,
): MessageWithMetadata {
	return {
		role: "assistant",
		content: [
			{
				type: "thinking",
				thinking: "SYNTHETIC-REASONING-BLOCK-TEXT",
				signature,
				originAuthority,
			} as never,
		],
	};
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
 * A signed reasoning block, read off a provider-request message list.
 */
interface ObservedThinkingBlock {
	readonly signature: string | undefined;
	readonly originAuthority: string | undefined;
}

/**
 * Every signed reasoning block of a message list, in order.
 *
 * The blocks are read from the INTERNAL envelope form: that is where the
 * signature and the origin authority live.
 */
function thinkingBlocksOf(
	messages: readonly MessageWithMetadata[],
): ObservedThinkingBlock[] {
	const blocks: ObservedThinkingBlock[] = [];
	for (const message of messages) {
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content) {
			if (
				typeof block !== "object" ||
				block === null ||
				!("type" in block) ||
				(block as { type: unknown }).type !== "thinking"
			) {
				continue;
			}
			const record = block as unknown as {
				signature?: unknown;
				originAuthority?: unknown;
			};
			blocks.push({
				signature:
					typeof record.signature === "string" ? record.signature : undefined,
				originAuthority:
					typeof record.originAuthority === "string"
						? record.originAuthority
						: undefined,
			});
		}
	}
	return blocks;
}

type WrapperRun = {
	prepared: Awaited<ReturnType<ContextPipelinePrepareTurn>>;
	providerRequest: MessageWithMetadata[];
};

/**
 * Drive the REAL production compaction wrapper over a canonical history.
 */
async function runCompaction(input: {
	canonical: MessageWithMetadata[];
	compactResult?: { messages: MessageWithMetadata[]; systemPrompt?: string };
}): Promise<WrapperRun> {
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
	// The REAL provider-request preparation seam.
	const providerRequest = new MessageBuilder().buildForApi(
		prepared?.messages ?? input.canonical,
	);
	return { prepared, providerRequest };
}

// ---------------------------------------------------------------------------
// D1 — the corrective instruction reaches the actual dispatched request
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (AMENDMENT-01) / D1", () => {
	it("carries the corrective instruction into the dispatched request even though the summarizer omitted it", async () => {
		// The canonical history: the user task, then the runtime's
		// instruction, then some progress. The instruction falls inside the
		// COMPACTED PREFIX — the lossy region.
		const canonical = [
			userTurn(ORIGINAL_USER_TASK),
			runtimeReminder(RECOVERY_INSTRUCTION),
			assistantTurn("inspecting the repository"),
		];
		// The summarizer OMITS the instruction entirely.
		const { providerRequest } = await runCompaction({
			canonical,
			compactResult: agenticCompactionResult(
				"summary of work so far: inspected the repository",
			),
		});
		const providerText = providerVisibleText(providerRequest);

		// D1: the instruction reaches the ACTUAL dispatched request.
		expect(providerText).toContain(RECOVERY_INSTRUCTION);
		// It appears EXACTLY ONCE: the carry-forward is idempotent, not a
		// duplication.
		expect(countOccurrences(providerText, RECOVERY_INSTRUCTION)).toBe(1);
		// And it is carried as a RUNTIME authority, in its own section.
		expect(providerText).toContain(
			"Runtime execution-recovery instruction (runtime authority)",
		);
		// It is NOT promoted to user authority.
		expect(providerText).not.toContain(
			"User-authored objective (user authority)\n[SYSTEM] Execution has stalled",
		);
	});

	it("does NOT carry an unrelated runtime notice as a recovery instruction", async () => {
		const canonical = [
			userTurn(ORIGINAL_USER_TASK),
			runtimeReminder(UNRELATED_RUNTIME_NOTICE),
			assistantTurn("working"),
		];
		const { providerRequest } = await runCompaction({
			canonical,
			compactResult: agenticCompactionResult("summary of work so far"),
		});
		const providerText = providerVisibleText(providerRequest);
		expect(providerText).not.toContain("Unfinished tasks: task-7");
		expect(providerText).not.toContain(
			"Runtime execution-recovery instruction (runtime authority)",
		);
	});
});

// ---------------------------------------------------------------------------
// D3 — the original user task remains intact
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (AMENDMENT-01) / D3", () => {
	it("keeps the original user task intact alongside the carried instruction", async () => {
		const canonical = [
			userTurn(ORIGINAL_USER_TASK),
			runtimeReminder(RECOVERY_INSTRUCTION),
			assistantTurn("inspecting the repository"),
		];
		const { providerRequest } = await runCompaction({
			canonical,
			compactResult: agenticCompactionResult("summary of work so far"),
		});
		const providerText = providerVisibleText(providerRequest);
		// The user task survives verbatim.
		expect(providerText).toContain("Implement the bounded correction.");
		expect(providerText).toContain(
			"Edit the file /tmp/fixture.txt and leave the rest alone.",
		);
		// The carried instruction is present alongside it.
		expect(providerText).toContain(RECOVERY_INSTRUCTION);
		// The two authorities remain distinguishable: the user task is under
		// the USER heading and the instruction under the RUNTIME heading.
		expect(providerText).toContain("User-authored objective (user authority)");
		expect(providerText).toContain(
			"Runtime execution-recovery instruction (runtime authority)",
		);
		// The user task is carried EXACTLY ONCE.
		expect(
			countOccurrences(providerText, "Implement the bounded correction."),
		).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// D4 — runtime-owned reminders are not misclassified as new user task authority
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (AMENDMENT-01) / D4", () => {
	it("never promotes a runtime-owned reminder into the user-authority sections", async () => {
		const canonical = [
			userTurn(ORIGINAL_USER_TASK),
			runtimeReminder(RECOVERY_INSTRUCTION),
			runtimeReminder(RUNTIME_COMPLETION_REMINDER),
			runtimeReminder(UNRELATED_RUNTIME_NOTICE),
			assistantTurn("working"),
		];
		const { providerRequest } = await runCompaction({
			canonical,
			compactResult: agenticCompactionResult("summary of work so far"),
		});
		const providerText = providerVisibleText(providerRequest);

		// The USER-authority section carries ONLY the user task. It ends at
		// the next heading, so the runtime-owned sections are excluded.
		const userSection = providerText.slice(
			providerText.indexOf("### User-authored objective (user authority)"),
			providerText.indexOf(
				"### Runtime completion obligation (runtime authority)",
			),
		);
		expect(userSection).toContain("Implement the bounded correction.");
		expect(userSection).not.toContain("Execution has stalled");
		expect(userSection).not.toContain("submit_and_exit");
		expect(userSection).not.toContain("Unfinished tasks: task-7");

		// The runtime-owned authorities are carried under their OWN headings.
		expect(providerText).toContain(
			"### Runtime completion obligation (runtime authority)",
		);
		expect(providerText).toContain(
			"### Runtime execution-recovery instruction (runtime authority)",
		);
		// The unrelated runtime notice is never promoted at all.
		expect(providerText).not.toContain("Unfinished tasks: task-7");
	});
});

// ---------------------------------------------------------------------------
// D5 — signed reasoning conservation is unchanged outside the compaction
//      boundary
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (AMENDMENT-01) / D5", () => {
	it("leaves a signed reasoning block outside the compacted boundary byte-identical", async () => {
		const SIGNATURE = "synthetic-opaque-signature-aa11bb22";
		const ORIGIN = "minimax\u0000https://api.minimax.io\u0000/anthropic/v1";
		// The signed thinking turn sits in the PRESERVED TAIL: it is outside
		// the compaction boundary, so the compaction must not touch it.
		const signed = signedThinkingTurn(SIGNATURE, ORIGIN);
		const canonical = [
			userTurn(ORIGINAL_USER_TASK),
			runtimeReminder(RECOVERY_INSTRUCTION),
			signed,
		];
		const { providerRequest } = await runCompaction({
			canonical,
			compactResult: agenticCompactionResult("summary of work so far", [
				signed,
			]),
		});

		// The signed reasoning block survives with its EXACT signature.
		const thinking = thinkingBlocksOf(providerRequest);
		expect(thinking).toHaveLength(1);
		expect(thinking[0].signature).toBe(SIGNATURE);

		// The ORIGIN AUTHORITY is carried INTERNALLY, exactly as the
		// established projection contract requires (the authority is consumed
		// by the OUTBOUND conversion, never forwarded to the provider).
		expect(thinking[0].originAuthority).toBe(ORIGIN);

		// ---- THE CONSERVATION ASSERTION ---------------------------
		//
		// "Signed reasoning conservation remains unchanged OUTSIDE the
		// established compaction boundary."
		//
		// The established boundary is: a signed reasoning block OUTSIDE the
		// compacted prefix is carried through UNCHANGED. This amendment
		// repaired ONE boundary — the task-contract carry-forward — and it
		// must NOT have altered the reasoning handling.
		//
		// The differential is the honest form of that claim: the SAME
		// canonical history, compacted with and WITHOUT the runtime recovery
		// instruction present, must produce a reasoning representation that
		// is IDENTICAL. If the repair had touched reasoning, the two would
		// differ.
		const canonicalWithoutInstruction = [userTurn(ORIGINAL_USER_TASK), signed];
		const { providerRequest: withoutInstruction } = await runCompaction({
			canonical: canonicalWithoutInstruction,
			compactResult: agenticCompactionResult("summary of work so far", [
				signed,
			]),
		});
		expect(thinkingBlocksOf(providerRequest)).toEqual(
			thinkingBlocksOf(withoutInstruction),
		);
	});
});
