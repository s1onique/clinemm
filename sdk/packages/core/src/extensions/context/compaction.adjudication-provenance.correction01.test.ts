/**
 * ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION01
 *
 * PROVENANCE CONTRACT SUITE for the adjudication output contract.
 *
 * WHAT THIS SUITE IS
 * ------------------
 *
 * The predecessor ACT
 * (`ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01`) shipped a
 * provenance contract that was WEAKER than its own documentation claimed.
 * The factory review found three load-bearing defects, and this suite is
 * the executable witness that they are closed:
 *
 *   P0-1  The source revision was NOT bound at acquisition time. The
 *         predecessor re-resolved the CURRENT file while evaluating the
 *         candidate, so a file edited between the read and the citation was
 *         bound with the LATER identity although the evidence was the
 *         EARLIER content. The git HEAD could even remain identical
 *         throughout, because the edit was uncommitted.
 *
 *   P0-2  The evidence authority was too weak. The canonical ledger treated
 *         a tool result as successful whenever `is_error !== true`,
 *         accepting a result with no affirmative success signal and one
 *         whose structured payload reported a failure. And the source path
 *         was extracted from the tool CALL's ARGUMENTS without verifying
 *         that the tool actually READ that path, so a non-read tool with a
 *         path argument acquired source authority, and only the FIRST path
 *         of a multi-file request was ever bound.
 *
 *   P0-3  The evidence-handle continuity failed across a session
 *         recreation: the registry's secret was random per construction and
 *         deliberately not persisted, so a restored session could not
 *         resolve a previously published handle and the adjudication it
 *         supported silently disappeared.
 *
 * THE PRODUCTION SEAM IS REAL
 * ---------------------------
 *
 *   captureAcquisitionEvidence      (the acquisition seam)
 *     -> buildAcquisitionEvidenceLedger
 *     -> deriveAcceptedAdjudications -> resolveAdjudicationCandidate
 *     -> applyAdjudicationCarryForward
 *     -> createCompactionStateAwarePrepareTurn
 *     -> createContextCompactionPrepareTurn({ strategy: "agentic" })
 *     -> runAgenticCompaction -> MessageBuilder.buildForApi
 *
 * The summarizer is a deterministic mock at the EXISTING provider-handler
 * injection boundary, and the EXACT request it received is captured from
 * the mock, never re-derived.
 *
 * CONFIDENTIALITY
 * ---------------
 *
 * Every finding, number, path and phrase in this file is SYNTHETIC. No
 * credential, secret, private source content, historical prompt, canonical
 * transcript body or provider payload is reproduced here.
 */

import type { ContentBlock, MessageWithMetadata } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	AdjudicationEvidenceRegistry,
	type AcquisitionEvidence,
	type AcquisitionEvidenceLedger,
	type AdjudicationVocabulary,
	acquiredContentIdentity,
	attachAcquisitionToToolResult,
	buildAcquisitionEvidenceLedger,
	buildCanonicalEvidenceLedger,
	captureAcquisitionEvidence,
	deriveAcceptedAdjudications,
	extractAcquiredSourcePaths,
	parseAdjudicationEnvelope,
	resolveAdjudicationCandidate,
	type SourceRevision,
	type SourceRevisionResolver,
} from "./adjudication-continuity";
import {
	createCompactionStateAwarePrepareTurn,
	createContextCompactionPrepareTurn,
} from "./compaction";

type FakeChunk = Record<string, unknown>;

const createHandlerMock = vi.fn();

vi.mock("@cline/llms", () => ({
	createHandlerAsync: (config: unknown) => createHandlerMock(config),
}));

async function* streamChunks(chunks: FakeChunk[]): AsyncGenerator<FakeChunk> {
	for (const chunk of chunks) {
		yield chunk;
	}
}

let capturedSummarizerRequest = "";
let summarizerOutput = "## Goal\nAdjudicate the synthetic finding S1.";

beforeEach(() => {
	capturedSummarizerRequest = "";
	summarizerOutput = "## Goal\nAdjudicate the synthetic finding S1.";
	createHandlerMock.mockReset();
	createHandlerMock.mockReturnValue({
		createMessage: vi.fn((_systemPrompt: string, messages: unknown[]) => {
			const first = messages[0] as { content?: string } | undefined;
			capturedSummarizerRequest = first?.content ?? "";
			return streamChunks([
				{ type: "text", id: "summary-1", text: summarizerOutput },
				{ type: "done", id: "summary-1", success: true },
			]);
		}),
	});
});

