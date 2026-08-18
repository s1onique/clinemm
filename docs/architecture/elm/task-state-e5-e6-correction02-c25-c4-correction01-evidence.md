# C2.5-C4-CORRECTION01 — adversarial evidence amendment

**Subject:** ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.5-C4-CORRECTION01

**ENTRY_HEAD:** `bcf1e2f35` (C25-C4 adversarial evidence, first commit)
**EXIT_HEAD:**  `<this commit's tip>`
**PLAN:** docs/architecture/elm/task-state-e5-e6-correction02-c25-c4-adversarial-plan.md
**EVIDENCE:** docs/architecture/elm/task-state-e5-e6-correction02-c25-c4-adversarial-evidence.md

## 1. WHY THIS CORRECTION EXISTS

The reviewer round-16 range digest identified four evidence
defects and one patch-hygiene defect in C25-C4 (`bcf1e2f35`).
All five are addressed in this commit. None is a semantic or
production defect.

```
C25-C4 SEMANTIC VERDICT  = PASS    (unchanged)
C25-C4 TEST VERDICT      = PASS    (unchanged, still 12/12)
C25-C4 PATCH HYGIENE     = PASS_AFTER_CORRECTION01
```

## 2. THE FIVE FIXES

### R1 — strip blank-at-EOF on the plan doc

`git diff --check HEAD~1 HEAD` reported:

```
docs/architecture/elm/task-state-e5-e6-correction02-c25-c4-adversarial-plan.md:140:
  new blank line at EOF.
```

Fix: trailing blank stripped from
`task-state-e5-e6-correction02-c25-c4-adversarial-plan.md`.

```
PRODUCTION_DELTA = 0
TEST_DELTA       = 0
CONFIG_DELTA     = 0
```

### R2 — C4-9 reframed to surface actual `dispose()` behavior

The original C4-9 said "subsequent observe is a no-op (no zombie
records)" but its body did not emit a second observe after
`dispose()`. The adversarial probe is now applied honestly:

```
observe(wiring, modelStreamStartedEvent())
const beforeDispose = wiring.records().length  // 1
wiring.dispose()
observe(wiring, modelStreamStartedEvent())
const afterDispose = wiring.records().length   // 2 — observed
```

This surfaces an important architectural fact:

```
TaskShadowHostWiring.dispose() implementation:
  deps.sessionOptions.onSessionEvent = userOnSessionEvent
                                    // 527-530 of wiring.ts

dispose() does NOT short-circuit observeCanonicalRuntimeEvent().
A canonical event delivered AFTER dispose() is still admitted
and produces a fresh D01 record.

Production callers must rely on the C2.4-B FIXUP01 session-
authority gate, NOT on dispose() alone, to prevent zombie
events.
```

The test now asserts the actual documented behavior.

```
PRODUCTION_DELTA = 0  (no production code change)
TEST_DELTA       = 1 test body rewritten (8 lines -> 24 lines)
```

### R3 — C4-14 / C4-15 add the per-harness sample witness

The previous C4-9 and the evidence doc §3 overclaimed
"the test verifies the EXACT arbiter input at the same
observation". The original `makeHarness` had:

```
getArbiterSnapshot: () => args.arbiter
```

which did not capture per-sample evidence. The corrected harness
mirrors the C3 harness:

```
const arbiterSamples: { count, last } = { count: 0, last: undefined }
getArbiterSnapshot: () => {
  arbiterSamples.count += 1
  arbiterSamples.last = args.arbiter
  return args.arbiter
}
return { wiring, resetForNewTask, arbiterSamples }
```

C4-14 and C4-15 now assert:

```
expect(arbiterSamples.count).toBe(1)
expect(arbiterSamples.last).toBe(injectedArbiter)
expect(arbiterSamples.last.execution.modelStreaming).toBe(false)
expect(arbiterSamples.last.execution.tooling).toBe(false)
expect(arbiterSamples.last.execution.awaitingApproval).toBe(false)
expect(arbiterSamples.last.pendingToolCalls.length).toBe(0)
```

This matches the C3 P / N2 evidence-strengthening pattern.

```
PRODUCTION_DELTA = 0
TEST_DELTA       = +18 lines (harness widening + 2 test bodies)
                  + 1 line on WiringHarness interface
```

### R4 — C4-10 wording: "1 per epoch" -> "1 per streaming activation cycle"

The two P inputs in C4-10 share the same `runId` and the test
does not mutate the task/run reset state. The two D01 records
therefore belong to two streaming activation cycles within one
task epoch, not two task epochs. Description and inline comment
updated.

```
PRODUCTION_DELTA = 0
TEST_DELTA       = 0  (wording-only)
```

### R5 — C4-8 wording: "no silent dedup" -> "no recorder/canonical-ingress dedup"

C4-8 uses identical runId, identical `now()` timestamp, and
identical previous/current execution edge across three stimuli.
The test asserts the recorder admits all three verbatim. This is
a recorder / canonical-ingress probe, NOT a global dedup probe.
Earlier C2.4 work established coordinator edge-key dedup
behavior on reconstructed streams; that dedup does NOT apply
to canonical-event ingress. Description updated to be precise.

```
PRODUCTION_DELTA = 0
TEST_DELTA       = 0  (wording-only)
```

## 3. NET EFFECT

```
PRODUCTION_SEMANTIC_DELTA    = 0  (no production change)
PRODUCTION_LOC               = 0
TEST_DELTA                   = 1 test rewritten (C4-9)
                            + 2 tests extended (C4-14, C4-15)
                            + 2 tests re-described (C4-8, C4-10)
                            + 1 harness widened (arbiterSamples witness)
                            + 1 plan doc trailing-blank stripped
CONFIG_DELTA                 = 0
PROTOCOL_DELTA               = 0

C25_C4_TESTS                 = 12 / 12 PASS  (unchanged)
C25_C4_PATCH_HYGIENE         = PASS_AFTER_CORRECTION01
C25_C5_AUTHORIZED            = true   (unchanged)
```

## 4. TEST RESULTS (this commit)

```
C4 12 adversarial tests       12/12 PASS  (~7ms)
C3 P/N1/N2/N3                 7/7 PASS    (unchanged)
c2-4-c-bridge (C-REAL-1..5)   5/5 PASS    (unchanged)
c2-4-d-hub                    15/15 PASS  (unchanged)
git diff --check HEAD~1 HEAD  exit 0      (was exit 2 at bcf1e2f35)
git diff --check              exit 0
typecheck:c2-4-d-hub          1 diagnostic matches baseline
typecheck:c2-4-c-bridge       1 diagnostic matches baseline
protected stashes intact      (FORENSIC + CONTEXT SHA-256 unchanged)
```

## 5. BOARD (C2.5 after C25-C4-CORRECTION01)

```
C25-C0                                 CLOSED
C25-C1                                 SKIPPED
C25-C2 + C25-C2A + C25-C2A-CORRECTION01  CLOSED
C25-C3 + C25-C3-CORRECTION01              CLOSED
C25-C4 + C25-C4-CORRECTION01              CLOSED  (this commit)
C25-C5 terminal + E7 auth                NEXT
C25_ARB_SOURCE_RESIDUE                 OPEN   (gates E7)

E7                                     ⛔ BLOCKED on C2.5
```
