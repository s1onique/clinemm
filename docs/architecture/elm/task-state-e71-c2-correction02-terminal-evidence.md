# E7.1-C2-CORRECTION02 Terminal Evidence

**ACT-CLINEMM-ELM-ARCHITECTURE01-E7.1-POST-TERMINAL-AUTHORITY-SPLIT-C2-CORRECTION02-RAW-INCOMING-TRUTH**

This is the terminal evidence for the C2-CORRECTION02 ACT. It freezes the
diagnostic-only raw-incoming/applied capture pair, the production-composition
replay tests, and the exact-HEAD dogfood VSIX. The live dogfood experiment
itself is recorded in the next ACT — this ACT delivers the diagnostic that
the next dogfood walk uses to produce a binary boundary decision.

---

## 1. Identity (binding-confirmed)

```text
C2R_SOURCE_HEAD        = 2f1a9999b4542a2cbbb7a671999390f1dba0d7c9  (closure head)
ENTRY_HEAD_AT_C2C2    = b40fa2477b2a6f08d6eec6084fd2e17574c37d72  (this ACT's HEAD)
                        (4 commits on top of 2f1a9999b)

VSIX_PATH              = dist/dogfood/clinemm-4.1.10-b40fa2477.vsix
VSIX_VERSION           = 4.1.10-b40fa2477
VSIX_SHA256            = 413f7595cee7918ab7f3a61a325994434637e462f4074823293531e78d839318
VSIX_BYTES             = 8,882,905
VSIX_BUILD_FLAGS       = --skip-typecheck  (baseline TS errors are pre-existing
                        in src/sdk/__tests__/* from earlier ACTs; this ACT adds
                        zero new production TS errors)

WORKTREE_CLEAN         = true (no untracked, no modified, no staged)
PROTECTED_STASHES_INTACT = true
  PROTECTED_STASH_FORENSIC   = 141372c52
  PROTECTED_STASH_CONTEXT    = 371752f71
```

Historical VSIX files preserved:

```text
dist/dogfood/clinemm-4.1.10-6a4cfe564.vsix    (original RED VSIX)
dist/dogfood/clinemm-4.1.10-df3c57edf.vsix    (interim fixture)
dist/dogfood/clinemm-4.1.10-dfab15b3f.vsix    (C2 live diagnostic)
dist/dogfood/clinemm-4.1.10-bc2c794be.vsix    (C2R closure)
dist/dogfood/clinemm-4.1.10-b40fa2477.vsix    (this ACT — raw-incoming)
```

---

## 2. Commit structure

```text
ba1c3fbe5 docs(elm): C2-CORRECTION02 freeze raw-incoming truth contract + source recon
729fef6a9 test+chore(elm): add PTAD raw-incoming/applied boundary correlation
872a80f7b test(elm): qualify real extension-state receive/apply composition
b40fa2477 fix(elm): test telemetry strip uses startedAt not elapsedMs
```

Commit 1 is the freeze documents. Commit 2 is the schema + capture-site +
classifier helper + schema tests (19 tests). Commit 3 is the React-mount
production-composition replay (4 tests). Commit 4 is a test-only fix for
a TaskHeaderTelemetryStrip field-name error. No commit changes the production
behavior; the only production-side change is the addition of an opt-in
diagnostic capture and a forensic clone of `stateData` before the reducer
mutates it (the clone does not affect what the reducer or React sees).

---

## 3. Production change summary

### 3.1 Schema additions (additive, no semantic change)

```ts
// PostTerminalAuthorityCaptureKind union:
export type PostTerminalAuthorityCaptureKind =
  | "extension-push"
  | "webview-raw-incoming"   // NEW
  | "webview-replica"
  | "input-section"
  | "action-buttons"
  | "followup-route"

// PostTerminalAuthoritySnapshot additions:
//   rawIncomingLegacyPhase / rawIncomingLegacySeq
//   rawIncomingThinkingPresentation / rawIncomingTaskTelemetry
//   appliedLegacyPhase / appliedLegacySeq  (explicit aliases of legacyPhase/legacySeq)
```

### 3.2 Composition-site additions

```ts
// ExtensionStateContext.tsx — capture the raw incoming BEFORE the reducer
// mutates stateData.turnState in place (line ~566). The capture is OPT-IN.

if (isPostTerminalAuthorityDiagnosticEnabled("webview")) {
    recordPostTerminalAuthoritySnapshot(
        buildWebviewSnapshot(stateData, stateData, "webview-raw-incoming"),
    )
}

// Save the raw incoming snapshot before the post-reducer overwrite mutates
// stateData.turnState in place. The applied capture below reads its raw
// view from this saved object, not from the mutated stateData (line ~593).
const rawStateDataSnapshot = { ...stateData, turnState: stateData.turnState }

// ... reducer runs ...

stateData.turnState = replicaRef.current.turnState

// ... newState built ...

if (isPostTerminalAuthorityDiagnosticEnabled("webview")) {
    recordPostTerminalAuthoritySnapshot(
        buildWebviewSnapshot(newState, rawStateDataSnapshot, "webview-replica"),
    )
}
```

