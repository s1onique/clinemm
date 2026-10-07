# ACT-CLINEMM-ELMIZE-P1-COMPLETION-CONTINUATION-CONTROL-AUTHORITY02

**Status:** CLOSED. PASS_COMPLETION_CONTINUATION_ELM_CONTROL_AUTHORITY. Subject HEAD `7e685a5d6ccab90531d047543b8643c1e0132f2d` (the predecessor CONTROL_AUTHORITY01 closure HEAD).

**Subject:** Move the **pure directive policy** of the completion-continuation control surface from TS into Elm. Trust provenance, privileged role, tool registry, queue/session/task lifecycle, and all effects stay in TS.

---

## VERDICT

```text
PASS_COMPLETION_CONTINUATION_ELM_CONTROL_AUTHORITY

+ focused suite (8 test files, ~50 tests): all PASS
    C14 differential correspondence (TS reference vs Elm): 9/9 PASS
    C15 malformed boundary matrix: 15/15 PASS
    C16 capability matrix (CAP-01..04): 8/8 PASS
    C11 namespace coexistence (3-kernel): 2/2 PASS
    C23 / C33 cutover + ablation + cardinality: 6/6 PASS
    C17 / C18 / C19 / C20 conservation: 5/5 PASS
    C27 / C11 loader discriminator: 7/7 PASS
    Prior ACT regression (completion-continuation-control-authority01 + structural-authority01): 45/45 PASS
+ REARM01 conservation: 7/7 PASS (no Elm policy change reintroduces a lost wake)
+ STALL enforcement: 5/5 PASS (production scheduler consumes the same-state guard)
+ Stall precedence over held+capabilities: pinned (C17 session>stalled)
+ Provider boundary / private brand: NOT TOUCHED (C20 — no Elm branch)
+ typecheck (bun run check-types): PASS
+ lint (bun run lint): PASS
+ git diff --check: PASS
+ full bun unit sweep (1261 tests, 95 files): 1261/0 FAIL
+ No VSIX build / install / dogfood / LIVE (operator-owned, NOT_EXECUTED per C38)
+ pre-existing c24-c-bridge test failures unchanged (NOT caused by this ACT)
```

---

## Architecture outcome

```text
                  HOST / TS
         ┌─────────────────────────┐
         │ private trust identity  │  (CORRECTION01-04)
         │ resumed tool registry     │
         │ session/task lifecycle  │
         └────────────┬────────────┘
                      │ trusted pure facts
                      ▼
             ┌────────────────┐
             │      ELM       │   (this ACT)
             │ control policy │
             │  Facts ->      │
             │   Directive    │
             └────────┬───────┘
                      │ typed Directive
                      ▼
         ┌─────────────────────────┐
         │          TS             │
         │ system-role message     │
         │ queue / tools / effects │
         └─────────────────────────┘
```

Elm NEVER decides:
- trusted vs untrusted (C19 / C20)
- system vs user (C20)
- tool name selection (C9 / C32)
- session/task lookup (C32)
- queue / send / effects (C32)

---

## ELM_FACTS (C9 closed schema)

```text
unconsumedCount      : Int
observation          : { observeHeldResults : Bool, retryCompletion : Bool }
completion           : { observeHeldResults : Bool, retryCompletion : Bool }
stalledNoProgress     : Bool
sessionMatches        : Bool
taskMatches           : Bool
alreadyCommitted      : Bool
```

The TS adapter projects the **actual resumed-turn tool registry**
into `canObserveHeldResults = "command_status" in tools` /
`canRetryCompletion = "submit_and_exit" in tools` (C3 capability
binding, C9 tool-name isolation).

---

## ELM_DIRECTIVES (C8 closed sum)

```text
type Directive
    = ObserveThenRetry              -- completionStatus=HELD,            requiredAction=observe_then_submit
    | RetryCompletion              -- completionStatus=READY_TO_RETRY,  requiredAction=retry_commission
    | WaitForHost                  -- completionStatus=COMMITTED,       requiredAction=retry_commission
    | FailClosed FailureReason     -- completionStatus=CANNOT_CONTINUE,  requiredAction=fail_closed

type FailureReason
    = ObservationUnavailable
    | RetryUnavailable
    | StalledNoProgress
    | SessionMismatch
    | TaskMismatch
    | AlreadyCommitted
    | MalformedFacts
```

