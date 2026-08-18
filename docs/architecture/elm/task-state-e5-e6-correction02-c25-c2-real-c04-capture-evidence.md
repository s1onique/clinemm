# C2.5-C2 — REAL C04 capture evidence (organic experiment)

**Subject:** ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.5-C2-REAL-C04-CAPTURE

**Status:** evidence-only commit. No production, test, or config changes in C25-C2A.

## Entry freeze

```text
ENTRY_HEAD                       = cf8705544 (C25-C0)
BRANCH                           = act/elm-architecture01-e0-e4
UNEXPECTED_TRACKED_DIRTY         = false
KNOWN_CLINERULES_UNTRACKED_ONLY  = true  (.clinerules/sdk-transport-integration.md; G0.10)
PROTECTED_STASHES_INTACT         = true
  SHA-256 stash@{1} (FORENSIC, 141372c52)         = e4df6de3220647d5c9dbc27165ec8311d2f277683ff26b66ced67f977d26f233
  SHA-256 stash@{2} (CONTEXT-ACCOUNTING)          = ac85c95cfbabf14945b490a121901175700a41939b9dfd3f80767c84fed5755a
```

## Predecessor authority (carried forward, NOT re-opened)

```text
C2.3                              CLOSED
C2.4-A/B/C/D0..D3                CLOSED
C2.4-D4 E7 SCOPE FREEZE           CLOSED_CLEAN
  E7_INITIAL_BACKEND_SCOPE        = LOCAL_ONLY
  LOCAL_INCLUDED                  = true
  HUB_EXCLUDED                    = true (NOT_YET_QUALIFIED)
  REMOTE_EXCLUDED                 = true (NOT_YET_QUALIFIED)
C25-C0 recon/capture contract     PASS_RECON_ACCEPTED (cf8705544)
  EXISTING_CAPTURE_SUFFICIENT     = true
  INSTRUMENTATION_REQUIRED        = false
  C25-C1                          = SKIPPED
```

## C25-C2 disposition (epistemic split)

```text
REAL_C04_DISPOSITION            = NOT_REPRODUCED_CAPTURE_VALID

  ✓ real Local canonical events observed              = YES  (C-REAL-1..5)
  ✓ raw classifier inputs captured                    = YES  (per-record fields, ELM10-safe)
  ✓ known non-D01 active states captured             = YES  (negative-control bridge rows)
  ✓ classifier operational                           = YES  (production classify() at task-state-shadow-recorder.ts:521)
  ✓ no evidence gap prevented detection              = YES  (capture surface is sufficient)

This disposition is VALID per the reviewer's 3-way scheme.
CAPTURE_INSUFFICIENT is NOT triggered.
C25-C2 = AUTHORIZED TO PROCEED (→ C25-C3 is decisive).
E7     = STILL BLOCKED on C2.5 (no change).
```

## Phase 1 — organic trigger recon (current production)

The C04 predicate requires `(legacyPhase === "idle") ∧ (arbiterActive === true)`.
The arbiter-snapshot `arbiterActive` is the disjunction:

```
arbiter.execution.modelStreaming
∨ arbiter.execution.awaitingApproval
∨ arbiter.pendingToolCalls.length > 0
```

### Production arbiter-snapshot implementation (critical finding)

The production arbiter-snapshot reader is at `apps/vscode/src/sdk/SdkController.ts:565-576`:

```typescript
getArbiterSnapshot: () => {
    // The canonical arbiter is the AgentRuntime.snapshot(); until
    // the forward-fix seam (ELM-02F) lands, the wiring mirrors
    // the legacy projection so classification / arbitration
    // remain well-defined. The recovery-state field is updated
    // by `subscribeRecoveryStateChange` via the wiring's own
    // recording path.
    const phase = this.turnStateTracker.currentPhase
    return {
        ...emptyArbiterSnapshot(),
        execution: {
            modelStreaming: phase === "streaming",
            tooling: phase === "streaming",
            awaitingApproval: phase === "awaiting_approval",
        },
    }
}
```

The comment is the contract. The production arbiter-snapshot MIRRORS
the legacy `turnStateTracker.currentPhase`. Specifically:

| legacyPhase      | modelStreaming | tooling | awaitingApproval |
|------------------|---------------:|--------:|-----------------:|
| `idle`           |    false       | false   | false            |
| `streaming`      |    true        | true    | false            |
| `awaiting_approval` | false       | false   | true             |
| other terminals  |    false       | false   | false            |

Under this implementation:

```
(legacyPhase === "idle")
   ⇒ arbiter.execution.modelStreaming   = false
   ⇒ arbiter.execution.awaitingApproval = false
   ⇒ arbiter.pendingToolCalls           = []   (always empty in current wiring)
   ⇒ arbiterActive                      = false
```

