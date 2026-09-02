
# ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01

## State (twenty-first-pass, 2026-09-03)

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
Boundary 5 header         = CLOSED  (this commit)
Terminal cleanup          = OPEN  (non-blocking)

NECESSITY_OF_HOST_CAPTURE = PROVEN
NEW_REVIEW_ROUND          = NO
C1                        = GO_CLEANUP (terminal
                             cleanup only)
```

Reviewer on 1e9ce01a3:
```text
PASS_WITH_NONBLOCKING_RESIDUE.
C1: GO_P3_B5.

The requested correction cycle did its job.
The same real getStateToPostToWebview()
producer now exhibits the required A/B/A'
discrimination: populated carrier -> W,
ablated/unpopulated carrier -> no W,
restored carrier -> W again. That is sufficient
post-hoc necessity evidence for the
already-landed Boundary 3->4 repair.

The range also shows no further runtime
implementation change in this correction —
only stronger executable evidence — and the
default-discovered test remains GREEN.

Upstream architecture remains consistent with
this design: @cline/agents owns turn
preparation/runtime events, @cline/core is the
host-facing orchestration layer, and Agent
runtime events are distinct from ClineCore's
adapted/legacy event surfaces.
```

## Boundary 5: production RED -> GREEN (this commit)

```text
W defined       -> numerator = W (Boundary 5 GREEN)
W undefined     -> bar UNAVAILABLE (reviewer B fallback;
                   P must not masquerade as W)
W=null sentinel -> "runtime cleared" path; render null
W=undefined     -> "carrier absent / legacy path";
                   fall back to P (the ONLY path where
                   P drives the bar)
```

The W precedence rules are encoded in:

1. `apps/vscode/webview-ui/src/components/chat/
   task-header/ContextWindow.tsx` — the
   `tokenData` memo:
   ```ts
   if (typeof currentWorkingContextEstimate === "number") {
     numerator = currentWorkingContextEstimate
   } else if (currentWorkingContextEstimate === null) {
     return null  // reviewer B fallback
   } else {
     // undefined -> legacy path
     numerator = lastApiReqContextInputTokens
   }
   ```

2. `apps/vscode/src/sdk/working-context-host-
   capture.ts` — the carrier surface normalization:
   ```ts
   const w = event.snapshot.currentWorkingContextEstimate
   this._latest = typeof w === "number" ? w : null
   ```
   The runtime-published `undefined` is normalized to
   `null` so the Boundary 5 discriminator distinguishes
   "runtime cleared" from "carrier absent / legacy".

3. `apps/vscode/src/core/controller/state/
   working-context-state-projection.ts` — the pure
   projection helper:
   ```ts
   return {
     currentWorkingContextEstimate:
       carrier?.currentWorkingContextEstimate,
   }
   ```
   When the carrier is absent (legacy / classic path),
   the projection emits `undefined`. When the carrier
   is present, the projection passes through `number`
   or `null` verbatim.

4. `apps/vscode/webview-ui/src/components/chat/
   ChatView.tsx` (and the chain through TaskSection,
   TaskHeader, ContextWindow) — the prop is forwarded
   from `useExtensionState()` to `ContextWindow`.

## Sentinels

```text
P = 364_900   (provider / last api_req_started
                payload)
W = 271_337   (synthetic
                currentWorkingContextEstimate;
                deliberately distinct from live
                264.3k)
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
  apps/vscode/src/sdk/working-context-host-capture.ts.
  Runtime-published undefined is normalized to
  null so the Boundary 5 fallback (reviewer B)
  can distinguish "runtime cleared" from
  "carrier absent / legacy path".

P remains available for provider / request metrics.
H_b / H_a remain compaction telemetry.
getApiMetrics Strategy-D stays untouched.
lastApiReqTotalTokens stays untouched.
```

## B5 RED then GREEN

```text
RED (entry HEAD):

  Test 1: numerator for W=271_337 / P=364_900 ->
    expected 135.6685 (~136) %
    actual   182.45 % (current uses P)
    RED at entry.

  Test 2: W=undefined / P=364_900 ->
    expected: no progressbar
    actual:   progressbar shows 364_900
    RED at entry.

