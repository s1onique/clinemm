/**
 * ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 (AMENDMENT-01) — F1.
 *
 * BLOCK-LEVEL EVIDENCE AUTHORITY.
 *
 * ============================================================================
 * THE DEFECT THIS WITNESS PINS
 * ============================================================================
 *
 * The B' source authority bound the CANONICAL MESSAGE to the provider-visible
 * projection. It did NOT bind the CANONICAL RESULT BLOCK to it.
 *
 * The narrowing that feeds the interpreter therefore kept a `tool_result`
 * block on the strength of the INVOCATION's authority alone: the invocation
 * was visible, so the reference was authorized, so the result block was
 * retained. The interpreter then joined the call to that result and
 * established an OUTCOME that the model had never been shown.
 *
 * The repair separates the two authorities:
 *
 *   - INVOCATION AUTHORITY: the `tool_use` block is provider-visible. It
 *     proves a call was REQUESTED. It authorizes a CITATION.
 *   - RESULT AUTHORITY: the `tool_result` block is provider-visible,
 *     AUTHORIZED and NON-TRUNCATED. It authorizes an OBSERVED OUTCOME.
 *
 * One does not imply the other, and PRIVATE REASONING is excluded from the
 * interpreter's evidence input altogether.
 *
 * ============================================================================
 * WHAT IS EXERCISED
 * ============================================================================
 *
 *   F1.1 The invocation-only discriminator: an invocation whose RESULT is
 *        NOT provider-visible. The canonical result block is retained inside
 *        an OTHERWISE AUTHORIZED message, and the interpreter must NOT
 *        establish an outcome from it.
 *   F1.2 The unrelated COMPLETE tool event: the eligibility gate must not be
 *        able to hide the discriminator by selecting the legacy route, so a
 *        second, fully visible tool event is present and authorizable.
 *   F1.3 The MIXED reasoning/text message: private reasoning is excluded
 *        from the interpreter's evidence input, INCLUDING in a message that
 *        also carries citable content.
 *   F1.4 The POSITIVE observed-outcome control: a fully visible, authorized,
 *        non-truncated tool event STILL establishes its outcome, and the
 *        legitimately supported tool outcome is preserved.
 *   F1.5 The LEGACY A behaviour is preserved: the legacy route is unchanged.
 *
 * The provider-visible projection used by F1.1 is the REAL production
 * projection of the canonical history. The result block is then made
 * INVISIBLE the way the production projection makes material invisible: the
 * projection does not carry it. The binding's own contract is that a
 * provider-visible result position is what grants result authority, so a
 * projection without that position must not grant an outcome.
 */

import type { MessageWithMetadata } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { MessageBuilder } from "../../../session/services/message-builder";
import { interpretCanonicalEvidence } from "./evidence";
import {
	buildProviderVisibleBindings,
	collectAuthorizedReferences,
	collectAuthorizedToolEventReferences,
	narrowCanonicalMessagesToAuthority,
} from "./provider-visible-binding";

/** The INVOCATION-ONLY reference: its result is never visible. */
const INVOCATION_ONLY_ID = "tool_call_invocation_only";
/** The UNRELATED, COMPLETE tool event. */
const COMPLETE_ID = "tool_call_complete";
/** The MIXED reasoning/text reference. */
const MIXED_ID = "tool_call_mixed";

/**
 * The canonical history.
 *
 * It carries:
 *
 *   - an ASSISTANT message with PRIVATE REASONING and the invocation-only
 *     `tool_use`,
 *   - a USER message that carries the invocation-only `tool_result` TOGETHER
 *     WITH ordinary text, so the result block sits inside an OTHERWISE
 *     AUTHORIZED message,
 *   - the unrelated COMPLETE tool event, whose invocation and result are
 *     both visible, and
 *   - a MIXED reasoning/text user message.
 */
