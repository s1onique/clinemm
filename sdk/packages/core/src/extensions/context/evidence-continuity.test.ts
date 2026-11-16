/**
 * ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-RECON01
 *
 * Permanent hermetic regression suite for verified-tool-outcome continuity
 * across Agentic compaction.
 *
 * THE DEFECT
 * -----------
 *
 * A compaction replaces the compacted prefix with a GENERATED summary. The
 * generated summary is a lossy projection of the canonical history, and it
 * can drop a decisive fact: an operation that actually executed
 * successfully. The continuing model then reports that operation as
 * NOT_EXECUTED - a statement the canonical record contradicts.
 *
 * The reproduced instance is the Round C session `1794780088950_tc1vx`: a
 * `helm template` render executed with `rc=0` and resolved the image, the
 * evidence REACHED the summarizer's input window, the INSTALLED SUMMARY
 * carried none of it, and the final report claimed the render was
 * NOT_EXECUTED.
 *
 * THE INVARIANT
 * -------------
 *
 *   A generated summary may omit historical detail, but it must NOT become
 *   MORE AUTHORITATIVE than the canonical record of what actually executed.
 *
 * THE SUITE
 * ---------
 *
 * The suite drives the REAL production boundary:
 *   createCompactionStateAwarePrepareTurn()  (the state-aware wrapper)
 *     -> projectSessionCompactionState()     (the real projector)
 *     -> input.compact()                     (the real agentic result seam)
 *     -> createSessionCompactionState()      (the real persistence builder)
 *     -> MessageBuilder.buildForApi()        (the real provider-request seam)
 *
 * Every scenario exercises production functions, and the provider-visible
 * assertion reads the exact prepared provider request.
 *
 * The compaction summary used as the compaction RESULT deliberately OMITS
 * the verified outcome - exactly as the real summarizer did. A repair that
 * merely asked the summarizer to preserve outcomes would not make these
 * tests GREEN, because the summary text is an INPUT here, not an output.
 */

import type { MessageWithMetadata } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import type { SessionCompactionState } from "../../session/models/session-compaction";
import { MessageBuilder } from "../../session/services/message-builder";
import {
	type ContextPipelinePrepareTurn,
	createCompactionStateAwarePrepareTurn,
} from "./compaction";
import {
	applyEvidenceToSummary,
	classifyToolResultStatus,
	EVIDENCE_SECTION_HEADING,
	extractVerifiedToolOutcomes,
	MAX_CARRIED_OUTCOMES,
	sanitizeOutcomeText,
} from "./evidence-continuity";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * The tool-call id of the reproduced helm render. The ids are the
 * canonical join key between a call and its result.
 */
const HELM_CALL_ID = "call_f476e4ce0f204de8baabc31d";

/**
 * The SUCCESSFUL helm render output, as the canonical history recorded it.
 *
 * It is deliberately SHORT (582 chars in the real transcript) - well under
 * the production 2,000-char compaction truncation limit. That is what
 * makes this fixture decisive: the loss was NOT caused by truncation.
 */
const HELM_RENDER_OUTPUT = [
	"rc=0",
	"13",
	'213:          image: "quay.io/keycloak/keycloak:26.0.7"',
	"210:          securityContext:",
	"211:            runAsNonRoot: true",
	"212-            runAsUser: 1000",
	"290:      securityContext:",
	"291-        fsGroup: 1000",
	"294-      nodeSelector:",
	"295-        dedicated: keycloak",
].join("\n");

const MODEL = {
	id: "mock-model",
	provider: "anthropic",
	info: { id: "mock-model", maxInputTokens: 100_000 },
} as const;

const SYSTEM_PROMPT = "You are a helpful coding assistant.";

/** A typed user turn. */
function userTurn(text: string): MessageWithMetadata {
	return { role: "user", content: [{ type: "text", text }] };
}

/** An assistant turn with plain text. */
function assistantTurn(text: string): MessageWithMetadata {
	return { role: "assistant", content: [{ type: "text", text }] };
}

