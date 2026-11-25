/**
 * ACT-CLINEMM-COMPACTION-ATOMIC-SUMMARY-INSTALLATION-REPAIR-01
 *
 * THE SUMMARY-COMPLETENESS REGRESSION SUITE (converted from the CMP-04
 * defect-positive witness).
 *
 * ============================================================================
 * THE DEFECT
 * ============================================================================
 *
 * `generateSummary()` collected the provider-reported incompleteness:
 * `SummaryGenerationResult.incompleteReason` is documented as the
 * provider-reported reason the response is incomplete (for example
 * `max_output_tokens`), and it was plumbed all the way through the
 * summarizer transport.
 *
 * NO DECISION WAS MADE ON IT. `runAgenticCompaction()` only checked whether a
 * summary EXISTS at all:
 *
 *     const rawSummary = summaryResult.text.trim();
 *     if (!rawSummary) { ...skip... }
 *     const summary = ensureFilesSection(rawSummary, fileOps);
 *     buildSummaryMessage({ summary, ... })
 *
 * So a summary the provider reported as INCOMPLETE — cut off mid-sentence by
 * the output budget — passed through `ensureFilesSection()` and REPLACED the
 * compacted history exactly like a complete one.
 *
 * An EMPTY summary got a warning with a `likelyCause`. A TRUNCATED summary
 * got nothing: no warning, no log, and no marker on the installed summary.
 * The installed summary was indistinguishable from a complete one.
 *
 * ============================================================================
 * WHY THIS FILE USED TO BE A WITNESS AND IS NOW A GATE
 * ============================================================================
 *
 * The predecessor ACT preserved this file as a DEFECT-POSITIVE witness: it
 * asserted that the defect was PRESENT, so it passed before the repair and
 * had to FAIL after it. That inversion is exactly what this ACT removes.
 *
 * This file is now a PERMANENT REGRESSION GATE: it asserts the REPAIRED
 * behaviour, so it must pass from now on. It keeps the predecessor's three
 * original observations, INVERTED:
 *
 *   R1 (was: the incompleteness reaches the seam)  -> the seam is exercised
 *   R2 (was: the truncated summary IS installed)    -> it is NOT installed
 *   R3 (was: nothing records the incompleteness)  -> the rejection IS recorded
 *
 * ============================================================================
 * THE STATE-OWNING FIXTURE (AMENDMENT-01 A1)
 * ============================================================================
 *
 * The predecessor witness used `getState: () => undefined` and
 * `saveState: () => undefined`, then independently constructed a sidecar from
 * the returned messages. That establishes only that the truncated summary was
 * RETURNED and PROJECTED — not that any state was actually installed or
 * persisted.
 *
 * This file therefore drives the production composition with an OBSERVABLE
 * STATE-OWNING fixture:
 *
 *   1. `getState()` returns the CURRENTLY INSTALLED state.
 *   2. `saveState()` records its ACTUAL invocation and updates that state.
 *   3. The subsequent projection consumes the OBSERVED installed state.
 *   4. The suite does NOT manufacture a replacement sidecar from the result
 *      merely to inspect it.
 *
 * The state fixture is an IN-MEMORY CALLBACK fixture. It establishes
 * CALLBACK-LEVEL state installation. It does NOT establish durable
 * storage/reload durability, and it does not claim to.
 */

import type * as LlmsProviders from "@cline/llms";
import type { MessageWithMetadata } from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createSessionCompactionState,
	type SessionCompactionState,
} from "../../session/models/session-compaction";
import { MessageBuilder } from "../../session/services/message-builder";
import {
	createCompactionStateAwarePrepareTurn,
	createContextCompactionPrepareTurn,
} from "./compaction";

const createHandlerMock = vi.fn();

vi.mock("@cline/llms", () => ({
	createHandlerAsync: (config: unknown) => createHandlerMock(config),
}));

/** The provider-reported incompleteness reason. */
const INCOMPLETE_REASON = "max_output_tokens";

/**
 * The TRUNCATED summary the provider returns: real text, cut off
 * mid-sentence.
 */
const TRUNCATED_SUMMARY = "The user asked about the deploy pipeline and we";

const SYSTEM_PROMPT = "You are a helpful coding assistant.";

async function* streamChunks(
	chunks: readonly Record<string, unknown>[],
): AsyncGenerator<Record<string, unknown>> {
	for (const chunk of chunks) {
		yield chunk;
	}
}