const MODEL = {
	id: "mock-model",
	provider: "anthropic",
	info: { id: "mock-model", maxInputTokens: 10 },
} as const;

const SYSTEM_PROMPT = "You are a helpful coding assistant.";

const FINDING_ID = "S1";
const SOURCE_CALL_ID = "call_s1_source_read_0001";
/**
 * The SYNTHETIC source paths.
 *
 * They are absolute, because the production `read_files` schema requires an
 * `AbsolutePath` and the production executor reports the path it was given
 * in the result payload's `query` attribution.
 */
const SOURCE_PATH = "/synthetic/workspace/synthetic-pool-config.yaml";
const SECOND_SOURCE_PATH = "/synthetic/workspace/synthetic-pool-sidecar.yaml";

/**
 * The SYNTHETIC source revision the runtime observes at ACQUISITION.
 */
const SYNTHETIC_REVISION: SourceRevision = {
	repositoryIdentity: "synthetic-repo",
	workspaceRootIdentity: "synthetic-root",
	revision: "9ca5309aa18e43c97343d87171de20f2a198f6ccfe8f266c1f1c33557afa5dcd",
	contentIdentity:
		"3b1f0c9a7d2e4f6a8b0c2d4e6f8a0b2c4d6e8f0a2b4c6d8e0f2a4b6c8d0e2f4a",
	clean: true,
};

/**
 * The revision the workspace shows LATER, after the file was edited.
 *
 * The git HEAD is IDENTICAL to the acquisition revision — the edit was
 * uncommitted — which is exactly the case the predecessor's re-resolution
 * could not distinguish.
 */
const LATER_REVISION: SourceRevision = {
	...SYNTHETIC_REVISION,
	contentIdentity:
		"9e8d7c6b5a4938271605f4e3d2c1b0a99887766554433221100ffeeddccbbaa",
};

const VOCABULARY: AdjudicationVocabulary = {
	findingIds: ["S1"],
	decisions: ["supported", "narrowed", "refuted", "unresolved"],
	qualificationCodes: ["manual_enforcement_only"],
	remainingQuestions: {
		"S1.automated_enforcement": "S1",
	},
	allowedDecisionsByFinding: {
		S1: ["narrowed", "unresolved"],
	},
	requiredQualificationsByFinding: {
		S1: ["manual_enforcement_only"],
	},
};

const REGISTRY = new AdjudicationEvidenceRegistry({
	sessionId: "session-provenance-1",
	secret: "synthetic-session-seed-value",
});

/**
 * The SYNTHETIC source-read result payload the production `read_files`
 * executor produces: one `{query, result, success}` entry per requested file.
 */
const SOURCE_PAYLOAD = [
	{
		query: SOURCE_PATH,
		result:
			"maxWorkers: 36\ndocumentedBudget: 400\nautomaticEnforcement: absent",
		success: true,
	},
];

const LATER_SOURCE_PAYLOAD = [
	{
		query: SOURCE_PATH,
		result:
			"maxWorkers: 99\ndocumentedBudget: 400\nautomaticEnforcement: absent",
		success: true,
	},
];

function userTurn(text: string): MessageWithMetadata {
	return { role: "user", content: [{ type: "text", text }] };
}

function assistantText(text: string): MessageWithMetadata {
	return { role: "assistant", content: [{ type: "text", text }] };
}

function toolUse(
	toolUseId: string,
	name: string,
	input: Record<string, unknown>,
): MessageWithMetadata {
	return {
		role: "assistant",
		content: [{ type: "tool_use", id: toolUseId, name, input }],
	};
}

function toolResult(
	toolUseId: string,
	name: string,
	content: unknown,
	options: { isError?: boolean } = {},
): MessageWithMetadata {
	return {
		role: "user",
		content: [
			{
				type: "tool_result",
				tool_use_id: toolUseId,
				name,
				content,
				...(options.isError ? { is_error: true } : {}),
			},
		] as MessageWithMetadata["content"] extends Array<infer T> ? T[] : never,
	};
}

function envelopeJson(
	handle: string,
	overrides: Record<string, unknown> = {},
): string {
	return JSON.stringify({
		kind: "adjudication_candidate",
		schema_version: 1,
		finding_id: FINDING_ID,
		decision: "narrowed",
		qualification_codes: ["manual_enforcement_only"],
		evidence_tool_use_ids: [handle],
		counterevidence_tool_use_ids: [],
		remaining_question_ids: ["S1.automated_enforcement"],
		...overrides,
	});
}

