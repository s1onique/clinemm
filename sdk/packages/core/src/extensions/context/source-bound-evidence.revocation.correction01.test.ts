/**
 * ACT-CLINEMM-COMPACTION-TASK-CONDITIONED-EVIDENCE-SELECTION-01
 *
 * C2.1 — THE REVOCATION WITNESSES.
 *
 * ============================================================================
 * WHAT IS BEING WITNESSED
 * ============================================================================
 *
 * The carry-forward is DEFAULT OFF and can be turned OFF again at any time.
 * When it is turned off, the evidence it previously carried must STOP being
 * published. The requirement is exact:
 *
 *   - enabled -> disabled;
 *   - previously admitted -> newly refused;
 *   - nonempty selection -> empty selection;
 *
 * and in every case: previously carried evidence must NOT survive solely
 * because the CURRENT admission result is empty.
 *
 * ============================================================================
 * THE DEFECT
 * ============================================================================
 *
 * The predecessor's seam returned EARLY, with `applied: false` and the
 * ORIGINAL message list, whenever the current admission produced no
 * fragments:
 *
 *     if (summaryIndex === -1 || report.admitted.length === 0) {
 *         return { messages: [...compactedMessages], applied: false, ... };
 *     }
 *
 * That early return never STRIPPED the section. So a summary that already
 * carried a section kept carrying it — after the switch was turned off, and
 * after the selection became empty. The empty result was interpreted as
 * "nothing to do", when it must be interpreted as "nothing to carry, so
 * remove what was carried".
 *
 * ============================================================================
 * WHY THIS MATTERS BEYOND THE SWITCH
 * ============================================================================
 *
 * The switch is not the only way the selection becomes empty. The selection
 * is also empty when:
 *
 *   - every candidate is refused for CONFIDENTIALITY;
 *   - the canonical boundary no longer contains the observed payload;
 *   - the tool's structured shape changed.
 *
 * In every one of those cases the previously carried excerpt describes an
 * observation that the CURRENT admission refuses to publish. Carrying it
 * anyway would publish evidence the runtime no longer authorises.
 */

import type { MessageWithMetadata } from "@cline/shared";
import { afterEach, describe, expect, it } from "vitest";
import {
	applySourceBoundEvidenceToCompactedMessages,
	extractSourceBoundEvidence,
	isSourceBoundEvidenceCarryForwardEnabled,
	setSourceBoundEvidenceCarryForwardForTesting,
	stripSourceBoundEvidenceSection,
} from "./source-bound-evidence";

const restore: Array<() => void> = [];

function enable(): void {
	restore.push(setSourceBoundEvidenceCarryForwardForTesting(true));
}

function disable(): void {
	restore.push(setSourceBoundEvidenceCarryForwardForTesting(false));
}

afterEach(() => {
	while (restore.length > 0) {
		restore.pop()?.();
	}
});

