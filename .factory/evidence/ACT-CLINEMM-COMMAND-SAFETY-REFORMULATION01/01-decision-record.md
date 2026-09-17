# ACT-CLINEMM-COMMAND-SAFETY-REFORMULATION01
# Decision Record

## Classification

```
BOUNDED_HOST_COMPOSITION_REFORMULATION

NOT:
  decision kind lattice change (no new CommandDecisionKind)
  wire/proto widening
  quoted-pattern V2 promotion
  CLI UX redesign
  model intent classification
```

## Production seam (frozen, recon-verified)

```
tool proposal
  ↓
host command policy  (apps/vscode/src/sdk/sdk-tool-policies.ts)
  ↓
SdkInteractionCoordinator.runRequestToolApproval
  (apps/vscode/src/sdk/sdk-interaction-coordinator.ts:296)
  ↓
DENY short-circuit (existing; unchanged)     → { approved: false, reason }
REFORMULATE branch (NEW)                     → { approved: false, reason }
  + arm one-shot slot (agentId, conversationId)
ASK fall-through (existing; unchanged)       → opens approval UI
ALLOW path (existing; unchanged)             → execute
```

The DENY short-circuit at `sdk-interaction-coordinator.ts:296-300` is
the structural prototype for the REFORMULATE branch. Identical shape:
`{ approved: false, reason }` returned WITHOUT opening approval UI.

## Reformulation eligibility (FROZEN, reviewer-corrected)

```text
REFORMULATABLE iff:
  1. canonical decision.kind === "ask"
  2. canonical decision.source === "host_mode_safe_only_fallthrough"
  3. hostAuthorization.mode === "safe-only"     (from the evaluated auth)
  4. containsUnquotedShellPattern(rawInput) === true
  5. no active reformulation slot for this (agentId, conversationId)
  6. no DENY / R5 / realpath / manual-mode condition
```

Items 2 + 4 are sufficient together: the canonical source narrows to a
non-danger fall-through; the source-text probe narrows to the proven
avoidable-syntax class. Item 3 uses the ACTUAL evaluated authorization
mode (P1 from the Factory reviewer), not assumed UI / config state.

## Continuation identity (FROZEN, reviewer-corrected)

```
agentId + conversationId
```

One-shot slot on `SdkInteractionCoordinator`. On arm, the next
`run_commands` proposal in the same conversation consumes the slot
BEFORE evaluating. The slot is cleared in `clearPending` on session
teardown. This is a `BOUNDED_CONVERSATION_CONTINUATION`, not a
semantic-intent chain.

## Why not a new `CommandDecisionKind`

```
ALLOW    command may execute                       (unchanged)
ASK      operation legitimately requires authority  (unchanged)
DENY     command is prohibited at this authority    (unchanged)

REFORMULATE = internal host-composition marker
  - Sits AFTER the DENY short-circuit
  - Sits BEFORE the ASK fall-through
  - Mirrors the DENY short-circuit shape: returns
    { approved: false, reason } without approval UI
  - Carries an internal side-effect (slot arm) that the host
    consumes on the next proposal in the same conversation
```

This avoids infecting every `kind === "ask"` consumer in the SDK with
a new authority state. The public wire, the policy lattice, and all
unrelated ASK consumers are unchanged.

## Provenance discipline

`containsUnquotedShellPattern(input)` operates on the original
shell-string source text. It recognizes ONLY the known-bad form:

```text
shell command starting with `find`
followed by an unquoted glob metacharacter (* ? [ ] { })
in one of the reviewed pattern predicates:
  -name / -iname / -path / -ipath / -regex / -iregex
```

No reconstructed-argv heuristic. No quote-provenance inference (that
is the deferred V2 quoted-pattern-provenance ACT). When the trusted
parser source-text path is the only authoritative way to prove the
fact, the classifier returns `false` (CAPTURE_INSUFFICIENT
discipline).

## Model-facing feedback

```text
Host safety policy rejected this command before execution.
Construct a safer equivalent that preserves the intended operation
while preventing shell pathname expansion.
```

No matcher names, no regex internals, no token offsets, no suggested
bypass syntax, no "do not repeat" language (host enforces cardinality).

## Internal reason code (V2 capture)

```
REFORMULATION_REASON_CODE = "UNQUOTED_SHELL_PATTERN"

codePoint = "commandSafety.reformulation.v1"
data      = { reasonCode, attempt: 1, maxAttempts: 1 }
```

Capture is opt-in (env `CLINEMM_CAPTURE_V2_PATH`), best-effort, and
does NOT change the rejection behavior.