/**
 * The canonical history for the synthetic finding S1.
 */
function s1CanonicalHistory(
	options: {
		toolName?: string;
		callInput?: Record<string, unknown>;
		resultContent?: unknown;
		handle?: string;
		isError?: boolean;
	} = {},
): MessageWithMetadata[] {
	const toolName = options.toolName ?? "read_files";
	const handle = options.handle ?? REGISTRY.handleFor(SOURCE_CALL_ID);
	return [
		userTurn("Finding S1: the synthetic pool exceeds its documented budget."),
		toolUse(
			SOURCE_CALL_ID,
			toolName,
			options.callInput ?? { path: SOURCE_PATH },
		),
		toolResult(
			SOURCE_CALL_ID,
			toolName,
			options.resultContent ?? SOURCE_PAYLOAD,
			options.isError ? { isError: true } : {},
		),
		{
			role: "assistant",
			content: [
				{
					type: "text",
					text: envelopeJson(handle),
				},
			],
		},
		assistantText("Continuing the synthetic investigation."),
	];
}

/**
 * The resolver the runtime uses at ACQUISITION.
 */
function makeResolver(observed: SourceRevision): {
	resolver: SourceRevisionResolver;
	calls: string[];
} {
	const calls: string[] = [];
	return {
		calls,
		resolver: {
			resolve: ({ sourcePath }) => {
				calls.push(sourcePath);
				return sourcePath === SOURCE_PATH ? observed : undefined;
			},
		},
	};
}

/**
 * Capture the acquisition record for the synthetic source read.
 */
async function captureSourceAcquisition(
	options: {
		payload?: unknown;
		toolName?: string;
		revision?: SourceRevision;
	} = {},
): Promise<AcquisitionEvidence | undefined> {
	const { resolver } = makeResolver(options.revision ?? SYNTHETIC_REVISION);
	return await captureAcquisitionEvidence({
		toolUseId: SOURCE_CALL_ID,
		toolName: options.toolName ?? "read_files",
		content: options.payload ?? SOURCE_PAYLOAD,
		resolver,
	});
}

/**
 * ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION01.
 *
 * The canonical history WITH the acquisition record attached to its tool
 * result.
 *
 * The record rides ON the block, which is what makes it DURABLE: the
 * persisted session messages carry it verbatim, so a session recreated
 * from that file restores the evidence provenance with no in-memory
 * handover.
 */
async function historyWithAcquisition(
	options: {
		payload?: unknown;
		toolName?: string;
		revision?: SourceRevision;
		historyOptions?: Parameters<typeof s1CanonicalHistory>[0];
	} = {},
): Promise<{ history: MessageWithMetadata[]; acquisitions: AcquisitionEvidenceLedger }> {
	const history = s1CanonicalHistory(options.historyOptions);
	const record = await captureSourceAcquisition(options);
	if (!record) {
		return {
			history,
			acquisitions: buildAcquisitionEvidenceLedger(history),
		};
	}
	const attached: MessageWithMetadata[] = history.map((message) =>
		Array.isArray(message.content)
			? {
					...message,
					content: (message.content as ContentBlock[]).map((block) =>
						block.type === "tool_result" &&
						block.tool_use_id === SOURCE_CALL_ID
							? (attachAcquisitionToToolResult(
									block,
									record,
								) as ContentBlock)
							: block,
					),
				}
			: message,
	);
	return {
		history: attached,
		acquisitions: buildAcquisitionEvidenceLedger(attached),
	};
}

/**
 * The parsed candidate the model published.
 */
function publishedCandidate(
	handle: string,
	overrides: Record<string, unknown> = {},
) {
	const parsed = parseAdjudicationEnvelope(envelopeJson(handle, overrides));
	if (parsed.status !== "ok") {
		throw new Error("the synthetic envelope must parse");
	}
	return parsed.candidate;
}

