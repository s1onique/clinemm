/**
 * ACT-CLINEMM-COMPACTION-TASK-CONTRACT-CONSERVATION-REPAIR01
 *
 * LOCAL HISTORICAL WITNESS — session `1794617111057_i279p`.
 *
 * This suite drives the REAL production boundary over the REAL historical
 * artefacts:
 *
 *   - the 207-message canonical transcript,
 *   - the persisted compaction sidecar (163-message source prefix),
 *   - the real `projectSessionCompactionState()` projector,
 *   - the real `createCompactionStateAwarePrepareTurn()` state-aware wrapper,
 *   - the real `MessageBuilder.buildForApi()` provider-request preparation seam.
 *
 * The raw artefacts are operator-local and PRIVATE. They are NEVER committed.
 * The suite is therefore self-skipping: when the operator-local files are
 * absent, it reports NOT_EXECUTED instead of substituting synthetic inputs.
 *
 * Input identity is pinned to the predecessor recon's recorded SHA-256 values
 * (`docs/acts/ACT-CLINEMM-COMPACTION-TASK-CONTRACT-CONSERVATION-RECON01/
 * evidence/identity.txt`). A drifted artefact is a FAILURE, not a silent
 * re-baseline: it would mean the witness no longer reproduces the historical
 * defect.
 *
 * The HERMETIC permanent regression gate lives in
 * `./task-contract-conservation.test.ts` and never depends on these files.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MessageWithMetadata } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	projectSessionCompactionState,
	type SessionCompactionState,
} from "../../session/models/session-compaction";
import { MessageBuilder } from "../../session/services/message-builder";
import { createCompactionStateAwarePrepareTurn } from "./compaction";

const TRANSCRIPT_PATH = join(
	homedir(),
	"Downloads",
	"1794617111057_i279p.messages.json",
);
const SIDECAR_PATH = join(
	homedir(),
	"Downloads",
	"1794617111057_i279p.compaction.json",
);

/** Pinned by the predecessor recon (evidence/identity.txt). */
const TRANSCRIPT_SHA256 =
	"02c5a31231787330b7491646bb70cdf168f75fb9bc44c0a60b85140c8e9eff15";
const SIDECAR_SHA256 =
	"2cba633cd2e1f27d0226338ffec862f5faf061c91d88d35fd5b006b24e84e8f7";

const artifactsPresent =
	existsSync(TRANSCRIPT_PATH) && existsSync(SIDECAR_PATH);

