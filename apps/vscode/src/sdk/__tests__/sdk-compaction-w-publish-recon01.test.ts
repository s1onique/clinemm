/**
 * ACT-CLINEMM-POST-COMPACTION-W-BAR-REFRESH-RECON01
 * (PASS POST_COMPACTION_PUBLICATION_REPAIRED)
 *
 * Production-seam GREEN test for the bounded W-publication repair
 * at the manual-compaction producer seam.
 *
 * DEFECT (pre-repair): see .factory/evidence/ACT-CLINEMM-POST-
 * COMPACTION-W-BAR-REFRESH-RECON01/04-red-reproduction.txt
 *
 * REPAIR:
 *   1. apps/vscode/src/sdk/sdk-compaction.ts — additive
 *      `currentWorkingContextEstimate?: number` on
 *      CompactSessionMessagesResult (the producer's W is now
 *      surfaced).
 *   2. apps/vscode/src/sdk/sdk-compaction-coordinator.ts —
 *      optional `publishPostCompactionW?: (w: number) => void`
 *      option, invoked from runCompactionInPhase after the
 *      divider emit and BEFORE postStateToWebview.
 *   3. apps/vscode/src/sdk/working-context-host-capture.ts —
 *      new transport-only `setLatest(estimate: number | null)`
 *      seam that writes the carrier with the same
 *      fail-closed assignment semantics as the runtime-event
 *      observer.
 *   4. apps/vscode/src/sdk/SdkController.ts — wires the option
 *      to `this.workingContextHostCapture.setLatest(w)`.
 */

import { createContextCompactionPrepareTurn } from "@cline/core"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { compactSessionMessages, type CompactSessionMessagesInput } from "../sdk-compaction"
import { WorkingContextHostCapture } from "../working-context-host-capture"

// Mock @cline/core — the vitest stub does not export
// createContextCompactionPrepareTurn. We provide a deterministic impl
// that mirrors the production behavior: returns a compact function
// whose prepareTurn returns a configurable W.
vi.mock("@cline/core", () => ({
	createContextCompactionPrepareTurn: vi.fn(),
	createSessionCompactionState: vi.fn((input: { compactedMessages: unknown[] }) => ({
		version: 1,
		messages: input.compactedMessages,
		_compactedMessages: input.compactedMessages,
	})),
}))

const mockCreateContextCompactionPrepareTurn =
	createContextCompactionPrepareTurn as unknown as ReturnType<typeof vi.fn>

vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		debug: vi.fn(),
		error: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
	},
}))

function buildMessages(count: number) {
	return Array.from({ length: count }, (_, i) => ({
		role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
		content: `msg-${i}`,
	}))
}

// Session-config-time operands used by the manual seam to compute
// POST_COMPACTION_CURRENT_CONFIG_W per Option 1.
const SYSTEM_PROMPT_FOR_RECON01 = "system"
const EXTRA_TOOLS_FOR_RECON01 = [
	{ name: "test_tool", description: "t", input_schema: { type: "object" } },
] as never

function makeBaseInput(messages: CompactSessionMessagesInput["messages"]): CompactSessionMessagesInput {
	return {
		sessionId: "session-recon01",
		messages,
		config: {
			providerConfig: {} as CompactSessionMessagesInput["config"]["providerConfig"],
			providerId: "anthropic",
			modelId: "claude-3-5-sonnet",
			compaction: { enabled: true },
			knownModels: {} as CompactSessionMessagesInput["config"]["knownModels"],
			logger: {
				debug: () => {},
				log: () => {},
				info: () => {},
				warn: () => {},
				error: () => {},
			} as CompactSessionMessagesInput["config"]["logger"],
			telemetry: undefined,
			// ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01
			// (seventy-seventh-pass, Option 1): forward
			// session-config-time operands so the manual seam
			// can compute POST_COMPACTION_CURRENT_CONFIG_W.
			systemPrompt: SYSTEM_PROMPT_FOR_RECON01,
			extraTools: EXTRA_TOOLS_FOR_RECON01,
		},
	}
}

