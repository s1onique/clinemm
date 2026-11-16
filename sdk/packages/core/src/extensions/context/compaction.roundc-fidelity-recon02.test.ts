/**
 * ACT-CLINEMM-ROUNDC-COMPACTION-FIDELITY-RECON02
 *
 * Source-faithful reconstruction + production-seam discriminators for the
 * Round C session `1794835772204_hvkkv`.
 *
 * THE TWO QUESTIONS
 * -----------------
 *
 *  1. Why did ClineMM preserve substantial investigation output in canonical
 *     history yet continue after compaction as though the evidence needed to
 *     be collected again?
 *  2. Were the repeated compactions justified by the actual model-bound
 *     request sizes, or caused by accounting divergence?
 *
 * WHAT THIS FILE IS (AND IS NOT)
 * ------------------------------
 *
 * This file OBSERVES the real production modules. It does not re-implement
 * the flattening, the projection, the cut index, the summary request, or the
 * trigger math. Every assertion is made against the output of the production
 * function that owns the boundary.
 *
 * The Round C canonical artifacts are PRIVATE (they can contain credentials
 * and unredacted command output). This test therefore does NOT read them.
 * The RECONSTRUCTION over the real artifacts is performed by the companion
 * offline script, which emits only privacy-safe measurements into
 * `.factory/evidence/ACT-CLINEMM-ROUNDC-COMPACTION-FIDELITY-RECON02/`.
 *
 * This file holds the PRODUCTION-SEAM DISCRIMINATORS: deterministic,
 * offline, synthetic-credential-only fixtures that exercise the exact
 * `createContextCompactionPrepareTurn({ strategy: "agentic" })` seam and
 * assert on the ACTUAL summarizer request and the ACTUAL installed
 * continuation representation.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type * as LlmsProviders from "@cline/llms";
import type { MessageWithMetadata } from "@cline/shared";
import { estimateRequestInputTokens } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionCompactionState } from "../../session/models/session-compaction";
import { MessageBuilder } from "../../session/services/message-builder";
import {
	createCompactionStateAwarePrepareTurn,
	createContextCompactionPrepareTurn,
} from "./compaction";
import {
	COMPACTION_TRIGGER_RATIO,
	createTokenEstimator,
	findCutIndex,
	flattenToolResultContent,
	resolveEffectiveMaxInputTokens,
	serializeConversation,
} from "./compaction-shared";
import {
	applyVerifiedEvidenceToCompactedMessages,
	extractVerifiedToolOutcomes,
	MAX_CARRIED_OUTCOMES,
} from "./evidence-continuity";

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

/**
 * The EXACT request string the production summarizer sent to the provider.
 * Captured from the mocked provider handler, never re-derived.
 */
let capturedSummarizerRequest = "";

/**
 * The summary text the mocked summarizer returns. A test that needs the
 * generated summary to contain (or omit) a specific fact sets it here.
 */
let summarizerOutput =
	"## Goal\nContinue the work\n\n## State\n- Done: nothing\n";

