# E7.1 WEBVIEW-TURNSTATE LIVE-SHAPE-REPRODUCTION01 — plan

**ACT_ID:**
`ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-WEBVIEW-TURNSTATE-LIVE-SHAPE-REPRODUCTION01`

**Sub-step:** plan (no code yet)

**Verdict (this commit):** **AUTHORIZED (isolation ACT, no production
fix in this ACT unless mechanism becomes uniquely proven)**

**Entry (this ACT):** `24aeb6464` (RED-FIX01 cleanup closed-halted-clean)

**Predecessor:** `RED-FIX01 CLOSED_HALTED_CLEAN`

---

## §0  Mission

Starting from the known-green real-provider fixture, introduce **one
live-trace dimension at a time**. Identify the **first dimension or
minimal combination** that changes the fixture from GREEN to the live
W2 RED. Do not alter production behavior in this ACT.

If the first GREEN→RED delta is found, perform ablation:

```text
candidate dimension present    → RED
candidate dimension removed    → GREEN
```

Only after that:

```text
CAUSAL_DIMENSION = PROVEN
```

If no single dimension turns RED, permit pairwise combinations **only
among dimensions already justified by source dependencies**, starting
with:

```text
snapshot epoch      × W2 partial-message epoch
snapshot epoch      × stateVersion
W2 partial epoch    × message history
```

Do not combinatorially fuzz the entire state object.

---

## §1  Background

The RED-FIX01 ACT (closed-halted-clean at `24aeb6464`) established:

```text
REDUCER_SIMPLE_SEQ_GATE_DEFECT    = NOT_SUPPORTED
LINE_652_SIMPLE_COPY_DEFECT       = NOT_SUPPORTED
SIMPLE_W1_W2_W1_BATCH_FAILURE     = NOT_REPRODUCED
MINIMAL_W1_W2_W1_BATCHING_HYPOTHESIS = NOT_REPRODUCED

ROOT_CAUSE                        = UNKNOWN
MISSING_LIVE_DIMENSION            = PROVEN_TO_EXIST
GLOBAL_REPLICA_QUEUE_INTERACTION  = NOT_EXCLUDED
```

The LIVE TRACE (TRACE01) shows:

```text
extension streaming/11
raw        streaming/11
committed  idle/3
→ W2 PROVEN
```

The MINIMAL PROVIDER FIXTURE (RED-FIX01 cleanup) shows:

```text
raw       streaming/11
committed streaming/11
→ W2 NOT REPRODUCED
```

The minimal fixture is missing at least one live-trace dimension
that the production W1→W2→W1 sequence carries. The isolation ladder
below is the systematic attempt to recover that dimension.

---

## §2  Isolation ladder

Each rung must produce a single fact:

```text
EXPERIMENT    added dimension          result
BASE          none                     GREEN    (already established)

E1            stateVersion             GREEN | RED
E2            snapshot epoch           GREEN | RED
E3            W2 partial epoch         GREEN | RED
E4            E2 × E3 interaction      GREEN | RED
E5            partial ts/seq           GREEN | RED
E6            preceding message history GREEN | RED
E7            production conversion    GREEN | RED
E8            scheduling                GREEN | RED
E9            pre-existing W1 side effects GREEN | RED
E10           wider UI tree             GREEN | RED
```

Stop at the **first RED**.

### E1 — stateVersion

Reproduce the actual live snapshot `stateVersion` sequence.
This is directly fed to `reducerApplyStateSnapshot`. A first-rung
candidate because it is the most directly observable authority
dimension on the W1 path.

### E2 — snapshot epoch

Exact W1 epochs from the live shape, if recoverable. The writer
audit establishes that W2 cannot directly write `turnState`, but
W2 does mutate the replica's epoch (via `reducerApplyMessage`),
which the next W1 subsequently consumes. This is the high-value
hypothesis.

### E3 — W2 partial-message epoch

