/**
 * ACT-CLINEMM-ADJUDICATION-VSCODE-ACTIVATION-01
 *
 * RUNTIME-CHAIN witnesses for the adjudication continuity contract, driven
 * through the REAL SDK production seams with the REAL VS Code host adapters.
 *
 * WHAT IS REAL HERE
 * -----------------
 *
 *   - the VS Code host adapters under test:
 *       apps/vscode/src/sdk/adjudication-source-revision-resolver.ts
 *       apps/vscode/src/sdk/adjudication-session-secret.ts
 *       apps/vscode/src/sdk/adjudication-task-contract.ts
 *
 *   - the REAL SDK adjudication classes:
 *       AdjudicationEvidenceRegistry
 *       captureAcquisitionEvidence / attachAcquisitionToToolResult
 *       buildAcquisitionEvidenceLedger
 *       deriveAcceptedAdjudications / resolveAdjudicationCandidate
 *       parseAdjudicationEnvelope
 *       createCompactionStateAwarePrepareTurn / createContextCompactionPrepareTurn
 *
 *   - the REAL production `read_files` result shape: one
 *     `{query, result, success}` payload per requested file, with the line
 *     gutter the production executor renders.
 *
 * The ONLY mocked collaborator is the summarizer's provider handler, which is
 * the EXISTING provider-handler injection boundary. The EXACT request the
 * summarizer received is captured from the mock, never re-derived.
 *
 * CONFIDENTIALITY
 * ---------------
 *
 * Every finding, number, path and phrase in this file is SYNTHETIC. No
 * credential, secret value, private source content, historical prompt or
 * provider payload is reproduced here.
 */

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type * as LlmsProviders from "@cline/llms"
import type { ContentBlock, MessageWithMetadata } from "@cline/shared"
import {
	type AcquisitionEvidence,
	AdjudicationEvidenceRegistry,
	type AdjudicationVocabulary,
	attachAcquisitionToToolResult,
	buildAcquisitionEvidenceLedger,
	captureAcquisitionEvidence,
	deriveAcceptedAdjudications,
	parseAdjudicationEnvelope,
	resolveAdjudicationCandidate,
} from "@cline-internal/core/extensions/context/adjudication-continuity"
import {
	createCompactionStateAwarePrepareTurn,
	createContextCompactionPrepareTurn,
} from "@cline-internal/core/extensions/context/compaction"
import { MessageBuilder } from "@cline-internal/core/session/services/message-builder"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
	createSessionSecretProvider,
	createSessionSecretProviderForRestore,
	createSessionSecretProviderForStart,
} from "../adjudication-session-secret"
import { createVscodeSourceRevisionResolver } from "../adjudication-source-revision-resolver"

/**
 * The synthetic, explicitly-approved task-scoped vocabulary.
 */
const AUTHORIZED_VOCABULARY: AdjudicationVocabulary = {
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
}

/**
 * The synthetic source file the "agent" reads.
 */
const SYNTHETIC_SOURCE_PATH = "synthetic/pool-config.ts"
const SYNTHETIC_SOURCE_BODY = ["export const POOL_BUDGET = 4", "export const POOL_SIZE = 8"].join("\n")
/**
 * The production `read_files` executor renders each line as `<n> | <text>`.
 */
const SYNTHETIC_RENDERED_BODY = SYNTHETIC_SOURCE_BODY.split("\n")
	.map((line, index) => `${index + 1} | ${line}`)
	.join("\n")

/**
 * Create a REAL, tiny, synthetic git repository with the synthetic source
 * file committed.
 *
 * The fixture is non-sensitive and self-contained: a temp directory with
 * one file and one commit. It gives the resolver a real repository, a real
 * HEAD and a real working tree to observe.
 */
function createSyntheticGitFixture(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "adjudication-vscode-activation01-fixture-"))
	const sourceDir = path.join(root, path.dirname(SYNTHETIC_SOURCE_PATH))
	fs.mkdirSync(sourceDir, { recursive: true })
	fs.writeFileSync(path.join(root, SYNTHETIC_SOURCE_PATH), `${SYNTHETIC_SOURCE_BODY}\n`, "utf8")
	const git = (args: string[]) => execFileSync("git", args, { cwd: root, stdio: "ignore" })
	git(["init", "-q"])
	git(["config", "user.email", "fixture@example.invalid"])
	git(["config", "user.name", "Adjudication Fixture"])
	git(["add", "."])
	git(["commit", "-q", "-m", "synthetic fixture"])
	return root
}

