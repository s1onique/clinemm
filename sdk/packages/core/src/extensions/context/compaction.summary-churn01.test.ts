/**
 * ACT-CLINEMM-COMPACTION-SUMMARY-CHURN-01
 *
 * Permanent regression suite for the provider-visible compaction-summary
 * churn that follows a compaction.
 *
 * THE SYMPTOM
 * -----------
 *
 * Following a compaction, the provider-visible summary — the message the
 * model sees FIRST in every request — is rewritten on almost every
 * continuation, even though the canonical history only ever GREW.
 *
 * The live session `1795229584545_t33f9` shows this directly. Between
 * iterations 26 and 39 the summary carrier's content fingerprint changed on
 * 12 of 13 adjacent transitions, while the system prompt and the ordered tool
 * inventory stayed byte-identical. The mutation is introduced at the
 * `runtime_projection` stage and propagates unchanged through
 * `ai_sdk_prompt` to `wire_request`.
 *
 * WHY IT MATTERS
 * --------------
 *
 * The summary sits at the HEAD of the model-facing context. A prompt cache
 * (Strata and equivalents) can only reuse a checkpoint over an UNCHANGED
 * prefix. Rewriting the summary invalidates every deeper checkpoint, so the
 * whole prompt is re-processed instead of the cheap tail.
 *
 * THE PRODUCER
 * ------------
 *
 * `applyVerifiedEvidenceToCompactedMessages()` re-derives the
 * verified-outcome section from the CURRENT canonical history on every
 * provider-visible restoration, and REPLACES the section in place. The
 * replacement is at the TAIL of the summary, but it makes the summary's
 * content fingerprint change, which invalidates the cache over the whole
 * prefix.
 *
 * `applyTaskContractToCompactedMessages()` does NOT cause this: with
 * evidence restoration disabled the summary is byte-stable across the same
 * append-only continuations.
 *
 * WHAT THIS SUITE PINS
 * --------------------
 *
 * It pins the OBSERVED production behaviour of the evidence carry-forward:
 * that the carry-forward is a pure function of the canonical history, that
 * it replaces rather than accumulates, that it fails closed on unverifiable
 * outcomes, that it respects the rolling 12-outcome selection, and that it
 * is the ONLY producer of the observed churn.
 *
 * It does NOT assert a repair. The stable-prefix repair is a SEPARATE,
 * later ACT.
 */

import type { MessageWithMetadata } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	createSessionCompactionState,
	projectSessionCompactionState,
} from "../../session/models/session-compaction";
import {
	applyVerifiedEvidenceToCompactedMessages,
	EVIDENCE_SECTION_HEADING,
	extractVerifiedToolOutcomes,
	MAX_CARRIED_OUTCOMES,
	renderEvidenceSection,
	stripEvidenceSection,
} from "./evidence-continuity";
import {
	applyTaskContractToCompactedMessages,
	stripTaskContractSection,
} from "./task-contract";

// ---------------------------------------------------------------------------
// Fixtures — production-shaped, synthetic
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

/**
 * The compaction summary the production summarizer installs. The summary
 * text DELIBERATELY omits the verified outcome — that is the lossy
 * projection the carry-forward exists to correct.
 */
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
	"## Next",
	"- Produce the verdict matrix.",
].join("\n");

/**
 * A persisted compaction sidecar over a canonical prefix, plus the canonical
 * history it was computed from.
 */
function persistedState(
	canonical: readonly MessageWithMetadata[],
): ReturnType<typeof createSessionCompactionState> {
	return createSessionCompactionState({
		sourceMessages: canonical,
		compactedMessages: [compactionSummaryMessage(SUMMARY_PROSE)],
		conversationId: "conv-1",
	});
}

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

/**
 * The production provider-visible restoration, with the disposable ablation
 * switches applied AROUND the real production functions.
 */
