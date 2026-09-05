/**
 * ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01
 * (seventy-seventh-pass, CORRECTION02 real-producer-witness).
 *
 * Bridge test driving the FULL COMPOSITION of the manual
 * compaction adapter end-to-end through the REAL
 * `@cline/core` factory:
 *
 *   real createContextCompactionPrepareTurn
 *   -> real successful CoreCompactionResult
 *   -> real compactSessionMessages
 *   -> real estimateRequestInputTokens
 *
 * Companion to `sdk-compaction-w-publish-red01.test.ts`. The
 * companion file qualifies the adapter with a hand-rolled
 * `createContextCompactionPrepareTurn` mock. THIS file
 * qualifies the same adapter with the REAL factory,
 * bypassing the `@cline/core` vitest stub alias.
 *
 * Why a dedicated bridge config?
 *
 *   The base `apps/vscode/vitest.config.ts` aliases
 *   `@cline/core` to `src/test/cline-core-vitest-stub.ts`
 *   (which does not export
 *   `createContextCompactionPrepareTurn`). Bypassing the
 *   alias requires either (a) a dedicated bridge config,
 *   or (b) changing the production code. This test takes
 *   (a) -- it runs under
 *   `vitest.config.c2-4-c-bridge.ts` with the
 *   `@cline-internal/core/extensions/context/compaction`
 *   alias pointed at the live SDK source.
 *
 * Recipe (hermetic, no LLM call, no provider I/O):
 *
 *   - mode: "manual" (skip the auto shouldCompact gate;
 *     always run the strategy)
 *   - strategy: "basic" (deterministic, no provider
 *     round-trip)
 *   - maxInputTokens tuned so the triggerRatio trips on a
 *     modest transcript
 *   - transcript built so the basic projection changes
 *     messages (i.e. targetTokens < inputTokens and the
 *     dropped-work summary is added)
 *
 * Classification:
 *
 *   COMPACTION FACTORY       = REAL_PRODUCTION_SEAM
 *   MANUAL ADAPTER           = REAL_PRODUCTION_SEAM
 *   W ESTIMATOR              = REAL
 *   FIXTURE                  = SYNTHETIC_REAL
 *   LIVE USER SESSION        = NOT_EXECUTED
 *
 * If `compactSessionMessages` is ever refactored such that
 * the real factory no longer reaches the seam-computed W,
 * this test flips RED. That is the load-bearing promise
 * of R5.
 */

import { estimateRequestInputTokens } from "@cline/shared"
import type { Message as SdkMessage } from "@cline/llms"
import { describe, expect, it } from "vitest"

// REAL `@cline/core` factory, bypassing the vitest stub
// alias. The alias is defined in
// `apps/vscode/vitest.config.c2-4-c-bridge.ts`.
import { createContextCompactionPrepareTurn } from "@cline-internal/core/extensions/context/compaction"

// REAL adapter under test (not mocked).
import { compactSessionMessages } from "../sdk-compaction"

const SYSTEM_PROMPT =
	"You are a concise coding assistant. Help with tasks succinctly."

// Minimal tool entry -- the estimator JSON.stringifies
// whatever shape is provided; the exact tool type doesn't
// matter for the W computation.
const TOOLS = [
	{
		name: "read_files",
		description: "Read files",
		input_schema: { type: "object" },
	},
] as never

// A transcript large enough that the basic strategy's
// manual-mode budget projection (manualTargetRatio default
// 0.5) actually rewrites the message list. With
// maxInputTokens=1000, the trigger is around 800 tokens
// (COMPACTION_TRIGGER_RATIO * 0.8). A 1600-char user prompt
// + 5400-char assistant reply sums to ~1750 tokens, which
// the manual-mode target = min(800, 1750*0.5) = 800 forces
// a projection.
const MESSAGES_BEFORE: SdkMessage[] = [
	{
		role: "user",
		content: "Investigate the failing tests in the auth module. ".repeat(40),
	},
	{
		role: "assistant",
		content:
			"I've reviewed the failing tests. Here is a long analysis. ".repeat(150),
	},
	{
		role: "user",
		content: "Apply the fix to /src/auth/session.ts and re-run the suite.",
	},
	{
		role: "assistant",
		content: "Reading the source to identify the regression boundary.",
	},
]

