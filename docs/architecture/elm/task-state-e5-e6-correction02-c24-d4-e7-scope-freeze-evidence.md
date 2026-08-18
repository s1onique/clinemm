# C2.4-D4 E7 SCOPE FREEZE — DISPOSITION EVIDENCE

> Outcome: **`E7_INITIAL_BACKEND_SCOPE = LOCAL_ONLY`**
> (Hub and Remote retain NOT_YET_QUALIFIED on the run-epoch
> axes; Hub/Remote are EXCLUDED from E7's initial backend
> set.)

```text
ACT_ID                       = ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.4-D4
ENTRY_HEAD                   = 758bb925e (D3-CORRECTION01 evidence, PLAN-AMENDMENT-09)
EXIT_HEAD                    = <this commit's tip>
PROTECTED_STASH              = 141372c52 (FORENSIC, do NOT pop)

D4_VERDICT                   = PASS_SCOPE_FREEZE_LOCAL_ONLY
E7_INITIAL_BACKEND_SCOPE     = LOCAL_ONLY
LOCAL_INCLUDED               = true
HUB_EXCLUDED                 = NOT_YET_QUALIFIED
REMOTE_EXCLUDED              = NOT_YET_QUALIFIED
D4_AUTHORIZED                = true  (frozen)
E7_AUTHORIZED                = false (D4 does NOT authorize E7)
C2_5_AUTHORIZED              = true  (D4 unlocks C2.5; see §6)

PREDECESSOR_SHAS:
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
  D3-C7 evidence doc          = CLOSED                (458d2308f + PLAN-AMENDMENT-08)
  D3-CORRECTION01             = CLOSED                (ad995a7c0 + 758bb925e)
  D4 (this ACT)               = CLOSED                (this commit)
```

## 1. Verdict table — frozen provenance axis dispositions

The D3 qualification (after CORRECTION01) is the authoritative
input. D4 freezes the verdict table verbatim and stamps it into
E7's scope-freeze contract.

| Axis | Local | Hub | Remote |
|------|-------|-----|--------|
| D3-P1 SESSION_ID_PROVENANCE | QUALIFIED | QUALIFIED | QUALIFIED |
| D3-P2 RUN_ID / CONVERSATION_ID_PROVENANCE | QUALIFIED | **NOT_YET_QUALIFIED** | **NOT_YET_QUALIFIED** |
| D3-P3 FIRST_ITERATION_START_IDENTITY | QUALIFIED | **NOT_YET_QUALIFIED** | **NOT_YET_QUALIFIED** |
| D3-P4 STALE_OLD_RUN_TERMINAL_SUPPRESSION | QUALIFIED | **NOT_YET_QUALIFIED** | **NOT_YET_QUALIFIED** |
| D3-P5 CONTINUATION_BEFORE_NEXT_RUN_START | QUALIFIED | **NOT_YET_QUALIFIED (PROTOCOL_ABSENCE)** | **NOT_YET_QUALIFIED (PROTOCOL_ABSENCE)** |
| D3-P6 TASK_RESET / NEW_TASK_EPOCH_BOUNDARY | QUALIFIED | **NOT_YET_QUALIFIED (PROTOCOL_ABSENCE)** | **NOT_YET_QUALIFIED (PROTOCOL_ABSENCE)** |
| D3-P7 RECOVERY_WITH_MISSING_RUN_PROVENANCE | QUALIFIED | PARTIALLY_QUALIFIED | PARTIALLY_QUALIFIED |
| **All 7 axes QUALIFIED?** | YES | **NO** | **NO** |

**Aggregate backend status (frozen by D4):**

```text
HUB_TOTAL_PROVENANCE    = NOT_YET_QUALIFIED
REMOTE_TOTAL_PROVENANCE = NOT_YET_QUALIFIED
  (directly witnessed via R-D3-1, R-D3-2, R-D3-3 per
   D3-CORRECTION01, but the qualification status remains
   NOT_YET_QUALIFIED — the witnesses PROVE the structural
   inability to seed activeRunId before the first epoch-
   sensitive reconstructed mutation.)
```

## 2. E7 INITIAL BACKEND SCOPE FREEZE

The plan §4.D4 formula (c2.4-d-hub-remote-fallback-provenance-plan.md:1403-1437)
is:

```text
E7_INITIAL_BACKEND_SCOPE = (
  LOCAL
  ∪ (HUB if HUB_QUALIFIED for every axis else {})
  ∪ (REMOTE if REMOTE_QUALIFIED for every axis else {})
)
```

Applying the verdict table above:

```text
HUB_QUALIFIED    = false   (P2/P3/P4/P5/P6 NOT_YET_QUALIFIED)
REMOTE_QUALIFIED = false   (P2/P3/P4/P5/P6 NOT_YET_QUALIFIED)

E7_INITIAL_BACKEND_SCOPE = LOCAL ∪ {} ∪ {}
                       = LOCAL_ONLY
```

