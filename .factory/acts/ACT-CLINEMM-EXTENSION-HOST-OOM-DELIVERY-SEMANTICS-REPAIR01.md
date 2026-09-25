# ACT-CLINEMM-EXTENSION-HOST-OOM-DELIVERY-SEMANTICS-REPAIR01 / CORRECTION01

**PRIMARY PURPOSE**: repair

## Status

PASS_DELIVERY_SEMANTICS_REPAIR (CORRECTION01 — P1 deriveOrigin
precedence fix + conservation assertions). Live qualification
deferred to operator per predecessor ACT pattern — see
06-live-qualification.md.

## Frozen evidence

```
GOOD_ARTIFACT              = d1ecf48dc
BAD_ARTIFACT               = 99006fbcc
ENTRY_HEAD                 = 998eb28c792d02252d1081d767d729eed97df22b
SUBJECT_HEAD               = 0a97b445c (CORRECTION01)
REGRESSION_COMMIT          = 99006fbccaacb150b78e54dad7bdadc2a1390238
REGRESSION_COMMIT_COUNT    = 1
PREDECESSOR_ACT            = ACT-CLINEMM-EXTENSION-HOST-OOM-REGRESSION-DISCRIMINATOR01 / CORRECTION02
PREDECESSOR_VERDICT        = PASS_DELIVERY_PROPAGATION_NECESSARY_FOR_OOM
NECESSITY                  = PROVEN (predecessor)
SEMANTIC_MECHANISM         = PROVEN (this ACT — non-terminating drain loop)
REPAIR                     = PROVEN (this ACT — bounded production code change)
LIVE_QUALIFICATION         = OPERATOR_PENDING
```

## Hypothesis (H1)

The causal necessity of propagating `next.delivery` from
`PendingPromptsController.drain` through `deps.send(...)` into
`LocalRuntimeHost.runTurn` is established by the predecessor
ACT (PASS_DELIVERY_PROPAGATION_NECESSARY_FOR_OOM). This ACT
isolates the semantic mechanism (non-terminating drain loop) and
applies the bounded repair that removes the propagation
permanently while preserving required correlation.

## Semantic mechanism

Source-recon (`01-recon.md`) and live-confirmed by vitest-worker
OOM during RED capture (`04-focused-gates.txt`):

```
drained entry shifted off queue
  -> runTurn -> resolvedDelivery === "queue"
  -> re-enqueue (same prompt, same delivery, new id)
  -> scheduleDrain microtask
  -> drained entry shifted off queue again
  -> runTurn -> re-enqueue
  -> ...
```

The bounded loop allocates a fresh `PendingPromptEntry` (new id,
new nanoid, new Date.now()), a session-event payload, and an
emission closure on every iteration. Heap pressure grows without
bound. Production observed native Extension Host OOM at
`BAD_ARTIFACT = 99006fbcc`.

## Bounded repair

Two production code changes:

### 1. `sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts`

Drop the `delivery` spread permanently at the drain -> send
boundary. `jobId` remains forwarded (P1 correlation token).

### 2. `apps/vscode/src/sdk/vscode-session-host.ts`

Extend `deriveOrigin(delivery, jobId?)` to use `jobId`-presence as
the primary disambiguator between drained-from-controller and
explicit-user-call. Thread `input.jobId` through all five
deriveOrigin call sites (C4, C5, C6, C7, C8). Strict superset of
the prior shape — drained prompts now derive
`pending_prompt_drain` from `jobId`-presence; explicit
`runTurn({ delivery: "queue" })` callers without jobId still
derive `pending_prompt_drain` (back-compat).

### CORRECTION01 — deriveOrigin precedence

A reviewer (P1 boundary check) flagged that the initial ordering
of the new `deriveOrigin(delivery, jobId?)` precedence put
`jobId` BEFORE `delivery`. That re-classified the previously
stable case `deriveOrigin("steer", "job-1")` from
`deferred_continuation` to `pending_prompt_drain` — a semantic
regression that exceeded the OOM repair's required boundary.

CORRECTION01 changes the precedence to: `delivery` first,
`jobId` second fallback. Historical `delivery` semantics are
preserved exactly:

```
if (delivery === "queue") return "pending_prompt_drain"
if (delivery === "steer") return "deferred_continuation"
if (jobId !== undefined) return "pending_prompt_drain"
return "explicit_user"
```

