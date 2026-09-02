
# ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01

## State (twenty-second-pass, 2026-09-03)

```text
W producer                = CLOSED
W cadence                 = CLOSED
runtime state             = CLOSED
runtime publication       = CLOSED
durable transition tests  = CLOSED
HOST_PUBLICATION          = COMPOSED PROOF / ACCEPTED
NO_INDEPENDENT_W_SCALAR_ON_EVENT = TRUE

Boundary 3 capture        = CLOSED
Boundary 3 -> 4 transport = CLOSED
Boundary 4 webview state  = CLOSED
Boundary 5 header         = CLOSED
P1 percentage delta       = REVERTED (this commit)
DOGFOOD test reclassified = CLOSED (this commit)
Terminal cleanup          = OPEN  (non-blocking)
LIVE_QUALIFICATION        = PENDING  (next cycle)

NECESSITY_OF_HOST_CAPTURE = PROVEN
IMPLEMENTATION_CHAIN      =
  CLOSED / TESTED IN COMPOSED PIECES
NEW_REVIEW_ROUND          = NO
C1                        = GO_LIVE_QUALIFICATION
```

Reviewer on 2b371761d (twenty-first-pass):
```text
PASS_WITH_ONE_P1_FIX.

The important repair is sound: W now reaches
ContextWindow, a numeric W takes precedence over
provider-derived P, explicit no-W does not
silently masquerade as P, and the legacy/omitted
path still has a P fallback. The range shows the
expected narrow chain through
ChatView -> TaskSection -> TaskHeader -> Context
Window, plus the `number | null | undefined`
transport distinction.

ONE P1: remove the unrelated percentage rounding.

This change is not necessary for the W repair:
  percentage: Math.round((numerator / context
                  Window) * 100)
Previously the component preserved the raw ratio:
  percentage: (lastApiReqContextInputTokens /
                contextWindow) * 100
That is an independent presentation-semantic
change bundled into a causal repair. Even if
"135.6685%" is ugly somewhere downstream,
Boundary 5 does not require changing percentage
precision.

The Factory conservation rule here should be:
  ONLY_NUMERATOR_AUTHORITY_CHANGES:
    P -> W
  PERCENTAGE_FORMATTING_SEMANTICS:
    PRESERVED

Restore the old raw percentage calculation and
let the existing renderer decide formatting.

P1 only; fix once and continue.
No new review round.

The "DOGFOOD" claim is overstated — reclassify
as COMPACTION_PRESENTATION_TRANSITION_TEST =
SYNTHETIC_REAL / PASS.

I do not accept LIVE_BUG = CLOSED yet.
I accept IMPLEMENTATION_CHAIN = CLOSED / TESTED
IN COMPOSED PIECES, LIVE_QUALIFICATION = PENDING.
```

## P1: Reverted percentage rounding (this commit)

```text
ContextWindow.tsx
  BEFORE (twenty-first-pass, 2b371761d):
    percentage:
      Math.round((numerator / contextWindow) * 100)
  AFTER  (twenty-second-pass, this commit):
    percentage:
      (numerator / contextWindow) * 100
        (raw ratio, restored)

FACTORY CONSERVATION (twenty-second-pass):
  ONLY_NUMERATOR_AUTHORITY_CHANGES:
    P -> W
  PERCENTAGE_FORMATTING_SEMANTICS:
    PRESERVED
```

The tokenData precedence (W -> use W; W=null ->
render null; W=undefined -> use P) is UNCHANGED
in this commit. Only the percentage formatting
reverted.

## P2 (wording only): DOGFOOD reclassification

```text
ContextWindow.test.tsx
  BEFORE (twenty-first-pass, 2b371761d):
    "DOGFOOD (RED -> GREEN): compaction recurrence
     — bar reflects W_before before compaction,
     W_after after the runtime emits a fresh W"
  AFTER  (twenty-second-pass, this commit):
    "COMPACTION_PRESENTATION_TRANSITION
     (SYNTHETIC_REAL / PASS): bar flips from
     W_before to W_after across a re-render —
     proves IF the webview receives W_after,
     ContextWindow updates"
```