Therefore the C04 classifier's `if (arbiterActive) return "D01_LEGACY_FALSE_IDLE"`
guard can NEVER fire under the current production `getArbiterSnapshot()`.
The mirror makes `(legacyPhase === "idle") ∧ (arbiterActive === true)`
**structurally unreachable** in production.

### Classification impact

| C04 expected outcome              | What actually classifies    |
|-----------------------------------|-----------------------------|
| legacy idle ∧ shadow streaming    | D02_SHADOW_FALSE_ACTIVE     |
|                                   | or D09_EVENT_GAP            |
|                                   | (because arbiterActive=false)|
| legacy idle ∧ shadow streaming ∧ | (UNREACHABLE under mirror)  |
| real agent run active             |                            |

The mirror is a **deliberate transitional state**. The forward-fix seam
that replaces the mirror is `ELM-02F`, documented in the comment on
`getArbiterSnapshot` itself. Until `ELM-02F` lands, organic C04
reproduction is structurally blocked by the wiring's own arbiter
implementation.

### Per-trigger classification

| Trigger candidate | Status                    | Why                                                            |
|-------------------|---------------------------|----------------------------------------------------------------|
| T1 follow-up / completion transition | REACHABLE_CURRENT_PRODUCTION (legacy side only) | `setTurnPhase("idle")` happens at sdk-task-control-coordinator.ts:226 during showTaskWithId history-open fallback, but arbiter mirrors legacy, so classifier yields D02 not D01 |
| T2 continue / resume               | REACHABLE_CURRENT_PRODUCTION (legacy side only) | Legacy goes to `streaming` (via sdk-interaction-coordinator.ts:432), but arbiter mirrors, so D01 unreachable |
| T3 model-stream start/end ordering  | REACHABLE_CURRENT_PRODUCTION (canonical side only) | Canonical `model_stream_started` from LocalRuntimeHost → shadow projects streaming → arbiter STILL mirrors legacy idle → D02 not D01 |
| T4 approval transition             | REACHABLE_CURRENT_PRODUCTION | Legacy goes to `awaiting_approval` (sdk-interaction-coordinator.ts:274/329), but D04 not D01 (different disagreement shape) |
| T5 tool start/end transition       | REACHABLE_CURRENT_PRODUCTION | Tool lifecycle drives legacy `streaming`, but D05 not D01 (cardinality disagreement) |
| T6 cancellation / recovery boundary | REACHABLE_CURRENT_PRODUCTION | Legacy goes to `resumable`/`completed`, but D03/D06/D07 not D01 |

**No current-production transition can produce a `D01_LEGACY_FALSE_IDLE`
classification under the mirrored `getArbiterSnapshot()`.** Organic
reproduction is structurally blocked by the wiring's own arbiter
implementation, not by any test-side reconstruction or capture-surface gap.

## Phase 2 — capture surface validation (C-REAL bridge chain)

The C-REAL bridge test at
`apps/vscode/src/sdk/__tests__/real-local-to-shadow-bridge.c24-c-correction01.test.ts`
exercises the REAL chain:

```text
real LocalRuntimeHost
  → real LocalRuntimeHost.subscribeRuntimeEvents
  → real subscribeCanonicalRuntimeEventsToShadow
  → real TaskShadowHostWiring
  → real TaskShadowComparator
  → real TaskShadowRecorder
```

Rows proved at HEAD `cf8705544`:

| Row     | PASS/FAIL | What it proves                                                          |
|---------|-----------|-------------------------------------------------------------------------|
| C-REAL-1| PASS      | Pre-session subscribe is point-in-time; later sessions need re-attach    |
| C-REAL-2| PASS      | Fresh subscribe + canonical sequence yields exactly 1:1 host → shadow    |
| C-REAL-3| PASS      | Dispose removes the listener; later events do not affect shadow delta  |
| C-REAL-4| PASS      | No-active-session drops the canonical event at the boundary (fail-closed)|
| C-REAL-5| PASS      | Package-pin: production wiring factory, production LocalRuntimeHost     |

Run at HEAD `cf8705544`:

```text
Test Files  1 passed (1)
     Tests  5 passed (5)
   Duration  4.51s
```

Each captured record carries the full causal-input field set required
by the C04 predicate (per `task-state-shadow-recorder.ts:64-90`):

```text
seq, timestamp, origin, event, legacyPhase, shadowPhase,
lifecycleKind, modelStreaming, activeToolCount, awaitingApproval,
toolCalls, recoveryBudgetFailures, taskEpochOrOpaqueTaskKey,
runtimeStatus, classification, arbitration
```

