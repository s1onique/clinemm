# C2.4-D3 REPAIR SELECTION — HUB/REMOTE FALLBACK PROVENANCE

> Outcome: **SELECT C** (no safe repair proven in this cycle).

```text
DOC_CLASS              = HISTORICAL_FROZEN
DOC_FROZEN_AT          = 421b27f18 (D3-C3 selection commit)
DOC_SUPERSEDED_BY      = D3-CORRECTION01 evidence (ad995a7c0, 758bb925e)
                       + PLAN-AMENDMENT-09 (758bb925e)

NOTE (per reviewer round-18):
  This document is a HISTORICAL FROZEN record of the A/B/C
  selection at the moment of D3-C3 closure. The CORRECTION01
  evidence (D3-CORRECTION01_HEAD = ad995a7c0) and
  PLAN-AMENDMENT-09 (758bb925e) are the AUTHORITATIVE
  qualification result and AUTHORITATIVE current
  interpretation respectively. They supersede the W6=8/4/0
  prose and the W8-D1-inheritance claim recorded below.

  Specifically:
    W6 prose below states 8/4/0. The CORRECTION01 evidence
      establishes 8/0/0 (cross-session events are STALE in the
      authority resolver; the recorder does not increment any
      counter for STALE).
    W8 prose below claims "D1-REMOTE witness establishes
      Remote inheritance". The CORRECTION01 evidence adds
      R-D3-1, R-D3-2, R-D3-3 which directly witness the
      decisive D3 shapes on a real RemoteRuntimeHost.
    W4/W5 prose below does not classify the witnesses as
      PROTOCOL_ABSENCE. The CORRECTION01 evidence reclassifies
      them (Hub has no continueTask / task_reset envelope).
```

```text
ACT_ID              = ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.4-D3
ENTRY_HEAD          = 88d0ec391 (C2.4-D2-FIXUP03)
DECISION_HEAD       = <this commit's tip>
D3-C2_HEAD          = f5a9d963c (pre-repair witness matrix)
PROTECTED_STASH     = 141372c52 (FORENSIC, do NOT pop)

D3_REPAIR_CLASS             = C
HUB_RUN_EPOCH_PROVENANCE    = NOT_YET_QUALIFIED
REMOTE_RUN_EPOCH_PROVENANCE = NOT_YET_QUALIFIED
D4_AUTHORIZED               = true
E7_AUTHORIZED               = false
```

C is NOT a failure of the ACT. C is an acceptable outcome:
Hub/Remote provenance identity is not authoritatively available
in the producer-side envelope at the moment the reconstructed
translator needs it, and D4 will freeze the E7 backend set
accordingly. LOCAL_ONLY remains a valid D4 disposition.

## 1. Decision matrix

Decision rule (per D3 plan §4): SELECT A iff A1..A5 all PASS;
ELSE SELECT B iff B1..B8 all PASS; ELSE SELECT C.

| Criterion | A | B | C |
| --------- | - | - | - |
| **source-authoritative identity** | FAIL — A1 | PARTIAL — B1 | N/A |
| **identity available before first epoch mutation** | FAIL — A4 | FAIL — B2 (decisive) | N/A |
| **same-session multi-run safety** | TBD | TBD | N/A |
| **old-terminal suppression** | TBD | TBD | PARTIAL (D3-W3, D3-W4 observe deadness) |
| **continuation safety** | TBD | TBD | N/A — Hub has no continueTask envelope |
| **reset/new-task safety** | TBD | TBD | PARTIAL (D3-W5) |
| **recovery missing-id behavior** | TBD | TBD | PARTIAL (D3-W7) |
| **Hub support** | TBD | TBD | N/A |
| **Remote support** | TBD | TBD | INHERITED (D1-REMOTE parity) |
| **semantic invasiveness** | TBD | TBD | 0 (no production change) |
| **public API delta** | TBD | TBD | 0 |
| **protocol schema delta** | FAIL — would require producer-side projector change | 0 | 0 |
| **production LOC** | TBD | TBD | 0 |
| **evidence strength** | strong (D2 + D3 witnesses) | strong (D3-W2 + temporal recon) | strong (D3-W1..W8) |

