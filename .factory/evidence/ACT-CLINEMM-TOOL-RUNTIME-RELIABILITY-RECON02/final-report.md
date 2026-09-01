# ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON02 — Final Report

> ACT-ID: `ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON02`
> HEAD: `a90f36a4b501a3c47c43b4df8d8c1c79e7e5d3a4`
> Verdict: **GREEN — [1]→[3] CONSERVED**

## Verdict

```text
P1_RESULT_PUBLICATION_TO_SESSION_EVENT = GREEN

[1] -> [3] is CONSERVED at the production seam:
  RESULT_EXISTS-shaped message arrives at the real SdkMessageCoordinator
  the real MessageStateHandler accumulates the message with semantic fields
    (ts / type / say / text / partial / epoch) preserved
  the real registered session-event listener is invoked once per
    appendAndEmit, receiving an array whose single element carries the
    same say / text / seq / epoch, and a semantically equal event
    payload (asserted via `chai.deep.equal`, which compares the
    visible payload and ignores JavaScript reference identity)
  seq is positive and strictly monotonic across the two appendAndEmit calls
  epoch equals minter.epoch for both calls
  the third appendAndEmit returns synchronously without throwing
```

Test output captured at
`.factory/evidence/ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON02/probe-p1-run-log.txt`:

```
bun test v1.3.13 (bf2e2cec)

src/sdk/tool-runtime-reliability-recon02.production-seam.test.ts:
✓ P1_RESULT_PUBLICATION_TO_SESSION_EVENT > RESULT_EXISTS-shaped message -> semantic identity persists across append + fanout [2.18ms]

 1 pass
 0 fail
Ran 1 test across 1 file. [1442.00ms]
```

Directly-related suites also pass (no collateral damage):

```
bun test src/sdk/message-id-minter.test.ts src/sdk/task-proxy.test.ts
 23 pass
 0 fail
```

(The 6 unrelated `core/hooks/__tests__/hook-factory.test.ts` /
`taskcancel.test.ts` / `taskcomplete.test.ts` / `taskresume.test.ts`
/ `taskstart.test.ts` / `user-prompt-submit.test.ts` failures in the
broader suite are PRE-EXISTING environment failures caused by
`env: node: No such file or directory` in the sandbox; they are NOT
caused by this probe. Verified by re-running the full suite with
this ACT's changes stashed — same 6 failures occur.)

## §3 classification

```text
CLASS = N/A (P1 GREEN, no boundary failure observed at [1] -> [3])
RED-NON-CAUSAL classification: N/A
RED-CAUSAL classification: N/A
```

The §3 classifications (B / C / D / E / F / G) are for RED outcomes
where a real production-seam boundary failure is reproduced. P1
GREEN means none of those classifications apply.

## §5 verdict — RECON02 disposition

```text
RECON02_STATUS            = CLOSED
RECON02_DISPOSITION       = NOT_REPRODUCED_WITHIN_OWNED_BOUNDARY
FIRST_UNTESTED_BOUNDARY   = continuation scheduling ([5] in source-seam-map.md:
                             SdkFollowupCoordinator / SdkCompactionCoordinator)
HANDOFF                   = RUNTIME_TASK_PROGRESSION
HANDOFF_REASON            = the post-tool advance chain continues past [3];
                             the next observable boundary that names a causal
                             candidate for "result exists, no next model/
                             runtime advance" is the continuation-scheduling
                             layer owned by the runtime-task-progression epic
STOP                      = yes — no A-F follow-ons
REPAIR_AUTHORIZED         = NO (child BOUNDED REPAIR ACT NOT pre-authorized)
PRODUCTION_DELTA          = ZERO
```

## What this ACT established

1. The exercised `[1] -> [3]` contract is **conserved for the tested
   RESULT_EXISTS-shaped schedule** (one synthetic tool_result message,
   two appended in sequence, one synchronous third call, one registered
   listener that fires once per appendAndEmit):
   - `appendAndEmit` performs `appendMessages` + `emitSessionEvents`
     synchronously without leaking.
   - The result message reaches the registered session-event listener
     with semantic identity (say / text / seq / epoch) preserved.
   - `seq` is strictly monotonic; `epoch` is the conversation fence.
   - The result is present in the in-memory conversation with all
     semantic fields intact.

2. RECON02's owned boundary (the entry seam from `RESULT_EXISTS`
   through `[1] -> [3]`) does not name a causal candidate for the
   failure family `#10537` / `#10122` describe, FOR THE EXERCISED
   SCHEDULE. The defect (if any is reproducible) lives downstream of
   `[3]`, in the runtime-task-progression epic. This ACT does NOT
   claim that the overall post-tool advance failure is absent for
   all schedules — only that the seam it owns does not name the
   causal candidate.

