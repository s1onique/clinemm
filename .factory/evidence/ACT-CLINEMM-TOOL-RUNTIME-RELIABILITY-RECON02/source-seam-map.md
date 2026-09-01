# ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON02 — §1 Source-Seam Map

> Scope: inventory of the production seams between `RESULT_EXISTS`
> (frozen entry seam) and `UI projection`, the existing tests and
> diagnostic capture surfaces at each boundary, and the gaps that
> a §2 probe would need to close.
>
> This file is the **inventory step** required before any probe is
> authored. Per the ACT's REAL_PRODUCTION_SEAM admissibility rule,
> no probe is admissible unless it drives the real coordinator /
> function / module listed below end-to-end. Source extraction,
> copied orchestration, or new `Function()` reimplementations are
## Chain (frozen at `RESULT_EXISTS`)

```text
RESULT_EXISTS                                    ← frozen entry seam
  ↓
[1] result publication        → SdkMessageCoordinator.appendAndEmit
                                (apps/vscode/src/sdk/sdk-message-coordinator.ts:99-104)
  ↓
[2] conversation append        → SdkMessageCoordinator.appendMessages
                                + saveClineMessagesTimer debounce
                                (sdk-message-coordinator.ts:74-97)
  ↓
[3] session-event emission     → SdkMessageCoordinator.emitSessionEvents
                                (sdk-message-coordinator.ts:64-72)
                                listeners: SdkController.onSessionEvent
                                (SdkController.ts:2287)
  ↓
[4] webview bridge             → pushMessageToWebview +
                                emitHookMessage (SdkController.ts:926)
  ↓
[5] continuation scheduling    → SdkFollowupCoordinator
                                (apps/vscode/src/sdk/sdk-followup-coordinator.ts:90)
                                + SdkCompactionCoordinator
                                (apps/vscode/src/sdk/sdk-compaction-coordinator.ts:144)
                                [OUT-OF-SCOPE: runtime-task-progression]
  ↓
[6] TurnState transition       → TurnStateTracker.setWithWriter /
                                publishTurn / commitTurn
                                (apps/vscode/src/sdk/turn-state-tracker.ts:22)
                                taskId / epoch stamping (line 91)
                                [PARALLEL to BACKGROUND-HANDOFF-DISCRIMINATOR01]
  ↓
[7] provider / model response  → attemptApiRequest path in SDK adapter
                                [OUT-OF-SCOPE: provider epic]
  ↓
[8] UI projection              → SdkController.getStateToPostToWebview
                                + activity-publication-v1.ts builder
                                (apps/vscode/src/sdk/activity-publication-v1.ts)
                                task-state-shadow-arbiter-mapper
                                (apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts)
```
> SYNTHETIC_REAL at best and cannot satisfy RED.
>
> HEAD: `a90f36a4b501a3c47c43b4df8d8c1c79e7e5d3a4` (= `origin/main`
## Boundary inventory

### [1]+[2]+[3] — `SdkMessageCoordinator`

- **Class:** `apps/vscode/src/sdk/sdk-message-coordinator.ts:20`
- **Public methods:**
  - `appendMessages(messages)` — line 74 (stamps seq/epoch, stores)
  - `appendAndEmit(messages, event)` — line 99 (calls append + emit)
  - `emitSessionEvents(messages, event)` — line 64
  - `onSessionEvent(listener)` — line 57
  - `cancelPendingSave()` — line 50 (clears saveClineMessagesTimer)
- **Internal state:**
  - `saveClineMessagesTimer` (line 22) — debounced save-to-disk
  - `sessionEventListeners` (line 21) — fan-out Set
- **Existing tests:**
  - `apps/vscode/src/sdk/sdk-message-coordinator.test.ts` — unit
  - `apps/vscode/src/sdk/__tests__/runtime-followup-resume-subscription-parity.frsp01.test.ts`
  - `apps/vscode/src/sdk/__tests__/runtime-followup-resume-subscription-parity.frsp01-correction01.test.ts`
  - `apps/vscode/src/sdk/__tests__/task-control-liveness.*` (6 files)
- **Diagnostic surfaces:**
  - `MessageIdMinter` (`./message-id-minter.ts`) — stamps seq + epoch
  - `Logger` (`@/shared/services/Logger`) — error logging in
    `emitSessionEvents` line 67
- **Gap analysis:** The unit test (`sdk-message-coordinator.test.ts`)
  exercises `appendMessages` / `emitSessionEvents` directly. None of
  the existing tests asserts what happens when `appendMessages` is
  called with a `command_output`-shaped RESULT_EXISTS message AND the
  subsequent continuation does not schedule. **No RED reachable at this
  layer on its own** — it requires the [5]+[6] boundary to participate.

### [4] — `webview-grpc-bridge`

- **Class:** `apps/vscode/src/sdk/webview-grpc-bridge.ts` (referenced
  via `pushMessageToWebview` import at sdk-message-coordinator.ts:5)
- **Existing tests:** none directly visible; covered indirectly via
  `activity-publication-v1.test.ts` for the publish-side path.
- **Gap analysis:** The bridge is downstream of the coordinator; it
  cannot become a RED source by itself (no causal origin there).

### [5] — `SdkFollowupCoordinator` / `SdkCompactionCoordinator`

- **Out-of-scope** per the ACT's OUT list — these belong to the
  `runtime-task-progression` epic. Cross-referenced here so a future
  ACT knows where to look if the broken boundary is here.
- **Diagnostic surfaces:**
  - `SdkFollowupCoordinator` (line 90) — `cancel()` /
    `schedule-followup` paths
  - `SdkCompactionCoordinator` (line 144) — `turn-phase-authority`
    boundary; existing test at
    `sdk-compaction-coordinator.turn-phase-authority.test.ts`
- **Gap analysis:** No RECON02 probe can sit at this layer; if the
  stuck boundary lives here, RECON02 returns classification
  `OUT_OF_SCOPE_RUNTIME_TASK_PROGRESSION` and STOPS.

### [6] — `TurnStateTracker`

- **Class:** `apps/vscode/src/sdk/turn-state-tracker.ts:22`
- **Public methods:**
  - `setWithWriter(phase, ts, writerIdentity)` — called from
    `SdkController.ts:2440, 2505` and other emit paths
  - `publishTurn` / `commitTurn` (referenced in
    `ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01`
    capture protocol)
- **Imports:** `@shared/turn-state-writer-provenance`
- **Existing tests:** covered indirectly via
  `background-handoff-turnstate-discriminator.bhtd01-synthetic-real.test.ts`
- **Diagnostic surfaces:**
  - TSWPD (TurnState Writer Provenance Discriminator) — captures
    writer + previous.phase + committed.phase + taskId + epoch
  - `host-ownership-diagnostic-runtime.ts` — mirrors TSWPD context
- **Gap analysis:** TSWPD is READY (synthetic-real PASS in the
  parallel ACT); live bind requires operator + live VSCode host.
  RECON02 can run a unit-level probe that drives `setWithWriter`
  + downstream listeners with a `RESULT_EXISTS`-tagged transition
  to see if the listener fires, without the LIVE bind.

### [7] — provider / model response

- **Out-of-scope** per the ACT's OUT list — belongs to provider
  epic. Cross-referenced only.

### [8] — UI projection

- **Module:** `apps/vscode/src/sdk/activity-publication-v1.ts`
- **Class / builder:** discriminated union over `kind === "emit"`
- **Existing tests:** `activity-publication-v1-capture.test.ts`
- **Diagnostic surfaces:**
  - `task-state-shadow-arbiter-mapper.ts` — three-source selector
    (frozen by ELM-02F-CORRECTION01)
  - `task-state-shadow-recorder.ts` — shadow snapshot
- **Gap analysis:** Builder is testable in isolation. The
  `snapshot.stateVersion` + `shadowPublicationBinding` discipline
  is the right place to assert whether a UI projection is missing
  (CASE_G). Existing test covers the capture shape; a RECON02
  probe could assert the "stuck-on-Thinking" projection shape, but
  only with a real snapshot+shadow pair (REAL_PRODUCTION_SEAM
  rule honored).
> at ACT opening).
## Cross-class coverage of the post-tool advance chain