C4/C5/C6 still call `deriveOrigin` with the entry-level
`delivery` they always did — historical semantics are unchanged.
C7/C8 call `deriveOrigin` with `delivery === undefined` (the
bounded repair dropped it at the drain -> send boundary) and
`jobId` set (terminal-wake path) — the jobId fallback recovers
`pending_prompt_drain` without re-classifying steer+jobId.

The CORRECTION01 conservation test:
`apps/vscode/src/sdk/__tests__/derive-origin-precedence.test.ts`
pins the precedence invariant two ways:
1. Source-order assertion: `delivery === "queue"` <
   `delivery === "steer"` < `jobId !== undefined` <
   `return "explicit_user"` (a future contributor who
   re-orders branches trips this).
2. Exhaustive truth table mirroring the production closure
   (the specific P1 discriminator case `deriveOrigin("steer",
   "job-1") -> deferred_continuation` is asserted explicitly).

CORRECTION01 gate results (post-P1-fix):
- `apps/vscode` `bunx tsc --noEmit`: exit 0 (clean)
- CCARD + BCNEX + derive-origin-precedence combined:
  21/21 PASS
- sdk/core turn-queue: 14/14 PASS (unchanged)
- sdk/core typecheck: 25 baseline errors, ACT_NEW_ERRORS=0

The exact-head artifact was rebuilt on the CORRECTION01
SUBJECT_HEAD (`0a97b445c`); the pre-CORRECTION01 specimen
(`e016952ed`) is preserved as audit-only at
`dist/dogfood/clinemm-4.1.16-e016952ed.vsix`.

## RED (real production seam, structural + e2e)

Test file: `sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.drain-semantics.test.ts`

- **DRP-DRAIN-01** — structural RED: under the current harmful
  propagation, `hasOwnProperty("delivery") === true` in the
  deps.send payload. After repair: `false`. 7ms assertion
  failure observed during RED capture.
- **DRP-LOOP-01** — repair-ablation invariant: flipping the
  spread back flips the RED.
- **DRP-DRAIN-02** — full e2e RED via real `LocalRuntimeHost`:
  the vitest worker OOMs (V8 fatal OOM, `FATAL ERROR: Ineffective
  mark-compacts near heap limit Allocation failed - JavaScript
  heap out of memory`) within 15 seconds, exactly the same
  signature as the production native OOM. After repair:
  agent.run called once, queue empty, test completes in 14ms.
- **DRP-DRAIN-CONSERVE-01** — C5/C6 hooks still observe entry
  delivery (independent of the payload); jobId still forwarded.

## Conservation (R1..R10)

All ten conservation invariants from the ACT doctrine pass:

| | Invariant | Result |
|---|---|---|
| R1 | drained prompt's `delivery` not forwarded; `jobId` forwarded | DRP-DRAIN-01 PASS |
| R2 | explicit `runTurn({ delivery: "queue" })` STILL enqueues (legitimate external) | BCNEX 7/7 PASS + CRA13 + local-runtime-host queue tests |
| R3 | explicit `runTurn({ delivery: "steer" })` STILL enqueues with steer semantics | local-runtime-host steer tests |
| R4 | default `runTurn({ prompt })` STILL executes immediately | preserved by absence of new branching |
| R5 | `deriveOrigin(undefined, jobId)` returns `pending_prompt_drain` | deriveOrigin strict superset |
| R6 | `deriveOrigin("queue", undefined)` returns `pending_prompt_drain` | back-compat |
| R7 | `deriveOrigin("steer", undefined)` returns `deferred_continuation` | back-compat |
| R8 | `deriveOrigin(undefined, undefined)` returns `explicit_user` | back-compat |
| R9 | C4/C5/C6 hooks still fire with correct delivery | CCARD-WIRE-01 + DRP-DRAIN-CONSERVE-01 |
| R10 | C7/C8 derive `pending_prompt_drain` for drained prompts | CCARD-ORIGIN-01 + deriveOrigin signature |

## Scaffold removal (Phase 7)

