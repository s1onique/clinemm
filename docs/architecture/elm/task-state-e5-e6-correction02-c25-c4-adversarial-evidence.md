# C2.5-C4 — C04_SYNTHETIC_REAL_CLASSIFIER_CHAIN adversarial evidence

**Subject:** ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.5-C4-ADVERSARIAL

**ENTRY_HEAD:** `9996a388` (C25-C3-CORRECTION01, frozen classifier contract)
**EXIT_HEAD:** `<this commit's tip>` (C25-C4 adversarial)
**PLAN:** docs/architecture/elm/task-state-e5-e6-correction02-c25-c4-adversarial-plan.md

## 1. C25-C4 ADVERSARIAL SCOPE

C25-C4 qualifies the **classifier+recorder chain** under non-causal-minimal
conditions that the C25-C3 P/N1/N2/N3 matrix deliberately excluded.

```
TRANSPORT_PROOF  = C-REAL-1..5  (C2.4-C, real Local → real wiring)
CLASSIFIER_PROOF = C25-C3       (canonical-event ingress → C-REAL chain)
JOINT_SYNTHETIC_REAL_C04_PROOF = TRANSPORT_PROOF ∧ CLASSIFIER_PROOF
```

C25-C4 does NOT re-verify the three-conjunct correctness — that was
frozen at C25-C3. C25-C4 verifies that runtime sequencing does not
break the C-REAL chain.

## 2. TEST RESULTS

All 12 tests pass:

| Test | What it proves |
|------|----------------|
| **C4-1** | P + tool-started + tool-finished: D01 = 1 (from P only); tool events produce no extra D01 |
| **C4-2** | back-to-back execution-state-changed: shadow state transitions through streaming then idle; no duplicate D01 |
| **C4-7** | tool events only: 0 D01 (no execution-state edge fired) |
| **C4-8** | P repeated 3x: D01 = 3 (no recorder/canonical-ingress dedup) `[CORRECTION01 R5]` |
| **C4-10** | shadow state rollback: P, finish, inactivate, P → D01=2 (1 per streaming activation cycle, same runId) `[CORRECTION01 R4]` |
| **C4-9** | dispose mid-stream: post-dispose observe STILL produces a D01 (wiring does NOT gate ingress) `[CORRECTION01 R2, sharpened by CORRECTION02 R8, restated by CORRECTION03 R12]` |
| **C4-12** | multiple wirings in same test: each is independent |
| **C4-13** | dispose + new wiring in same test: no leak between wirings |
| **C4-11** | session ID with special chars (`/.\\s_-`) is accepted verbatim |
| **C4-14** | arbiter inactive → D02_SHADOW_FALSE_ACTIVE (not D01) |
| **C4-15** | arbiter present but fully inactive → D02 (not D01) |
| **C4-16** | legacyPhase=streaming (no edge) → D00_AGREE (no D01, no D11) |

12/12 tests pass; runtime ~8ms.

## 3. EVIDENCE-STRENGTHENING (per C25-C3 reviewer's round-21)

C4-14 and C4-15 use a per-harness sample counter mirroring the
C3 harness. The witness captures the EXACT arbiter object that
fed the classifier (reference identity plus inner field values).
The retained recorder fields are derived from observationModel.activity;
the arbiter input is the canonical projection that is *not*
persisted to the recording but participates in arbiterActive. The
witness proves the projection that the classifier observed matches
the harness's intended arbiter snapshot.

C4-1, C4-8, C4-10, C4-11, C4-12, C4-13, C4-16 all use the
arbiterActive() helper; C4-2 and C4-7 use arbiterActive() at the
first event; C4-10 uses arbiterActive() at start and at the second
P event. C4-14 and C4-15 use arbiterInactive() and a fully
passive arbiter respectively to assert the D02 classification
result AND the exact same-observation arbiter sample.

## 3a. C25-C4-CORRECTION01 amendments (applied this commit)

C25-C4-CORRECTION01 applies five reviewer-flagged corrections:

* **R1** Plan doc trailing blank line stripped (Git whitespace
  diagnostic blank-at-eof at line 140 of
  task-state-e5-e6-correction02-c25-c4-adversarial-plan.md).