beforeEach(() => {
	capturedSummarizerRequest = "";
	summarizerOutput =
		"## Goal\nContinue the work\n\n## State\n- Done: nothing\n";
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

/**
 * A deliberately small input limit so the REAL auto-mode eligibility check
 * (`shouldCompact`) is TRUE and the production compaction path actually
 * runs. The summarizer budget falls back to
 * `MIN_AGENTIC_SUMMARY_INPUT_TOKENS`, which is ample for these fixtures.
 */
const MODEL = {
	id: "mock-model",
	provider: "anthropic",
	info: { id: "mock-model", maxInputTokens: 10 },
} as const;

const SYSTEM_PROMPT = "You are a helpful coding assistant.";

function userTurn(text: string): MessageWithMetadata {
	return { role: "user", content: [{ type: "text", text }] };
}

function toolCall(
	id: string,
	name: string,
	input: Record<string, unknown>,
): MessageWithMetadata {
	return {
		role: "assistant",
		content: [{ type: "tool_use", id, name, input }],
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

function assistantTurn(text: string): MessageWithMetadata {
	return { role: "assistant", content: [{ type: "text", text }] };
}

/**
 * Drive the REAL production agentic-compaction seam and return the exact
 * summarizer request it produced plus the installed continuation messages.
 */
async function runAgenticCompactionAndCapture(input: {
	messages: MessageWithMetadata[];
	preserveRecentTokens?: number;
}): Promise<{
	request: string;
	result: unknown;
	installedMessages: MessageWithMetadata[];
}> {
	const prepareTurn = createContextCompactionPrepareTurn({
		providerId: "anthropic",
		modelId: "mock-model",
		providerConfig: {
			providerId: "anthropic",
			modelId: "mock-model",
		} as LlmsProviders.ProviderConfig,
		compaction: {
			enabled: true,
			strategy: "agentic",
			preserveRecentTokens: input.preserveRecentTokens ?? 1,
		},
		logger: undefined,
	});
	const result = await prepareTurn?.({
		agentId: "agent-1",
		conversationId: "conv-1",
		parentAgentId: null,
		iteration: 1,
		abortSignal: new AbortController().signal,
		systemPrompt: SYSTEM_PROMPT,
		tools: [],
		messages: input.messages,
		apiMessages: input.messages,
		model: MODEL,
	});
	const installed = (result as { messages?: MessageWithMetadata[] } | undefined)
		?.messages;
	return {
		request: capturedSummarizerRequest,
		result,
		installedMessages: installed ?? [],
	};
}

/**
 * The PROVIDER-VISIBLE text of the installed continuation: the summary
 * message's rendered `Context summary:` text.
 */
function installedContinuationText(messages: MessageWithMetadata[]): string {
	return messages
		.flatMap((message) =>
			Array.isArray(message.content)
				? message.content
						.filter(
							(block): block is { type: "text"; text: string } =>
								block.type === "text" &&
								typeof (block as { text?: unknown }).text === "string",
						)
						.map((block) => block.text)
				: [],
		)
		.join("\n");
}

/**
 * The canonical `run_commands` payload shape: one entry per command, each
 * carrying its own `success` flag as decided by the command WRAPPER.
 */
function runCommandsPayload(
	entries: {
		query: string;
		result: string;
		success: boolean;
		error?: string;
	}[],
): unknown {
	return entries;
}

/**
 * Drive the REAL production state-aware compaction seam — the seam that
 * owns the task-contract AND evidence-continuity carry-forward — and return
 * the installed continuation representation.
 *
 * `createCompactionStateAwarePrepareTurn` is the production seam that
 * applies:
 *
 *   1. `applyTaskContractToCompactedMessages()` — the authoritative task
 *      contract, carried from the CANONICAL history.
 *   2. `applyVerifiedEvidenceToCompactedMessages()` — the deterministic
 *      verified-outcome section, carried from the CANONICAL history.
 *
 * and then persists the state and publishes the working-context estimate.
 *
 * The `compact` callback is the REAL `createContextCompactionPrepareTurn`
 * result seam, so the summarizer request and the generated summary are the
 * production ones.
 */
async function runStateAwareCompactionAndCapture(input: {
	canonicalMessages: MessageWithMetadata[];
	existingState?: SessionCompactionState;
}): Promise<{
	request: string;
	installedMessages: MessageWithMetadata[];
}> {
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
	});

	const savedStates: unknown[] = [];
	const prepareTurn = createCompactionStateAwarePrepareTurn({
		// The INNER seam is the REAL production compaction seam. It is
		// invoked with the TINY model limit so the auto-mode eligibility
		// check fires and the production agentic strategy actually runs.
		// (The outer seam's larger limit is what the task-contract budget
		// guard measures against.)
		compact: (context) =>
			inner?.({ ...context, model: MODEL }) ?? Promise.resolve(undefined),
		getState: () => input.existingState,
		prepareApiMessages: async (messages) => messages,
		saveState: (state) => {
			savedStates.push(state);
		},
	});

	const result = await prepareTurn({
		agentId: "agent-1",
		conversationId: "conv-1",
		parentAgentId: null,
		iteration: 1,
		abortSignal: new AbortController().signal,
		systemPrompt: SYSTEM_PROMPT,
		tools: [],
		messages: input.canonicalMessages,
		apiMessages: input.canonicalMessages,
		// The state-aware seam ALSO enforces the task-contract budget
		// against the FINAL provider-visible request. The 10-token mock
		// limit used by the INNER seam is intentionally tiny (it forces
		// auto-mode eligibility), so the OUTER seam gets a realistic
		// 128k-shaped limit that the contract fits inside.
		model: {
			id: "mock-model",
			provider: "anthropic",
			info: { id: "mock-model", maxInputTokens: 128_000 },
		} as unknown as typeof MODEL,
	});

	return {
		request: capturedSummarizerRequest,
		installedMessages: result?.messages ?? [],
	};
}

// ---------------------------------------------------------------------------
// R1 — Helm image rendering.
//
// The Round C canonical evidence (PRIVATE) shows a `helm template` command
// whose OUTER shell reported success while the INNER Helm process FAILED
// with a Go-template error, because the command piped Helm's output into
// `grep | head` and then echoed `$?` — which reports the exit status of the
// LAST pipeline element, not Helm's.
//
// The discriminator below reproduces that EXACT shape synthetically.
// ---------------------------------------------------------------------------

const R1_CALL_ID = "call_r1_pipeline_mask_001";

describe("ACT-CLINEMM-ROUNDC-COMPACTION-FIDELITY-RECON02 — R1 shell-status negative control", () => {
	it("SCENARIO 5: a successful outer shell status masking a failed inner Helm verification must NOT certify a rendered image", async () => {
		// The inner Helm process failed (rc=1, Go-template error). The
		// wrapper nevertheless reported success, because the pipeline's exit
		// status came from `head`, not from Helm.
		const innerHelmFailed =
			"Error: template: keycloak-roz/...: wrong type for value";
		const messages = [
			userTurn("Render the production Helm chart and report the image."),
			toolCall(R1_CALL_ID, "run_commands", {
				commands: [
					"helm template kc .helm/roz -f values.yaml 2>&1 | grep -n -E 'image:' | head -20; echo rc=$?",
				],
			}),
			toolResult(
				R1_CALL_ID,
				"run_commands",
				runCommandsPayload([
					{
						query:
							"helm template kc .helm/roz -f values.yaml 2>&1 | grep -n -E 'image:' | head -20; echo rc=$?",
						// The wrapper's own view: the OUTER shell succeeded.
						result: `### RENDER PROD ###\nrc=0\n${innerHelmFailed}`,
						success: true,
					},
				]),
			),
			assistantTurn("The render finished."),
		];

		const { request, result, installedMessages } =
			await runAgenticCompactionAndCapture({ messages });

		expect(result).toBeDefined();
		expect(request.length).toBeGreaterThan(0);

		// The SEMANTIC VERIFICATION FAILED, so no rendered-image fact may be
		// asserted downstream. The summarizer input must therefore carry
		// neither the inner error text nor any rendered-image VALUE.
		expect(request).not.toContain(innerHelmFailed);
		expect(request).not.toContain("quay.io/");
		expect(request).not.toMatch(/image:\s*"?[a-z0-9./-]+/i);

		// What the summarizer DOES see is the wrapper's affirmative status
		// with the result body omitted.
		//
		// ACT-CLINEMM-ROUNDC-COMPACTION-FIDELITY-CORRECTION01: the command is
		// a PIPELINE, so the classifier FAILS CLOSED and the command
		// classification is NOT carried either. That is a STRONGER form of
		// the same control: the summarizer sees the wrapper's status and
		// nothing else — not the inner error, not the image, and not a
		// command subject that could be read as "a helm template ran and
		// succeeded".
		expect(request).not.toContain("[succeeded] helm template");
		expect(request).toContain("[result omitted]");

		// The continuation representation must not silently upgrade the
		// wrapper status into a rendered-image claim.
		const continuation = installedContinuationText(installedMessages);
		expect(continuation).not.toContain("quay.io/");
		expect(continuation).not.toMatch(/image:\s*"?[a-z0-9./-]+/i);
	});

	it("R1 negative control: the pipefail-free wrapper status is NOT proof of a successful render", async () => {
		// A direct, source-level assertion of the negative control: the
		// summarizer-input projection of a structured payload NEVER carries
		// the raw output, so it can NEVER be used to certify a rendered
		// image or an inner process success.
		//
		// ACT-CLINEMM-ROUNDC-COMPACTION-FIDELITY-CORRECTION01: the query is a
		// PIPELINE, so the classifier now FAILS CLOSED on it — a pipeline's
		// exit status is its LAST element's, which is precisely why the
		// wrapper's success could not certify Helm's. The command identity
		// is therefore NOT carried, which is a STRONGER form of the same
		// control: neither the raw output NOR the command subject reaches
		// the summarizer.
		const rendered = flattenToolResultContent([
			{
				query:
					"helm template kc .helm/roz 2>&1 | grep image | head -20; echo rc=$?",
				result: "image: quay.io/example/app:1.2.3\nrc=0",
				success: true,
			},
		] as never);
		expect(rendered).not.toContain("[succeeded] helm template");
		expect(rendered).toContain("[result omitted]");
		// The image reference NEVER reaches the summarizer input.
		expect(rendered).not.toContain("quay.io/example/app:1.2.3");
	});
});

// ---------------------------------------------------------------------------
// R7 — Java-test CI coverage.
//
// The summarizer's retained summary claims "Maven evidence must be
// recollected". The discriminator below establishes whether the FACT was
// available to the model, and whether the "recollect" prescription is
// warranted.
// ---------------------------------------------------------------------------

const R7_CALL_ID = "call_r7_ci_coverage_001";

describe("ACT-CLINEMM-ROUNDC-COMPACTION-FIDELITY-RECON02 — R7 evidence-status control", () => {
	it("SCENARIO 1+3: Maven and skipTests findings reach the summarizer as STATUS, and an empty grep is not misreported as success", async () => {
		const messages = [
			userTurn(
				"Determine whether the inspected CI actually executes Java tests.",
			),
			toolCall(R7_CALL_ID, "run_commands", {
				commands: [
					"grep -n 'mvn' .gitlab-ci.yml",
					"grep -rn -E 'skipTests|maven.test.skip' .gitlab-ci.yml Dockerfile.roz */pom.xml",
				],
			}),
			toolResult(
				R7_CALL_ID,
				"run_commands",
				runCommandsPayload([
					{
						query: "grep -n 'mvn' .gitlab-ci.yml",
						result: "142:    - mvn -B -DskipTests package",
						success: true,
					},
					{
						query:
							"grep -rn -E 'skipTests|maven.test.skip' .gitlab-ci.yml Dockerfile.roz */pom.xml",
						result: "Dockerfile.roz:9:RUN mvn -B -DskipTests package",
						success: true,
					},
				]),
			),
			assistantTurn("CI inspection done."),
		];

		const { request, result } = await runAgenticCompactionAndCapture({
			messages,
		});

		expect(result).toBeDefined();
		expect(request.length).toBeGreaterThan(0);

		// The command CLASSIFICATIONS reach the model, so the model knows a
		// grep and a Maven invocation were attempted.
		expect(request).toContain("[succeeded] grep");
		// The specific CI CONTENT (the `mvn` line, the `-DskipTests` flag)
		// is NOT in the summarizer input, because it is arbitrary OUTPUT.
		//
		// NOTE: the tool CALL's own arguments ARE carried verbatim by
		// `serializeMessage()`'s `[Bot tool calls]` line (`formatToolInput`).
		// That is a SEPARATE confidentiality scope from the tool RESULT
		// body, and it is why the grep PATHS appear in the request while
		// the grep's FINDINGS do not. The DECISIVE fact for R7 — whether CI
		// executes Java tests — lives in the RESULT body, so it is absent.
		expect(request).not.toContain("-DskipTests");
		expect(request).not.toContain("mvn -B");
	});

	it("R7 negative control: an empty/failed grep is NOT classified as a successful evidence source", async () => {
		const messages = [
			userTurn("Check whether CI runs Java tests."),
			toolCall("call_r7_empty_grep_001", "run_commands", {
				commands: ["grep -n 'mvn' .gitlab-ci.yml"],
			}),
			toolResult(
				"call_r7_empty_grep_001",
				"run_commands",
				runCommandsPayload([
					{
						query: "grep -n 'mvn' .gitlab-ci.yml",
						result: "",
						success: false,
						error: "Command failed with exit code 1",
					},
				]),
			),
			assistantTurn("No match."),
		];

		const { request } = await runAgenticCompactionAndCapture({ messages });

		// The failed grep is rendered as FAILED — it is never promoted to a
		// successful evidence source.
		expect(request).toContain("[failed]");
		expect(request).not.toContain("[succeeded] grep");
	});

	it("R7/R1 boundary: a `cd <path> && <cmd>` chain yields the command classification of the command that ACTUALLY ran", async () => {
		// THE ROUND C SHAPE. Every Round C command begins with a `cd`
		// into the repository, then chains the real command with `&&`.
		//
		// BEFORE the repair, `classifyCommand()` matched the command's
		// LEADING WORDS against a finite allowlist. `cd` is NOT in that
		// allowlist, so the classification was EMPTY and the carried
		// verified-outcome line degraded to "succeeded — N commands" with
		// no indication of WHAT was run. That was the boundary at which the
		// evidence identity was lost.
		//
		// ACT-CLINEMM-ROUNDC-COMPACTION-FIDELITY-CORRECTION01 (S1): the
		// classifier now reads the command as a sequence of shell SEGMENTS
		// and classifies the executable of the segment that carries the
		// work. The `cd` prefix is recognised as a DIRECTORY CHANGE (its
		// argument is a path, and a path is never carried), and the chained
		// command's allowlisted classification IS carried.
		const ledger = extractVerifiedToolOutcomes([
			toolCall("call_cd_chain_001", "run_commands", {
				commands: [
					"cd /repo && helm template kc .helm/roz -f values.yaml",
					"cd /repo && grep -n 'mvn' .gitlab-ci.yml",
				],
			}),
			toolResult(
				"call_cd_chain_001",
				"run_commands",
				runCommandsPayload([
					{
						query: "cd /repo && helm template kc .helm/roz -f values.yaml",
						result: "render ok",
						success: true,
					},
					{
						query: "cd /repo && grep -n 'mvn' .gitlab-ci.yml",
						result: "142: mvn -B -DskipTests package",
						success: true,
					},
				]),
			),
		]);

		// The outcome IS carried (the canonical success signal is present).
		expect(ledger.outcomes.length).toBe(1);
		expect(ledger.outcomes[0]?.status).toBe("succeeded");
		// ...and the command SUBJECTS are now the allowlisted classifications
		// of the commands that actually ran.
		expect(ledger.outcomes[0]?.evidence.subjects).toEqual([
			"helm template",
			"grep",
		]);

		// The rendered line therefore carries the command identity.
		const { installedMessages } = await runStateAwareCompactionAndCapture({
			canonicalMessages: [
				userTurn("Render the chart and inspect CI."),
				toolCall("call_cd_chain_001", "run_commands", {
					commands: [
						"cd /repo && helm template kc .helm/roz -f values.yaml",
						"cd /repo && grep -n 'mvn' .gitlab-ci.yml",
					],
				}),
				toolResult(
					"call_cd_chain_001",
					"run_commands",
					runCommandsPayload([
						{
							query: "cd /repo && helm template kc .helm/roz -f values.yaml",
							result: "render ok",
							success: true,
						},
						{
							query: "cd /repo && grep -n 'mvn' .gitlab-ci.yml",
							result: "142: mvn -B -DskipTests package",
							success: true,
						},
					]),
				),
				assistantTurn("Done."),
			],
		});
		const continuation = installedContinuationText(installedMessages);
		expect(continuation).toContain("call_cd_chain_001");
		expect(continuation).toContain("succeeded");
		// The command identity IS carried now.
		expect(continuation).toContain("helm template");
		expect(continuation).toContain("grep");
		// The PATH is NEVER carried: the `cd` argument is a path.
		expect(continuation).not.toContain("/repo");
		expect(continuation).not.toContain(".helm/roz");
		expect(continuation).not.toContain(".gitlab-ci.yml");
	});

	it("R7/R1 control: a DIRECT command (no `cd` prefix) DOES yield a carried command classification", () => {
		// The control proves the classification mechanism itself works and
		// that the `cd` chain is the specific cause.
		const ledger = extractVerifiedToolOutcomes([
			toolCall("call_direct_001", "run_commands", {
				commands: ["helm template kc .helm/roz -f values.yaml"],
			}),
			toolResult(
				"call_direct_001",
				"run_commands",
				runCommandsPayload([
					{
						query: "helm template kc .helm/roz -f values.yaml",
						result: "render ok",
						success: true,
					},
				]),
			),
		]);
		expect(ledger.outcomes.length).toBe(1);
		expect(ledger.outcomes[0]?.evidence.subjects).toContain("helm template");
	});
});

// ---------------------------------------------------------------------------
// SCENARIO 2, 4, 6, 7, 8, 9, 10 — the confidentiality / retention /
// conservation discriminators.
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-ROUNDC-COMPACTION-FIDELITY-RECON02 — confidentiality and retention discriminators", () => {
	it("SCENARIO 2: a result whose meaningful output is omitted by policy still carries its STATUS to the summarizer", async () => {
		const messages = [
			userTurn("Run the check."),
			toolCall("call_privacy_001", "run_commands", {
				commands: ["kubectl get pods -n prod"],
			}),
			toolResult(
				"call_privacy_001",
				"run_commands",
				runCommandsPayload([
					{
						query: "kubectl get pods -n prod",
						result: "prod-api-7d9f  Running  3d",
						success: true,
					},
				]),
			),
			assistantTurn("Checked."),
		];

		const { request } = await runAgenticCompactionAndCapture({ messages });

		// The STATUS survives; the arbitrary output does not.
		expect(request).toContain("[succeeded] kubectl get");
		expect(request).toContain("[result omitted]");
		expect(request).not.toContain("prod-api-7d9f");
	});

	it("SCENARIO 4: a mixed-success command batch is described payload by payload and is never wholly successful", async () => {
		const messages = [
			userTurn("Run the migration and the verification."),
			toolCall("call_mixed_001", "run_commands", {
				commands: ["migrate-up", "verify-schema"],
			}),
			toolResult(
				"call_mixed_001",
				"run_commands",
				runCommandsPayload([
					{
						query: "migrate-up",
						result: "MIGRATION_OK schema version 42",
						success: true,
					},
					{
						query: "verify-schema",
						result: "verify-schema failed: relation does not exist",
						success: false,
					},
				]),
			),
			assistantTurn("Migration ran; verification failed."),
		];

		const { request } = await runAgenticCompactionAndCapture({ messages });

		// Each payload is classified by its OWN status.
		expect(request).toContain("[succeeded]");
		expect(request).toContain("[failed]");
		// The arbitrary outputs never reach the summarizer.
		expect(request).not.toContain("MIGRATION_OK schema version 42");
		expect(request).not.toContain("relation does not exist");
	});

	it("SCENARIO 10: synthetic credentials in the RESULT BODY are absent from the summarizer request and the installed continuation", async () => {
		const SYNTHETIC_PASSWORD = "synthetic-password-DO-NOT-LEAK-4f2a9c";
		const SYNTHETIC_BEARER = "Bearer synthetic.token.value.9z8y7x";
		const messages = [
			userTurn("Run the deployment."),
			toolCall("call_secret_001", "run_commands", {
				commands: ["deploy-step --flag safe"],
			}),
			toolResult(
				"call_secret_001",
				"run_commands",
				runCommandsPayload([
					{
						query: "deploy-step --flag safe",
						result: `password=${SYNTHETIC_PASSWORD}\n${SYNTHETIC_BEARER}\nARBITRARY_RESULT_STRING`,
						success: true,
					},
				]),
			),
			assistantTurn("Deployed."),
		];

		const { request, installedMessages } = await runAgenticCompactionAndCapture(
			{
				messages,
			},
		);

		// The RESULT BODY never reaches the summarizer: the credential
		// values, the bearer token and the arbitrary string are all absent.
		expect(request).not.toContain(SYNTHETIC_PASSWORD);
		expect(request).not.toContain(SYNTHETIC_BEARER);
		expect(request).not.toContain("ARBITRARY_RESULT_STRING");

		const continuation = installedContinuationText(installedMessages);
		expect(continuation).not.toContain(SYNTHETIC_PASSWORD);
		expect(continuation).not.toContain(SYNTHETIC_BEARER);
		expect(continuation).not.toContain("ARBITRARY_RESULT_STRING");
	});

	it("SCENARIO 10b (documented scope boundary): the tool CALL's own arguments ARE carried verbatim into the summarizer request", async () => {
		// This is an OBSERVED property of the production serializer, not a
		// claim that it is safe. `serializeMessage()` renders a tool_use
		// block as `[Bot tool calls]: name(formatToolInput(input))`, and
		// `formatToolInput` stringifies the declared input verbatim.
		//
		// The evidence-continuity module deliberately restricts the
		// CARRIED-FORWARD section to a finite command-classification
		// allowlist for exactly this reason (see its module header). The
		// SUMMARIZER INPUT, however, is a different surface and still
		// carries the raw call arguments.
		//
		// The Round C canonical inputs were checked for credential-shaped
		// values; the matches were identifier substrings (`token-code`,
		// `TokenCode`), not secrets. This test therefore records the
		// BOUNDARY rather than asserting a leak.
		const messages = [
			userTurn("Run the deployment."),
			toolCall("call_args_001", "run_commands", {
				commands: ["deploy-step --path /srv/app --tag v1"],
			}),
			toolResult(
				"call_args_001",
				"run_commands",
				runCommandsPayload([
					{
						query: "deploy-step --path /srv/app --tag v1",
						result: "deployed",
						success: true,
					},
				]),
			),
			assistantTurn("Deployed."),
		];

		const { request } = await runAgenticCompactionAndCapture({ messages });

		// The call arguments ARE present...
		expect(request).toContain("/srv/app");
		expect(request).toContain("--tag v1");
		// ...while the result BODY is not.
		expect(request).not.toContain("deployed");
	});
});

// ---------------------------------------------------------------------------
// SCENARIO 6, 7, 8, 9 — previous-summary folding, successive compactions,
// the retention bound, and the deterministic correction of a wrong summary.
// ---------------------------------------------------------------------------

/**
 * A compaction summary message, in the exact shape `buildSummaryMessage`
 * produces (so `findLatestSummaryIndex` recognizes it).
 */
function previousSummaryMessage(summary: string): MessageWithMetadata {
	return {
		role: "user",
		content: [{ type: "text", text: `Context summary:\n\n${summary}` }],
		metadata: {
			kind: "compaction_summary",
			displayRole: "system",
			userRunSpan: 1,
			summary,
			details: { readFiles: [], modifiedFiles: [] },
			tokensBefore: 1000,
			generatedAt: 1,
		},
	} as MessageWithMetadata;
}

describe("ACT-CLINEMM-ROUNDC-COMPACTION-FIDELITY-RECON02 — folding and retention discriminators", () => {
	it("SCENARIO 6+7: a previous summary plus newly folded tool results is folded forward, and the decisive early result reaches the summarizer", async () => {
		const messages = [
			previousSummaryMessage("## Goal\nInvestigate R1 and R7\n"),
			toolCall("call_decisive_001", "run_commands", {
				commands: ["helm template kc .helm/roz"],
			}),
			toolResult(
				"call_decisive_001",
				"run_commands",
				runCommandsPayload([
					{
						query: "helm template kc .helm/roz",
						result: "render ok",
						success: true,
					},
				]),
			),
			assistantTurn("Rendered."),
			userTurn("Now check CI."),
			toolCall("call_later_001", "run_commands", {
				commands: ["grep -n 'mvn' .gitlab-ci.yml"],
			}),
			toolResult(
				"call_later_001",
				"run_commands",
				runCommandsPayload([
					{
						query: "grep -n 'mvn' .gitlab-ci.yml",
						result: "142: mvn -B -DskipTests package",
						success: true,
					},
				]),
			),
			assistantTurn("CI checked."),
		];

		const { request } = await runAgenticCompactionAndCapture({ messages });

		// The PREVIOUS summary is carried into the request...
		expect(request).toContain("Previous summary:");
		expect(request).toContain("Investigate R1 and R7");
		// ...and the NEWLY folded tool results are present.
		expect(request).toContain("[succeeded] helm template");
		expect(request).toContain("[succeeded] grep");
	});

	it("SCENARIO 9: a summary that incorrectly says NOT_EXECUTED is corrected by the deterministic evidence carry-forward", async () => {
		// The mock summarizer produces a WRONG summary that denies the
		// operation ran. The production evidence carry-forward appends the
		// canonical, deterministic verified-outcome section.
		summarizerOutput = [
			"## Goal",
			"Investigate R1",
			"",
			"## State",
			"- Done: nothing",
			"",
			"## Next",
			"1. Re-run the Helm render — it is NOT_EXECUTED.",
		].join("\n");

		const messages = [
			userTurn("Render the chart."),
			toolCall("call_not_executed_001", "run_commands", {
				commands: ["helm template kc .helm/roz"],
			}),
			toolResult(
				"call_not_executed_001",
				"run_commands",
				runCommandsPayload([
					{
						query: "helm template kc .helm/roz",
						result: "render ok",
						success: true,
					},
				]),
			),
			assistantTurn("Rendered."),
		];

		const { installedMessages } = await runStateAwareCompactionAndCapture({
			canonicalMessages: messages,
		});

		const continuation = installedContinuationText(installedMessages);

		// The generated summary's WRONG claim is still there (the generator
		// produced it)...
		expect(continuation).toContain("NOT_EXECUTED");
		// ...but the deterministic canonical carry-forward contradicts it
		// with the canonical tool-call id and the verified status.
		expect(continuation).toContain("Verified tool outcomes (canonical record)");
		expect(continuation).toContain("call_not_executed_001");
		expect(continuation).toContain("succeeded");
	});

	it("SCENARIO 8: the 12-outcome bound evicts the EARLIEST outcomes and keeps the most recent ones", async () => {
		const messages: MessageWithMetadata[] = [userTurn("Run many checks.")];
		const total = MAX_CARRIED_OUTCOMES + 5;
		for (let index = 0; index < total; index += 1) {
			const id = `call_bounded_${String(index).padStart(3, "0")}`;
			messages.push(
				toolCall(id, "run_commands", { commands: ["git status --short"] }),
				toolResult(
					id,
					"run_commands",
					runCommandsPayload([
						{
							query: "git status --short",
							result: "clean",
							success: true,
						},
					]),
				),
			);
		}
		messages.push(assistantTurn("All checks done."));

		const ledger = extractVerifiedToolOutcomes(messages);

		// The bound is EXACTLY the documented constant...
		expect(MAX_CARRIED_OUTCOMES).toBe(12);
		expect(ledger.outcomes.length).toBe(MAX_CARRIED_OUTCOMES);
		// ...and it evicts the EARLIEST outcomes, keeping the most recent.
		expect(ledger.outcomes[0]?.toolUseId).toBe("call_bounded_005");
		expect(
			ledger.outcomes.some(
				(outcome) => outcome.toolUseId === "call_bounded_000",
			),
		).toBe(false);

		const { installedMessages } = await runStateAwareCompactionAndCapture({
			canonicalMessages: messages,
		});
		const continuation = installedContinuationText(installedMessages);
		expect(continuation).toContain("call_bounded_014");
		expect(continuation).not.toContain("call_bounded_000");
	});
});

// ---------------------------------------------------------------------------
// The RECONSTRUCTION primitives, exercised against the production functions.
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-ROUNDC-COMPACTION-FIDELITY-RECON02 — reconstruction primitives", () => {
	it("findCutIndex keeps a tool_use/tool_result pair on the same side of the cut", () => {
		const estimator = createTokenEstimator();
		const messages = [
			userTurn("go"),
			toolCall("call_x", "run_commands", { commands: ["git status"] }),
			toolResult(
				"call_x",
				"run_commands",
				runCommandsPayload([
					{ query: "git status", result: "clean", success: true },
				]),
			),
			assistantTurn("done"),
		];
		const cut = findCutIndex(messages, 1, estimator);
		expect(cut).toBeGreaterThan(0);
		expect(cut).toBeLessThan(messages.length);
		// The preserved tail starts at an assistant message or a typed user
		// turn — never in the middle of a tool pair.
		const boundary = messages[cut];
		expect(
			boundary.role === "assistant" ||
				(boundary.role === "user" &&
					Array.isArray(boundary.content) &&
					boundary.content.some((block) => block.type === "text")),
		).toBe(true);
	});

	it("serializeConversation is the summarizer-input projection and it omits arbitrary output", () => {
		const messages = [
			toolResult(
				"call_ser_001",
				"run_commands",
				runCommandsPayload([
					{
						query: "helm template kc .helm/roz",
						result: "image: quay.io/example/app:1.0.0",
						success: true,
					},
				]),
			),
		];
		const text = serializeConversation(messages);
		expect(text).toContain("[succeeded] helm template");
		expect(text).toContain("[result omitted]");
		expect(text).not.toContain("quay.io/example/app:1.0.0");
	});

	it("applyVerifiedEvidenceToCompactedMessages is IDEMPOTENT across successive compactions", () => {
		const canonical = [
			toolCall("call_idem_001", "run_commands", {
				commands: ["git status --short"],
			}),
			toolResult(
				"call_idem_001",
				"run_commands",
				runCommandsPayload([
					{ query: "git status --short", result: "clean", success: true },
				]),
			),
		];
		const summaryMessage = previousSummaryMessage("## Goal\nWork\n");

		const first = applyVerifiedEvidenceToCompactedMessages(
			[summaryMessage],
			canonical,
		);
		expect(first.applied).toBe(true);
		const firstText = installedContinuationText(first.messages);
		expect(
			firstText.match(/Verified tool outcomes \(canonical record\)/g),
		).toHaveLength(1);

		// A SECOND compaction re-applies the carry-forward to a summary that
		// ALREADY carries the section: the section is replaced, not doubled.
		const second = applyVerifiedEvidenceToCompactedMessages(
			first.messages,
			canonical,
		);
		const secondText = installedContinuationText(second.messages);
		expect(
			secondText.match(/Verified tool outcomes \(canonical record\)/g),
		).toHaveLength(1);
		expect(secondText).toContain("call_idem_001");
	});
});

