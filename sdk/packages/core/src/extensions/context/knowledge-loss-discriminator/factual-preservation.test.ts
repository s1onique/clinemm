/**
 * ACT-CLINEMM-COMPACTION-FACTUAL-PRESERVATION-REPAIR-01
 *
 * C2 — THE FACTUAL-CONSISTENCY SCORING LAYER: the adversarial witnesses.
 *
 * Every witness below is a case the reviewer named explicitly:
 *
 *   - Correct subject, wrong value.
 *   - Correct value, wrong subject.
 *   - Correct number, wrong unit.
 *   - Reversed success/failure polarity.
 *   - Missing qualification (the ONE case that is PARTIAL).
 *   - Explicit contradiction alongside a correct statement.
 *
 * Plus the RED fixture: the ACTUAL historical mistranscription, preserved as a
 * deterministic counterexample.
 */

import { describe, expect, it } from "vitest";
import {
	correctScoreForFactualVerdict,
	decideFactualVerdict,
	findFactualContradictions,
} from "./factual-preservation";
import type { KnowledgeContext } from "./inventory";
import { scoreContext } from "./inventory";
import { W1_KNOWLEDGE_ORACLE } from "./oracle";

const O7 = W1_KNOWLEDGE_ORACLE.find((item) => item.id === "O7");
const O1 = W1_KNOWLEDGE_ORACLE.find((item) => item.id === "O1");

if (!O7 || !O1) {
	throw new Error("the W1 oracle is missing a decisive item");
}

function contextWith(summary: string): KnowledgeContext {
	return {
		generatedSummary: summary,
		taskContract: "",
		verifiedOutcome: "",
		adjudication: "",
		retainedTail: "",
		evidenceBodies: "",
	};
}