**Frozen value:**

```text
E7_INITIAL_BACKEND_SCOPE = LOCAL_ONLY
```

This is one of the four legitimate outcomes enumerated in
plan §4.D4 (`LOCAL_ONLY`, `LOCAL_AND_HUB`, `LOCAL_AND_REMOTE`,
`LOCAL_AND_HUB_AND_REMOTE`). The reviewer round-18 confirms
this is the expected and acceptable outcome given D3's
qualification.

## 3. Why LOCAL_ONLY is a SAFETY BOUNDARY, not a product preference

The D4 freeze does not express a product decision that Hub or
Remote should never be supported. It is the result of an
honest qualification: the pre-repair harness cannot authorita-
tively seed `activeRunId` before the first epoch-sensitive
reconstructed mutation (Hub `iteration.started` strips
`agentEvent.conversationId` per A1; Hub `session.notice` arrives
AFTER `iteration.started` per B2). The translator's stranded-
terminal gate is structurally dead under Hub.

If we included Hub/Remote in E7's initial backend set, the
shadow would observe the deadness and corrupt
`executorStatus` / `lastRecoveryState` under cross-epoch or
recovery scenarios. This is a correctness failure, not a
performance or capacity issue.

Therefore LOCAL_ONLY is the correct disposition at this cycle.
It will be re-evaluated only when:

1. The upstream source boundary is patched so that
   `iteration.started` carries an authoritative `runId`
   (an `agentEvent.conversationId` propagation in the Hub
   projector at `session-event-projector.ts:138-148`), AND
2. D2 + D3 are re-run with a current evidence commit to
   requalify Hub and Remote.

## 4. Reopening condition for Hub and Remote

The condition for re-evaluating `E7_INITIAL_BACKEND_SCOPE ⊇ {HUB, REMOTE}`
is the conjunction of:

```text
REOPENING_CONDITION =

  (a) The upstream Hub projector (sdk/packages/core/src/hub/runtime-host
      /session-event-projector.ts) preserves and emits
      `agentEvent.conversationId` (or an equivalent authoritative
      run/epoch identifier) on the `iteration.started` envelope.
      This is a producer-side protocol change outside the D3
      surface; it is owned by an upstream correction ACT.

  AND

  (b) The Hub protocol order guarantees that the run/epoch
      identifier arrives before the first epoch-sensitive
      reconstructed mutation. If a new envelope is added
      (e.g. `session.conversation.started` BEFORE
      `iteration.started`), the temporal authority requirement
      is satisfied. Otherwise the seeding happens at
      `iteration.started` time.

  AND

  (c) D2 (REAL FALLBACK COMPOSITION) is re-run with a current
      evidence commit and PASSES. The D2 contract is unchanged.

  AND

  (d) D3 (PROVENANCE/EPOCH SAFETY) is re-run with a current
      evidence commit and ALL 7 axes for Hub (and Remote, by
      inheritance) are QUALIFIED. This is the key disposition
      change: at least P2 / P3 / P4 must move from
      NOT_YET_QUALIFIED to QUALIFIED, and P5 / P6 must move
      from NOT_YET_QUALIFIED (PROTOCOL_ABSENCE) to either
      QUALIFIED (if the upstream patches add the corresponding
      envelopes) or PARTIALLY_QUALIFIED (with a documented
      reason).

  AND

  (e) A subsequent D4-cycle ACT freezes the new scope value
      (LOCAL_AND_HUB / LOCAL_AND_REMOTE / LOCAL_AND_HUB_AND_REMOTE).
```

**No future ACT may assert
`E7_INITIAL_BACKEND_SCOPE ⊇ {HUB, REMOTE}` without satisfying
ALL FIVE sub-conditions (a)–(e).** This is the forbid rule
recorded as the D4 deliverable #4 per plan §4.D4.

## 5. Companion documents (cross-references)

| Document | Role | SHA |
|----------|------|-----|
| `…-c24-d3-provenance-epoch-plan.md` | D3 plan contract (historical frozen, DOC_CLASS pointed) | ad8588e39 |
| `…-c24-d3-provenance-epoch-evidence.md` | D3 evidence + D3-CORRECTION01 (authoritative qualification) | 758bb925e |
| `…-c24-d3-repair-selection.md` | D3 A/B/C selection (historical frozen, DOC_CLASS pointed) | 421b27b18 (select at 421b27f18, DOC_CLASS pointed) |
| `…-c24-d-hub-remote-fallback-provenance-plan.md` | C2.4-D main plan; PLAN-AMENDMENT-09 + PLAN-AMENDMENT-10 | this commit |
| `…-c24-witness-evidence.md` | C2.4 closure witness (C2.4 → C2.5 → E7) | 7650f1a71 (locked) |

