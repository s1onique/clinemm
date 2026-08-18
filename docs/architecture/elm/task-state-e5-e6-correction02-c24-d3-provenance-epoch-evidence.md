# C2.4-D3 — HUB/REMOTE PROVENANCE + EPOCH SAFETY EVIDENCE

> Decisive outcome: **SELECT C.** Hub/Remote provenance is KNOWN
> to be NOT_YET_QUALIFIED; D4 will freeze the E7 backend set.

```text
ACT_ID              = ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.4-D3
ENTRY_HEAD          = 88d0ec391 (C2.4-D2-FIXUP03)
DECISION_HEAD       = 421b27f18 (D3-C3 selection)
EVIDENCE_HEAD       = <this commit's tip>
D3-C1_HEAD          = ad8588e39 (D3 plan contract)
D3-C2_HEAD          = f5a9d963c (pre-repair witness matrix)
D3-C3_HEAD          = 421b27f18 (selection document)
D3-C7_HEAD          = <this commit>
PROTECTED_STASH     = 141372c52 (FORENSIC, do NOT pop)
D3_REPAIR_CLASS     = C
D3_VERDICT          = PASS_PROVENANCE_EPOCH_C2_4_D3_CLASS_C
D4_AUTHORIZED       = true
E7_AUTHORIZED       = false
```

## 1. Identity / predecessor SHAs

```text
D0 FIXUP01                  = CLOSED / PASS_RECON   (7650f1a71)
D1-HUB                      = CLOSED / PASS_REACH   (97e2ba7ee)
D1-REMOTE                   = CLOSED / PASS_REACH   (27d56708d)
D2                          = CLOSED                (3d14ccd5c)
D2-CORRECTION01             = CLOSED                (63bc24249)
D2-FIXUP02                  = CLOSED                (81a557b2b)
D2-FIXUP03                  = CLOSED                (88d0ec391)
D3-C1 plan contract         = CLOSED                (ad8588e39)
D3-C2 pre-repair witnesses  = CLOSED                (f5a9d963c)
D3-C3 selection document    = CLOSED                (421b27f18)
D3-C7 evidence doc          = CLOSED                (this commit)
```

## 2. D2 frozen pre-repair decoder (negative control)

```text
canonicalAvailable=false:
  translated                    = 8 EXACT (iteration_start x2,
                                content_start x2, content_end x2,
                                done x2)
  FALLBACK_APPLY                = 6 EXACT
  SUPPRESS_DUPLICATE            = 2 EXACT (cross-epoch
                                scopedEdgeKey collisions on
                                run-started and run-finished)
  DIAGNOSTIC_ONLY               = 0
  shadow_mutated                = true

canonicalAvailable=true:
  translated                    = 8 EXACT
  FALLBACK_APPLY                = 0
  DIAGNOSTIC_ONLY               = 8 EXACT
  shadow_mutated                = false
```

These counts are CONTROL observations. D3 did NOT modify them
or the D2 test file. The 6/2 split is the structural consequence
of `runId=undefined` on every reconstructed snapshot.

## 3. Candidate A/B/C evaluation

### A = REJECTED_NO_SOURCE_PROVENANCE

A1 fails: the producer-side projector at
`sdk/packages/core/src/hub/server/handlers/session-event-projector.ts:138-148`
emits `iteration.started` with only `{ iteration: agentEvent.iteration }`.
The upstream `agentEvent.conversationId` is STRIPPED. HubRuntimeHost
at the consumer side (lines 1604-1619) therefore has no
`conversationId` to preserve.

A2..A5 are paper-over because A1 is false.

To PASS A1, the producer-side projector would need to extract
`agentEvent.conversationId` and include it in the Hub envelope.
That is a cross-process protocol/schema change, which is OUTSIDE
the permitted D3 surface (D3 plan §5 HALT conditions: "protocol/
schema change across external compatibility boundary").

### B = REJECTED_TEMPORAL_AUTHORITY

B1 passes: `session.notice` carries `conversationId` on the
Hub envelope at
`sdk/packages/core/src/hub/runtime-host/hub-runtime-host.ts:1666-1672`,
provided by the producer-side projector at
`sdk/packages/core/src/hub/server/handlers/session-event-projector.ts:256-278`.

B2 fails decisively. The temporal authority test:

> "Does the proposed signal exist before the first epoch-sensitive
> reconstructed mutation, by production contract rather than test
> ordering?"

The Hub protocol's actual emission order (verified by the
D2-F1 scripted sequence and confirmed by the D3-W1..W8
witnesses) is:

```
run.started
iteration.started   ← FIRST EPOCH MUTATION (translates to run-started)
session.notice      ← notice arrives AFTER the first run-started
tool.started
tool.finished
run.completed
```

The translator's `activeRunId` is only set on `iteration_start`
(`task-state-shadow-observer.ts:168-170`):

```ts
if (agentEvent.type === "iteration_start") {
  this.activeRunId.value = (agentEvent.conversationId as string | undefined) ?? this.activeRunId.value
}
```

The upstream `agentEvent.conversationId` is `undefined` for
`iteration_start` (per A1). Therefore `activeRunId` stays
undefined on the first iteration_start of EVERY epoch. The
first `run-started` edge of every epoch is reconstructed with
`runId=undefined`.

`session.notice` arrives AFTER `iteration.started` by production
contract, not by test ordering. The producer emits notice as a
state-update event, not an epoch-defining event. There is no
production event that can seed `activeRunId` BEFORE the first
`iteration_start`.

A B-style repair would inherit this defect silently: the
"activeRunId is now seeded" claim would be true for the second
iteration_start of an epoch but false for the first. The
translator's stranded-terminal gate (lines 200-209) would still
be structurally dead for the first-epoch case.

B3..B8 are paper-over because B2 is false.

### C = SELECTED

C is the only viable outcome under the A/B feasibility gate.
C is NOT a failure of the ACT. C means: Hub/Remote provenance
identity is not authoritatively available at the time the
reconstructed translator needs it. D4 will freeze the E7
backend set; LOCAL_ONLY is a valid D4 disposition.

## 4. Pre-repair adversarial witness matrix (D3-W1..W8)

All 8 witnesses pass under the pre-repair Hub harness:

| Witness | Description | Translated | APPLY | SUPPRESS |
| ------- | ----------- | ---------- | ----- | -------- |
| D3-W1 | CURRENT RUN | 4 | 4 | 0 |
| D3-W2 | TWO RUNS SAME SESSION (D2-F1 control) | 8 | 6 | 2 |
| D3-W3 | LATE TERMINAL AFTER NEW RUN | 8 | 6 | 2 |
| D3-W4 | CONTINUATION WINDOW | 7 | 6 | 1 |
| D3-W5 | TASK RESET BOUNDARY | 8 | 6 | 2 |
| D3-W6 | CROSS-SESSION (control) | 8 | 4 | 0 |
| D3-W7 | RECOVERY MISSING RUN ID | 4 | 4 | 0 |
| D3-W8 | TERMINAL VARIANTS | 4 | 4 | 0 |

Pre-repair observation:

- D3-W2 IS the D2-F1 frozen control. The 6/2 split is the
  pre-repair empirical decoder.
- D3-W3, D3-W4, D3-W5 produce the SAME 6/2 (or 6/1) split as
  W2 under the pre-repair harness. The translator's stranded-
  terminal gate is structurally dead because both activeRunId
  and eventConvId are undefined.
- D3-W6 cross-session is a control: 8/4/0 because sessionId
  differs across the two epochs, so the run-started edges do
  NOT collide on scopedEdgeKey.
- D3-W7 recovery without conversationId produces 4/4/0
  (single epoch).
- D3-W8 terminal variants produce the same shape as W1.

These witnesses are NOT evidence that a repair is possible;
they are evidence that the pre-repair state is structurally
incapable of the first-iteration identity invariant.

## 5. Production delta (C selection)

```text
PRODUCTION_FILES_TOUCHED = 0
PRODUCTION_LOC_ADDED    = 0
PRODUCTION_LOC_REMOVED   = 0
REDUCER_SEMANTIC_DELTA   = 0
PUBLIC_API_DELTA         = 0
PROTOCOL_SCHEMA_DELTA    = 0
CONFIG_DELTA             = 0
TEST_INFRA_DELTA         = 0  (extended existing include list to
                                include the D3 test file in the
                                existing dedicated config)
```

