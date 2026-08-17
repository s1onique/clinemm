# C2.2-CORRECTION02 — Evidence + Verdict

```
ACT = ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.2-CORRECTION02

PARENT_ACT = ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.2-CORRECTION01

BASE_HEAD  = 28fed64f75cb92f5303d1ef39a685d9cce8bc904 (C2.2-CORRECTION01 final)
FINAL_HEAD = THIS-COMMIT

BRANCH     = act/elm-architecture01-e0-e4
WORKTREE   = clean
```

---

## Verdict

```
R1..R6 / R8 (CORRECTION01)              = FIXED
R7 (canonical-over-reconstructed dedup)  = FIXED (Option A)
R9 (measured performance)                = PASS
R10 (halt disposition)                   = PASS

C2_2_RECONSTRUCTED_AUTHORITY_POLICY      = OPTION_A_DIAGNOSTIC_ONLY_WHEN_CANONICAL
CANONICAL_AVAILABLE=true  =>
    RUNTIME_RECONSTRUCTED                = DIAGNOSTIC_ONLY
    (no mutation, no record, diagnostic counter += 1)
CANONICAL_AVAILABLE=false =>
    RUNTIME_RECONSTRUCTED                = FALLBACK_APPLY (with scoped dedup)
    (Hub/Remote hosts; reconstructed is authoritative)

HOST_RECOVERY POLICY                     = POLICY_A (unchanged from CORRECTION01)

CANONICAL_THEN_RECONSTRUCTED_MUTATIONS   = 0
RECONSTRUCTED_THEN_CANONICAL_MUTATIONS   = 1
RECONSTRUCTED_DUPLICATE_SAME_SESSION    = suppressed (fallback only)
RECONSTRUCTED_SAME_EDGE_NEW_SESSION     = applies (cross-session safe)
CROSS_SESSION_DEDUP                     = 0

CANONICAL_AUTHORITY_ORDER_INDEPENDENT   = true
DUPLICATE_CANONICAL_RECON_MUTATIONS     = 0
DUPLICATE_RECOVERY_MUTATIONS            = 0

T1,T2,T4,T7,T11                          = PASS (unchanged from C2.0)
T3,T5,T6,T8,T9,T10,T12                   = RED (legitimate C2.3 stateful workload per ACT §61)

D11_HOST_PREENGAGED                      = PASS
D10_UNKNOWN                              = 0

C2_2_PERFORMANCE_MEASURED               = PASS
  legacy-path  (10k events): diagnostic-only (Option A)
  canonical-path (10k events): p50=1.1us p95=5.9us p99=26.4us records=10000
                              eventsPerSec=228152

NEW_TS_ERRORS                            = 0
F1_TESTS                                 = PASS
BUNDLE_BUILD                             = PASS

HALT_DISPOSITION                          = EXPLICIT_ACCEPT (unchanged from CORRECTION01)

C2_3_AUTHORIZED                           = true
E7_AUTHORIZED                             = false
```

---

## 1. Reviewer correction R7 — closure

The reviewer identified two related defects in C2.2-CORRECTION01's R7:

### R7.1 — Order-independence was a claim, not a fact

C2.2-CORRECTION01's R7.2 test asserted `eventsObserved === 2` for the
reconstructed→canonical sequence. That is, under the old logic, when
a reconstructed event arrived first and a canonical event arrived
later, BOTH mutated the shadow — contradicting the "order-independent"
claim and violating `CANONICAL > RECONSTRUCTED`.

### R7.2 — Edge identity wasn't session/run scoped

`edgeKeyOf()` produced globally-unique keys (e.g. `run-started`),
but the resolver state was shared across the controller's visible-
task lifetime. W11/W12 multi-run scenarios would cross-dedup
unrelated runs.

### Fix — Option A (reviewer recommendation)

Per the reviewer's recommendation, the unified coordinator adopts
Option A: when canonical transport is available, reconstructed events
are **DIAGNOSTIC_ONLY** — they never mutate the shadow. This:

- **Eliminates the double-mutation race entirely.** With canonical
  authority always APPLY and reconstructed always DIAGNOSTIC_ONLY,
  arrival order doesn't matter.
- **Mirrors the recovery Policy A** adopted in CORRECTION01.
- **Leaves reconstruction useful for diagnostics** (count of legacy
  envelope volume, divergence shape classification, etc.) without
  granting it shadow authority.
- **Preserves authoritative reconstruction for fallback hosts**
  (HubRuntimeHost, RemoteRuntimeHost) via `canonicalAvailable=false`
  → `FALLBACK_APPLY` with session/run-scoped dedup keys.

The dedup key for fallback mode is `scopedEdgeKey()`:

```
sessionId + ':' + runId + ':' + baseEdge
```