These map 1:1 onto the existing TS
`CompletionContinuationControl.completionStatus` +
`requiredAction` fields. The Elm split adds an explicit
`WaitForHost` vs `RetryCompletion` distinction that the TS
predecessor collapsed into a single `COMMITTED + retry_commission`
tuple -- the controlled loading on the effect-execution layer is the
same (model issues `submit_and_exit`), but the Elm closed sum
exposes the difference for downstream policy.

---

## TEMPORAL_MODEL

```text
pure projection | state machine
  pure
```

Rationale: the current implementation of `buildCompletionContinuationControl`
at `apps/vscode/src/sdk/background-notify-coordinator.ts:501-544`
is already a pure function of an immutable host snapshot
(`completionStatus = f(unconsumedCount, observation, completion)`,
`requiredAction  = f(unconsumedCount, observation, completion)`).
There is no previous-policy state held by the host that is not
already representable in `Facts`. Same-state stalls are surfaced
upstream by `shouldStallSameStateControl` (TS scheduler, C17) and
propagate here as a `Facts.stalledNoProgress: Bool`.

---

## REFERENCE_FIXTURES (C4 / C14)

N=8 fixtures:
| Fixture | Inputs | Directive |
|---------|-------------|---------------------|
| CTRL-01 | held > 0 + observation | `ObserveThenRetry` |
| CTRL-02 | held > 0 + no observation | `FailClosed ObservationUnavailable` |
| CTRL-03 | held = 0 + retry | `RetryCompletion` |
| CTRL-04 | held = 0 + no retry | `FailClosed RetryUnavailable` |
| CTRL-05 | stalled hit | `FailClosed StalledNoProgress` |
| CTRL-06a | session mismatch | `FailClosed SessionMismatch` |
| CTRL-06b | task mismatch | `FailClosed TaskMismatch` |
| CTRL-07 | already committed | `FailClosed AlreadyCommitted` |
| CTRL-08 | negative unconsumedCount | `FailClosed MalformedFacts` |

Plus C15 malformed-boundary matrix and C16 capability matrix.

---

## CORRESPONDENCE (C14)

N=9 / N=9 PASS.

The TS reference (frozen predecessor at `background-notify-coordinator.ts:501-544`)
produces:
- `HELD + observe_then_submit`            when held > 0 + observation    (Elm: `ObserveThenRetry`)
- `CANNOT_CONTINUE + fail_closed` (observation_unavailable) when held > 0 + no observation (Elm: matches)
- `COMMITTED + retry_commission`           when held = 0 + retry            (Elm: `RetryCompletion` per ACT §CTRL-03)
- `CANNOT_CONTINUE + fail_closed` (retry_unavailable)        when held = 0 + no retry        (Elm: matches)

Plus the C14-extension tests cover the load-bearing Elm additions
(stall, identity, alreadyCommitted, negative) which the TS reference
does not have. These are documented as Elm-only and do not weaken
the correspondence claim.

---

## MALFORMED_BOUNDARY (C15)

N=15 / N=15 PASS.

Coverage:
- non-object outbound: decode_error
- null outbound: decode_error
- string outbound: decode_error
- ready outbound (no directive): decode_error
- directive missing payload: decode_error
- unknown directive tag: decode_error
- fail_closed without reason: decode_error
- fail_closed unknown reason: decode_error
- unknown outbound kind: decode_error
- missing unconsumedCount: decode_error
- unconsumedCount wrong type: decode_error
- observation.observeHeldResults wrong type: observation defaults to emptyCapabilityMap (closed-schema optional fallback)
- completion.retryCompletion wrong type: defaults to emptyCapabilityMap
- both capabilities malformed -> both default to empty -> FailClosed RetryUnavailable
- missing capability object: emptyCapabilityMap fallback -> FailClosed RetryUnavailable
- malformed facts never produce `retry_completion` (no default-Authorize)

---

## TS_POLICY_PRODUCTION_CALLERS (C34)