GREEN (this commit):

  All 8 Boundary 5 tests GREEN, including the
  W-defined precedence over P, the reviewer-B
  unavailable fallback for null W, and the
  post-compaction dogfood recurrence.

Production code changes:
  ContextWindow.tsx     - new prop + precedence
  TaskHeader.tsx        - new prop forwarded
  TaskSection.tsx       - new prop forwarded
  ChatView.tsx          - useExtensionState +
                          forwards W
  working-context-host- - carrier surface
   capture.ts             (number | null)
  working-context-      - carrier surface
   state-projection.ts    (number | null)
  ExtensionMessage.ts   - field widened to
                          (number | null)
```

## Verification

```text
$ bunx vitest run (apps/vscode, Boundary 3 -> 4):
  Test Files 1 passed (1)
  Tests      13 passed (13)

$ bunx vitest run (webview-ui, Boundary 5):
  Test Files 1 passed (1)
  Tests      13 passed (13)

$ bun tsc --noEmit -p apps/vscode/tsconfig.json:
  3 errors (== baseline; pre-existing in
   sdk-compaction.ts and
   task-state-shadow-coordinator.ts)

$ bunx vitest run (agents):
  Test Files 24 passed (24)
  Tests      408 passed (408)

$ bunx vitest run (core/src/extensions/context/):
  Test Files 5 passed | 1 skipped (6)
  Tests      116 passed | 1 skipped (117)

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
PRE_REPAIR_RED             =
  historical / invalid witness
POST_HOC_NECESSITY_ABLATION =
  SYNTHETIC_REAL / PASS
GREEN                      =
  SYNTHETIC_REAL / PASS
CAUSAL_COMPOSITION         =
  live UX symptom
  + structural missing host capture at entry
  + exact-edge ablation (capture.observe never called)
  + GREEN repair (capture.observe fired)
  + GREEN numerator swap (W takes precedence over P)
  + GREEN W-undefined fallback (render UNAVAILABLE)
  + GREEN compaction dogfood

SDKCONTROLLER_WRAP_TEST    =
  SYNTHETIC PATTERN-PIN
  + STRUCTURAL production composition
  / sufficient evidence; not a controller harness

NEW_REVIEW_ROUND           = NO
C1                         = GO_CLEANUP
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
c14: P3_B5_BOUNDARY   (this commit)
       + W-precedence GREEN in ContextWindow
       + W=null -> UNAVAILABLE fallback (reviewer B)
       + W=undefined -> legacy P fallback
       + Carrier surface (number | null) normalization
       + DOGFOOD: compaction recurrence
       + CONSERVATION: estimator imports pinned
                              GO_CLEANUP (terminal cleanup)
```

## Documentary residue (non-blocking)

```text
.factory/evidence/.../p3-state-after-green.md
contains stale:
  RED = NOT_REPRODUCED_AT_HEAD
wording that is HISTORICAL and superseded by the
A/B ablation taxonomy. Batch this at terminal
cleanup (out of scope for this commit).

Reviewer (twentieth-pass):
  NON-BLOCKING. Batch it at terminal cleanup.
```

## Next bounded cycle

```text
GO_CLEANUP: terminal cleanup of documentary
residue in p3-state-after-green.md. After that,
the ACT is fully CLOSED.
```

PRODUCTION_REWORK = MINIMAL (Boundary 5 GREEN
                           only; carrier surface
                           normalization is a
                           type tightening, no
                           logic change)
TYPECHECK_DELTA  = ZERO (3 baseline == 3)
DEFAULT_SUITE_STATE = GREEN
NEW_REVIEW_ROUND    = NO
C1                  = GO_CLEANUP