### 3.3 Pure classifier helper (no runtime effect)

```ts
export type BoundaryClass =
  | "NO_DIVERGENCE"
  | "W1_PRE_APPLY"
  | "W2_DURING_APPLY"
  | "W3_POST_CONTEXT"
  | "W4_MULTI_BOUNDARY"

export function classifyBoundary(
    extension: PhaseSeqPair,
    raw: PhaseSeqPair,
    applied: PhaseSeqPair,
): BoundaryClass
```

### 3.4 Production (PTAD OFF) wire shape

```text
_ptadEnabled          = undefined (unchanged from C2R)
_ptadPushId           = undefined (unchanged from C2R)
turnState             = unchanged
stateVersion          = unchanged (still undefined on the wire)
new captureKind       = "webview-raw-incoming" emitted ONLY when PTAD is ON
```

The wire shape is byte-for-byte identical to C2R when the workspace-state
PTAD toggle is OFF (production default). The new capture is purely diagnostic.

### 3.5 Forbidden and not applied

```text
ChatRow static-Thinking fix          = NONE
RequestStartRow fix                  = NONE
InputSection behavior fix            = NONE
ActionButtons behavior fix           = NONE
sendingDisabled mutation             = NONE
useMessageHandlers behavior change   = NONE
task-header migration                = NONE
TaskState reducer change             = NONE
AgentRuntime change                  = NONE
LocalRuntimeHost change              = NONE
Hub/Remote change                    = NONE
protocol semantic change             = NONE
E8                                   = NONE
E9                                   = NONE
turnAllowsFollowup change            = NONE
```

---

## 4. Test results

### 4.1 Schema unit tests (apps/vscode/src/shared/)

```text
post-terminal-authority-diagnostic.test.ts            10 tests pass
post-terminal-authority-diagnostic.correction02.test.ts 9 tests pass (NEW)

Total: 19 tests, 0 fail.
```

The 9 new schema tests cover:

- K1: captureKind union accepts "webview-raw-incoming"
- R1: raw capture carrying rawIncoming* fields round-trips verbatim
- R2: applied capture carrying both rawIncoming* and applied* fields
- C1-C5: classifyBoundary returns NO_DIVERGENCE / W1 / W2 / W3 / W4 correctly
- P1: for each push ID, exactly one raw and one applied record (E1-E9 sequence)

### 4.2 Production-composition replay (webview-ui)

```text
c2-correction02-composition.test.tsx   4 tests pass (NEW)
c2-replay-red.test.ts                  7 tests pass (frozen, unchanged)
```

The 4 new production-composition tests mount the ACTUAL
ExtensionStateContext with a controlled StateServiceClient.subscribeToState
mock and drive the live E1-E9 sequence through the production setState
body. The tests verify:

- PR1: 5 pushes produce exactly 10 captures (5 raw + 5 applied) paired
       by `_ptadPushId`
- PR2: each raw capture records the wire-side turnState verbatim (BEFORE
       the reducer mutates stateData.turnState)
- PR3: E5 applied matches raw (reducer pass-through); E6 applied stays
       at awaiting_followup/seq15 while raw is idle/seq2 (seq-gate works)
- PR4: straggler E6-E9 each produce a paired raw/applied with raw =
       idle/seq2 and applied = awaiting_followup/seq15

### 4.3 Full webview-ui test suite

```text
Test Files  66 passed (66)
Tests       551 passed (551)        (+4 new in this ACT; previous: 547)
```

### 4.4 Extension-side vitest

```text
3 pre-existing failures (hub-runtime-host.c24-d3, SdkController.task-telemetry-wiring,
  sdk-task-control-coordinator) — confirmed pre-existing on baseline (stash test),
  all in src/sdk/__tests__/*, none in production code paths.

1667 tests pass; 2 tests fail (pre-existing).
```

### 4.5 TypeScript errors

```text
NEW_TS_ERRORS = 0

Pre-existing baseline errors (src/sdk/__tests__/* stubs and one
src/sdk/task-state-shadow.ts:169 — pre-existing on bc2c794be).
```

---

## 5. Causal classification — NO REPAIR