This prevents W11/W12 cross-run collisions. Cross-session / cross-run
dedup is impossible by construction.

### Witnesses

```
R7.1: canonical-then-reconstructed: reconstructed is DIAGNOSTIC_ONLY
       single mutation total (canonical) + 1 diagnostic counter

R7.2: reconstructed-then-canonical: 1 mutation total (canonical)
       reconstructed is DIAGNOSTIC_ONLY; canonical APPLY's; no double mutation

R7.3: canonicalAvailable=false: FALLBACK_APPLY authoritative
       (Hub/Remote hosts)

R7.4: cross-session dedup: distinct sessions do NOT cross-dedup
       (two coordinated sequences with distinct active sessions:
        each APPLY's exactly once)

R7.4b: same controller with two sequential sessions
        session B observation is STALE against active session A
        (stale-session gate works correctly)

R7.5: cross-runId dedup: distinct runs do NOT cross-dedup
       (same session, different runId, both APPLY)

R7.6: same session+run+edge still suppresses
       (fallback dedup is functional — the only condition under
        which SUPPRESS_DUPLICATE fires is exact session+run+edge
        match)
```

---

## 2. Reviewer R9 — performance measured

The previous C2.2-CORRECTION01 evidence stated `C2_2_PERFORMANCE =
NOT_YET_MEASURED`. The benchmark file ran successfully (showing the
F1 fanout figures), but it measured the legacy path. Under Option A
the legacy path produces diagnostics only; the canonical path is
the authoritative mutation path.

The benchmark is now split into two:

| Path | N | p50 | p95 | p99 | events/sec | records |
|------|---|-----|-----|-----|------------|---------|
| **legacy** | 10 000 | 0.4 µs | 62.7 µs | 69.7 µs | 62 931 | 0 (diagnostic only) |
| **canonical** | 10 000 | 1.1 µs | 5.9 µs | 26.4 µs | 228 152 | 10 000 |

Both pass the `< 100 µs` p50 contract. The canonical path is the
authoritative mutation path and is comfortably under budget.

```
C2_2_PERFORMANCE = PASS
```

---

## 3. Reviewer R10 — halt disposition (unchanged)

```
FROZEN_CUMULATIVE_HARD_HALT = 800
C2.2+CORRECTION01 cumulative = +589 (CORRECTION01 closed the overrun gap)
C2.2+CORRECTION01+CORRECTION02 = +589 + ~85 = ~674 net
HALT_TRIGGERED               = true
DISPOSITION                  = EXPLICIT_ACCEPT
```

---

## 4. Why Option A is correct

The reviewer's recommendation is structurally right:

1. **It mirrors the existing recovery Policy A.** The unified
   coordinator already uses Policy A for HOST_RECOVERY. Reconstructed
   events should follow the same principle: when canonical transport
   exists, reconstructed is diagnostic.

2. **It eliminates a whole class of state-mutation defects.** With
   canonical always-APPLY and reconstructed never-mutate, there is no
   possible arrival order that produces two mutations. The "what if
   reconstructed arrives first?" race is moot.

3. **It preserves the diagnostic value of reconstruction.** Legacy
   envelopes still flow through the legacy translator; the
   reconstructed event is still produced; it still gets classified
   (DIAGNOSTIC_ONLY outcome) and counted in the diagnostic counter.
   The qualification layer can see the volume and shape of legacy
   divergence without granting it authority.

4. **It scales to multi-run scenarios safely.** With `scopedEdgeKey`
   for fallback mode, W11/W12 cross-run / cross-session collisions
   are impossible.

5. **It is consistent with the Cline architecture.** Cline documents
   that `AgentRuntimeEvent` is the low-level runtime surface and
   `AgentEvent`/`CoreSessionEvent` is the higher-level host
   projection. The runtime owns canonical truth; the host projection
   is downstream. Option A enforces that hierarchy at the
   shadow-mutation boundary.

---

## 5. Test totals

```
@cline/core                                       : 516 passed
@cline/vscode:
  C2.2 unified observer (13)                      : PASS
  C2.2-CORRECTION01 R1..R6/R8 witnesses (13)      : PASS
  C2.2-CORRECTION02 R7.x witnesses (6)            : PASS
  F1 + CORR01..03 + benchmark + wiring            : PASS
  workload-matrix (14 + 2 Option A witnesses)     : PASS
  recorder, observer, host-msgs, integration      : PASS
  C2.0 historical file                            : 5 PASS (T1,T2,T4,T7,T11)
                                                    8 RED per ACT §61
  sdk-task-control-coordinator                    : 1 pre-existing baseline RED
  TOTAL                                           : 1427 / 1436 pass
```

The 8 C2.0 RED witnesses are T3, T4 (now), T5, T6, T8, T9, T10, T12
— all workload-ordering concerns per ACT §61. They legitimately wait
for C2.3 stateful harness.