/** An assistant turn issuing a tool call. */
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

/** A user turn carrying a tool result. */
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
			} as MessageWithMetadata["content"] extends Array<infer T> ? T : never,
		],
	};
}

/**
 * The SUCCESSFUL helm render, exactly as the canonical history carried it:
 * a tool call and its matching result, with the persisted
 * `{query, result, success}` payload shape.
 */
function successfulHelmPair(): MessageWithMetadata[] {
	return [
		toolCall(HELM_CALL_ID, "run_commands", {
			commands: ["helm template kc-test . -f values.yaml"],
		}),
		toolResult(HELM_CALL_ID, "run_commands", [
			{
				query: "helm template kc-test . -f values.yaml",
				result: HELM_RENDER_OUTPUT,
				success: true,
			},
		]),
	];
}

/**
 * The compaction result the production summarizer would install: an ordinary
 * `compaction_summary` message plus the preserved tail.
 *
 * The summary text DELIBERATELY OMITS the helm outcome - that is the
 * reproduced defect, expressed as an input to the pipeline.
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

type WrapperRun = {
	prepared: Awaited<ReturnType<ContextPipelinePrepareTurn>>;
	providerRequest: MessageWithMetadata[];
	savedStates: SessionCompactionState[];
};

async function runWrapper(input: {
	canonical: MessageWithMetadata[];
	existingState?: SessionCompactionState;
	compactResult?: { messages: MessageWithMetadata[] };
}): Promise<WrapperRun> {
	const compact = vi.fn(async () => input.compactResult);
	const savedStates: SessionCompactionState[] = [];
	const prepareTurn = createCompactionStateAwarePrepareTurn({
		compact,
		getState: () => input.existingState,
		prepareApiMessages: async (messages) => messages,
		saveState: (state) => {
			savedStates.push(state);
		},
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
	// The real provider-request preparation seam.
	const providerRequest = new MessageBuilder().buildForApi(
		prepared?.messages ?? input.canonical,
	);
	return { prepared, providerRequest, savedStates };
}

// ---------------------------------------------------------------------------
// The core defect: a successful execution must survive compaction
// ---------------------------------------------------------------------------

describe("verified tool outcome continuity — the reproduced defect", () => {
	it("carries a SUCCESSFUL execution into the provider request even when the generated summary omitted it", async () => {
		const canonical = [
			userTurn("Render the chart and report the effective image."),
			...successfulHelmPair(),
			assistantTurn("continuing"),
		];
		// The reproduced summarizer output: the outcome is NOT mentioned.
		const lossySummary = [
			"## Goal",
			"Render the chart.",
			"## State",
			"- Done: read the chart values.",
			"- Blocked: several command outputs were blank, incomplete, or unavailable.",
			"## Next",
			"- Still need the effective Helm rendering.",
		].join("\n");

		const { providerRequest } = await runWrapper({
			canonical,
			compactResult: agenticCompactionResult(lossySummary),
		});

		const providerText = providerVisibleText(providerRequest);
		// The verified outcome MUST be present...
		expect(providerText).toContain(EVIDENCE_SECTION_HEADING);
		expect(providerText).toContain(HELM_CALL_ID);
		expect(providerText).toContain("succeeded");
		// ...and the decisive OUTPUT must be present, not merely the fact
		// that some tool ran.
		expect(providerText).toContain("rc=0");
		expect(providerText).toContain("quay.io/keycloak/keycloak:26.0.7");
		expect(providerText).toContain("runAsNonRoot: true");
		expect(providerText).toContain("fsGroup: 1000");
	});

	it("does not let the generated summary's NOT_EXECUTED claim stand against the canonical record", async () => {
		const canonical = [
			userTurn("Render the chart and report the effective image."),
			...successfulHelmPair(),
			assistantTurn("continuing"),
		];
		// The reproduced FINAL-REPORT claim: the render was NOT_EXECUTED.
		const lossySummary = [
			"## Goal",
			"Render the chart.",
			"## State",
			"- Done: read the chart values.",
			"## Next",
			"- `helm template` offline render: NOT_EXECUTED.",
		].join("\n");

		const { providerRequest } = await runWrapper({
			canonical,
			compactResult: agenticCompactionResult(lossySummary),
		});

		const providerText = providerVisibleText(providerRequest);
		// The summary still carries its (wrong) prose - the repair does not
		// rewrite generated text. What the repair guarantees is that the
		// canonical record is ALSO present, so the continuing model has the
		// decisive fact in front of it.
		expect(providerText).toContain("NOT_EXECUTED");
		expect(providerText).toContain("succeeded");
		expect(providerText).toContain("rc=0");
	});
});

// ---------------------------------------------------------------------------
// Conservation: failed and not-run operations are NEVER promoted
// ---------------------------------------------------------------------------

describe("verified tool outcome continuity — failed and not-run operations", () => {
	it("does not carry a FAILED operation as a success", async () => {
		const canonical = [
			userTurn("Render the chart."),
			toolCall("call_failed", "run_commands", { commands: ["helm template"] }),
			toolResult("call_failed", "run_commands", [
				{
					query: "helm template",
					result: "Error: INSTALLATION FAILED",
					success: false,
				},
			]),
			assistantTurn("continuing"),
		];
		const { providerRequest } = await runWrapper({
			canonical,
			compactResult: agenticCompactionResult("summary"),
		});
		const providerText = providerVisibleText(providerRequest);
		expect(providerText).not.toContain("call_failed");
		expect(providerText).not.toContain("succeeded");
	});

	it("does not carry a result whose explicit error flag is set", async () => {
		const canonical = [
			userTurn("Render the chart."),
			toolCall("call_err", "run_commands", { commands: ["helm template"] }),
			toolResult("call_err", "run_commands", [{ text: "boom" }], {
				isError: true,
			}),
			assistantTurn("continuing"),
		];
		const { providerRequest } = await runWrapper({
			canonical,
			compactResult: agenticCompactionResult("summary"),
		});
		expect(providerVisibleText(providerRequest)).not.toContain("call_err");
	});

	it("does not carry a tool CALL with no matching result (not run)", async () => {
		const canonical = [
			userTurn("Render the chart."),
			toolCall("call_never_ran", "run_commands", {
				commands: ["helm template"],
			}),
			assistantTurn("continuing"),
		];
		const { providerRequest } = await runWrapper({
			canonical,
			compactResult: agenticCompactionResult("summary"),
		});
		expect(providerVisibleText(providerRequest)).not.toContain(
			"call_never_ran",
		);
	});

	it("does not carry a result with NO success signal at all", async () => {
		// "No evidence of failure" is not "evidence of success". A result
		// with no signal must not be promoted.
		const canonical = [
			userTurn("Render the chart."),
			toolCall("call_unsignalled", "run_commands", {
				commands: ["helm template"],
			}),
			toolResult("call_unsignalled", "run_commands", [{ text: "some output" }]),
			assistantTurn("continuing"),
		];
		const { providerRequest } = await runWrapper({
			canonical,
			compactResult: agenticCompactionResult("summary"),
		});
		expect(providerVisibleText(providerRequest)).not.toContain(
			"call_unsignalled",
		);
	});

	it("classifies the result status from the RESULT itself", () => {
		expect(classifyToolResultStatus({ content: [{ success: true }] })).toBe(
			"succeeded",
		);
		expect(classifyToolResultStatus({ content: [{ success: false }] })).toBe(
			"failed",
		);
		expect(classifyToolResultStatus({ content: [{ isError: false }] })).toBe(
			"succeeded",
		);
		expect(classifyToolResultStatus({ content: [{ isError: true }] })).toBe(
			"failed",
		);
		expect(classifyToolResultStatus({ content: [{ text: "x" }] })).toBe(
			"unknown",
		);
		expect(classifyToolResultStatus({ content: "plain", is_error: true })).toBe(
			"failed",
		);
	});
});

// ---------------------------------------------------------------------------
// Conservation: mismatched tool ids
// ---------------------------------------------------------------------------

describe("verified tool outcome continuity — mismatched tool ids", () => {
	it("does not attribute a result to a DIFFERENT call", async () => {
		const canonical = [
			userTurn("Render the chart."),
			toolCall("call_a", "run_commands", { commands: ["helm template"] }),
			// The result references an id that has no matching call.
			toolResult("call_b", "run_commands", [
				{ query: "helm template", result: "rc=0", success: true },
			]),
			assistantTurn("continuing"),
		];
		const { providerRequest } = await runWrapper({
			canonical,
			compactResult: agenticCompactionResult("summary"),
		});
		const providerText = providerVisibleText(providerRequest);
		expect(providerText).not.toContain("call_b");
		expect(providerText).not.toContain("rc=0");
	});

	it("does not carry a result for a call that exists but whose id was reused by another call", async () => {
		const canonical = [
			userTurn("Render the chart."),
			toolCall("call_a", "run_commands", { commands: ["helm template"] }),
			toolCall("call_a", "other_tool", { commands: ["x"] }),
			toolResult("call_a", "other_tool", [
				{ query: "x", result: "ok", success: true },
			]),
			assistantTurn("continuing"),
		];
		const ledger = extractVerifiedToolOutcomes(canonical);
		// The FIRST canonical call owns the id.
		expect(ledger.outcomes).toHaveLength(1);
		expect(ledger.outcomes[0].toolName).toBe("run_commands");
	});
});

// ---------------------------------------------------------------------------
// Conservation: repeated compaction
// ---------------------------------------------------------------------------

describe("verified tool outcome continuity — repeated compaction", () => {
	it("keeps exactly ONE evidence section across repeated compactions", async () => {
		const canonical = [
			userTurn("Render the chart and report the effective image."),
			...successfulHelmPair(),
			assistantTurn("continuing"),
		];

		const first = await runWrapper({
			canonical,
			compactResult: agenticCompactionResult("first summary"),
		});
		expect(first.savedStates).toHaveLength(1);
		const firstText = providerVisibleText(first.providerRequest);
		expect(firstText).toContain("rc=0");
		expect(countOccurrences(firstText, EVIDENCE_SECTION_HEADING)).toBe(1);

		const second = await runWrapper({
			canonical,
			existingState: first.savedStates[0],
			compactResult: agenticCompactionResult("second summary"),
		});
		const secondText = providerVisibleText(second.providerRequest);
		expect(secondText).toContain("rc=0");
		expect(countOccurrences(secondText, EVIDENCE_SECTION_HEADING)).toBe(1);

		const third = await runWrapper({
			canonical,
			existingState: second.savedStates[0],
			compactResult: agenticCompactionResult("third summary"),
		});
		const thirdText = providerVisibleText(third.providerRequest);
		expect(thirdText).toContain("rc=0");
		expect(countOccurrences(thirdText, EVIDENCE_SECTION_HEADING)).toBe(1);
	});

	it("replaces a STALE carried section with the current canonical one", async () => {
		// A summary that already carries a section for an outcome the
		// canonical history no longer establishes must not keep it.
		const staleSection = [
			"## Verified tool outcomes (canonical record)",
			"<!-- cline-evidence:begin -->",
			"- run_commands (call_stale): succeeded — rc=0",
			"<!-- cline-evidence:end -->",
		].join("\n");
		const canonical = [
			userTurn("Do something else entirely."),
			assistantTurn("working"),
		];
		const { providerRequest } = await runWrapper({
			canonical,
			compactResult: agenticCompactionResult(`summary body\n\n${staleSection}`),
		});
		const providerText = providerVisibleText(providerRequest);
		expect(providerText).not.toContain("call_stale");
	});
});

// ---------------------------------------------------------------------------
// Conservation: bounded overhead
// ---------------------------------------------------------------------------

describe("verified tool outcome continuity — bounded overhead", () => {
	it("carries at most MAX_CARRIED_OUTCOMES outcomes regardless of transcript length", async () => {
		const canonical: MessageWithMetadata[] = [userTurn("Run many commands.")];
		for (let index = 0; index < 40; index += 1) {
			canonical.push(
				toolCall(`call_${index}`, "run_commands", { commands: [`c${index}`] }),
				toolResult(`call_${index}`, "run_commands", [
					{
						query: `c${index}`,
						result: `rc=0 ${"x".repeat(5_000)}`,
						success: true,
					},
				]),
			);
		}
		const ledger = extractVerifiedToolOutcomes(canonical);
		expect(ledger.outcomes).toHaveLength(MAX_CARRIED_OUTCOMES);
		// The MOST RECENT outcomes are the ones kept.
		expect(ledger.outcomes[ledger.outcomes.length - 1].toolUseId).toBe(
			"call_39",
		);
	});

	it("bounds each carried excerpt to a fixed length", () => {
		const canonical: MessageWithMetadata[] = [
			toolCall("call_big", "run_commands", { commands: ["x"] }),
			toolResult("call_big", "run_commands", [
				{ query: "x", result: "y".repeat(100_000), success: true },
			]),
		];
		const ledger = extractVerifiedToolOutcomes(canonical);
		expect(ledger.outcomes).toHaveLength(1);
		expect(ledger.outcomes[0].excerpt.length).toBeLessThanOrEqual(243);
	});
});

// ---------------------------------------------------------------------------
// Conservation: no credential leakage
// ---------------------------------------------------------------------------

describe("verified tool outcome continuity — credential safety", () => {
	it("redacts credential-shaped values in the carried excerpt", async () => {
		const canonical = [
			userTurn("Log in."),
			toolCall("call_cred", "bash", { command: "login" }),
			toolResult("call_cred", "bash", [
				{
					query: "login",
					result: "DB_PASSWORD=hunter2 API_KEY=sk-abcdefghijklmnopqrstuvwxyz",
					success: true,
				},
			]),
			assistantTurn("continuing"),
		];
		const { providerRequest } = await runWrapper({
			canonical,
			compactResult: agenticCompactionResult("summary"),
		});
		const providerText = providerVisibleText(providerRequest);
		expect(providerText).toContain("[REDACTED]");
		expect(providerText).not.toContain("hunter2");
		expect(providerText).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
	});

	it("redacts bearer tokens and PEM private keys", () => {
		expect(
			sanitizeOutcomeText("Authorization: Bearer abcdefghijklmnop"),
		).toContain("[REDACTED]");
		expect(
			sanitizeOutcomeText(
				"-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----",
			),
		).toContain("[REDACTED PRIVATE KEY]");
	});
});

// ---------------------------------------------------------------------------
// The pure helpers
// ---------------------------------------------------------------------------

describe("verified tool outcome continuity — pure helpers", () => {
	it("is a pure function of the canonical history", () => {
		const canonical = [
			userTurn("Render the chart."),
			...successfulHelmPair(),
			assistantTurn("continuing"),
		];
		const first = extractVerifiedToolOutcomes(canonical);
		const second = extractVerifiedToolOutcomes(canonical);
		expect(first).toEqual(second);
	});

	it("strips and re-applies the section idempotently", () => {
		const ledger = extractVerifiedToolOutcomes([
			toolCall("call_1", "run_commands", { commands: ["x"] }),
			toolResult("call_1", "run_commands", [
				{ query: "x", result: "rc=0", success: true },
			]),
		]);
		const once = applyEvidenceToSummary("body", ledger);
		const twice = applyEvidenceToSummary(once, ledger);
		expect(twice).toBe(once);
		expect(countOccurrences(twice, EVIDENCE_SECTION_HEADING)).toBe(1);
	});

	it("does not rewrite a summary when nothing is verified", () => {
		const ledger = extractVerifiedToolOutcomes([
			userTurn("nothing ran"),
			assistantTurn("working"),
		]);
		expect(applyEvidenceToSummary("body", ledger)).toBe("body");
	});
});