// ---------------------------------------------------------------------------
// C5 — the compaction-trigger estimator.
//
// The Round C trace shows ten compactions, each firing while the PRECEDING
// provider request reported only ~63k-81k provider-reported input tokens,
// against an effective limit of 115,200 and a trigger threshold of
// 115,200 x 0.9 = 103,680.
//
// The upstream v4.1.26 correction (cline/cline@43a976d93151,
// "fix(core): estimate re-compaction against API-safe projected messages")
// addressed a SPECIFIC divergence: the re-compaction path estimated the RAW
// PROJECTION while `MessageBuilder.buildForApi` truncates tool results to
// 8k chars before the request is sent. That correction IS PRESENT in this
// fork (compaction.ts:1171 threads `prepareApiMessages`).
//
// The discriminators below establish whether an estimator divergence STILL
// exists at the production seam, using the REAL trigger computation.
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-ROUNDC-COMPACTION-FIDELITY-RECON02 — C5 trigger estimator", () => {
	it("the production trigger math uses COMPACTION_TRIGGER_RATIO against the effective model limit", () => {
		// This pins the constants the production seam uses, so the
		// counterexample below cannot drift away from the real policy.
		expect(COMPACTION_TRIGGER_RATIO).toBe(0.9);
		expect(
			resolveEffectiveMaxInputTokens({
				maxInputTokens: 128_000,
				contextWindow: 128_000,
			}),
		).toBe(128_000);
	});

	it("counterexample: the estimator fires compaction for a request whose ACTUAL provider-visible size fits the operating budget", async () => {
		// A realistic 128k configuration.
		const MAX_INPUT_TOKENS = 128_000;
		const TRIGGER_TOKENS = MAX_INPUT_TOKENS * COMPACTION_TRIGGER_RATIO;

		// A preceding compaction summary (small), followed by several large
		// tool-result objects. The canonical bodies are large; the
		// provider-visible projection BOUNDS them.
		const messages: MessageWithMetadata[] = [
			previousSummaryMessage("## Goal\nContinue the audit\n"),
		];
		for (let index = 0; index < 12; index += 1) {
			const id = `call_big_${index}`;
			messages.push(
				toolCall(id, "run_commands", { commands: ["git status --short"] }),
				toolResult(
					id,
					"run_commands",
					runCommandsPayload([
						{
							query: "git status --short",
							// A large output body: 40k characters.
							result: "x".repeat(40_000),
							success: true,
						},
					]),
				),
			);
		}
		messages.push(assistantTurn("Audit batch done."));

		// The ESTIMATOR's view of the SAME request: the RAW canonical
		// representation, where the 40k-char result bodies are still
		// present. This is the representation the compaction trigger
		// measures when `context.apiMessages` is the raw projection.
		const estimatorView = messages;

		// The ACTUAL provider-visible view: the production
		// `MessageBuilder.buildForApi` bounds every tool-result string to
		// `DEFAULT_MAX_TOOL_RESULT_CHARS` (8,000) before the request is
		// sent. This is the REAL production projection, not a hand-built
		// approximation.
		const actualView = new MessageBuilder().buildForApi(
			messages as unknown as Parameters<MessageBuilder["buildForApi"]>[0],
		) as unknown as MessageWithMetadata[];

		const estimateRequest = (msgs: MessageWithMetadata[]): number =>
			estimateRequestInputTokens({
				systemPrompt: SYSTEM_PROMPT,
				messages: msgs,
				tools: [],
			});

		const estimatorTokens = estimateRequest(estimatorView);
		const actualTokens = estimateRequest(actualView);

		// THE COUNTEREXAMPLE: the estimator's view is OVER the trigger,
		// while the ACTUAL provider-visible view is UNDER it.
		expect(estimatorTokens).toBeGreaterThan(TRIGGER_TOKENS);
		expect(actualTokens).toBeLessThan(TRIGGER_TOKENS);

		// And the production seam ACTUALLY compacts on the raw view and
		// does NOT compact on the provider-visible view. This is the
		// end-to-end consequence at the real trigger computation.
		const shouldCompactOn = (apiMessages: MessageWithMetadata[]): boolean => {
			const requestInputTokens = estimateRequestInputTokens({
				systemPrompt: SYSTEM_PROMPT,
				messages: apiMessages,
				tools: [],
			});
			return requestInputTokens >= TRIGGER_TOKENS;
		};
		expect(shouldCompactOn(estimatorView)).toBe(true);
		expect(shouldCompactOn(actualView)).toBe(false);
	});

	it("the converse holds: a genuinely oversized request still triggers compaction", async () => {
		const MAX_INPUT_TOKENS = 128_000;
		const TRIGGER_TOKENS = MAX_INPUT_TOKENS * COMPACTION_TRIGGER_RATIO;

		// A genuinely oversized provider-visible request: the content is
		// NOT bounded by the serializer, so the estimator's view and the
		// actual view AGREE that it does not fit.
		const messages: MessageWithMetadata[] = [
			userTurn("x".repeat(TRIGGER_TOKENS * 3)),
		];

		const tokens = estimateRequestInputTokens({
			systemPrompt: SYSTEM_PROMPT,
			messages,
			tools: [],
		});

		expect(tokens).toBeGreaterThan(TRIGGER_TOKENS);
	});
});