beforeEach(() => {
	createHandlerMock.mockReset();
	createHandlerMock.mockReturnValue({
		createMessage: vi.fn(() =>
			streamChunks([
				{ type: "text", id: "summary-1", text: TRUNCATED_SUMMARY },
				{
					type: "done",
					id: "summary-1",
					success: true,
					incompleteReason: INCOMPLETE_REASON,
				},
			]),
		),
	});
});

function userTurn(text: string): MessageWithMetadata {
	return { role: "user", content: [{ type: "text", text }] };
}

function canonicalHistory(): MessageWithMetadata[] {
	return [
		userTurn("Inspect the deploy pipeline and report what you found."),
		{
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id: "call_truncated",
					name: "run_commands",
					input: { commands: ["cat deploy.env"] },
				},
			],
		},
		{
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "call_truncated",
					name: "run_commands",
					content: [{ query: "cat deploy.env", result: "rc=0", success: true }],
				} as never,
			],
		},
		userTurn("Continue."),
	];
}

/**
 * The OBSERVABLE STATE-OWNING FIXTURE.
 *
 * `getState()` returns the CURRENTLY INSTALLED state; `saveState()` records
 * its ACTUAL invocation and installs the state it was handed.
 */
interface StateFixture {
	/** The state currently installed. */
	readonly installed: () => SessionCompactionState | undefined;
	/** Every state the production seam actually handed to `saveState`. */
	readonly saveCalls: readonly SessionCompactionState[];
}

interface SeamRun {
	readonly providerVisibleText: string;
	/** The state the fixture actually holds after the run. */
	readonly installedState: SessionCompactionState | undefined;
	readonly saveCalls: readonly SessionCompactionState[];
	readonly logs: readonly string[];
	/** The canonical history the seam was given, after the run. */
	readonly canonicalAfter: readonly MessageWithMetadata[];
}

/**
 * Drive the REAL production compaction seam with the state-owning fixture.
 */
async function runProductionSeam(
	options: {
		readonly canonical?: readonly MessageWithMetadata[];
		readonly existingState?: SessionCompactionState;
	} = {},
): Promise<SeamRun> {
	const providerId = "anthropic";
	const modelId = "mock-model";
	const innerModel = {
		id: modelId,
		provider: providerId,
		info: { id: modelId, maxInputTokens: 16_000 },
	} as unknown as Parameters<
		NonNullable<
			Parameters<typeof createCompactionStateAwarePrepareTurn>[0]["compact"]
		>
	>[0]["model"];
	const outerModel = {
		id: modelId,
		provider: providerId,
		info: { id: modelId, maxInputTokens: 128_000 },
	} as unknown as Parameters<
		NonNullable<
			Parameters<typeof createCompactionStateAwarePrepareTurn>[0]["compact"]
		>
	>[0]["model"];

	const logs: string[] = [];
	const logger = {
		debug: (message: string, metadata?: unknown) =>
			logs.push(`debug: ${message} ${JSON.stringify(metadata ?? null)}`),
		log: (message: string, metadata?: unknown) =>
			logs.push(`log: ${message} ${JSON.stringify(metadata ?? null)}`),
	};

	const inner = createContextCompactionPrepareTurn(
		{
			providerId,
			modelId,
			providerConfig: { providerId, modelId } as LlmsProviders.ProviderConfig,
			compaction: {
				enabled: true,
				strategy: "agentic",
				preserveRecentTokens: 1,
			},
			logger: logger as never,
		},
		{ mode: "manual" },
	);

	// The observable state-owning fixture.
	let installed: SessionCompactionState | undefined = options.existingState;
	const saveCalls: SessionCompactionState[] = [];
	const fixture: StateFixture = {
		installed: () => installed,
		saveCalls,
	};

	const prepareTurn = createCompactionStateAwarePrepareTurn({
		compact: (context) =>
			inner?.({ ...context, model: innerModel }) ?? Promise.resolve(undefined),
		getState: () => fixture.installed(),
		prepareApiMessages: async (messages) => messages,
		saveState: (state) => {
			// Record the ACTUAL invocation and install what was handed over.
			saveCalls.push(state);
			installed = state;
		},
	});

	const canonical = [...(options.canonical ?? canonicalHistory())];
	const result = await prepareTurn({
		agentId: "agent-1",
		conversationId: "conv-1",
		parentAgentId: null,
		iteration: 1,
		abortSignal: new AbortController().signal,
		systemPrompt: SYSTEM_PROMPT,
		tools: [],
		messages: canonical,
		apiMessages: canonical,
		model: outerModel,
	});

	const productionMessages = result?.messages ?? [];
	const providerVisible = new MessageBuilder().buildForApi(
		productionMessages as unknown as Parameters<
			MessageBuilder["buildForApi"]
		>[0],
	);
	return {
		providerVisibleText: JSON.stringify(providerVisible),
		installedState: fixture.installed(),
		saveCalls: fixture.saveCalls,
		logs,
		canonicalAfter: canonical,
	};
}

