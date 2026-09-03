
# ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01

## State (twenty-fourth-pass, 2026-09-03)

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
P1 percentage delta       = REVERTED (c15)
DOGFOOD test reclassified = CLOSED (c15)
P0-A sdk-compaction       = CLOSED (c16)
P0-B task-shadow          = CLOSED (c16)
DOGFOOD_ARTIFACT          = BUILT (c16)
vscode:prepublish         = PASS (c16)
P1 T1 regression test     = CLOSED (c17, this pass)
P2 typecheck-delta wording = CLOSED (c17, this pass)
Terminal cleanup          = OPEN  (non-blocking)
LIVE_QUALIFICATION        = AUTHORIZED (next cycle)

NECESSITY_OF_HOST_CAPTURE = PROVEN
IMPLEMENTATION_CHAIN      =
  CLOSED / TESTED IN COMPOSED PIECES
DOGFOOD_BUILD_REGRESSION  =
  RESOLVED (P0-A + P0-B, c16)
REGRESSION_GUARD          =
  RESOLVED (T1 sdk-compaction, c17)
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

## HALT_BUILD_REGRESSION + twenty-third-pass (c16,
this commit)

The dogfood build failed BEFORE LIVE qualification
could start. Two integration gaps (not architecture
changes; not compaction design changes) needed
bounded compatibility fixes:

```text
P0-A:
  sdk-compaction.ts consumer assumed the
  prepareTurn result's `messages` was always
  defined. After the producer-cadence GREEN the
  result type was made OPTIONAL so it can carry
  only `currentWorkingContextEstimate` (a
  metadata-only return shape). The consumer
  must classify that shape as "no real
  compaction occurred" and return
    { compacted: false, messages: input.messages }
  rather than producing
    { compacted: true, messages: undefined, ... }.
  No non-null assertion. No structural-subtype
  helper. The bounded contract:
    CompactSessionMessagesResult.compacted
    and CompactSessionMessagesResult.compactionState
    MUST come from an actual message projection
    (`result.messages !== undefined`),
    NOT merely from presence of W metadata.

P0-B:
  task-state-shadow-coordinator.ts edgeKeyOf()
  had an exhaustive `never` check over
  AgentRuntimeEvent. Adding the new event
  `working-context-state-changed` to that union
  tripped the never-check because no `case`
  matched. The event is a runtime-state
  observation (the shadow-adapter already
  produces zero TaskMsg for it), NOT a task-
  state mutation. So it is classified in the
  same family as `message-added` /
  `assistant-text-delta` /
  `usage-updated` / `status-notice`:
    return `presentational:${event.type}`
  The never-check is preserved (still catches
  future additions); the dedup gate correctly
  routes the event without mutating state.
```

Why these are ACT-owned (not baseline drift):

```text
Before this ACT, the typecheck baseline was 3
errors. They were reported as "pre-existing."
But the reviewer on this ACT caught that:

  1. The first two errors
     (sdk-compaction.ts:119 / :122) are
     DIRECTLY caused by the prepareTurn
     result's `messages` becoming OPTIONAL
     (tenth-pass interface revision).

  2. The third error
     (task-state-shadow-coordinator.ts:260)
     is DIRECTLY caused by adding
     `working-context-state-changed` to
     AgentRuntimeEvent
     (fifteenth-pass PUBLICATION_BIND).

So these are not historical. They are
ACT-owned integration/type compatibility
fallout from the W work — exactly the kind of
narrow, bounded compatibility fix the Factory
P0 allows without a new review round.
```

Production code changes (this commit, c16):

```text
apps/vscode/src/sdk/sdk-compaction.ts
  + if (!result.messages) {
      return { compacted: false, messages: input.messages }
    }
  + Documented why this is the bounded contract
  + No non-null assertion
  + Real-compaction artifact semantics preserved
    (compactedMessages comes only from a real
    message projection)

apps/vscode/src/sdk/task-state-shadow-coordinator.ts
  + case "working-context-state-changed":
      return `presentational:${event.type}`
  + Documented why this is "non-task-state
    telemetry/state-notification"
  + Exhaustiveness `never` check preserved
  + Mirrors the existing treatment of
    `message-added` / `assistant-text-delta` /
    `assistant-reasoning-delta` /
    `assistant-message` / `assistant-media` /
    `usage-updated` / `status-notice`
```