D3 changes are: plan document, vitest config (include list),
new test file, selection document, evidence document. No
production code touched.

## 6. Post-repair results

N/A — C was selected. No production repair was implemented.
D3-C4, D3-C5, D3-C6 are NOT applicable.

## 7. Necessity probe

N/A — C was selected. No necessity probe is needed because no
repair was claimed.

## 8. Hub provenance matrix

| Axis | Local | Hub | Remote |
|------|-------|-----|--------|
| D3-P1 SESSION_ID_PROVENANCE | QUALIFIED | QUALIFIED | QUALIFIED |
| D3-P2 RUN_ID / CONVERSATION_ID_PROVENANCE | QUALIFIED | NOT_YET_QUALIFIED | NOT_YET_QUALIFIED |
| D3-P3 FIRST_ITERATION_START_IDENTITY | QUALIFIED | NOT_YET_QUALIFIED | NOT_YET_QUALIFIED |
| D3-P4 STALE_OLD_RUN_TERMINAL_SUPPRESSION | QUALIFIED | NOT_YET_QUALIFIED | NOT_YET_QUALIFIED |
| D3-P5 CONTINUATION_BEFORE_NEXT_RUN_START | QUALIFIED | NOT_YET_QUALIFIED | NOT_YET_QUALIFIED |
| D3-P6 TASK_RESET / NEW_TASK_EPOCH_BOUNDARY | QUALIFIED | NOT_YET_QUALIFIED | NOT_YET_QUALIFIED |
| D3-P7 RECOVERY_WITH_MISSING_RUN_PROVENANCE | QUALIFIED | PARTIALLY_QUALIFIED | PARTIALLY_QUALIFIED |

Per-axis evidence:

- D3-P1: Hub sessionId is preserved on every CoreSessionEvent
  envelope (verified at `hub-runtime-host.ts:1556`).
  Q: QUALIFIED for Hub and Remote.
- D3-P2: Hub's `iteration.started` strips `conversationId`.
  No source event arrives before the first iteration_start of
  every epoch with `conversationId` present. Q: NOT_YET_QUALIFIED.
- D3-P3: First iteration_start of every epoch has runId=undefined.
  Both `activeRunId` and the event's `conversationId` are undefined.
  The translator's stranded-terminal gate is structurally dead.
  Q: NOT_YET_QUALIFIED.
- D3-P4: Late terminal-from-A cannot structurally distinguish
  from current-epoch terminal. The translator's stranded-terminal
  gate is dead, so cross-epoch false-suppression is unobservable.
  Q: NOT_YET_QUALIFIED.
- D3-P5: Hub protocol has no `continueTask` envelope. The
  continuation boundary is implicit. Pre-repair cannot distinguish
  old-epoch terminal from new-epoch resume. Q: NOT_YET_QUALIFIED.
- D3-P6: Hub protocol has no task-reset envelope. The same
  sessionId is reused for both tasks; the translator's state
  has no concept of task boundary. Q: NOT_YET_QUALIFIED.
- D3-P7: Recovery notice with conversationId undefined
  cannot rescue the activeRunId tracker. Recovery produces
  4/4/0 (single epoch, no collision) — that is, the gate
  fires correctly for the single-epoch case but is irrelevant
  for the cross-epoch case. Q: PARTIALLY_QUALIFIED.

LOCAL is inherited from C2.4-C/C2.3 evidence (control; not
relitigated here).

## 9. Remote provenance matrix

```text
RemoteRuntimeHost extends HubRuntimeHost
  (verified by D1-REMOTE LR1: `instanceof HubRuntimeHost`).
RemoteRuntimeHost's constructor is the only override
  (verified by D1-REMOTE LR2..LR5: 27-line constructor-
  only subclass).
RemoteRuntimeHost.subscribe emits the same kind and
  count of CoreSessionEvent as HubRuntimeHost for the
  same scripted HubEventEnvelope sequence
  (verified by D1-REMOTE LR2).
RemoteRuntimeHost.subscribeRuntimeEvents is undefined
  (verified by D1-REMOTE LR3).
```

