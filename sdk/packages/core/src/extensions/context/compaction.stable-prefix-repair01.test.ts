/**
 * ACT-CLINEMM-COMPACTION-STABLE-PREFIX-REPAIR-01
 *
 * Permanent regression suite for the STABLE PROMPT PREFIX after a compaction.
 *
 * THE DEFECT
 * ----------
 *
 * After a compaction, the provider-visible compaction summary — the FIRST
 * message of every request — was rewritten on almost every continuation,
 * even though the canonical history only ever GREW. The rewrite came from
 * `applyVerifiedEvidenceToCompactedMessages()`, which re-derived the
 * verified-outcome section from the ENTIRE canonical history and replaced
 * the section in place.
 *
 * The summary sits at the HEAD of the model-facing context, so a prompt cache
 * can only reuse a checkpoint over an UNCHANGED prefix. Rewriting it
 * invalidated every deeper checkpoint.
 *
 * THE REPAIR
 * ----------
 *
 * The carried section is derived from the canonical history AS IT WAS AT THE
 * SOURCE BOUNDARY, not from the growing canonical history. The boundary does
 * not move when the transcript grows, so the summary is byte-identical across
 * every continuation.
 *
 * WHAT MUST STILL HOLD
 * --------------------
 *
 *   1. The already-published summary stays byte-identical.
 *   2. The model still receives the REQUIRED CURRENT verified outcomes.
 *   3. Canonical history remains authoritative.
 *   4. Sidecar and resume semantics remain valid.
 *   5. Request-budget enforcement remains fail-closed.
 *
 * Point 2 is the one that makes a naive "just stop carrying evidence" repair
 * WRONG: the negative control in this suite removes the post-boundary
 * verified evidence from the model-visible request and asserts that the
 * evidence-continuity assertion FAILS. A repair that achieved prefix
 * stability by SUPPRESSING evidence would make that control pass, and this
 * suite would catch it.
 *
 * THE SEAMS
 * ---------
 *
 * Every scenario drives the REAL production boundary:
 *
 *   createCompactionStateAwarePrepareTurn()  (the state-aware wrapper)
 *     -> projectSessionCompactionState()     (the real projector)
 *     -> applyTaskContractToCompactedMessages()  (the real contract seam)
 *     -> applyVerifiedEvidenceToCompactedMessages() (the real evidence seam)
 *     -> MessageBuilder.buildForApi()        (the real provider-request seam)
 */

import type { MessageWithMetadata } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import {
	countCanonicalSourceMessages,
	createSessionCompactionState,
	projectSessionCompactionState,
	type SessionCompactionState,
} from "../../session/models/session-compaction";
import { MessageBuilder } from "../../session/services/message-builder";
import {
	type ContextPipelinePrepareTurn,
	createCompactionStateAwarePrepareTurn,
} from "./compaction";
import {
	applyVerifiedEvidenceToCompactedMessages,
	EVIDENCE_REFERENCE_ALIAS_PREFIX,
	EVIDENCE_SECTION_HEADING,
	inferCompactionSourceBoundary,
} from "./evidence-continuity";

const MODEL = {
	id: "mock-model",
	provider: "anthropic",
	info: { id: "mock-model", maxInputTokens: 100_000 },
} as const;

const SYSTEM_PROMPT = "You are a helpful coding assistant.";

// ---------------------------------------------------------------------------
// Fixtures
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

/** A SUCCESSFUL canonical call/result pair in the production payload shape. */
function successfulPair(id: string, command: string): MessageWithMetadata[] {
	return [
		toolCall(id, "run_commands", { commands: [command] }),
		toolResult(id, "run_commands", [
			{ query: command, result: "ok", success: true },
		]),
	];
}