The test logic (render W_before, rerender W_after,
assert the bar flipped) is unchanged. Only the
label and its embedded comment block are
reclassified. The test still proves IF the
webview receives W_after, ContextWindow updates.
It does NOT prove the whole live chain.

## Boundary 5 fallback policy (twenty-first-pass,
preserved)

```text
W = number  -> bar numerator = W (Boundary 5 GREEN)
W = null    -> bar UNAVAILABLE (reviewer B
                fallback; P must not masquerade
                as W)
W = undefined -> bar falls back to P (legacy
                 path) — only place where P
                 drives the bar

Carrier surface:  number | null
                  (Boundary 5 normalization)
Projection output: number | null | undefined
                  (carrier absent -> undefined;
                   carrier present -> number |
                   null verbatim)
ExtensionState:   number | null | undefined
                  (legacy path persists undefined)
```

## LIVE_QUALIFICATION runbook (next bounded cycle)

```text
LIVE:

before compaction
  captured runtime W = W1
  displayed numerator = W1

real compaction occurs

after post-compaction prepareTurn,
before next api_req_started
  captured runtime W = W2
  ExtensionState W = W2
  displayed numerator = W2

and:
  W2 != stale W1

Do NOT require W2 = 264.3k.

Also capture P concurrently if cheap:
  P remains pre-compaction/stale
  while
  bar displays fresh W2

Implementation: install/build dogfood VS Code
with the 2b371761d + 2b3717XXX (this commit)
tree, reproduce one real compaction, capture
the ExtensionState payload via the debug harness
(or equivalent), and assert the invariants
above.
```

## Conservation (permanent)

```text
apps/vscode MUST NOT import / use:
  estimateRequestInputTokens
  estimateMessageTokens
for this projection. Enforced permanently by the
estimator-import probes:
  apps/vscode/src/sdk/__tests__/
  working-context-webview-state-projection.test.ts
  apps/vscode/webview-ui/src/components/chat/
  task-header/ContextWindow.test.tsx

UNDEFINED_W_STALE_REUSE = FORBIDDEN:
  enforced at the carrier layer (unconditional
  assignment on observe()) — see
  apps/vscode/src/sdk/working-context-host-
  capture.ts. Runtime-published undefined is
  normalized to null so the Boundary 5 fallback
  (reviewer B) can distinguish "runtime cleared"
  from "carrier absent / legacy path".

P remains available for provider / request
metrics.
H_b / H_a remain compaction telemetry.
getApiMetrics Strategy-D stays untouched.
lastApiReqTotalTokens stays untouched.
```

## Verification (this commit)

```text
$ bunx vitest run (apps/vscode, Boundary 3 -> 4):
  Test Files 1 passed (1)
  Tests      13 passed (13)

$ bunx vitest run (webview-ui, Boundary 5):
  Test Files 1 passed (1)
  Tests      13 passed (13)

$ bunx vitest run (webview-ui, TaskHeader):
  Test Files 1 passed (1)
  Tests      8 passed (8)

$ bun tsc --noEmit -p apps/vscode/tsconfig.json:
  3 errors (== baseline; pre-existing in
   sdk-compaction.ts and
   task-state-shadow-coordinator.ts)

$ git diff --check: clean
```

## Disposition

```text
BOUNDARY_RECON             = PASS / USEFUL
BOUNDARY_3_CAPTURE         =
  SYNTHETIC_REAL / PASS
BOUNDARY_3_TO_4_TRANSPORT  =
  SYNTHETIC_REAL / PASS
HOST_PUBLICATION           =
  COMPOSED PROOF / ACCEPTED
NECESSITY_OF_HOST_CAPTURE  = PROVEN
NO_INDEPENDENT_W_SCALAR    = TRUE
UNDEFINED_W_STALE_REUSE    = FORBIDDEN

RED                        =
  HISTORICAL (a04387552)
GREEN                      =
  SYNTHETIC_REAL / PASS
CAUSAL_COMPOSITION         =
  live UX symptom
  + structural missing host capture at entry
  + exact-edge ablation
  + GREEN repair
  + GREEN numerator swap
  + GREEN W-null fallback
  + GREEN compaction-presentation transition
    (SYNTHETIC_REAL / PASS; not LIVE)

IMPLEMENTATION_CHAIN       =
  CLOSED / TESTED IN COMPOSED PIECES
LIVE_BUG                   = PENDING
LIVE_QUALIFICATION         = PENDING
  (next bounded cycle: install/build dogfood,
   reproduce one real compaction, assert
   W2 != stale W1 in displayed numerator
   before next api_req_started)

SDKCONTROLLER_WRAP_TEST    =
  SYNTHETIC PATTERN-PIN
  + STRUCTURAL production composition
  / sufficient evidence; not a controller harness

P1 = Math.round percentage delta reverted
    (unrelated presentation delta; restored
     to pre-twenty-first-pass ratio shape).
P2 = DOGFOOD test reclassified as
    COMPACTION_PRESENTATION_TRANSITION_TEST =
    SYNTHETIC_REAL / PASS + legacy `undefined
    -> P` path is supported projection shape,
    production reachability not shown.

NEW_REVIEW_ROUND           = NO
C1                         = GO_LIVE_QUALIFICATION
```