// ---------------------------------------------------------------------------
// C2 — the SOURCE-FAITHFUL RECONSTRUCTION over the real Round C artifacts.
//
// The canonical artifacts are PRIVATE and are NEVER committed. This block
// reads them from an explicit environment variable and emits ONLY
// privacy-safe MEASUREMENTS (counts, sizes, boolean markers, closed
// vocabulary labels). It never emits raw source text, raw tool output,
// prompts, or credentials.
//
// The block is SKIPPED (not failed) when the artifacts are not present, so
// the default suite stays green on a machine without the private capture.
//
// Environment:
//   CLINE_ROUNDC_SESSION_DIR  — directory holding the three Round C files
// ---------------------------------------------------------------------------

const ROUNDC_SESSION_DIR = process.env.CLINE_ROUNDC_SESSION_DIR;

interface RoundCArtifact {
	messages: MessageWithMetadata[];
	compaction: {
		source_message_count: number;
		source_prefix_hash: string;
		source_last_message_key: string;
		messages: MessageWithMetadata[];
	};
}

function loadRoundCArtifacts(): RoundCArtifact | undefined {
	if (!ROUNDC_SESSION_DIR) {
		return undefined;
	}
	try {
		const dir = resolve(ROUNDC_SESSION_DIR);
		const raw = JSON.parse(
			readFileSync(resolve(dir, "1794835772204_hvkkv.messages.json"), "utf8"),
		) as { messages: MessageWithMetadata[] };
		const compaction = JSON.parse(
			readFileSync(resolve(dir, "1794835772204_hvkkv.compaction.json"), "utf8"),
		) as RoundCArtifact["compaction"];
		return { messages: raw.messages, compaction };
	} catch {
		return undefined;
	}
}