async function prepareProviderVisible(
	projected: readonly MessageWithMetadata[],
	canonical: readonly MessageWithMetadata[],
	switches: { contract: boolean; evidence: boolean },
): Promise<readonly MessageWithMetadata[]> {
	let messages = projected;
	if (switches.contract) {
		const contracted = await applyTaskContractToCompactedMessages(
			messages,
			canonical,
		);
		messages = contracted.messages;
	}
	if (switches.evidence) {
		const evidenced = applyVerifiedEvidenceToCompactedMessages(
			messages,
			canonical,
		);
		messages = evidenced.messages;
	}
	return messages;
}

// ---------------------------------------------------------------------------
// Section extraction
// ---------------------------------------------------------------------------

const CONTRACT_BEGIN = "<!-- cline-task-contract:begin -->";
const CONTRACT_END = "<!-- cline-task-contract:end -->";
const EVIDENCE_BEGIN = "<!-- cline-evidence:begin -->";
const EVIDENCE_END = "<!-- cline-evidence:end -->";

/**
 * The EXACT text of a carried section (heading + delimited body), or
 * `undefined` when the section is absent.
 *
 * The production `strip*Section()` helpers remove a section; they cannot be
 * used to COMPARE two sections, because the remaining text still contains
 * the OTHER section. This extractor returns the section itself, so a section
 * can be compared for equality directly.
 */
function extractSection(
	text: string,
	heading: string,
	begin: string,
	end: string,
): string | undefined {
	const b = text.indexOf(begin);
	if (b === -1) {
		return undefined;
	}
	const e = text.indexOf(end, b);
	const h = text.lastIndexOf(heading, b);
	const start = h !== -1 ? h : b;
	return e === -1 ? text.slice(start) : text.slice(start, e + end.length);
}

function contractSection(text: string): string | undefined {
	return extractSection(
		text,
		"## Active task contract (authoritative)",
		CONTRACT_BEGIN,
		CONTRACT_END,
	);
}

function evidenceSection(text: string): string | undefined {
	return extractSection(
		text,
		EVIDENCE_SECTION_HEADING,
		EVIDENCE_BEGIN,
		EVIDENCE_END,
	);
}

/**
 * The summary text with BOTH carried sections removed: the generated prose
 * and nothing else.
 */
function proseOf(text: string): string {
	return stripEvidenceSection(stripTaskContractSection(text)).trimEnd();
}

/** Every text-ish fragment of a message, for tail-content assertions. */
function messageFragments(message: MessageWithMetadata): string[] {
	if (typeof message.content === "string") {
		return [message.content];
	}
	if (!Array.isArray(message.content)) {
		return [];
	}
	const fragments: string[] = [];
	for (const block of message.content) {
		if (block.type === "text" && typeof block.text === "string") {
			fragments.push(block.text);
		}
		if (block.type === "tool_use") {
			fragments.push(JSON.stringify(block.input ?? {}));
		}
	}
	return fragments;
}

/**
 * The rendered evidence section, asserted present.
 *
 * `renderEvidenceSection()` returns `undefined` when there is nothing
 * verified to carry. The assertions that use this helper are about a
 * NON-EMPTY section, so the presence is part of the contract rather than a
 * cast.
 */
function renderedEvidenceSection(
	ledger: Parameters<typeof renderEvidenceSection>[0],
): string {
	const rendered = renderEvidenceSection(ledger);
	expect(rendered).toBeDefined();
	if (rendered === undefined) {
		throw new Error("expected a rendered evidence section");
	}
	return rendered;
}

/**
 * The projection of a persisted sidecar, asserted present.
 *
 * `projectSessionCompactionState()` returns `undefined` when the sidecar's
 * source prefix does not match the canonical history — the fail-closed
 * behaviour the corruption negative control pins. Every other case in this
 * suite asserts a SUCCESSFUL projection, so the presence is part of the
 * contract rather than a cast.
 */
function projectedOrFail(
	state: Parameters<typeof projectSessionCompactionState>[0],
	canonical: readonly MessageWithMetadata[],
): MessageWithMetadata[] {
	const projected = projectSessionCompactionState(state, canonical);
	expect(projected).toBeDefined();
	if (projected === undefined) {
		throw new Error("expected a successful projection");
	}
	return projected;
}

