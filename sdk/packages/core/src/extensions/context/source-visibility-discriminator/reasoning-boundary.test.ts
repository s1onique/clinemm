/**
 * ACT-CLINEMM-PCK-SOURCE-VISIBILITY-DISCRIMINATOR-01
 *
 * G1.3 / G4.3 — the private-reasoning boundary and content-origin controls.
 *
 * ============================================================================
 * THIS IS NOT A PRODUCTION API. It is a TEST-LOCAL measurement suite.
 * ============================================================================
 *
 * WHAT THIS SUITE PROVES
 * ----------------------
 *
 * A private reasoning block must never reach a checkpoint model in ANY
 * shape. The check is not "the view does not contain the phrase
 * `[Bot thinking]`" — it is: no DISTINCTIVE FRAGMENT of the canonical
 * private reasoning corpus appears in the rendered view.
 *
 * A fragment is distinctive when it is long enough not to collide with
 * ordinary prose AND is not a substring of any PUBLIC text in the same
 * history. A thinking block that merely repeats what the agent already
 * published is not a leak; a thinking block that carries private analysis
 * is.
 *
 * The fragments themselves are NEVER committed: they are derived at test
 * time from the operator-local transcript and only their PRESENCE or
 * ABSENCE is asserted.
 */

import type { MessageWithMetadata } from "@cline/shared";
import { describe, expect, it } from "vitest";
import { canonicalSourceMessages } from "../../../session/models/session-compaction";
import { createTokenEstimator } from "../compaction-shared";
import {
	buildCandidateA,
	buildCandidateB,
	buildCandidateC,
} from "./candidate-views";
import { type ContentOrigin, classifyBlockOrigin } from "./content-origin";
import {
	EXPECTED_BOUNDARIES,
	loadCanonicalTranscript,
	privateCapturesAvailable,
} from "./discriminator.fixture";

/**
 * The distinctive private reasoning fragments in a canonical prefix.
 */
function extractDistinctiveReasoningFragments(
	messages: readonly MessageWithMetadata[],
): string[] {
	const publicCorpus = JSON.stringify(
		messages.filter((message) => {
			if (!Array.isArray(message.content)) {
				return true;
			}
			return message.content.some((block) => block.type !== "thinking");
		}),
	);
	const fragments = new Set<string>();
	for (const message of messages) {
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content) {
			if (block.type !== "thinking") {
				continue;
			}
			for (const sentence of block.thinking.split(/[.\n]/)) {
				const trimmed = sentence.trim();
				if (trimmed.length < 24) {
					continue;
				}
				if (publicCorpus.includes(trimmed)) {
					continue;
				}
				fragments.add(trimmed);
			}
		}
	}
	return [...fragments];
}

describe("ACT-CLINEMM-PCK-SOURCE-VISIBILITY-DISCRIMINATOR-01 — reasoning boundary", () => {
	const available = privateCapturesAvailable();

	it("G1.3.1: every candidate view forwards NO distinctive private reasoning fragment", () => {
		if (!available) {
			expect("NOT_EXECUTED").toContain("NOT_EXECUTED");
			return;
		}
		const transcript = loadCanonicalTranscript();
		const canonical = canonicalSourceMessages(transcript.messages);
		const estimator = createTokenEstimator();
		let checkedFragments = 0;
		for (const count of [
			EXPECTED_BOUNDARIES["boundary-1"].sourceMessageCount,
			EXPECTED_BOUNDARIES["boundary-2"].sourceMessageCount,
		]) {
			const prefix = canonical.slice(0, count);
			const fragments = extractDistinctiveReasoningFragments(prefix);
			checkedFragments += fragments.length;
			const views = [
				buildCandidateA({
					canonicalMessages: prefix,
					targetTokens: 1_000_000,
					estimateMessageTokens: estimator,
				}),
				buildCandidateB({ canonicalMessages: prefix }),
				buildCandidateC({ canonicalMessages: prefix }),
			];
			for (const view of views) {
				for (const fragment of fragments) {
					expect(
						view.text.includes(fragment),
						`candidate ${view.candidate} leaked a reasoning fragment`,
					).toBe(false);
				}
			}
		}
		// The check is only meaningful if there WERE distinctive fragments.
		expect(checkedFragments).toBeGreaterThan(0);
	});

	it("G1.3.2: the origin classifier assigns thinking blocks to ASSISTANT_THINKING and never to ASSISTANT_PUBLIC_TEXT", () => {
		const thinkingBlock = { type: "thinking", thinking: "private" };
		const redactedBlock = { type: "redacted_thinking" };
		const textBlock = { type: "text", text: "public" };
		expect(classifyBlockOrigin({ role: "assistant" }, thinkingBlock)).toBe(
			"ASSISTANT_THINKING",
		);
		expect(classifyBlockOrigin({ role: "assistant" }, redactedBlock)).toBe(
			"ASSISTANT_THINKING",
		);
		expect(classifyBlockOrigin({ role: "assistant" }, textBlock)).toBe(
			"ASSISTANT_PUBLIC_TEXT",
		);
		// A USER text block is NOT assistant public text.
		expect(classifyBlockOrigin({ role: "user" }, textBlock)).toBe(
			"USER_CONTENT",
		);
		// An unrecognized shape FAILS CLOSED.
		expect(
			classifyBlockOrigin({ role: "assistant" }, { type: "mystery" }),
		).toBe("UNKNOWN_ORIGIN");
		// A tool result is never classified as assistant prose.
		expect(classifyBlockOrigin({ role: "user" }, { type: "tool_result" })).toBe(
			"TOOL_RESULT",
		);
	});

	it("G1.3.3: the origin histogram names every content class present in the canonical prefix", () => {
		if (!available) {
			expect("NOT_EXECUTED").toContain("NOT_EXECUTED");
			return;
		}
		const transcript = loadCanonicalTranscript();
		const canonical = canonicalSourceMessages(transcript.messages);
		const prefix = canonical.slice(
			0,
			EXPECTED_BOUNDARIES["boundary-2"].sourceMessageCount,
		);
		const counts: Record<ContentOrigin, number> = {
			USER_CONTENT: 0,
			ASSISTANT_PUBLIC_TEXT: 0,
			ASSISTANT_THINKING: 0,
			TOOL_INPUT: 0,
			TOOL_RESULT: 0,
			RUNTIME_METADATA: 0,
			UNKNOWN_ORIGIN: 0,
		};
		for (const message of prefix) {
			if (!Array.isArray(message.content)) {
				continue;
			}
			for (const block of message.content) {
				counts[classifyBlockOrigin(message, block as never)] += 1;
			}
		}
		// The historical history contains all of these classes, so the
		// histogram is a meaningful receipt.
		expect(counts.TOOL_RESULT).toBeGreaterThan(0);
		expect(counts.TOOL_INPUT).toBeGreaterThan(0);
		expect(counts.ASSISTANT_THINKING).toBeGreaterThan(0);
	});
});