describe("R5 -- real-producer composition witness (CORRECTION02)", () => {
	it(
		"compactSessionMessages driven by the REAL createContextCompactionPrepareTurn " +
			"factory produces numeric POST_COMPACTION_CURRENT_CONFIG_W bound to " +
			"session-config operands",
		async () => {
			// Sanity probe: the REAL factory must produce a
			// successful CoreCompactionResult for the chosen
			// recipe. This is the load-bearing condition for
			// the rest of the assertion.
			const probePrepareTurn = createContextCompactionPrepareTurn({
				providerId: "anthropic",
				modelId: "claude-test",
				providerConfig: {
					providerId: "anthropic",
					modelId: "claude-test",
				} as never,
				compaction: { enabled: true, strategy: "basic" },
				logger: undefined,
			})
			expect(probePrepareTurn).toBeDefined()
			const probeResult = await probePrepareTurn!({
				agentId: "agent-r5-probe",
				conversationId: "conv-r5-probe",
				parentAgentId: null,
				iteration: 1,
				abortSignal: new AbortController().signal,
				systemPrompt: SYSTEM_PROMPT,
				tools: TOOLS as never,
				messages: MESSAGES_BEFORE as never,
				apiMessages: MESSAGES_BEFORE as never,
				model: {
					id: "claude-test",
					provider: "anthropic",
					info: { id: "claude-test", maxInputTokens: 1_000 },
				},
			})
			// The probe must show a real successful
			// compaction.
			expect(probeResult).toBeDefined()
			expect(probeResult?.messages).toBeDefined()

			// Now drive the FULL adapter with the same
			// recipe. The compactSessionMessages seam passes
			// `{mode: "manual"}` (no manualTargetRatio). The
			// default ratio (0.5) kicks in inside
			// resolveManualMessageTargetTokens.
			const result = await compactSessionMessages({
				config: {
					providerConfig: {
						providerId: "anthropic",
						modelId: "claude-test",
					} as never,
					providerId: "anthropic",
					modelId: "claude-test",
					knownModels: {
						"claude-test": {
							id: "claude-test",
							maxInputTokens: 1_000,
						},
					},
					compaction: { enabled: true, strategy: "basic" },
					logger: undefined,
					telemetry: undefined,
					// CORRECTION02 (seventy-eighth-pass):
					// `systemPrompt` is REQUIRED (compile-time
					// enforced via the strengthened Pick<>).
					systemPrompt: SYSTEM_PROMPT,
					// `extraTools` is OPTIONAL on the source
					// type; the estimator degrades to `[]`.
					extraTools: TOOLS,
				},
				sessionId: "session-r5-real-producer",
				messages: MESSAGES_BEFORE,
			})

			// The REAL factory must produce a successful
			// CoreCompactionResult (messages defined). If
			// the factory returns undefined or
			// messages===undefined, the seam fails closed
			// at `compacted=false`.
			expect(result.compacted).toBe(true)
			expect(result.messages).toBeDefined()
			expect(result.messages.length).toBeGreaterThan(0)

			// The seam-computed W must be a positive
			// number, bound to the session-config operands
			// (NOT to runtime-composed operands).
			expect(typeof result.currentWorkingContextEstimate).toBe("number")
			expect(result.currentWorkingContextEstimate).toBeGreaterThan(0)

			// Exact Option-1 product contract: W equals
			// the estimator over the session-config
			// operands and the ACTUAL compacted messages
			// returned by the real factory.
			const expectedW = estimateRequestInputTokens({
				systemPrompt: SYSTEM_PROMPT,
				messages: result.messages,
				tools: TOOLS,
			})
			expect(result.currentWorkingContextEstimate).toBe(expectedW)
		},
	)
})