/** The compaction summary the production summarizer installs. */
function compactionSummaryMessage(summaryText: string): MessageWithMetadata {
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

const SUMMARY_PROSE = [
	"## Goal",
	"Adjudicate the findings.",
	"## State",
	"- Done: read the repository.",
].join("\n");

/** The summary text carried by a projected message list. */
function projectedSummaryText(
	messages: readonly MessageWithMetadata[],
): string {
	const summary = messages.find(
		(message) =>
			(message.metadata as { kind?: string } | undefined)?.kind ===
			"compaction_summary",
	);
	const metadata = summary?.metadata as { summary?: string } | undefined;
	return metadata?.summary ?? "";
}

/** The provider-visible text of a prepared request. */
function providerVisibleText(messages: readonly unknown[]): string {
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

/**
 * The provider-visible ASSERTED SUCCESS signal per tool-call id.
 *
 * `true` means the visible result body carries the affirmative
 * `success: true` payload. This is the model-visible form of the verified
 * outcome: the model can distinguish a SUCCESS from a merely submitted
 * command.
 */
function providerVisibleSuccessSignals(
	messages: readonly unknown[],
): Map<string, boolean> {
	const signals = new Map<string, boolean>();
	for (const message of messages) {
		const content = (message as { content?: unknown }).content;
		if (!Array.isArray(content)) {
			continue;
		}
		for (const block of content) {
			const record = block as Record<string, unknown>;
			if (record.type !== "tool_result") {
				continue;
			}
			const toolUseId = String(record.tool_use_id ?? "");
			const body = JSON.stringify(record.content ?? "");
			signals.set(toolUseId, body.includes('"success":true'));
		}
	}
	return signals;
}

/**
 * ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01
 *
 * The carried outcome LINES in a published section.
 *
 * ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01: the section publishes
 * one line per carried outcome, and each line carries an OPAQUE,
 * PUBLICATION-LOCAL alias rather than the canonical tool-call id.
 *
 * The controls below count these lines so that they stay NON-VACUOUS: an
 * assertion of the form "the canonical id is absent" would now pass for
 * the WRONG reason — the id is absent from every published section,
 * carried or not — and it would no longer distinguish "the outcome was
 * carried" from "the outcome was dropped".
 */
function carriedOutcomeLines(text: string): string[] {
	return text
		.split("\n")
		.filter(
			(line) =>
				line.startsWith("- ") &&
				line.includes(`(${EVIDENCE_REFERENCE_ALIAS_PREFIX}-`),
		);
}

/**
 * The number of `tool_result` blocks in the provider-visible request.
 *
 * The canonical tail is the carrier for POST-boundary outcomes. A boundary
 * outcome is carried by the summary SECTION instead, so this count is how a
 * test distinguishes "carried by the section" from "carried by the tail" —
 * and how it detects a DUPLICATED outcome presented twice as two
 * independent verified outcomes.
 */
function canonicalTailToolResultCount(messages: readonly unknown[]): number {
	let count = 0;
	for (const message of messages) {
		const content = (message as { content?: unknown }).content;
		if (!Array.isArray(content)) {
			continue;
		}
		for (const block of content) {
			if ((block as Record<string, unknown>).type === "tool_result") {
				count += 1;
			}
		}
	}
	return count;
}

interface WrapperRun {
	prepared: Awaited<ReturnType<ContextPipelinePrepareTurn>>;
	providerRequest: MessageWithMetadata[];
	savedStates: SessionCompactionState[];
}

/**
 * Drive the REAL production prepare-turn boundary.
 *
 * `prepareApiMessages` is the identity here because the test asserts on the
 * MESSAGE list the production pipeline returns; the provider-request shape is
 * then produced by the REAL `MessageBuilder.buildForApi()` below.
 */
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
	const providerRequest = new MessageBuilder().buildForApi(
		prepared?.messages ?? input.canonical,
	);
	return { prepared, providerRequest, savedStates };
}

/** A persisted sidecar over a canonical prefix, built by the REAL builder. */
function persistedState(
	canonical: readonly MessageWithMetadata[],
	summaryText: string = SUMMARY_PROSE,
): SessionCompactionState {
	return createSessionCompactionState({
		sourceMessages: canonical,
		compactedMessages: [compactionSummaryMessage(summaryText)],
		conversationId: "conv-1",
		systemPrompt: SYSTEM_PROMPT,
		updatedAt: new Date(0).toISOString(),
	});
}

// ---------------------------------------------------------------------------
// G4 / G6 — the stable prefix
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-COMPACTION-STABLE-PREFIX-REPAIR-01 — the stable prefix", () => {
	/** The canonical history at the compaction boundary. */
	const h0: MessageWithMetadata[] = [
		userTurn("Adjudicate the ten findings."),
		...successfulPair("call_sp_a", "echo alpha"),
		assistantTurn("continuing"),
	];

	it("keeps the provider-visible summary byte-identical across an append-only verified outcome", async () => {
		const state = persistedState(h0);
		const h1: MessageWithMetadata[] = [
			...h0,
			...successfulPair("call_sp_b", "echo bravo"),
		];

		const before = await runWrapper({ canonical: h0, existingState: state });
		const after = await runWrapper({ canonical: h1, existingState: state });

		expect(projectedSummaryText(after.prepared?.messages ?? [])).toBe(
			projectedSummaryText(before.prepared?.messages ?? []),
		);
	});

	it("keeps the provider-visible summary byte-identical across SEVERAL successive verified outcomes", async () => {
		const state = persistedState(h0);
		const h1: MessageWithMetadata[] = [
			...h0,
			...successfulPair("call_sp_b", "echo bravo"),
		];
		const h2: MessageWithMetadata[] = [
			...h1,
			...successfulPair("call_sp_c", "echo charlie"),
		];
		const h3: MessageWithMetadata[] = [
			...h2,
			...successfulPair("call_sp_d", "echo delta"),
		];

		const texts: string[] = [];
		for (const canonical of [h0, h1, h2, h3]) {
			const run = await runWrapper({ canonical, existingState: state });
			texts.push(projectedSummaryText(run.prepared?.messages ?? []));
		}
		expect(texts[1]).toBe(texts[0]);
		expect(texts[2]).toBe(texts[0]);
		expect(texts[3]).toBe(texts[0]);
	});

	it("keeps the summary byte-length stable too, so a length-neutral rewrite cannot hide", async () => {
		const state = persistedState(h0);
		const h1: MessageWithMetadata[] = [
			...h0,
			...successfulPair("call_sp_len", "echo 11111"),
		];
		const before = await runWrapper({ canonical: h0, existingState: state });
		const after = await runWrapper({ canonical: h1, existingState: state });
		const beforeText = projectedSummaryText(before.prepared?.messages ?? []);
		const afterText = projectedSummaryText(after.prepared?.messages ?? []);
		expect(afterText).toBe(beforeText);
		expect(afterText.length).toBe(beforeText.length);
	});

	it("introduces NO extra provider-visible message when nothing is appended", async () => {
		const state = persistedState(h0);
		const first = await runWrapper({ canonical: h0, existingState: state });
		const second = await runWrapper({ canonical: h0, existingState: state });
		expect(second.providerRequest.length).toBe(first.providerRequest.length);
		expect(projectedSummaryText(second.prepared?.messages ?? [])).toBe(
			projectedSummaryText(first.prepared?.messages ?? []),
		);
	});

	it("leaves the persisted sidecar unmodified by a read-only projection", async () => {
		const state = persistedState(h0);
		const before = JSON.stringify(state);
		const h1: MessageWithMetadata[] = [
			...h0,
			...successfulPair("call_sp_sidecar", "echo bravo"),
		];
		await runWrapper({ canonical: h1, existingState: state });
		expect(JSON.stringify(state)).toBe(before);
	});
});