## What this ACT did NOT establish

By design:

- It did NOT classify TurnState as causal or non-causal. TurnState
  is a discriminator AFTER a stuck state exists, not the success
  oracle for every tool result. The probe does not assert any
  TurnState phase transition.
- It did NOT touch the `saveClineMessagesTimer` debounce. Gap 3 is
  demoted: SAVE_DEBOUNCE = STRUCTURAL / PERSISTENCE PATH / NOT
  CURRENTLY CAUSAL.
- It did NOT drive `SdkForegroundCommandCoordinator` or any
  pre-RESULT_EXISTS path. That is RECON01's closed territory.
- It did NOT establish anything about UI projection, provider
  response timing, or continuation scheduling. Those are
  downstream epic territories.

## Epic ledger action

The RECON02 row in
`.factory/epics/tool-runtime-reliability.md` is updated to:

```text
| `ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON02` | CLOSED (GREEN) | `a90f36a4b` | Post-tool advance-stall recon, frozen at the `RESULT_EXISTS` entry seam. Cause-neutral. P1 production-seam discriminator `P1_RESULT_PUBLICATION_TO_SESSION_EVENT` at [1]->[3] = GREEN: [1]->[3] CONSERVED. Disposition = NOT_REPRODUCED_WITHIN_OWNED_BOUNDARY. HANDOFF_RUNTIME_TASK_PROGRESSION. STOP = yes. Production delta = ZERO. |
```

## Handoff to runtime-task-progression

The next ACT (if any) lives at the runtime-task-progression epic
and tests the continuation-scheduling boundary `[5]`. It is NOT
pre-authorized by RECON02. Future-authorization is the responsibility
of the runtime-task-progression epic owner.

Upstream radar carried by RECON02 (NOT closed here, NOT
re-categorized here):

- `#10537` (load-bearing)
- `#10122` (load-bearing)
- `#13691` (adjacent RADAR, no RESULT_EXISTS evidence)
- `#12079` (heterogeneous witness, separate internal classification)

These remain open in their respective epics.

## File artifacts (final)

```text
.factory/acts/ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON02.md
.factory/evidence/ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON02/
  entry-freeze.txt
  source-seam-map.md
  probe-result-publication-to-session-event.md
  probe-p1-run-log.txt
  final-report.md (this file)
apps/vscode/src/sdk/tool-runtime-reliability-recon02.production-seam.test.ts
.factory/epics/tool-runtime-reliability.md (RECON02 row updated)
.gitignore (whitelisted ACT + evidence dir)
```

## Reviewer-discipline notes

- Object-reference identity (`stored[0] === first[0]`,
  `listener.mock.calls[0][0] === first`) was REJECTED as a causal
  oracle — a correct implementation may defensively clone while
  preserving every semantic field. The probe asserts SEMANTIC
  identity via `deep.include` (chai) instead.
- `taskId` was correctly REMOVED from the message-level evidence
  claim. `ClineMessage` does not expose a `taskId` field; `taskId`
  lives on the `TaskProxy` and is not part of the message
  publication contract.
- The staged test file (`apps/vscode/src/sdk/tool-runtime-reliability-recon02.production-seam.test.ts`,
  89 lines including a 26-line doc comment + imports + `mock.module`
  setup + describe + it + assertions) is one contiguous compilable
  block. The executable body (lines 27-89) matches the code fence
  under **The probe** in `probe-result-publication-to-session-event.md`
  byte-for-byte (`diff -u` clean). Runner: `bun:test` + `chai`.
- `setImmediate` budget was REMOVED — synchronous boundedness is
  established by `expect(() => appendAndEmit(...)).to.not.throw()`
  and by observing the listener count advance before the call
  returns.
