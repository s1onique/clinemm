# E7.1 WEBVIEW-TURNSTATE LIVE-SHAPE-REPRODUCTION01 — plan

**ACT_ID:**
`ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-WEBVIEW-TURNSTATE-LIVE-SHAPE-REPRODUCTION01`

**Sub-step:** plan (no code yet)

**Verdict (this commit):** **CLOSED_PARTIAL / TRACE_DIMENSIONS_EXHAUSTED**
(initial v2 verdict was "AUTHORIZED"; revised in the same ACT after
R3 + R4 retraction from the post-C0 review). No production fix.
No test rung was committed. The isolation ladder was determined
to be unable to reproduce the W2 boundary from the existing
TRACE01 evidence because every required dimension is either
ALREADY_MATCHED (E1) or UNAVAILABLE_FROM_TRACE (E2..E10).

**Entry (this ACT):** `6735738606a6fbb7a4ae885958bf111e00e8b0e4`
(RED-FIX01 plan+corrections commit; LIVE-SHAPE plan itself is part
of the entry range — starting execution from the RED-FIX01 cleanup
commit alone would omit the authorization/freeze commit.)

**Predecessor:** `RED-FIX01 CLOSED_HALTED_CLEAN`

---

## §0  Mission

**Status (post-C0):** ACT CLOSED_PARTIAL / TRACE_DIMENSIONS_EXHAUSTED.
No rung in §2 was exercised (no test, no fixture change, no
production change). The §0–§1 sections below describe the
**would-be** mission if/when a future ACT re-opens the isolation
ladder with new live evidence (§9 → LIVE-CONTEXT-DIMENSIONS01).
They are preserved here as the contract the re-opened ladder
must honor, not as a current action plan.

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

## §1.5  C0 live TRACE01 inventory (mandatory pre-flight)

This subsection is the C0 evidence-resolution output produced by
re-reading the existing TRACE01 JSONL artifacts. It is the substrate
that the C0.5 table in §2 will be built on.

**C0.1 — HEAD rediscovered:**
```text
HEAD = 6735738606a6fbb7a4ae885958bf111e00e8b0e4
```

**C0.2 — worktree + stashes:**
```text
worktree                       = clean
git stash list                  = 2 entries intact:
  stash@{0} = ACT-ELM-02C2-dirty-failed-attempt-preserved-for-forensics
  stash@{1} = ACT-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01 forensic corrections
```

**C0.3 — TRACE01 JSONLs read** (SHA256 verified against the recorded
hashes in `docs/architecture/elm/evidence/e71-live-dogfood-authority-trace01/01-raw-shas.txt`):

```text
EXTENSION
  path     = /Volumes/UserData/Users/chistyakov/Downloads/post-terminal-authority-diagnostic-extension.jsonl
  bytes    = 8797
  lines    = 15
  sha256   = 577f625929d6cee7d79b2905eca0f91fb9095994fdd3a56fc1aff12318f8a454
  captureKind = extension-push (uniform)

WEBVIEW
  path     = /Volumes/UserData/Users/chistyakov/Downloads/post-terminal-authority-diagnostic-webview.jsonl
  bytes    = 24409
  lines    = 64
  sha256   = 70c3e309ff8f231dc6dd2a24812b824f2a9c4a42ecf35a148d75d687a935ee77
  captureKind breakdown = { webview-raw-incoming: 12,
                             webview-committed: 24,
                             action-buttons:    12,
                             input-section:     16 }
```

**C0.4 — per-push dimension freeze** (extension + webview):

