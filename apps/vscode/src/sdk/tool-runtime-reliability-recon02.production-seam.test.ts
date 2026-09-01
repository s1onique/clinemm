/**
 * ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON02 — P1 RESULT_PUBLICATION_TO_SESSION_EVENT
 *
 * Single production-seam discriminator at the [1] -> [3] boundary:
 *   RESULT_EXISTS-shaped message
 *   -> real SdkMessageCoordinator.appendAndEmit
 *   -> registered session-event listener receives the result
 *
 * with semantic identity (say / text / seq / epoch) conserved,
 * seq/epoch strictly monotonic, and the fanout synchronous + bounded.
 *
 * Source:
 *   .factory/evidence/ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON02/probe-result-publication-to-session-event.md
 *
 * Assertions are SEMANTIC, not reference-identity: a correct
 * implementation may defensively clone while preserving every
 * semantic field, and the probe must not RED on that change.
 *
 * The event is constructed inline and cast to any (following the
 * pattern of the existing sdk-message-coordinator.test.ts) because
 * typing it as CoreSessionEvent pulls in the @cline/core bundle,
 * which fails at import time (the vitest stub alias + zod
 * initialization issue documented in the §1 inventory).
 *
 * Uses bun:test + chai (the project's native test:unit runner).
 */
import { expect } from "chai"
import "should"
import { describe, it, mock } from "bun:test"

// Mock the natural external seam (webview bridge out of process).
// appendAndEmit does NOT call pushMessageToWebview; only
// emitHookMessage does. The mock is therefore off the hot path.
mock.module("./webview-grpc-bridge", () => ({
	pushMessageToWebview: mock(() => Promise.resolve()),
}))

import type { ClineMessage } from "@shared/ExtensionMessage"
import { MessageIdMinter } from "./message-id-minter"
import { SdkMessageCoordinator } from "./sdk-message-coordinator"
import { createTaskProxy } from "./task-proxy"

const sampleResultMessage = (ts: number): ClineMessage => ({
	ts,
	type: "say",
	say: "tool_result",
	text: "synthetic stdout for probe; not a real tool invocation",
	partial: false,
})

describe("P1_RESULT_PUBLICATION_TO_SESSION_EVENT", () => {
	it("RESULT_EXISTS-shaped message -> semantic identity persists across append + fanout", () => {
		const task = createTaskProxy("session-123", () => Promise.resolve(), () => Promise.resolve())
		const minter = new MessageIdMinter()
		const coord = new SdkMessageCoordinator({ getTask: () => task, getMinter: () => minter })
		const listener = mock(() => undefined)
		coord.onSessionEvent(listener)
		// biome-ignore lint/suspicious/noExplicitAny: test-only event shape
		const event = { type: "status", payload: { sessionId: "session-123", status: "tool_result" } } as any
		const first = [sampleResultMessage(1)]
		const second = [sampleResultMessage(2)]

		coord.appendAndEmit(first, event)
		coord.appendAndEmit(second, event)

		// (1) RESULT_EXISTS-shaped message is present in the in-memory conversation (semantic)
		const stored = task.messageStateHandler.getClineMessages()
		expect(stored).to.have.lengthOf(2)
		expect(stored[0]).to.deep.include({ ts: 1, type: "say", say: "tool_result", text: first[0].text, partial: false, epoch: minter.epoch })
		expect(stored[1]).to.deep.include({ ts: 2, type: "say", say: "tool_result", text: second[0].text, partial: false, epoch: minter.epoch })

		// (2) session event reaches the production listener with semantic identity intact
		expect(listener.mock.calls).to.have.lengthOf(2)
		const [listenerFirst, listenerEvent] = listener.mock.calls[0]
		expect(listenerFirst).to.have.lengthOf(1)
		expect(listenerFirst[0]).to.deep.include({ say: "tool_result", text: first[0].text, seq: first[0].seq, epoch: first[0].epoch })
		expect(listenerEvent).to.deep.equal(event)

		// (3) seq/epoch conserved at the seam
		expect(first[0].seq).to.be.greaterThan(0)
		expect(second[0].seq).to.be.greaterThan(first[0].seq)
		expect(first[0].epoch).to.equal(minter.epoch)
		expect(second[0].epoch).to.equal(minter.epoch)

		// (4) appendAndEmit is synchronous + bounded; no awaitable leaks
		expect(() => coord.appendAndEmit([sampleResultMessage(3)], event)).to.not.throw()
		expect(listener.mock.calls).to.have.lengthOf(3)
	})
})