Especially test an epoch **different from** the surrounding W1
snapshot. The classical cross-stream epoch interference test:

```text
W1: epoch = E, turnState = idle/3
W2: epoch = E+1
W1: epoch = E, turnState = streaming/11

Hypothesis: the final W1 becomes stale against the replica epoch
and leaves old turnState in place.
```

### E4 — E2 × E3 interaction

Because an epoch mismatch may be a **relational property** rather
than either scalar alone. Test only after E2 and E3 are both
individually GREEN, or directly if E2/E3 individually turn RED.

### E5 — exact partial `ts` / `seq`

Use production-like values. The partial message has its own
authoritative ordering dimensions.

### E6 — preceding message/replica history

Replay the smallest reconstructable history before the first live
divergence. The reducer may depend on the full preceding message
sequence to compute the next state.

### E7 — production conversion

Drive the actual `convertProtoToClineMessage` shape rather than
a hand-built approximation. The wire-level path may transform the
partial message differently than the synthetic fixture.

### E8 — scheduling

Separate callbacks/microtasks/macrotasks matching the live path
rather than simply one `act()` batch. The R3 review flagged
React's batching and queue ordering as legitimate concerns that
the synthetic GREEN-witness fixture does not exercise.

### E9 — pre-existing W1 side effects

`welcomeViewCompleted = false`, so `setShowWelcome` /
`setOnboardingModels` / `setDidHydrateState` may fire and interleave
with the W1 updater. These are separate React state setters; they
may cause additional renders, but their independent existence is
not evidence of overwriting this context's `turnState`.

### E10 — wider UI tree

Only if everything above stays GREEN. The E10 rung is a high-cost
expansion of the causal surface and is the rung of last resort.

---

## §3  Why epoch deserves priority (E2/E3/E4)

The writer audit establishes that W2 cannot directly set
`turnState`, but it **can change other replica authority dimensions**
including epoch/message state, which the next W1 subsequently
consumes.

So the high-value experiment is the cross-stream epoch interference:

```text
W1: epoch = E, turnState = idle/3
W2: epoch = E+1
W1: epoch = E, turnState = streaming/11
```

Observe:

```text
replica epoch before final W1
incoming snapshot epoch
final replica turnState
committed turnState
```

If that goes RED while BASE stays GREEN, a very small causal delta
has been isolated.

**Important:** Do not immediately call that a bug. Depending on
the frozen epoch contract, the final W1 may correctly be considered
stale. The next question would then be whether the **producer is
emitting inconsistent epochs** or the webview's **cross-stream
epoch arbitration is wrong**.

---

## §4  Acceptance gate

```text
LSR_T0   ENTRY_HEAD                         24aeb6464...
LSR_T1   TRACE01_LIVE_W2                    PROVEN
LSR_T2   RED_FIX01_MINIMAL_FIXTURE          GREEN
LSR_T3   PRODUCTION_DELTA                   0

LSR_T4   LIVE_DIMENSION_INVENTORY           PASS
LSR_T5   STATEVERSION_VARIANT               EXECUTED
LSR_T6   SNAPSHOT_EPOCH_VARIANT             EXECUTED
LSR_T7   PARTIAL_EPOCH_VARIANT              EXECUTED
LSR_T8   EPOCH_RELATION_VARIANT             EXECUTED

LSR_T9   FIRST_GREEN_TO_RED_DELTA           FOUND | NOT_FOUND

if FOUND:
  LSR_T10 ABLATION                          PASS
  LSR_T11 CAUSAL_DIMENSION                  PROVEN
  LSR_T12 ROOT_CAUSE_CLASS                  BOUNDED

if NOT_FOUND:
  LSR_T10..12                               N/A
  NEXT_DIMENSION                            explicitly frozen

LSR_T13  WEBVIEW_TEST_SWEEP                 PASS
LSR_T14  TYPES                              PASS
LSR_T15  BIOME                              PASS
LSR_T16  DIFF_HYGIENE                       PASS
LSR_T17  PROTECTED_STASHES                  PASS
```