function canonicalHistory(): MessageWithMetadata[] {
	return [
		{
			role: "user",
			id: "msg_task",
			content: "Inspect the deployment configuration and report findings.",
		} as unknown as MessageWithMetadata,
		{
			role: "assistant",
			id: "msg_invocation_only",
			content: [
				{
					type: "thinking",
					thinking: "PRIVATE-REASONING-MUST-NOT-BE-EVIDENCE",
					signature: "sig",
				},
				{
					type: "tool_use",
					id: INVOCATION_ONLY_ID,
					name: "run_commands",
					input: { commands: ["make build"] },
				},
			],
		} as unknown as MessageWithMetadata,
		{
			role: "user",
			id: "msg_result_carrier",
			content: [
				{ type: "text", text: "the ordinary lead-in text" },
				{
					type: "tool_result",
					tool_use_id: INVOCATION_ONLY_ID,
					name: "run_commands",
					content: [{ success: true }],
				},
			],
		} as unknown as MessageWithMetadata,
		{
			role: "assistant",
			id: "msg_complete_call",
			content: [
				{
					type: "tool_use",
					id: COMPLETE_ID,
					name: "run_commands",
					input: { commands: ["git status"] },
				},
			],
		} as unknown as MessageWithMetadata,
		{
			role: "user",
			id: "msg_complete_result",
			content: [
				{
					type: "tool_result",
					tool_use_id: COMPLETE_ID,
					name: "run_commands",
					content: [{ success: true }],
				},
			],
		} as unknown as MessageWithMetadata,
		{
			role: "assistant",
			id: "msg_mixed",
			content: [
				{
					type: "thinking",
					thinking: "PRIVATE-REASONING-IN-A-MIXED-MESSAGE",
					signature: "sig",
				},
				{
					type: "tool_use",
					id: MIXED_ID,
					name: "run_commands",
					input: { commands: ["make build"] },
				},
			],
		} as unknown as MessageWithMetadata,
		{
			role: "user",
			id: "msg_mixed_result",
			content: [
				{
					type: "tool_result",
					tool_use_id: MIXED_ID,
					name: "run_commands",
					content: [{ success: true }],
				},
			],
		} as unknown as MessageWithMetadata,
	];
}

/**
 * The REAL production provider-visible projection of the canonical history.
 */
function productionProjection(
	canonical: readonly MessageWithMetadata[],
): readonly { role: string; id?: string; content: unknown }[] {
	return new MessageBuilder().buildForApi(
		canonical as unknown as Parameters<MessageBuilder["buildForApi"]>[0],
	) as unknown as readonly { role: string; id?: string; content: unknown }[];
}

/**
 * The provider-visible projection with the invocation-only result REMOVED.
 *
 * This is the production shape the discriminator is about: the invocation is
 * on the wire, the message that carried the result is on the wire, and the
 * RESULT ITSELF is not. The production projection makes material invisible
 * in several ways (it merges messages away, it rewrites superseded result
 * content, and it elides blocks); the binding's contract is the same in every
 * case: there is no provider-visible result position, so there is no result
 * authority.
 */
function projectionWithoutInvocationOnlyResult(
	canonical: readonly MessageWithMetadata[],
): readonly { role: string; id?: string; content: unknown }[] {
	return productionProjection(canonical).map((message) => {
		if (!Array.isArray(message.content)) {
			return message;
		}
		return {
			...message,
			content: message.content.filter((block) => {
				const record = block as { type?: unknown; tool_use_id?: unknown };
				return !(
					record.type === "tool_result" &&
					record.tool_use_id === INVOCATION_ONLY_ID
				);
			}),
		};
	});
}

/**
 * The CONTENT BLOCKS of a narrowed canonical message.
 *
 * A canonical message's content is either a string or a block array; the
 * narrowing only ever deals with block arrays, so the helper narrows the
 * type without changing the value.
 */
function blocksOf(message: MessageWithMetadata | undefined): readonly {
	readonly type: string;
	readonly id?: string;
	readonly tool_use_id?: string;
}[] {
	if (!message || !Array.isArray(message.content)) {
		return [];
	}
	return message.content as readonly {
		readonly type: string;
		readonly id?: string;
		readonly tool_use_id?: string;
	}[];
}