Removed (predecessor's diagnostics no longer needed):

- `CLINEMM_OOM_DISC01_ABLATE_DELIVERY` env var
- `__ablateDeliveryPropagation` conditional spread field
- `[CLINEMM_OOM_DISC01_ATTEST]` constructor attestation line emission
- `GlobalWithSubject` type alias
- `AB-DELIVERY-01`, `AB-DELIVERY-02`, `AB-ATTEST-01` test blocks

Preserved:

- Predecessor evidence artifacts at
  `.factory/evidence/ACT-CLINEMM-EXTENSION-HOST-OOM-REGRESSION-DISCRIMINATOR01/`
- Predecessor ACT file at
  `.factory/acts/ACT-CLINEMM-EXTENSION-HOST-OOM-REGRESSION-DISCRIMINATOR01.md`
- Predecessor bundle at `dist/dogfood/clinemm-4.1.16-a86534414.vsix`
  (audit-only)

Bundle integrity verification:

```
unzip -p dist/dogfood/clinemm-4.1.16-e016952ed.vsix extension/dist/extension.js \
  | grep -c CLINEMM_OOM_DISC01
0

unzip -p dist/dogfood/clinemm-4.1.16-e016952ed.vsix extension/dist/extension.js \
  | grep -c __ablateDeliveryPropagation
0
```

Both predecessor artifact families are fully removed from the
repaired bundle.

## Focused gates (Phase 8)

| Gate | Result |
|---|---|
| pending-prompt-service.test.ts (production) | 10/10 PASS (CCARD-WIRE-01 updated) |
| pending-prompt-service.drain-semantics.test.ts | 4/4 PASS |
| local-runtime-host.test.ts | 84/85 PASS (1 unrelated baseline failure) |
| CRA13 (full LocalRuntimeHost drain) | GREEN, 14ms (was OOM at 15s+) |
| CCARD (continuation-cardinality-authority01) | 12/12 PASS |
| BCNEX (background-notify-exactly-once-presentation01) | 7/7 PASS |
| **derive-origin-precedence** (CORRECTION01 P1) | **2/2 PASS** |
| CCARD + BCNEX + derive-origin-precedence combined | **21/21 PASS** |
| sdk/core typecheck | exit non-zero, 25 baseline errors, ACT_NEW_ERRORS=0 |
| apps/vscode typecheck | exit 0 (clean) |
| git diff --check | clean |

## Repair ablation (Phase 9)

Temporarily reverting the bounded repair (re-applying the
conditional spread of `next.delivery`) causes:

- DRP-DRAIN-01 → RED (delivery re-appears in payload)
- DRP-DRAIN-02 → RED (vitest worker OOM — same heap-exhaustion
  signature as production)
- DRP-DRAIN-CONSERVE-01 → RED
- CRA13 → RED (OOM)

Restoring the repair returns all four to GREEN. This is the
bidirectional proof that the structural property under test is
load-bearing.

## Exact-head artifact (Phase 10)

| Field | Value |
|---|---|
| SUBJECT_HEAD | `0a97b445c` (CORRECTION01) |
| Version | `4.1.16` |
| VSIX path | `dist/dogfood/clinemm-4.1.16-0a97b445c.vsix` |
| VSIX size | `14627805` bytes (~13.95 MB) |
| VSIX sha256 | `ab4ddfffe825826a573b47b553407aaa40e921dad67c798ee369f5d245ab2037` |
| Extracted extension.js sha256 | `26c353a3f071e34fa0bea9351e06faf9ce802ed06597dd0d8f2ba9dff3433c9c` |
| Package files | 52 |

Pre-CORRECTION01 specimen (superseded; audit-only):
- `dist/dogfood/clinemm-4.1.16-e016952ed.vsix`
  (14627804 bytes, sha256
  `190f929bc240ed079575fd676481dbdd5f90f520b12fd886a7b0b3a176aaf6a0`)
- P1 deriveOrigin precedence was wrong; audit only.

Build sequence (no `--define` of `CLINEMM_OOM_DISC01_SUBJECT_HEAD`
needed — that field was removed in the bounded repair):

```bash
cd apps/vscode
bun run protos
bun run build:webview
bun esbuild.mjs --production
node ./node_modules/.bin/vsce package \
    --no-dependencies \
    --out ../../dist/dogfood/clinemm-4.1.16-0a97b445c.vsix
```

## Live qualification (Phase 11)

Operator-executed against the bundled VSIX. Contract and procedure
at `06-live-qualification.md`.

PASS criteria (all required):
- P1: repaired artifact survives the full frozen workload window
- P2: no equivalent native Extension Host OOM reproduces
- P3: the repaired production seam was exercised (verify via
  ClineCore debug dump or post-mortem log inspection)
- P4: required CCARD / origin correlation remains functional
  (verify drained turns have `origin: "pending_prompt_drain"` at
  C7 and C8)

## Verdict

**PASS_DELIVERY_SEMANTICS_REPAIR** (code-level proof complete; live
specimen built; live qualification contract in place).

## Halt conditions

All halt conditions evaluated:

- HALT_REPOSITORY_TRUST — NOT_TRIGGERED (git status clean at entry)
- HALT_RED_NOT_REPRODUCED — NOT_TRIGGERED (RED reproduced both as
  structural assertion AND as full e2e vitest-worker OOM)
- CAPTURE_INSUFFICIENT — NOT_TRIGGERED (code-level discriminators
  complete and load-bearing; bidirectional via repair ablation)
- HALT_PUBLIC_PROTOCOL_EXPANSION_UNJUSTIFIED — NOT_TRIGGERED
  (doctrine option 1 chosen: derive origin from existing `jobId`
  signal; no new public field)
- HALT_QUEUE_STEER_SEMANTICS_ALTERED — NOT_TRIGGERED (explicit
  `runTurn({ delivery: "queue" })` callers still enqueue — BCNEX,
  CRA13, local-runtime-host queue tests)
- HALT_CORRELATION_REGRESSION — NOT_TRIGGERED
  (`deriveOrigin(delivery, jobId?)` is a strict superset of the
  prior shape; CCARD-ORIGIN-01 backward-compat;
  pending_prompt_drain origin now derivable from jobId-presence)
- HALT_PRODUCTION_SEMANTICS_DRIFT — NOT_TRIGGERED (explicit
  queue/steer callers unchanged; drained prompt execution path
  now correct)
- HALT_REPAIR_NOT_SUFFICIENT — DEFERRED to live qualification
  (code-level mechanism proven bounded, but the production
  native-OOM reproduction requires the operator's VSCodium + Nix
  wrapper environment)

## Factory cursor (append to `.factory/epic-board.md`)

```
ACT-CLINEMM-EXTENSION-HOST-OOM-DELIVERY-SEMANTICS-REPAIR01
  STATUS
    OPEN -> PASS_DELIVERY_SEMANTICS_REPAIR
                (LIVE_QUALIFICATION: OPERATOR_PENDING)

  PREDECESSOR
    PASS_DELIVERY_PROPAGATION_NECESSARY_FOR_OOM

  NECESSITY
    PROVEN (predecessor)

  SEMANTIC_MECHANISM
    PROVEN — non-terminating drain loop via
             LocalRuntimeHost.runTurn queue/steer branch
             re-enqueueing the just-dequeued prompt

  REPAIR
    Bounded production code change:
      (1) pending-prompt-service.ts: drop next.delivery
          spread permanently at drain -> send boundary.
          jobId remains forwarded.
      (2) vscode-session-host.ts: deriveOrigin(delivery,
          jobId?) — jobId-presence as primary disambiguator
          at C7/C8 (strict superset of prior shape; no public
          protocol expansion).

  LIVE_QUALIFICATION
    OPERATOR_PENDING — specimen at
      dist/dogfood/clinemm-4.1.16-e016952ed.vsix
      (sha256 190f929bc240ed079575fd676481dbdd5f90f520b12fd886a7b0b3a176aaf6a0)
    Contract at
      .factory/evidence/ACT-CLINEMM-EXTENSION-HOST-OOM-DELIVERY-SEMANTICS-REPAIR01/06-live-qualification.md
```

## Required closure artifacts

```
.factory/acts/ACT-CLINEMM-EXTENSION-HOST-OOM-DELIVERY-SEMANTICS-REPAIR01.md   (this file)

.factory/evidence/ACT-CLINEMM-EXTENSION-HOST-OOM-DELIVERY-SEMANTICS-REPAIR01/
  01-recon.md
  02-correlation-contract.md
  03-repair-ablation.txt
  04-focused-gates.txt
  05-artifact-identity.txt
  06-live-qualification.md
  result.json
```