## Commit lineage

```text
c7:  STATE_BIND       (aec3ff0c6)
c8:  PUBLICATION_BIND (05ccaaf66)
                              GO_PUBLICATION_BIND
c9:  TEST_CORRECTION  (bb5588150)
                              GO_P3
c10: P3_GO_SIGNAL     (c3c00cb45)
                              GO_P3
c11: P3_BOUNDARY_BIND (a04387552)
       (synthetic RED)
                              GO_P3 (real GREEN required)
c12: P3_GREEN         (c8897640d)
       + REAL_PRODUCTION_SEAM_GREEN
       + INTENTIONALLY_FAILING_RED_REMOVED
                              HALT_REPAIR_WITHOUT_
                                REPRODUCED_RED
                              (necessity ablation required)
c13: P3_NECESSITY_ABLATION (1e9ce01a3)
       + A/B ABLATION on real getStateToPostToWebview
       + WIRING WRAP (P1_2) test on SdkController-style
         wrap pattern
                              PASS_WITH_NONBLOCKING_RESIDUE
                              GO_P3_B5
c14: P3_B5_BOUNDARY   (2b371761d)
       + W-precedence GREEN in ContextWindow
       + W=null -> UNAVAILABLE fallback (reviewer B)
       + W=undefined -> legacy P fallback
       + Carrier surface (number | null) normalization
       + DOGFOOD: compaction recurrence (LATER
         RECLASSIFIED as SYNTHETIC_REAL)
       + CONSERVATION: estimator imports pinned
       + UNRELATED DELTA: Math.round percentage
                              PASS_WITH_ONE_P1_FIX
                              GO_LIVE_QUALIFICATION
c15: P3_B5_P1_REVERT  (this commit)
       + REVERTED Math.round percentage (P1)
       + REVERTED unrelated presentation delta
       + RECLASSIFIED compaction-presentation
         transition test (P2a, wording)
       + NOTED legacy undefined -> P production
         reachability (P2b, wording)
                              GO_LIVE_QUALIFICATION
```

## Documentary residue (non-blocking)

```text
.factory/evidence/.../p3-state-after-green.md
contains stale:
  RED = NOT_REPRODUCED_AT_HEAD
wording that is HISTORICAL and superseded by the
A/B ablation taxonomy. Batch this at terminal
cleanup (out of scope for this commit).

Reviewer (twenty-first-pass):
  NON-BLOCKING. Batch it at terminal cleanup.
```

## Next bounded cycle

```text
GO_LIVE_QUALIFICATION: install/build dogfood,
reproduce one real compaction, assert
  W1 (pre-compaction) -> W2 (post-compaction)
  W2 != stale W1
in the displayed numerator before the next
api_req_started. If that passes, close this ACT
and batch the terminal documentary cleanup.

If that fails: stop, write up the failure mode,
re-investigate. Do not paper over.
```

PRODUCTION_REWORK  =
  MINIMAL REVERT (Boundary 5 GREEN preserved;
                 Math.round percentage delta
                 restored to pre-twenty-first-
                 pass ratio shape)
TYPECHECK_DELTA   = ZERO (3 baseline == 3)
DEFAULT_SUITE_STATE = GREEN
NEW_REVIEW_ROUND    = NO
C1                  = GO_LIVE_QUALIFICATION