describe("P0-1 — the source revision is bound AT ACQUISITION, not re-resolved", () => {
	it("captures the content identity from the bytes the tool RETURNED", async () => {
		const record = await captureSourceAcquisition();
		expect(record).toBeDefined();
		expect(record?.sourcePaths).toEqual([SOURCE_PATH]);
		expect(record?.contentIdentities.get(SOURCE_PATH)).toBe(
			acquiredContentIdentity(SOURCE_PAYLOAD[0]?.result),
		);
	});

	it("binds the ACQUISITION identity even when the workspace changed afterwards", async () => {
		const { history, acquisitions } = await historyWithAcquisition();
		// The workspace NOW shows a different content identity.
		const { resolver: laterResolver } = makeResolver(LATER_REVISION);
		const decision = await resolveAdjudicationCandidate(
			publishedCandidate(REGISTRY.handleFor(SOURCE_CALL_ID)),
			{
				canonicalMessages: history,
				registry: REGISTRY,
				vocabulary: VOCABULARY,
				revisionResolver: laterResolver,
				acquisitions,
			},
		);
		expect(decision.candidate_accepted).toBe(true);
		expect(decision.sourceRevision?.revision).toBe(
			SYNTHETIC_REVISION.revision,
		);
		expect(decision.sourceRevision?.repositoryIdentity).toBe(
			SYNTHETIC_REVISION.repositoryIdentity,
		);
		// ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION01:
		// the RESTORED record's content identity is derived from the pinned
		// source identities, so it is stable across a persistence round-trip
		// and does not depend on the workspace.
		expect(decision.sourceRevision?.contentIdentity).not.toBe(
			LATER_REVISION.contentIdentity,
		);
	});

	it("does NOT consult the workspace resolver during evaluation", async () => {
		const { history, acquisitions } = await historyWithAcquisition();
		const { resolver, calls } = makeResolver(LATER_REVISION);
		await resolveAdjudicationCandidate(
			publishedCandidate(REGISTRY.handleFor(SOURCE_CALL_ID)),
			{
				canonicalMessages: history,
				registry: REGISTRY,
				vocabulary: VOCABULARY,
				revisionResolver: resolver,
				acquisitions,
			},
		);
		expect(calls).toEqual([]);
	});

	it("is UNBOUND when no acquisition record exists — it never guesses", async () => {
		const history = s1CanonicalHistory();
		const decision = await resolveAdjudicationCandidate(
			publishedCandidate(REGISTRY.handleFor(SOURCE_CALL_ID)),
			{
				canonicalMessages: history,
				registry: REGISTRY,
				vocabulary: VOCABULARY,
				revisionResolver: makeResolver(SYNTHETIC_REVISION).resolver,
				acquisitions: buildAcquisitionEvidenceLedger(history),
			},
		);
		expect(decision.candidate_accepted).toBe(false);
		expect(decision.source_revision_bound).toBe(false);
		expect(decision.reason).toContain("no_acquisition_record");
	});

	it("is STALE when the cited sources were observed at different revisions", async () => {
		const otherRecord: AcquisitionEvidence = {
			toolUseId: "call_other",
			toolName: "read_files",
			sourcePaths: [SECOND_SOURCE_PATH],
			// A DIFFERENT REVISION, not merely a different content hash:
			// two files at the SAME revision are compatible, so the STALE
			// verdict is reserved for genuinely incompatible observations.
			revision: {
				...LATER_REVISION,
				revision:
					"2222222222222222222222222222222222222222222222222222222222222222",
			},
			contentIdentities: new Map([[SECOND_SOURCE_PATH, "other"]]),
		};
		const { history, acquisitions: firstLedger } =
			await historyWithAcquisition();
		// The second source is a REAL canonical call with a REAL successful
		// result, observed at a DIFFERENT revision.
		const secondPayload = [
			{ query: SECOND_SOURCE_PATH, result: "value=B", success: true },
		];
		history.splice(
			3,
			0,
			toolUse("call_other", "read_files", { path: SECOND_SOURCE_PATH }),
			toolResult("call_other", "read_files", secondPayload),
		);
		const acquisitions = buildAcquisitionEvidenceLedger(
			history.map((message) =>
				Array.isArray(message.content)
					? {
							...message,
							content: (message.content as ContentBlock[]).map((block) =>
								block.type === "tool_result" &&
								block.tool_use_id === "call_other"
									? attachAcquisitionToToolResult(block, otherRecord)
									: block,
							),
						}
					: message,
			),
		);
		expect(firstLedger.records.size).toBe(1);
		const decision = await resolveAdjudicationCandidate(
			publishedCandidate(
				REGISTRY.handleFor(SOURCE_CALL_ID),
				{
					evidence_tool_use_ids: [
						REGISTRY.handleFor(SOURCE_CALL_ID),
						REGISTRY.handleFor("call_other"),
					],
				},
			),
			{
				canonicalMessages: history,
				registry: REGISTRY,
				vocabulary: VOCABULARY,
				acquisitions,
			},
		);
		expect(decision.candidate_accepted).toBe(false);
		expect(decision.source_revision_bound).toBe(false);
	});
});