// ---------------------------------------------------------------------------
// G5 — the evidence is NOT suppressed
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-COMPACTION-STABLE-PREFIX-REPAIR-01 — the evidence survives", () => {
	const h0: MessageWithMetadata[] = [
		userTurn("Adjudicate the ten findings."),
		...successfulPair("call_ev_a", "echo alpha"),
		assistantTurn("continuing"),
	];

	it("keeps the model-visible ASSERTED SUCCESS signal for a post-boundary outcome", async () => {
		const state = persistedState(h0);
		const h1: MessageWithMetadata[] = [
			...h0,
			...successfulPair("call_ev_b", "echo bravo"),
		];
		const run = await runWrapper({ canonical: h1, existingState: state });
		const signals = providerVisibleSuccessSignals(run.providerRequest);
		// The post-boundary outcome is model-visible AND carries the
		// affirmative success signal.
		expect(signals.get("call_ev_b")).toBe(true);
		// The boundary-verified outcome is model-visible too — through the
		// SUMMARY's carried section, because the compacted prefix that held
		// its raw result is replaced by the summary.
		// ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01: the carried
		// outcome publishes an OPAQUE, PUBLICATION-LOCAL alias rather than
		// the canonical tool-call id, so the control counts the carried
		// LINES rather than looking for the raw id.
		expect(
			carriedOutcomeLines(providerVisibleText(run.providerRequest)),
		).toHaveLength(1);
	});

	it("keeps the boundary-verified outcome carried in the summary section", async () => {
		const state = persistedState(h0);
		const h1: MessageWithMetadata[] = [
			...h0,
			...successfulPair("call_ev_c", "echo bravo"),
		];
		const run = await runWrapper({ canonical: h1, existingState: state });
		const text = projectedSummaryText(run.prepared?.messages ?? []);
		expect(text).toContain(EVIDENCE_SECTION_HEADING);
		// ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01: the carried
		// outcome publishes an OPAQUE, PUBLICATION-LOCAL alias rather than
		// the canonical tool-call id, so the control counts the carried
		// LINES rather than looking for the raw id.
		expect(carriedOutcomeLines(text)).toHaveLength(1);
	});

	it("keeps the task contract visible", async () => {
		const state = persistedState(h0);
		const h1: MessageWithMetadata[] = [
			...h0,
			...successfulPair("call_ev_d", "echo bravo"),
		];
		const run = await runWrapper({ canonical: h1, existingState: state });
		const text = projectedSummaryText(run.prepared?.messages ?? []);
		expect(text).toContain("Adjudicate the ten findings.");
	});

	it("NEGATIVE CONTROL: removing the post-boundary evidence makes the evidence-continuity assertion FAIL", async () => {
		const state = persistedState(h0);
		const h1: MessageWithMetadata[] = [
			...h0,
			...successfulPair("call_ev_neg", "echo bravo"),
		];
		const run = await runWrapper({ canonical: h1, existingState: state });

		// The DISPOSABLE control: strip EVERY tool result from the
		// model-visible request, exactly as a "repair" that suppressed the
		// evidence would.
		const stripped = run.providerRequest
			.map((message) => {
				const content = (message as { content?: unknown }).content;
				if (!Array.isArray(content)) {
					return message;
				}
				const kept = content.filter(
					(block) => (block as { type?: string }).type !== "tool_result",
				);
				return kept.length === content.length
					? message
					: { ...(message as object), content: kept };
			})
			.filter((message) => {
				const content = (message as { content?: unknown }).content;
				return !Array.isArray(content) || content.length > 0;
			});
		const signals = providerVisibleSuccessSignals(stripped);
		// The post-boundary outcome is NO LONGER model-visible as a verified
		// success: the evidence-continuity assertion FAILS.
		expect(signals.get("call_ev_neg")).toBeUndefined();
		// ...which is exactly why the positive assertion above matters.
		expect(signals.get("call_ev_neg")).not.toBe(true);
	});

	it("POSITIVE CONTROL: with NO verified outcome added, the provider-visible prefix is unchanged and NO message is introduced", async () => {
		const state = persistedState(h0);
		const first = await runWrapper({ canonical: h0, existingState: state });
		const second = await runWrapper({ canonical: h0, existingState: state });
		expect(second.providerRequest.length).toBe(first.providerRequest.length);
		expect(JSON.stringify(second.providerRequest)).toBe(
			JSON.stringify(first.providerRequest),
		);
	});
});