describe("RECON01 R1: compactSessionMessages surfaces W from the producer seam", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("returns currentWorkingContextEstimate as a number on success (green, Option 1 seam-computed)", async () => {
		mockCreateContextCompactionPrepareTurn.mockReturnValue(() =>
			Promise.resolve({
				messages: buildMessages(20),
				systemPrompt: "rewritten system",
				// Pre-repair: producer purported to return W here.
				// Post-repair: this field is ignored -- the seam
				// computes W from session-config operands. Mock
				// omits it to prove the seam owns W.
			}),
		)
		const result = await compactSessionMessages(makeBaseInput(buildMessages(60)))
		expect(result.compacted).toBe(true)
		expect(typeof result.currentWorkingContextEstimate).toBe("number")
		expect(result.currentWorkingContextEstimate).toBeGreaterThan(0)
		// Exact Option-1 product contract: W is computed from
		// session-config operands (systemPrompt + projected
		// messages + extraTools), not from the producer's
		// alleged W (which is undefined for CoreCompactionResult).
		const { estimateRequestInputTokens } = await import("@cline/shared")
		const expectedW = estimateRequestInputTokens({
			systemPrompt: SYSTEM_PROMPT_FOR_RECON01,
			messages: buildMessages(20),
			tools: EXTRA_TOOLS_FOR_RECON01,
		})
		expect(result.currentWorkingContextEstimate).toBe(expectedW)
	})

	it("returns currentWorkingContextEstimate undefined when result.messages is undefined (no-op / metadata-only branch)", async () => {
		mockCreateContextCompactionPrepareTurn.mockReturnValue(() =>
			Promise.resolve({
				// metadata-only return: no projection, no W
				currentWorkingContextEstimate: 12_345,
			}),
		)
		const result = await compactSessionMessages(makeBaseInput(buildMessages(60)))
		// No real projection happened. The seam must NOT publish
		// optimistic W -- the carrier is failure-closed.
		expect(result.compacted).toBe(false)
		expect(result.currentWorkingContextEstimate).toBeUndefined()
	})
})

describe("RECON01 R2 + R3: post-compaction W reaches the host-side carrier via setLatest", () => {
	beforeEach(() => vi.clearAllMocks())

	it("the surfaced W replaces the stale pre-compaction carrier value", () => {
		const capture = new WorkingContextHostCapture()
		// Pre-populate the carrier with the LAST AgentRuntime.prepareTurn
		// value (the live-UI stale-bar scenario).
		const PRE = 412_700
		const POST = 29_600
		capture.setLatest(PRE)
		expect(capture.currentWorkingContextEstimate).toBe(PRE)
		// Simulate the bounded repair: the coordinator publishes the
		// post-compaction W via setLatest.
		capture.setLatest(POST)
		expect(capture.currentWorkingContextEstimate).toBe(POST)
		expect(capture.currentWorkingContextEstimate).not.toBe(PRE)
	})

	it("W value is the seam-computed POST_COMPACTION_CURRENT_CONFIG_W (Option 1)", async () => {
		mockCreateContextCompactionPrepareTurn.mockReturnValue(() =>
			Promise.resolve({
				messages: buildMessages(20),
				systemPrompt: "rewritten system",
				// Producer never carries W (CoreCompactionResult
				// lacks the field). Seam computes it.
			}),
		)
		const result = await compactSessionMessages(makeBaseInput(buildMessages(60)))
		expect(typeof result.currentWorkingContextEstimate).toBe("number")
		// The carrier assignment carries the seam-computed
		// value (no producer-side recompute).
		const capture = new WorkingContextHostCapture()
		if (typeof result.currentWorkingContextEstimate === "number") {
			capture.setLatest(result.currentWorkingContextEstimate)
		}
		// The carrier MUST hold exactly the seam-computed value.
		const { estimateRequestInputTokens } = await import("@cline/shared")
		const expectedW = estimateRequestInputTokens({
			systemPrompt: SYSTEM_PROMPT_FOR_RECON01,
			messages: buildMessages(20),
			tools: EXTRA_TOOLS_FOR_RECON01,
		})
		expect(capture.currentWorkingContextEstimate).toBe(expectedW)
	})

	it("setLatest with a non-number normalizes to null (transport-only fail-closed)", () => {
		const capture = new WorkingContextHostCapture()
		capture.setLatest(100)
		expect(capture.currentWorkingContextEstimate).toBe(100)
		capture.setLatest(null)
		expect(capture.currentWorkingContextEstimate).toBeNull()
	})
})

describe("RECON01 R5 (failure): a failed compaction does NOT publish a fake W", () => {
	beforeEach(() => vi.clearAllMocks())

	it("empty input returns compacted=false and no W surface", async () => {
		const result = await compactSessionMessages(makeBaseInput([]))
		expect(result.compacted).toBe(false)
		expect(mockCreateContextCompactionPrepareTurn).not.toHaveBeenCalled()
		expect(result.currentWorkingContextEstimate).toBeUndefined()
	})

	it("producer returning undefined makes the surface undefined", async () => {
		mockCreateContextCompactionPrepareTurn.mockReturnValue(() => Promise.resolve(undefined))
		const result = await compactSessionMessages(makeBaseInput(buildMessages(60)))
		expect(result.compacted).toBe(false)
		expect(result.currentWorkingContextEstimate).toBeUndefined()
	})
})