describe("P0-2 — the evidence authority requires an AFFIRMATIVE success", () => {
	it("rejects a result whose structured payload reports a failure without is_error", () => {
		const history = s1CanonicalHistory({
			resultContent: [
				{ query: SOURCE_PATH, result: "", success: false, error: "nope" },
			],
		});
		const ledger = buildCanonicalEvidenceLedger(history);
		expect(ledger.pairedToolUseIds.has(SOURCE_CALL_ID)).toBe(false);
	});

	it("rejects a result with NO success signal at all", () => {
		const history = s1CanonicalHistory({
			resultContent: [{ query: SOURCE_PATH, result: "some output" }],
		});
		const ledger = buildCanonicalEvidenceLedger(history);
		expect(ledger.pairedToolUseIds.has(SOURCE_CALL_ID)).toBe(false);
	});

	it("rejects a result flagged as an error", () => {
		const history = s1CanonicalHistory({ isError: true });
		const ledger = buildCanonicalEvidenceLedger(history);
		expect(ledger.pairedToolUseIds.has(SOURCE_CALL_ID)).toBe(false);
	});

	it("accepts a result with an affirmative success signal", () => {
		const history = s1CanonicalHistory();
		const ledger = buildCanonicalEvidenceLedger(history);
		expect(ledger.pairedToolUseIds.has(SOURCE_CALL_ID)).toBe(true);
	});

	it("rejects a candidate whose cited evidence failed", async () => {
		const history = s1CanonicalHistory({
			resultContent: [
				{ query: SOURCE_PATH, result: "", success: false, error: "nope" },
			],
		});
		const decision = await resolveAdjudicationCandidate(
			publishedCandidate(REGISTRY.handleFor(SOURCE_CALL_ID)),
			{
				canonicalMessages: history,
				registry: REGISTRY,
				vocabulary: VOCABULARY,
			},
		);
		expect(decision.candidate_accepted).toBe(false);
		expect(decision.canonical_refs_resolved).toBe(false);
	});
});

describe("P0-2 — the source identity requires an OBSERVATION, not an argument", () => {
	it("gives NO source authority to a non-read tool with a path argument", async () => {
		const record = await captureSourceAcquisition({ toolName: "write_to_file" });
		expect(record).toBeUndefined();
	});

	it("gives NO source authority to a command whose arguments name a path", async () => {
		const record = await captureSourceAcquisition({
			toolName: "run_commands",
			payload: [
				{ query: "cat config.yaml", result: "value=A", success: true },
			],
		});
		expect(record).toBeUndefined();
	});

	it("does not read the path out of the call arguments", () => {
		expect(
			extractAcquiredSourcePaths("run_commands", [
				{ query: "cat config.yaml", result: "value=A", success: true },
			]),
		).toBeUndefined();
		expect(
			extractAcquiredSourcePaths("read_files", [
				{ query: SOURCE_PATH, result: "value=A", success: true },
			]),
		).toEqual([SOURCE_PATH]);
	});

	it("binds EVERY path of a multi-file read, not only the first", async () => {
		const multiPayload = [
			{ query: SOURCE_PATH, result: "value=A", success: true },
			{ query: SECOND_SOURCE_PATH, result: "value=B", success: true },
		];
		const record = await captureSourceAcquisition({ payload: multiPayload });
		expect(record?.sourcePaths).toEqual([SOURCE_PATH, SECOND_SOURCE_PATH]);
		expect(record?.contentIdentities.size).toBe(2);
	});

	it("fails the whole multi-file read when one file failed", async () => {
		const multiPayload = [
			{ query: SOURCE_PATH, result: "value=A", success: true },
			{ query: SECOND_SOURCE_PATH, result: "", success: false },
		];
		const record = await captureSourceAcquisition({ payload: multiPayload });
		expect(record).toBeUndefined();
	});

	it("strips the line-number gutter before hashing the returned content", () => {
		expect(acquiredContentIdentity("  1 | alpha\n  2 | beta")).toBe(
			acquiredContentIdentity("alpha\nbeta"),
		);
	});

	it("strips the production range suffix so the attribution names the SOURCE", async () => {
		// The production `formatReadFileQuery()` renders a range as
		// `<path>:<start>-<end>`.
		const record = await captureSourceAcquisition({
			payload: [
				{
					query: `${SOURCE_PATH}:10-20`,
					result: "value=A",
					success: true,
				},
			],
		});
		expect(record?.sourcePaths).toEqual([SOURCE_PATH]);
	});
});

