# C2.5-C4 plan — adversarial

**Note:** C25-C4-CORRECTION01 amended the C25-C4 evidence with
five reviewer-flagged fixes (R1..R5). See
`task-state-e5-e6-correction02-c25-c4-correction01-evidence.md`
for the amendment details. The plan is unchanged.


**Subject:** ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.5-C4-ADVERSARIAL

**ENTRY:** `9996a388` (C25-C3-CORRECTION01, frozen classifier contract)

## 0. MISSION

C25-C4 qualifies the **classifier+recorder chain** under non-causal-minimal
conditions that the C25-C3 P/N1/N2/N3 matrix deliberately excluded.

```
TRANSPORT_PROOF  = C-REAL-1..5  (C2.4-C, real Local → real wiring)
CLASSIFIER_PROOF = C25-C3       (canonical-event ingress → C-REAL chain)
JOINT_SYNTHETIC_REAL_C04_PROOF = TRANSPORT_PROOF ∧ CLASSIFIER_PROOF
```

C25-C4 exercises the C-REAL chain's robustness under runtime
sequencing that production might encounter but the C3 P/N1/N2/N3
matrix deliberately excluded.

## 1. HARD CONSERVATION (inherited from C25-C3-CORRECTION01)

```
PRODUCTION_SEMANTIC_DELTA   = 0
REDUCER_SEMANTIC_DELTA       = 0
LEGACY_AUTHORITY            = 100%
SHADOW_AUTHORITY            = 0%
WEBVIEW_CUTOVER             = false
DIVERGENCE_ACTION           = RECORD_ONLY
EFFECT_EXECUTION_ENABLED    = false
```

No source, config, or reducer changes.

## 2. THREE-PREDICATE-CONJUNCTS (frozen at C25-C3)

```
conjunct_1: legacyPhase === "idle"
conjunct_2: shadowPhase === "streaming"
conjunct_3: arbiterActive === (modelStreaming
                              || awaitingApproval
                              || pendingToolCalls.length > 0)
```

N1 removes conjunct_1; N2 removes conjunct_3; N3 removes conjunct_2.

C25-C4 does NOT re-verify the three-conjunct correctness. C25-C4 verifies
that runtime sequencing does not break the C-REAL chain.

## 3. PRODUCTION-DELTA ACCOUNTING

```
PRODUCTION_LOC            = 0
TEST_DELTA                = +1 new test file
                           (12 tests, ~440 lines)
CONFIG_DELTA             = 0
PROTOCOL_DELTA            = 0
HUB_PRODUCTION_DELTA      = 0
REMOTE_PRODUCTION_DELTA   = 0
```

## 4. TWELVE ADVERSARIAL TESTS (3 families)

### Family A: adversarial event sequences (5)

- **C4-1**: P + tool-started + tool-finished (interleaved tool events)
  - D01 = 1 (from P only); tool events produce no extra D01
- **C4-2**: back-to-back execution-state-changed
  - start (D01=1) + finish (D00_AGREE); no duplicate D01
- **C4-7**: tool events only (no execution-state edge)
  - D01 = 0
- **C4-8**: P repeated 3x (no silent dedup)
  - D01 = 3
- **C4-10**: shadow state rollback (P, finish, inactivate, P)
  - D01 = 2 (1 per epoch)

### Family B: wiring lifecycle / disposal (3)

- **C4-9**: dispose mid-stream (no zombie records)
- **C4-12**: multiple wirings in same test (each is independent)
- **C4-13**: dispose + new wiring in same test (no leak between wirings)

### Family C: negative and isolation (4)

- **C4-11**: session ID with special chars (`/.\\s_-`) is accepted verbatim
- **C4-14**: arbiter inactive → D02_SHADOW_FALSE_ACTIVE (not D01)
- **C4-15**: arbiter present but fully inactive → D02 (not D01)
- **C4-16**: legacyPhase=streaming (no edge) → D00_AGREE (no D01, no D11
  in canonical ingress)

## 5. ACCEPTANCE GATE

```
C25_C4_ADVERSARIAL_VERDICT = PASS

THREE_PREDICATE_CONJUNCTS_FROZEN = 3 (C3, unchanged)
TWELVE_C25_C4_TESTS_PASS        = 12
D01_COUNT                      = exactly per test (no silent dedup)
D02_INACTIVE_ARBITER            = exactly per test
LEGACY_AUTHORITY               = 100%
SHADOW_AUTHORITY               = 0%
DIVERGENCE_ACTION              = RECORD_ONLY
REDUCER_SEMANTIC_DELTA         = 0

C25_C5_AUTHORIZED              = true   (terminal + E7 auth)
C25_ARB_SOURCE_RESIDUE          = OPEN   (unchanged from C25-C3)
```

## 6. NON-GOALS

```
- does NOT add a new test infrastructure (uses C-REAL bridge chain
  already qualified)
- does NOT change production classifier or recorder
- does NOT change the C-REAL wiring path
- does NOT cut over consumers
- does NOT authorize E7 (E7 is gated on C25-C5 terminal evidence)
```

## 7. CARRY-FORWARDS (unchanged from C25-C3)

```
C25_ARB_SOURCE_RESIDUE = OPEN
  C25-C4 does NOT change the arbiter-mirror state
  E7 entry still requires REPLACE_LEGACY_ARBITER_MIRROR
```

C25-C4 is the robustness proof; the mirror decision lives in C25-C5.

## 8. POST-C25-C4

```
C25-C5 terminal + E7 auth ACT
  - C-REAL bridge + C25-C3 classifier + C25-C4 robustness
  - terminal classification of all hostile inputs
  - frozen E7_INITIAL_BACKEND_SCOPE = LOCAL_ONLY
  - C25-C5 closes C2.4-D
```