* **R2** C4-9 reframed: the wiring's dispose() only restores
  sessionOptions.onSessionEvent (see
  task-state-shadow-host-wiring.ts:527-530); it does NOT
  short-circuit the canonical-event ingress. The test now
  asserts the actual documented behavior (post-dispose observe
  still produces a fresh D01) rather than a wished-for one.

  **CORRECTION02 R8 / CORRECTION03 R12** (the surviving safety
  conclusion after sharpening): production safety does NOT
  depend on the C2.4-B FIXUP01 session-authority gate. The
  C4-9 fixture itself disproves session-authority sufficiency:
  after dispose() the session is still active, the same
  sessionId is still in `lifecycle.getActiveSession()`, the
  session-authority gate therefore passes, and a fresh D01 is
  recorded. The actual production safety property is that
  direct ingress remains callable after dispose(), and
  production safety therefore depends on the **subscription
  / owner teardown** preventing post-dispose invocation.
  The session-authority gate is a separate stale/wrong-
  session defense and is NOT sufficient when the disposed
  wiring is called with the still-active session ID.
* **R3** C4-14 / C4-15 add the per-harness sample witness used
  in C3. The previous wording in this section overclaimed that
  "the test verifies the EXACT arbiter input at the same
  observation"; the current wording is precise.
* **R4** C4-10 description changed from "1 per epoch" to "1 per
  streaming activation cycle". The two P inputs share the same
  runId; they belong to two streaming cycles within one task
  epoch, not two task epochs.
* **R5** C4-8 description changed from "no silent dedup" to "no
  recorder/canonical-ingress dedup". The test does not exercise
  coordinator edge-key dedup (which only applies to reconstructed
  streams, not to canonical-event ingress).

## 4. HYGIENE

```
PRODUCTION_LOC    = 0  (no source change)
TEST_DELTA        = +1 new test file
                    apps/vscode/src/sdk/__tests__/
                    c04-synthetic-real-classifier-chain-adversarial.c25-c4.test.ts
                    12 tests, ~440 lines
CONFIG_DELTA     = 0
PROTOCOL_DELTA    = 0
HUB_PRODUCTION_DELTA  = 0
REMOTE_PRODUCTION_DELTA = 0

PROTECTED_STASHES_INTACT = true
```

## 5. CARRY-FORWARDS (unchanged from C25-C3)

```
C25_ARB_SOURCE_RESIDUE = OPEN
  C25-C4 does NOT change the arbiter-mirror state
  E7 entry still requires REPLACE_LEGACY_ARBITER_MIRROR
```

C25-C4 is the robustness proof; the mirror decision lives in C25-C5.

## 6. BOARD (C2.5 after C25-C4)

```
C25-C0                                  CLOSED
C25-C1                                  SKIPPED
C25-C2 + C25-C2A + C25-C2A-CORRECTION01  CLOSED
C25-C3 + C25-C3-CORRECTION01              CLOSED
C25-C4 (this commit)                      CLOSED  (12/12 tests PASS)
C25-C5 terminal + E7 auth                 NEXT
C25_ARB_SOURCE_RESIDUE                    OPEN  (gates E7)
```

## 7. VERDICT

```
C25_C4_ADVERSARIAL_VERDICT    = PASS
TWELVE_C25_C4_TESTS_PASS      = 12
C25_C4_PATCH_HYGIENE          = PASS_AFTER_CORRECTION03
C25_C4_TYPECHECK_OWN_SOURCE   = 0  (after R11)
C25_C4_TYPECHECK_TRANSITIVE   = 1  (TaskModel in task-state-shadow.ts)
C25_C4_DISPOSE_SAFETY_FINDING = PASS_AFTER_CORRECTION03
C25_C4_DOC_CONSISTENCY        = PASS_AFTER_CORRECTION03
C25_C5_AUTHORIZED             = true
```

C25-C5 (terminal + E7 auth) is authorized on the strength of:
- TRANSPORT_PROOF     (C-REAL-1..5)
- CLASSIFIER_PROOF    (C25-C3 P/N1/N2/N3, three-conjunct correctness)
- ROBUSTNESS_PROOF    (C25-C4, 12 adversarial tests)
- JOINT_PROOF         = TRANSPORT_PROOF ∧ CLASSIFIER_PROOF

C25-C5 will close C2.4-D; C2.5 closes C2.5; E7 remains blocked on
C25_ARB_SOURCE_RESIDUE and the C2.5 terminal gate.