| Boundary | Real production seam | Existing test                          | Coverage of post-tool advance |
|----------|----------------------|----------------------------------------|-------------------------------|
| [1]+[2]  | `appendMessages`     | `sdk-message-coordinator.test.ts`      | Direct unit                   |
| [3]      | `emitSessionEvents`  | `sdk-message-coordinator.test.ts`      | Direct unit                   |
| [4]      | `pushMessageToWebview` | indirect via publication tests        | Indirect                      |
| [5]      | `SdkFollowupCoordinator` / `SdkCompactionCoordinator` | `sdk-compaction-coordinator.turn-phase-authority.test.ts` | Out-of-scope (RTP) |
| [6]      | `TurnStateTracker.setWithWriter` | via BHTD01 synthetic-real | Indirect; live bind DEFERRED |
| [7]      | `attemptApiRequest`  | provider-specific                      | Out-of-scope                  |
| [8]      | `activity-publication-v1` builder | `activity-publication-v1-capture.test.ts` | Builder-only |

**Gaps visible at this inventory step (before any probe is authored):**

1. **No end-to-end production-seam test asserts the [1]→[3]
   property:** "given a real RESULT_EXISTS-shaped message arrives
   at the real `SdkMessageCoordinator.appendMessages`, the real
   session-event listener receives the result with **semantic
   identity conserved** (same `say` / `text` / `seq` / `epoch`)
   and the fanout invocation is bounded." The existing unit
   test `sdk-message-coordinator.test.ts` exercises `appendMessages`
   and `onSessionEvent` separately but never couples them on a
   tool-result-shaped message at the production seam, and it
   asserts JavaScript reference identity, which is an
   implementation detail and not the contract. The closest
   cross-boundary coverage is BHTD01's synthetic-real test, which
   uses a synthetic `tool` completion (not the real
   `RESULT_EXISTS`-shaped message flow).