/**
 * Build the canonical history for one successful `read_files` observation.
 */
function buildCanonicalHistory(toolUseId: string, acquisition: AcquisitionEvidence | undefined): MessageWithMetadata[] {
	const toolResultBlock = {
		type: "tool_result",
		tool_use_id: toolUseId,
		content: [{ query: SYNTHETIC_SOURCE_PATH, result: SYNTHETIC_RENDERED_BODY, success: true }],
		is_error: false,
	} as unknown as ContentBlock
	return [
		{
			role: "user",
			content: [{ type: "text", text: "Adjudicate S1." }],
			ts: 1,
		},
		{
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id: toolUseId,
					name: "read_files",
					input: { paths: [SYNTHETIC_SOURCE_PATH] },
				},
			],
			ts: 2,
		},
		{
			role: "user",
			content: [attachAcquisitionToToolResult(toolResultBlock, acquisition)],
			ts: 3,
		},
	] as unknown as MessageWithMetadata[]
}

/**
 * Read the text of a message carrier.
 *
 * The provider-visible projection carries content either as a plain string
 * or as an array of parts, depending on the provider format. Both shapes are
 * read here so the witness asserts on the TEXT the provider actually reads.
 */
function readCarrierText(message: unknown): string {
	const content = (message as { content?: unknown } | undefined)?.content
	if (typeof content === "string") {
		return content
	}
	if (Array.isArray(content)) {
		return content
			.map((part) => {
				const text = (part as { text?: unknown } | undefined)?.text
				return typeof text === "string" ? text : ""
			})
			.join("\n")
	}
	return ""
}

/**
 * The assistant-text carrier a model publishes.
 */
function buildPublishedCandidate(handle: string): string {
	return JSON.stringify({
		kind: "adjudication_candidate",
		schema_version: 1,
		finding_id: "S1",
		decision: "narrowed",
		qualification_codes: ["manual_enforcement_only"],
		evidence_tool_use_ids: [handle],
		counterevidence_tool_use_ids: [],
		remaining_question_ids: ["S1.automated_enforcement"],
	})
}

// ---------------------------------------------------------------------------
// The summarizer boundary
// ---------------------------------------------------------------------------

type FakeChunk = Record<string, unknown>

const createHandlerMock = vi.fn()

/**
 * The in-memory secret store standing in for the extension's file-backed
 * `secrets.json`.
 *
 * It is a REAL key/value store with the REAL `getSecretKey` / `setSecret`
 * contract, so the session-secret provider's persistence behaviour is
 * exercised for real (the same secret for the same session id, a different
 * secret for a different session id).
 */
const secretStore = new Map<string, string>()

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => ({
			getSecretKey: (key: string) => secretStore.get(key),
			setSecret: (key: string, value: string) => {
				secretStore.set(key, value)
			},
		}),
	},
}))

// PARTIAL mock: only `createHandlerAsync` is replaced (the summarizer's
// injection boundary). Every other export of `@cline/llms` is the REAL one,
// because the production `MessageBuilder` transitively needs the real
// catalog (`MODEL_COLLECTIONS_BY_PROVIDER_ID`).
vi.mock("@cline/llms", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>()
	return {
		...actual,
		createHandlerAsync: (config: unknown) => createHandlerMock(config),
	}
})

async function* streamChunks(chunks: FakeChunk[]): AsyncGenerator<FakeChunk> {
	for (const chunk of chunks) {
		yield chunk
	}
}

/**
 * The EXACT request string the production summarizer sent to the provider.
 *
 * Captured from the mocked provider handler — the existing summarizer
 * injection boundary — and never re-derived from the production code.
 */
let capturedSummarizerRequest = ""

/**
 * The summary the mocked summarizer returns.
 *
 * The default OMITS the candidate entirely: it reproduces the HISTORICAL
 * summarizer behaviour, in which the summarizer's lossy projection dropped
 * the adjudication.
 */
let summarizerOutput = "## Goal\nAdjudicate the synthetic finding S1."

beforeEach(() => {
	capturedSummarizerRequest = ""
	summarizerOutput = "## Goal\nAdjudicate the synthetic finding S1."
	createHandlerMock.mockReset()
	createHandlerMock.mockReturnValue({
		createMessage: vi.fn((_systemPrompt: string, messages: unknown[]) => {
			const first = messages[0] as { content?: string } | undefined
			capturedSummarizerRequest = first?.content ?? ""
			return streamChunks([
				{ type: "text", id: "summary-1", text: summarizerOutput },
				{ type: "done", id: "summary-1", success: true },
			])
		}),
	})
})

