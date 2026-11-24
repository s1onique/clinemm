/**
 * ACT-CLINEMM-COMPACTION-TASK-CONDITIONED-EVIDENCE-SELECTION-01
 *
 * C2.4 — THE SCORING-SCOPE WITNESSES.
 *
 * ============================================================================
 * THE QUESTION
 * ============================================================================
 *
 * The ACT asks: "Inspect whether the factual-consistency scorer evaluates
 * every relevant continuation component or only generatedSummary."
 *
 * The answer was: ONLY `generatedSummary`. And the decomposition that
 * produced `generatedSummary` did not strip the SOURCE-BOUND EVIDENCE
 * section, so the carried section's verbatim excerpts were attributed to
 * the MODEL.
 *
 * ============================================================================
 * WHY THAT MATTERS
 * ============================================================================
 *
 * Two distinct errors follow from one mistake:
 *
 *   1. ATTRIBUTION. The carried section's bytes were credited to the
 *      summarizer. A proposition that the runtime supplied verbatim was
 *      reported as `suppliedBy: ["generated_summary"]`.
 *
 *   2. MASKING — the more serious one. The factual-consistency scorer
 *      runs over `generatedSummary`. If the carried section's text was
 *      inside it, then a summarizer that WROTE A CONTRADICTION could have
 *      that contradiction sit next to a carried excerpt that states the
 *      CORRECT value, and the contradiction check would see the correct
 *      value and report CONSISTENT. The carried section would HIDE the
 *      summarizer's own distortion.
 *
 * That is precisely the failure mode this ACT exists to detect: the
 * predecessor's mistranscription mode was the summarizer writing a
 * neighbouring subject's value. A masked contradiction would make the
 * measurement blind to exactly that.
 *
 * ============================================================================
 * THE DECISIVE ORACLE
 * ============================================================================
 *
 * The ACT names the decisive oracle: "Use direct inspection of O1/O4/O7
 * source relationships as the decisive oracle."
 *
 * These witnesses therefore assert the SCORER'S SCOPE directly — that the
 * assembled continuation is evaluated, that each component is attributed to
 * its own mechanism, and that the model-authored component is judged on its
 * OWN bytes.
 */

import type { MessageWithMetadata } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	decomposeProviderContinuation,
	generatedSummaryProse,
} from "./context-parts";
import { decideFactualVerdict } from "./factual-preservation";
import { scoreContext } from "./inventory";
import { W1_KNOWLEDGE_ORACLE } from "./oracle";

const O7 = W1_KNOWLEDGE_ORACLE.find((item) => item.id === "O7");
const O1 = W1_KNOWLEDGE_ORACLE.find((item) => item.id === "O1");
const O4 = W1_KNOWLEDGE_ORACLE.find((item) => item.id === "O4");

if (!O7 || !O1 || !O4) {
	throw new Error("the W1 oracle is missing a decisive item");
}

const SOURCE_BOUND_BEGIN = "<!-- cline-source-evidence:begin -->";
const SOURCE_BOUND_END = "<!-- cline-source-evidence:end -->";

function summaryMessage(summary: string): MessageWithMetadata {
	return {
		role: "user",
		content: [{ type: "text", text: `Context summary:\n\n${summary}` }],
		metadata: {
			kind: "compaction_summary",
			displayRole: "system",
			summary,
			details: { readFiles: [], modifiedFiles: [] },
			tokensBefore: 0,
			generatedAt: 0,
		},
	} as unknown as MessageWithMetadata;
}