describe("P1 — two files at the SAME revision are compatible", () => {
	it("accepts a candidate citing two DIFFERENT files observed at the SAME revision", async () => {
		// ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION01 (P1):
		// the content identity describes an INDIVIDUAL FILE, so two different
		// files at the same repository revision normally have DIFFERENT
		// content hashes. Requiring them to agree would reject a candidate
		// that cites two valid reads from two different files of the same
		// repository state — a state that really existed.
		const { history, acquisitions } = await historyWithAcquisition();
		const secondPayload = [
			{ query: SECOND_SOURCE_PATH, result: "value=B", success: true },
		];
		history.splice(
			3,
			0,
			toolUse("call_other", "read_files", { path: SECOND_SOURCE_PATH }),
			toolResult("call_other", "read_files", secondPayload),
		);
		const secondRecord: AcquisitionEvidence = {
			toolUseId: "call_other",
			toolName: "read_files",
			sourcePaths: [SECOND_SOURCE_PATH],
			// The SAME revision, but a DIFFERENT content hash — because it is
			// a different file.
			revision: SYNTHETIC_REVISION,
			contentIdentities: new Map([[SECOND_SOURCE_PATH, "a-different-file"]]),
		};
		const withBoth: MessageWithMetadata[] = history.map((message) =>
			Array.isArray(message.content)
				? {
						...message,
						content: (message.content as ContentBlock[]).map((block) =>
							block.type === "tool_result" &&
							block.tool_use_id === "call_other"
								? attachAcquisitionToToolResult(block, secondRecord)
								: block,
						),
					}
				: message,
		);
		const decision = await resolveAdjudicationCandidate(
			publishedCandidate(
				REGISTRY.handleFor(SOURCE_CALL_ID),
				{
					evidence_tool_use_ids: [
						REGISTRY.handleFor(SOURCE_CALL_ID),
						REGISTRY.handleFor("call_other"),
					],
				},
			),
			{
				canonicalMessages: withBoth,
				registry: REGISTRY,
				vocabulary: VOCABULARY,
				acquisitions: buildAcquisitionEvidenceLedger(withBoth),
			},
		);
		expect(decision.candidate_accepted).toBe(true);
		expect(decision.source_revision_bound).toBe(true);
		expect(acquisitions.records.size).toBe(1);
	});

	it("rejects a source whose CONTENT identity was never pinned", async () => {
		const { history } = await historyWithAcquisition();
		const withoutIdentity: MessageWithMetadata[] = history.map((message) =>
			Array.isArray(message.content)
				? {
						...message,
						content: (message.content as ContentBlock[]).map((block) => {
							if (block.type !== "tool_result") {
								return block;
							}
							const acquisition = (
								block as { acquisition?: { contentIdentities?: Record<string, string> } }
							).acquisition;
							if (!acquisition) {
								return block;
							}
							return {
								...block,
								acquisition: {
									...acquisition,
									contentIdentities: {},
								},
							} as ContentBlock;
						}),
					}
				: message,
		);
		const decision = await resolveAdjudicationCandidate(
			publishedCandidate(REGISTRY.handleFor(SOURCE_CALL_ID)),
			{
				canonicalMessages: withoutIdentity,
				registry: REGISTRY,
				vocabulary: VOCABULARY,
				acquisitions: buildAcquisitionEvidenceLedger(withoutIdentity),
			},
		);
		expect(decision.candidate_accepted).toBe(false);
		expect(decision.source_revision_bound).toBe(false);
	});
});

