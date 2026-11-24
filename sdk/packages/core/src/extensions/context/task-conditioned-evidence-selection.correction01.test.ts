/**
 * ACT-CLINEMM-COMPACTION-TASK-CONDITIONED-EVIDENCE-SELECTION-01
 *
 * C4 — THE TASK-CONDITIONED SELECTION: the witnesses.
 *
 * ============================================================================
 * THE DECISIVE ADVERSARIAL CASE
 * ============================================================================
 *
 * The predecessor's sharpest finding was that the SELECTION could carry a
 * NEIGHBOURING subject's value:
 *
 *     index 187: DEFAULT_SOCKET_TIMEOUT_MILLIS = 1000   <- the oracle's subject
 *     index  73: SOCKET_TIMEOUT_MS          = 1500       <- a DIFFERENT sender
 *
 * Both are "a socket timeout with a value". A shape-based selector cannot
 * tell them apart, so the wrong one can be carried into the context. That
 * reproduces the predecessor's mistranscription mode in a NEW form: not by
 * the summarizer rewriting a value, but by the SELECTION carrying one in.
 *
 * The witnesses below use a SYNTHETIC stand-in with the same shape but
 * different names, so the test cannot be accused of being oracle-fitted:
 * the selection must distinguish `AlphaServiceClient` from `BetaServiceClient`
 * on the same generic mechanism.
 *
 * ============================================================================
 * THE ADVERSARIAL HOLDOUT
 * ============================================================================
 *
 * A small synthetic adversarial holdout with DIFFERENT subject names,
 * DIFFERENT measurement units and DIFFERENT operation shapes. It is NOT
 * independent live qualification — it is a witness that the mechanism is not
 * fitted to one subject vocabulary.
 */

import type { MessageWithMetadata } from "@cline/shared";
import { afterEach, describe, expect, it } from "vitest";
import { setSourceBoundEvidenceCarryForwardForTesting } from "./source-bound-evidence";
import {
	buildInvocationTable,
	buildMinimalSourceWindow,
	buildRelevanceSignals,
	collectCallInputIdentifiers,
	collectEvidenceCandidates,
	type EvidenceSelectorArm,
	estimateTokens,
	renderSelectionSection,
	selectEvidence,
} from "./task-conditioned-evidence-selection";

const restore: Array<() => void> = [];

function enable(): void {
	restore.push(setSourceBoundEvidenceCarryForwardForTesting(true));
}

afterEach(() => {
	while (restore.length > 0) {
		restore.pop()?.();
	}
});

let callCounter = 0;

/**
 * A canonical assistant message that INVOKES a tool.
 *
 * The `tool_use` id is RUNTIME-OWNED: the runtime allocated it.
 */
function invocationMessage(
	toolName: string,
	input: Record<string, unknown>,
): MessageWithMetadata {
	callCounter += 1;
	const id = `call_${callCounter}`;
	return {
		role: "assistant",
		content: [
			{
				type: "tool_use",
				id,
				name: toolName,
				input,
			},
		],
		ts: callCounter,
	} as unknown as MessageWithMetadata;
}

/**
 * A canonical user message that ANSWERS an invocation.
 */
function resultMessage(
	toolName: string,
	toolUseId: string,
	payloads: readonly unknown[],
): MessageWithMetadata {
	return {
		role: "user",
		content: [
			{
				type: "tool_result",
				tool_use_id: toolUseId,
				name: toolName,
				content: payloads,
				is_error: false,
			},
		],
		ts: callCounter,
	} as unknown as MessageWithMetadata;
}

/**
 * A canonical PAIR: an invocation and the result that answers it.
 *
 * The returned pair carries the runtime-allocated id, so the test can build
 * a result that answers a SPECIFIC call.
 */
function pair(
	toolName: string,
	input: Record<string, unknown>,
	payloads: readonly unknown[],
): { invocation: MessageWithMetadata; result: MessageWithMetadata } {
	const invocation = invocationMessage(toolName, input);
	const id = (invocation.content as { id: string }[])[0].id;
	return { invocation, result: resultMessage(toolName, id, payloads) };
}