### Allowed outcomes

```text
PASS_LIVE_SHAPE_CAUSAL_DIMENSION_FOUND

or

PASS_LIVE_SHAPE_REPRODUCTION_LADDER_PARTIAL
```

The second is **not a failure** if all tested dimensions remained
green; it simply authorizes the next bounded rung.

No production fix in this ACT.

---

## §5  Hard rules

1. **No production code change** in this ACT unless the mechanism
   becomes uniquely proven AND the ACT explicitly contains a gated
   repair phase. The current plan does not authorize the repair
   phase.

2. **One dimension per rung.** Do not batch multiple dimensions
   in a single experimental commit.

3. **No combinatorial fuzzing.** Pairwise combinations are only
   permitted among dimensions already justified by source
   dependencies.

4. **Stop at the first RED.** Do not press on once a causal
   dimension is isolated. The ablation step (LSR_T10) must succeed
   before LSR_T11.

5. **Each rung must be GREEN or RED.** No "yellow" results; if the
   result is ambiguous, that rung is N/A and the next rung is
   tried.

6. **PTAD must remain unchanged.** This ACT does not modify the
   PTAD architecture, the `_ptadPushId` semantics, or the
   diagnostic capture kinds.

7. **Stashes are protected.** `141372c52` (FORENSIC) and
   `371752f71` (CONTEXT_ACCOUNTING) are read-only observations
   in this ACT.

---

## §6  State of the board at ACT start

```text
HEAD                            = 24aeb6464
  RED-FIX01                       CLOSED_HALTED_CLEAN
  cleanup corrections             (this docs commit)
VSIX_017f68a36                  = 8a7f1236... (8883021 bytes, byte-identical)
STASHES                         = 141372c52 + 371752f71 intact
PRODUCTION_SURFACE              = byte-identical to pre-RED-FIX01
PTAD_ARCHITECTURE               = unchanged
LIVE_PROOF                      = AWAIT_USER (TRACE01 captures only)
```

---

## §7  Chain context (top 8)

```text
24aeb6464 test+docs(elm): RED-FIX01 cleanup — close halt cleanly, revert seam
ec4415b6e docs+test(elm): RED-FIX01 C1+C2+C3 halted — RED not reproduced
a2ffc9bac docs(elm): RED-FIX01 plan + C0 composition writer recon (read-only)
5e83022ba docs(elm): TRACE01 finalize provenance + updater-purity wording
0b008509d docs(elm): TRACE01 hygiene + qualification bounds
a4908d59c docs(elm): E7.1 LIVE-DOGFOOD-AUTHORITY-TRACE01 existing-evidence ingest
8ec86ec9a docs(elm): WEBVIEW-TURNSTATE-COMPOSITION01 precondition halt
fd24fc4b5 docs(elm): C2-CORRECTION02-FIXUP04 qualification correction
```

---

## §8  What this ACT does NOT do

- It does not change production code.
- It does not introduce new test seam instrumentation.
- It does not modify PTAD architecture.
- It does not rebuild the VSIX.
- It does not require live dogfood.
- It does not require LLM credentials.
- It does not authorize any production fix.

It is the rigorous continuation of RED-FIX01's isolation discipline
into the next causal rung.

---

## §9  Next step after this docs commit

The next step in this branch is **not yet committed**; it must be
authorized in a separate round. When authorized, the next commit
will be either:

- A `test(elm)` commit containing the E1 (`stateVersion`) variant
  of the RED-FIX01 test fixture, with full diff-hygiene and PTAD
  invariants preserved; OR
- A `docs(elm)` commit further bounding RED-FIX01 if the reviewer
  requires additional qualification.

The exact rung (E1) is recommended as the first because it is the
most directly observable authority dimension on the W1 path. E2/E3
are recommended as the **second** rung because they are the
highest-value hypothesis (the cross-stream epoch interference
story).