"FAIL" rows are decisive. The decision is determined by the
first FAIL/PASS verdict on each axis; TBD rows are not consulted.

## 2. Candidate A evaluation

### A1 — identifier exists at producer boundary

Question: Does the Hub protocol's `iteration.started` envelope
carry the conversationId at the producer side?

Answer: **NO.**

Source-line evidence:

```
sdk/packages/core/src/hub/server/handlers/session-event-projector.ts:138-148
  if (agentEvent.type === "iteration_start") {
    ctx.publish(
      ctx.buildEvent(
        "iteration.started",
        { iteration: agentEvent.iteration },  // ← ONLY { iteration }
        sessionId,
      ),
    )
    return
  }
```

The producer-side projector STRIPS `agentEvent.conversationId`
when emitting `iteration.started`. The upstream `agentEvent` may
carry it (verified at line 256-265: `session.notice` correctly
preserves `agent.conversationId`), but `iteration.started`
explicitly extracts only `{ iteration }`.

HubRuntimeHost at the consumer side then re-emits only what the
producer sent:

```
sdk/packages/core/src/hub/runtime-host/hub-runtime-host.ts:1604-1619
  case "iteration.started": {
    this.events.emit({
      type: "agent_event",
      payload: {
        sessionId,
        event: {
          type: "iteration_start",
          iteration: ...,
        },
      },
    })
    return
  }
```

No `conversationId` field is preserved or reconstructed.

**A1 = FAIL.**

### A2..A5 (paper over)

A2 requires A1 to be true. A1 is false.
A3 requires A1 to be true. A1 is false.
A4 requires A1 to be true. A1 is false.
A5 requires A1 to be true. A1 is false.

### A veredict

**A = REJECTED_NO_SOURCE_PROVENANCE.**