```text
pushId | legacy       | runtime   | shadow    | stream | webview-raw     | webview-committed | stateVer
-------|--------------|-----------|-----------|--------|------------------|-------------------|----------
2      | idle/1       |  None     |  None     |  None  |  (no rec)        |  (no rec)         |   0
4      | idle/3       |  idle     |  idle     |  F/F   |  (no rec)        |  (no rec)         |   0
5      | idle/3       |  idle     |  idle     |  F/F   |  (no rec)        |  (no rec)         |   0
6      | idle/3       |  idle     |  idle     |  F/F   |  (no rec)        |  (no rec)         |   0
7      | idle/3       |  idle     |  idle     |  F/F   |  idle/3          |  idle/3           |   0
8      | idle/3       |  idle     |  idle     |  F/F   |  idle/3          |  idle/3           |   0
10     | idle/3       |  idle     |  idle     |  F/F   |  idle/3          |  idle/3           |   0
12     | streaming/11 |  idle     |  idle     |  F/F   |  streaming/11    |  idle/3 ⚠ DIVERGE |   0
14     | streaming/11 | running   | running   |  F/F   |  streaming/11    |  idle/3 ⚠ DIVERGE |   0
16     | streaming/11 | running   | running   |  T/T   |  streaming/11    |  idle/3 ⚠ DIVERGE |   0
18     | streaming/11 | running   | running   |  T/T   |  streaming/11    |  idle/3 ⚠ DIVERGE |   0
20     | streaming/11 | running   | running   |  T/T   |  streaming/11    |  idle/3 ⚠ DIVERGE |   0
23     | streaming/11 | running   | running   |  T/T   |  streaming/11    |  idle/3 ⚠ DIVERGE |   0
30     | awaiting/29  | completed | completed |  F/F   |  awaiting/29     |  idle/3 ⚠ DIVERGE |   0
31     | awaiting/29  | completed | completed |  F/F   |  awaiting/29     |  idle/3 ⚠ DIVERGE |   0
32     | awaiting/29  | completed | completed |  F/F   |  awaiting/29     |  idle/3 ⚠ DIVERGE |   0
```

**Key structural observations from the live trace:**

1. **`stateVersion` is uniformly `0`** on every single record
   (extension and webview). This matches the BASE fixture's default
   (`stateData.stateVersion ?? 0` in `ExtensionStateContext.tsx:644`).
   So the **E1 rung cannot introduce any new information**:
   `stateVersion` was already `0` in the live trace.
   **E1 = ALREADY_MATCHED.**

2. **No `epoch` value is stamped** in any of the captures
   (PTAD schema reserves the field but it is absent in the JSONL).
   So the **E2 rung cannot be evaluated against the live trace**:
   the snapshot epoch was **not captured**.
   **E2 = UNAVAILABLE.**

3. **No `clineMessages` body is stamped** in any webview-raw-incoming
   record. The raw captures record `legacyPhase/Seq`,
   `thinkingPresentation`, and `taskTelemetry` only — no partial
   message body, no `ts` on the message itself, no `partialMessage`
   flag. So the **E3 and E5 rungs cannot be evaluated against the
   live trace**. **E3 = UNAVAILABLE, E5 = UNAVAILABLE.**

4. **W2 classification rule from the trace** (the decisive fact):

   ```text
   If the EXTENSION legacyPhase advances (idle/3 → streaming/11),
   but the snapshot's runtime/shadow status is still "idle" or
   has not yet flipped to "running", then the snapshot's
   stateData.turnState is "idle/3" on the wire.

   The webview sees stateData.turnState = idle/3 and commits
   idle/3 (faithful behavior).
   ```

   The **producer-side** inconsistency between `legacyPhase` (one
   detection path: "did a stream chunk arrive?") and the
   snapshot's `turnState` (a different derivation) is the actual
   W2 boundary. This is **NOT a partial-message issue** (E5/E3
   irrelevant) and **NOT a stateVersion/epoch issue** (E1/E2
   already-matched/unavailable).

**C0.5 — C0 table built from the inventory:**

```text
rung | live value known? | different from BASE? | action
---- | ----------------- | -------------------- | ------
E1   | YES (stateVer=0)  | NO (BASE also uses ??0)| ALREADY_MATCHED
E2   | NO                | n/a                   | UNAVAILABLE
E3   | NO                | n/a                   | UNAVAILABLE
E4   | n/a               | n/a                   | UNAVAILABLE (depends on E3)
E5   | NO                | n/a                   | UNAVAILABLE
E6   | YES (pushes 4..32 chain via _ptadPushId)| YES (pushId monotonically advances 2..32) | POTENTIALLY_DIFFERENT — needs evaluation
E7   | n/a (no partial-message body in trace)   | n/a                  | UNAVAILABLE_FOR_TRACE
E8   | n/a                | n/a                  | UNAVAILABLE_FOR_TRACE
E9   | YES (welcomeViewCompleted; not in captures) | n/a             | UNAVAILABLE_FOR_TRACE
E10  | n/a                | n/a                  | UNAVAILABLE_FOR_TRACE
```

