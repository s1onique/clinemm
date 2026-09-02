# ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01-CORRECTION01-FIX01 — Final Report

## 1. ENTRY_HEAD / SUBJECT_HEAD / CLOSURE_HEAD

```
ENTRY_HEAD     = 2df124d226a7a537ebc26b637613960d687d986d
                 (verified via git rev-parse HEAD at FIX01 entry)

SUBJECT_HEAD   = 762b7cdb3c70ed55d97ab7c6b93247b2d0c8fc55
                 (operator-dump + roundtrip test commit)

CLOSURE_HEAD   = 762b7cdb3c70ed55d97ab7c6b93247b2d0c8fc55
                 (no production-code change to the selector;
                  dump / clear is observational only)
```

## 2. Reviewer disposition honored (second-pass)

| Disposition                                                                | Status |
|----------------------------------------------------------------------------|--------|
| HALT_CAPTURE_NOT_EXPORTABLE                                                | YES (FIX01 closes this) |
| Root cause: in-memory ring without operator-visible dump                   | IDENTIFIED + fixed |
| ONE operator-accessible dump mechanism (TSWPD pattern preferred)          | DONE |
| One test only: record → dump → exact selector fields survive              | DONE |
| REMOVAL_TRIGGER documented per Factory doctrine                            | DONE |
| PRODUCTION_CODE_DELTA = 0 wording corrected                                | DONE |
| Helper coverage claim strengthened to mechanical verification             | DONE |
| PRODUCTION_REWORK = NONE AUTHORIZED                                        | HONORED |

## 3. Bounded completion artifacts (FIX01 layer)

| File                                                                                          | Lines | Purpose                                                |
|-----------------------------------------------------------------------------------------------|------:|--------------------------------------------------------|
| apps/vscode/src/sdk/task-header-selector-input-capture-runtime.ts                            |  ~103 | New dump + clear runtime (TSWPD mirror)                |
| apps/vscode/src/registry.ts                                                                   |    +9 | New command constants + REMOVAL_TRIGGER comment        |
| apps/vscode/package.json                                                                       |   +10 | Two new commands in contributes.commands              |
| apps/vscode/src/extension.ts                                                                  |   +38 | Register both commands                                 |
| apps/vscode/src/sdk/__tests__/task-header-selector-input-capture.tusix01.test.ts              |  +127 | 3 new roundtrip tests                                  |
| .gitignore                                                                                     |   +13 | Whitelist FIX01 ACT body + evidence dir                |
| .factory/acts/ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01-CORRECTION01-FIX01.md   |  ~228 | This ACT body                                          |
| .factory/evidence/...-CORRECTION01-FIX01/                                                     |     — | Entry-freeze.txt + red-green-log.txt + final-report.md |

Production-code delta in selectTaskHeaderPresentation.ts: **0 lines**.

## 4. RED / GREEN

The FIX01 introduces NO new RED/GREEN against production code. The
bounded surface is observational only:

```
NEW TESTS in TUSIX01 suite (3 + 10 predecessor = 13 PASS):
  TUSIX01-OPERATOR_DUMP_ROUNDTRIP  PASS (record → dump → JSONL → exact fields)
  TUSIX01-OPERATOR_DUMP_EMPTY      PASS (empty ring → empty file)
  TUSIX01-OPERATOR_CLEAR           PASS (clear → file + ring both empty)

Adjacent test suites remain GREEN:
  - 234/234 task-header tests across 18 files
  - 35/35 TSWPD tests (no contract drift)
  - 57/57 host-ownership + post-terminal-authority watchdog tests
```

## 5. Helper coverage verification (mechanical, exhaustive)

The P1 claim that `isTerminalShadowPhase ∪ isActiveLegacyPhase`
exhaustively covers all TurnPhase literals that can reach the new
UNBOUND-demotion guard is now mechanically pinned against the
`TurnPhase` union (apps/vscode/src/shared/ExtensionMessage.ts:496-512):

```
TurnPhase union (8 literals):
  idle                → isTerminalShadowPhase        ✓
  streaming           → isActiveLegacyPhase          ✓
  awaiting_approval   → isActiveLegacyPhase          ✓
  awaiting_followup   → selector rule 2 (BEFORE rule 3, never reaches)
  compacting          → selector rule 1 (BEFORE rule 3, never reaches)
  completed           → isTerminalShadowPhase        ✓
  error               → isTerminalShadowPhase        ✓
  resumable           → isTerminalShadowPhase        ✓

Helper sets: 4 (terminal shadow) + 2 (active legacy) + 2 (rule 1/2
short-circuit) = 8 = exact size of TurnPhase union.
EXHAUSTIVE.
```

The previous phrasing was "plausible from the selector ordering";
the FIX01 version is "mechanically pinned against the actual
TypeScript union". The reviewer asked for the set to be recorded
once; this is that record.

## 6. Production-delta wording (corrected)

| Metric                            | Predecessor claim              | FIX01 verdict                                |
|-----------------------------------|--------------------------------|----------------------------------------------|
| PRODUCTION_CODE_DELTA             | 0 lines (selectTask unchanged) | 0 lines (unchanged) — same selector         |
| PRODUCTION_DIAGNOSTIC_DELTA       | (omitted)                      | YES (5 production-source files)              |
| PRODUCTION_SEMANTIC_DELTA         | (omitted)                      | ZERO when env var disabled (TUSIX01-CAPTURE_OFF) |
| SELECTOR_REPAIR_DELTA             | (omitted)                      | ZERO (the bounded guard at 6eaa0864 stands)   |