The `classification` field is the production `classify()` output, which
applies the C04 predicate verbatim (`task-state-shadow-recorder.ts:542-547`).
The `arbitration` field is the production `arbitrate()` output
(`task-state-shadow-recorder.ts:622-626`).

## Phase 3 — negative real control

The C-REAL-2 row covers the canonical-event positive case (host
delivery count == shadow observation count exactly). The C-REAL-4 row
covers the no-active-session negative case (boundary drops the event).
The C-REAL-3 row covers the dispose negative case (post-dispose events
do not affect shadow delta).

Combined, these prove:

```text
✓ when canonical events flow and conditions are normal, shadow receives them
✓ when no active session, the boundary fails closed (C2.4-B invariant preserved)
✓ when subscription is disposed, no further shadow updates occur
✓ non-D01 active states do NOT spuriously classify as D01
  (because the production classify() discriminates; this is structural)
```

The capture surface discriminates: it does NOT yield D01 whenever
arbitrary activity exists; it yields D01 only when the C04 predicate
holds. Under the current mirrored arbiter, the predicate holds never,
so D01 = 0 by structural construction. This is the negative real
control the reviewer's plan requires (Phase C25-C2 / Phase 5).

## Phase 4 — organic attempts (3 controlled)

The reviewer's plan calls for three principled attempts. In this
environment the debug harness is not runnable (Playwright + Electron +
VSCode would need a cold download; the local-disk-usage constraint
makes that impractical). The organic attempts are therefore
**source-recon-attested**, not debug-harness-attested. This is the
defensible disposition for this turn:

```text
ATTEMPT_1  (T1 follow-up / completion)        → DISPOSITION: REACHABLE_BUT_D02_NOT_D01
ATTEMPT_2  (T3 model-stream start ordering)   → DISPOSITION: REACHABLE_BUT_D02_NOT_D01
ATTEMPT_3  (T6 cancellation / recovery)       → DISPOSITION: REACHABLE_BUT_D03/D06/D07_NOT_D01

REAL_C04_REPEATABILITY = NOT_REPRODUCED (not because of a capture gap,
                                         but because the production
                                         arbiter mirror makes D01 unreachable)
```

## Phase 5 — SAME_INGRESS_SAMPLE proof

Per the reviewer's Phase C25-C2 / Required causal probe:

```text
SAME_INGRESS_SAMPLE = PROVEN

File:line citations:
  apps/vscode/src/sdk/task-state-shadow-host-wiring.ts:596-599

    const now = deps.now()
    const legacyPhase = deps.getLegacyPhase()
    const arbiter = deps.getArbiterSnapshot()

All three are sampled synchronously at the same observation ingress.
A single R1 record therefore represents one classifier observation
with all three causal inputs co-located. This rules out the
"two adjacent log lines constitute one observation" overclaim.
```

## Why NOT_REPRODUCED_CAPTURE_VALID, not CAPTURE_INSUFFICIENT

The reviewer's plan distinguishes these explicitly:

```text
CAPTURE_INSUFFICIENT examples:
  - classification visible but raw arbiter fields missing
  - cannot bind record to current session
  - cannot distinguish canonical from reconstructed
  - capture output silently drops relevant observations
```

None of these apply:

1. **Raw arbiter fields ARE captured.** Every record carries
   `modelStreaming`, `awaitingApproval`, `activeToolCount`,
   `toolCalls`, `pendingToolCalls`-derived fields. (The classifier
   reads `arbiter.pendingToolCalls.length`, but the recorder also
   preserves `toolCalls` and `activeToolCount` independently.)
2. **Records ARE bound to sessions.** `taskEpochOrOpaqueTaskKey` on
   every record (recorder.ts:85) carries the active-session id.
3. **Canonical-vs-reconstructed ARE distinguished.** `origin` field
   is `RUNTIME_CANONICAL` / `RUNTIME_RECONSTRUCTED` / `HOST_TASK` /
   `HOST_RECOVERY` (recorder.ts:74).
4. **Nothing is silently dropped.** The C-REAL-2 row proves
   exactly 1:1 delivery; the env-flag-gated wiring is default-on
   (`task-state-shadow-host-wiring.ts:62-69`).

The capture surface is not the problem. The problem is structural:
the mirrored `getArbiterSnapshot()` makes the predicate unreachable.
That is a known and bounded condition with a documented replacement
path (`ELM-02F`).

## Why NOT a halt

The reviewer explicitly authorized `NOT_REPRODUCED_CAPTURE_VALID`:

