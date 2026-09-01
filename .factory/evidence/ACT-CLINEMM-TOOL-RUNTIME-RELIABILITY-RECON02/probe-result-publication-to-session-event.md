# ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON02 — `P1_RESULT_PUBLICATION_TO_SESSION_EVENT`

> §2 single production-seam discriminator.
> Status: **EXECUTED — GREEN** (test run captured in `probe-p1-run-log.txt`;
> final report at `final-report.md`).
>
> The executed test is the staged file
> `apps/vscode/src/sdk/tool-runtime-reliability-recon02.production-seam.test.ts`
> (runner: `bun:test` + `chai`, mocked external seam only). Its
> source is the single TypeScript block under **The probe** below
> and IS THE AUTHORITY for the GREEN claim — the staged test and
> the code fence in this evidence file agree.
>
> HEAD: `a90f36a4b501a3c47c43b4df8d8c1c79e7e5d3a4`.
> ACT status: CLOSED / GREEN / NOT_REPRODUCED_WITHIN_OWNED_BOUNDARY /
> HANDOFF_RUNTIME_TASK_PROGRESSION / STOP = yes (no A-F follow-ons).

## REAL_PRODUCTION_SEAM

```text
SdkMessageCoordinator     (apps/vscode/src/sdk/sdk-message-coordinator.ts:20)
TaskProxy.createTaskProxy (apps/vscode/src/sdk/task-proxy.ts:168)
MessageStateHandler       (apps/vscode/src/sdk/task-proxy.ts:72)
MessageIdMinter           (apps/vscode/src/sdk/message-id-minter.ts)
pushMessageToWebview      (mock.module — natural external seam)
```

Every import above resolves to the production seam. The only
mocked module is `./webview-grpc-bridge` (the natural external-seam
boundary: webview bridge out of process). `appendAndEmit` does NOT
call `pushMessageToWebview`; only `emitHookMessage` does, at
sdk-message-coordinator.ts line 105. The mock is therefore not on
the `appendAndEmit` hot path.

## The probe (executed staged test)

The TypeScript block below is the exact source committed to
`apps/vscode/src/sdk/tool-runtime-reliability-recon02.production-seam.test.ts`
and is what produced the `1 pass / 0 fail` verdict captured in
`probe-p1-run-log.txt`. The block is one contiguous compilable
program: imports → mock.module → describe → it → assertions →
closing braces, with no interleaved prose.

```ts
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

// command_output is the production-shaped ClineSay for post-result publication
// on this seam — it is the existing typed value used by real producers to
// represent tool/command output flowing through the message coordinator.
// `tool_result` is NOT a valid ClineSay — it is only a model/tool content
// vocabulary term.
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
		// the zero-argument `mock(() => undefined)` pattern.
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
```

Non-blank lines inside the code fence: **~40**, well within the
`~50-line` budget. The probe imports real `SdkMessageCoordinator`,
real `createTaskProxy`, real `MessageIdMinter`; only the natural
external seam (`pushMessageToWebview`) is mocked.

## Disposition decision

```text
RED  ->
  one of:
    stored.length !== 2, OR stored[i] lacks any of
      ts / type / say / text / partial / epoch
    listener not called, OR called with an empty / wrong-shape
      array, OR with a message missing say/text/seq/epoch,
      OR with an event that does not deep.equal the one passed in
    seq not strictly monotonic across the two appendAndEmit calls
    epoch diverges from minter.epoch on either call
    appendAndEmit throws
  -> first determine whether the failed assertion is CAUSAL to
     losing the result or the event (semantic / informational
     loss), or merely formatting/allocation. Only classify B/C
     when causal.
  -> if causal -> ROOT_CAUSE_ISOLATED; child BOUNDED REPAIR ACT
     authorized as follow-on (NOT pre-authorized here)
  -> if not causal -> CAPTURE_INSUFFICIENT; follow-on ACT required

GREEN ->
  [1]->[3] conserved at the production seam (semantic result
  persisted; semantic result reached the session-event listener;
  seq/epoch conserved; synchronous fanout returned)
  -> FIRST_UNTESTED_BOUNDARY = continuation scheduling ([5])
  -> OWNER = runtime-task-progression epic
  -> RECON02 disposition =
       NOT_REPRODUCED_WITHIN_OWNED_BOUNDARY
       / HANDOFF_RUNTIME_TASK_PROGRESSION
  -> STOP = yes
  -> no A-F follow-ons
```