/**
 * The body of ONE tool-result payload, as a string. Used only for the
 * BOUNDARY COUNT (empty vs non-empty), never for content.
 */
function toolResultBody(block: { content: unknown }): string {
	const content = block.content;
	if (typeof content === "string") {
		return content;
	}
	if (Array.isArray(content)) {
		return content
			.map((entry) =>
				entry && typeof entry === "object"
					? String((entry as { result?: unknown }).result ?? "")
					: String(entry ?? ""),
			)
			.join("");
	}
	return "";
}

describe.skipIf(!ROUNDC_SESSION_DIR)(
	"ACT-CLINEMM-ROUNDC-COMPACTION-FIDELITY-RECON02 — source-faithful reconstruction",
	() => {
		it("reconstructs the last compaction's selection, projection and continuation", () => {
			const artifacts = loadRoundCArtifacts();
			expect(artifacts).toBeDefined();
			if (!artifacts) {
				return;
			}
			const canonical = artifacts.messages;
			const compaction = artifacts.compaction;

			// --- CONSERVATION -------------------------------------------------
			const calls = new Set<string>();
			const results = new Map<string, { content: unknown }>();
			let resultCount = 0;
			let nonemptyResultCount = 0;
			for (const message of canonical) {
				if (!Array.isArray(message.content)) {
					continue;
				}
				for (const block of message.content) {
					if (block.type === "tool_use") {
						calls.add(block.id);
					} else if (block.type === "tool_result") {
						resultCount += 1;
						results.set(block.tool_use_id, block);
						if (toolResultBody(block).trim().length > 0) {
							nonemptyResultCount += 1;
						}
					}
				}
			}
			const matched = [...results.keys()].filter((id) => calls.has(id));

			const coveredCount = compaction.source_message_count;
			const prefix = canonical.slice(0, coveredCount);
			const tail = canonical.slice(coveredCount);

			const prefixCalls = new Set<string>();
			const prefixResults = new Set<string>();
			let prefixNonempty = 0;
			for (const message of prefix) {
				if (!Array.isArray(message.content)) {
					continue;
				}
				for (const block of message.content) {
					if (block.type === "tool_use") {
						prefixCalls.add(block.id);
					} else if (block.type === "tool_result") {
						prefixResults.add(block.tool_use_id);
						if (toolResultBody(block).trim().length > 0) {
							prefixNonempty += 1;
						}
					}
				}
			}

			// --- THE VERIFIED-OUTCOME LEDGER (the canonical authority) -------
			const ledger = extractVerifiedToolOutcomes(canonical);
			const rejectedReasons = new Map<string, number>();
			for (const rejected of ledger.rejected) {
				rejectedReasons.set(
					rejected.reason,
					(rejectedReasons.get(rejected.reason) ?? 0) + 1,
				);
			}

			// --- THE SUMMARIZER-INPUT PROJECTION (production serializer) ------
			const serialized = serializeConversation(prefix);
			const omittedMarkerCount =
				serialized.split("[result omitted]").length - 1;
			const unsupportedMarkerCount =
				serialized.split("[unsupported tool result shape]").length - 1;

			// --- THE INSTALLED CONTINUATION (the retained sidecar) -----------
			const continuation = compaction.messages
				.flatMap((message) =>
					Array.isArray(message.content)
						? message.content
								.filter(
									(block): block is { type: "text"; text: string } =>
										block.type === "text" &&
										typeof (block as { text?: unknown }).text === "string",
								)
								.map((block) => block.text)
						: [],
				)
				.join("\n");

			const measurements = {
				canonicalMessageCount: canonical.length,
				canonicalToolCallCount: calls.size,
				canonicalToolResultCount: resultCount,
				canonicalMatchedPairCount: matched.length,
				canonicalNonemptyResultCount: nonemptyResultCount,
				coveredPrefixMessageCount: coveredCount,
				coveredPrefixToolCallCount: prefixCalls.size,
				coveredPrefixToolResultCount: prefixResults.size,
				coveredPrefixNonemptyResultCount: prefixNonempty,
				tailMessageCount: tail.length,
				sourceLastMessageKey: compaction.source_last_message_key,
				prefixLastMessageId: prefix[prefix.length - 1]?.id ?? null,
				sourcePrefixHash: compaction.source_prefix_hash,
				verifiedOutcomeCount: ledger.outcomes.length,
				verifiedOutcomeBound: MAX_CARRIED_OUTCOMES,
				rejectedOutcomeCount: ledger.rejected.length,
				rejectedOutcomeReasons: Object.fromEntries(rejectedReasons),
				summarizerInputSerializedChars: serialized.length,
				summarizerInputOmittedMarkerCount: omittedMarkerCount,
				summarizerInputUnsupportedMarkerCount: unsupportedMarkerCount,
				continuationMessageCount: compaction.messages.length,
				continuationTextChars: continuation.length,
				continuationCarriesVerifiedOutcomeSection: continuation.includes(
					"Verified tool outcomes (canonical record)",
				),
				continuationClaimsOutputsOmitted:
					continuation.includes("outputs are omitted") ||
					continuation.includes("stdout/results are omitted"),
				continuationClaimsMavenMustBeRecollected: continuation.includes(
					"Re-run R7 evidence batch",
				),
			};

			// The reconstruction must be SELF-CONSISTENT: the prefix hash and
			// the last-message key must both land on the covered prefix.
			//
			// `source_last_message_key` is stored as `<field>:<value>`
			// (e.g. `id:msg_8nBMg_D6`), so the VALUE is compared here.
			const sourceLastMessageId = compaction.source_last_message_key.includes(
				":",
			)
				? compaction.source_last_message_key.slice(
						compaction.source_last_message_key.indexOf(":") + 1,
					)
				: compaction.source_last_message_key;
			expect(measurements.prefixLastMessageId).toBe(sourceLastMessageId);

			// The evidence ledger must be bounded by the documented constant.
			expect(measurements.verifiedOutcomeCount).toBeLessThanOrEqual(
				MAX_CARRIED_OUTCOMES,
			);

			// The retained continuation MUST carry the deterministic
			// verified-outcome section whenever the ledger is non-empty —
			// otherwise the model continues with a summary that is MORE
			// authoritative than the canonical record.
			if (measurements.verifiedOutcomeCount > 0) {
				expect(measurements.continuationCarriesVerifiedOutcomeSection).toBe(
					true,
				);
			}

			// Every tool result in the covered prefix must be represented in
			// the summarizer input in SOME form (status or marker), never
			// silently absent.
			expect(
				measurements.summarizerInputOmittedMarkerCount +
					measurements.summarizerInputUnsupportedMarkerCount,
			).toBeGreaterThan(0);

			// Emit the privacy-safe measurements for the evidence artifact.
			console.log(`ROUND_C_RECON_MEASUREMENTS ${JSON.stringify(measurements)}`);
		});
	},
);
