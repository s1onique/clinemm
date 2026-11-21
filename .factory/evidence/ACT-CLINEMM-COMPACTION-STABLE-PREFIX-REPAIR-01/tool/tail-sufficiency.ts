/**
 * ACT-CLINEMM-COMPACTION-STABLE-PREFIX-REPAIR-01
 * CANONICAL-TAIL SUFFICIENCY DISCRIMINATOR
 *
 * A DISPOSABLE, OFFLINE analysis tool. It lives under `.factory/evidence/`
 * and is NOT part of any production build, package export or runtime path.
 *
 * WHAT IT DOES
 * ------------
 * For each required scenario (A-L), it drives the REAL production seams:
 *
 *   projectSessionCompactionState()         (session/models/session-compaction.ts)
 *   applyTaskContractToCompactedMessages()  (extensions/context/task-contract.ts)
 *   applyVerifiedEvidenceToCompactedMessages() (extensions/context/evidence-continuity.ts)
 *   MessageBuilder.buildForApi()            (session/services/message-builder.ts)
 *
 * It never calls a provider. It never writes a session. It never mutates the
 * production source.
 *
 * THE QUESTION
 * ------------
 * For a verified tool outcome that lies AFTER the stored compaction source
 * boundary, does the provider-visible CANONICAL TAIL already represent the
 * outcome's VERIFIED-SUCCESS authority — such that the already-published
 * early compaction summary does not need to be rewritten?
 *
 * The discriminator is DELIBERATELY strict. The mere existence of a
 * tool_result message is NOT proof of a verified success: a result body can be
 * incomplete, stale, rejected or ambiguous. So the tool checks, for each
 * post-boundary outcome:
 *
 *   1. the canonical tool-call identity is present in the tail,
 *   2. the corresponding result identity is present in the tail,
 *   3. the tail's result status (read with the REAL
 *      `classifyToolResultStatus()`) AGREES with the canonical ledger's verdict,
 *   4. the tail's result body carries the affirmative success payload.
 *
 * Only when all four hold is the tail SUFFICIENT for that outcome.
 */

import { writeFileSync } from "node:fs";
import type { MessageWithMetadata } from "@cline/shared";
import {
	applyVerifiedEvidenceToCompactedMessages,
	classifyToolResultStatus,
	extractVerifiedToolOutcomes,
} from "../../../../sdk/packages/core/src/extensions/context/evidence-continuity";
import { applyTaskContractToCompactedMessages } from "../../../../sdk/packages/core/src/extensions/context/task-contract";
import {
	createSessionCompactionState,
	projectSessionCompactionState,
} from "../../../../sdk/packages/core/src/session/models/session-compaction";
import { MessageBuilder } from "../../../../sdk/packages/core/src/session/services/message-builder";

// ---------------------------------------------------------------------------
// Fixtures — production-shaped
// ---------------------------------------------------------------------------

function userTurn(text: string): MessageWithMetadata {
	return { role: "user", content: [{ type: "text", text }] };
}

function assistantTurn(text: string): MessageWithMetadata {
	return { role: "assistant", content: [{ type: "text", text }] };
}

function toolCall(
	id: string,
	name: string,
	input: Record<string, unknown>,
): MessageWithMetadata {
	return {
		role: "assistant",
		content: [{ type: "tool_use", id, name, input }],
	};
}

function toolResult(
	toolUseId: string,
	name: string,
	content: unknown,
	options: { isError?: boolean } = {},
): MessageWithMetadata {
	return {
		role: "user",
		content: [
			{
				type: "tool_result",
				tool_use_id: toolUseId,
				name,
				content,
				...(options.isError ? { is_error: true } : {}),
			} as never,
		],
	};
}

function successfulPair(
	id: string,
	command: string,
): MessageWithMetadata[] {
	return [
		toolCall(id, "run_commands", { commands: [command] }),
		toolResult(id, "run_commands", [
			{ query: command, result: "ok", success: true },
		]),
	];
}

const SUMMARY_PROSE = ["## Goal", "Adjudicate the findings."].join("\n");

function compactionSummaryMessage(
	summaryText: string,
): MessageWithMetadata {
	return {
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
	};
}