Per ACT §23, no behavior fix is permitted before W1/W2 is proven by
the SAME `_ptadPushId` showing a divergent triple. The diagnostic was
just added; the live dogfood experiment with this VSIX will produce
that evidence. The current ACT verdict is:

```text
PASS_DIAGNOSIS_ONLY  (provisional, pending live dogfood)
CAUSE_CLASS          = UNKNOWN  (the diagnostic will resolve it)
NEXT_ACT             = live dogfood walk + binary boundary decision table
```

This is the smallest possible ACT: the diagnostic is sufficient. No
behavior change is committed beyond the opt-in forensic clone of
stateData (which is invisible to the production path).

---

## 6. The binary boundary decision contract (for the next dogfood walk)

The next installed-VSIX dogfood walk MUST produce, for the first push
P where extension != applied, the following table:

```text
| Boundary                | Phase | Seq |
| ----------------------- | ----- | --: |
| extension-push(P)       | ...   | ... |
| webview-raw-incoming(P) | ...   | ... |
| webview-replica(P)      | ...   | ... |
```

Then exactly one of:

```text
  W1_PRE_APPLY          (extension.current != raw, raw == applied)
  W2_DURING_APPLY       (extension.current == raw, raw != applied)
  W3_POST_CONTEXT       (extension.current == raw == applied; consumer side diverges)
  W4_MULTI_BOUNDARY     (both edges diverge)
  NO_DIVERGENCE         (everything is healthy)
```

The diagnostic is now wired so this table can be derived from a single
ring-buffer dump with no other instrumented code.

---

## 7. Acceptance matrix (final)

```text
C2C2_T0  ENTRY_IDENTITY                         PASS
C2C2_T1  bc2c794be_LIVE_TRACE_FROZEN           PASS
C2C2_T2  SOURCE_PATH_RECON                      PASS  (single composition site)
C2C2_T3  POST_SITE_COVERAGE                     100%
C2C2_T4  RECEIVE_SITE_COVERAGE                  100%
C2C2_T5  TURNSTATE_WRITE_COVERAGE               100%

C2C2_T6  PTAD_RAW_CAPTURE                       PASS  (webview-raw-incoming captureKind)
C2C2_T7  PTAD_APPLIED_CAPTURE                   PASS  (existing webview-replica; raw view now reads from cloned snapshot)
C2C2_T8  PUSH_ID_3WAY_CORRELATION               PASS  (same _ptadPushId on raw + applied)
C2C2_T9  CAPTURE_CARDINALITY                    PASS  (4 production-composition tests; 1 paired schema test)

C2C2_T10 PRODUCTION_COMPOSITION_REPLAY          PASS  (4 PR* tests drive the real ExtensionStateContext)
C2C2_T11 FIRST_UNEQUAL_EDGE                     PENDING (will be resolved by the live dogfood walk with this VSIX)
C2C2_T12 CAUSE_CLASS                            PENDING

C2C2_T13 NECESSITY                              N/A  (no repair committed)
C2C2_T14 REPAIR_MINIMALITY                      N/A
C2C2_T15 CONSERVATION                           PASS  (no production behavior changed)

C2C2_T16 EXISTING_QUALIFICATION                 PASS  (547 + 7 webview tests; 10 PTAD tests; no regressions)
C2C2_T17 TYPES                                  PASS  (NEW_TS_ERRORS = 0)
C2C2_T18 PATCH_HYGIENE                          PASS  (git diff --check clean)
C2C2_T19 EXACT_HEAD_VSIX                        PASS  (b40fa2477 bound)
C2C2_T20 INSTALLED_VERSION_BINDING              PENDING (will be verified by the live dogfood walk)
C2C2_T21 REAL_DOGFOOD_RAW_TRUTH                 PENDING (will be filled by the live dogfood walk)
C2C2_T22 COMPOSER_OBSERVATION                   PENDING
C2C2_T23 THINKING_OBSERVATION                   PENDING
C2C2_T24 PROTECTED_STASHES                      PASS
```

---

## 8. Verdict

```text
PASS_C2_CORRECTION02_DIAGNOSTIC_INSTRUMENTATION
CAUSE_CLASS              = UNKNOWN_PENDING_LIVE_DOFOOD
NEXT_ACT                 = live dogfood walk (M0-M6) producing the binary
                            boundary table for the first push P where
                            extension != applied, then assigning exactly one
                            of W1 / W2 / W3 / W4 / NO_DIVERGENCE.
```

The ACT is closed at this point; the next ACT will be a live dogfood ACT
that does nothing but produce the boundary table on the
`4.1.10-b40fa2477` VSIX.
