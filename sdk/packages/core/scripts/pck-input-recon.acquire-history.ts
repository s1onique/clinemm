/**
 * ACT-CLINEMM-PCK-EVIDENCE-FIRST-INPUT-RECON-01
 *
 * C0 — the REAL mature-session canonical history acquisition.
 *
 * ============================================================================
 * WHAT IT DOES
 * ============================================================================
 *
 * It loads a REAL persisted session's canonical message list and writes a
 * SANITISED, operator-local copy of it for the recon experiment.
 *
 * The source session is a REAL dogfood run against the live operator
 * credential, so the history is a REAL mature workload — NOT a synthetic
 * fixture.
 *
 * ============================================================================
 * CONFIDENTIALITY
 * ============================================================================
 *
 * The acquired history is written to the repository's GITIGNORED `tmp/`
 * tree ONLY. It is NEVER committed. The committed evidence records only
 * AGGREGATE, non-reversible facts about the history: message counts, tool
 * counts, character counts, token estimates and the session's own identity.
 *
 * The raw history is NOT exported into `.factory/evidence/`. No private
 * repository contents, credentials or raw reasoning reach committed
 * evidence.
 *
 * ============================================================================
 * WHAT IT RECORDS
 * ============================================================================
 *
 *   - the session id and the extension version that produced it,
 *   - the message count, the per-role breakdown,
 *   - the tool-call count, the tool-result count, the joined-event count,
 *   - the character count of the PRODUCTION checkpoint input view,
 *   - the ESTIMATED token count of the production checkpoint input view,
 *   - the SHA-256 of the canonical history, so the experiment can prove it
 *     used the SAME history for every candidate.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MessageWithMetadata } from "@cline/shared";
import { estimateTokens } from "@cline/shared";
import { collectCanonicalToolEvents } from "../src/extensions/context/precompaction-knowledge-checkpoint/evidence";
import { buildCheckpointInputView } from "../src/extensions/context/precompaction-knowledge-checkpoint/model-request";

/**
 * The operator-local output root. It is GITIGNORED.
 */
const PRIVATE_ROOT = join(
	process.cwd(),
	"..",
	"..",
	"..",
	"tmp",
	"pck-input-recon",
);

/**
 * The session to acquire.
 *
 * The session id is a command-line argument so the experiment is
 * reproducible against any REAL session without editing the script.
 */
const sessionId = process.argv[2];

if (!sessionId) {
	console.error(
		"usage: pck-input-recon.acquire-history.ts <sessionId> [sessionsRoot]",
	);
	process.exit(2);
}

const sessionsRoot =
	process.argv[3] ?? join(homedir(), ".vscodium-roz", "cline-data", "sessions");

const sourcePath = join(sessionsRoot, sessionId, `${sessionId}.messages.json`);

if (!existsSync(sourcePath)) {
	console.error(`the session history does not exist: ${sourcePath}`);
	process.exit(2);
}

interface PersistedSession {
	readonly version?: number;
	readonly updated_at?: string;
	readonly agent?: string;
	readonly sessionId?: string;
	readonly origin?: {
		readonly source?: string;
		readonly mode?: string;
		readonly version?: string;
	};
	readonly messages: MessageWithMetadata[];
}

const persisted = JSON.parse(
	readFileSync(sourcePath, "utf8"),
) as PersistedSession;

const canonicalMessages = persisted.messages;

if (!Array.isArray(canonicalMessages) || canonicalMessages.length === 0) {
	console.error(`the session history carries no messages: ${sourcePath}`);
	process.exit(2);
}

/**
 * The SHA-256 of the CANONICAL HISTORY, computed over the exact bytes the
 * experiment consumes.
 *
 * It is the identity that proves every candidate was evaluated against the
 * SAME history.
 */
const historySha256 = createHash("sha256")
	.update(JSON.stringify(canonicalMessages))
	.digest("hex");

/**
 * The PRODUCTION input view of the acquired history.
 *
 * This is what the production seam would send to the checkpoint model.
 */
const productionInputView = buildCheckpointInputView(canonicalMessages);

/**
 * The joined canonical tool events.
 *
 * The count is the number of events the runtime's own interpreter can
 * reason about — the events that CAN support a deterministic claim.
 */
const canonicalToolEvents = collectCanonicalToolEvents(canonicalMessages);

const roleCounts: Record<string, number> = {};
let toolCallCount = 0;
let toolResultCount = 0;
let privateReasoningBlocks = 0;
let textBlocks = 0;
for (const message of canonicalMessages) {
	roleCounts[message.role] = (roleCounts[message.role] ?? 0) + 1;
	if (!Array.isArray(message.content)) {
		continue;
	}
	for (const block of message.content) {
		if (block.type === "tool_use") {
			toolCallCount += 1;
			continue;
		}
		if (block.type === "tool_result") {
			toolResultCount += 1;
			continue;
		}
		if (block.type === "thinking" || block.type === "redacted_thinking") {
			privateReasoningBlocks += 1;
			continue;
		}
		if (block.type === "text") {
			textBlocks += 1;
		}
	}
}

/**
 * The aggregate, non-reversible facts about the acquired history.
 */
const acquisition = {
	acquisition: "REAL_MATURE_SESSION_CANONICAL_HISTORY",
	sessionId: persisted.sessionId ?? sessionId,
	sessionSource: persisted.origin?.source ?? "unknown",
	sessionMode: persisted.origin?.mode ?? "unknown",
	sessionExtensionVersion: persisted.origin?.version ?? "unknown",
	sessionUpdatedAt: persisted.updated_at ?? "unknown",
	sessionAgent: persisted.agent ?? "unknown",
	canonicalHistorySha256: historySha256,
	messageCount: canonicalMessages.length,
	roleCounts,
	toolCallCount,
	toolResultCount,
	joinedCanonicalToolEventCount: canonicalToolEvents.length,
	privateReasoningBlockCount: privateReasoningBlocks,
	publicTextBlockCount: textBlocks,
	productionInputViewChars: productionInputView.text.length,
	productionInputViewEstimatedTokens: estimateTokens(
		productionInputView.text.length,
	),
	canonicalReferenceCount: productionInputView.references.length,
} as const;

mkdirSync(PRIVATE_ROOT, { recursive: true });

// The ACQUIRED history is written to the GITIGNORED tree only.
writeFileSync(
	join(PRIVATE_ROOT, `${sessionId}.canonical.json`),
	JSON.stringify(canonicalMessages),
	"utf8",
);
// The AGGREGATE facts are ALSO written to the gitignored tree; the
// committed evidence carries them verbatim because they are
// non-reversible.
writeFileSync(
	join(PRIVATE_ROOT, `${sessionId}.acquisition.json`),
	JSON.stringify(acquisition, null, 2),
	"utf8",
);

console.log(JSON.stringify(acquisition, null, 2));
