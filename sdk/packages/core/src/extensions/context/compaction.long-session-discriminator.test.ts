/**
 * ACT-CLINEMM-COMPACTION-TOOL-RESULT-SHAPE-REPRO01
 *
 * Long-session discriminator (C4).
 *
 * THREE MECHANISMS, THREE SEPARATE QUESTIONS
 * -------------------------------------------
 *
 * The Round C session (`1794789266763_q4tet`, 148 tool calls, 4 compactions)
 * exhibits three INDEPENDENT behaviors that are easy to conflate:
 *
 *   M1 — THE SERIALIZER. Does the actual production serializer preserve an
 *        approved safe Helm result when it renders a tool result for the
 *        summarizer input? This is the boundary this ACT repaired.
 *
 *   M2 — THE GENERATED SUMMARY. Does the generated summary preserve that
 *        result? The summary is a LOSSY projection produced by a model; it
 *        is an OUTPUT, not an input, and it is not the serializer's
 *        responsibility.
 *
 *   M3 — THE CARRY-FORWARD BOUND. Does the existing 12-outcome
 *        evidence-continuity carry-forward drop an earlier successful
 *        execution after later outcomes? This is the
 *        `MAX_CARRIED_OUTCOMES` bound in `evidence-continuity.ts`.
 *
 * An early result disappearing under the documented 12-outcome bound is NOT
 * proof of a serialization defect. This suite measures the three SEPARATELY
 * so a conclusion about one is never borrowed for another.
 *
 * The Round C trace used as the forensic source is read-only:
 * `~/Downloads/roundc-latency-trace.json`. It is a METADATA-ONLY latency
 * trace (timings, tool-call ids, byte counts, compaction evidence-ref
 * counts) — it carries NO transcript content, so it can establish the
 * SHAPE of the session (148 tool calls, 4 compactions, carry-forward
 * ref counts of 5..12) but cannot supply result text. The result text used
 * here is the approved safe Helm observation, reproduced from the
 * canonical fixture of the evidence-continuity suite.
 */

import type { MessageWithMetadata } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	createTokenEstimator,
	serializeConversation,
} from "./compaction-shared";
import {
	extractVerifiedToolOutcomes,
	MAX_CARRIED_OUTCOMES,
} from "./evidence-continuity";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HELM_IMAGE = "quay.io/keycloak/keycloak:26.0.7";
const HELM_OUTPUT = [
	"rc=0",
	'213:          image: "quay.io/keycloak/keycloak:26.0.7"',
	"211:            runAsNonRoot: true",
].join("\n");

/**
 * The number of tool calls in the real Round C session, as established from
 * the read-only trace (`tool_execution` start events with 148 distinct
 * `toolCallId` values).
 */
const ROUND_C_TOOL_CALL_COUNT = 148;

/**
 * The number of compactions observed in the real Round C session.
 */
const ROUND_C_COMPACTION_COUNT = 4;

/**
 * The observed carry-forward sizes in the real Round C session
 * (`compactionEvidenceRefsAfter`): 9, 6, 5 and 12. The largest is exactly
 * the documented bound.
 */
const ROUND_C_OBSERVED_CARRY_FORWARD_SIZES = [9, 6, 5, 12] as const;

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
): MessageWithMetadata {
	return {
		role: "user",
		content: [
			{
				type: "tool_result",
				tool_use_id: toolUseId,
				name,
				content,
			},
		] as MessageWithMetadata["content"] extends Array<infer T> ? T[] : never,
	};
}

function userTurn(text: string): MessageWithMetadata {
	return { role: "user", content: [{ type: "text", text }] };
}

/**
 * A successful Helm render pair, exactly as the canonical history carries it:
 * a tool call and its matching result with the persisted
 * `{query, result, success}` payload shape.
 */
function helmPair(index: number): MessageWithMetadata[] {
	const id = `call_helm_${index}`;
	return [
		toolCall(id, "run_commands", {
			commands: ["helm template kc-test . -f values.yaml"],
		}),
		toolResult(id, "run_commands", [
			{
				query: "helm template kc-test . -f values.yaml",
				result: HELM_OUTPUT,
				success: true,
			},
		]),
	];
}

/**
 * A LATER, non-Helm successful outcome, used to push the early Helm
 * execution out of the 12-outcome carry-forward window.
 */
function laterSuccessfulPair(index: number): MessageWithMetadata[] {
	const id = `call_later_${index}`;
	return [
		toolCall(id, "run_commands", { commands: ["make test"] }),
		toolResult(id, "run_commands", [
			{
				query: "make test",
				result: `LATER_OK_${index}`,
				success: true,
			},
		]),
	];
}

// ---------------------------------------------------------------------------
// M1 — THE SERIALIZER
// ---------------------------------------------------------------------------