/** Flatten a provider-visible message list into one searchable blob. */
function providerTextOf(messages: readonly unknown[]): string {
	return messages
		.flatMap((message) => {
			const content = (message as { content?: unknown }).content;
			if (Array.isArray(content)) {
				return content.map((block) => {
					const record = block as Record<string, unknown>;
					if (record.type === "text") {
						return String(record.text ?? "");
					}
					if (record.type === "tool_use") {
						return JSON.stringify(record.input ?? {});
					}
					if (record.type === "tool_result") {
						return `${String(record.tool_use_id ?? "")}:${JSON.stringify(record.content ?? "")}`;
					}
					return "";
				});
			}
			return typeof content === "string" ? [content] : [];
		})
		.join("\n");
}

// ---------------------------------------------------------------------------
// The real production pipeline
// ---------------------------------------------------------------------------

interface ProviderVisibleRun {
	summaryText: string;
	providerText: string;
	messages: MessageWithMetadata[];
}

/**
 * Drive the REAL production restoration + provider-request seams.
 *
 * The budget guard's own accounting projection is NOT used here: this tool
 * observes the message list, not the token accounting.
 */
async function providerVisible(
	projected: readonly MessageWithMetadata[],
	canonical: readonly MessageWithMetadata[],
): Promise<ProviderVisibleRun> {
	const contracted = await applyTaskContractToCompactedMessages(
		projected,
		canonical,
	);
	const evidenced = applyVerifiedEvidenceToCompactedMessages(
		contracted.messages,
		canonical,
	);
	const providerRequest = new MessageBuilder().buildForApi(
		evidenced.messages as never,
	);
	const summary = evidenced.messages.find(
		(message) =>
			(message.metadata as { kind?: string } | undefined)?.kind ===
			"compaction_summary",
	);
	const summaryText =
		(summary?.metadata as { summary?: string } | undefined)?.summary ?? "";
	return {
		summaryText,
		providerText: providerTextOf(providerRequest),
		messages: evidenced.messages,
	};
}


/**
 * The provider-visible CANONICAL TAIL: the messages the projection appended
 * after the stored source boundary, in their provider-visible form.
 */
async function providerVisibleTail(
	projected: readonly MessageWithMetadata[],
	state: { messages: MessageWithMetadata[] },
	canonical: readonly MessageWithMetadata[],
): Promise<TailObservation> {
	const contracted = await applyTaskContractToCompactedMessages(
		projected,
		canonical,
	);
	const evidenced = applyVerifiedEvidenceToCompactedMessages(
		contracted.messages,
		canonical,
	);
	const tailInternal = evidenced.messages.slice(state.messages.length);
	const providerTail = new MessageBuilder().buildForApi(tailInternal as never);
	const toolUseIds: string[] = [];
	const resultIds: string[] = [];
	const results: {
		toolUseId: string;
		status: string;
		body: string;
		name?: string;
	}[] = [];
	for (const message of providerTail) {
		const content = (message as { content?: unknown }).content;
		if (!Array.isArray(content)) {
			continue;
		}
		for (const block of content) {
			const record = block as Record<string, unknown>;
			if (record.type === "tool_use") {
				toolUseIds.push(String(record.id ?? ""));
			}
			if (record.type === "tool_result") {
				const toolUseId = String(record.tool_use_id ?? "");
				resultIds.push(toolUseId);
				results.push({
					toolUseId,
					status: classifyToolResultStatus(
						record as { is_error?: boolean; content: unknown },
					),
					body: JSON.stringify(record.content ?? ""),
					name:
						typeof record.name === "string" ? record.name : undefined,
				});
			}
		}
	}
	return {
		text: providerTextOf(providerTail),
		toolUseIds,
		resultIds,
		results,
	};
}

interface TailObservation {
	text: string;
	toolUseIds: string[];
	resultIds: string[];
	results: {
		toolUseId: string;
		status: string;
		body: string;
		name?: string;
	}[];
}

// ---------------------------------------------------------------------------
// The per-outcome sufficiency verdict
// ---------------------------------------------------------------------------