/**
 * A deliberately small input limit so the REAL auto-mode eligibility check
 * (`shouldCompact`) is TRUE and the production compaction path actually
 * runs.
 */
const MODEL = {
	id: "mock-model",
	provider: "anthropic",
	info: { id: "mock-model", maxInputTokens: 10 },
} as unknown as LlmsProviders.ModelInfo

/**
 * The model the state-aware prepareTurn is invoked with. Its generous input
 * limit keeps the task-contract budget guard satisfied so the compaction
 * path can complete.
 */
const PREPARE_TURN_MODEL = {
	id: "mock-model",
	provider: "anthropic",
	info: { id: "mock-model", maxInputTokens: 128_000 },
} as unknown as LlmsProviders.ModelInfo

describe("ACT-CLINEMM-ADJUDICATION-VSCODE-ACTIVATION-01 — runtime chain", () => {
	describe("RED-3 — real source observation produces acquisition evidence", () => {
		it("captures an acquisition record bound to the runtime-resolved revision", async () => {
			// A REAL, tiny, synthetic git repository: the resolver must
			// establish a source identity against it.
			const workspaceRoot = await createSyntheticGitFixture()

			const resolver = createVscodeSourceRevisionResolver({ workspaceRoot })
			const acquisition = await captureAcquisitionEvidence({
				toolUseId: "call-1",
				toolName: "read_files",
				content: [{ query: SYNTHETIC_SOURCE_PATH, result: SYNTHETIC_RENDERED_BODY, success: true }],
				resolver,
			})

			expect(acquisition).toBeDefined()
			expect(acquisition?.sourcePaths).toEqual([SYNTHETIC_SOURCE_PATH])
			// The runtime-bound source revision.
			expect(acquisition?.revision.revision).toMatch(/^[0-9a-f]{40}$/)
			// The content identity of the observed source.
			expect(acquisition?.contentIdentities.size).toBe(1)
			// The workspace identity is a DIGEST, never an absolute path.
			expect(acquisition?.revision.workspaceRootIdentity).toMatch(/^[0-9a-f]{64}$/)
			expect(acquisition?.revision.workspaceRootIdentity).not.toContain(workspaceRoot)
			// The repository identity is a digest of the (sanitized) remote.
			expect(acquisition?.revision.repositoryIdentity).toMatch(/^[0-9a-f]{64}$/)
		})

		it("captures NO acquisition for a run_commands result (evidence class gate)", async () => {
			const workspaceRoot = await createSyntheticGitFixture()
			const resolver = createVscodeSourceRevisionResolver({ workspaceRoot })

			// A shell command's stdout is NEVER promoted to read_files
			// evidence, even when it "looks like" a file read.
			const acquisition = await captureAcquisitionEvidence({
				toolUseId: "call-1",
				toolName: "run_commands",
				content: [{ query: SYNTHETIC_SOURCE_PATH, result: SYNTHETIC_RENDERED_BODY, success: true }],
				resolver,
			})

			expect(acquisition).toBeUndefined()
		})

		it("captures NO acquisition for a FAILED read", async () => {
			const workspaceRoot = await createSyntheticGitFixture()
			const resolver = createVscodeSourceRevisionResolver({ workspaceRoot })

			const acquisition = await captureAcquisitionEvidence({
				toolUseId: "call-1",
				toolName: "read_files",
				content: [{ query: SYNTHETIC_SOURCE_PATH, result: "ENOENT", success: false }],
				resolver,
			})

			expect(acquisition).toBeUndefined()
		})

		it("fails closed for a source path OUTSIDE the authorized workspace", async () => {
			const workspaceRoot = await createSyntheticGitFixture()
			const resolver = createVscodeSourceRevisionResolver({ workspaceRoot })

			const acquisition = await captureAcquisitionEvidence({
				toolUseId: "call-1",
				toolName: "read_files",
				content: [
					{
						query: path.join(path.dirname(workspaceRoot), "outside.ts"),
						result: SYNTHETIC_RENDERED_BODY,
						success: true,
					},
				],
				resolver,
			})

			expect(acquisition).toBeUndefined()
		})
	})

	describe("RED-4 — candidate acceptance (C1)", () => {
		it("accepts a candidate citing the ACTUAL observed handle", async () => {
			const workspaceRoot = await createSyntheticGitFixture()
			const resolver = createVscodeSourceRevisionResolver({ workspaceRoot })
			const secretProvider = createSessionSecretProvider({ allowCreate: false })
			const sessionId = "session-red4"
			const secret = await secretProvider(sessionId)
			const registry = new AdjudicationEvidenceRegistry({ sessionId, secret })

			const toolUseId = "call-red4"
			const acquisition = await captureAcquisitionEvidence({
				toolUseId,
				toolName: "read_files",
				content: [{ query: SYNTHETIC_SOURCE_PATH, result: SYNTHETIC_RENDERED_BODY, success: true }],
				resolver,
			})
			expect(acquisition).toBeDefined()

			const messages = buildCanonicalHistory(toolUseId, acquisition)
			const handle = registry.handleFor(toolUseId)
			expect(handle).toMatch(/^cline-ev-[0-9a-f]{16}$/)

			// The model publishes a candidate on an assistant-text carrier.
			const published = buildPublishedCandidate(handle)
			const parsed = parseAdjudicationEnvelope(published)
			expect(parsed.status).toBe("ok")

			const acquisitions = buildAcquisitionEvidenceLedger(messages)
			const decision = await resolveAdjudicationCandidate(parsed.status === "ok" ? parsed.candidate : undefined!, {
				canonicalMessages: messages,
				registry,
				vocabulary: AUTHORIZED_VOCABULARY,
				revisionResolver: resolver,
				acquisitions,
			})

			// GATE 1 — schema validity.
			expect(parsed.status).toBe("ok")
			expect(decision.schema_valid).toBe(true)
			// GATE 2 — canonical reference resolution.
			expect(decision.canonical_refs_resolved).toBe(true)
			// GATE 3 — source revision binding.
			expect(decision.source_revision_bound).toBe(true)
			// GATE 4 — candidate acceptance.
			expect(decision.candidate_accepted).toBe(true)
			expect(decision.reason).toBeUndefined()
			// The candidate stays MODEL-AUTHORED and PROVISIONAL.
			expect(decision.author).toBe("MODEL")
			expect(decision.authority).toBe("PROVISIONAL")
			// No independent adjudicator exists, so semantic support is
			// never claimed.
			expect(decision.semantic_support_verified).toBe(false)
		})

		it("REJECTS a forged handle and an empty evidence list", async () => {
			const workspaceRoot = await createSyntheticGitFixture()
			const resolver = createVscodeSourceRevisionResolver({ workspaceRoot })
			const secretProvider = createSessionSecretProvider({ allowCreate: false })
			const sessionId = "session-red4-neg"
			const secret = await secretProvider(sessionId)
			const registry = new AdjudicationEvidenceRegistry({ sessionId, secret })

			const toolUseId = "call-red4-neg"
			const acquisition = await captureAcquisitionEvidence({
				toolUseId,
				toolName: "read_files",
				content: [{ query: SYNTHETIC_SOURCE_PATH, result: SYNTHETIC_RENDERED_BODY, success: true }],
				resolver,
			})
			const messages = buildCanonicalHistory(toolUseId, acquisition)
			const acquisitions = buildAcquisitionEvidenceLedger(messages)

			// A FORGED handle resolves to nothing.
			const forged = parseAdjudicationEnvelope(buildPublishedCandidate("cline-ev-0000000000000000"))
			expect(forged.status).toBe("ok")
			const forgedDecision = await resolveAdjudicationCandidate(forged.status === "ok" ? forged.candidate : undefined!, {
				canonicalMessages: messages,
				registry,
				vocabulary: AUTHORIZED_VOCABULARY,
				revisionResolver: resolver,
				acquisitions,
			})
			expect(forgedDecision.candidate_accepted).toBe(false)
			expect(forgedDecision.canonical_refs_resolved).toBe(false)

			// An EMPTY evidence list is not a binding witness.
			const empty = parseAdjudicationEnvelope(
				JSON.stringify({
					kind: "adjudication_candidate",
					schema_version: 1,
					finding_id: "S1",
					decision: "narrowed",
					qualification_codes: ["manual_enforcement_only"],
					evidence_tool_use_ids: [],
					counterevidence_tool_use_ids: [],
					remaining_question_ids: ["S1.automated_enforcement"],
				}),
			)
			expect(empty.status).toBe("ok")
			const emptyDecision = await resolveAdjudicationCandidate(empty.status === "ok" ? empty.candidate : undefined!, {
				canonicalMessages: messages,
				registry,
				vocabulary: AUTHORIZED_VOCABULARY,
				revisionResolver: resolver,
				acquisitions,
			})
			expect(emptyDecision.candidate_accepted).toBe(false)
		})

		it("REJECTS an unknown finding id and a missing essential qualification", async () => {
			const workspaceRoot = await createSyntheticGitFixture()
			const resolver = createVscodeSourceRevisionResolver({ workspaceRoot })
			const secretProvider = createSessionSecretProvider({ allowCreate: false })
			const sessionId = "session-red4-vocab"
			const secret = await secretProvider(sessionId)
			const registry = new AdjudicationEvidenceRegistry({ sessionId, secret })

			const toolUseId = "call-red4-vocab"
			const acquisition = await captureAcquisitionEvidence({
				toolUseId,
				toolName: "read_files",
				content: [{ query: SYNTHETIC_SOURCE_PATH, result: SYNTHETIC_RENDERED_BODY, success: true }],
				resolver,
			})
			const messages = buildCanonicalHistory(toolUseId, acquisition)
			const acquisitions = buildAcquisitionEvidenceLedger(messages)
			const handle = registry.handleFor(toolUseId)

			const resolve = async (candidate: Record<string, unknown>) => {
				const parsed = parseAdjudicationEnvelope(JSON.stringify(candidate))
				expect(parsed.status).toBe("ok")
				return await resolveAdjudicationCandidate(parsed.status === "ok" ? parsed.candidate : undefined!, {
					canonicalMessages: messages,
					registry,
					vocabulary: AUTHORIZED_VOCABULARY,
					revisionResolver: resolver,
					acquisitions,
				})
			}

			// An UNKNOWN finding id is rejected.
			const unknownFinding = await resolve({
				kind: "adjudication_candidate",
				schema_version: 1,
				finding_id: "R7",
				decision: "narrowed",
				qualification_codes: ["manual_enforcement_only"],
				evidence_tool_use_ids: [handle],
				counterevidence_tool_use_ids: [],
				remaining_question_ids: ["S1.automated_enforcement"],
			})
			expect(unknownFinding.candidate_accepted).toBe(false)

			// A MISSING essential qualification is rejected.
			const missingQualification = await resolve({
				kind: "adjudication_candidate",
				schema_version: 1,
				finding_id: "S1",
				decision: "narrowed",
				qualification_codes: [],
				evidence_tool_use_ids: [handle],
				counterevidence_tool_use_ids: [],
				remaining_question_ids: ["S1.automated_enforcement"],
			})
			expect(missingQualification.candidate_accepted).toBe(false)
		})

		it("REJECTS a candidate when the vocabulary is absent (no default vocabulary)", async () => {
			const workspaceRoot = await createSyntheticGitFixture()
			const resolver = createVscodeSourceRevisionResolver({ workspaceRoot })
			const secretProvider = createSessionSecretProvider({ allowCreate: false })
			const sessionId = "session-red4-novocab"
			const secret = await secretProvider(sessionId)
			const registry = new AdjudicationEvidenceRegistry({ sessionId, secret })

			const toolUseId = "call-red4-novocab"
			const acquisition = await captureAcquisitionEvidence({
				toolUseId,
				toolName: "read_files",
				content: [{ query: SYNTHETIC_SOURCE_PATH, result: SYNTHETIC_RENDERED_BODY, success: true }],
				resolver,
			})
			const messages = buildCanonicalHistory(toolUseId, acquisition)
			const acquisitions = buildAcquisitionEvidenceLedger(messages)
			const handle = registry.handleFor(toolUseId)

			const parsed = parseAdjudicationEnvelope(buildPublishedCandidate(handle))
			expect(parsed.status).toBe("ok")
			const decision = await resolveAdjudicationCandidate(parsed.status === "ok" ? parsed.candidate : undefined!, {
				canonicalMessages: messages,
				registry,
				revisionResolver: resolver,
				acquisitions,
			})
			expect(decision.candidate_accepted).toBe(false)
			expect(decision.reason).toBe("no_authorized_vocabulary")
		})
	})

	describe("RED-5 — compaction continuity (C2)", () => {
		/**
		 * Drive the REAL production state-aware compaction seam with the
		 * adjudication seam installed.
		 */
		const runStateAwareCompaction = async (input: {
			history: MessageWithMetadata[]
			registry: AdjudicationEvidenceRegistry
			resolver: ReturnType<typeof createVscodeSourceRevisionResolver>
			summary: string
		}) => {
			summarizerOutput = input.summary
			const inner = createContextCompactionPrepareTurn({
				providerId: "anthropic",
				modelId: "mock-model",
				providerConfig: {
					providerId: "anthropic",
					modelId: "mock-model",
				} as LlmsProviders.ProviderConfig,
				compaction: {
					enabled: true,
					strategy: "agentic",
					preserveRecentTokens: 1,
				},
				logger: undefined,
			})
			const prepareTurn = createCompactionStateAwarePrepareTurn({
				compact: (context: { model?: unknown }) =>
					inner?.({ ...context, model: MODEL } as never) ?? Promise.resolve(undefined),
				getState: () => undefined,
				prepareApiMessages: async (m: MessageWithMetadata[]) => m,
				saveState: () => undefined,
				adjudication: {
					registry: input.registry,
					vocabulary: AUTHORIZED_VOCABULARY,
					revisionResolver: input.resolver,
					getAcquisitions: (canonicalMessages: readonly MessageWithMetadata[]) =>
						buildAcquisitionEvidenceLedger(canonicalMessages),
				},
			})
			const result = await prepareTurn({
				agentId: "agent-1",
				conversationId: "conv-1",
				parentAgentId: null,
				iteration: 1,
				abortSignal: new AbortController().signal,
				systemPrompt: "SYSTEM",
				tools: [],
				messages: input.history,
				apiMessages: input.history,
				model: PREPARE_TURN_MODEL,
			} as unknown as Parameters<typeof prepareTurn>[0])
			return result?.messages ?? []
		}

		it("carries the accepted candidate forward even when the summarizer OMITS it", async () => {
			const workspaceRoot = await createSyntheticGitFixture()
			const resolver = createVscodeSourceRevisionResolver({ workspaceRoot })
			const sessionId = "session-red5"
			const secret = await createSessionSecretProvider({ allowCreate: false })(sessionId)
			const registry = new AdjudicationEvidenceRegistry({ sessionId, secret })

			const toolUseId = "call-red5"
			const acquisition = await captureAcquisitionEvidence({
				toolUseId,
				toolName: "read_files",
				content: [{ query: SYNTHETIC_SOURCE_PATH, result: SYNTHETIC_RENDERED_BODY, success: true }],
				resolver,
			})
			const messages = buildCanonicalHistory(toolUseId, acquisition)
			const handle = registry.handleFor(toolUseId)

			// The model publishes the candidate as an assistant-text carrier
			// AFTER the tool result, so the canonical history carries it.
			const published = buildPublishedCandidate(handle)
			const historyWithCandidate = [
				...messages,
				{
					role: "assistant",
					content: [{ type: "text", text: published }],
					ts: 4,
				},
			] as unknown as MessageWithMetadata[]

			// The candidate is accepted BEFORE the compaction.
			const acceptedBefore = await deriveAcceptedAdjudications(historyWithCandidate, {
				registry,
				vocabulary: AUTHORIZED_VOCABULARY,
				revisionResolver: resolver,
				acquisitions: buildAcquisitionEvidenceLedger(historyWithCandidate),
			})
			expect(acceptedBefore.length).toBe(1)

			// The summarizer OMITS the candidate entirely.
			const installedMessages = await runStateAwareCompaction({
				history: historyWithCandidate,
				registry,
				resolver,
				summary: "## Goal\nAdjudicate the synthetic finding S1.",
			})

			const installedText = JSON.stringify(installedMessages)
			expect(installedText).toContain("S1")

			// EXACTLY ONE deterministic section.
			//
			// The count is taken over the SUMMARY CARRIER (the first
			// message's text), not over the whole serialized message: the
			// production projection stores the summary twice (once in the
			// content text and once in `metadata.summary`), so counting the
			// whole serialization would double-count ONE section.
			const summaryText = readCarrierText(installedMessages[0])
			expect(summaryText).toContain("S1")
			expect(summaryText.split("<!-- cline-adjudication:begin -->").length - 1).toBe(1)
			expect(summaryText.split("<!-- cline-adjudication:end -->").length - 1).toBe(1)
			// The carried section names the qualified finding, its
			// qualification, its evidence handle and its source revision.
			expect(summaryText).toContain("decision=narrowed")
			expect(summaryText).toContain("qualification=manual_enforcement_only")
			expect(summaryText).toContain(handle)

			// The PROVIDER-VISIBLE projection contains it.
			const providerVisible = new MessageBuilder().buildForApi(
				installedMessages as unknown as Parameters<MessageBuilder["buildForApi"]>[0],
			)
			const providerVisibleText = JSON.stringify(providerVisible)
			expect(providerVisibleText).toContain("S1")
			// The provider-visible CARRIER (the summary text the provider
			// actually reads) carries exactly ONE section. The whole
			// serialization is not counted, because the production
			// projection carries the summary in two places (content text
			// and metadata).
			const providerSummaryText = readCarrierText(providerVisible[0])
			expect(providerSummaryText).toContain("S1")
			expect(providerSummaryText.split("<!-- cline-adjudication:begin -->").length - 1).toBe(1)
		})

		it("produces the SAME carried section when the summarizer REPEATS the candidate", async () => {
			const workspaceRoot = await createSyntheticGitFixture()
			const resolver = createVscodeSourceRevisionResolver({ workspaceRoot })
			const sessionId = "session-red5-determinism"
			const secret = await createSessionSecretProvider({ allowCreate: false })(sessionId)
			const registry = new AdjudicationEvidenceRegistry({ sessionId, secret })

			const toolUseId = "call-red5-determinism"
			const acquisition = await captureAcquisitionEvidence({
				toolUseId,
				toolName: "read_files",
				content: [{ query: SYNTHETIC_SOURCE_PATH, result: SYNTHETIC_RENDERED_BODY, success: true }],
				resolver,
			})
			const messages = buildCanonicalHistory(toolUseId, acquisition)
			const handle = registry.handleFor(toolUseId)
			const published = buildPublishedCandidate(handle)
			const historyWithCandidate = [
				...messages,
				{ role: "assistant", content: [{ type: "text", text: published }], ts: 4 },
			] as unknown as MessageWithMetadata[]

			const sectionOf = (text: string) => {
				const start = text.indexOf("<!-- cline-adjudication:begin -->")
				const end = text.indexOf("<!-- cline-adjudication:end -->")
				return start >= 0 && end > start ? text.slice(start, end) : ""
			}

			const omitting = await runStateAwareCompaction({
				history: historyWithCandidate,
				registry,
				resolver,
				summary: "## Goal\nAdjudicate the synthetic finding S1.",
			})
			const repeating = await runStateAwareCompaction({
				history: historyWithCandidate,
				registry,
				resolver,
				summary: `## Goal\nAdjudicate S1.\n\n${published}`,
			})

			// The summarizer's wording does not change the carried section:
			// the pre-strip protection removes the summarizer's own copy and
			// the deterministic section is installed exactly once.
			const omittingSection = sectionOf(readCarrierText(omitting[0]))
			const repeatingSection = sectionOf(readCarrierText(repeating[0]))
			expect(omittingSection).not.toBe("")
			expect(repeatingSection).toBe(omittingSection)
		})

		it("produces NO duplicate section on a SECOND compaction of the same history", async () => {
			const workspaceRoot = await createSyntheticGitFixture()
			const resolver = createVscodeSourceRevisionResolver({ workspaceRoot })
			const sessionId = "session-red5-second"
			const secret = await createSessionSecretProvider({ allowCreate: false })(sessionId)
			const registry = new AdjudicationEvidenceRegistry({ sessionId, secret })

			const toolUseId = "call-red5-second"
			const acquisition = await captureAcquisitionEvidence({
				toolUseId,
				toolName: "read_files",
				content: [{ query: SYNTHETIC_SOURCE_PATH, result: SYNTHETIC_RENDERED_BODY, success: true }],
				resolver,
			})
			const messages = buildCanonicalHistory(toolUseId, acquisition)
			const handle = registry.handleFor(toolUseId)
			const published = buildPublishedCandidate(handle)
			const historyWithCandidate = [
				...messages,
				{ role: "assistant", content: [{ type: "text", text: published }], ts: 4 },
			] as unknown as MessageWithMetadata[]

			const first = await runStateAwareCompaction({
				history: historyWithCandidate,
				registry,
				resolver,
				summary: "## Goal\nAdjudicate the synthetic finding S1.",
			})
			const firstText = readCarrierText(first[0])
			expect(firstText.split("<!-- cline-adjudication:begin -->").length - 1).toBe(1)

			// The SECOND compaction runs over the SAME canonical history.
			const second = await runStateAwareCompaction({
				history: historyWithCandidate,
				registry,
				resolver,
				summary: "## Goal\nAdjudicate the synthetic finding S1.",
			})
			const secondText = readCarrierText(second[0])
			expect(secondText.split("<!-- cline-adjudication:begin -->").length - 1).toBe(1)
			expect(secondText).toBe(firstText)
		})
	})

	describe("RED-6 — session restoration", () => {
		it("re-derives the SAME evidence handle after a host recreation", async () => {
			const workspaceRoot = await createSyntheticGitFixture()
			const resolver = createVscodeSourceRevisionResolver({ workspaceRoot })
			const sessionId = "session-red6"

			// HOST A: start the task, read the source, publish a candidate.
			// The START-mode provider persists the session's secret.
			const secretA = await createSessionSecretProviderForStart()(sessionId)
			const registryA = new AdjudicationEvidenceRegistry({ sessionId, secret: secretA })
			const toolUseId = "call-red6"
			const acquisition = await captureAcquisitionEvidence({
				toolUseId,
				toolName: "read_files",
				content: [{ query: SYNTHETIC_SOURCE_PATH, result: SYNTHETIC_RENDERED_BODY, success: true }],
				resolver,
			})
			const messages = buildCanonicalHistory(toolUseId, acquisition)
			const handleA = registryA.handleFor(toolUseId)
			const published = buildPublishedCandidate(handleA)
			const historyWithCandidate = [
				...messages,
				{ role: "assistant", content: [{ type: "text", text: published }], ts: 4 },
			] as unknown as MessageWithMetadata[]

			const acceptedA = await deriveAcceptedAdjudications(historyWithCandidate, {
				registry: registryA,
				vocabulary: AUTHORIZED_VOCABULARY,
				revisionResolver: resolver,
				acquisitions: buildAcquisitionEvidenceLedger(historyWithCandidate),
			})
			expect(acceptedA.length).toBe(1)

			// HOST B: a recreated host, given the SAME session id and the
			// SAME persisted secret, re-derives the SAME handle and the
			// persisted canonical history restores the acquisition ledger.
			// The RESTORE-mode provider NEVER mints a new secret.
			const secretB = await createSessionSecretProviderForRestore()(sessionId)
			expect(secretB).toBe(secretA)
			const registryB = new AdjudicationEvidenceRegistry({ sessionId, secret: secretB })
			const handleB = registryB.handleFor(toolUseId)
			expect(handleB).toBe(handleA)

			// The acquisition ledger is restored from the canonical history.
			const restoredLedger = buildAcquisitionEvidenceLedger(historyWithCandidate)
			expect(restoredLedger.records.size).toBe(1)
			expect(restoredLedger.toolUseIds).toContain(toolUseId)

			// The accepted candidate is preserved.
			const acceptedB = await deriveAcceptedAdjudications(historyWithCandidate, {
				registry: registryB,
				vocabulary: AUTHORIZED_VOCABULARY,
				revisionResolver: resolver,
				acquisitions: restoredLedger,
			})
			expect(acceptedB.length).toBe(1)
			expect(acceptedB[0]?.finding_id).toBe(acceptedA[0]?.finding_id)
		})

		it("FAILS CLOSED for a DIFFERENT session (no cross-session handle reuse)", async () => {
			const workspaceRoot = await createSyntheticGitFixture()
			const resolver = createVscodeSourceRevisionResolver({ workspaceRoot })
			const toolUseId = "call-red6-cross"

			const secretA = await createSessionSecretProvider({ allowCreate: false })("session-A")
			const registryA = new AdjudicationEvidenceRegistry({ sessionId: "session-A", secret: secretA })
			const secretB = await createSessionSecretProvider({ allowCreate: false })("session-B")
			const registryB = new AdjudicationEvidenceRegistry({ sessionId: "session-B", secret: secretB })

			// DIFFERENT sessions get DIFFERENT evidence identities.
			expect(secretB).not.toBe(secretA)
			expect(registryB.handleFor(toolUseId)).not.toBe(registryA.handleFor(toolUseId))

			// A handle minted in session A does not resolve in session B.
			const acquisition = await captureAcquisitionEvidence({
				toolUseId,
				toolName: "read_files",
				content: [{ query: SYNTHETIC_SOURCE_PATH, result: SYNTHETIC_RENDERED_BODY, success: true }],
				resolver,
			})
			const messages = buildCanonicalHistory(toolUseId, acquisition)
			const acquisitions = buildAcquisitionEvidenceLedger(messages)
			const published = buildPublishedCandidate(registryA.handleFor(toolUseId))
			const parsed = parseAdjudicationEnvelope(published)
			expect(parsed.status).toBe("ok")

			const decision = await resolveAdjudicationCandidate(parsed.status === "ok" ? parsed.candidate : undefined!, {
				canonicalMessages: messages,
				registry: registryB,
				vocabulary: AUTHORIZED_VOCABULARY,
				revisionResolver: resolver,
				acquisitions,
			})
			expect(decision.candidate_accepted).toBe(false)
			expect(decision.canonical_refs_resolved).toBe(false)
		})
	})
})
