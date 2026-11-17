/**
 * ACT-CLINEMM-CANONICAL-EVIDENCE-CONTINUITY-LIVE-01
 *
 * Offline, read-only auditor for the LIVE canonical-evidence continuity of
 * dogfood session 1794892591345_7em4g.
 *
 * It drives the REAL production seam
 * (`sdk/packages/core/src/session/models/session-compaction.ts`) against the
 * REAL persisted artifacts of that session and records:
 *
 *   - canonical transcript identity, ordering and pairing census;
 *   - the compaction state's binding to its canonical prefix
 *     (count + boundary key + stored prefix hash, recomputed with the
 *     production algorithm);
 *   - the resume projection the production code produces from the live
 *     artifacts;
 *   - the IDENTITY-LEVEL disposition of every evidence reference
 *     (tool_result `tool_use_id`) that the compaction dropped from the
 *     working context, correlated against canonical storage.
 *
 * PRIVACY: the auditor emits OPAQUE IDENTITIES (message ids, tool-call ids),
 * hashes and COUNTS only. No canonical message text, no prompt content and
 * no tool-result payload is written to the output.
 *
 * Usage:
 *   bun run tool/audit.ts \
 *     --session-dir <path> --out <canonical-continuity-audit.json>
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

import {
	createSessionCompactionState,
	parseSessionCompactionState,
	projectSessionCompactionState,
} from "../../../../sdk/packages/core/src/session/models/session-compaction.ts";

type AnyRecord = Record<string, any>;

interface Options {
	sessionDir: string;
	out: string;
}

function parseArgs(argv: string[]): Options {
	let sessionDir = "";
	let out = "";
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--session-dir") {
			sessionDir = argv[i + 1] ?? "";
			i += 1;
		} else if (arg === "--out") {
			out = argv[i + 1] ?? "";
			i += 1;
		}
	}
	if (!sessionDir || !out) {
		throw new Error("usage: audit.ts --session-dir <path> --out <path>");
	}
	return { sessionDir, out };
}

function sha256File(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function bytesOf(path: string): number {
	return readFileSync(path).byteLength;
}

/**
 * The PRODUCTION definition of an "evidence reference": a tool RESULT's
 * tool-call id. Mirrors `collectToolCallReferenceIds` in
 * `sdk/packages/core/src/extensions/context/compaction.ts` — an evidence
 * reference is a tool result, and retention is an IDENTITY question.
 */
function collectToolCallReferenceIds(messages: readonly AnyRecord[]): Set<string> {
	const ids = new Set<string>();
	for (const message of messages) {
		const content = message.content;
		if (typeof content === "string") {
			continue;
		}
		for (const part of content ?? []) {
			if (part.type !== "tool-result" && part.type !== "tool_result") {
				continue;
			}
			const id = part.tool_use_id ?? part.id;
			if (typeof id === "string" && id.length > 0) {
				ids.add(id);
			}
		}
	}
	return ids;
}


const options = parseArgs(process.argv.slice(2));
const sessionId = basename(options.sessionDir);
const messagesPath = `${options.sessionDir}/${sessionId}.messages.json`;
const compactionPath = `${options.sessionDir}/${sessionId}.compaction.json`;
const manifestPath = `${options.sessionDir}/${sessionId}.json`;

const canonical = JSON.parse(readFileSync(messagesPath, "utf8")) as AnyRecord;
const sidecarRaw = JSON.parse(readFileSync(compactionPath, "utf8")) as AnyRecord;
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as AnyRecord;
const messages = canonical.messages as AnyRecord[];

const state = parseSessionCompactionState(sidecarRaw);
if (!state) {
	throw new Error("persisted compaction sidecar does not parse under the production schema");
}

// --- canonical identity census -------------------------------------------------
const canonicalIds = messages.map((m) => (typeof m.id === "string" ? m.id : ""));
const duplicateIds = canonicalIds.filter((id, i) => canonicalIds.indexOf(id) !== i);
let tsMonotonicityViolations = 0;
for (let i = 1; i < messages.length; i += 1) {
	const a = messages[i - 1].ts;
	const b = messages[i].ts;
	if (typeof a === "number" && typeof b === "number" && b < a) {
		tsMonotonicityViolations += 1;
	}
}

// --- tool pairing census --------------------------------------------------------
const toolUseIds = new Set<string>();
const toolResultIds = new Set<string>();
for (const message of messages) {
	for (const part of (Array.isArray(message.content) ? message.content : [])) {
		if (part.type === "tool_use" && typeof part.id === "string") {
			toolUseIds.add(part.id);
		}
		if (
			(part.type === "tool_result" || part.type === "tool-result") &&
			typeof part.tool_use_id === "string"
		) {
			toolResultIds.add(part.tool_use_id);
		}
	}
}
const orphanResults = [...toolResultIds].filter((id) => !toolUseIds.has(id));
const orphanUses = [...toolUseIds].filter((id) => !toolResultIds.has(id));

