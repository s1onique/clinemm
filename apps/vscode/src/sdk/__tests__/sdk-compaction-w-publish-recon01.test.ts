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
		},
	}
}

describe("RECON01 R1: compactSessionMessages surfaces W from the producer seam", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("returns currentWorkingContextEstimate as a number on success (green)", async () => {
		const W_POST = 29_600
		mockCreateContextCompactionPrepareTurn.mockReturnValue(() =>
			Promise.resolve({
				messages: buildMessages(20),
				systemPrompt: "system",
				currentWorkingContextEstimate: W_POST,
			}),
		)
		const result = await compactSessionMessages(makeBaseInput(buildMessages(60)))
		expect(result.compacted).toBe(true)
		expect(result.currentWorkingContextEstimate).toBe(W_POST)
	})

	it("returns currentWorkingContextEstimate undefined when the producer returned no W (legacy path)", async () => {
		mockCreateContextCompactionPrepareTurn.mockReturnValue(() =>
			Promise.resolve({
				messages: buildMessages(20),
				systemPrompt: "system",
				// NO currentWorkingContextEstimate
			}),
		)
		const result = await compactSessionMessages(makeBaseInput(buildMessages(60)))
		expect(result.compacted).toBe(true)
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

	it("W value is the producer number verbatim — no recompute, no transform", async () => {
		const W_POST = 42
		mockCreateContextCompactionPrepareTurn.mockReturnValue(() =>
			Promise.resolve({
				messages: buildMessages(20),
				systemPrompt: "system",
				currentWorkingContextEstimate: W_POST,
			}),
		)
		const result = await compactSessionMessages(makeBaseInput(buildMessages(60)))
		expect(result.currentWorkingContextEstimate).toBe(W_POST)
		// The carrier assignment carries the same value with no
		// estimator recompute.
		const capture = new WorkingContextHostCapture()
		if (typeof result.currentWorkingContextEstimate === "number") {
			capture.setLatest(result.currentWorkingContextEstimate)
		}
		expect(capture.currentWorkingContextEstimate).toBe(W_POST)
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