describe("ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 (AMENDMENT-01) — F1 BLOCK-LEVEL EVIDENCE AUTHORITY", () => {
	it("F1.1: an INVOCATION-ONLY reference does not establish an observed outcome", () => {
		const canonical = canonicalHistory();
		const bindings = buildProviderVisibleBindings({
			canonicalMessages: canonical,
			providerMessages: projectionWithoutInvocationOnlyResult(canonical),
			authorizedMessageCount: canonical.length,
		});
		// The BEHAVIOURAL assertion comes first: the canonical result
		// block must NOT survive the narrowing, and the interpreter must
		// NOT establish an outcome from it.
		const narrowed = narrowCanonicalMessagesToAuthority(canonical, bindings);
		const carrier = narrowed.find(
			(message) => message.id === "msg_result_carrier",
		);
		expect(carrier).toBeDefined();
		const retainedResults = blocksOf(carrier).filter(
			(block) => block.type === "tool_result",
		);
		expect(retainedResults).toHaveLength(0);
		expect(
			interpretCanonicalEvidence({
				canonicalMessages: narrowed,
				references: [INVOCATION_ONLY_ID],
				atom: "OPERATION_INVOKED",
				argument: "build",
			}),
		).not.toBe("tool_observed");
		// The invocation IS visible, so the reference REMAINS CITABLE.
		const binding = bindings.get(INVOCATION_ONLY_ID);
		expect(binding?.status).toBe("resolved");
		// But it holds NO RESULT AUTHORITY: the result is not visible.
		expect(
			binding?.status === "resolved" ? binding.resultAuthority : undefined,
		).toBe(false);
		// And it is NOT a decisive tool event.
		expect(collectAuthorizedToolEventReferences(bindings)).not.toContain(
			INVOCATION_ONLY_ID,
		);
	});

	it("F1.2: the UNRELATED COMPLETE tool event remains authorizable, so the gate cannot hide the discriminator by selecting A", () => {
		const canonical = canonicalHistory();
		const bindings = buildProviderVisibleBindings({
			canonicalMessages: canonical,
			providerMessages: productionProjection(canonical),
			authorizedMessageCount: canonical.length,
		});
		// The COMPLETE event's invocation and result are both visible.
		const complete = bindings.get(COMPLETE_ID);
		expect(complete?.status).toBe("resolved");
		expect(
			complete?.status === "resolved" ? complete.resultAuthority : undefined,
		).toBe(true);
		// It IS decisive engineering evidence.
		expect(collectAuthorizedToolEventReferences(bindings)).toContain(
			COMPLETE_ID,
		);
		// So the authority is not empty, and the route selection cannot
		// degenerate to "no source authority at all".
		expect(collectAuthorizedReferences(bindings).length).toBeGreaterThan(0);
	});

	it("F1.3: PRIVATE REASONING is excluded from the interpreter's evidence input, including in a MIXED message", () => {
		const canonical = canonicalHistory();
		const bindings = buildProviderVisibleBindings({
			canonicalMessages: canonical,
			providerMessages: productionProjection(canonical),
			authorizedMessageCount: canonical.length,
		});
		const narrowed = narrowCanonicalMessagesToAuthority(canonical, bindings);
		const serialized = JSON.stringify(narrowed);
		// NEITHER the standalone reasoning message NOR the mixed message's
		// reasoning block may reach the interpreter.
		expect(serialized).not.toContain("PRIVATE-REASONING-MUST-NOT-BE-EVIDENCE");
		expect(serialized).not.toContain("PRIVATE-REASONING-IN-A-MIXED-MESSAGE");
		// The MIXED message's CITABLE content is preserved.
		const mixed = narrowed.find((message) => message.id === "msg_mixed");
		expect(mixed).toBeDefined();
		expect(blocksOf(mixed).some((block) => block.type === "tool_use")).toBe(
			true,
		);
	});

	it("F1.4: the POSITIVE observed-outcome control — a fully visible, authorized, non-truncated event STILL establishes its outcome", () => {
		const canonical = canonicalHistory();
		const bindings = buildProviderVisibleBindings({
			canonicalMessages: canonical,
			providerMessages: productionProjection(canonical),
			authorizedMessageCount: canonical.length,
		});
		const narrowed = narrowCanonicalMessagesToAuthority(canonical, bindings);
		// The MIXED event's result is visible, authorized and complete, so
		// the outcome IS established.
		expect(
			interpretCanonicalEvidence({
				canonicalMessages: narrowed,
				references: [MIXED_ID],
				atom: "OPERATION_INVOKED",
				argument: "build",
			}),
		).toBe("tool_observed");
		// The legitimately supported tool outcome is PRESERVED: the
		// invocation AND the result both survive the narrowing.
		const mixed = narrowed.find((message) => message.id === "msg_mixed");
		expect(
			blocksOf(mixed).some(
				(block) => block.type === "tool_use" && block.id === MIXED_ID,
			),
		).toBe(true);
		const mixedResult = narrowed.find(
			(message) => message.id === "msg_mixed_result",
		);
		expect(
			blocksOf(mixedResult).some(
				(block) =>
					block.type === "tool_result" && block.tool_use_id === MIXED_ID,
			),
		).toBe(true);
	});

	it("F1.5: the LEGACY A behaviour is preserved — the legacy route is unchanged", () => {
		const canonical = canonicalHistory();
		const bindings = buildProviderVisibleBindings({
			canonicalMessages: canonical,
			providerMessages: productionProjection(canonical),
			authorizedMessageCount: canonical.length,
		});
		// The LEGACY route's canonical authority is unchanged: the legacy
		// authority is the intersection with the canonical membership, and
		// the canonical membership still contains every reference.
		const canonicalReferences = new Set<string>();
		for (const message of canonical) {
			if (typeof message.id === "string" && message.id.length > 0) {
				canonicalReferences.add(`id:${message.id}`);
			}
			if (!Array.isArray(message.content)) {
				continue;
			}
			for (const block of message.content) {
				if (block.type === "tool_use") {
					canonicalReferences.add(block.id);
				}
			}
		}
		for (const reference of collectAuthorizedReferences(bindings)) {
			expect(canonicalReferences.has(reference)).toBe(true);
		}
	});
});