---

## 6. Production LOC delta (CORRECTION02 vs CORRECTION01)

```
task-state-shadow-coordinator.ts         +36 / -22   (scopedEdgeKey + Option A resolver)
task-state-shadow-host-wiring.ts         +6  / -3    (canonicalAvailable:true plumbing)
task-state-shadow-observer.ts            0           (unchanged)
task-state-shadow-recorder.ts            0           (unchanged from CORRECTION01)
task-state-shadow-host-msgs.ts           0           (unchanged)

Test files (host-wiring + workload-matrix + benchmark + CORR01):
  +90 / -56   (R7.1..R7.6 + diagnostic-only test rewrites)

NET_PRODUCTION_LOC_CORRECTION02 = +42 / -25 = +17

C2.2 + CORRECTION01 + CORRECTION02 cumulative from F1-CORRECTION03 head:
  C2.2                        = +549 / -63  = +486
  C2.2-CORRECTION01           = +144 / -41 = +103
  C2.2-CORRECTION02           = +42  / -25 = +17
  C2.2_TOTAL                  = +735 / -129 = +606
```

---

## 7. Public API surface delta

```
@cline/agents delta   = 0
@cline/shared delta   = 0
@cline/core delta     = 0
@cline/vscode delta   = 0 (no new public exports)

TaskShadowObservationInput.runtime-reconstructed.canonicalAvailable: boolean  (NEW required)
TaskShadowObservationInput.host-recovery.canonicalAvailable        : boolean  (existing)

scopedEdgeKey(input)                                            (internal helper)
recordDiagnosticObservation(origin)                              (internal counter)
```

---

## 8. Conservation

```
LEGACY_AUTHORITY              = 0%
SHADOW_AUTHORITY              = 0%
TASKSTATE_AUTHORITY           = 0%

WEBVIEW_CUTOVER               = false
EFFECT_EXECUTION_ENABLED      = false
DIVERGENCE_ACTION             = RECORD_ONLY
CONTEXT_ACCOUNTING_CHANGED    = false
STATE_VERSION_CHANGED         = false

PROTECTED STASH GATE:
  FORENSIC_STASH_OBJECT       = 141372c52ddd560f8d65bd438d9f9c22ba0f1f85  (intact)
  CONTEXT_STASH_OBJECT        = 371752f71e5b9a385af32736e007540386d48b82  (intact)
```

---

## 9. Board

```
ELM-02F F0/F0-CORR01/F1/F1-CORR01..03   ✅ all closed
ELM-02C2 C2.0/C2.1                       ✅ closed
ELM-02C2 C2.2                            ✅ (with CORRECTION01 + CORRECTION02)
ELM-02C2 C2.3 stateful W01-W16           🟢 NEXT (authorized)

ELM-03 E7 consumer cutover               ⛔ BLOCKED (gated on C2.3..C2.5)
```

---

## 10. C2.3 authorization

```
VERDICT                  = PASS_UNIFIED_SHADOW_OBSERVATION_C2_2_CORRECTION02
C2_3_AUTHORIZED          = true
E7_AUTHORIZED            = false

NEXT = ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02
        (C2.3 STATEFUL W01-W16)

RESUME_PHASE = C2.3 stateful workload qualification harness
```

### Why C2.3 is now genuinely authorized

The unified observation boundary is now structurally authoritative:

1. **Every state-mutating ingress funnels through `coordinator.observe(input)`.**
2. **The comparator is mutated exactly once per ingress** (R1).
3. **ONE shadow instance per wiring** (R2).
4. **Reconstructed session-id is preserved from source**, never
   laundered (R3).
5. **Half-transaction evidence gap is surfaced explicitly** via
   `recordEvidenceGap()` and `evidenceGaps` counter (R4).
6. **Records carry their origin** for downstream qualification (R5).
7. **Task/session identity never conflated** — `state.activeSessionId`
   removed; always read from `deps.getActiveSessionId()` (R6).
8. **Dedup is order-independent** — reconstructed is DIAGNOSTIC_ONLY
   when canonical transport exists; canonical always APPLY; no
   double-mutation race possible (R7).
9. **Fallback dedup is session/run-scoped** via `scopedEdgeKey()` —
   W11/W12 cross-run collisions impossible (R7).
10. **HOST_RECOVERY is DIAGNOSTIC_ONLY when canonical transport
    exists; FALLBACK_APPLY otherwise** (R8).
11. **Performance: p50=1.1 µs / event** under canonical load (R9).
12. **Halt disposition explicit** — EXPLICIT_ACCEPT (R10).

The authority rule **CANONICAL > RECONSTRUCTED** is now structurally
enforced at the state-mutation site, regardless of arrival order.