describe("C2 — factual consistency scoring", () => {
	describe("the RED fixture — the historical BR mistranscription", () => {
		/**
		 * The ACTUAL sentence the predecessor's BR arm produced, verbatim.
		 *
		 * The observed socket timeout is 1000 ms. The summary published
		 * 1500 ms, which is the UNRELATED Kafka send timeout.
		 */
		const BR_SUMMARY =
			"R2: Phone-notification senders use hardcoded/default connect/socket timeouts, e.g. `NotificationServiceClient` defaults `500 ms` / `1500 ms`";

		it("classifies the mistranscription as DISTORTED, not PARTIALLY_PRESERVED", () => {
			expect(decideFactualVerdict(O7, BR_SUMMARY)).toBe("DISTORTED");
		});

		it("CORRECTS the predecessor's PARTIALLY_PRESERVED score", () => {
			const predecessor = scoreContext([O7], contextWith(BR_SUMMARY));
			expect(predecessor[0].score).toBe("PARTIALLY_PRESERVED");
			const corrected = correctScoreForFactualVerdict(
				predecessor[0].score,
				decideFactualVerdict(O7, BR_SUMMARY),
			);
			expect(corrected).toBe("DISTORTED");
		});

		it("reports the contradiction with its kind", () => {
			const contradictions = findFactualContradictions(O7, BR_SUMMARY);
			expect(contradictions.length).toBeGreaterThan(0);
			expect(contradictions.some((c) => c.kind === "WRONG_VALUE")).toBe(true);
		});

		it("does NOT contradict a summary that carries the observed value", () => {
			const CORRECT =
				"`NotificationServiceClient` defaults connect timeout 500 ms and socket timeout 1000 ms";
			expect(decideFactualVerdict(O7, CORRECT)).toBe("CONSISTENT");
		});

		it("does NOT let an unrelated subsystem's value create a contradiction", () => {
			// The Kafka send timeout is in the context, but it belongs to a
			// different subsystem, so it must not contradict the
			// notification-service socket timeout.
			const WITH_KAFKA =
				"NotificationServiceClient defaults 500 ms / 1000 ms. Separately, KC_NS_KAFKA_SEND_TIMEOUT_MS is 1500 ms.";
			expect(decideFactualVerdict(O7, WITH_KAFKA)).toBe("CONSISTENT");
		});
	});

	describe("the reviewer's adversarial cases", () => {
		it("correct subject, wrong value -> DISTORTED", () => {
			// The declaration form is what the source uses.
			const summary =
				"NotificationServiceClient: DEFAULT_SOCKET_TIMEOUT_MILLIS = 1500";
			expect(decideFactualVerdict(O7, summary)).toBe("DISTORTED");
		});

		it("a correct declaration is NOT distorted", () => {
			const summary =
				"NotificationServiceClient: DEFAULT_SOCKET_TIMEOUT_MILLIS = 1000";
			expect(decideFactualVerdict(O7, summary)).toBe("CONSISTENT");
		});

		it("a LINE NUMBER is not the relation's value", () => {
			// The canonical source format prefixes every line with its file line
			// number, so `...java:141:` must not be read as the value 141.
			const summary =
				"NotificationServiceMessageSenderServiceProvider.java:141: .socketTimeOutMillis(socketTimeoutMillis)";
			expect(decideFactualVerdict(O7, summary)).toBe("CONSISTENT");
		});

		it("a GROUPED number is read as the number it is", () => {
			// Java writes ten thousand as `10_000`. Reading it as `10` would
			// report a wrong value for a correct observation.
			const summary =
				"NotificationServiceClient: DEFAULT_SOCKET_TIMEOUT_MILLIS = 10_000";
			const contradictions = findFactualContradictions(O7, summary);
			// The value 10_000 is still a wrong value for this fact, but it must
			// be read as 10000 rather than as 10.
			expect(contradictions.length).toBeGreaterThan(0);
		});

		it("correct value, wrong subject -> not preserved", () => {
			// The value 1000 ms is asserted about the CARRIER sender, not the
			// notification-service sender.
			const summary = "The carrier sender's default socket timeout is 1000 ms";
			// The subject anchor is not present at all, so the fact cannot be
			// contradicted — the item is simply OMITTED for that fact.
			expect(decideFactualVerdict(O7, summary)).toBe("CONSISTENT");
			// ...but the predecessor's positive matcher would have credited
			// the `1000`, so the corrected score must not be PRESERVED.
			const predecessor = scoreContext([O7], contextWith(summary));
			expect(predecessor[0].score).not.toBe("PRESERVED");
		});

		it("correct number, wrong unit -> DISTORTED", () => {
			const summary =
				"NotificationServiceClient: DEFAULT_CONNECT_TIMEOUT_MILLIS = 500 s";
			const contradictions = findFactualContradictions(O7, summary);
			expect(contradictions.length).toBeGreaterThan(0);
			expect(decideFactualVerdict(O7, summary)).toBe("DISTORTED");
		});

		it("reversed success/failure polarity -> CONTRADICTED", () => {
			// O1 is a NEGATIVE fact: the first render FAILED.
			const summary = "The Helm manifest render succeeded on the first attempt";
			expect(decideFactualVerdict(O1, summary)).toBe("CONTRADICTED");
			const corrected = correctScoreForFactualVerdict(
				"PRESERVED",
				decideFactualVerdict(O1, summary),
			);
			expect(corrected).toBe("CONTRADICTED");
		});

		it("an unrelated 'succeeded' does NOT reverse the polarity", () => {
			// The carried verified-outcome section records EVERY tool call as
			// "succeeded". An unscoped opposite matcher would fire on that
			// boilerplate and report a contradiction the summary never made.
			const summary = [
				"## Verified tool outcomes (canonical record)",
				"- run_commands (call_1): succeeded",
				"- run_commands (call_2): succeeded",
				"- helm-render.test.sh is a script under tools/profiling/tests/",
			].join("\n");
			expect(decideFactualVerdict(O1, summary)).toBe("CONSISTENT");
		});

		it("missing qualification -> remains PARTIALLY_PRESERVED", () => {
			// The proposition is present, but the material qualification
			// ("defaults are not proven to be the effective production
			// values") is not. This is the ONE case that is PARTIAL.
			const summary =
				"`NotificationServiceClient` defaults connect timeout 500 ms and socket timeout 1000 ms";
			const predecessor = scoreContext([O7], contextWith(summary));
			expect(predecessor[0].score).toBe("PARTIALLY_PRESERVED");
			const corrected = correctScoreForFactualVerdict(
				predecessor[0].score,
				decideFactualVerdict(O7, summary),
			);
			expect(corrected).toBe("PARTIALLY_PRESERVED");
		});

		it("explicit contradiction alongside a correct statement is NOT concealed", () => {
			// The context carries BOTH the correct value AND a wrong one for
			// the same subject. The presence of the correct keyword must not
			// conceal the contradiction.
			const summary =
				"NotificationServiceClient: DEFAULT_SOCKET_TIMEOUT_MILLIS = 1000\n" +
				"NotificationServiceClient: DEFAULT_SOCKET_TIMEOUT_MILLIS = 1500";
			const predecessor = scoreContext([O7], contextWith(summary));
			const corrected = correctScoreForFactualVerdict(
				predecessor[0].score,
				decideFactualVerdict(O7, summary),
			);
			expect(corrected).toBe("DISTORTED");
			expect(corrected).not.toBe("PARTIALLY_PRESERVED");
		});
	});

	describe("conservation — the layer never promotes a score", () => {
		it("a CONSISTENT verdict leaves every score unchanged", () => {
			const summary =
				"`NotificationServiceClient` defaults connect timeout 500 ms and socket timeout 1000 ms";
			const predecessor = scoreContext([O7], contextWith(summary));
			for (const score of predecessor) {
				expect(
					correctScoreForFactualVerdict(
						score.score,
						decideFactualVerdict(O7, summary),
					),
				).toBe(score.score);
			}
		});

		it("an OMISSED item stays OMITTED — the layer cannot fabricate", () => {
			const predecessor = scoreContext([O7], contextWith("nothing here"));
			expect(predecessor[0].score).toBe("OMITTED");
			expect(
				correctScoreForFactualVerdict(
					predecessor[0].score,
					decideFactualVerdict(O7, "nothing here"),
				),
			).toBe("OMITTED");
		});
	});
});
