/**
 * ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON02 — P1 RESULT_PUBLICATION_TO_SESSION_EVENT
 *
 * Single production-seam discriminator at the [1] -> [3] boundary:
 *   command_output-shaped RESULT_EXISTS message
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
 * The event is typed inline as `CoreSessionEvent` via a type-only import
 * from `@cline/core` — type-only imports are erased at compile time and
 * therefore do not trigger the vitest-stub alias + zod initialization
 * issue that affects runtime value imports. `status` is typed as `string`
 * in the SDK CoreSessionEvent status payload (a free-form literal field),
 * so any status string is type-valid.
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

import type { CoreSessionEvent } from "@cline/core"
import type { ClineMessage } from "@shared/ExtensionMessage"
import { MessageIdMinter } from "./message-id-minter"
import type { SessionEventListener } from "./sdk-message-coordinator"
import { SdkMessageCoordinator } from "./sdk-message-coordinator"
import { createTaskProxy } from "./task-proxy"

/**
 * command_output is the production-shaped ClineSay for post-result publication
 * on this seam — it is the existing typed value used by real producers to
 * represent tool/command output flowing through the message coordinator
 * (see ClineSay union at apps/vscode/src/shared/ExtensionMessage.ts:745).
 * `tool_result` is NOT a valid ClineSay — it is only a model/tool content
 * vocabulary term.
 */
const sampleResultMessage = (ts: number): ClineMessage => ({
	ts,
	type: "say",
	say: "command_output",
	text: "synthetic stdout for probe; not a real tool invocation",
	partial: false,
})

const requireSeq = (message: ClineMessage): number => {
	if (message.seq === undefined) {
		throw new Error("SdkMessageCoordinator did not stamp seq on a RESULT_EXISTS message")
	}
	return message.seq
}

describe("P1_RESULT_PUBLICATION_TO_SESSION_EVENT", () => {
	it("command_output-shaped RESULT_EXISTS message -> semantic identity persists across append + fanout", () => {
		const task = createTaskProxy("session-123", () => Promise.resolve(), () => Promise.resolve())
		const minter = new MessageIdMinter()
		const coord = new SdkMessageCoordinator({ getTask: () => task, getMinter: () => minter })
		// Type the listener with the real SessionEventListener callback signature so
		// `listener.mock.calls[0]` is typed as the actual 2-tuple of arguments
		// (`[ClineMessage[], CoreSessionEvent]`) instead of an inferred `[]` from
		// the zero-argument `mock(() => undefined)` pattern. Bun's `mock<T>(...)`
		// generic propagates `Parameters<T>` to `MockInstance<T>.calls`, and the
		// inline parameter types ensure the implementation also satisfies the
		// real `onSessionEvent` callback contract at construction time (no `as any`
		// cast on `mock.calls` is needed downstream).
		const listener = mock<SessionEventListener>((messages: ClineMessage[], event: CoreSessionEvent) => {
			void messages
			void event
		})
		coord.onSessionEvent(listener)
		const event: CoreSessionEvent = {
			type: "status",
			payload: { sessionId: "session-123", status: "running" },
		}
		const first = [sampleResultMessage(1)]
		const second = [sampleResultMessage(2)]

		coord.appendAndEmit(first, event)
		coord.appendAndEmit(second, event)

		// (1) command_output-shaped RESULT_EXISTS message is present in the
		// in-memory conversation (semantic)
		const stored = task.messageStateHandler.getClineMessages()
		expect(stored).to.have.lengthOf(2)
		expect(stored[0]).to.deep.include({
			ts: 1,
			type: "say",
			say: "command_output",
			text: first[0].text,
			partial: false,
			epoch: minter.epoch,
		})
		expect(stored[1]).to.deep.include({
			ts: 2,
			type: "say",
			say: "command_output",
			text: second[0].text,
			partial: false,
			epoch: minter.epoch,
		})

		// (2) session event reaches the production listener with semantic identity intact
		expect(listener.mock.calls).to.have.lengthOf(2)
		const [listenerFirst, listenerEvent] = listener.mock.calls[0]
		expect(listenerFirst).to.have.lengthOf(1)
		expect(listenerFirst[0]).to.deep.include({
			say: "command_output",
			text: first[0].text,
			seq: first[0].seq,
			epoch: first[0].epoch,
		})
		expect(listenerEvent).to.deep.equal(event)

		// (3) seq/epoch conserved at the seam — narrow explicitly so the
		// numeric comparison is provably on stamped values, not undefined.
		const firstSeq = requireSeq(first[0])
		const secondSeq = requireSeq(second[0])
		expect(firstSeq).to.be.greaterThan(0)
		expect(secondSeq).to.be.greaterThan(firstSeq)
		expect(first[0].epoch).to.equal(minter.epoch)
		expect(second[0].epoch).to.equal(minter.epoch)

		// (4) appendAndEmit is synchronous + bounded; no awaitable leaks
		expect(() => coord.appendAndEmit([sampleResultMessage(3)], event)).to.not.throw()
		expect(listener.mock.calls).to.have.lengthOf(3)
	})
})