/**
 * A prior, VALID compaction state over the first two canonical messages.
 */
function priorValidState(
	canonical: readonly MessageWithMetadata[],
): SessionCompactionState {
	return createSessionCompactionState({
		sourceMessages: canonical.slice(0, 2),
		compactedMessages: [
			{
				role: "user",
				content: [{ type: "text", text: PRIOR_VALID_SUMMARY }],
			} as unknown as MessageWithMetadata,
		],
		conversationId: "conv-1",
		systemPrompt: SYSTEM_PROMPT,
		updatedAt: new Date(0).toISOString(),
	});
}

/** The text of the previously installed, valid summary. */
const PRIOR_VALID_SUMMARY =
	"Prior valid summary: the deploy pipeline was inspected.";

describe("ACT-CLINEMM-COMPACTION-ATOMIC-SUMMARY-INSTALLATION-REPAIR-01 — the summary-completeness regression", () => {
	it("R1: the compaction seam is exercised and the incompleteness reaches it", async () => {
		// The transport must actually see the provider's report. Without
		// this, the rest of the suite could pass vacuously.
		const seam = await runProductionSeam();
		expect(createHandlerMock.mock.results.length).toBeGreaterThan(0);
		// The provider-reported incompleteness reached the seam and was
		// RECORDED as the reason for the refusal.
		const warnings = seam.logs.filter((line) => line.startsWith("log: "));
		expect(warnings.join("\n")).toContain(INCOMPLETE_REASON);
	});

	it("R2: the TRUNCATED summary is NOT installed and replaces nothing", async () => {
		const seam = await runProductionSeam();
		// The truncated text reaches neither the installed state...
		expect(JSON.stringify(seam.installedState ?? null)).not.toContain(
			TRUNCATED_SUMMARY,
		);
		// ...nor the provider-visible projection.
		expect(seam.providerVisibleText).not.toContain(TRUNCATED_SUMMARY);
		// No state was installed at all.
		expect(seam.installedState).toBeUndefined();
		expect(seam.saveCalls).toHaveLength(0);
	});

	it("R3: the rejection IS recorded, so the refusal is diagnosable", async () => {
		const seam = await runProductionSeam();
		const warnings = seam.logs.filter((line) => line.startsWith("log: "));
		const joined = warnings.join("\n");
		// The specific reason is reported.
		expect(joined).toContain(INCOMPLETE_REASON);
		expect(joined).toContain("provider_reported_incomplete");
		// And the terminal status is reported as a classification.
		expect(joined).toContain("known_incomplete");
	});

	it("A1: an initial compaction with a rejected candidate installs NO state", async () => {
		const canonical = canonicalHistory();
		const seam = await runProductionSeam({ canonical });

		// No rejected candidate was passed to saveState().
		expect(seam.saveCalls).toHaveLength(0);
		// No state was installed.
		expect(seam.installedState).toBeUndefined();
		// The canonical history is unchanged.
		expect(seam.canonicalAfter).toEqual(canonical);
		// No rejected summary reached the provider projection.
		expect(seam.providerVisibleText).not.toContain(TRUNCATED_SUMMARY);
	});

	it("A1: a RE-compaction over a valid prior state keeps the prior state intact", async () => {
		const canonical = canonicalHistory();
		const prior = priorValidState(canonical);
		const seam = await runProductionSeam({ canonical, existingState: prior });

		// No rejected candidate was passed to saveState().
		expect(seam.saveCalls).toHaveLength(0);
		// The previously valid installed state was NOT replaced.
		expect(seam.installedState).toBe(prior);
		// The compacted source boundary did NOT advance.
		expect(seam.installedState?.source_message_count).toBe(
			prior.source_message_count,
		);
		// The previously installed summary is still the one that is used.
		expect(seam.providerVisibleText).toContain(PRIOR_VALID_SUMMARY);
		// The rejected summary reaches nothing.
		expect(seam.providerVisibleText).not.toContain(TRUNCATED_SUMMARY);
		expect(JSON.stringify(seam.installedState ?? null)).not.toContain(
			TRUNCATED_SUMMARY,
		);
		// No retained canonical message was lost: the prior state's own
		// messages are unchanged.
		expect(seam.installedState?.messages).toEqual(prior.messages);
	});
});