interface OutcomeVerdict {
	toolUseId: string;
	toolName: string;
	canonicalOrder: number;
	callSourceIndex: number;
	resultSourceIndex: number;
	boundaryPosition: "before-boundary" | "after-boundary";
	/** The canonical ledger's verdict (the authority). */
	canonicalStatus: string;
	/** The tail carries the tool_use BLOCK (the call body). */
	tailHasCallBlock: boolean;
	/** The tail carries the result identity. */
	tailHasResult: boolean;
	/**
	 * The tail carries the canonical tool-call IDENTITY.
	 *
	 * The identity is what the verified-success authority is bound to. It is
	 * carried by the result block's `tool_use_id` field, and additionally by
	 * the tool_use block's `id` when the call itself is in the tail.
	 */
	tailCarriesCallIdentity: boolean;
	/** The tail carries the tool NAME for the outcome. */
	tailCarriesToolName: boolean;
	/** The tail's result status, read with the REAL classifier. */
	tailResultStatus: string | undefined;
	/** The tail's success signal AGREES with the canonical ledger. */
	tailAgreesWithCanonical: boolean;
	/** The tail result body carries the success payload literally. */
	tailBodyCarriesSuccessPayload: boolean;
	/** The FINAL sufficiency verdict. */
	tailSufficient: boolean;
	/** Why the verdict is what it is. */
	reason: string;
}

function evaluateOutcome(input: {
	outcomeId: string;
	toolName: string;
	canonicalOrder: number;
	callSourceIndex: number;
	resultSourceIndex: number;
	boundaryCount: number;
	canonicalStatus: string;
	tail: {
		toolUseIds: string[];
		resultIds: string[];
		results: {
			toolUseId: string;
			status: string;
			body: string;
			name?: string;
		}[];
	};
}): OutcomeVerdict {
	const { tail } = input;
	const tailHasCallBlock = tail.toolUseIds.includes(input.outcomeId);
	const tailHasResult = tail.resultIds.includes(input.outcomeId);
	const tailResult = tail.results.find(
		(result) => result.toolUseId === input.outcomeId,
	);
	// The canonical tool-call IDENTITY is carried by the result block's
	// `tool_use_id`. The tool_use block carries it too, but only when the
	// CALL itself is inside the visible tail.
	const tailCarriesCallIdentity =
		tailHasCallBlock || tailHasResult;
	const tailCarriesToolName =
		tailHasCallBlock ||
		tail.results.some(
			(result) => result.toolUseId === input.outcomeId && result.name,
		);
	const tailResultStatus = tailResult?.status;
	const tailAgreesWithCanonical =
		tailResultStatus !== undefined &&
		tailResultStatus === input.canonicalStatus;
	const tailBodyCarriesSuccessPayload =
		tailResult?.body.includes('"success":true') ?? false;
	const boundaryPosition =
		input.callSourceIndex >= input.boundaryCount ||
		input.resultSourceIndex >= input.boundaryCount
			? "after-boundary"
			: "before-boundary";
	const tailSufficient =
		tailCarriesCallIdentity &&
		tailHasResult &&
		tailAgreesWithCanonical &&
		(input.canonicalStatus !== "succeeded" || tailBodyCarriesSuccessPayload);
	let reason: string;
	if (!tailCarriesCallIdentity) {
		reason = "the tail carries neither the tool-call identity nor its result";
	} else if (!tailHasResult) {
		reason = "the tail does not carry the matching tool-result identity";
	} else if (!tailAgreesWithCanonical) {
		reason = `the tail's result status (${tailResultStatus}) disagrees with the canonical verdict (${input.canonicalStatus})`;
	} else if (
		input.canonicalStatus === "succeeded" &&
		!tailBodyCarriesSuccessPayload
	) {
		reason =
			"the tail's result body does not carry the affirmative success payload";
	} else {
		reason =
			"the tail carries the tool-call identity, the tool name, the result identity and an agreeing affirmative success signal";
	}
	return {
		toolUseId: input.outcomeId,
		toolName: input.toolName,
		canonicalOrder: input.canonicalOrder,
		callSourceIndex: input.callSourceIndex,
		resultSourceIndex: input.resultSourceIndex,
		boundaryPosition,
		canonicalStatus: input.canonicalStatus,
		tailHasCallBlock,
		tailHasResult,
		tailCarriesCallIdentity,
		tailCarriesToolName,
		tailResultStatus,
		tailAgreesWithCanonical,
		tailBodyCarriesSuccessPayload,
		tailSufficient,
		reason,
	};
}