// ---------------------------------------------------------------------------
// C1 / C3 / C4 / C5 — the conservation controls
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-COMPACTION-STABLE-PREFIX-REPAIR-01 — conservation", () => {
	it("does not promote a FAILED post-boundary outcome", async () => {
		const h0: MessageWithMetadata[] = [
			userTurn("Run the check."),
			assistantTurn("working"),
		];
		const state = persistedState(h0);
		const h1: MessageWithMetadata[] = [
			...h0,
			toolCall("call_cf", "run_commands", { commands: ["echo x"] }),
			toolResult("call_cf", "run_commands", [
				{ query: "echo x", result: "boom", success: false },
			]),
		];
		const run = await runWrapper({ canonical: h1, existingState: state });
		const signals = providerVisibleSuccessSignals(run.providerRequest);
		expect(signals.get("call_cf")).toBe(false);
		const text = projectedSummaryText(run.prepared?.messages ?? []);
		// ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01: the outcome is
		// NOT carried, so there is no carried line for it.
		expect(carriedOutcomeLines(text)).toHaveLength(0);
	});

	it("does not promote an UNPAIRED post-boundary call", async () => {
		const h0: MessageWithMetadata[] = [
			userTurn("Run the check."),
			assistantTurn("working"),
		];
		const state = persistedState(h0);
		const h1: MessageWithMetadata[] = [
			...h0,
			toolCall("call_cu", "run_commands", { commands: ["echo x"] }),
		];
		const run = await runWrapper({ canonical: h1, existingState: state });
		const text = projectedSummaryText(run.prepared?.messages ?? []);
		// ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01: the outcome is
		// NOT carried, so there is no carried line for it.
		expect(carriedOutcomeLines(text)).toHaveLength(0);
	});

	it("conserves the multi-command outcome's success signal", async () => {
		const h0: MessageWithMetadata[] = [
			userTurn("Run the checks."),
			assistantTurn("working"),
		];
		const state = persistedState(h0);
		const h1: MessageWithMetadata[] = [
			...h0,
			toolCall("call_cb", "run_commands", {
				commands: ["echo a", "echo b", "echo c"],
			}),
			toolResult("call_cb", "run_commands", [
				{ query: "echo a", result: "ok", success: true },
				{ query: "echo b", result: "ok", success: true },
				{ query: "echo c", result: "ok", success: true },
			]),
		];
		const run = await runWrapper({ canonical: h1, existingState: state });
		const signals = providerVisibleSuccessSignals(run.providerRequest);
		expect(signals.get("call_cb")).toBe(true);
	});

	it("keeps the task contract and the user constraints visible", async () => {
		const h0: MessageWithMetadata[] = [
			userTurn(
				"Adjudicate the ten findings.\n\nDo not add replacement findings.",
			),
			...successfulPair("call_ct", "echo alpha"),
			assistantTurn("working"),
		];
		const state = persistedState(h0);
		const h1: MessageWithMetadata[] = [
			...h0,
			...successfulPair("call_ct2", "echo bravo"),
		];
		const run = await runWrapper({ canonical: h1, existingState: state });
		const text = projectedSummaryText(run.prepared?.messages ?? []);
		expect(text).toContain("Do not add replacement findings.");
	});

	it("still UPDATES the task contract when the canonical contract genuinely changes", async () => {
		const h0: MessageWithMetadata[] = [
			userTurn("Adjudicate the ten findings."),
			...successfulPair("call_cu2", "echo alpha"),
			assistantTurn("working"),
		];
		const state = persistedState(h0);
		const h1: MessageWithMetadata[] = [
			...h0,
			userTurn("Also report the repository identity."),
		];
		const before = await runWrapper({ canonical: h0, existingState: state });
		const after = await runWrapper({ canonical: h1, existingState: state });
		const beforeText = projectedSummaryText(before.prepared?.messages ?? []);
		const afterText = projectedSummaryText(after.prepared?.messages ?? []);
		// The contract update is NOT suppressed to preserve the prefix.
		expect(afterText).not.toBe(beforeText);
		expect(afterText).toContain("Also report the repository identity.");
	});

	it("keeps the source prefix hash valid and the source message count authoritative", async () => {
		const h0: MessageWithMetadata[] = [
			userTurn("Adjudicate the ten findings."),
			...successfulPair("call_sh", "echo alpha"),
			assistantTurn("working"),
		];
		const state = persistedState(h0);
		expect(state.source_message_count).toBe(h0.length);
		expect(state.source_prefix_hash).toMatch(/^sha256:/);
		const h1: MessageWithMetadata[] = [
			...h0,
			...successfulPair("call_sh2", "echo bravo"),
		];
		// The projection SUCCEEDS: the persisted prefix still matches.
		const run = await runWrapper({ canonical: h1, existingState: state });
		expect(run.prepared?.messages?.length).toBeGreaterThan(0);
		// The appended canonical tail is included EXACTLY ONCE.
		const text = providerVisibleText(run.providerRequest);
		expect(text.split("call_sh2").length - 1).toBe(1);
	});

	it("rejects a corrupted sidecar instead of projecting it", async () => {
		const h0: MessageWithMetadata[] = [
			userTurn("Adjudicate the ten findings."),
			assistantTurn("working"),
		];
		const state = persistedState(h0);
		const corrupted = {
			...state,
			source_prefix_hash:
				"sha256:0000000000000000000000000000000000000000000000000000000000000000",
		};
		const run = await runWrapper({ canonical: h0, existingState: corrupted });
		// The projector refused: the pipeline produced NO compaction
		// projection, so the request falls back to the canonical transcript.
		expect(run.prepared?.messages).toBeUndefined();
		// The provider request is still the canonical transcript.
		expect(run.providerRequest.length).toBe(h0.length);
	});

	it("a NEW compaction establishes a NEW prefix and carries the new boundary's evidence", async () => {
		const canonical: MessageWithMetadata[] = [
			userTurn("Adjudicate the ten findings."),
			...successfulPair("call_rc", "echo alpha"),
			assistantTurn("working"),
		];
		const freshSummary = compactionSummaryMessage(
			"## Goal\nAdjudicate the ten findings.",
		);
		const run = await runWrapper({
			canonical,
			compactResult: { messages: [freshSummary] },
		});
		// A NEW sidecar was persisted with the new boundary.
		expect(run.savedStates.length).toBe(1);
		const saved = run.savedStates[0];
		expect(saved.source_message_count).toBe(canonical.length);
		// The NEW summary carries the evidence for the NEW boundary.
		const text = projectedSummaryText(saved.messages);
		// ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01: the carried
		// outcome publishes an OPAQUE, PUBLICATION-LOCAL alias rather than
		// the canonical tool-call id, so the control counts the carried
		// LINES rather than looking for the raw id.
		expect(carriedOutcomeLines(text)).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// CORRECTION01 — the boundary contract
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-COMPACTION-STABLE-PREFIX-REPAIR-01-CORRECTION01 — the boundary contract", () => {
	it("reproduces the RETAINED-TAIL counterexample: the inferred boundary can be EARLIER than the true one", () => {
		// Canonical: A B C D E. The sidecar retains canonical messages D and E
		// from BEFORE its own boundary — the production RE-COMPACTION shape,
		// because a compaction result is `[summary, ...messages.slice(cut)]`
		// over the COMPACTOR'S INPUT.
		const canonical: MessageWithMetadata[] = [
			assistantTurn("A"),
			assistantTurn("B"),
			assistantTurn("C"),
			assistantTurn("D"),
			assistantTurn("E"),
		];
		const state = createSessionCompactionState({
			sourceMessages: canonical,
			compactedMessages: [
				compactionSummaryMessage(SUMMARY_PROSE),
				canonical[3],
				canonical[4],
			],
			conversationId: "conv-retained",
			systemPrompt: SYSTEM_PROMPT,
			updatedAt: new Date(0).toISOString(),
		});
		expect(state.source_message_count).toBe(5);
		const projected = projectSessionCompactionState(state, canonical);
		expect(projected).toBeDefined();
		if (!projected) {
			throw new Error("expected a successful projection");
		}
		// The INFERENCE under-estimates the boundary.
		const inferred = inferCompactionSourceBoundary(projected, canonical);
		expect(inferred).toBe(3);
		expect(inferred).not.toBe(state.source_message_count);
		// ...and it is CONSERVATIVE: it scopes the ledger to a SHORTER
		// prefix, so the section can only ever be a SUBSET of the true
		// boundary's outcomes, never a superset.
		expect(inferred).toBeLessThan(state.source_message_count);
	});

	it("the AUTHORITATIVE boundary is used by the production path, so the retained tail does not change the section", async () => {
		const canonical: MessageWithMetadata[] = [
			userTurn("Adjudicate the ten findings."),
			...successfulPair("call_rt_a", "echo alpha"),
			assistantTurn("continuing"),
		];
		const state = createSessionCompactionState({
			sourceMessages: canonical,
			compactedMessages: [
				compactionSummaryMessage(SUMMARY_PROSE),
				canonical[2],
			],
			conversationId: "conv-retained-prod",
			systemPrompt: SYSTEM_PROMPT,
			updatedAt: new Date(0).toISOString(),
		});
		const h1: MessageWithMetadata[] = [
			...canonical,
			...successfulPair("call_rt_b", "echo bravo"),
		];
		const run = await runWrapper({ canonical: h1, existingState: state });
		const text = projectedSummaryText(run.prepared?.messages ?? []);
		// The boundary-verified outcome IS carried, because the production
		// path passed the persisted `source_message_count` — not the
		// under-estimated inference.
		// ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01: the carried
		// outcome publishes an OPAQUE, PUBLICATION-LOCAL alias rather than
		// the canonical tool-call id, so the control counts the carried
		// LINES rather than looking for the raw id.
		expect(carriedOutcomeLines(text)).toHaveLength(1);
	});

	it("the Phase-A boundary equals the PERSISTED source_message_count even with a display-only message", async () => {
		const canonical: MessageWithMetadata[] = [
			userTurn("Adjudicate the ten findings."),
			{
				role: "user",
				content: [{ type: "text", text: "display-only notice" }],
				metadata: { displayOnly: true, displayRole: "error" },
			},
			...successfulPair("call_do", "echo alpha"),
			assistantTurn("continuing"),
		];
		// The RAW length differs from the CANONICAL count, because
		// `createSessionCompactionState()` excludes display-only messages.
		expect(canonical.length).toBe(5);
		expect(countCanonicalSourceMessages(canonical)).toBe(4);

		const run = await runWrapper({
			canonical,
			compactResult: { messages: [compactionSummaryMessage(SUMMARY_PROSE)] },
		});
		expect(run.savedStates.length).toBe(1);
		const saved = run.savedStates[0];
		// The persisted boundary is the CANONICAL count.
		expect(saved.source_message_count).toBe(4);
		// The persisted section was derived from the SAME boundary, so the
		// persisted sidecar is self-consistent: the outcome that lived in the
		// canonical prefix is carried.
		const text = projectedSummaryText(saved.messages);
		// ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01: the carried
		// outcome publishes an OPAQUE, PUBLICATION-LOCAL alias rather than
		// the canonical tool-call id, so the control counts the carried
		// LINES rather than looking for the raw id.
		expect(carriedOutcomeLines(text)).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// CORRECTION02 — the canonical boundary INDEX mismatch
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-COMPACTION-STABLE-PREFIX-REPAIR-01-CORRECTION02 — the canonical boundary index", () => {
	/**
	 * The reviewer's counterexample.
	 *
	 * RAW:      0 USER task | 1 DISPLAY(displayOnly) | 2 ASSISTANT tool_use | 3 USER tool_result
	 * CANONICAL:0 USER task |                       | 1 ASSISTANT tool_use | 2 USER tool_result
	 *
	 * The persisted boundary is the CANONICAL count (3). A raw slice of
	 * `slice(0, 3)` therefore stops at raw index 2 — the `tool_use` — and
	 * DROPS the verified `tool_result`, which lives at raw index 3.
	 *
	 * The result is INSIDE the canonical boundary, so the canonical tail
	 * cannot restore it either: the tail begins at canonical index 3.
	 */
	function interleavedHistory(callId: string): MessageWithMetadata[] {
		return [
			userTurn("Adjudicate the findings."),
			{
				role: "user",
				content: [{ type: "text", text: "a transient display-only notice" }],
				metadata: { displayOnly: true, displayRole: "error" },
			},
			toolCall(callId, "run_commands", { commands: ["echo alpha"] }),
			toolResult(callId, "run_commands", [
				{ query: "echo alpha", result: "ok", success: true },
			]),
		];
	}

	it("the counterexample IS the discriminator: the result is past the RAW boundary but inside the CANONICAL one", () => {
		const history = interleavedHistory("call_idx_a");
		const rawIndex = history.findIndex(
			(message) =>
				(message.content?.[0] as { type?: string } | undefined)?.type ===
				"tool_result",
		);
		const canonicalCount = countCanonicalSourceMessages(history);
		// The RAW index is at or past the canonical count...
		expect(rawIndex).toBeGreaterThanOrEqual(canonicalCount);
		// ...but the result IS inside the canonical source boundary.
		expect(canonicalCount).toBe(3);
		expect(history.length).toBe(4);
	});

	it("PHASE A — a NEW compaction carries the verified outcome despite the interleaved display-only message", async () => {
		const history = interleavedHistory("call_idx_b");
		const run = await runWrapper({
			canonical: history,
			compactResult: { messages: [compactionSummaryMessage(SUMMARY_PROSE)] },
		});
		expect(run.savedStates.length).toBe(1);
		const saved = run.savedStates[0];
		expect(saved.source_message_count).toBe(3);

		// The carried section must contain the verified outcome...
		const summaryText = projectedSummaryText(saved.messages);
		// ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01: the carried
		// outcome publishes an OPAQUE, PUBLICATION-LOCAL alias rather than
		// the canonical tool-call id, so the control counts the carried
		// LINES rather than looking for the raw id.
		expect(carriedOutcomeLines(summaryText)).toHaveLength(1);
		// ...and the model-visible request must carry the ASSERTED SUCCESS
		// for that call id, not merely the call id.
		//
		// The canonical boundary (3) consumes the whole canonical history
		// here, so the canonical tail is EMPTY and the section is the ONLY
		// carrier of this outcome. That is exactly why losing it is a
		// correctness failure.
		expect(canonicalTailToolResultCount(run.providerRequest)).toBe(0);
		const visible = providerVisibleText(run.providerRequest);
		// ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01: the carried
		// outcome publishes an OPAQUE, PUBLICATION-LOCAL alias rather than
		// the canonical tool-call id, so the control counts the carried
		// LINES rather than looking for the raw id.
		expect(carriedOutcomeLines(visible)).toHaveLength(1);
		// The section states the outcome in its own vocabulary: the call id
		// AND the ASSERTED status. A bare call id would not distinguish a
		// success from a merely submitted command.
		expect(visible).toContain("succeeded");
	});

	it("PHASE B — persisted-sidecar restoration carries the verified outcome too", async () => {
		const history = interleavedHistory("call_idx_c");
		const state = persistedState(history);
		expect(state.source_message_count).toBe(3);

		const run = await runWrapper({ canonical: history, existingState: state });
		const summaryText = projectedSummaryText(run.prepared?.messages ?? []);
		// ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01: the carried
		// outcome publishes an OPAQUE, PUBLICATION-LOCAL alias rather than
		// the canonical tool-call id, so the control counts the carried
		// LINES rather than looking for the raw id.
		expect(carriedOutcomeLines(summaryText)).toHaveLength(1);

		// The canonical boundary consumes the whole canonical history, so the
		// tail is empty and the section is the ONLY carrier.
		expect(canonicalTailToolResultCount(run.providerRequest)).toBe(0);
		const visible = providerVisibleText(run.providerRequest);
		// ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01: the carried
		// outcome publishes an OPAQUE, PUBLICATION-LOCAL alias rather than
		// the canonical tool-call id, so the control counts the carried
		// LINES rather than looking for the raw id.
		expect(carriedOutcomeLines(visible)).toHaveLength(1);
		expect(visible).toContain("succeeded");
	});

	it("the canonical TAIL does not duplicate the result that the section carries", async () => {
		const history = interleavedHistory("call_idx_d");
		const state = persistedState(history);
		const run = await runWrapper({ canonical: history, existingState: state });
		const messages = run.prepared?.messages ?? [];

		// The outcome is carried in the SUMMARY...
		// ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01: the carried
		// outcome publishes an OPAQUE, PUBLICATION-LOCAL alias rather than
		// the canonical tool-call id, so the control counts the carried
		// LINES rather than looking for the raw id.
		expect(carriedOutcomeLines(projectedSummaryText(messages))).toHaveLength(1);
		// ...and the canonical tail must NOT also present it as a second
		// independent verified outcome.
		const tailOccurrences = messages.filter(
			(message) =>
				(message.content?.[0] as { type?: string } | undefined)?.type ===
				"tool_result",
		).length;
		expect(tailOccurrences).toBe(0);
	});

	it("the summary stays STABLE across a continuation that appends a VERIFIED outcome", async () => {
		// The stability invariant is scoped to the EVIDENCE section. An
		// append-only canonical continuation must not rewrite the early
		// summary, even when the appended outcome is itself verified.
		const history = interleavedHistory("call_idx_e");
		const state = persistedState(history);
		const before = await runWrapper({
			canonical: history,
			existingState: state,
		});
		const after = await runWrapper({
			canonical: [...history, ...successfulPair("call_idx_f", "echo bravo")],
			existingState: state,
		});
		expect(projectedSummaryText(after.prepared?.messages ?? [])).toBe(
			projectedSummaryText(before.prepared?.messages ?? []),
		);
	});
});

// ---------------------------------------------------------------------------
// CORRECTION02 — the fallback's corrected contract
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-COMPACTION-STABLE-PREFIX-REPAIR-01-CORRECTION02 — the fallback contract", () => {
	/**
	 * The corrected contract of `inferCompactionSourceBoundary()`.
	 *
	 * An under-estimated boundary never FABRICATES an outcome — the section
	 * is always a subset of the true boundary's outcomes — but it CAN OMIT
	 * one. The earlier claim that it "costs compactness, never correctness"
	 * was NOT proven and is withdrawn.
	 */
	it("an under-estimated boundary can OMIT a boundary outcome (the 'never correctness' claim is FALSE)", () => {
		const canonical: MessageWithMetadata[] = [
			userTurn("A"),
			assistantTurn("B"),
			toolCall("call_fb", "run_commands", { commands: ["echo hi"] }),
			toolResult("call_fb", "run_commands", [
				{ query: "echo hi", result: "ok", success: true },
			]),
			assistantTurn("E"),
		];
		const sidecar = [
			compactionSummaryMessage(SUMMARY_PROSE),
			canonical[3],
			canonical[4],
		];
		const inferred = inferCompactionSourceBoundary(sidecar, canonical);
		// The inference UNDER-estimates: 3 vs the true 5.
		expect(inferred).toBe(3);
		expect(inferred).toBeLessThan(5);

		// The outcome at canonical index 3 is INSIDE the true boundary but
		// OUTSIDE the inferred one, so the section carries NOTHING.
		const applied = applyVerifiedEvidenceToCompactedMessages(
			sidecar,
			canonical,
		);
		expect(applied.carriedOutcomeCount).toBe(0);
		const sectionText =
			(applied.messages[0].metadata as { summary?: string } | undefined)
				?.summary ?? "";
		// ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01: the outcome is
		// NOT carried, so there is no carried line for it.
		expect(carriedOutcomeLines(sectionText)).toHaveLength(0);
	});

	it("the AUTHORITATIVE boundary does not omit that outcome", () => {
		const canonical: MessageWithMetadata[] = [
			userTurn("A"),
			assistantTurn("B"),
			toolCall("call_fb2", "run_commands", { commands: ["echo hi"] }),
			toolResult("call_fb2", "run_commands", [
				{ query: "echo hi", result: "ok", success: true },
			]),
			assistantTurn("E"),
		];
		const sidecar = [
			compactionSummaryMessage(SUMMARY_PROSE),
			canonical[3],
			canonical[4],
		];
		// The SAME history, but with the authoritative boundary supplied.
		const applied = applyVerifiedEvidenceToCompactedMessages(
			sidecar,
			canonical,
			{
				sourceMessageCount: 5,
			},
		);
		expect(applied.carriedOutcomeCount).toBe(1);
		const sectionText =
			(applied.messages[0].metadata as { summary?: string } | undefined)
				?.summary ?? "";
		// ACT-CLINEMM-EVIDENCE-CONTINUITY-REFERENCE-TRUST-01: the carried
		// outcome publishes an OPAQUE, PUBLICATION-LOCAL alias rather than
		// the canonical tool-call id, so the control counts the carried
		// LINES rather than looking for the raw id.
		expect(carriedOutcomeLines(sectionText)).toHaveLength(1);
	});
});