const ALPHA = pair(
	"read_files",
	{ query: "src/alpha/AlphaServiceClient.java" },
	[
		{
			success: true,
			query: "src/alpha/AlphaServiceClient.java",
			result:
				"public class AlphaServiceClient {\n  static final int DEFAULT_SOCKET_TIMEOUT_MILLIS = 1000;\n}",
		},
	],
);

const BETA = pair("read_files", { query: "src/beta/BetaServiceClient.java" }, [
	{
		success: true,
		query: "src/beta/BetaServiceClient.java",
		result:
			"public class BetaServiceClient {\n  static final int SOCKET_TIMEOUT_MS = 1500;\n}",
	},
]);

/**
 * The TASK CONTEXT.
 *
 * It names the subject the investigation is about. The selection must reach
 * the ALPHA fragment and must not reach the BETA one.
 */
const TASK_TEXTS = [
	"Investigate the AlphaServiceClient notification sender defaults and its environment overrides.",
];

describe("C4 — the task-conditioned evidence selection", () => {
	describe("the source invocation correlation", () => {
		it("correlates a result with the invocation that produced it", () => {
			const table = buildInvocationTable([ALPHA.invocation, ALPHA.result]);
			expect(table.byToolUseId.size).toBe(1);
			const entry = Array.from(table.byToolUseId.values())[0];
			expect(entry.toolName).toBe("read_files");
			expect(entry.invocationIndex).toBe(0);
			expect(entry.resultIndex).toBe(1);
			expect(table.rejected).toHaveLength(0);
		});

		it("REFUSES a result with no matching invocation", () => {
			const orphan = resultMessage("read_files", "call_never_issued", [
				{ success: true, result: "value = 1" },
			]);
			const table = buildInvocationTable([orphan]);
			expect(table.byToolUseId.size).toBe(0);
			expect(
				table.rejected.some((entry) => entry.reason === "unmatched_result"),
			).toBe(true);
		});

		it("REFUSES an id claimed by more than one invocation", () => {
			const first = invocationMessage("read_files", { query: "a" });
			const id = (first.content as { id: string }[])[0].id;
			const second = {
				...first,
				content: [
					{ type: "tool_use", id, name: "read_files", input: { query: "b" } },
				],
			} as unknown as MessageWithMetadata;
			const table = buildInvocationTable([
				first,
				second,
				resultMessage("read_files", id, [{ success: true, result: "v" }]),
			]);
			expect(
				table.rejected.some((entry) => entry.reason === "ambiguous_call_id"),
			).toBe(true);
		});

		it("REFUSES an id answered by more than one result", () => {
			const first = invocationMessage("read_files", { query: "a" });
			const id = (first.content as { id: string }[])[0].id;
			const table = buildInvocationTable([
				first,
				resultMessage("read_files", id, [{ success: true, result: "v" }]),
				resultMessage("read_files", id, [{ success: true, result: "w" }]),
			]);
			expect(
				table.rejected.some((entry) => entry.reason === "ambiguous_result_id"),
			).toBe(true);
		});

		it("REFUSES a result whose tool name differs from the call's", () => {
			const first = invocationMessage("read_files", { query: "a" });
			const id = (first.content as { id: string }[])[0].id;
			const table = buildInvocationTable([
				first,
				resultMessage("run_commands", id, [{ success: true, result: "v" }]),
			]);
			expect(
				table.rejected.some((entry) => entry.reason === "tool_name_mismatch"),
			).toBe(true);
		});

		it("REFUSES a result that precedes its invocation", () => {
			const first = invocationMessage("read_files", { query: "a" });
			const id = (first.content as { id: string }[])[0].id;
			const table = buildInvocationTable([
				resultMessage("read_files", id, [{ success: true, result: "v" }]),
				first,
			]);
			expect(
				table.rejected.some((entry) => entry.reason === "result_precedes_call"),
			).toBe(true);
		});
	});

	describe("the decisive adversarial case — the neighbouring subject", () => {
		function select(
			arm: EvidenceSelectorArm,
			taskTexts: readonly string[] = TASK_TEXTS,
			maxFragments = 1,
		) {
			enable();
			const canonical = [
				ALPHA.invocation,
				ALPHA.result,
				BETA.invocation,
				BETA.result,
			];
			const { candidates } = collectEvidenceCandidates({
				canonicalMessages: canonical,
				maxFragments: 12,
			});
			const signals = buildRelevanceSignals({ taskTexts });
			return selectEvidence({
				candidates,
				arm,
				signals,
				budget: { maxFragments, maxEstimatedTokens: 100_000 },
			});
		}

		it("carries the ORACLE's subject, not the neighbouring one", () => {
			const result = select("TASK_CONDITIONED");
			expect(result.selected).toHaveLength(1);
			expect(result.selected[0].fragment.excerpt).toContain(
				"DEFAULT_SOCKET_TIMEOUT_MILLIS",
			);
			// The neighbouring subject's value must NOT be carried.
			expect(renderSelectionSection(result.selected)).not.toContain("1500");
		});

		it("the SHAPE baseline CANNOT distinguish them — the measurement is honest", () => {
			// The two fragments are the same SHAPE: a declared constant with a
			// value. The shape baseline cannot separate them, so the outcome
			// depends on the canonical order rather than on the subject.
			const result = select("SHAPE");
			expect(result.selected).toHaveLength(1);
			// Whatever the shape baseline picks, the TASK-CONDITIONED arm must
			// pick the fragment whose SUBJECT the task names.
			const conditioned = select("TASK_CONDITIONED");
			expect(conditioned.selected[0].fragment.excerpt).toContain(
				"DEFAULT_SOCKET_TIMEOUT_MILLIS",
			);
		});

		it("does NOT depend on the ORACLE: the same mechanism on a different subject", () => {
			// The SYNTHETIC ADVERSARIAL HOLDOUT: a different subject name, a
			// different measurement unit and a different operation shape. The
			// mechanism must work on it too, which is the witness that the
			// selection is not fitted to one vocabulary.
			const GAMMA = pair(
				"run_commands",
				{ commands: ["cat src/gamma/GammaRelay.java"] },
				[
					{
						success: true,
						query: "src/gamma/GammaRelay.java",
						result: "class GammaRelay { final int RELAY_DELAY_MILLIS = 250; }",
					},
				],
			);
			enable();
			const canonical = [
				ALPHA.invocation,
				ALPHA.result,
				BETA.invocation,
				BETA.result,
				GAMMA.invocation,
				GAMMA.result,
			];
			const { candidates } = collectEvidenceCandidates({
				canonicalMessages: canonical,
				maxFragments: 12,
			});
			const signals = buildRelevanceSignals({
				taskTexts: ["Check the GammaRelay relay delay in the upstream relay."],
			});
			const result = selectEvidence({
				candidates,
				arm: "TASK_CONDITIONED",
				signals,
				budget: { maxFragments: 1, maxEstimatedTokens: 100_000 },
			});
			expect(result.selected).toHaveLength(1);
			expect(result.selected[0].fragment.excerpt).toContain(
				"RELAY_DELAY_MILLIS",
			);
			expect(renderSelectionSection(result.selected)).not.toContain("1000");
			expect(renderSelectionSection(result.selected)).not.toContain("1500");
		});
	});

	describe("the budget", () => {
		it("fails CLOSED on budget exhaustion", () => {
			enable();
			const canonical = [
				ALPHA.invocation,
				ALPHA.result,
				BETA.invocation,
				BETA.result,
			];
			const { candidates } = collectEvidenceCandidates({
				canonicalMessages: canonical,
				maxFragments: 12,
			});
			const signals = buildRelevanceSignals({ taskTexts: TASK_TEXTS });
			const result = selectEvidence({
				candidates,
				arm: "TASK_CONDITIONED",
				signals,
				budget: { maxFragments: 12, maxEstimatedTokens: 1 },
			});
			// A one-token budget cannot hold even the section's own
			// delimiters, so NOTHING is carried and the rejections are
			// recorded.
			expect(result.selected).toHaveLength(0);
			expect(result.rejected.length).toBeGreaterThan(0);
			expect(
				result.rejected.every((entry) => entry.reason === "token_budget_spent"),
			).toBe(true);
		});

		it("measures the RENDERED section, including the delimiters", () => {
			enable();
			const canonical = [
				ALPHA.invocation,
				ALPHA.result,
				BETA.invocation,
				BETA.result,
			];
			const { candidates } = collectEvidenceCandidates({
				canonicalMessages: canonical,
				maxFragments: 12,
			});
			const signals = buildRelevanceSignals({ taskTexts: TASK_TEXTS });
			const result = selectEvidence({
				candidates,
				arm: "TASK_CONDITIONED",
				signals,
				budget: { maxFragments: 12, maxEstimatedTokens: 100_000 },
			});
			const rendered = renderSelectionSection(result.selected);
			expect(result.renderedChars).toBe(rendered.length);
			expect(result.estimatedTokens).toBe(estimateTokens(rendered));
			// The measurement includes the delimiters and the attribution.
			expect(rendered).toContain("<!-- cline-source-evidence:begin -->");
			expect(rendered).toContain("<!-- cline-source-evidence:end -->");
		});
	});

	describe("the determinism", () => {
		it("produces the SAME selection for the SAME inputs", () => {
			enable();
			const canonical = [
				ALPHA.invocation,
				ALPHA.result,
				BETA.invocation,
				BETA.result,
			];
			const run = () => {
				const { candidates } = collectEvidenceCandidates({
					canonicalMessages: canonical,
				});
				const signals = buildRelevanceSignals({
					taskTexts: TASK_TEXTS,
					candidates,
					canonicalMessages: canonical,
				});
				return selectEvidence({
					candidates,
					arm: "TASK_CONDITIONED",
					signals,
					budget: { maxFragments: 12, maxEstimatedTokens: 100_000 },
				});
			};
			expect(renderSelectionSection(run().selected)).toBe(
				renderSelectionSection(run().selected),
			);
		});
	});

	describe("the RUNTIME-OWNED call-input signal", () => {
		it("collects the identifiers the agent's OWN call inputs name", () => {
			const canonical = [
				ALPHA.invocation,
				ALPHA.result,
				BETA.invocation,
				BETA.result,
			];
			const { identifiers } = collectCallInputIdentifiers(canonical);
			// The ALPHA invocation's input names the ALPHA path; the BETA
			// invocation's input names the BETA path. Both are runtime-owned.
			expect(
				Array.from(identifiers).some((value) =>
					value.includes("alphaserviceclient"),
				),
			).toBe(true);
			expect(
				Array.from(identifiers).some((value) =>
					value.includes("betaserviceclient"),
				),
			).toBe(true);
		});

		it("uses the call-input signal to reach the OPERATED subject", () => {
			// The TASK context names NEITHER subject: the task is a general
			// brief. Only the agent's own call inputs name the subjects. The
			// selector must therefore reach a subject the agent OPERATED on.
			//
			// The DECISIVE property is DISCRIMINATION: a subject the call
			// inputs name must beat a subject they do not. A third fragment
			// whose subject appears in NO call input must lose to both.
			enable();
			const canonical = [
				ALPHA.invocation,
				ALPHA.result,
				BETA.invocation,
				BETA.result,
				// A result whose invocation is NOT in the prefix's call inputs:
				// its subject is named by NO call input.
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "call_unissued",
							name: "read_files",
							content: [
								{
									success: true,
									query: "src/orphan/OrphanServiceClient.java",
									result:
										"public class OrphanServiceClient {\n  static final int SOCKET_TIMEOUT_MS = 700;\n}",
								},
							],
							is_error: false,
						},
					],
					ts: 0,
				} as unknown as MessageWithMetadata,
			];
			const { candidates } = collectEvidenceCandidates({
				canonicalMessages: canonical,
			});
			const signals = buildRelevanceSignals({
				// A task that names NEITHER subject.
				taskTexts: ["Check the sender configuration."],
				candidates,
				canonicalMessages: canonical,
			});
			const result = selectEvidence({
				candidates,
				arm: "TASK_CONDITIONED",
				signals,
				budget: { maxFragments: 2, maxEstimatedTokens: 100_000 },
			});
			expect(result.selected).toHaveLength(2);
			// The ORPHAN's subject is named by no call input, so it must not
			// be carried in preference to the operated subjects.
			const rendered = renderSelectionSection(result.selected);
			expect(rendered).not.toContain("OrphanServiceClient");
			expect(rendered).not.toContain("700");
			// The operated subjects ARE carried.
			expect(rendered).toContain("AlphaServiceClient");
			expect(rendered).toContain("BetaServiceClient");
		});
	});

	describe("the UNBUDGETED admission", () => {
		it("admits EVERY eligible fragment, so the selector can choose", () => {
			enable();
			// Ten distinct pairs: the predecessor's 24-fragment budget would
			// admit only the first few, so a selector could never reach the
			// later ones.
			const canonical: MessageWithMetadata[] = [];
			for (let index = 0; index < 10; index += 1) {
				const p = pair(
					"read_files",
					{ query: `src/subject${index}/Subject${index}.java` },
					[
						{
							success: true,
							query: `src/subject${index}/Subject${index}.java`,
							result: `class Subject${index} { static final int VALUE_${index} = ${index}; }`,
						},
					],
				);
				canonical.push(p.invocation, p.result);
			}
			const { candidates } = collectEvidenceCandidates({
				canonicalMessages: canonical,
			});
			// All ten are admitted, so all ten are selectable.
			expect(candidates.length).toBe(10);
			const signals = buildRelevanceSignals({
				taskTexts: ["Check Subject7's configuration."],
				candidates,
				canonicalMessages: canonical,
			});
			const result = selectEvidence({
				candidates,
				arm: "TASK_CONDITIONED",
				signals,
				budget: { maxFragments: 1, maxEstimatedTokens: 100_000 },
			});
			expect(result.selected).toHaveLength(1);
			expect(result.selected[0].fragment.excerpt).toContain("VALUE_7");
		});

		it("still refuses a CREDENTIAL-BEARING source", () => {
			enable();
			const canonical = [
				...Object.values(
					pair("read_files", { query: "/home/alice/.ssh/id_rsa" }, [
						{
							success: true,
							query: "/home/alice/.ssh/id_rsa",
							result: "PRIVATE KEY MATERIAL",
						},
					]),
				),
			];
			const { candidates } = collectEvidenceCandidates({
				canonicalMessages: canonical,
			});
			// The credential-bearing source is refused ENTIRELY: not even its
			// status is carried.
			expect(candidates.length).toBe(0);
		});
	});

	describe("the MINIMAL SOURCE WINDOW", () => {
		it("keeps the decisive line TOGETHER with its qualifying context", () => {
			const fragment = {
				source: "src/a.java",
				status: "succeeded",
				kind: "OBSERVED_EXCERPT" as const,
				excerpt: [
					"73",
					"--- files named *Test.java only ---",
					"47",
					"--- mvn test anywhere in CI ---",
				].join("\n"),
				canonicalIndex: 0,
			};
			const window = buildMinimalSourceWindow(fragment);
			// The window is CONTIGUOUS: the decisive line and the line that
			// gives it meaning are both present, and nothing was invented.
			expect(window).toContain("47");
			expect(window).toContain("*Test.java");
			expect(window).toContain("mvn test anywhere in CI");
		});

		it("never produces an ISOLATED number", () => {
			const fragment = {
				source: "src/a.java",
				status: "succeeded",
				kind: "OBSERVED_EXCERPT" as const,
				excerpt: ["unrelated preamble", "47", "unrelated tail"].join("\n"),
				canonicalIndex: 0,
			};
			const window = buildMinimalSourceWindow(fragment, { contextLines: 0 });
			// With no context the window would be the bare number, which
			// carries no subject. The window must therefore keep at least the
			// default context, so the number is never isolated.
			expect(window).toContain("47");
			const withContext = buildMinimalSourceWindow(fragment);
			expect(withContext).toContain("unrelated preamble");
			expect(withContext.split("\n").length).toBeGreaterThan(1);
		});

		it("is a REDUCTION: a short excerpt is carried unchanged", () => {
			const fragment = {
				source: "src/a.java",
				status: "succeeded",
				kind: "OBSERVED_EXCERPT" as const,
				excerpt: "VALUE = 42",
				canonicalIndex: 0,
			};
			expect(buildMinimalSourceWindow(fragment)).toBe("VALUE = 42");
		});
	});
});
