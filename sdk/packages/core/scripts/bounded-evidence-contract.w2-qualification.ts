/**
 * ACT-CLINEMM-COMPACTION-BOUNDED-EVIDENCE-INPUT-CONTRACT-RECON-01
 *
 * C8 — the W2 INDEPENDENT QUALIFICATION (reviewer P1-D).
 *
 * ============================================================================
 * THE DEFECT THIS CORRECTS
 * ============================================================================
 *
 * The predecessor ACT's secondary-workload scoring imported and applied the
 * W1 oracle (`W1_KNOWLEDGE_ORACLE`) to W2's contexts. W2 has a MUCH EARLIER
 * compaction boundary (76 of 114 canonical messages, against W1's 244 of
 * 246).
 *
 * Two sessions concerning the same investigation do NOT mean both had
 * acquired identical knowledge at their respective compaction boundaries.
 *
 * ============================================================================
 * WHAT THIS ESTABLISHES
 * ============================================================================
 *
 * For each W1 proposition, this script answers: DID W2's OWN source prefix
 * establish it before W2's OWN boundary?
 *
 * The answer is derived from W2's own source prefix with the SAME assertion
 * matcher the S2 inventory uses — the same matcher, applied to W2's own
 * evidence. Only the propositions that W2's own prefix establishes are
 * ADMITTED as W2's acquired knowledge.
 *
 * ============================================================================
 * CONFIDENTIALITY
 * ============================================================================
 *
 * The output carries per-item BOOLEAN verdicts and counts. No message text,
 * no tool output and no credential is printed.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MessageWithMetadata } from "@cline/shared";
import { ORACLE_ASSERTIONS } from "../src/extensions/context/knowledge-loss-discriminator/assertions";
import { W1_KNOWLEDGE_ORACLE } from "../src/extensions/context/knowledge-loss-discriminator/oracle";
import { canonicalSourceMessages } from "../src/session/models/session-compaction";

const sessionId = process.argv[2];
if (!sessionId) {
	console.error(
		"usage: bounded-evidence-contract.w2-qualification.ts <sessionId>",
	);
	process.exit(2);
}

const sessionsRoot = join(homedir(), ".vscodium-roz", "cline-data", "sessions");
const sessionDir = join(sessionsRoot, sessionId);

const persisted = JSON.parse(
	readFileSync(join(sessionDir, `${sessionId}.messages.json`), "utf8"),
) as { messages: MessageWithMetadata[] };
const state = JSON.parse(
	readFileSync(join(sessionDir, `${sessionId}.compaction.json`), "utf8"),
) as { source_message_count: number };

const canonical = canonicalSourceMessages(persisted.messages);
const boundary = state.source_message_count;
const prefix = canonical.slice(0, boundary);

/**
 * The EVIDENCE TEXT of a workload's own source prefix.
 *
 * It is the concatenation of every tool-result body and every assistant
 * text block in the prefix. It is the material the investigation actually
 * had at the boundary.
 */
function evidenceTextOf(messages: readonly MessageWithMetadata[]): string {
	const parts: string[] = [];
	for (const message of messages) {
		if (!Array.isArray(message.content)) {
			if (typeof message.content === "string") {
				parts.push(message.content);
			}
			continue;
		}
		for (const block of message.content) {
			if (block.type === "text") {
				parts.push((block as { text?: string }).text ?? "");
				continue;
			}
			if (block.type === "tool_result") {
				const content = (block as { content?: unknown }).content;
				if (!Array.isArray(content)) {
					continue;
				}
				for (const entry of content) {
					if (!entry || typeof entry !== "object") {
						continue;
					}
					const payload = entry as { result?: unknown };
					parts.push(String(payload.result ?? ""));
				}
			}
		}
	}
	return parts.join("\n");
}

const evidenceText = evidenceTextOf(prefix);

const qualifications = W1_KNOWLEDGE_ORACLE.map((item) => {
	const tests = ORACLE_ASSERTIONS[item.id] ?? [];
	const matchedCore = tests.filter(
		(test) => !test.isMaterialQualification && test.pattern.test(evidenceText),
	);
	const matchedQualifications = tests.filter(
		(test) => test.isMaterialQualification && test.pattern.test(evidenceText),
	);
	const totalMaterial = tests.filter((test) => test.isMaterialQualification);
	const established =
		matchedCore.length > 0 &&
		matchedQualifications.length === totalMaterial.length;
	const partiallyEstablished =
		matchedCore.length > 0 &&
		matchedQualifications.length < totalMaterial.length;
	return {
		oracleItemId: item.id,
		relevance: item.relevance,
		// ESTABLISHED — this workload's OWN prefix established the whole
		// proposition INCLUDING every material qualification.
		establishedInOwnPrefix: established,
		// PARTIALLY_ESTABLISHED — the core proposition is present but at
		// least one material qualification is not.
		partiallyEstablishedInOwnPrefix: partiallyEstablished,
		// NOT_ESTABLISHED — the workload had not acquired this proposition
		// at its own boundary. Such an item MUST NOT be counted as a
		// missing proposition for this workload.
		admittedToWorkloadAcquiredKnowledge: established,
		matchedCoreAssertions: matchedCore.map((test) => test.id),
		matchedQualifications: matchedQualifications.map((test) => test.id),
		missingQualifications: totalMaterial
			.filter((test) => !matchedQualifications.includes(test))
			.map((test) => test.id),
	};
});

const admitted = qualifications.filter(
	(entry) => entry.admittedToWorkloadAcquiredKnowledge,
);
const report = {
	sessionId,
	boundary,
	fullCanonicalLength: canonical.length,
	postBoundaryMessageCount: Math.max(0, canonical.length - boundary),
	oracleItemsConsidered: qualifications.length,
	admittedAsAcquiredKnowledge: admitted.length,
	admittedItemIds: admitted.map((entry) => entry.oracleItemId),
	notAdmittedItemIds: qualifications
		.filter((entry) => !entry.admittedToWorkloadAcquiredKnowledge)
		.map((entry) => entry.oracleItemId),
	qualifications,
} as const;

console.log(JSON.stringify(report, null, 2));