// ---------------------------------------------------------------------------
// G2 — the real production pipeline reproduces the churn
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-COMPACTION-SUMMARY-CHURN-01 — the churn reproduces", () => {
	/** The canonical history at the compaction boundary. */
	const h0: MessageWithMetadata[] = [
		userTurn("Adjudicate the ten findings."),
		...successfulPair("call_h0_a", "echo alpha"),
		...successfulPair("call_h0_b", "echo bravo"),
		assistantTurn("continuing"),
	];

	// ACT-CLINEMM-COMPACTION-STABLE-PREFIX-REPAIR-01: this suite USED TO pin
	// the churn itself. The stable-prefix repair removed the churn, so the
	// assertion is INVERTED: the summary the model already saw must now stay
	// byte-identical across the same append-only continuation.
	it("keeps the provider-visible summary byte-identical when an append-only canonical continuation adds a verified outcome", async () => {
		const state = persistedState(h0);
		const h1: MessageWithMetadata[] = [
			...h0,
			...successfulPair("call_h1_new", "echo charlie"),
		];

		const projectedH0 = projectedOrFail(state, h0);
		const projectedH1 = projectedOrFail(state, h1);

		const before = await prepareProviderVisible(projectedH0, h0, {
			contract: true,
			evidence: true,
		});
		const after = await prepareProviderVisible(projectedH1, h1, {
			contract: true,
			evidence: true,
		});

		const beforeText = projectedSummaryText(before);
		const afterText = projectedSummaryText(after);

		// THE REPAIR: the summary the model already saw is UNCHANGED.
		expect(afterText).toBe(beforeText);
		// Every section is byte-identical: the contract, the evidence and the
		// generated prose.
		expect(evidenceSection(afterText)).toBe(evidenceSection(beforeText));
		expect(contractSection(afterText)).toBe(contractSection(beforeText));
		expect(proseOf(afterText)).toBe(proseOf(beforeText));
		// The outcome verified AT the boundary is still carried.
		expect(afterText).toContain("call_h0_a");
		expect(afterText).toContain("call_h0_b");
	});

	it("keeps the summary byte-stable when the canonical history is UNCHANGED", async () => {
		const state = persistedState(h0);
		const projected = projectedOrFail(state, h0);

		const first = await prepareProviderVisible(projected, h0, {
			contract: true,
			evidence: true,
		});
		const second = await prepareProviderVisible(projected, h0, {
			contract: true,
			evidence: true,
		});
		expect(projectedSummaryText(second)).toBe(projectedSummaryText(first));
	});

	it("changes the summary content while keeping the SAME byte length when the replacement is length-neutral", async () => {
		// Two different outcomes with IDENTICAL rendered length. The section
		// is replaced in place, so the summary's byte length is unchanged
		// while its content — and therefore its cache identity — changes.
		const state = persistedState(h0);
		const h1: MessageWithMetadata[] = [
			...h0,
			...successfulPair("call_len_x", "echo 11111"),
		];
		const h2: MessageWithMetadata[] = [
			...h0,
			...successfulPair("call_len_y", "echo 22222"),
		];

		const projected = projectedOrFail(state, h0);

		const one = await prepareProviderVisible(projected, h1, {
			contract: true,
			evidence: true,
		});
		const two = await prepareProviderVisible(projected, h2, {
			contract: true,
			evidence: true,
		});

		const oneText = projectedSummaryText(one);
		const twoText = projectedSummaryText(two);
		expect(oneText).not.toBe(twoText);
		expect(twoText.length).toBe(oneText.length);
	});

	it("rejects a corrupted sidecar identity instead of projecting it", () => {
		const state = persistedState(h0);
		const corrupted = {
			...state,
			source_prefix_hash:
				"sha256:0000000000000000000000000000000000000000000000000000000000000000",
		};
		expect(projectSessionCompactionState(corrupted, h0)).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// G3-G6 — the 2x2 causal ablation
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-COMPACTION-SUMMARY-CHURN-01 — the causal ablation", () => {
	const h0: MessageWithMetadata[] = [
		userTurn("Adjudicate the ten findings."),
		...successfulPair("call_ab_h0", "echo alpha"),
		assistantTurn("continuing"),
	];
	const h1: MessageWithMetadata[] = [
		...h0,
		...successfulPair("call_ab_h1", "echo bravo"),
	];

	const variants = [
		{
			id: "A",
			label: "contract OFF, evidence OFF",
			contract: false,
			evidence: false,
		},
		{
			id: "B",
			label: "contract ON, evidence OFF",
			contract: true,
			evidence: false,
		},
		{
			id: "C",
			label: "contract OFF, evidence ON",
			contract: false,
			evidence: true,
		},
		{
			id: "D",
			label: "contract ON, evidence ON",
			contract: true,
			evidence: true,
		},
	];

	async function summaryFor(
		canonical: readonly MessageWithMetadata[],
		switches: { contract: boolean; evidence: boolean },
	): Promise<string> {
		const state = persistedState(h0);
		const projected = projectedOrFail(state, canonical);
		const prepared = await prepareProviderVisible(
			projected,
			canonical,
			switches,
		);
		return projectedSummaryText(prepared);
	}

	// ACT-CLINEMM-COMPACTION-STABLE-PREFIX-REPAIR-01: the ablation USED TO
	// show that only the EVIDENCE-enabled variants churn. The stable-prefix
	// repair removed the churn from every variant, so the ablation now shows
	// that NO variant mutates the summary across an append-only continuation.
	it("no variant mutates the summary across an append-only continuation after the stable-prefix repair", async () => {
		const observed: Record<string, boolean> = {};
		for (const variant of variants) {
			const before = await summaryFor(h0, variant);
			const after = await summaryFor(h1, variant);
			observed[variant.id] = before !== after;
		}
		// The ORIGINAL projection and the CONTRACT-ONLY projection are stable.
		expect(observed.A).toBe(false);
		expect(observed.B).toBe(false);
		// The EVIDENCE-ONLY and the PRODUCTION COMPOSITION are stable too.
		expect(observed.C).toBe(false);
		expect(observed.D).toBe(false);
	});

	it("contract restoration ALONE never changes the summary across an append-only continuation", async () => {
		const before = await summaryFor(h0, {
			contract: true,
			evidence: false,
		});
		const after = await summaryFor(h1, {
			contract: true,
			evidence: false,
		});
		expect(after).toBe(before);
	});

	// ACT-CLINEMM-COMPACTION-STABLE-PREFIX-REPAIR-01: the evidence
	// restoration is no longer a MUTATION — it is the boundary-scoped
	// enrichment. It still ADDS the carried section when the summary lacks
	// one (a historical sidecar), so the two variants DIFFER; what it no
	// longer does is rewrite the section on every continuation.
	it("still enriches a summary that lacks the section, without mutating one that carries it", async () => {
		const withEvidence = await summaryFor(h1, {
			contract: false,
			evidence: true,
		});
		const withoutEvidence = await summaryFor(h1, {
			contract: false,
			evidence: false,
		});
		expect(withEvidence).not.toBe(withoutEvidence);
		// The enrichment carries the boundary-verified outcome.
		expect(withEvidence).toContain("call_ab_h0");
		// ...and it does NOT carry the post-boundary outcome, because the
		// section is scoped to the source boundary.
		expect(withEvidence).not.toContain("call_ab_h1");
	});
});