2. **No test asserts that `appendAndEmit` with a `RESULT_EXISTS`
   message triggers downstream listeners' "tool processed" branch.**
   `runtime-followup-resume-subscription-parity.frsp01.test.ts`
   covers the resume path but not the post-result advance.
3. **DEFERRED — debounce is structural, not causal (see below).**

Gap 1 is the only gap that names a causal candidate for
post-RESULT_EXISTS advance at this boundary. Gap 2 is a different
shape (it tests the resume path, not the post-result advance).
Gap 3 is demoted below.

These gaps are candidates for §2 probes. Each must satisfy
the REAL_PRODUCTION_SEAM rule: drive the real coordinator end-to-end,
adapters for external dependencies only.
## Probe candidates — single production-seam discriminator

The earlier A–F plan has been retired. RECON02 freezes its
epistemic boundary at `RESULT_EXISTS`; the foreground execution
path that A–D drove was already closed by RECON01 as
`NOT_REPRODUCED` and is out of RECON02's owned territory.

The real first discriminating question is:

```text
Given a real RESULT_EXISTS-shaped message arriving at the real
SdkMessageCoordinator, does the production append + session-event
fanout reach the real registered listener with **semantic
identity conserved** (same say / text / seq / epoch as the
appended message) and the invocation bounded?
```

This is the boundary RECON02 owns. It is the only boundary inside
the frozen entry seam where the failure family "result exists, no
next model/runtime advance" can be discriminated against the
production code without crossing into runtime-task-progression.

### The single probe — `P1_RESULT_PUBLICATION_TO_SESSION_EVENT`

```text
REAL_PRODUCTION_SEAM:
  SdkMessageCoordinator  (apps/vscode/src/sdk/sdk-message-coordinator.ts:20)
  TaskProxy               (apps/vscode/src/sdk/task-proxy.ts)
  MessageIdMinter         (apps/vscode/src/sdk/message-id-minter.ts)
  pushMessageToWebview    (vi.mock — natural external seam)

INPUT (real shape, NOT a structural probe):
  one ClineMessage shaped like a command_output publication:
    ts: monotonically increasing
    type: "say"
    say: "command_output"  // production-shaped ClineSay for tool/command
                            // stdout publication (the value the real
                            // producers use on this seam). `tool_result`
                            // is NOT a valid ClineSay — only a model/tool
                            // content vocabulary term.
    text: a small synthetic stdout
    partial: false

FLOW (real path):
  appendAndEmit(messages, event)
    → appendMessages(messages)            [stamps seq/epoch]
    → emitSessionEvents(messages, event)  [fan-out to listeners]

ASSERTIONS (no event-count oracle, no TurnState premise):
  1. after appendAndEmit returns, `getClineMessages()` contains
     two messages whose semantic fields (ts / type / say / text /
     partial / epoch) match the inputs — reference-identity is
     NOT asserted (a correct implementation may defensively clone
     while preserving every semantic field)
  2. `onSessionEvent` was called once per `appendAndEmit` and the
     listener received an array whose single element carries the
     same `say` / `text` / `seq` / `epoch` as the message
     appended; the session event passed to the listener equals
     the event passed to `appendAndEmit`
  3. `seq` is positive and strictly monotonic across the two
     `appendAndEmit` calls; `epoch` equals `minter.epoch` for
     both
  4. `appendAndEmit` is synchronous and bounded — its call
     returns without throwing and the listener count advances
     before the call returns; no `setImmediate` budget is
     required

(`ClineMessage` does not expose a `taskId` field; `taskId` lives
on the `TaskProxy` and is NOT asserted on the published message.
This correction removes the prior "taskId === session-123" claim,
which was a fossil.)

DISPOSITION:
  RED  → boundary is B or C territory inside RECON02 ONLY if the
         failure is causal (semantic information loss or event
         non-delivery); non-causal failures are classified
         CAPTURE_INSUFFICIENT
         → if causal, ROOT_CAUSE_ISOLATED at this boundary;
           child BOUNDED REPAIR ACT authorized in a follow-on ACT
         → if not causal, CAPTURE_INSUFFICIENT;
           follow-on ACT required
  GREEN → [1]→[3] is conserved at the production seam;
         FIRST_UNTESTED_BOUNDARY = continuation scheduling
                                   ([5] in this map)
         OWNER                  = runtime-task-progression epic
         RECON02 disposition    =
           NOT_REPRODUCED_WITHIN_OWNED_BOUNDARY
         HANDOFF               = RUNTIME_TASK_PROGRESSION
         STOP                  = yes (no A–F follow-ons)

SIZE BUDGET: ~50 lines including imports + assertions.
```