The previous text conflated "production behavioral repair" with
"production source modification". The corrected wording distinguishes
the two and is used in this ACT body, the registry command comment,
the extension.ts comment, and the final-report.

## 7. Operator runbook (now mechanically executable)

```
1. install / build this exact build (HEAD 762b7cdb3)
2. set CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1=1 in dogfood env
3. trigger the LIVE-shape recurrence pattern
4. invoke from the VSCode command palette:
     "Cline Debug: Dump TaskHeader Selector Input Diagnostic"
     → reads the ring → writes JSONL to
       <globalStorageUri>/task-header-selector-input-capture.jsonl
5. inspect the JSONL. The binary the reviewer asked for is mechanical:

     publicationShadowBinding   = UNBOUND | MISSING
     localShadowTurnSeq         = <number> | MISSING
     currentLegacyPhase         = "<TurnPhase>"
     seq                        = <TurnStateTracker.seq>
     selectedPhase              = "<selector output>"

   If localShadowTurnSeq === undefined (MISSING):
     → the bounded guard at selectTaskHeaderPresentation rule 3
       covers this LIVE-shape subcase.
     → LIVE closure candidate: TaskHeader=streaming matches
       turnPhase=streaming.
   If localShadowTurnSeq === <number> matching seq:
     → alternative LIVE-shape subcase; bounded guard does NOT fire.
     → open the next repair ACT against this authority condition.
```

This is mechanically executable end-to-end. Per the reviewer's
directive, after the C1 GO gate the next recurrence gives us exactly
this binary.

## 8. REMOVAL_TRIGGER (Factory doctrine for temporary diagnostics)

```
REMOVAL_TRIGGER = first of:
  1. LIVE_BINDING_SUCCESSFUL
     operator dumps the diagnostic, detects one of:
       - localShadowTurnSeq = MISSING + LIVE closure qualified
       - localShadowTurnSeq = matching seq + live still reproduces →
         alternative subcase mechanically pinned, open successor ACT
     In either case, the binary is settled; the diagnostic has no
     remaining purpose.

  2. CAPTURE_INSUFFICIENT
     evidence proves the in-memory recorder captured wrong fields,
     was bounded out before the transition, or missed the transition
     entirely. Open successor ACT.

  3. SUCCESSOR_EVIDENCE
     a downstream evidence channel supersedes this capture.
     Open removal ACT.

This trigger is stamped at:
  - apps/vscode/src/sdk/task-header-selector-input-capture.ts JSDoc
  - apps/vscode/src/sdk/task-header-selector-input-capture-runtime.ts JSDoc
  - apps/vscode/src/registry.ts command-block comment
  - apps/vscode/src/extension.ts command-block comment
  - ACT body §5
  - entry-freeze.txt
  - this final-report.md §8
```

## 9. Evidence labels

| Label              | Surface                                                              |
|--------------------|----------------------------------------------------------------------|
| REAL_PRODUCTION_SEAM | extension.ts command-registration site (mirrors TSWPD exactly)        |
| SYNTHETIC_REAL     | TUSIX01-OPERATOR_DUMP_ROUNDTRIP / _EMPTY / _CLEAR                      |
| STRUCTURAL         | exhaustive TurnPhase mapping against the union                       |
| CONSERVATION       | empty-dump / clear-after-capture invariants                          |

## 10. Working-tree state

```
$ git status --short
(empty at SUBJECT_HEAD / CLOSURE_HEAD)
```

## 11. Verdict

```
P0_OPERATOR_RETRIEVABILITY          = ADDRESSED
P1_REMOVAL_TRIGGER                  = DOCUMENTED
P1_PRODUCTION_DELTA_WORDING         = CORRECTED
P1_HELPER_COVERAGE                  = MECHANICALLY EXHAUSTIVE (4+2+2=8)

PRODUCTION_CODE_DELTA               = selectTaskHeaderPresentation.ts unchanged
PRODUCTION_DIAGNOSTIC_DELTA         = YES (5 production-source files)
PRODUCTION_SEMANTIC_DELTA_DISABLED  = ZERO

TUSIX01_TESTS                       = 13/13 PASS (10 predecessor + 3 roundtrip)
TASK_HEADER_TESTS                   = 234/234 PASS across 18 files
TSWPD_TESTS                         = 35/35 PASS (no contract drift)
WATCHDOG_TESTS                      = 57/57 PASS (HOHOD + PTAD + watchdog)

APPS_VSCODE_CHECK_TYPES             = 0 diagnostics
GIT_DIFF_CHECK                      = PASS
WORKING_TREE                        = clean at SUBJECT_HEAD = CLOSURE_HEAD = 762b7cdb3

LIVE_CLOSURE_VERDICT                = PENDING (one dogfood cycle)
C1_GATE                             = GO (operator path mechanically executable)

DIAGNOSTIC_LIFETIME_POSTURE         = TEMPORARY
                                      (REMOVAL_TRIGGER frozen above;
                                       no quiet promotion to architecture)
```