function summaryMessage(summary = "## Goal\nwork"): MessageWithMetadata {
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

function toolResultMessage(content: unknown[], index = 0): MessageWithMetadata {
	return {
		role: "user",
		content: [
			{
				type: "tool_result",
				tool_use_id: `call-${index}`,
				name: "run_commands",
				content,
				is_error: false,
			},
		],
		ts: index,
	} as unknown as MessageWithMetadata;
}

const OBSERVATION = "static final int OBSERVED_SETTING = 1000;";

function summaryTextOf(message: MessageWithMetadata): string {
	return (message.metadata as { summary?: string } | undefined)?.summary ?? "";
}

describe("C2.1 — the revocation witnesses", () => {
	it("is OFF by default", () => {
		expect(isSourceBoundEvidenceCarryForwardEnabled()).toBe(false);
	});

	describe("enabled -> disabled", () => {
		it("removes the previously carried section when the switch is turned OFF", () => {
			enable();
			const canonical = [
				toolResultMessage([{ success: true, result: OBSERVATION }]),
			];
			const carried = applySourceBoundEvidenceToCompactedMessages(
				[summaryMessage()],
				canonical,
				{ sourceMessageCount: canonical.length },
			);
			expect(carried.applied).toBe(true);
			expect(summaryTextOf(carried.messages[0])).toContain(
				"Source-bound evidence",
			);
			expect(summaryTextOf(carried.messages[0])).toContain(OBSERVATION);

			// The switch is turned OFF. The evidence must STOP being published.
			disable();
			const revoked = applySourceBoundEvidenceToCompactedMessages(
				carried.messages,
				canonical,
				{ sourceMessageCount: canonical.length },
			);
			expect(summaryTextOf(revoked.messages[0])).not.toContain(
				"Source-bound evidence",
			);
			expect(summaryTextOf(revoked.messages[0])).not.toContain(OBSERVATION);
		});
	});

	describe("previously admitted -> newly refused", () => {
		it("removes the previously carried section when the payload becomes confidential", () => {
			enable();
			const canonical = [
				toolResultMessage([{ success: true, result: OBSERVATION }]),
			];
			const carried = applySourceBoundEvidenceToCompactedMessages(
				[summaryMessage()],
				canonical,
				{ sourceMessageCount: canonical.length },
			);
			expect(carried.applied).toBe(true);
			expect(summaryTextOf(carried.messages[0])).toContain(OBSERVATION);

			// The SAME boundary now yields a REFUSED payload. The
			// previously carried observation describes material the current
			// admission refuses to publish: the SOURCE is a known
			// credential-bearing path, so the production
			// `isSensitiveSourceFilePath()` rule refuses the whole fragment.
			const changed = [
				toolResultMessage([
					{ success: true, query: "/home/alice/.ssh/id_rsa", result: "x" },
				]),
			];
			const revoked = applySourceBoundEvidenceToCompactedMessages(
				carried.messages,
				changed,
				{ sourceMessageCount: changed.length },
			);
			expect(summaryTextOf(revoked.messages[0])).not.toContain(
				"Source-bound evidence",
			);
			expect(summaryTextOf(revoked.messages[0])).not.toContain(OBSERVATION);
		});
	});

	describe("nonempty selection -> empty selection", () => {
		it("removes the previously carried section when the selection becomes empty", () => {
			enable();
			const canonical = [
				toolResultMessage([{ success: true, result: OBSERVATION }]),
			];
			const carried = applySourceBoundEvidenceToCompactedMessages(
				[summaryMessage()],
				canonical,
				{ sourceMessageCount: canonical.length },
			);
			expect(carried.applied).toBe(true);

			// The boundary now contains NO admissible payload at all.
			const empty = [toolResultMessage([{ success: true, result: "" }])];
			const revoked = applySourceBoundEvidenceToCompactedMessages(
				carried.messages,
				empty,
				{ sourceMessageCount: empty.length },
			);
			expect(summaryTextOf(revoked.messages[0])).not.toContain(
				"Source-bound evidence",
			);
			expect(summaryTextOf(revoked.messages[0])).not.toContain(OBSERVATION);
		});

		it("removes the previously carried section when the canonical prefix is empty", () => {
			enable();
			const canonical = [
				toolResultMessage([{ success: true, result: OBSERVATION }]),
			];
			const carried = applySourceBoundEvidenceToCompactedMessages(
				[summaryMessage()],
				canonical,
				{ sourceMessageCount: canonical.length },
			);
			expect(carried.applied).toBe(true);

			const revoked = applySourceBoundEvidenceToCompactedMessages(
				carried.messages,
				[],
				{ sourceMessageCount: 0 },
			);
			expect(summaryTextOf(revoked.messages[0])).not.toContain(
				"Source-bound evidence",
			);
		});
	});

	describe("the clean default-OFF predecessor behaviour", () => {
		it("carries NOTHING while the switch is off", () => {
			const canonical = [
				toolResultMessage([{ success: true, result: OBSERVATION }]),
			];
			const report = extractSourceBoundEvidence({
				canonicalMessages: canonical,
			});
			expect(report.admittedCount).toBe(0);
			expect(report.admitted).toEqual([]);
		});

		it("does not touch a summary while the switch is off and nothing was carried", () => {
			const canonical = [
				toolResultMessage([{ success: true, result: OBSERVATION }]),
			];
			const before = summaryMessage();
			const result = applySourceBoundEvidenceToCompactedMessages(
				[before],
				canonical,
				{ sourceMessageCount: canonical.length },
			);
			expect(result.applied).toBe(false);
			expect(result.messages[0]).toEqual(before);
		});

		it("leaves an unrelated summary byte-identical while the switch is off", () => {
			const canonical = [
				toolResultMessage([{ success: true, result: OBSERVATION }]),
			];
			const before = summaryMessage();
			const result = applySourceBoundEvidenceToCompactedMessages(
				[before],
				canonical,
				{ sourceMessageCount: canonical.length },
			);
			expect(
				stripSourceBoundEvidenceSection(summaryTextOf(result.messages[0])),
			).toBe(summaryTextOf(before));
		});
	});
});
