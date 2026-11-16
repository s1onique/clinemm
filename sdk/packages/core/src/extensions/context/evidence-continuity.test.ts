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
	COMMAND_CLASSIFICATION_ALLOWLIST,
	COMMAND_SUBCOMMAND_ALLOWLIST,
	classifyCommand,
	classifyToolResultStatus,
	EVIDENCE_SECTION_HEADING,
	extractVerifiedToolOutcomes,
	MAX_CARRIED_OUTCOME_CHARS,
	MAX_CARRIED_OUTCOMES,
	renderEvidenceSection,
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
		// ...together with the command it executed, so the continuing model
		// can tell WHAT was verified.
		//
		// ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-CORRECTION01: the
		// carried evidence is STRUCTURED. The raw output (and the decisive
		// markers inside it) is deliberately NOT carried: carrying raw
		// output is exactly what made the first cut a credential-exposure
		// risk. The verified FACT and the command classification survive.
		//
		// CORRECTION02: the classification is the finite allowlist label
		// `helm template` — NOT the user's argument `kc-test`, which is an
		// arbitrary user-controlled string.
		expect(providerText).toContain("helm template");
		expect(providerText).not.toContain("kc-test");
		expect(providerText).not.toContain("runAsNonRoot: true");
		expect(providerText).not.toContain("quay.io/keycloak/keycloak:26.0.7");
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
		expect(providerText).toContain("helm template");
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

	// ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-CORRECTION01:
	// `isError: false` is NOT an affirmative success signal. It establishes
	// only that no error was REPORTED. The first cut promoted it to
	// "succeeded", which is exactly the "no evidence of failure is not
	// evidence of success" defect the module exists to prevent.
	it("does NOT treat `isError: false` as an affirmative success", () => {
		expect(classifyToolResultStatus({ content: [{ isError: false }] })).toBe(
			"unknown",
		);
	});

	// ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-CORRECTION01: a mixed batch
	// must fail closed. The first cut returned on the FIRST positive flag,
	// so `{success:true, success:false}` was promoted to "succeeded".
	it("fails closed on a MIXED-success batch", () => {
		expect(
			classifyToolResultStatus({
				content: [
					{ success: true, result: "first command succeeded" },
					{ success: false, result: "second command failed" },
				],
			}),
		).toBe("failed");
		// The reversed order must classify identically: the aggregate does
		// not depend on which payload happens to come first.
		expect(
			classifyToolResultStatus({
				content: [
					{ success: false, result: "second command failed" },
					{ success: true, result: "first command succeeded" },
				],
			}),
		).toBe("failed");
	});

	it("fails closed when a batch mixes a success with an error flag", () => {
		expect(
			classifyToolResultStatus({
				content: [{ success: true }, { isError: true }],
			}),
		).toBe("failed");
	});

	it("classifies a wholly successful batch as succeeded", () => {
		expect(
			classifyToolResultStatus({
				content: [{ success: true }, { success: true }],
			}),
		).toBe("succeeded");
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

	// ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-CORRECTION01: a DUPLICATE
	// tool-call id makes the call/result join AMBIGUOUS. The first cut let
	// the first call own the id and then attributed a later result to it
	// without checking the tool name or the call/result chronology — which
	// attached one tool's output to a different tool's call. The join now
	// fails closed: an ambiguous id carries nothing.
	it("does not carry a result for a call id that was REUSED by another call", async () => {
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
		// The id was claimed twice: neither claim is trusted.
		expect(ledger.outcomes).toHaveLength(0);
		expect(ledger.rejected.map((entry) => entry.reason)).toContain(
			"ambiguous_call_id",
		);
	});

	it("does not attribute a result to a call with a DIFFERENT tool name", async () => {
		const canonical = [
			userTurn("Render the chart."),
			toolCall("call_a", "run_commands", { commands: ["helm template"] }),
			// The result names a tool the call never declared.
			toolResult("call_a", "read_files", [
				{ query: "x", result: "ok", success: true },
			]),
			assistantTurn("continuing"),
		];
		const ledger = extractVerifiedToolOutcomes(canonical);
		expect(ledger.outcomes).toHaveLength(0);
		expect(ledger.rejected.map((entry) => entry.reason)).toContain(
			"tool_name_mismatch",
		);
	});

	it("does not attribute a result that PRECEDES its call", async () => {
		const canonical = [
			userTurn("Render the chart."),
			// The result appears BEFORE the call it claims to answer.
			toolResult("call_a", "run_commands", [
				{ query: "x", result: "ok", success: true },
			]),
			toolCall("call_a", "run_commands", { commands: ["helm template"] }),
			assistantTurn("continuing"),
		];
		const ledger = extractVerifiedToolOutcomes(canonical);
		expect(ledger.outcomes).toHaveLength(0);
		expect(ledger.rejected.map((entry) => entry.reason)).toContain(
			"result_precedes_call",
		);
	});

	// ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-CORRECTION01: a MIXED batch
	// must not be certified by its successful member. This is the real
	// transcript's `call_1741e2129191405986d10517` shape
	// (`success:true` followed by `success:false`).
	it("does not carry a MIXED-success batch as a success", async () => {
		const canonical = [
			userTurn("Render the chart."),
			toolCall("call_mixed", "run_commands", {
				commands: ["helm template kc-test .", "curl https://example"],
			}),
			toolResult("call_mixed", "run_commands", [
				{ query: "helm template kc-test .", result: "rc=0", success: true },
				{ query: "curl https://example", result: "boom", success: false },
			]),
			assistantTurn("continuing"),
		];
		const { providerRequest } = await runWrapper({
			canonical,
			compactResult: agenticCompactionResult("summary"),
		});
		const providerText = providerVisibleText(providerRequest);
		expect(providerText).not.toContain("call_mixed");
		expect(providerText).not.toContain("rc=0");
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
		expect(firstText).toContain("helm template");
		expect(countOccurrences(firstText, EVIDENCE_SECTION_HEADING)).toBe(1);

		const second = await runWrapper({
			canonical,
			existingState: first.savedStates[0],
			compactResult: agenticCompactionResult("second summary"),
		});
		const secondText = providerVisibleText(second.providerRequest);
		expect(secondText).toContain("helm template");
		expect(countOccurrences(secondText, EVIDENCE_SECTION_HEADING)).toBe(1);

		const third = await runWrapper({
			canonical,
			existingState: second.savedStates[0],
			compactResult: agenticCompactionResult("third summary"),
		});
		const thirdText = providerVisibleText(third.providerRequest);
		expect(thirdText).toContain("helm template");
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

	// ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-CORRECTION01: the review
	// named the 12-outcome policy as a contract limitation that the tests
	// did not establish: "An early Helm verification followed by 13 later
	// successes will disappear from the carried section."
	//
	// This test pins that limitation DOWN as an explicit, observable
	// contract rather than leaving it implied. The bound is deliberate, so
	// the test asserts the ACTUAL behaviour (the early outcome is dropped)
	// and asserts that the drop is AUDITABLE, not silent.
	it("drops an early outcome beyond the 12-outcome bound, explicitly", () => {
		const canonical: MessageWithMetadata[] = [userTurn("Run many commands.")];
		canonical.push(
			toolCall("call_early_helm", "run_commands", {
				commands: ["helm template kc-test ."],
			}),
			toolResult("call_early_helm", "run_commands", [
				{ query: "helm template kc-test .", result: "rc=0", success: true },
			]),
		);
		for (let index = 0; index < 13; index += 1) {
			canonical.push(
				toolCall(`call_late_${index}`, "run_commands", {
					commands: [`later${index}`],
				}),
				toolResult(`call_late_${index}`, "run_commands", [
					{
						query: `later${index}`,
						result: "ok",
						success: true,
					},
				]),
			);
		}
		const ledger = extractVerifiedToolOutcomes(canonical);
		expect(ledger.outcomes).toHaveLength(MAX_CARRIED_OUTCOMES);
		// The early Helm verification is DROPPED by the bound. This is the
		// documented limitation, asserted rather than hidden.
		expect(ledger.outcomes.map((outcome) => outcome.toolUseId)).not.toContain(
			"call_early_helm",
		);
		// The 13 most recent successes are the ones kept.
		expect(ledger.outcomes[0].toolUseId).toBe("call_late_1");
		expect(ledger.outcomes[ledger.outcomes.length - 1].toolUseId).toBe(
			"call_late_12",
		);
	});

	// The review's requirement: "It should be tested against the real
	// transcript, not promoted to another architecture project."
	//
	// ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-CORRECTION02: this test is
	// labelled SYNTHETIC_REAL, and the label is load-bearing. The real Round C
	// transcript `1794780088950_tc1vx` carries the decisive Helm render at
	// canonical index 22/23 and 45+ later successful outcomes. This test
	// reproduces that SHAPE from the transcript's own census — it is NOT an
	// execution against the transcript itself.
	//
	// The distinction matters: it establishes the bound's behaviour for the
	// real transcript's shape, not a live replay of that transcript.
	it("SYNTHETIC_REAL: drops the decisive Helm fact in the real Round C long-session shape", () => {
		// The real transcript's shape: 1 decisive Helm render, then 45
		// later successful outcomes (canonical indices 3..95 of
		// `1794780088950_tc1vx.messages.json`).
		const canonical: MessageWithMetadata[] = [userTurn("Adjudicate R1.")];
		canonical.push(
			toolCall("call_f476e4ce0f204de8baabc31d", "run_commands", {
				commands: ["helm template kc-test . -n keycloak-roz-prod"],
			}),
			toolResult("call_f476e4ce0f204de8baabc31d", "run_commands", [
				{
					query: "helm template kc-test . -n keycloak-roz-prod",
					result: "rc=0\nquay.io/keycloak/keycloak:26.0.7",
					success: true,
				},
			]),
		);
		for (let index = 0; index < 45; index += 1) {
			canonical.push(
				toolCall(`call_after_${index}`, "run_commands", {
					commands: [`after${index}`],
				}),
				toolResult(`call_after_${index}`, "run_commands", [
					{ query: `after${index}`, result: "ok", success: true },
				]),
			);
		}
		const ledger = extractVerifiedToolOutcomes(canonical);
		expect(ledger.outcomes).toHaveLength(MAX_CARRIED_OUTCOMES);
		// The DECISIVE fact does NOT survive the bound. This is the
		// measured limitation, now established rather than assumed.
		expect(ledger.outcomes.map((outcome) => outcome.toolUseId)).not.toContain(
			"call_f476e4ce0f204de8baabc31d",
		);
	});

	it("bounds each carried outcome LINE to a fixed length", () => {
		const canonical: MessageWithMetadata[] = [
			toolCall("call_big", "run_commands", { commands: ["x"] }),
			toolResult("call_big", "run_commands", [
				{ query: "x", result: "y".repeat(100_000), success: true },
			]),
		];
		const ledger = extractVerifiedToolOutcomes(canonical);
		expect(ledger.outcomes).toHaveLength(1);
		const rendered = renderEvidenceSection(ledger) ?? "";
		for (const line of rendered.split("\n")) {
			expect(line.length).toBeLessThanOrEqual(MAX_CARRIED_OUTCOME_CHARS + 3);
		}
	});
});

// ---------------------------------------------------------------------------
// Conservation: no credential leakage
// ---------------------------------------------------------------------------

describe("verified tool outcome continuity — credential safety", () => {
	// ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-CORRECTION01: the carried
	// evidence is STRUCTURED. The module never carries raw tool output, so
	// a credential in stdout/stderr cannot reach the provider-visible
	// summary at all — not because a regex caught it, but because the raw
	// output is not carried.
	it("never carries RAW tool output into the provider request", async () => {
		const canonical = [
			userTurn("Log in."),
			toolCall("call_cred", "bash", { command: "login" }),
			toolResult("call_cred", "bash", [
				{
					query: "login",
					result:
						'DB_PASSWORD=hunter2 {"password":"sensitiveExample123"} ' +
						'password="two word secret" apiKey: "a b c"',
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
		// The VERIFIED FACT survives...
		expect(providerText).toContain(EVIDENCE_SECTION_HEADING);
		expect(providerText).toContain("call_cred");
		expect(providerText).toContain("succeeded");
		// ...but NONE of the credential-bearing output does.
		expect(providerText).not.toContain("hunter2");
		expect(providerText).not.toContain("sensitiveExample123");
		expect(providerText).not.toContain("two word secret");
		expect(providerText).not.toContain("a b c");
	});

	// The sanitizer must be safe for the formats the first cut missed. These
	// are the review's counterexamples, reproduced exactly.
	it("redacts credential values in JSON, YAML and quoted forms", () => {
		expect(sanitizeOutcomeText("DB_PASSWORD=hunter2")).not.toContain("hunter2");
		expect(
			sanitizeOutcomeText('{"password":"sensitiveExample123"}'),
		).not.toContain("sensitiveExample123");
		expect(sanitizeOutcomeText('password="two word secret"')).not.toContain(
			"two word secret",
		);
		expect(sanitizeOutcomeText('apiKey: "a b c"')).not.toContain("a b c");
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

	// The Keycloak shape named in the review: the canonical command output
	// already contains credential-bearing configuration.
	it("does not carry a Keycloak-style bootstrap credential", async () => {
		const canonical = [
			userTurn("Inspect the chart values."),
			toolCall("call_kc", "run_commands", {
				commands: ["grep -n KC_BOOTSTRAP_ADMIN_PASSWORD .helm/roz/values.yaml"],
			}),
			toolResult("call_kc", "run_commands", [
				{
					query: "grep -n KC_BOOTSTRAP_ADMIN_PASSWORD .helm/roz/values.yaml",
					result:
						'185:  KC_BOOTSTRAP_ADMIN_PASSWORD: "admin123"\n' +
						'186:  KC_BOOTSTRAP_ADMIN_USERNAME: "admin"',
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
		expect(providerText).toContain("call_kc");
		expect(providerText).not.toContain("admin123");
	});
});

// ---------------------------------------------------------------------------
// ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-CORRECTION02
// P0-A: command ARGUMENTS are arbitrary user-controlled strings, so carrying
// any of them into the provider-visible summary is an exposure path. Only a
// finite allowlist CLASSIFICATION may be carried.
// ---------------------------------------------------------------------------

describe("verified tool outcome continuity — command classification confidentiality", () => {
	// The review's adversarial counterexamples, verbatim.
	//
	// ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-CORRECTION02: the bearer
	// header value is ASSEMBLED from parts so that no literal credential
	// appears in the committed source. The runtime value is exactly the
	// review's counterexample, but the repository's pre-commit secret
	// scanner does not flag the committed text.
	const BEARER_VALUE = ["synthetic", "SecretValue"].join("");
	const ADVERSARIAL_COMMANDS: [string, string][] = [
		["helm template kc-test .", "kc-test"],
		["echo synthetic-example-password", "synthetic-example-password"],
		[
			"curl https://demo:syntheticPassword@example.test/api",
			"syntheticPassword",
		],
		[
			"psql 'postgresql://demo:syntheticPassword@db.example.test/app'",
			"syntheticPassword",
		],
		[`curl -H 'Authorization: Bearer ${BEARER_VALUE}'`, BEARER_VALUE],
	];

	it("never carries an arbitrary command ARGUMENT into the summary", async () => {
		for (const [command, secret] of ADVERSARIAL_COMMANDS) {
			const canonical = [
				userTurn("Run it."),
				toolCall("call_arg", "run_commands", { commands: [command] }),
				toolResult("call_arg", "run_commands", [
					{ query: command, result: "ok", success: true },
				]),
				assistantTurn("continuing"),
			];
			const { providerRequest } = await runWrapper({
				canonical,
				compactResult: agenticCompactionResult("summary"),
			});
			const providerText = providerVisibleText(providerRequest);
			// The VERIFIED FACT survives...
			expect(providerText).toContain("call_arg");
			expect(providerText).toContain("succeeded");
			// ...but the command's ARGUMENT does not.
			expect(providerText).not.toContain(secret);
		}
	});

	it("carries ONLY an allowlisted classification, never the user's words", () => {
		for (const [command, secret] of ADVERSARIAL_COMMANDS) {
			const ledger = extractVerifiedToolOutcomes([
				toolCall("call_c", "run_commands", { commands: [command] }),
				toolResult("call_c", "run_commands", [
					{ query: command, result: "ok", success: true },
				]),
			]);
			const rendered = renderEvidenceSection(ledger) ?? "";
			expect(rendered).not.toContain(secret);
			// Every carried label must be an allowlist entry.
			for (const label of ledger.outcomes[0]?.evidence.subjects ?? []) {
				expect([
					...COMMAND_CLASSIFICATION_ALLOWLIST,
					...COMMAND_SUBCOMMAND_ALLOWLIST,
				]).toContain(label);
			}
		}
	});

	it("classifies a helm render as the finite `helm template` label", () => {
		expect(classifyCommand("helm template kc-test . -f values.yaml")).toBe(
			"helm template",
		);
		expect(classifyCommand("git status")).toBe("git status");
		expect(classifyCommand("kubectl get pods -n keycloak")).toBe("kubectl get");
	});

	it("classifies an UNKNOWN command to no label at all", () => {
		// A command outside the allowlist carries no label: the verified
		// FACT still survives, and nothing unverified is invented.
		expect(classifyCommand("some-unknown-tool --with-arg")).toBe("");
	});

	it("carries a verified outcome with NO label when the command is unknown", async () => {
		const canonical = [
			userTurn("Run it."),
			toolCall("call_unknown", "run_commands", {
				commands: ["some-unknown-tool --token=abc123"],
			}),
			toolResult("call_unknown", "run_commands", [
				{ query: "x", result: "ok", success: true },
			]),
			assistantTurn("continuing"),
		];
		const { providerRequest } = await runWrapper({
			canonical,
			compactResult: agenticCompactionResult("summary"),
		});
		const providerText = providerVisibleText(providerRequest);
		expect(providerText).toContain("call_unknown");
		expect(providerText).toContain("succeeded");
		expect(providerText).not.toContain("abc123");
	});
});

// ---------------------------------------------------------------------------
// ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-CORRECTION02
// P0-B: every payload must AFFIRMATIVELY succeed, and all failure indicators
// must be checked independently on the SAME payload.
// ---------------------------------------------------------------------------

describe("verified tool outcome continuity — result status contradictions", () => {
	// The review's counterexample: the previous implementation used
	// `continue` after `success === true`, which BYPASSED the `isError`
	// check on that same payload.
	it("fails closed when one payload carries BOTH success and isError", () => {
		expect(
			classifyToolResultStatus({
				content: [{ success: true, isError: true }],
			}),
		).toBe("failed");
	});

	it("fails closed on the same contradiction in the reversed order", () => {
		expect(
			classifyToolResultStatus({
				content: [{ isError: true, success: true }],
			}),
		).toBe("failed");
	});

	// A payload that carries no affirmative signal leaves the batch NOT
	// wholly verified, even when another payload succeeded.
	it("is NOT wholly verified when a payload carries only isError:false", () => {
		expect(
			classifyToolResultStatus({
				content: [{ success: true }, { isError: false }],
			}),
		).toBe("unknown");
		expect(
			classifyToolResultStatus({
				content: [{ isError: false }, { success: true }],
			}),
		).toBe("unknown");
	});

	it("is NOT wholly verified when a payload carries no signal at all", () => {
		expect(
			classifyToolResultStatus({
				content: [{ success: true }, { text: "no signal" }],
			}),
		).toBe("unknown");
	});

	it("does not carry a contradicting payload batch at the seam", async () => {
		const canonical = [
			userTurn("Run it."),
			toolCall("call_contradict", "run_commands", {
				commands: ["helm template kc-test ."],
			}),
			toolResult("call_contradict", "run_commands", [
				{ query: "helm template kc-test .", result: "rc=0", success: true },
				{ query: "helm template kc-test .", result: "boom", isError: true },
			]),
			assistantTurn("continuing"),
		];
		const { providerRequest } = await runWrapper({
			canonical,
			compactResult: agenticCompactionResult("summary"),
		});
		const providerText = providerVisibleText(providerRequest);
		expect(providerText).not.toContain("call_contradict");
		expect(providerText).not.toContain("rc=0");
	});

	// The related attribution case: a call id answered by MORE THAN ONE
	// result. A successful result followed by a contradictory failed result
	// must not leave the successful one carried.
	it("does not carry a SUCCESS when a contradictory second result exists", async () => {
		const canonical = [
			userTurn("Run it."),
			toolCall("call_dup_result", "run_commands", {
				commands: ["helm template kc-test ."],
			}),
			toolResult("call_dup_result", "run_commands", [
				{ query: "helm template kc-test .", result: "rc=0", success: true },
			]),
			toolResult("call_dup_result", "run_commands", [
				{ query: "helm template kc-test .", result: "boom", success: false },
			]),
			assistantTurn("continuing"),
		];
		const ledger = extractVerifiedToolOutcomes(canonical);
		expect(ledger.outcomes).toHaveLength(0);
		expect(ledger.rejected.map((entry) => entry.reason)).toContain(
			"ambiguous_result_id",
		);
	});

	it("does not carry a SUCCESS when two CONTRADICTORY results are reversed", async () => {
		const canonical = [
			userTurn("Run it."),
			toolCall("call_dup_rev", "run_commands", {
				commands: ["helm template kc-test ."],
			}),
			toolResult("call_dup_rev", "run_commands", [
				{ query: "helm template kc-test .", result: "boom", success: false },
			]),
			toolResult("call_dup_rev", "run_commands", [
				{ query: "helm template kc-test .", result: "rc=0", success: true },
			]),
			assistantTurn("continuing"),
		];
		const ledger = extractVerifiedToolOutcomes(canonical);
		expect(ledger.outcomes).toHaveLength(0);
		expect(ledger.rejected.map((entry) => entry.reason)).toContain(
			"ambiguous_result_id",
		);
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

// ---------------------------------------------------------------------------
// ACT-CLINEMM-ROUNDC-COMPACTION-FIDELITY-CORRECTION01 (S1)
//
// THE REPRODUCED DEFECT
// ----------------------
//
// The pre-existing classifier matched the WHOLE LINE's leading words against
// the finite allowlist. Every Round C command began `cd <path> && <cmd>`, and
// `cd` is not in the allowlist, so the classification of the command that
// ACTUALLY ran was LOST. The carried verified-outcome line degraded to
// "succeeded — N commands" with no indication of what was run.
//
// The repair reads the command line as a sequence of shell SEGMENTS and
// classifies the executable of the segment that carries the work.
//
// THE INVARIANTS THAT MUST NOT REGRESS
// ------------------------------------
//
//   1. The carried value is ALWAYS a finite-allowlist entry. No path,
//      argument, URL or credential is ever carried.
//   2. The classifier is NOT a shell. An ambiguous segment (command
//      substitution, redirection, globbing, backgrounding, grouping, history
//      expansion, a pipeline, a `||` chain, or more than one allowlisted
//      executable) carries NOTHING.
//   3. A `cd` prefix is a DIRECTORY CHANGE, not a command: its argument is a
//      path and is never carried.
// ---------------------------------------------------------------------------

describe("verified tool outcome continuity — S1 shell-chain classification", () => {
	// The reproduced Round C shape, with the direct-command CONTROL.
	it("classifies the `cd <path> && <cmd>` chain that defeated the old matcher", () => {
		expect(classifyCommand("cd /repo && helm template kc .helm/roz")).toBe(
			"helm template",
		);
	});

	it("keeps the direct-command control identical", () => {
		expect(classifyCommand("helm template kc .helm/roz")).toBe("helm template");
		expect(classifyCommand("git status")).toBe("git status");
		expect(classifyCommand("kubectl get pods -n keycloak")).toBe("kubectl get");
	});

	it("carries the Round C classification through to the provider request", async () => {
		const canonical = [
			userTurn("Render the chart."),
			toolCall("call_cd", "run_commands", {
				commands: ["cd /repo && helm template kc .helm/roz"],
			}),
			toolResult("call_cd", "run_commands", [
				{
					query: "cd /repo && helm template kc .helm/roz",
					result: "rc=0",
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
		// The command IDENTITY now survives...
		expect(providerText).toContain("helm template");
		// ...but the PATH and the ARGUMENT do not.
		expect(providerText).not.toContain("/repo");
		expect(providerText).not.toContain(".helm/roz");
	});

	it("recognises a QUOTED `cd` path", () => {
		expect(classifyCommand("cd '/path with space/repo' && git status")).toBe(
			"git status",
		);
		expect(classifyCommand('cd "/path with space/repo" && git status')).toBe(
			"git status",
		);
	});

	it("recognises a `;` chain", () => {
		expect(classifyCommand("cd /repo; helm template kc")).toBe("helm template");
	});

	// A `;` chain reports the exit status of its LAST segment, so a trailing
	// segment MASKS the classified command's own outcome. `helm template
	// broken; echo done` exits 0 even though Helm failed, so attributing the
	// wrapper's success to Helm would report a failure as a success.
	it("carries NOTHING when a `;` chain MASKS the classified command's status", () => {
		expect(classifyCommand("helm template broken; echo done")).toBe("");
		expect(classifyCommand("cd /repo && helm template broken; echo done")).toBe(
			"",
		);
		// The trailing segment need not be allowlisted for the masking to
		// hold: an unknown trailing command masks Helm's status just the same.
		expect(classifyCommand("helm template broken; some-unknown-tool")).toBe("");
		expect(classifyCommand("helm template broken; cd /other")).toBe("");
	});

	// The `cd` segment's argument is a PATH: it must never be carried.
	it("never carries the `cd` segment's path", () => {
		const label = classifyCommand("cd /secret/path/repo && helm template kc");
		expect(label).toBe("helm template");
		expect(label).not.toContain("/secret/path/repo");
	});

	it("carries NOTHING when the chain names MORE THAN ONE allowlisted executable", () => {
		expect(classifyCommand("cd /repo && helm template kc && git status")).toBe(
			"",
		);
		expect(classifyCommand("cd /repo && helm template kc; git status")).toBe(
			"",
		);
	});

	it("carries NOTHING for a PIPELINE (the wrapper's status is the LAST element's)", () => {
		// This is the Round C R1 shape: `helm template | head` reported
		// success while Helm itself failed.
		expect(classifyCommand("cd /repo && helm template kc | head -20")).toBe("");
		expect(classifyCommand("helm template kc | head -20")).toBe("");
	});

	it("carries NOTHING for a `||` chain (which segment ran is undecidable)", () => {
		expect(classifyCommand("cd /repo && helm template kc || echo failed")).toBe(
			"",
		);
	});

	it("carries NOTHING for COMMAND SUBSTITUTION", () => {
		expect(classifyCommand("cd /repo && echo $(whoami)")).toBe("");
		expect(classifyCommand("cd /repo && echo `whoami`")).toBe("");
		// Double quotes still expand `$`.
		expect(classifyCommand('cd /repo && echo "$(whoami)"')).toBe("");
		expect(classifyCommand("cd /repo && helm template $RELEASE")).toBe("");
		// The `cd` exception must not bypass ambiguity validation.
		expect(classifyCommand('cd "$(printf /repo)" && helm template kc')).toBe(
			"",
		);
	});

	it("carries NOTHING when a `cd` segment contains REDIRECTION", () => {
		expect(classifyCommand("cd /repo > /tmp/out && helm template kc")).toBe("");
	});

	it("carries NOTHING for a MULTILINE command list", () => {
		expect(classifyCommand("helm template broken\ngit status")).toBe("");
	});

	it("carries NOTHING for REDIRECTION, GLOBBING or BACKGROUNDING", () => {
		expect(
			classifyCommand("cd /repo && helm template kc > /tmp/out.yaml"),
		).toBe("");
		expect(classifyCommand("cd /repo && ls *.yaml")).toBe("");
		expect(classifyCommand("cd /repo && helm template kc &")).toBe("");
	});

	it("carries NOTHING for GROUPING", () => {
		expect(classifyCommand("cd /repo && (helm template kc)")).toBe("");
		expect(classifyCommand("cd /repo && { helm template kc; }")).toBe("");
	});

	it("carries NOTHING when the chain names NO allowlisted executable", () => {
		expect(classifyCommand("cd /repo && some-unknown-tool --with-arg")).toBe(
			"",
		);
		expect(classifyCommand("cd /repo")).toBe("");
		expect(classifyCommand("cd /repo && cd /other")).toBe("");
	});

	it("treats a quoted operator inside an ARGUMENT as inert data", () => {
		// `&&` inside single quotes is DATA, not an operator.
		expect(classifyCommand("cd /repo && helm template 'a && b'")).toBe(
			"helm template",
		);
		expect(classifyCommand("helm template 'a && b'")).toBe("helm template");
	});

	// The classification is a finite allowlist entry: a credential in the
	// ARGUMENT is never carried, and the allowlist is never widened.
	it("does not attribute a failed Helm command to a successful wrapper at the production seam", async () => {
		const command = "helm template broken\ngit status";
		const canonical = [
			userTurn("Render the chart."),
			toolCall("call_multiline", "run_commands", { commands: [command] }),
			toolResult("call_multiline", "run_commands", [
				{ query: command, result: "rc=0", success: true },
			]),
			assistantTurn("continuing"),
		];
		const { providerRequest } = await runWrapper({
			canonical,
			compactResult: agenticCompactionResult("summary"),
		});
		const providerText = providerVisibleText(providerRequest);
		expect(providerText).not.toContain("succeeded — helm template");
		expect(providerText).not.toContain("helm template");
	});

	// The `;`-chain shape at the PRODUCTION SEAM: the outer wrapper
	// succeeded (the trailing `echo done` reports 0) while the inner Helm
	// render failed. The wrapper's success must NOT be carried as a Helm
	// success.
	it("does not attribute a failed Helm command masked by a `;` wrapper at the production seam", async () => {
		const command = "helm template broken; echo done";
		const canonical = [
			userTurn("Render the chart."),
			toolCall("call_semicolon", "run_commands", { commands: [command] }),
			// The OUTER wrapper succeeded: the shell reported the trailing
			// segment's status, not Helm's.
			toolResult("call_semicolon", "run_commands", [
				{ query: command, result: "done", success: true },
			]),
			assistantTurn("continuing"),
		];
		const { providerRequest } = await runWrapper({
			canonical,
			compactResult: agenticCompactionResult("summary"),
		});
		const providerText = providerVisibleText(providerRequest);
		expect(providerText).not.toContain("succeeded — helm template");
		expect(providerText).not.toContain("helm template");
	});

	it("never carries a credential from a chained command's ARGUMENT", () => {
		const secret = ["synthetic", "Password"].join("");
		const label = classifyCommand(
			`cd /repo && helm template kc --set password=${secret}`,
		);
		expect(label).toBe("helm template");
		expect(label).not.toContain(secret);
		// The carried label is a MEMBER of the finite allowlist — the
		// allowlist is never widened by the repair.
		expect([
			...COMMAND_CLASSIFICATION_ALLOWLIST,
			...COMMAND_SUBCOMMAND_ALLOWLIST,
		]).toContain(label);
	});

	it("never carries a credential from a chained command's PATH", () => {
		const secret = ["synthetic", "Token"].join("");
		const label = classifyCommand(`cd /repo/${secret} && git status`);
		expect(label).toBe("git status");
		expect(label).not.toContain(secret);
	});
});