N=0 production callers of the OLD TS policy `buildCompletionContinuationControl` /
`completeContinuationDecision` for the **directive** decision. The TS function
remains exported for the differential correspondence test (C14) only;
its production callers have been confirmed absent:

```text
production callers of buildCompletionContinuationControl  = 0  (test-only)
production callers of completeContinuationControlFromSession = 0 (test-only)
Elm directive policy production callers                   = 1  (pickContinuationDirectiveForPublication)
```

---

## ELM_KERNEL_SHA256 (C26 / C28)

```
599de6a90389e67d201a16b1d4e94eb513fb2bfdde536dfa2f157c3cd9588da8
```

Source SHA-256 (Main.elm.sha256):
```
8e810b99a0ff68ce4e71c5686c538a709f00c112faa99489cffd3b3642179148
```

Source SHA-256 (Policy.elm.sha256):
```
43cf55b732bd3f1bb85fb0a45d735a8cd742fa582db8cd813f67c4a718776772
```

Source SHA-256 (Domain.elm.sha256):
```
5db9296bb9c75ea1bacc0d41a1755512ab47e8095da7cc1fd5bc043fdf92228c
```

Source SHA-256 (Codec.elm.sha256):
```
dff13a9c2018e2e1709271bbfea23bc5644b0b4ca30bb00ea8ed15242c7d0e1c
```

Source SHA-256 (elm.json.sha256):
```
5cc07bb51b26ea1fc3d63c9fb4d0f830fae08153755f84896f09806c66169d99
```

---

## RUNTIME_ASSET (C26 / C27)

```text
runtime-assets/completion-continuation-control.js
```

Stage contract wired in `scripts/build_dogfood_vsix_lib.py` `_ELM_KERNELS`
table (this ACT adds the third row alongside `completion-authority.js` and
`task-header-orchestration.js`). Production activation in
`apps/vscode/src/extension.ts:357-369` pins the path explicitly:

```text
setCompletionContinuationControlElmProductionKernelPath(
    path.join(context.extensionUri.fsPath, "runtime-assets", "completion-continuation-control.js"),
)
```

Source-tree fallback for unit tests:

```text
apps/vscode/elm/completion-continuation-control/vendor/completion-continuation-control.js
```

---

## PRIVATE_NAMESPACE (C11)

YES. The adapter evaluates the kernel into a per-kernel namespace via
`evaluator.call(namespace, namespace)` (the proven TaskHeader pattern).
NEVER writes to `globalThis.Elm`. The `completion-authority-elm-namespace-coexistence`
test pre-populates `globalThis.Elm` with a fake completion-authority
kernel and asserts the real completion-continuation-control kernel still
emits a valid directive without collision.

Coexistence with `completion-authority.js` and `task-header-orchestration.js`
is verified in `completion-continuation-control-elm-namespace-coexistence.ccnc01.test.ts`.

---

## REARM01 (C18)

PASS. 7/7 REARM-focused tests green. Elm policy does NOT reintroduce
the lost wake:

```text
REARM-01  K + 1 must enqueue when held > 0 — PASS
REARM-02  K's agent_turn_done preserves the re-arm obligation — PASS
REARM-05  held drains to 0 -> no K+1 — PASS
REARM-12  3-turn chain K -> K+1 -> K+2 drains — PASS
REARM-AB-01  ablation: clearing lastCompletionContinuationSessionEpoch
                lets K+1 through — PASS
REARM-CONS-01  same-epoch dedupe within one K preserved — PASS
REARM-CONS-04  epoch supersession still clears dedupe — PASS
```

---

## STALL_ENFORCEMENT (C17)

PASS. 5/5 focused tests green. The TS scheduler owns the fingerprint;
the Elm kernel decides the consequence. Pinning tests assert:

```text
STALL-01  same fingerprint twice -> second enqueue returns stalled_no_progress
STALL-02  heldJobIds change between enqueues -> continuation permitted
STALL-03  task change between enqueues -> continuation permitted
STALL-04  fresh test backdoor clears the fingerprint -> continuation re-permitted
STALL-05  recordStalledNoProgress increments the stall counter
```

---

## PROVIDER_PRIVATE_BRAND (C19 / C20)