## Files touched (this ACT)

| File | Change |
|---|---|
| `sdk/packages/core/src/runtime/command-policy/reformulation-classifier.ts` | NEW: deterministic source-level probe (extractShellSource, containsUnquotedShellPattern, isReformulatable) + REFORMULATION_REASON_CODE + REFORMULATION_MODEL_FACING_MESSAGE |
| `sdk/packages/core/src/runtime/command-policy/reformulation-classifier.test.ts` | NEW: 29 unit tests pinning provenance + eligibility |
| `sdk/packages/core/src/runtime/command-policy/index.ts` | re-export reformulation symbols |
| `sdk/packages/core/package.json` | NEW subpath export `@cline/core/runtime/command-policy` |
| `sdk/packages/core/bun.mts` | add `runtime/command-policy/index.ts` build entry |
| `apps/vscode/src/sdk/sdk-interaction-coordinator.ts` | import reformulation symbols; extend optional evaluator return shape (hostAuthorization?); add pendingReformulationSlot field + reformulationBlockedForThisCall flag; add reformulation branch between DENY and ASK; consume slot in clearPending |
| `apps/vscode/src/sdk/sdk-interaction-coordinator.test.ts` | +12 production-seam tests (RED, GREEN 1-4, NEGATIVE x4, ABLATION, clearPending); refactor makeCoordinator helper typing |
| `apps/vscode/vitest.config.ts` | +1 alias `@cline/core/runtime/command-policy` to live TS source |
| `apps/cli/src/runtime/command-policy-host.test.ts` | +2 CLI label tests asserting CLI_REFORMULATION = NOT_IMPLEMENTED (no behavior change for CLI host adapter) |

## Files NOT touched (out of scope, frozen for future ACTs)

- `command-safe-rules.ts` (canonical regex unchanged)
- `command-policy.ts` (no new canonical decision kind)
- `command-policy-types.ts` (no type widening)
- All wire / proto files
- V2 parser-helper files
- CLI host adapter behavior (explicitly labeled CLI_REFORMULATION = NOT_IMPLEMENTED)

## Conservation

- V1 lexical primitives unchanged.
- R5 hard floor unchanged.
- DENY short-circuit unchanged (reformulation branch sits AFTER it).
- ALLOW path unchanged.
- ASK fall-through unchanged for non-reformulatable decisions.
- `clearPending` continues to clear pending approvals, plus now drops the reformulation slot.
- All pre-existing test suites pass:
  - SDK command-policy: 573/573
  - VSCode vitest: 2076/2076
  - CLI command-policy-host: 48/48

## Pre-existing failures (NOT introduced by this ACT)

Verified by stash-check on `main`:

- `apps/cli/src/main.test.ts` (4 tests): CLI runCli dispatch tests, unrelated to command-policy reformulation
- `apps/cli/src/runtime/interactive/approvals.real-helper.test.ts`: CLI REAL binary test (V2 wired), requires the bundled parser helper
- `sdk/packages/core/src/runtime/command-policy/parser-provenance.test.ts` and `parser-helper/runtime.real-binary.test.ts`: V2 parser helper tests requiring the bundled binary

These are pre-existing environment/test drift; the ACT does not touch
their surface and does not regress them.

## Decision: GO.

```text
PASS_COMMAND_SAFETY_REFORMULATION_PROTOCOL
```

The bounded reformulation protocol is in place:

```
unsafe unquoted find pattern
  -> REFORMULATE (no UI, prose rejection, slot armed)

next proposal in same conversation
  -> slot consumed, ordinary policy (likely ASK at V1)

different conversation
  -> independent slot

later unsafe proposal
  -> may reformulate again

DENY / R5 / realpath authority / manual mode / quoted pattern
  -> unchanged (conservation)
```

## Production wiring (DONE in this ACT)

The Coordinator's optional `evaluateCommandToolApproval` callback now
expects to receive `hostAuthorization` (mode + workspace roots +
realpath evidence) when present. The production wiring at
`SdkController.ts:448` (the `evaluateCommandToolApprovalWithPlan`
call site) populates this field — the reformulation branch fires in
production today.

The `buildSdkControllerEvaluateCommandToolApproval` factory's
callback return shape was extended to include
`hostAuthorization?: CommandHostAuthorization`. Tests and older
callers that omit the field fall back to the safe-by-default path
(no reformulation); the ABLATION test pins this.

CLI parity is honestly labeled NOT_IMPLEMENTED.
