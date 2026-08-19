# E7.1 WEBVIEW-TURNSTATE LIVE-SHAPE-REPRODUCTION01 — plan

**ACT_ID:**
`ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-WEBVIEW-TURNSTATE-LIVE-SHAPE-REPRODUCTION01`

**Sub-step:** plan (no code yet)

**Verdict (this commit):** **AUTHORIZED (isolation ACT, no production
fix in this ACT unless mechanism becomes uniquely proven)**

**Entry (this ACT):** `6735738606a6fbb7a4ae885958bf111e00e8b0e4`
(RED-FIX01 plan+corrections commit; LIVE-SHAPE plan itself is part
of the entry range — starting execution from the RED-FIX01 cleanup
commit alone would omit the authorization/freeze commit.)

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

**Most consequential structural finding:**

The live trace's W2 boundary is **not produced by any of the W2
hypotheses listed in the ladder (E1..E9)**. It is produced by a
producer-side inconsistency between the `legacyPhase` field and
the snapshot's `turnState` field. The minimal fixture faithfully
reproduces what the webview does given that inconsistency, because
**the webview was never the actor that emitted the streaming/11
turnState** — it only commits what the producer shipped, and the
producer shipped `idle/3`.

This means the **webview turnState-composition boundary as
characterized in RED-FIX01 does not exist** in the live trace.
The boundary is on the producer side, not the webview side. The
ACT must therefore **re-classify** before any test rung commits
to a hypothesis:

```text
LIVE_TRACE01_FINDING =
  W2 boundary = PRODUCER_SIDE
                legacyPhase advances but stateData.turnState does not
                → webview faithfully commits idle/3
                → cancel button stays hidden (root cause class)

WEBVIEW_TURNSTATE_COMPOSITION =
  Not the locus of the live W2 boundary
  → all E1..E9 rungs become UNAVAILABLE or ALREADY_MATCHED
  → the isolation ladder as written will return
    PASS_LIVE_SHAPE_REPRODUCTION_LADDER_PARTIAL at best
  → the next ACT must be re-targeted to producer-side state
    composition, not webview-side state composition
```

The **only** rung that *could* be different from BASE is **E6
(preceding message history)**: the live trace has 12 successive
streaming/11 pushes all consistently committing `idle/3`, whereas
the BASE fixture has 0 such pushes. But E6 is not a boundary on
the **composition** of one push; it is the **repetition** of the
producer's already-inconsistent emissions. It therefore tests
*repetition resistance*, not composition correctness.

The first rung this ACT should commit is therefore **E6**, with
the explicit caveat that the question being asked is not
"does the W2 boundary reproduce?" but "does the producer's
already-non-streaming state survive N consecutive streaming/11
pushes?". If E6 turns RED it is a finding about **producer
inertia**, not webview composition.

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

## §4  Acceptance gate

```text
LSR_T0   ENTRY_HEAD                         6735738606a6fbb7a4ae885958bf111e00e8b0e4
                                                  (R1 correction: the LIVE-SHAPE
                                                  plan itself is part of the
                                                  entry range; execution
                                                  baseline cannot be the
                                                  cleanup commit alone)
LSR_T1   TRACE01_LIVE_W2                    PROVEN
LSR_T2   RED_FIX01_MINIMAL_FIXTURE          GREEN
LSR_T3   PRODUCTION_DELTA                   0

LSR_T4   LIVE_DIMENSION_INVENTORY           PASS   (C0 table produced)

LSR_T5   STATEVERSION_VARIANT               RED | GREEN | ALREADY_MATCHED | UNAVAILABLE
LSR_T6   SNAPSHOT_EPOCH_VARIANT             RED | GREEN | ALREADY_MATCHED | UNAVAILABLE
LSR_T7   PARTIAL_EPOCH_VARIANT              RED | GREEN | ALREADY_MATCHED | UNAVAILABLE
LSR_T8   EPOCH_RELATION_VARIANT             RED | GREEN | ALREADY_MATCHED | UNAVAILABLE

LSR_T9   FIRST_GREEN_TO_RED_DELTA           FOUND | NOT_FOUND

if FOUND:
  LSR_T10 ABLATION                          PASS   (candidate dimension
                                                       removed → BASE GREEN)
  LSR_T11 CAUSAL_DIMENSION                  PROVEN_FOR_FIXTURE
  LSR_T12 LIVE_CAUSAL_DIMENSION             PROVEN only if the changed
                                                       value itself is
                                                       trace-derived;
                                                       otherwise
                                                       SYNTHETIC_MECHANISM_PROBE_ONLY

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