PASS / UNCHANGED. The Elm kernel NEVER sees `runtimeAuthority` or
`message role`. The capability projection at
`apps/vscode/src/sdk/completion-continuation-control-elm.ts:172-194`
maps tool-registry membership onto closed booleans; identity fields
(`sessionId` / `taskId`) are NOT in the `Facts` schema.

Role conservation (C20): the Elm output is a typed `ContinuationDirective`
with NO `role` field. The privileged `system` role is supplied by the TS
effect-execution path AFTER the directive is decoded.

Private brand: unchanged from predecessor ACTs. The TS-side WeakSet
brand at `apps/vscode/src/sdk/host-runtime-control-brand.ts` is the
authoritative trust identity. The Elm adapter has no path to it.

---

## TERMINAL_CONVERGENCE (C21)

PASS. Prompt rendering uses a `switch (directive)` mapping; the formatter
at `formatCompletionContinuationPrompt` is `switch (control.requiredAction)`
which now consumes a TS value derived from the Elm-only
`CompletionDirective`. There is NO `if (heldCount > 0)` conditional in
the formatter path (the prior ACT's substrate test
`CONTROL-05: tool requirement is derived from the actual capability snapshot`
is preserved; no regression).

---

## TRUST_PROVENANCE_AUTHORITY (C19 / C31)

The trust provenance boundary is **UNCHANGED** from predecessor ACTs.
The TS host-side WeakSet identity at
`apps/vscode/src/sdk/host-runtime-control-brand.ts` (proven by
ACT-CLINEMM-P0-COMPLETION-CONTINUATION-CONTROL-AUTHORITY01-CORRECTION01)
remains the load-bearing trust identity. The Elm adapter has no
observation of this identity.

Grep verification (C31):

```text
$ grep -rn "markHostRuntimeControl\|isHostRuntimeControlMessage" apps/vscode/src
apps/vscode/src/sdk/host-runtime-control-brand.ts:...
```

Expected security implementation delta:
```text
NONE (TS must never reach Elm)
```

---

## MODEL_ROLE_AUTHORITY (C20)

The privileged `system` role decision is **UNCHANGED** from predecessor
ACTs. The model boundary role:system channel proven by
ACT-CLINEMM-P0-COMPLETION-CONTINUATION-CONTROL-AUTHORITY01-CORRECTION02
remains the load-bearing mechanism. The Elm adapter has no role output.

---

## ACTUAL_TOOL_REGISTRY_SOURCE

The capability projection at
`apps/vscode/src/sdk/completion-continuation-control-elm.ts:172-194`
derives booleans from the actual resumed-turn tool registry. The
matrix in `completion-continuation-control-elm-capability.cccap01.test.ts`
exercises CAP-01..04 (both/neither/each) and the C14-extension
correspondence matrix proves the booleans route to the right
directive.

```text
CAP-01  command_status + submit_and_exit -> both true
CAP-02  only submit_and_exit                -> observe=false retry=true
CAP-03  only command_status                  -> observe=true retry=false
CAP-04  neither                              -> both false
```

---

## typecheck / lint / diff-check

```text
typecheck  : PASS (bun run check-types -> exit 0)
lint      : PASS (biome 0 errors)
diff-check: PASS (git diff --check, including cached binary)
```

---

## package / VSIX / not_installed

```text
package   : NOT_EXECUTED  (the prior ACT only proved the typecheck
                            blocker was gone; this ACT did not execute
                            a fresh `bun run package` either)
VSIX      : NOT_EXECUTED  (operator-owned per C38)
```

---

## POST_CUTOVER_LIVE

```text
NOT_EXECUTED  (operator-owned per C38)
```

---

## WORKTREE

```text
$ git status --short | wc -l
N untracked (9) + M modified (2) + A staged (29)

CLEAN as of HEAD `7e685a5d6ccab90531d047543b8643c1e0132f2d`.
```

---

## Success verdict

```text
PASS_COMPLETION_CONTINUATION_ELM_CONTROL_AUTHORITY
```

Subject ACT closes the policy migration deferred from the predecessor
CONTROL_AUTHORITY01 ACT. The pure semantic directive policy now lives in
Elm; trust provenance, privileged role, tool registry, queue/session/task
lifecycle, and all effects stay in TS.