**Most consequential structural finding (retracted — see R3 below):**

> **RETRACTED in commit e3a0ad5b1's follow-up.** The §1.5 first
> pass incorrectly concluded that the W2 boundary was a
> producer-side inconsistency. It is not. See R3 retraction
> below.

The original (now-retracted) finding argued:

```text
LIVE_TRACE01_FINDING (RETRACTED) =
  W2 boundary = PRODUCER_SIDE
```

This was incorrect. The `webview-raw-incoming` capture at
`ExtensionStateContext.tsx:54` reads:

```ts
const rawIncomingLegacyPhase = rawStateData.turnState?.phase
```

where `rawStateData === stateData === JSON.parse(response.stateJson)`
(see `ExtensionStateContext.tsx:570` and `ExtensionStateContext.tsx:606`).
That means `rawIncomingLegacyPhase` is the **wire payload** of
`stateData.turnState.phase` — not a producer-side channel.

Therefore the wire supplied `streaming/11` at P12..P23 and P30..P32.
The webview committed `idle/3` because:

```ts
stateData.turnState = replicaRef.current.turnState
// ExtensionStateContext.tsx:652
```

i.e., the reducer-composed replica **replaced** the wire `turnState`
with its own seq-gated result. This is exactly the
`reducerApplyStateSnapshot` composer that RED-FIX01 was probing.
The WEBVIEW_LOCUS is therefore **still open and trace-supported**,
not retired.

**Retracted structural finding (corrected):**

```text
LIVE_TRACE01_FINDING (CORRECTED) =
  W2 boundary = RAW→COMMITTED WEBVIEW BOUNDARY
                wire supplied turnState=streaming/11
                reducer/replica returned turnState=idle/3
                committed = idle/3

WEBVIEW_LOCUS =
  STILL_OPEN / TRACE-SUPPORTED
  (not retired)

PRODUCER_SIDE_RECLASS =
  RETRACTED / NOT_PROVEN
```

The producer-side `runtimeStatus` / `shadowStatus` fields in the
extension JSONL are **distinct state channels** from `stateData.turnState`.
Their disagreement at P12 (legacyPhase=streaming/11, runtimeStatus=idle)
is real but does not imply that the wire `stateData.turnState` was
`idle/3`. The wire field is independently recorded by PTAD and
clearly says `streaming/11`.

---

### R4 retraction — E6 is UNAVAILABLE, not POTENTIALLY_DIFFERENT

The original C0 table marked `E6` as `POTENTIALLY_DIFFERENT`
because the live trace has 12 successive streaming/11 pushes.
That conflated **push chronology** with **preceding message /
replica history**. They are different experimental dimensions:

```text
E6_PRECEDING_MESSAGE_HISTORY =
  experimental dimension: clineMessages body / replica ts/seq history
  live evidence:         no clineMessages body in any capture
  verdict:               UNAVAILABLE

E6A_REPEATED_W1_SNAPSHOT_HISTORY =
  experimental dimension: N consecutive W1 snapshots with
                          identical or non-monotonic shape
  live evidence:         yes (P12..P23 are 6 successive streaming/11
                                  W1 snapshots, all consistently
                                  committed idle/3)
  verdict:               REQUIRES_OWN_RUNG / E6A
```

E6 must therefore be **UNAVAILABLE**. If a separate E6A rung is
ever opened, it must carry its own causal rationale and cannot
inherit the "preceding message history" semantics.

---

### Final C0.5 verdict table (post-retraction)