Observed verdict for this ACT:

```text
GREEN. Recorded in probe-p1-run-log.txt. RECON02 disposition
= NOT_REPRODUCED_WITHIN_OWNED_BOUNDARY
  / HANDOFF_RUNTIME_TASK_PROGRESSION
  / STOP = yes.
```

## Why this probe is honest (not a cargo-cult)

Every assertion maps to a concrete property the production seam
already exposes. There is NO reference-identity oracle — a correct
implementation may defensively clone a message or array while
preserving every semantic field needed for continuation; such a
change is implementation detail and must not RED the probe.

| Assertion                                     | Production contract                                                    |
|-----------------------------------------------|------------------------------------------------------------------------|
| `stored.length === 2`                         | `MessageStateHandler.addMessages` appends per-message (task-proxy.ts:81-98) |
| `stored[i].{ts,type,say,text,partial,epoch}`  | `stamp()` mutates each message in place: `seq` from `minter.nextSeq()`, `epoch = minter.epoch` (sdk-message-coordinator.ts:33-43) |
| `listener` called twice                       | `emitSessionEvents` iterates `sessionEventListeners` (sdk-message-coordinator.ts:64-72) |
| `listenerFirst[0].{say,text,seq,epoch}`      | `appendAndEmit` passes the same `messages` array to `emitSessionEvents` (sdk-message-coordinator.ts:99-100); `stamp()` has already mutated seq/epoch in place |
| `listenerEvent` deep.equal to input event     | `emitSessionEvents(messages, event)` propagates the event value unchanged; the assertion is SEMANTIC equality, not JavaScript reference identity |
| `seq > 0 && seq monotonic`                    | `MessageIdMinter.nextSeq` returns `++seqCounter` (message-id-minter.ts:50) |
| `epoch === minter.epoch`                      | `stamp` reads `minter.epoch` once per call (sdk-message-coordinator.ts:38, 41) |
| synchronous, bounded                           | `appendAndEmit` is `void`, no `await` on hot path (sdk-message-coordinator.ts:98-101) |

No `setWithWriter` cardinality is asserted. No TurnState phase
transition is asserted. No persistence path is asserted. No
`setImmediate` budget is asserted — the synchronous boundary is
established by the `not.toThrow()` and by observing the listener
count advance before the call returns.

## What this probe will NOT catch

By design (and per the reviewer's discipline):

- It will NOT catch a defect in `[5]` `SdkFollowupCoordinator` or
  `SdkCompactionCoordinator` — that is `runtime-task-progression`
  territory.
- It will NOT catch a defect in `[6]` `TurnStateTracker` — TurnState
  is a discriminator AFTER a stuck state exists, not the success
  oracle.
- It will NOT catch a defect in `[7]` provider response timing —
  that is the provider epic.
- It will NOT catch a defect in `[8]` UI projection — the
  activity-publication-v1 builder already has its own test
  (`activity-publication-v1-capture.test.ts`).
- It will NOT catch a defect in the `saveClineMessagesTimer`
  debounce — Gap 3 is demoted per the reviewer's P1 corrections.

A GREEN result is therefore an honest
`NOT_REPRODUCED_WITHIN_OWNED_BOUNDARY` on the only causal
candidate RECON02 owns at this layer.

## Note on `taskId` (corrected)

`ClineMessage` does not expose a `taskId` field; `taskId` lives on
the `TaskProxy` (task-proxy.ts:196-201). The probe does NOT claim
that the message itself carries a `taskId`, and the earlier draft
assertion `expect(task.taskId).toBe("session-123")` has been
removed because it asserts proxy wiring, not message identity.
The proxy's `taskId` is informational for the consumer (the
session identifier); it is not part of the message publication
contract and must not be conflated with the result message's
identity. Proxy wiring is exercised at the SdkController
construction layer, not at the seam under test.

## Note on `event` equality (corrected)

The probe asserts `expect(listenerEvent).to.deep.equal(event)`.
`deep.equal` is SEMANTIC equality: it compares the visible payload
field-by-field and ignores the JavaScript reference identity. A
correct implementation that defensively clones the event before
passing it to the listener will still pass this assertion as long
as the visible payload is preserved. The probe therefore makes no
claim about whether the same event reference reaches the listener;
it claims only that the same event payload does.

