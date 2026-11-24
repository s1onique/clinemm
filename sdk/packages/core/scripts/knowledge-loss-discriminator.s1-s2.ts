/**
 * ACT-CLINEMM-COMPACTION-INCREMENTAL-KNOWLEDGE-LOSS-DISCRIMINATOR-01
 *
 * C3 — the S1 (compacted state) and S2 (provider-visible continuation)
 * INSPECTION.
 *
 * ============================================================================
 * WHAT IT DOES
 * ============================================================================
 *
 * 1. S1_HISTORICAL — it inspects the REAL persisted compaction sidecar of a
 *    REAL session and scores the oracle against the persisted compacted
 *    state: the generated summary, the carried task contract, the carried
 *    verified-outcome section, the adjudication section and the retained
 *    canonical tail.
 *
 * 2. S2_RECONSTRUCTED — it RECONSTRUCTS the provider-visible continuation
 *    through the PRODUCTION projector
 *    (`projectSessionCompactionState()`) plus the PRODUCTION provider-visible
 *    restorations (`applyTaskContractToCompactedMessages()` and
 *    `applyVerifiedEvidenceToCompactedMessages()`), and scores the oracle
 *    against it.
 *
 * The reconstruction is labelled `S2_RECONSTRUCTED`, NOT `S2_CAPTURED`: the
 * ACT requires that a reconstructed continuation is not presented as the
 * captured one.
 *
 * ============================================================================
 * CONFIDENTIALITY
 * ============================================================================
 *
 * The scored output is AGGREGATE: counts, mechanism attributions, the
 * missing-qualification identifiers and the oracle item ids. No message
 * prose, no tool output and no credential is written.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MessageWithMetadata } from "@cline/shared";
import { applyVerifiedEvidenceToCompactedMessages } from "../src/extensions/context/evidence-continuity";
import {
	decomposeCompactedState,
	decomposeProviderContinuation,
} from "../src/extensions/context/knowledge-loss-discriminator/context-parts";
import {
	type KnowledgeContext,
	scoreContext,
} from "../src/extensions/context/knowledge-loss-discriminator/inventory";
import { W1_KNOWLEDGE_ORACLE } from "../src/extensions/context/knowledge-loss-discriminator/oracle";
import { summariseScores } from "../src/extensions/context/knowledge-loss-discriminator/scoring";
import { applyTaskContractToCompactedMessages } from "../src/extensions/context/task-contract";
import { projectSessionCompactionState } from "../src/session/models/session-compaction";

const PRIVATE_ROOT = join(
	process.cwd(),
	"..",
	"..",
	"..",
	"tmp",
	"knowledge-loss",
);

const sessionId = process.argv[2];
if (!sessionId) {
	console.error(
		"usage: knowledge-loss-discriminator.s1-s2.ts <sessionId> [sessionsRoot]",
	);
	process.exit(2);
}

const sessionsRoot =
	process.argv[3] ?? join(homedir(), ".vscodium-roz", "cline-data", "sessions");
const sessionDir = join(sessionsRoot, sessionId);

const persisted = JSON.parse(
	readFileSync(join(sessionDir, `${sessionId}.messages.json`), "utf8"),
) as { messages: MessageWithMetadata[] };
const state = JSON.parse(
	readFileSync(join(sessionDir, `${sessionId}.compaction.json`), "utf8"),
) as {
	source_message_count: number;
	source_prefix_hash?: string;
	messages: MessageWithMetadata[];
};

const compacted = state.messages;

// ---------------------------------------------------------------------------
// S1_HISTORICAL — the persisted compacted state.
// ---------------------------------------------------------------------------
const s1Context: KnowledgeContext = decomposeCompactedState(compacted);
const s1Scores = scoreContext(W1_KNOWLEDGE_ORACLE, s1Context);
const criticalIds = new Set(
	W1_KNOWLEDGE_ORACLE.filter((i) => i.relevance === "critical").map(
		(i) => i.id,
	),
);

// ---------------------------------------------------------------------------
// S2_RECONSTRUCTED — the provider-visible continuation.
//
// The projection is the PRODUCTION projector. The provider-visible
// restorations are the PRODUCTION carry-forward functions, applied with the
// SIDECAR'S OWN boundary.
// ---------------------------------------------------------------------------
const projected = projectSessionCompactionState(
	{
		version: 1,
		updated_at: state.source_prefix_hash ?? "",
		source_message_count: state.source_message_count,
		source_prefix_hash: state.source_prefix_hash,
		messages: state.messages,
	},
	persisted.messages,
);
if (!projected) {
	console.error(
		"the production projector refused the persisted state (prefix mismatch)",
	);
	process.exit(2);
}
const withContract = await applyTaskContractToCompactedMessages(
	projected,
	persisted.messages,
	{ sourceMessageCount: state.source_message_count } as never,
);
const withEvidence = applyVerifiedEvidenceToCompactedMessages(
	withContract.messages,
	persisted.messages,
	{ sourceMessageCount: state.source_message_count },
);
const s2Context = decomposeProviderContinuation(withEvidence.messages);
const s2Scores = scoreContext(W1_KNOWLEDGE_ORACLE, s2Context);

// ---------------------------------------------------------------------------
// The output.
// ---------------------------------------------------------------------------
const report = {
	sessionId,
	oracleItemCount: W1_KNOWLEDGE_ORACLE.length,
	criticalItemCount: criticalIds.size,
	acquiredItemCount: W1_KNOWLEDGE_ORACLE.filter(
		(i) => !i.alreadyPresentInInitialTask,
	).length,
	s1_historical: {
		label: "S1_HISTORICAL",
		summary: summariseScores(s1Scores, criticalIds),
		scores: s1Scores,
	},
	s2_reconstructed: {
		label: "S2_RECONSTRUCTED",
		summary: summariseScores(s2Scores, criticalIds),
		scores: s2Scores,
	},
} as const;

mkdirSync(PRIVATE_ROOT, { recursive: true });
writeFileSync(
	join(PRIVATE_ROOT, `${sessionId}.s1-s2.json`),
	JSON.stringify(report, null, 2),
	"utf8",
);

console.log(JSON.stringify(report, null, 2));