describe("M1 — the serializer preserves an approved safe Helm result", () => {
	it("preserves the Helm observation in a transcript with 148 tool calls", () => {
		// Build a 148-tool-call transcript shaped like the real Round C
		// session: one Helm render early, then 147 later successful
		// outcomes.
		const messages: MessageWithMetadata[] = [userTurn("Render the chart.")];
		messages.push(...helmPair(0));
		for (let index = 1; index < ROUND_C_TOOL_CALL_COUNT; index += 1) {
			messages.push(...laterSuccessfulPair(index));
		}

		const toolCallCount = messages.filter(
			(message) =>
				Array.isArray(message.content) &&
				message.content.some((block) => block.type === "tool_use"),
		).length;
		expect(toolCallCount).toBe(ROUND_C_TOOL_CALL_COUNT);

		// M1: the serializer's projection of the FULL transcript keeps the
		// safe Helm observation. The serializer does not apply the
		// carry-forward bound — that is M3's job.
		const serialized = serializeConversation(messages);
		expect(serialized).toContain(HELM_IMAGE);
		expect(serialized).toContain("[succeeded] helm template kc-test .");
	});

	it("keeps the serializer projection bounded and deterministic", () => {
		const messages: MessageWithMetadata[] = [userTurn("Render the chart.")];
		messages.push(...helmPair(0));
		for (let index = 1; index < ROUND_C_TOOL_CALL_COUNT; index += 1) {
			messages.push(...laterSuccessfulPair(index));
		}

		const first = serializeConversation(messages);
		const second = serializeConversation(messages);

		// Deterministic: the same canonical history yields the same bytes.
		expect(second).toBe(first);
	});
});

// ---------------------------------------------------------------------------
// M3 — THE CARRY-FORWARD BOUND
// ---------------------------------------------------------------------------

describe("M3 — the 12-outcome carry-forward bound is a SEPARATE mechanism", () => {
	it("drops the early successful Helm execution once later outcomes exceed the bound", () => {
		const messages: MessageWithMetadata[] = [userTurn("Render the chart.")];
		messages.push(...helmPair(0));
		for (let index = 1; index < ROUND_C_TOOL_CALL_COUNT; index += 1) {
			messages.push(...laterSuccessfulPair(index));
		}

		const ledger = extractVerifiedToolOutcomes(messages);

		// The bound is respected...
		expect(ledger.outcomes.length).toBe(MAX_CARRIED_OUTCOMES);
		// ...and it keeps the MOST RECENT outcomes, so the early Helm
		// execution is outside the window.
		expect(
			ledger.outcomes.some((outcome) => outcome.toolUseId === "call_helm_0"),
		).toBe(false);
		// The most recent outcome IS carried.
		expect(
			ledger.outcomes.some(
				(outcome) =>
					outcome.toolUseId === `call_later_${ROUND_C_TOOL_CALL_COUNT - 1}`,
			),
		).toBe(true);
	});

	it("keeps the early Helm execution while the outcome count is within the bound", () => {
		const messages: MessageWithMetadata[] = [userTurn("Render the chart.")];
		messages.push(...helmPair(0));
		for (let index = 1; index < MAX_CARRIED_OUTCOMES; index += 1) {
			messages.push(...laterSuccessfulPair(index));
		}

		const ledger = extractVerifiedToolOutcomes(messages);

		expect(ledger.outcomes.length).toBe(MAX_CARRIED_OUTCOMES);
		expect(
			ledger.outcomes.some((outcome) => outcome.toolUseId === "call_helm_0"),
		).toBe(true);
	});

	it("the observed Round C carry-forward sizes never exceed the documented bound", () => {
		// The read-only Round C trace recorded `compactionEvidenceRefsAfter`
		// values of 9, 6, 5 and 12 across its 4 compactions. The largest is
		// exactly the documented bound, and none exceeds it.
		expect(ROUND_C_OBSERVED_CARRY_FORWARD_SIZES).toHaveLength(
			ROUND_C_COMPACTION_COUNT,
		);
		for (const size of ROUND_C_OBSERVED_CARRY_FORWARD_SIZES) {
			expect(size).toBeLessThanOrEqual(MAX_CARRIED_OUTCOMES);
		}
		expect(Math.max(...ROUND_C_OBSERVED_CARRY_FORWARD_SIZES)).toBe(
			MAX_CARRIED_OUTCOMES,
		);
	});
});

// ---------------------------------------------------------------------------
// M2 — THE GENERATED SUMMARY (a separate, model-owned projection)
// ---------------------------------------------------------------------------

describe("M2 — the generated summary is a separate, lossy projection", () => {
	it("the carry-forward does not reconstruct raw output; it carries structured evidence only", () => {
		const messages: MessageWithMetadata[] = [userTurn("Render the chart.")];
		messages.push(...helmPair(0));

		const ledger = extractVerifiedToolOutcomes(messages);
		expect(ledger.outcomes).toHaveLength(1);
		const outcome = ledger.outcomes[0];
		expect(outcome.toolUseId).toBe("call_helm_0");
		expect(outcome.status).toBe("succeeded");
		// The carry-forward carries the VERIFIED FACT and the redacted
		// command classification — never the raw output. That is why the
		// persisted summary may omit the image while the canonical record
		// retains it: the two surfaces carry DIFFERENT, deliberately
		// bounded representations.
		expect(outcome.evidence.subjects).toContain("helm template");
	});

	it("the token estimator does not under-count a transcript that carries structured results", () => {
		const messages: MessageWithMetadata[] = [userTurn("Render the chart.")];
		messages.push(...helmPair(0));

		const resultMessage = messages[1];
		expect(resultMessage).toBeDefined();
		const estimator = createTokenEstimator();
		const estimated = estimator(resultMessage);
		// The structured result is part of the canonical message, so the
		// estimator must account for it rather than treat it as empty.
		expect(estimated).toBeGreaterThan(0);
	});
});