// --- prefix binding -------------------------------------------------------------
const prefixMessages = messages.slice(0, state.source_message_count);
const boundaryMessage = prefixMessages.at(-1);
const recomputed = createSessionCompactionState({
	sourceMessages: prefixMessages,
	compactedMessages: state.messages,
	conversationId: state.conversation_id,
	systemPrompt: state.system_prompt,
	updatedAt: state.updated_at,
});
const prefixHashMatches = recomputed.source_prefix_hash === state.source_prefix_hash;
const boundaryKeyMatches =
	state.source_last_message_key !== undefined &&
	boundaryMessage !== undefined &&
	typeof boundaryMessage.id === "string" &&
	state.source_last_message_key === `id:${boundaryMessage.id}`;

// --- resume projection ----------------------------------------------------------
const projected = projectSessionCompactionState(state, messages);
const projectedIds =
	projected === undefined
		? []
		: projected.map((m: any) => (typeof m.id === "string" ? m.id : ""));
const canonicalTail = messages.slice(state.source_message_count);
const tailIdentityConserved =
	projected !== undefined &&
	canonicalTail.every((m, i) => projectedIds[state.messages.length + i] === m.id);

// --- evidence-reference identity disposition ------------------------------------
const refsBefore = collectToolCallReferenceIds(prefixMessages);
const refsAfter = collectToolCallReferenceIds(state.messages as AnyRecord[]);

// Canonical index: tool_result tool_use_id -> owning canonical message id.
const canonicalOwner = new Map<string, string>();
for (const message of messages) {
	for (const part of (Array.isArray(message.content) ? message.content : [])) {
		if (part.type !== "tool_result" && part.type !== "tool-result") {
			continue;
		}
		const id = part.tool_use_id ?? part.id;
		if (typeof id === "string" && id.length > 0 && !canonicalOwner.has(id)) {
			canonicalOwner.set(id, typeof message.id === "string" ? message.id : "");
		}
	}
}

// The production carry-forward section ("## Verified tool outcomes (canonical
// record)") names the identities it carried, by tool-call id.
const summaryText: string =
	typeof state.messages[0]?.metadata?.summary === "string"
		? state.messages[0].metadata.summary
		: "";
const evidenceHeading = "## Verified tool outcomes (canonical record)";
const headingIndex = summaryText.indexOf(evidenceHeading);
const carriedIds = new Set<string>();
if (headingIndex >= 0) {
	const section = summaryText.slice(headingIndex + evidenceHeading.length);
	for (const match of section.matchAll(/\((call_[0-9a-f]+)\)/g)) {
		carriedIds.add(match[1]);
	}
}

const referenceDisposition = [...refsBefore]
	.sort()
	.map((id) => ({
		toolCallId: id,
		workingContextRetained: refsAfter.has(id),
		carriedAsVerifiedEvidence: carriedIds.has(id),
		canonicalRecordPresent: canonicalOwner.has(id),
		canonicalOwnerMessageId: canonicalOwner.get(id) ?? null,
	}));

const droppedIds = referenceDisposition.filter((r) => !r.workingContextRetained);
const droppedPresentInCanonical = droppedIds.filter((r) => r.canonicalRecordPresent);

// --- rejection controls (production contract) -----------------------------------
const tamperedHash = { ...state, source_prefix_hash: `sha256:${"0".repeat(64)}` };
const tamperedCount = { ...state, source_message_count: state.source_message_count + 6 };
const oversizedCount = { ...state, source_message_count: messages.length + 54 };
const mismatchedHashRejected =
	projectSessionCompactionState(tamperedHash as any, messages) === undefined;
const tamperedCountRejected =
	projectSessionCompactionState(tamperedCount as any, messages) === undefined;
const oversizedCountRejected =
	projectSessionCompactionState(oversizedCount as any, messages) === undefined;

// --- appended-after-boundary control --------------------------------------------
const appendedId = "msg_APPENDED_AFTER_BOUNDARY";
const withAppend = [
	...messages,
	{
		id: appendedId,
		role: "user",
		ts: (messages.at(-1)?.ts ?? 0) + 1,
		content: [{ type: "text", text: "appended-after-boundary" }],
	},
];
const projectedWithAppend = projectSessionCompactionState(state, withAppend as any);
const appendedIncorporated =
	projectedWithAppend !== undefined &&
	projectedWithAppend.length === (projected?.length ?? 0) + 1 &&
	projectedWithAppend.some((m: any) => m.id === appendedId);

// --- canonical immutability across the projection --------------------------------
const canonicalBytesBefore = readFileSync(messagesPath);
projectSessionCompactionState(state, messages);
const canonicalBytesAfter = readFileSync(messagesPath);
const canonicalUnchangedByProjection = canonicalBytesBefore.equals(canonicalBytesAfter);