// ---------------------------------------------------------------------------
// The scenarios
// ---------------------------------------------------------------------------

interface Scenario {
	id: string;
	label: string;
	/** The canonical history at the compaction boundary. */
	h0: MessageWithMetadata[];
	/** The expected outcome count in the canonical ledger of h1. */
	expectedVerified: number;
}

const BASE_H0: MessageWithMetadata[] = [
	userTurn("Adjudicate the findings."),
	assistantTurn("working"),
];

const SCENARIOS: Scenario[] = [
	{
		id: "A",
		label: "tool call and successful result both after the compaction boundary",
		h0: BASE_H0,
		expectedVerified: 1,
	},
	{
		id: "B",
		label: "tool call before the boundary, result after the boundary",
		h0: [
			userTurn("Adjudicate the findings."),
			toolCall("call_b", "run_commands", { commands: ["echo alpha"] }),
		],
		expectedVerified: 1,
	},
	{
		id: "C",
		label: "tool call and result both before the boundary",
		h0: [
			userTurn("Adjudicate the findings."),
			...successfulPair("call_c", "echo alpha"),
			assistantTurn("working"),
		],
		expectedVerified: 1,
	},
	{
		id: "D",
		label: "multiple commands inside one successful tool result",
		h0: BASE_H0,
		expectedVerified: 1,
	},
	{
		id: "E",
		label: "failed, rejected or unpaired tool result",
		h0: BASE_H0,
		expectedVerified: 0,
	},
	{
		id: "F",
		label: "successful outcome superseded by a later outcome",
		h0: BASE_H0,
		expectedVerified: 2,
	},
	{
		id: "G",
		label: "repeated preparation of unchanged canonical history",
		h0: [
			userTurn("Adjudicate the findings."),
			...successfulPair("call_g", "echo alpha"),
			assistantTurn("working"),
		],
		expectedVerified: 1,
	},
	{
		id: "H",
		label: "resume from a historical sidecar lacking the evidence section",
		h0: [
			userTurn("Adjudicate the findings."),
			...successfulPair("call_h", "echo alpha"),
			assistantTurn("working"),
		],
		expectedVerified: 2,
	},
	{
		id: "I",
		label: "re-compaction after several new successful tool results",
		h0: BASE_H0,
		expectedVerified: 3,
	},
	{
		id: "J",
		label: "stale-read replacement after the original tool result",
		h0: BASE_H0,
		expectedVerified: 2,
	},
	{
		id: "K",
		label: "rolling 12-outcome window advances",
		h0: BASE_H0,
		expectedVerified: 12,
	},
	{
		id: "L",
		label: "canonical tail approaches or exceeds the effective token budget",
		h0: BASE_H0,
		expectedVerified: 1,
	},
];