```text
rung | live value known? | different from BASE? | action
---- | ----------------- | -------------------- | ------
E1   | YES (stateVer=0)  | NO (BASE also uses ??0)| ALREADY_MATCHED
E2   | NO                | n/a                   | UNAVAILABLE
E3   | NO                | n/a                   | UNAVAILABLE
E4   | n/a               | n/a                   | UNAVAILABLE (depends on E3)
E5   | NO                | n/a                   | UNAVAILABLE
E6   | NO (no clineMessages body in trace)            | UNAVAILABLE
E7   | n/a (no partial-message body in trace)         | UNAVAILABLE_FROM_TRACE
E8   | n/a                                            | UNAVAILABLE_FROM_TRACE
E9   | YES (welcomeViewCompleted; not in captures)     | UNAVAILABLE_FROM_TRACE
E10  | n/a                                            | UNAVAILABLE_FROM_TRACE
```

**FIRST_GREEN_TO_RED_DELTA = NOT_FOUND**

The ladder cannot reproduce the W2 boundary from synthetic
dimensions because the live trace lacks the dimensions required
to reconstruct the live webview-side `setState` invocation context
(prevState, replica epoch, replica stateVersion, partial-message
body, queued local setState writers between raw and commit).

---

### What this ACT now resolves to

This ACT was an **isolation ladder** plan. The ladder is now
exhausted against the existing TRACE01 evidence. The current
verdict is therefore:

```text
LIVE-SHAPE-REPRODUCTION01 =
  CLOSED_PARTIAL / TRACE_DIMENSIONS_EXHAUSTED
  (was: AUTHORIZED in plan v2)
```

It is NOT:

```text
  PASS_LIVE_SHAPE_REPRODUCTION_LADDER_PARTIAL
```

because `PARTIAL` implies at least one rung was exercised and
returned a bounded verdict. Here every rung that *could* be
exercised was determined to be either ALREADY_MATCHED (E1) or
UNAVAILABLE_FROM_TRACE (E2..E10). No rung changed the BASE
fixture. No rung was committed.

The next ACT must therefore be **evidence acquisition**, not
synthetic reproduction. See §9 for the recommended next ACT.

---

## §2  Isolation ladder

Each rung must produce a single fact in one of three outcomes:

```text
GREEN         — the variant reproduces the W2 boundary (causal)
RED           — the variant does not reproduce the W2 boundary (refuted)
ALREADY_MATCHED — the variant has the same value as BASE; not evidence
                 of any kind; advance to next rung
UNAVAILABLE   — the live trace did not capture this dimension;
                 label it as such and do not fabricate a value
```

```text
EXPERIMENT    added dimension          result
BASE          none                     GREEN    (already established)
                                          (RED-FIX01 cleanup witness)

E1            stateVersion             GREEN | RED | ALREADY_MATCHED |
                                          UNAVAILABLE
E2            snapshot epoch           GREEN | RED | ALREADY_MATCHED |
                                          UNAVAILABLE
E3            W2 partial epoch         GREEN | RED | ALREADY_MATCHED |
                                          UNAVAILABLE
E4            E2 × E3 interaction      GREEN | RED | ALREADY_MATCHED |
                                          UNAVAILABLE
E5            partial ts/seq           GREEN | RED | ALREADY_MATCHED |
                                          UNAVAILABLE
E6            preceding message history GREEN | RED | ALREADY_MATCHED |
                                          UNAVAILABLE
E7            production conversion    GREEN | RED | ALREADY_MATCHED |
                                          UNAVAILABLE
E8            scheduling                GREEN | RED | ALREADY_MATCHED |
                                          UNAVAILABLE
E9            pre-existing W1 side effects GREEN | RED | ALREADY_MATCHED |
                                          UNAVAILABLE
E10           wider UI tree             GREEN | RED | ALREADY_MATCHED |
                                          UNAVAILABLE
```

Stop at the **first RED**. An experiment that changes nothing cannot
falsify a hypothesis: `ALREADY_MATCHED` is not GREEN evidence.

### C0 — Live-dimension resolution (mandatory pre-flight)