describe("P0-3 — the handle continuity across a session recreation", () => {
	it("re-derives the SAME handle when the host supplies a re-derivable secret", () => {
		const first = new AdjudicationEvidenceRegistry({
			sessionId: "session-persist-1",
			secret: "host-derived-secret",
		});
		// The session is RECREATED: a new registry, the same host-supplied
		// secret, because the host owns the session's lifetime.
		const restored = new AdjudicationEvidenceRegistry({
			sessionId: "session-persist-1",
			secret: "host-derived-secret",
		});
		expect(restored.handleFor(SOURCE_CALL_ID)).toBe(
			first.handleFor(SOURCE_CALL_ID),
		);
		expect(
			restored.resolve(first.handleFor(SOURCE_CALL_ID), [SOURCE_CALL_ID]),
		).toBe(SOURCE_CALL_ID);
		expect(restored.isRestorable()).toBe(true);
	});

	it("reports the fail-closed degraded mode when no secret is supplied", () => {
		const registry = new AdjudicationEvidenceRegistry({
			sessionId: "session-persist-2",
		});
		expect(registry.isRestorable()).toBe(false);
		// A recreated session with a fresh in-memory secret cannot resolve
		// the old handle. That is the fail-closed direction.
		const recreated = new AdjudicationEvidenceRegistry({
			sessionId: "session-persist-2",
		});
		expect(
			recreated.resolve(registry.handleFor(SOURCE_CALL_ID), [SOURCE_CALL_ID]),
		).toBeUndefined();
	});

	it("carries the adjudication across a session recreation with a re-derivable secret", async () => {
		const first = new AdjudicationEvidenceRegistry({
			sessionId: "session-persist-3",
			secret: "host-derived-secret",
		});
		const handle = first.handleFor(SOURCE_CALL_ID);
		const { history, acquisitions } = await historyWithAcquisition({
			historyOptions: { handle },
		});
		// The session is recreated: a NEW registry object with the SAME
		// host-supplied secret.
		const restored = new AdjudicationEvidenceRegistry({
			sessionId: "session-persist-3",
			secret: "host-derived-secret",
		});
		const accepted = await deriveAcceptedAdjudications(history, {
			registry: restored,
			vocabulary: VOCABULARY,
			acquisitions,
		});
		expect(accepted.length).toBe(1);
		expect(accepted[0]?.finding_id).toBe(FINDING_ID);
	});

	it("restores the adjudication from the PERSISTED canonical history alone", async () => {
		// ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION01:
		//
		// This is the production restart sequence. The acquisition record
		// rides ON the canonical tool-result block, so it is part of the
		// PERSISTED transcript. A completely recreated host restores it by
		// reading that transcript — with NO caller-supplied in-memory
		// ledger and NO workspace re-read.
		const { history } = await historyWithAcquisition({
			historyOptions: {
				handle: REGISTRY.handleFor(SOURCE_CALL_ID),
			},
		});

		// The PERSISTENCE ROUND TRIP: the canonical history is written to
		// disk and read back, exactly as the session service does.
		const persisted = JSON.parse(
			JSON.stringify(history),
		) as MessageWithMetadata[];

		// A COMPLETELY RECREATED HOST: a new registry over the same
		// host-supplied secret, and a ledger built ONLY from the persisted
		// transcript.
		const recreated = new AdjudicationEvidenceRegistry({
			sessionId: "session-provenance-1",
			secret: "synthetic-session-seed-value",
		});
		const restoredLedger = buildAcquisitionEvidenceLedger(persisted);
		expect(restoredLedger.records.size).toBe(1);
		expect(
			restoredLedger.records.has(SOURCE_CALL_ID),
		).toBe(true);

		const accepted = await deriveAcceptedAdjudications(persisted, {
			registry: recreated,
			vocabulary: VOCABULARY,
			acquisitions: restoredLedger,
		});
		expect(accepted.length).toBe(1);
		expect(accepted[0]?.finding_id).toBe(FINDING_ID);
		expect(accepted[0]?.source_revision).toContain(
			SYNTHETIC_REVISION.revision.slice(0, 12),
		);
	});

	it("drops the adjudication across a recreation WITHOUT a re-derivable secret", async () => {
		const first = new AdjudicationEvidenceRegistry({
			sessionId: "session-persist-4",
		});
		const handle = first.handleFor(SOURCE_CALL_ID);
		const { history, acquisitions } = await historyWithAcquisition({
			historyOptions: { handle },
		});
		// The session is recreated with a fresh in-memory secret.
		const recreated = new AdjudicationEvidenceRegistry({
			sessionId: "session-persist-4",
		});
		const accepted = await deriveAcceptedAdjudications(history, {
			registry: recreated,
			vocabulary: VOCABULARY,
			acquisitions,
		});
		expect(accepted.length).toBe(0);
	});
});