/** Build the append-only canonical continuation for a scenario. */
function continuationFor(scenario: Scenario): MessageWithMetadata[] {
	switch (scenario.id) {
		case "A":
			return [
				...successfulPair("call_a", "echo alpha"),
				assistantTurn("working"),
			];
		case "B":
			return [
				toolResult("call_b", "run_commands", [
					{ query: "echo alpha", result: "ok", success: true },
				]),
				assistantTurn("working"),
			];
		case "C":
			return [
				userTurn("Also report the repository identity."),
				assistantTurn("working"),
			];
		case "D":
			return [
				toolCall("call_d", "run_commands", {
					commands: ["echo a", "echo b", "echo c"],
				}),
				toolResult("call_d", "run_commands", [
					{ query: "echo a", result: "ok", success: true },
					{ query: "echo b", result: "ok", success: true },
					{ query: "echo c", result: "ok", success: true },
				]),
				assistantTurn("working"),
			];
		case "E":
			return [
				toolCall("call_e", "run_commands", { commands: ["echo alpha"] }),
				toolResult("call_e", "run_commands", [
					{ query: "echo alpha", result: "boom", success: false },
				]),
				toolCall("call_e2", "run_commands", { commands: ["echo beta"] }),
				assistantTurn("working"),
			];
		case "F":
			return [
				...successfulPair("call_f1", "echo alpha"),
				...successfulPair("call_f2", "echo alpha"),
				assistantTurn("working"),
			];
		case "G":
			return [];
		case "H":
			return [
				...successfulPair("call_h2", "echo bravo"),
				assistantTurn("working"),
			];
		case "I":
			return [
				...successfulPair("call_i1", "echo alpha"),
				...successfulPair("call_i2", "echo bravo"),
				...successfulPair("call_i3", "echo charlie"),
				assistantTurn("working"),
			];
		case "J":
			return [
				toolCall("call_j", "read_file", { path: "src/index.ts" }),
				toolResult("call_j", "read_file", [
					{ query: "read src/index.ts", result: "v1", success: true },
				]),
				toolCall("call_j2", "read_file", { path: "src/index.ts" }),
				toolResult("call_j2", "read_file", [
					{ query: "read src/index.ts", result: "v2", success: true },
				]),
				assistantTurn("working"),
			];
		case "K": {
			const pairs: MessageWithMetadata[] = [];
			for (let index = 0; index < 14; index += 1) {
				pairs.push(...successfulPair(`call_k${index}`, `echo ${index}`));
			}
			pairs.push(assistantTurn("working"));
			return pairs;
		}
		case "L":
			return [
				...successfulPair("call_l", "echo alpha"),
				assistantTurn("x".repeat(60_000)),
			];
		default:
			return [];
	}
}



// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

interface ScenarioResult {
	id: string;
	label: string;
	boundaryCount: number;
	canonicalMessageCount: number;
	providerVisibleMessageCount: number;
	summaryStable: boolean;
	summaryByteLengthBefore: number;
	summaryByteLengthAfter: number;
	canonicalLedgerOutcomeCount: number;
	canonicalLedgerRejectedCount: number;
	expectedVerified: number;
	outcomes: OutcomeVerdict[];
	postBoundaryOutcomes: OutcomeVerdict[];
	postBoundarySufficient: boolean;
	postBoundaryInsufficient: OutcomeVerdict[];
	/** The newly verified outcome's id is model-visible in the FULL request. */
	newOutcomeVisibleInFullRequest: boolean;
	/** The newly verified outcome's id is model-visible in the TAIL alone. */
	newOutcomeVisibleInTail: boolean;
}