The D3-CORRECTION01 evidence (ad995a7c0) and PLAN-AMENDMENT-09
(758bb925e) are the AUTHORITATIVE qualification result and
AUTHORITATIVE current interpretation respectively. D4 freezes
the verdict table from those documents verbatim and stamps
them into the scope-freeze contract.

## 6. C2.5 authorization

The reviewer round-18 correctly noted that D4 should
"determine whether the scope freeze authorizes C2.5, not E7".

Per the C2.4 closure witness
(`…-c24-witness-evidence.md:632`), the chain is:

```text
C2.4 closure → C2.5 → E7
```

**D4 freezes the E7 scope. D4 is the necessary precondition
for C2.5 to open. D4 does NOT directly authorize E7.**

C2.5 is the real-C04 capture + C04_SYNTHETIC_REAL capture ACT
(`…-c23-cont6-plan.md:442`). With `E7_INITIAL_BACKEND_SCOPE =
LOCAL_ONLY` frozen by D4, C2.5's initial capture is constrained
to the LOCAL backend. C2.5 may proceed under that constraint.

```text
C2_5_AUTHORIZED        = true
C2_5_INITIAL_BACKEND   = LOCAL_ONLY (inherited from D4 scope freeze)
C2_5_NOTE              = C2.5 cannot add Hub/Remote to its capture set
                          without re-running D4 against a requalified
                          Hub/Remote matrix.
```

D4 does NOT authorize E7 itself. E7 is the consumer-cutover
ACT gated on the full C2.3..C2.5 closure
(`…-shadow-differential-c2.2-correction01-evidence.md:501`).

```text
E7_AUTHORIZED        = false
E7_NOTE              = E7 is gated on C2.5 closure (which is gated
                        on D4 scope freeze = LOCAL_ONLY). E7 will
                        be authorized when C2.5 closes with its
                        real C04 capture + C04_SYNTHETIC_REAL
                        capture qualified for LOCAL_ONLY.
```

## 7. Reopening cycle (next ACTs)

```text
CURRENT BOARD:
  C2.4-D0                   ✅ CLOSED
  C2.4-D1 HUB/REMOTE        ✅ CLOSED
  C2.4-D2                   ✅ CLOSED
  C2.4-D3 PROVENANCE/EPOCH  ✅ CLOSED (CORRECTION01-refreshed)
  C2.4-D4 E7 SCOPE FREEZE   ✅ CLOSED (this commit, LOCAL_ONLY frozen)

  C2.5                      🟢 NEXT (D4 has unlocked it under
                                     LOCAL_ONLY constraint)
  E7                        ⛔ BLOCKED on C2.5

POSSIBLE FUTURE CYCLES (NOT AUTHORIZED YET):
  D5 (or future D2/D3-cycle)
    - Re-run D2 + D3 after upstream source-boundary patch
      (agentEvent.conversationId propagated on iteration.started)
    - If all 7 axes QUALIFIED for Hub (and Remote by inheritance),
      D5 may freeze LOCAL_AND_HUB / LOCAL_AND_REMOTE /
      LOCAL_AND_HUB_AND_REMOTE
    - Otherwise stays LOCAL_ONLY
```

## 8. Production-delta accounting

```text
PRODUCTION_LOC      = 0 (added)
PRODUCTION_LOC      = 0 (removed)
REDUCER_DELTA       = 0
PUBLIC_API_DELTA    = 0
PROTOCOL_DELTA      = 0
TEST_INFRA_DELTA    = 0 (D4 is doc-only)
DOC_DELTA           = +1 evidence doc (this file) + PLAN-AMENDMENT-10
```

D4 is a documentation-only ACT. No production code, test, or
configuration changes.

## 9. Stash integrity verification

```text
PROTECTED STASHES (verified at this commit):

  stash@{1} (FORENSIC, 141372c52):
    SHA-256 of `git stash show -p stash@{1}` = e4df6de3220647d5c9dbc27165ec8311d2f277683ff26b66ced67f977d26f233

  stash@{2} (CONTEXT-ACCOUNTING-TRUTH01):
    SHA-256 of `git stash show -p stash@{2}` = ac85c95cfbabf14945b490a121901175700a41939b9dfd3f80767c84fed5755a

  All forensic fingerprints match the D3-C7 evidence doc.
```

## 10. Verdict

```text
D4_VERDICT                = PASS_SCOPE_FREEZE_LOCAL_ONLY
E7_INITIAL_BACKEND_SCOPE  = LOCAL_ONLY
LOCAL_INCLUDED            = true
HUB_EXCLUDED              = true   (NOT_YET_QUALIFIED)
REMOTE_EXCLUDED           = true   (NOT_YET_QUALIFIED)
D4_AUTHORIZED             = true
E7_AUTHORIZED             = false
C2_5_AUTHORIZED           = true   (with LOCAL_ONLY constraint)

NEXT                      = C2.5
E7                        = BLOCKED on C2.5
```