Before any test rung, the actual values stamped on the live TRACE01
artifacts must be read from the existing JSONL and tabulated. This
is a docs-only step (no test, no production change).

```text
C0.1  Rediscover HEAD == 6735738606a6fbb7a4ae885958bf111e00e8b0e4
C0.2  Verify clean worktree + protected stashes (141372c52, 371752f71)
C0.3  Read the existing TRACE01 JSONLs (extension + webview) at the
      recorded absolute paths
C0.4  Freeze, per relevant push:
        stateVersion
        snapshot epoch
        partial-message epoch (if represented in the trace)
        partial ts / seq (if represented)
C0.5  Compare each to BASE fixture values and label:
        ALREADY_MATCHED   (same as BASE)
        DIFFERENT         (will become a rung)
        UNAVAILABLE       (trace did not capture this dimension)
```

Build this table as the C0 deliverable:

```text
rung | live value known? | different from BASE? | action
---- | ----------------- | -------------------- | ------
E1   | yes/no            | yes/no               | TEST / ALREADY_MATCHED / UNAVAILABLE
E2   | yes/no            | yes/no               | TEST / ALREADY_MATCHED / UNAVAILABLE
E3   | yes/no            | yes/no               | TEST / ALREADY_MATCHED / UNAVAILABLE
E5   | yes/no            | yes/no               | TEST / ALREADY_MATCHED / UNAVAILABLE
```

Then build the **first rung that actually differs from BASE** (or,
if all are ALREADY_MATCHED, the first rung that is UNAVAILABLE in
the live trace — which then requires a probe rather than a
live-shape test).

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

## §4  Acceptance gate (post-C0 retraction)

```text
LSR_T0   ENTRY_HEAD                         6735738606a6fbb7a4ae885958bf111e00e8b0e4
                                                  (R1 correction)
LSR_T1   TRACE01_LIVE_W2                    PROVEN
LSR_T2   RED_FIX01_MINIMAL_FIXTURE          GREEN
LSR_T3   PRODUCTION_DELTA                   0

LSR_T4   LIVE_DIMENSION_INVENTORY           PASS   (C0 table produced,
                                                       corrected after
                                                       R3/R4 retraction)

LSR_T5   STATEVERSION_VARIANT               ALREADY_MATCHED (live trace
                                                       stateVer=0; BASE
                                                       also uses ??0)

LSR_T6   SNAPSHOT_EPOCH_VARIANT             UNAVAILABLE      (epoch not
                                                       stamped in trace)

LSR_T7   PARTIAL_EPOCH_VARIANT              UNAVAILABLE      (no partial-
                                                       message body in
                                                       trace)

LSR_T8   EPOCH_RELATION_VARIANT             UNAVAILABLE      (depends on
                                                       E3 / E7)

LSR_T9   FIRST_GREEN_TO_RED_DELTA           NOT_FOUND

→ CLOSED_PARTIAL / TRACE_DIMENSIONS_EXHAUSTED
  LSR_T10..12 are N/A (no candidate was found to ablate)
  LSR_T13..17 are N/A (no test rung was committed;
                       no fixture change; no PTAD change)

PRODUCER_SIDE_RECLASSIFICATION              RETRACTED / NOT_PROVEN
TRACE01_RAW→COMMITTED_DIVERGENCE            STILL_SUPPORTED
                                            wire supplied streaming/11
                                            committed idle/3
                                            (locus: webview reducer
                                             / replica)
CURRENT_ROOT_CAUSE                          UNKNOWN
BOUNDARY_LOCUS                               RAW→COMMITTED WEBVIEW
                                              BOUNDARY
NEXT_ACT                                     LIVE-CONTEXT-DIMENSIONS01
                                              (evidence acquisition,
                                               NOT a fix)
PRODUCTION_FIX                               NOT AUTHORIZED
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

5. **Each rung must be GREEN, RED, ALREADY_MATCHED, or
   UNAVAILABLE_FROM_TRACE.** No "yellow" results; if the result
   is ambiguous, that rung is UNAVAILABLE_FROM_TRACE and the next
   rung is tried. An `ALREADY_MATCHED` rung is NOT evidence of
   any kind — it must not be claimed as a GREEN confirmation.

6. **PTAD must remain unchanged.** This ACT does not modify the
   PTAD architecture, the `_ptadPushId` semantics, or the
   diagnostic capture kinds.

7. **Stashes are protected.** `141372c52` (FORENSIC) and
   `371752f71` (CONTEXT_ACCOUNTING) are read-only observations
   in this ACT.

---

## §6  State of the board at ACT start

```text
HEAD                            = 6735738606a6fbb7a4ae885958bf111e00e8b0e4
                                  (RED-FIX01 plan+corrections commit)
  RED-FIX01                       CLOSED_HALTED_CLEAN
  cleanup corrections             at 673573860
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