describe("C2.4 — the scoring-scope witnesses", () => {
	describe("the decomposition", () => {
		it("attributes the source-bound evidence section to its OWN mechanism", () => {
			const summary = [
				"## Goal\nwork",
				"## Source-bound evidence (canonical excerpts, verbatim)",
				SOURCE_BOUND_BEGIN,
				"- [OBSERVED_EXCERPT] src/a.java (succeeded): value = 42",
				SOURCE_BOUND_END,
			].join("\n");
			const context = decomposeProviderContinuation([summaryMessage(summary)]);
			expect(context.sourceBoundEvidence).toContain("value = 42");
			// The carried section's bytes must NOT be in the model's prose.
			expect(context.generatedSummary).not.toContain("value = 42");
		});

		it("strips the source-bound evidence section from the generated prose", () => {
			const summary = [
				"## Goal\nwork",
				SOURCE_BOUND_BEGIN,
				"- [OBSERVED_EXCERPT] src/a.java (succeeded): value = 42",
				SOURCE_BOUND_END,
			].join("\n");
			const prose = generatedSummaryProse(summary);
			expect(prose).not.toContain("value = 42");
			expect(prose).toContain("## Goal");
		});

		it("leaves the OTHER carried sections attributed to their own mechanisms", () => {
			const summary = [
				"## Goal\nwork",
				"<!-- cline-evidence:begin -->",
				"- run_commands (call_1): succeeded",
				"<!-- cline-evidence:end -->",
				"<!-- cline-task-contract:begin -->",
				"contract",
				"<!-- cline-task-contract:end -->",
				SOURCE_BOUND_BEGIN,
				"- [OBSERVED_EXCERPT] src/a.java (succeeded): value = 42",
				SOURCE_BOUND_END,
			].join("\n");
			const context = decomposeProviderContinuation([summaryMessage(summary)]);
			expect(context.verifiedOutcome).toContain("run_commands");
			expect(context.taskContract).toContain("contract");
			expect(context.sourceBoundEvidence).toContain("value = 42");
			expect(context.generatedSummary).not.toContain("value = 42");
			expect(context.generatedSummary).not.toContain("run_commands");
		});
	});

	describe("the decisive O1/O4/O7 oracle — direct source inspection", () => {
		it("scores a carried excerpt through its OWN mechanism, not the model's", () => {
			// A carried excerpt that states the O7 value. The model's prose is
			// EMPTY. The proposition must be attributed to the carried
			// mechanism, never to the model.
			const summary = [
				"## Goal\nwork",
				SOURCE_BOUND_BEGIN,
				"- [OBSERVED_EXCERPT] src/a.java (succeeded): DEFAULT_SOCKET_TIMEOUT_MILLIS = 1000",
				SOURCE_BOUND_END,
			].join("\n");
			const context = decomposeProviderContinuation([summaryMessage(summary)]);
			const scores = scoreContext(W1_KNOWLEDGE_ORACLE, context);
			const o7 = scores.find((entry) => entry.oracleItemId === "O7");
			expect(o7).toBeDefined();
			// The attribution must include the carried mechanism and must NOT
			// claim the model wrote it.
			expect(o7?.suppliedBy).toContain("source_bound_evidence");
			expect(o7?.suppliedBy).not.toContain("generated_summary");
		});

		it("does NOT let a carried excerpt MASK a summarizer contradiction", () => {
			// The model's prose asserts the WRONG value — the predecessor's
			// exact mistranscription mode, verbatim from the historical RED
			// fixture. The carried section states the CORRECT value.
			//
			// Before the repair, the contradiction check ran over a text that
			// contained BOTH, so it saw the correct value and reported
			// CONSISTENT. The carried section HID the summarizer's own
			// distortion — which is the exact failure mode this ACT exists to
			// detect.
			const summary = [
				"## Goal\nwork",
				"R2: Phone-notification senders use hardcoded/default connect/socket timeouts, e.g. `NotificationServiceClient` defaults `500 ms` / `1500 ms`",
				SOURCE_BOUND_BEGIN,
				"- [OBSERVED_EXCERPT] src/a.java (succeeded): DEFAULT_SOCKET_TIMEOUT_MILLIS = 1000",
				SOURCE_BOUND_END,
			].join("\n");
			const context = decomposeProviderContinuation([summaryMessage(summary)]);
			// The MODEL's own bytes are judged on their own.
			expect(decideFactualVerdict(O7, context.generatedSummary)).toBe(
				"DISTORTED",
			);
			// And the carried mechanism still supplies the correct value.
			expect(context.sourceBoundEvidence).toContain("1000");
		});

		it("scores the assembled continuation, not only the model's prose", () => {
			// The proposition is supplied ONLY by the carried section. The
			// model's prose does not state it. The score must therefore be a
			// preservation — because the ASSEMBLED continuation supplies it —
			// and not an omission.
			const summary = [
				"## Goal\nwork",
				SOURCE_BOUND_BEGIN,
				"- [OBSERVED_EXCERPT] src/a.java (succeeded): DEFAULT_SOCKET_TIMEOUT_MILLIS = 1000",
				SOURCE_BOUND_END,
			].join("\n");
			const context = decomposeProviderContinuation([summaryMessage(summary)]);
			const scores = scoreContext(W1_KNOWLEDGE_ORACLE, context);
			const o7 = scores.find((entry) => entry.oracleItemId === "O7");
			expect(o7?.score).not.toBe("OMITTED");
		});
	});
});