Therefore Remote inherits the Hub provenance matrix exactly:

```
D3-P1 REMOTE SESSION_ID_PROVENANCE            = QUALIFIED
D3-P2 REMOTE RUN_ID / CONVERSATION_ID_PROVENANCE = NOT_YET_QUALIFIED
D3-P3 REMOTE FIRST_ITERATION_START_IDENTITY   = NOT_YET_QUALIFIED
D3-P4 REMOTE STALE_OLD_RUN_TERMINAL_SUPPRESSION = NOT_YET_QUALIFIED
D3-P5 REMOTE CONTINUATION_BEFORE_NEXT_RUN_START = NOT_YET_QUALIFIED
D3-P6 REMOTE TASK_RESET / NEW_TASK_EPOCH_BOUNDARY = NOT_YET_QUALIFIED
D3-P7 REMOTE RECOVERY_WITH_MISSING_RUN_PROVENANCE = PARTIALLY_QUALIFIED
```

Derived backend status:

```text
HUB_TOTAL_PROVENANCE    = NOT_YET_QUALIFIED
REMOTE_TOTAL_PROVENANCE = NOT_YET_QUALIFIED
```

An active unsafe epoch mutation on an E7-required axis means
NOT_YET_QUALIFIED for that axis (no "basically qualified").

## 10. Local frozen control

Local is not re-qualified here. Its provenance matrix is
inherited from C2.4-C/C2.3:

```text
LOCAL_PROVENANCE = QUALIFIED (all 7 axes)
```

This is the control. D3 does not relitigate Local unless
production edits touch common translation logic. D3 made no
production edits, so the Local control is preserved as-is.

## 11. Typecheck / test / build results

```text
apps/vscode vitest (c2-4-d-hub config):
  2 files / 12 tests / 0 failed / 27ms
    D2 (D2-F1 + D2-T1 + D2-E1..E7 + D2-X1 + PORTABILITY) = 4 PASS
    D3 pre-repair witnesses (W1..W8)                    = 8 PASS

apps/vscode vitest (c2-4-c-bridge config):
  1 file / 5 tests / 0 failed / 62ms (no regression)

apps/vscode sdk D1-HUB reachability:
  1 test / PASS (re-verified via sdk/packages/core unit suite)

apps/vscode sdk D1-REMOTE reachability:
  1 test / PASS (re-verified via sdk/packages/core unit suite)

sdk/packages/core unit suite:
  172 files / 2105 tests / 0 failed / 14 skipped / 36.54s

check-types base:
  Requires bun run check-types. Not run in this CI step; would
  be checked as part of the broader regression sweep. (See the
  Phase 9 step in the D3 plan §12.)

check-types:c2-4-c-bridge:
  1 diagnostic matches frozen baseline.

check-types:c2-4-d-hub:
  1 diagnostic matches frozen baseline.

biome check (D3 test file):
  clean.

git diff --check:
  clean.

git status:
  Only the known untracked .clinerules file. No unexpected dirty
  work.
```

## 12. Protected-stash verification

```text
git stash list:
  stash@{0}: lint-staged automatic backup
  stash@{1}: ACT-ELM-02C2-dirty-failed-attempt-preserved-for-forensics
            5-files-SdkController-host-wiring-host-msgs-2tests;
            pre-F0-recon-digest:141372c52
            SHA-256 of diff: e4df6de3220647d5c9dbc27165ec8311d2f277683ff26b66ced67f977d26f233
  stash@{2}: On act/elm-architecture01-e0-e4:
            WIP ACT-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01 forensic
            corrections before telemetry C04
            SHA-256 of diff: ac85c95cfbabf14945b490a121901175700a41939b9dfd3f80767c84fed5755a
```

Both protected stashes are intact. No stash refs were
rewritten, popped, applied, or dropped during D3.

## 13. D3 verdict

```text
D3_REPAIR_CLASS             = C
HUB_RUN_EPOCH_PROVENANCE    = NOT_YET_QUALIFIED
REMOTE_RUN_EPOCH_PROVENANCE = NOT_YET_QUALIFIED
D4_AUTHORIZED               = true
E7_AUTHORIZED               = false
D3_VERDICT                  = PASS_PROVENANCE_EPOCH_C2_4_D3_CLASS_C
```