This ACT is **CLOSED_PARTIAL / TRACE_DIMENSIONS_EXHAUSTED** at the
current commit. The next step in this branch is **not yet
committed**; it must be authorized in a separate round.

**The next ACT is NOT a reproduction rung.** The C0 inventory
proved that no synthetic dimension in the current ladder can
reproduce the live W2 boundary because the live TRACE01 evidence
lacks the dimensions that would be needed to reconstruct the live
webview `setState` invocation context. Forcing a rung to "test
something" when the value being tested is identical to BASE
(ALREADY_MATCHED) or absent from the trace (UNAVAILABLE_FROM_TRACE)
is not evidence of any kind.

**The next ACT is evidence acquisition.** Recommended
authorization target:

```text
ACT-CLINEMM-ELM-ARCHITECTURE01-
E7.1-WEBVIEW-TURNSTATE-LIVE-CONTEXT-DIMENSIONS01
```

**Mission:**

> Acquire only the missing dimensions necessary to explain why a
> live `webview-raw-incoming streaming/11` becomes a committed
> `idle/3`, without changing state semantics.

**Required new observations (target list):**

```text
1. snapshot epoch
2. replica epoch immediately before W1
3. snapshot stateVersion
4. replica stateVersion immediately before W1
5. W1 updater invocation count per _ptadPushId
6. prevState.turnState at each W1 updater invocation
7. reducer output turnState (per invocation)
8. returned newState.turnState (per invocation)
9. partial-message epoch / ts / seq
10. identity of any queued local setState writer between raw
    and commit
```

The instrumentation must be **opt-in**, **temporary**, and carry
an **explicit removal clause** — not another permanent
instrumentation architecture. After the new trace exists, the
LIVE-SHAPE-REPRODUCTION01 ladder can be **re-opened** (in a fresh
ACT) with concrete values for dimensions that were UNAVAILABLE
here, and the first GREEN→RED delta can be sought without
speculation.

**Why this is the correct next move:**

- The current ladder has **no candidate dimension** that differs
  from BASE. Running any rung now would be ceremonial.
- The reviewer's recommendation: *"stop trying synthetic
  dimensions that the trace never captured. Instrument the one
  live raw→commit transition deeply enough to learn what
  React/reducer state existed inside it."*
- The boundary locus remains **RAW→COMMITTED WEBVIEW BOUNDARY** —
  it is not retired, just unmeasured at the required granularity.
- The producer-side reclassification is **RETRACTED / NOT_PROVEN**.
  Do not pursue producer-side composition as the next ACT.

**Honored constraints (carry forward):**

- **PRODUCTION_DELTA = 0** in this ACT (already 0)
- **PTAD_DELTA = 0** (existing PTAD remains the baseline; the new
  ACT may extend PTAD with opt-in temporary capture kinds, but the
  current capture kinds (`webview-raw-incoming`,
  `webview-committed`, `action-buttons`, `input-section`) must
  not change behavior)
- **DIFF_CHECK = clean** for every commit
- **PROTECTED_STASHES (141372c52, 371752f71) remain intact**
- **VSIX = byte-identical** to `8a7f1236... (8883021 bytes)`
- **LLM credential = NOT REQUIRED** in this ACT

**No fix is authorized in this ACT or the next.**