The Hub protocol does not carry the conversationId on the
epoch-defining `iteration.started` envelope at the producer
boundary. Restoring it would require a producer-side change to
`session-event-projector.ts:138-148`, which is a cross-process
protocol/schema change. This is OUTSIDE the permitted D3 surface
(D3 plan §5 HALT conditions: "protocol/schema change across
external compatibility boundary").

## 3. Candidate B evaluation

### B1 — source event carries authoritative identity

Question: Does `session.notice` carry `conversationId` on the
Hub envelope?

Answer: **YES** (when the producer supplies it).

Source-line evidence:

```
sdk/packages/core/src/hub/runtime-host/hub-runtime-host.ts:1666-1672
  ...(typeof agent?.conversationId === "string"
    ? { conversationId: agent.conversationId }
    : {}),
```

```
sdk/packages/core/src/hub/server/handlers/session-event-projector.ts:256-278
  if (agentEvent.type === "notice") {
    ctx.publish(
      ctx.buildEvent(
        "session.notice",
        {
          sessionId,
          message: agentEvent.message,
          noticeType: agentEvent.noticeType,
          ...
          agent: {
            ...
            agentId: agentEvent.agentId,
            conversationId: agentEvent.conversationId,  // ← preserved
            ...
          },
        },
        sessionId,
      ),
    )
    return
  }
```

**B1 = PASS.**

### B2 — TIME OF EVENT vs TIME OF FIRST EPOCH MUTATION

This is the DECISIVE test for B (per D3 plan §3.2):

> "Does the proposed signal exist before the first epoch-sensitive
> reconstructed mutation, by production contract rather than test
> ordering?"

Source-line evidence: `handleHubEvent` processes envelopes in the
order they arrive from the producer. The order in the producer's
event stream is:

```
Session start:   run.started
                 iteration.started       ← FIRST EPOCH MUTATION
                 session.notice          ← notice arrives here
                 tool.started
                 tool.finished
                 run.completed
```

The D2/D3 scripted sequence (independent of test ordering) follows
this exact order. The `run.started` and `iteration.started`
envelopes are emitted BEFORE `session.notice`. The translator's
`activeRunId` is only set on `iteration_start` (verified at
task-state-shadow-observer.ts:168-170):

```ts
if (agentEvent.type === "iteration_start") {
  this.activeRunId.value = (agentEvent.conversationId as string | undefined) ?? this.activeRunId.value
}
```

The upstream `agentEvent.conversationId` is **undefined** for
`iteration_start` (per A1). So `activeRunId` stays `undefined` on
the first iteration_start of EVERY epoch. The first `run-started`
edge of every epoch is reconstructed with `runId=undefined`.

Even if `session.notice` (with its conversationId) arrived BEFORE
the first iteration_start, it would still introduce a temporal
ordering problem: notice is a STREAM event, not a session-start
trust anchor. Seeding `activeRunId` from notice would mean the
NOTICE event itself defines the run epoch, which conflates
recovery state with run identity.

In THIS protocol, notice arrives AFTER iteration_start. There is
no temporal ordering variation that makes B viable.

**B2 = FAIL (decisive).**

### B3..B8 (paper over)

B3 requires B2 to be true. B2 is false.

A "stale notice" or "task reset" boundary under B would itself
require a tracker, which is what B was supposed to provide
without temporal authority. Without temporal authority, any
tracker is either: (a) seeded late by notice, missing the first
iteration_start, or (b) seeded early by guessing from an
unrelated field, which is FABRICATED IDENTITY (forbidden by D3
plan §3.1).

### B veredict

**B = REJECTED_TEMPORAL_AUTHORITY.**

The decisive test for B is temporal. The Hub protocol's
`session.notice` arrives AFTER `iteration.started` by production
contract, not by test ordering. The first `iteration_start` of
every epoch has `runId=undefined`. A B-style repair would
silently inherit this defect without producing a principled
fix — the "activeRunId is now seeded" claim would be true for
the SECOND epoch's iteration_start but false for the first. There
is no production event that can seed `activeRunId` before the
first `iteration_start`.

## 4. Candidate C selection

C is the only viable outcome under the A/B feasibility gate.

```text
HUB_RUN_EPOCH_PROVENANCE    = NOT_YET_QUALIFIED
REMOTE_RUN_EPOCH_PROVENANCE = NOT_YET_QUALIFIED
```

D4 will freeze the E7 backend set. LOCAL_ONLY is a valid D4
disposition.

## 5. Required production outcomes

For C selection:

- NO production repair.
- NO test weakening.
- Provenance matrix stamped with the honest per-axis statuses.
- D4_AUTHORIZED = true.
- E7_AUTHORIZED = false (D4 owns the E7 scope freeze).

## 6. Seven-axis provenance matrix (preliminary, finalized in D3-C7)

| Axis | Local | Hub | Remote |
|------|-------|-----|--------|
| D3-P1 SESSION_ID_PROVENANCE | QUALIFIED | QUALIFIED | QUALIFIED |
| D3-P2 RUN_ID / CONVERSATION_ID_PROVENANCE | QUALIFIED | NOT_YET_QUALIFIED | NOT_YET_QUALIFIED |
| D3-P3 FIRST_ITERATION_START_IDENTITY | QUALIFIED | NOT_YET_QUALIFIED | NOT_YET_QUALIFIED |
| D3-P4 STALE_OLD_RUN_TERMINAL_SUPPRESSION | QUALIFIED | NOT_YET_QUALIFIED | NOT_YET_QUALIFIED |
| D3-P5 CONTINUATION_BEFORE_NEXT_RUN_START | QUALIFIED | NOT_YET_QUALIFIED | NOT_YET_QUALIFIED |
| D3-P6 TASK_RESET / NEW_TASK_EPOCH_BOUNDARY | QUALIFIED | NOT_YET_QUALIFIED | NOT_YET_QUALIFIED |
| D3-P7 RECOVERY_WITH_MISSING_RUN_PROVENANCE | QUALIFIED | PARTIALLY_QUALIFIED | PARTIALLY_QUALIFIED |

LOCAL inherited from C2.4-C/C2.3 evidence (control; not relitigated).

Derived backend status:

```text
HUB_TOTAL_PROVENANCE    = NOT_YET_QUALIFIED
REMOTE_TOTAL_PROVENANCE = NOT_YET_QUALIFIED
```

An active unsafe epoch mutation on an E7-required axis means
NOT_YET_QUALIFIED for that axis (no "basically qualified").

## 7. Pre-repair witness results (D3-W1..W8)

All 8 witnesses pass under the pre-repair Hub harness:

```
D3-W1 CURRENT RUN                      4 translated / 4 APPLY / 0 SUPPRESS
D3-W2 TWO RUNS SAME SESSION (control)   8 translated / 6 APPLY / 2 SUPPRESS
D3-W3 LATE TERMINAL AFTER NEW RUN      8 translated / 6 APPLY / 2 SUPPRESS
D3-W4 CONTINUATION WINDOW              7 translated / 6 APPLY / 1 SUPPRESS
D3-W5 TASK RESET BOUNDARY               8 translated / 6 APPLY / 2 SUPPRESS
D3-W6 CROSS-SESSION (control)          8 translated / 4 APPLY / 0 SUPPRESS
D3-W7 RECOVERY MISSING RUN ID          4 translated / 4 APPLY / 0 SUPPRESS
D3-W8 TERMINAL VARIANTS (run.failed,   4 translated / 4 APPLY / 0 SUPPRESS
        run.aborted)
```

Pre-repair observation:

- D3-W2 IS the D2-F1 frozen control. The 6/2 split is the
  pre-repair empirical decoder.
- D3-W3, D3-W4, D3-W5 produce the SAME 6/2 OR 6/1 split as
  W2 under the pre-repair harness. The translator's stranded-
  terminal gate is structurally dead because both activeRunId
  and eventConvId are undefined.
- D3-W6 is a control proving the session guard already
  isolates cross-session events. The test passes 8/4/0 (4
  APPLY because the sessionId differs, so the run-started
  edges do NOT collide).
- D3-W7 is a control proving recovery notice without
  conversationId cannot rescue the activeRunId tracker.
- D3-W8 is a control proving terminal variants route through
  the same path. It does NOT re-exercise Remote; the D1-REMOTE
  witness already establishes Remote inheritance.

These witnesses are the empirical basis for the A/B/C selection
C. They are NOT evidence that a repair is possible; they are
evidence that the pre-repair state is structurally incapable of
the first-iteration identity invariant.

## 8. Production delta accounting

For C selection:

```text
PRODUCTION_FILES_TOUCHED = 0
PRODUCTION_LOC_ADDED    = 0
PRODUCTION_LOC_REMOVED   = 0
REDUCER_SEMANTIC_DELTA   = 0
PUBLIC_API_DELTA         = 0
PROTOCOL_SCHEMA_DELTA    = 0
CONFIG_DELTA             = 0
TEST_INFRA_DELTA         = 0  (extended existing include list)
```

D3 changes are: plan document, vitest config (include list),
new test file (D3-W1..W8). No production code touched.

## 9. Files

```text
docs/architecture/elm/task-state-e5-e6-correction02-c24-d3-provenance-epoch-plan.md
  (D3-C1, frozen contract)
docs/architecture/elm/task-state-e5-e6-correction02-c24-d3-repair-selection.md
  (this file, D3-C3)
apps/vscode/src/sdk/__tests__/hub-runtime-host.provenance-epoch.c24-d3.test.ts
  (D3-C2, pre-repair witness matrix, 752 lines, 8 tests)
apps/vscode/vitest.config.c2-4-d-hub.ts
  (extended include list — no new config)
```

D3-C4..C6 (production repair, post-repair qualification, necessity
probe) are NOT applicable under C selection.

D3-C7 (final provenance matrix + D4 authorization) is the
final evidence document.

## 10. Verdict

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

## 11. Next

```text
D3-C7 docs(elm): record C2.4-D3 provenance matrix and D4 authorization
C2.4-D4 E7 SCOPE FREEZE  →  D4 owns the LOCAL_ONLY disposition
```

D3 does NOT authorize E7.