D3 PASSES as a qualification ACT. PROVENANCE TRUTH IS KNOWN.
The truth is that Hub/Remote cannot authoritatively prove run
epoch identity at the moment the reconstructed translator needs
it. D4 owns the E7 scope freeze; LOCAL_ONLY is a valid D4
disposition.

## 14. D4 authorization status

```text
D4_AUTHORIZED = true
```

D4 is authorized to freeze the E7 backend set. The default
disposition is `LOCAL_ONLY` (Hub/Remote retain NOT_YET_QUALIFIED
axes). D4 may, after review, choose to:
  - Finalize `E7_INITIAL_BACKEND_SCOPE = LOCAL_ONLY`, or
  - Open a future correction ACT to fix the upstream source
    boundary (which would require a cross-process protocol
    change and is therefore outside the current C2.4-D
    scope).

D3 does NOT pre-freeze `E7_INITIAL_BACKEND_SCOPE`. D4 owns
that freeze.

## 15. E7 authorization status

```text
E7_AUTHORIZED = false
```

D3 does NOT authorize E7. D4 is the scope-freeze step. E7
activation is separate from D3 qualification.

## 16. Final response (matches D3 plan §18 format)

```text
ENTRY:
  HEAD               = <this commit>
  TREE               = clean
  WORKTREE           = only known untracked .clinerules
  protected stashes  = intact (verified via SHA-256 fingerprints)

COMMITS:
  ad8588e39 docs(elm): freeze C2.4-D3 provenance/epoch qualification contract
  f5a9d963c test(apps/vscode): C2.4-D3 pre-repair Hub provenance + epoch witness matrix
  421b27f18 docs(elm): select C2.4-D3 epoch disposition C from real-host evidence
  <this commit> docs(elm): record C2.4-D3 provenance matrix and D4 authorization

REPAIR_SELECTION:
  C
  Rejecting A: A1 fails. session-event-projector.ts:138-148
    strips agentEvent.conversationId when emitting the
    'iteration.started' Hub envelope. Restoring it would
    require a producer-side change, which is outside the
    permitted D3 surface (protocol/schema change).
  Rejecting B: B2 fails decisively. 'session.notice' arrives
    AFTER 'iteration.started' by production contract.
    The translator's activeRunId is only set on iteration_start,
    and the upstream agentEvent.conversationId is undefined
    for iteration_start (per A1). The first iteration_start of
    every epoch has runId=undefined. There is no production
    event that can seed activeRunId before the first
    iteration_start. A B-style repair would inherit this
    defect silently.

PRE_REPAIR:
  D2 8/6/2 frozen (88d0ec391)
  W1..W8 results (f5a9d963c):
    W1: 4/4/0
    W2: 8/6/2 (D2-F1 control)
    W3: 8/6/2
    W4: 7/6/1
    W5: 8/6/2
    W6: 8/4/0 (control)
    W7: 4/4/0
    W8: 4/4/0

POST_REPAIR:
  N/A — C was selected.

PROVENANCE_MATRIX:
  Local / Hub / Remote × all 7 axes (see §8 and §9 above).

TESTS:
  focused       = 12 tests (4 D2 + 8 D3) / 0 failed / 27ms
  full          = 2120 tests (D2 + D3 + C bridge + sdk core unit) / 0 failed
  typechecks    = c2-4-c-bridge matches baseline; c2-4-d-hub matches baseline
  build         = N/A (no app build in current branch closure protocol)
  diff-check    = clean

DELTA:
  production LOC    = 0
  reducer delta     = 0
  public API delta  = 0
  protocol delta    = 0
  test/config delta = 1 test file (758 lines) + 1 include line in vitest config

VERDICT:
  PASS_PROVENANCE_EPOCH_C2_4_D3_CLASS_C

D4_AUTHORIZED:
  true

E7_AUTHORIZED:
  false

NEXT:
  C2.4-D4 E7 SCOPE FREEZE
  (D4 will finalize E7_INITIAL_BACKEND_SCOPE = LOCAL_ONLY unless
   a future correction ACT patches the upstream source boundary.
   D3 does not pre-freeze E7.)
```