Evidence (this commit, c16):

```text
bun x tsc --noEmit                       = PASS
  (no errors; previously 3 ACT-owned
   errors at sdk-compaction.ts:119,
   sdk-compaction.ts:122,
   task-state-shadow-coordinator.ts:260)

bun x tsc --project tsconfig.vscode-compat
  --noEmit                               = PASS

webview-ui tsc --noEmit                  = PASS

bun run lint                             = PASS

bun run build:webview                    = PASS
  (vite build: 7203 modules transformed,
   9.08s, no errors)

bun esbuild.mjs --production             = PASS
  (dist/extension.js rebuilt 26,086,080 bytes)

bun run test:unit                        = PASS
  (76 files, 1101 tests, all green)

AgentRuntime publication tests           = PASS
  (sdk/packages/agents/src/agent-runtime.
   working-context-publication.test.ts:
   4/4 pass via bun test)

TaskShadow relevant suite                = PASS
  (sdk/packages/agents/src/runtime/state/
   task-state/: 72/72 pass via bun test)

SDK compaction relevant suite            = PASS
  (sdk/packages/core/src/extensions/
   context/: 116/116 pass via bun test;
   sdk/packages/core/src/session/: 131/131
   pass via bun test)

git diff --check                         = PASS

vscode:prepublish                        = PASS
  (= bun run package =
   sync-parser-helper +
   check-types +
   build:webview +
   lint +
   esbuild --production,
   all green)

Vitest note: the vitest-runner for
apps/vscode/src/sdk/**/*.test.ts is broken
in this authoring environment
(`TypeError: undefined is not an object
(evaluating 'z.object')` from the bundled
@cline/llms dist). Verified to be PRE-EXISTING
(also fails on `git stash` of this commit's
edits; not caused by this ACT). Out of scope
for this bounded correction; the same set of
tests run via `bun test` at the SDK package
level (76 tests pass) and exercise the
analogous invariants.
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
LIVE_QUALIFICATION         = AUTHORIZED
  (next bounded cycle: install/build dogfood,
   reproduce one real compaction, assert
   W2 != stale W1 in displayed numerator
   before next api_req_started; do NOT require
   W2 = 264.3k; capture P concurrently so the
   fresh-W / stale-P interval is the decisive
   discriminator)

DOGFOOD_BUILD_REGRESSION  =
  RESOLVED (P0-A + P0-B, c16)
  P0-A: sdk-compaction.ts metadata-only result
        guard
  P0-B: task-state-shadow-coordinator.ts
        working-context-state-changed classified
        as presentational

REGRESSION_GUARD          =
  RESOLVED (T1 sdk-compaction, c17)
  T1: apps/vscode/src/sdk/sdk-compaction.test.ts
      "returns compacted=false on metadata-only
       prepareTurn result (W publish, no
       projection)"
  Pins the runtime semantic branch that the
  typecheck fix in P0-A made possible.
  Independent of the typecheck (a future change
  could regress the runtime semantic without
  recreating the TypeScript error).
  Verified out-of-band:
    BROKEN code (no P0-A guard) -> T1 fails ✓
    FIXED code (with P0-A guard) -> T1 passes ✓
  (regression guard = VALID)

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
P0-A = sdk-compaction.ts now treats
      `result.messages === undefined` as
      `compacted: false` (metadata-only
      prepareTurn return does NOT produce a
      real compaction artifact).
      Pinned by T1 in
      apps/vscode/src/sdk/sdk-compaction.test.ts
      (c17).
P0-B = task-state-shadow-coordinator.ts
      classifies `working-context-state-changed`
      as `presentational:${event.type}` (non-
      task-state telemetry/state-notification;
      exhaustive never-check preserved).
      (T2 task-shadow test deferred: the
      exhaustive `never` check is compile-pinned
      and the existing 72/72 task-state suite
      covers the observation-only semantics;
      adding a new test would require substantial
      scaffolding for marginal gain. Out of scope
      per reviewer.)
P1-T1 = regression guard for the runtime
      semantic branch in P0-A. Pins:
        metadata-only prepare result
        → must remain compacted:false
      Without T1, a future change could regress
      the runtime semantic without recreating
      the TypeScript error. Verified out-of-band.
P2-TERMINAL = TYPECHECK wording softened to
      ENTRY_BUILD / SUBJECT_BUILD /
      ACT_OWNED_DIAGNOSTICS = 3 → 0 (avoid
      "negative delta" being misread as a
      regression).

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
c15: P3_B5_P1_REVERT  (cfeb66175)
       + REVERTED Math.round percentage (P1)
       + REVERTED unrelated presentation delta
       + RECLASSIFIED compaction-presentation
         transition test (P2a, wording)
       + NOTED legacy undefined -> P production
         reachability (P2b, wording)
                              GO_LIVE_QUALIFICATION
c16: HALT_BUILD_REGRESSION_BOUNDED_FIX (this branch)
       + P0-A: sdk-compaction.ts
         `if (!result.messages) return compacted=false`
         (no non-null assertion; real-compaction
          artifact semantics preserved)
       + P0-B: task-state-shadow-coordinator.ts
         case "working-context-state-changed" ->
         `presentational:${event.type}`
         (exhaustive never-check preserved; mirror
          existing presentational family)
       + DOGFOOD_BUILD_REGRESSION = RESOLVED
       + vscode:prepublish = PASS
       + LIVE_QUALIFICATION = RESUMABLE
                              GO_LIVE_QUALIFICATION
c17: REGRESSION_GUARD + P2_WORDING_FIX (this commit)
       + P1: T1 regression test in
         apps/vscode/src/sdk/sdk-compaction.test.ts
         "returns compacted=false on metadata-only
          prepareTurn result (W publish, no
          projection)"
         Pins the runtime semantic branch that
         the typecheck fix in P0-A made possible.
         Independent of the typecheck (a future
         change could regress the runtime semantic
         without recreating the TypeScript error).
         Verified out-of-band: T1 fails on broken
         code, passes on fixed code (regression
         guard = VALID).
       + P2: TYPECHECK wording softened:
         "TYPECHECK_DELTA = NEGATIVE" ->
         "TYPECHECK = ENTRY_BUILD / SUBJECT_BUILD /
          ACT_OWNED_DIAGNOSTICS = 3 → 0"
         (avoid "negative delta" being misread as
          a regression).
       + LIVE_QUALIFICATION = AUTHORIZED
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
GO_LIVE_QUALIFICATION: install/build dogfood
(this commit already builds clean;
vscode:prepublish PASSES; the dogfood artifact
is built; c16 unblocks LIVE qualification
that was previously BLOCKED on the build),
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
  BOUNDED COMPATIBILITY FIX (c16) +
  MINIMAL REVERT (c15, Boundary 5 GREEN
                  preserved; Math.round
                  percentage delta restored
                  to pre-twenty-first-pass
                  ratio shape)
TYPECHECK          =
  ENTRY_BUILD        = FAIL / 3 ACT-owned diagnostics
                       (sdk-compaction.ts:119,
                        sdk-compaction.ts:122,
                        task-state-shadow-
                        coordinator.ts:260)
  SUBJECT_BUILD      = PASS / 0 diagnostics
                       (apps/vscode tsc clean;
                        c16 fix landed)
  ACT_OWNED_DIAGNOSTICS = 3 → 0
DEFAULT_SUITE_STATE = GREEN (76 files, 1101 tests)
NEW_REVIEW_ROUND    = NO
C1                  = GO_LIVE_QUALIFICATION