### What this probe does NOT assert

- It does NOT count `setWithWriter` invocations. Writer cardinality
  is implementation bookkeeping; a correct runtime may legitimately
  emit more or fewer TurnState writes while preserving behavior.
  Asserting N+1 writes creates a compatibility fossil.
- It does NOT require a TurnState transition out of an
  `awaiting-tool` phase. TurnState represents turn/model liveness,
  not every subordinate process lifecycle (per the
  background-handoff work). It is a discriminator AFTER a stuck
  state exists, not the success oracle for every tool result.
- It does NOT drive `SdkForegroundCommandCoordinator` or any
  pre-RESULT_EXISTS path. That is RECON01's closed territory.
- It does NOT touch the `saveClineMessagesTimer` debounce as a
  causal candidate (Gap 3 demoted — see below).

## Gap 3 demoted (debounce is not currently causal)

Gap 3 ("the `saveClineMessagesTimer` debounce may never fire for
a `RESULT_EXISTS` message") is **NOT a causal candidate for
post-RESULT_EXISTS advance**.

```text
SAVE_DEBOUNCE =
  STRUCTURAL / PERSISTENCE PATH
  NOT CURRENTLY CAUSAL FOR POST_RESULT_ADVANCE
```

The reason: `appendAndEmit` performs `append → emit` synchronously;
the debounce timer is persistence-to-disk bookkeeping, separate
from the in-memory advance path. Unless executable evidence later
connects continuation to persistence (e.g. a producer of
`continuationReady` actually awaits the disk save), a failed
debounce cannot explain "result exists in memory but no next
model/runtime advance."

If a future diagnostic establishes such a connection (via a TSWPD
capture or a live PTAD record), it is admissible as a fresh
RECON02 discriminator; until then Gap 3 is structurally adjacent
and not causal.

## Existing diagnostics that already cover some of this chain

- `apps/vscode/src/sdk/turn-state-tracker.ts` (TSWPD) — captures
  writer + previous.phase + committed.phase + taskId + epoch
  transitions. Live bind DEFERRED to BHTD01 operator cycle.
- `apps/vscode/src/sdk/host-ownership-diagnostic-runtime.ts` —
  runtime-state diagnostic, mirrors TSWPD context shape.
- `apps/vscode/src/sdk/task-telemetry-tracker.ts` — task elapsed
  time tracker with frozen `endedAt` discipline.
- `apps/vscode/src/services/telemetry/TelemetryService.ts:1331` —
## §1 conclusions (revised after A-F retraction)

The post-tool advance chain from `RESULT_EXISTS` to `UI projection`
is NOT covered by any single end-to-end production-seam probe at
the [1]→[3] boundary. The §2 work is **a single** production-seam
discriminator (`P1_RESULT_PUBLICATION_TO_SESSION_EVENT`) and is
limited to ≤50 lines including imports + assertions.

The useful invariant is **not** "result arrives → TurnState
transitions out of awaiting-tool". The useful question is:

```text
Did the production continuation path receive enough state to
advance?
```

The first step at which that question can be asked inside RECON02
is at `[1]→[3]` (RESULT_EXISTS → appendAndEmit → listener).
Anything past `[3]` is downstream of session-event fanout and is
either the runtime-task-progression epic (`[5]`, `[6]`) or
provider (`[7]`) or UI (`[8]`) — none of which is owned by
RECON02.

If `P1` GREENs, RECON02 closes with
`NOT_REPRODUCED_WITHIN_OWNED_BOUNDARY /
HANDOFF_RUNTIME_TASK_PROGRESSION` and STOPS. No follow-on probes
are written speculatively; the next ACT (if any) lives at the
runtime-task-progression epic and is not pre-authorized here.

If `P1` REDs, the boundary is B or C territory inside RECON02's
owned range. A child BOUNDED REPAIR ACT is then authorized at the
classification, NOT pre-authorized here.

## Inventory metadata

```text
HEAD: a90f36a4b501a3c47c43b4df8d8c1c79e7e5d3a4
file: .factory/evidence/ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON02/source-seam-map.md
inventory author: ACT opening (this turn, with A-F plan retracted
  in the same turn per reviewer P1 corrections)
next step: §2 single-probe discriminator
  (probe-result-publication-to-session-event.md, ≤50 lines,
   REAL_PRODUCTION_SEAM)
parallel front: ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01
  (operator-gated; NOT blocking RECON02)
```