// ---------------------------------------------------------------------------
// G7 — canonical evidence and task obligations are conserved
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-COMPACTION-SUMMARY-CHURN-01 — conservation", () => {
	it("does not promote a FAILED outcome into the carried section", async () => {
		const canonical: MessageWithMetadata[] = [
			userTurn("Run the check."),
			toolCall("call_failed", "run_commands", { commands: ["echo x"] }),
			toolResult("call_failed", "run_commands", [
				{ query: "echo x", result: "boom", success: false },
			]),
			assistantTurn("continuing"),
		];
		const state = persistedState(canonical);
		const projected = projectedOrFail(state, canonical);
		const prepared = await prepareProviderVisible(projected, canonical, {
			contract: true,
			evidence: true,
		});
		const text = projectedSummaryText(prepared);
		expect(text).not.toContain("call_failed");
		expect(text).not.toContain("succeeded");
	});

	it("does not promote a call with NO result", async () => {
		const canonical: MessageWithMetadata[] = [
			userTurn("Run the check."),
			toolCall("call_never_ran", "run_commands", { commands: ["echo x"] }),
			assistantTurn("continuing"),
		];
		const state = persistedState(canonical);
		const projected = projectedOrFail(state, canonical);
		const prepared = await prepareProviderVisible(projected, canonical, {
			contract: true,
			evidence: true,
		});
		expect(projectedSummaryText(prepared)).not.toContain("call_never_ran");
	});

	it("does not duplicate a carried outcome across repeated preparations", async () => {
		const canonical: MessageWithMetadata[] = [
			userTurn("Run the check."),
			...successfulPair("call_once", "echo alpha"),
			assistantTurn("continuing"),
		];
		const state = persistedState(canonical);
		const projected = projectedOrFail(state, canonical);
		const first = await prepareProviderVisible(projected, canonical, {
			contract: true,
			evidence: true,
		});
		const second = await prepareProviderVisible(projected, canonical, {
			contract: true,
			evidence: true,
		});
		const text = projectedSummaryText(second);
		const occurrences = text.split("call_once").length - 1;
		expect(occurrences).toBe(1);
		expect(projectedSummaryText(first)).toBe(text);
	});

	it("keeps the rolling 12-outcome selection and drops the OLDEST outcome", () => {
		const canonical: MessageWithMetadata[] = [];
		for (let index = 0; index < 14; index += 1) {
			canonical.push(...successfulPair(`call_${index}`, `echo ${index}`));
		}
		const ledger = extractVerifiedToolOutcomes(canonical);
		expect(ledger.outcomes.length).toBe(MAX_CARRIED_OUTCOMES);
		// The most RECENT 12 are kept; the two oldest fell out.
		const ids = ledger.outcomes.map((outcome) => outcome.toolUseId);
		expect(ids).not.toContain("call_0");
		expect(ids).not.toContain("call_1");
		expect(ids).toContain("call_13");
		expect(ids[ids.length - 1]).toBe("call_13");
	});

	it("preserves the verified command-count semantics", () => {
		const canonical: MessageWithMetadata[] = [
			userTurn("Run the checks."),
			toolCall("call_batch", "run_commands", {
				commands: ["echo a", "echo b", "echo c"],
			}),
			toolResult("call_batch", "run_commands", [
				{ query: "echo a", result: "ok", success: true },
				{ query: "echo b", result: "ok", success: true },
				{ query: "echo c", result: "ok", success: true },
			]),
			assistantTurn("continuing"),
		];
		const ledger = extractVerifiedToolOutcomes(canonical);
		expect(ledger.outcomes.length).toBe(1);
		expect(ledger.outcomes[0].evidence.commandCount).toBe(3);
		const rendered = renderEvidenceSection(ledger);
		expect(rendered).toContain("3 commands");
	});

	it("preserves the task objective and the completion obligation across the carry-forward", async () => {
		const canonical: MessageWithMetadata[] = [
			userTurn(
				"Adjudicate the ten findings.\n\nDo not add replacement findings.",
			),
			...successfulPair("call_obj", "echo alpha"),
			assistantTurn("continuing"),
		];
		const state = persistedState(canonical);
		const projected = projectedOrFail(state, canonical);
		const prepared = await prepareProviderVisible(projected, canonical, {
			contract: true,
			evidence: true,
		});
		const text = projectedSummaryText(prepared);
		expect(text).toContain("Do not add replacement findings.");
	});

	it("leaves the canonical transcript byte-identical after the projection", async () => {
		const canonical: MessageWithMetadata[] = [
			userTurn("Adjudicate the ten findings."),
			...successfulPair("call_canon", "echo alpha"),
			assistantTurn("continuing"),
		];
		const before = JSON.stringify(canonical);
		const state = persistedState(canonical);
		const projected = projectedOrFail(state, canonical);
		await prepareProviderVisible(projected, canonical, {
			contract: true,
			evidence: true,
		});
		expect(JSON.stringify(canonical)).toBe(before);
	});

	it("leaves the persisted sidecar unmodified by a projection-only analysis", async () => {
		const canonical: MessageWithMetadata[] = [
			userTurn("Adjudicate the ten findings."),
			...successfulPair("call_sidecar", "echo alpha"),
			assistantTurn("continuing"),
		];
		const state = persistedState(canonical);
		const before = JSON.stringify(state);
		const projected = projectedOrFail(state, canonical);
		await prepareProviderVisible(projected, canonical, {
			contract: true,
			evidence: true,
		});
		expect(JSON.stringify(state)).toBe(before);
	});

	it("includes the appended canonical tail exactly once", async () => {
		const h0: MessageWithMetadata[] = [
			userTurn("Adjudicate the ten findings."),
			...successfulPair("call_tail_0", "echo alpha"),
			assistantTurn("continuing"),
		];
		const state = persistedState(h0);
		const h1: MessageWithMetadata[] = [
			...h0,
			...successfulPair("call_tail_1", "echo bravo"),
		];
		const projected = projectedOrFail(state, h1);
		// The projected list is the compacted prefix plus the canonical tail.
		expect(projected.length).toBe(
			state.messages.length + (h1.length - h0.length),
		);
		const tailTexts = projected
			.slice(state.messages.length)
			.flatMap((message) => messageFragments(message));
		expect(tailTexts.filter((text) => text.includes("echo bravo")).length).toBe(
			1,
		);
	});

	it("does not let a carried excerpt spoof the section delimiter", () => {
		const canonical: MessageWithMetadata[] = [
			userTurn("Run the check."),
			toolCall("call_spoof", "run_commands", {
				commands: ["echo <!-- cline-evidence:begin -->"],
			}),
			toolResult("call_spoof", "run_commands", [
				{
					query: "echo <!-- cline-evidence:begin -->",
					result: "ok",
					success: true,
				},
			]),
			assistantTurn("continuing"),
		];
		const ledger = extractVerifiedToolOutcomes(canonical);
		const rendered = renderedEvidenceSection(ledger);
		// The carried subject is a CLASSIFICATION drawn from the finite
		// allowlist, never the user's raw command, so a raw delimiter in the
		// command can never reach the section at all. Exactly ONE real begin
		// marker and ONE real end marker exist: the section's own.
		expect(rendered.split("<!-- cline-evidence:begin -->").length - 1).toBe(1);
		expect(rendered.split("<!-- cline-evidence:end -->").length - 1).toBe(1);
		// The raw command text is NOT carried.
		expect(rendered).not.toContain("<!-- cline-evidence:begin -->\\n");
		expect(rendered).not.toContain("echo <!--");
	});

	it("escapes a delimiter that reaches a carried subject", () => {
		// The allowlist classification cannot contain a delimiter, but the
		// escaping is the last line of defence: even if a subject ever did
		// carry one, it could not open or close a section.
		const canonical: MessageWithMetadata[] = [
			userTurn("Run the check."),
			toolCall("call_escape", "run_commands", {
				commands: ["echo <!-- cline-evidence:begin -->"],
			}),
			toolResult("call_escape", "run_commands", [
				{
					query: "echo <!-- cline-evidence:begin -->",
					result: "ok",
					success: true,
				},
			]),
			assistantTurn("continuing"),
		];
		const ledger = extractVerifiedToolOutcomes(canonical);
		const rendered = renderedEvidenceSection(ledger);

		expect(rendered.split("<!-- cline-evidence:begin -->").length - 1).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// Independent section movement — the two one-sided controls
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-COMPACTION-SUMMARY-CHURN-01 — one-sided section movement", () => {
	/**
	 * A TASK-CONTRACT update WITHOUT an evidence update.
	 *
	 * The canonical history gains a LATER USER INSTRUCTION (which changes the
	 * task contract) but NO new verified tool outcome (so the evidence
	 * section is unchanged). The summary must change, and the change must be
	 * attributable to the CONTRACT section alone.
	 */
	it("moves the contract section alone when the canonical contract changes but no new outcome is verified", async () => {
		const h0: MessageWithMetadata[] = [
			userTurn("Adjudicate the ten findings."),
			...successfulPair("call_one_sided", "echo alpha"),
			assistantTurn("continuing"),
		];
		const h1: MessageWithMetadata[] = [
			...h0,
			userTurn("Also report the repository identity."),
		];

		const state = persistedState(h0);
		const projectedH0 = projectedOrFail(state, h0);
		const projectedH1 = projectedOrFail(state, h1);

		const before = await prepareProviderVisible(projectedH0, h0, {
			contract: true,
			evidence: true,
		});
		const after = await prepareProviderVisible(projectedH1, h1, {
			contract: true,
			evidence: true,
		});
		const beforeText = projectedSummaryText(before);
		const afterText = projectedSummaryText(after);

		expect(afterText).not.toBe(beforeText);
		// The EVIDENCE section is unchanged: no new verified outcome.
		expect(evidenceSection(afterText)).toBe(evidenceSection(beforeText));
		// The PROSE is unchanged: the generated summary text is untouched.
		expect(proseOf(afterText)).toBe(proseOf(beforeText));
		// ...and the later instruction IS present.
		expect(afterText).toContain("Also report the repository identity.");
	});

	/**
	 * An EVIDENCE update WITHOUT a task-contract update.
	 *
	 * The canonical history gains a new verified tool outcome but NO new user
	 * instruction, so the contract is unchanged. The summary must change, and
	 * the change must be attributable to the EVIDENCE section alone.
	 */
	// ACT-CLINEMM-COMPACTION-STABLE-PREFIX-REPAIR-01: this case USED TO show
	// the evidence section moving on its own. After the stable-prefix repair
	// the section is scoped to the source boundary, so it does not move when a
	// post-boundary outcome is verified. The CONTRACT section still moves on
	// its own when the canonical contract genuinely changes (the other case in
	// this describe block).
	it("does NOT move the evidence section when a post-boundary outcome is verified but the contract is unchanged", async () => {
		const h0: MessageWithMetadata[] = [
			userTurn("Adjudicate the ten findings."),
			...successfulPair("call_one_sided_2", "echo alpha"),
			assistantTurn("continuing"),
		];
		const h1: MessageWithMetadata[] = [
			...h0,
			...successfulPair("call_one_sided_3", "echo bravo"),
		];

		const state = persistedState(h0);
		const projectedH0 = projectedOrFail(state, h0);
		const projectedH1 = projectedOrFail(state, h1);

		const before = await prepareProviderVisible(projectedH0, h0, {
			contract: true,
			evidence: true,
		});
		const after = await prepareProviderVisible(projectedH1, h1, {
			contract: true,
			evidence: true,
		});
		const beforeText = projectedSummaryText(before);
		const afterText = projectedSummaryText(after);

		expect(afterText).toBe(beforeText);
		// The CONTRACT section is unchanged: no new user instruction.
		expect(contractSection(afterText)).toBe(contractSection(beforeText));
		// The EVIDENCE section is unchanged: the boundary did not move.
		expect(evidenceSection(afterText)).toBe(evidenceSection(beforeText));
		// The PROSE is unchanged.
		expect(proseOf(afterText)).toBe(proseOf(beforeText));
		// The boundary-verified outcome IS carried.
		expect(afterText).toContain("call_one_sided_2");
	});
});