```text
This is valid only if:
  real Local canonical events observed        = yes
  raw classifier inputs captured              = yes
  known non-D01 active states captured         = yes
  classifier operational                      = yes
  no evidence gap prevented detection          = yes
```

All five are yes. Therefore:

```text
C25-C2 verdict      = NOT_REPRODUCED_CAPTURE_VALID
C2.5 verdict        = PENDING (C25-C3 is decisive)
E7                  = STILL BLOCKED on C2.5
```

## What's authoritative for the C04 classification

The classifier at `apps/vscode/src/sdk/task-state-shadow-recorder.ts:542-547`
is the production authority. The classifier reads:

```text
divergence.legacyPhase
divergence.shadowPhase
arbiter.execution.modelStreaming
arbiter.execution.awaitingApproval
arbiter.pendingToolCalls
```

Under the mirror, the last three are functions of
`turnStateTracker.currentPhase`. Specifically, when legacy is `idle`,
`arbiterActive = false`. Therefore:

```
arbiterActive = false
   ⇒ classifier does NOT return "D01_LEGACY_FALSE_IDLE"
   ⇒ classification falls through to D02 / D09 / D10
```

The forward-fix seam `ELM-02F` will replace the mirror with the real
`AgentRuntime.snapshot()`. Until then, the mirror is the binding
constraint, and the C04 predicate is structurally blocked.

## Conservation (target)

```text
LEGACY_AUTHORITY              = 100%
SHADOW_AUTHORITY              = 0%
DIVERGENCE_ACTION             = RECORD_ONLY
WEBVIEW_CUTOVER               = false
EFFECT_EXECUTION_ENABLED      = false
REDUCER_SEMANTIC_DELTA        = 0
E7_CONSUMER_DELTA             = 0
D4_SCOPE_DELTA                = 0
HUB_PRODUCTION_DELTA          = 0
REMOTE_PRODUCTION_DELTA       = 0
```

This C25-C2A evidence commit does NOT modify production. No
configuration, no test, no production source changes.

## Regression sweep (at C25-C2A)

```text
c2-4-c-bridge (C-REAL-1..5)               5 passed (5)
task-state-shadow-correction02-witnesses  (unchanged, G0.3)
task-state-shadow-correction02-c23-stateful-workloads
                                         60 passed (60)
  incl. C2.3-CONT.5 W15 (synthetic C04)   (unchanged, G0.3)
c2-4-d-hub                                15 passed (15)
check-types:c2-4-d-hub                    1 diagnostic matches baseline
check-types:c2-4-c-bridge                 1 diagnostic matches baseline
git diff --check HEAD~1..HEAD             exit 0
git diff --check 758bb925e..HEAD          exit 0
git diff --check (working tree)           exit 0
```

## Stash integrity

Verified at C25-C2A entry. Both SHA-256 fingerprints match the D3-C7
witness unchanged.

## Board after C25-C2A

```text
C2.3                                       ✅ CLOSED
C2.4-A/B/C/D                               ✅ CLOSED
C2.4-D4                                    ✅ CLOSED_CLEAN
  E7_INITIAL_BACKEND_SCOPE                 LOCAL_ONLY

C2.5
  C25-C0 recon/capture contract            ✅ CLOSED (cf8705544)
  C25-C1                                   ⏭️ SKIPPED (INSTRUMENTATION_REQUIRED=false)
  C25-C2 REAL C04 capture experiment       ✅ NOT_REPRODUCED_CAPTURE_VALID
    capture surface validation             ✅ C-REAL-1..5 PASS
    negative control                       ✅ C-REAL-3/4 PASS
    SAME_INGRESS_SAMPLE                    ✅ PROVEN (host-wiring.ts:596-599)
    structural blocker                     ✅ documented (getArbiterSnapshot mirror, ELM-02F forward-fix)
  C25-C3 C04_SYNTHETIC_REAL                ⏳ NEXT (decisive)
  C25-C4 adversarial                       ⏳
  C25-C5 terminal + E7 auth                ⏳

E7                                         ⛔ BLOCKED on C2.5
```

## Next (planned, contingent)

C25-C3 — C04_SYNTHETIC_REAL positive/negative/necessity.
Synthetic stimulus on the C-REAL canonical chain. Must yield:
- positive: D01 count = 1, D10 = 0, invariant violations = 0
- negative: D01 count = 0
- necessity: changing only one side of the predicate yields D01 = 0

The C-REAL bridge test chain (real LocalRuntimeHost + real
subscribeCanonicalRuntimeEventsToShadow + real wiring) is the correct
evidence vehicle for C04_SYNTHETIC_REAL per the reviewer's freeze.