function sha256(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readTranscriptMessages(): MessageWithMetadata[] {
	const parsed = JSON.parse(readFileSync(TRANSCRIPT_PATH, "utf8")) as {
		messages: MessageWithMetadata[];
	};
	return parsed.messages;
}

function readSidecar(): SessionCompactionState {
	return JSON.parse(
		readFileSync(SIDECAR_PATH, "utf8"),
	) as SessionCompactionState;
}

function providerVisibleText(messages: readonly MessageWithMetadata[]): string {
	return messages
		.flatMap((message) =>
			Array.isArray(message.content)
				? message.content
						.filter(
							(block): block is { type: "text"; text: string } =>
								block.type === "text" && typeof block.text === "string",
						)
						.map((block) => block.text)
				: typeof message.content === "string"
					? [message.content]
					: [],
		)
		.join("\n");
}

function countOccurrences(haystack: string, needle: string): number {
	let count = 0;
	let index = haystack.indexOf(needle);
	while (index !== -1) {
		count += 1;
		index = haystack.indexOf(needle, index + needle.length);
	}
	return count;
}

/** The canonical user objective + read-only constraint (canonical index 0). */
const HISTORICAL_OBJECTIVE_MARKER = "What does this project do?";
const HISTORICAL_READ_ONLY_MARKER = "Do not modify any files.";
/** The later user amendment (canonical index 26). */
const HISTORICAL_AMENDMENT_MARKER = "Continue";
/** The runtime completion obligation (canonical indices 1 and 27). */
const HISTORICAL_COMPLETION_MARKER =
	"terminal completion tools: submit_and_exit";

const describeHistorical = artifactsPresent ? describe : describe.skip;

describeHistorical(
	"historical contract conservation — session 1794617111057_i279p",
	() => {
		it("reproduces the historical defect inputs with pinned identity", () => {
			expect(sha256(TRANSCRIPT_PATH)).toBe(TRANSCRIPT_SHA256);
			expect(sha256(SIDECAR_PATH)).toBe(SIDECAR_SHA256);
			const messages = readTranscriptMessages();
			expect(messages).toHaveLength(207);
			const sidecar = readSidecar();
			expect(sidecar.source_message_count).toBe(163);
		});

		it("RED-1 — the provider-visible continuation preserves the active task contract", async () => {
			const canonical = readTranscriptMessages();
			const sidecar = readSidecar();

			// The raw projector must remain a FAITHFUL projection of the
			// historical sidecar (it must not fabricate a repair).
			const rawProjection = projectSessionCompactionState(sidecar, canonical);
			expect(rawProjection).toBeDefined();
			expect(rawProjection).toHaveLength(48);
			expect(providerVisibleText(rawProjection ?? [])).not.toContain(
				HISTORICAL_COMPLETION_MARKER,
			);

			// Drive the REAL state-aware wrapper over the REAL sidecar.
			const prepareTurn = createCompactionStateAwarePrepareTurn({
				compact: undefined,
				getState: () => sidecar,
				prepareApiMessages: async (messages) => messages,
			});
			const prepared = await prepareTurn({
				agentId: "agent-1",
				conversationId: "1794617111057_i279p",
				parentAgentId: null,
				iteration: 1,
				abortSignal: new AbortController().signal,
				systemPrompt: "",
				tools: [],
				messages: canonical,
				apiMessages: canonical,
				model: {
					id: "mock-model",
					provider: "anthropic",
					info: { id: "mock-model", maxInputTokens: 230_400 },
				},
			});

			const providerRequest = new MessageBuilder().buildForApi(
				prepared?.messages ?? [],
			);
			const providerText = providerVisibleText(providerRequest);

			// 1. The active user objective (canonical index 0).
			expect(providerText).toContain(HISTORICAL_OBJECTIVE_MARKER);
			// 2. The read-only constraint (canonical index 0).
			expect(providerText).toContain(HISTORICAL_READ_ONLY_MARKER);
			// 3. The later user amendment (canonical index 26).
			expect(providerText).toContain(HISTORICAL_AMENDMENT_MARKER);
			// 4. The applicable runtime completion obligation (canonical idx 27).
			expect(providerText).toContain(HISTORICAL_COMPLETION_MARKER);
			// 5. Separate user/runtime provenance.
			expect(providerText).toMatch(/user/i);
			expect(providerText).toMatch(/runtime/i);
			// No duplicate accumulation of the runtime obligation.
			expect(countOccurrences(providerText, HISTORICAL_COMPLETION_MARKER)).toBe(
				1,
			);
		});

		it("RED-2 — the contract survives a second Agentic compaction", async () => {
			const canonical = readTranscriptMessages();
			const sidecar = readSidecar();
			const prepareTurn = createCompactionStateAwarePrepareTurn({
				// A genuine second compaction over the projected history.
				compact: async () => ({
					messages: [
						{
							role: "user" as const,
							content: [
								{
									type: "text" as const,
									text: "Context summary:\n\nsecond summary",
								},
							],
							metadata: {
								kind: "compaction_summary",
								displayRole: "system",
								userRunSpan: 2,
								summary: "second summary",
								details: { readFiles: [], modifiedFiles: [] },
								tokensBefore: 100,
								generatedAt: 1,
							},
						},
					],
				}),
				getState: () => sidecar,
				prepareApiMessages: async (messages) => messages,
			});
			const prepared = await prepareTurn({
				agentId: "agent-1",
				conversationId: "1794617111057_i279p",
				parentAgentId: null,
				iteration: 2,
				abortSignal: new AbortController().signal,
				systemPrompt: "",
				tools: [],
				messages: canonical,
				apiMessages: canonical,
				model: {
					id: "mock-model",
					provider: "anthropic",
					info: { id: "mock-model", maxInputTokens: 230_400 },
				},
			});
			const providerText = providerVisibleText(
				new MessageBuilder().buildForApi(prepared?.messages ?? []),
			);
			expect(providerText).toContain(HISTORICAL_OBJECTIVE_MARKER);
			expect(providerText).toContain(HISTORICAL_READ_ONLY_MARKER);
			expect(providerText).toContain(HISTORICAL_COMPLETION_MARKER);
			expect(countOccurrences(providerText, HISTORICAL_COMPLETION_MARKER)).toBe(
				1,
			);
		});
	},
);

if (!artifactsPresent) {
	describe("historical contract conservation — NOT_EXECUTED", () => {
		it("operator-local historical artefacts are unavailable", () => {
			expect(
				`Historical witness NOT_EXECUTED: expected ${TRANSCRIPT_PATH} and ${SIDECAR_PATH}`,
			).toContain("NOT_EXECUTED");
		});
	});
}