async function runScenario(scenario: Scenario): Promise<ScenarioResult> {
	const h0 = scenario.h0;
	const h1 = [...h0, ...continuationFor(scenario)];

	const state = createSessionCompactionState({
		sourceMessages: h0,
		compactedMessages: [compactionSummaryMessage(SUMMARY_PROSE)],
		conversationId: `conv-${scenario.id}`,
	});

	const projectedH0 = projectSessionCompactionState(state, h0);
	const projectedH1 = projectSessionCompactionState(state, h1);
	if (!projectedH0 || !projectedH1) {
		throw new Error(`scenario ${scenario.id}: expected a successful projection`);
	}

	const before = await providerVisible(projectedH0, h0);
	const after = await providerVisible(projectedH1, h1);
	const tail = await providerVisibleTail(projectedH1, state, h1);

	const ledger = extractVerifiedToolOutcomes(h1);

	// The canonical index of each tool CALL and RESULT, for the boundary
	// position. These are AUTHORITATIVE identities, not chronological
	// adjacency.
	const resultSourceIndexById = new Map<string, number>();
	const callSourceIndexById = new Map<string, number>();
	for (let index = 0; index < h1.length; index += 1) {
		const message = h1[index];
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content) {
			if (block.type === "tool_use" && !callSourceIndexById.has(block.id)) {
				callSourceIndexById.set(block.id, index);
			}
			if (
				block.type === "tool_result" &&
				!resultSourceIndexById.has(block.tool_use_id)
			) {
				resultSourceIndexById.set(block.tool_use_id, index);
			}
		}
	}

	const outcomes = ledger.outcomes.map((outcome, canonicalOrder) =>
		evaluateOutcome({
			outcomeId: outcome.toolUseId,
			toolName: outcome.toolName,
			canonicalOrder,
			callSourceIndex:
				callSourceIndexById.get(outcome.toolUseId) ?? outcome.sourceIndex,
			resultSourceIndex:
				resultSourceIndexById.get(outcome.toolUseId) ?? outcome.sourceIndex,
			boundaryCount: state.source_message_count,
			canonicalStatus: outcome.status,
			tail,
		}),
	);

	const postBoundaryOutcomes = outcomes.filter(
		(outcome) => outcome.boundaryPosition === "after-boundary",
	);
	const postBoundaryInsufficient = postBoundaryOutcomes.filter(
		(outcome) => !outcome.tailSufficient,
	);

	// The newly verified outcome ids are the successful ones whose call or
	// result lies at or after the stored source boundary.
	const newOutcomeIds = outcomes
		.filter(
			(outcome) =>
				outcome.canonicalStatus === "succeeded" &&
				(outcome.callSourceIndex >= state.source_message_count ||
					outcome.resultSourceIndex >= state.source_message_count),
		)
		.map((outcome) => outcome.toolUseId);

	return {
		id: scenario.id,
		label: scenario.label,
		boundaryCount: state.source_message_count,
		canonicalMessageCount: h1.length,
		providerVisibleMessageCount: after.messages.length,
		summaryStable: before.summaryText === after.summaryText,
		summaryByteLengthBefore: Buffer.byteLength(before.summaryText, "utf8"),
		summaryByteLengthAfter: Buffer.byteLength(after.summaryText, "utf8"),
		canonicalLedgerOutcomeCount: ledger.outcomes.length,
		canonicalLedgerRejectedCount: ledger.rejected.length,
		expectedVerified: scenario.expectedVerified,
		outcomes,
		postBoundaryOutcomes,
		postBoundarySufficient: postBoundaryInsufficient.length === 0,
		postBoundaryInsufficient,
		newOutcomeVisibleInFullRequest: newOutcomeIds.every((id) =>
			after.providerText.includes(id),
		),
		newOutcomeVisibleInTail: newOutcomeIds.every((id) => tail.text.includes(id)),
	};
}



async function main(): Promise<void> {
	const results: ScenarioResult[] = [];
	for (const scenario of SCENARIOS) {
		results.push(await runScenario(scenario));
	}

	const report = {
		act: "ACT-CLINEMM-COMPACTION-STABLE-PREFIX-REPAIR-01",
		tool: "canonical-tail sufficiency discriminator",
		mode: "SYNTHETIC_REAL_SEAM",
		modeNote:
			"Synthetic canonical histories driven through the REAL production " +
			"projection, restoration and provider-request seams. No provider " +
			"call, no session write, no production source mutation.",
		scenarios: results,
	};
	writeFileSync(
		new URL("../tail-sufficiency-matrix.json", import.meta.url),
		`${JSON.stringify(report, null, 2)}\n`,
		"utf8",
	);

	for (const result of results) {
		const insufficient = result.postBoundaryInsufficient
			.map((outcome) => `${outcome.toolUseId}: ${outcome.reason}`)
			.join(" | ");
		process.stdout.write(
			`${result.id} ${result.label}\n` +
				`   boundary=${result.boundaryCount} canonical=${result.canonicalMessageCount} ` +
				`ledger=${result.canonicalLedgerOutcomeCount} (rejected ${result.canonicalLedgerRejectedCount}) ` +
				`expected=${result.expectedVerified}\n` +
				`   summaryStable=${result.summaryStable} ` +
				`bytes ${result.summaryByteLengthBefore}->${result.summaryByteLengthAfter}\n` +
				`   postBoundarySufficient=${result.postBoundarySufficient} ` +
				`newOutcomeVisibleInTail=${result.newOutcomeVisibleInTail} ` +
				`newOutcomeVisibleInFullRequest=${result.newOutcomeVisibleInFullRequest}\n` +
				(insufficient ? `   INSUFFICIENT: ${insufficient}\n` : "") +
				"\n",
		);
	}
}

await main();