const audit = {
	schema: "cline.ACT-CLINEMM-CANONICAL-EVIDENCE-CONTINUITY-LIVE-01.canonical-continuity-audit.v1",
	act: "ACT-CLINEMM-CANONICAL-EVIDENCE-CONTINUITY-LIVE-01",
	sessionId,
	artifacts: {
		canonicalMessages: {
			name: basename(messagesPath),
			bytes: bytesOf(messagesPath),
			sha256: sha256File(messagesPath),
			schemaVersion: canonical.version,
		},
		compactionSidecar: {
			name: basename(compactionPath),
			bytes: bytesOf(compactionPath),
			sha256: sha256File(compactionPath),
			schemaVersion: sidecarRaw.version,
		},
		sessionManifest: {
			name: basename(manifestPath),
			bytes: bytesOf(manifestPath),
			sha256: sha256File(manifestPath),
			schemaVersion: manifest.version,
		},
	},
	canonicalTranscript: {
		messageCount: messages.length,
		uniqueMessageIds: new Set(canonicalIds).size,
		duplicateMessageIds: duplicateIds.length,
		tsMonotonicityViolations,
		toolUseBlocks: toolUseIds.size,
		toolResultBlocks: toolResultIds.size,
		orphanToolResults: orphanResults.length,
		orphanToolUses: orphanUses.length,
	},
	compactionStateBinding: {
		sourceMessageCount: state.source_message_count,
		sourceLastMessageKey: state.source_last_message_key ?? null,
		storedPrefixHash: state.source_prefix_hash ?? null,
		recomputedPrefixHash: recomputed.source_prefix_hash,
		prefixHashMatches,
		boundaryKeyMatches,
		sidecarMessageCount: state.messages.length,
		sidecarUpdatedAt: state.updated_at,
		canonicalUpdatedAt: canonical.updated_at,
		canonicalTailCount: canonicalTail.length,
	},
	resumeProjection: {
		defined: projected !== undefined,
		projectedMessageCount: projected?.length ?? 0,
		composition:
			projected === undefined
				? null
				: {
					sidecarMessages: state.messages.length,
					canonicalTailMessages: canonicalTail.length,
				},
		canonicalTailIdentityConserved: tailIdentityConserved,
		appendedAfterBoundaryIncorporated: appendedIncorporated,
	},
	evidenceReferenceContinuity: {
		definition: "tool_result.tool_use_id (production collectToolCallReferenceIds)",
		workingContextReferencesBefore: refsBefore.size,
		workingContextReferencesAfter: refsAfter.size,
		retainedInWorkingContext: [...refsBefore].filter((id) => refsAfter.has(id)).length,
		droppedFromWorkingContext: droppedIds.length,
		carriedAsVerifiedEvidence: [...carriedIds].filter((id) => refsBefore.has(id)).length,
		droppedButCarriedAsVerifiedEvidence: droppedIds.filter((r) => r.carriedAsVerifiedEvidence).length,
		droppedAndPresentInCanonicalStorage: droppedPresentInCanonical.length,
		droppedAndMissingFromCanonicalStorage: droppedIds.length - droppedPresentInCanonical.length,
		identityLevelConservationComplete:
			droppedIds.length - droppedPresentInCanonical.length === 0,
		perReference: referenceDisposition,
	},
	rejectionControls: {
		mismatchedPrefixHashRejected: mismatchedHashRejected,
		tamperedSourceMessageCountRejected: tamperedCountRejected,
		oversizedSourceMessageCountRejected: oversizedCountRejected,
	},
	canonicalImmutability: {
		canonicalBytesUnchangedByProjection: canonicalUnchangedByProjection,
		canonicalMessageCountUnchanged: messages.length === canonical.messages.length,
	},
	verdictInputs: {
		prefixHashMatches,
		boundaryKeyMatches,
		projectionDefined: projected !== undefined,
		canonicalTailIdentityConserved: tailIdentityConserved,
		appendedAfterBoundaryIncorporated: appendedIncorporated,
		mismatchedHashRejected,
		tamperedCountRejected,
		oversizedCountRejected,
		canonicalUnchangedByProjection,
		identityLevelConservationComplete:
			droppedIds.length - droppedPresentInCanonical.length === 0,
		orphanToolResults: orphanResults.length,
		orphanToolUses: orphanUses.length,
		duplicateMessageIds: duplicateIds.length,
	},
	privacy: {
		rawCanonicalMessagesCommitted: false,
		rawToolResultPayloadsCommitted: false,
		emittedFields: "opaque identities, hashes, counts and classifications only",
	},
};

/**
 * `verdictInputs` mixes BOOLEAN assertions (must be true) with COUNT
 * assertions (must be zero). A boolean must hold; a count must be zero.
 */
const failures = Object.entries(audit.verdictInputs).filter(([key, value]) =>
	typeof value === "boolean" ? value !== true : value !== 0,
);

process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
if (failures.length > 0) {
	process.stderr.write(
		`AUDIT FAILED: ${failures.map(([k]) => k).join(", ")}\n`,
	);
	process.exit(1);
}
process.stderr.write("AUDIT PASSED: all live continuity checks green\n");