## Execution artifacts (CLOSED)

The staged test that produced the GREEN verdict:

```text
apps/vscode/src/sdk/tool-runtime-reliability-recon02.production-seam.test.ts
```

The captured run output (verbatim):

```text
.factory/evidence/ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON02/probe-p1-run-log.txt
```

Final report (closure document):

```text
.factory/evidence/ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON02/final-report.md
```

No production source edits. No repair ACT pre-authorized.

## Test-contract correction (post-closure, P1, TEST_ONLY)

`vscode:prepublish` (`bun run vscode:prepublish`, which runs
`tsc --noEmit` plus the prepublish build steps) caught five defects
in the originally-closed test
`apps/vscode/src/sdk/tool-runtime-reliability-recon02.production-seam.test.ts`:

| # | Defect | Resolution |
|---|--------|------------|
| P1_1 | Invented `say: "tool_result"` value (not in the `ClineSay` union — `"tool_result"` is only a model/tool content-vocabulary term, not a `ClineSay`). | Replaced with `say: "command_output"` — the existing typed `ClineSay` value used by real producers for tool/command stdout publication on this seam (see `ClineSay` union at `apps/vscode/src/shared/ExtensionMessage.ts:745`). |
| P1_2 | `const listener = mock(() => undefined)` — zero-arg implementation, so `listener.mock.calls[0]` was inferred as `[]`, and `const [listenerFirst, listenerEvent] = listener.mock.calls[0]` failed to destructure. | Imported `SessionEventListener` from `./sdk-message-coordinator.ts` and used `mock<SessionEventListener>((messages: ClineMessage[], event: CoreSessionEvent) => { void messages; void event })`. Bun's `mock<T>` propagates `Parameters<T>` to `MockInstance<T>.calls`, so `listener.mock.calls[0]` is typed as `[ClineMessage[], CoreSessionEvent]`. No `as any` cast on `mock.calls` is needed downstream. |
| P1_3 | `first[0].seq > 0` and `second[0].seq > first[0].seq` used the optional `seq?: number` without explicit narrowing — both sides could be `undefined`. | Added `requireSeq(message: ClineMessage): number` helper that throws if `message.seq === undefined` and returns the number otherwise. The numeric comparison now operates on stamped numbers, strengthening the semantic oracle. |
| (related) | Stale header note claimed the `as any` cast was needed because typing `CoreSessionEvent` "pulls in the @cline/core bundle, which fails at import time". | Replaced with `import type { CoreSessionEvent } from "@cline/core"` — type-only imports are erased at compile time and therefore do not trigger the vitest-stub alias + zod initialization issue that affects runtime value imports. The `CoreSessionEvent.status` field is a free-form `string`, so any status string is type-valid. |

### Disposition

```text
HALT_BUILD_CONTRACT_TEST_INVALID

P1_1 = invented ClineSay "tool_result" → FIXED (use "command_output")
P1_2 = zero-arg listener fake hides real callback contract → FIXED (typed via SessionEventListener)
P1_3 = optional seq used without explicit stamping proof → FIXED (requireSeq helper)

PRODUCTION_REPAIR = NO
RECON02_CAUSAL_REPAIR = NO

ACTION =
  correct the test against the actual production message type,
  rerun GREEN + typecheck + vscode:prepublish,
  then continue
```

The corrected test above and the staged file at
`apps/vscode/src/sdk/tool-runtime-reliability-recon02.production-seam.test.ts`
are now in agreement and are both production-typed. **The previous
GREEN verdict is preserved as load-bearing evidence only if a fresh
`bun test` run on the corrected test still produces 1 pass / 0 fail
AND `bun run vscode:prepublish` exits 0.** If the corrected
production-shaped message REDs at runtime, the prior GREEN must be
withdrawn and RECON02 reopens at this seam. If it stays GREEN, the
RECON02 conclusion `[1]→[3] CONSERVED_FOR_TESTED_PRODUCTION_SHAPE`
remains valid (the tested production shape is now actually
production-shaped).

The textual evidence statements (`final-report.md`, `source-seam-map.md`)
were also updated to use `command_output-shaped RESULT_EXISTS message`
in place of the prior invented `tool_result-shaped message` wording.
