# ACT-CLINEMM-COMMAND-SAFETY-REFORMULATION01
# Recon Report

## Identity

```
ACT_ID=ACT-CLINEMM-COMMAND-SAFETY-REFORMULATION01
PRIMARY_EPISTEMIC_PURPOSE=
  Prove that an avoidably-unsafe command can be rejected by the
  deterministic host gate, returned to the agent as bounded
  reformulation guidance, and retried safely WITHOUT surfacing
  an approval request to the user.

INITIAL_REFORMULATION_CLASS=UNQUOTED_SHELL_PATTERN
EXAMPLE=find . -name *.ts
```

## Trust baseline (pinned at recon start)

```
BRANCH=main
WORKTREE=clean
ENTRY_HEAD=17e8ff98eff6879202e03deb940f91250a223ca7
ENTRY_TREE=2915cf2092e6e125d6f67dbe7769a53de4c786d2
ORIGIN_MAIN=f7db3b3b3d05a1adfce383a9b134762864b98390
TRACKED_DIRT=zero
IGNORED_DIRT=preserved (.factory/evidence, .husky/_, apps/cli/node_modules)
```

Prerequisite ACT
`ACT-CLINEMM-COMMAND-APPROVAL-SPLIT-UNDEFINED-REGRESSION01` is closed
(`PASS_COMMAND_APPROVAL_SPLIT_UNDEFINED_REGRESSION`); the reformulation
seam is unblocked.

## Production seam (R1–R6 answered)

| # | Question | Answer | Evidence |
|---|---|---|---|
| R1 | Where does ASK become a user approval card? | `SdkInteractionCoordinator.runRequestToolApproval` at `apps/vscode/src/sdk/sdk-interaction-coordinator.ts:294`. After the atomic command-policy evaluator returns `approved:false` for ASK, the code falls through to `buildToolApprovalAskMessage(...)` then `appendAndEmit([toolAskMessage])`. | grep `buildToolApprovalAskMessage` ↔ `appendAndEmit` |
| R2 | What does the model receive when approval is denied? | Structured tool result `{ output: { error: <denial reason> }, isError: true }`, surfaced via `runtime-event-adapter.ts` `content_end(executionDisposition: "rejected_before_execution")`. The reason text is verbatim from `approval.reason`. | `sdk/packages/agents/src/agent-runtime.ts:2547–2560` → line 2705–2709; reason channel precedents at `sdk/packages/core/src/runtime/tools/tool-approval.ts:37,101` and `sdk/packages/core/src/runtime/host/local-runtime-host.ts:715` |
| R3 | Can production return a tool rejection WITHOUT opening approval UI? | YES. Existing DENY short-circuit at `sdk-interaction-coordinator.ts:296–300`: `if (commandEval.decision?.kind === "deny") return { approved: false, reason: commandEval.decision.reason }` — skips `onToolApprovalAsk`, `buildToolApprovalAskMessage`, pending-Promise resolver. Runtime then takes `agent-runtime.ts:2552` → `skipReason = reason` → `{ output: { error: skipReason }, isError: true }`. | Direct read. |
| R4 | Does that result preserve enough context for the model to retry? | YES. `approval.reason: string` is the only model-facing channel. Prose in `{ output: { error } }` is sufficient. No wire change. | `agent-runtime.ts:2559–2560` is the entire model-facing surface for denial. |
| R5 | Is there already a reason channel that avoids wire/proto change? | YES. `approval.reason` is end-to-end and already used for user-deny, timeout, missing-IPC failures. | precedents at `tool-approval.ts:37,101`, `local-runtime-host.ts:715` |
| R6 | Where can retry cardinality be tracked without React coupling? | `SdkInteractionCoordinator` (one instance per `Controller` constructor). `ToolApprovalRequest` carries `agentId`, `conversationId`, `iteration`, `toolCallId`, `toolName`, `input`, `policy`. `conversationId` is the canonical cross-request continuation anchor. | `sdk-interaction-coordinator.ts:43–51`, `SdkController.ts:752` (single instantiation) |

### Verdicts

```
REFORMULATION_SEAM_FOUND
CAPTURE_INSUFFICIENT              = NO (V2 capture + AsyncLocalStorage in place)
HALT_WIRE_PROTOCOL_EXPANSION_REQUIRED = NO (denial reason is already the channel)
```

## Semantic lattice (frozen)

```
ALLOW    command may execute
ASK      operation legitimately requires human authority (unchanged)
DENY     command is prohibited at this authority level (unchanged)

REFORMULATE
  internal-only host-composition marker
  NOT a new CommandDecisionKind
  short-circuits the ASK fall-through path with a model-facing
  rejection, identical in shape to DENY short-circuit
```

## Reformulation eligibility (FROZEN)

```text
REFORMULATABLE iff:
  1. canonical decision.kind === "ask"
  2. canonical decision.source === "host_mode_safe_only_fallthrough"
  3. hostAuthorization.mode === "safe-only"     (from the evaluated auth, NOT assumed)
  4. containsUnquotedShellPattern(rawInput) === true
  5. no active reformulation slot for this (agentId, conversationId)
  6. no DENY / R5 / realpath-authority / manual-mode condition
```

Items 2 + 4 together are sufficient: the canonical source narrows to a
non-danger fall-through, and the source-text probe narrows to the
known avoidable-syntax class.

## Continuation identity (FROZEN)

```
agentId + conversationId
```

A one-shot slot lives on `SdkInteractionCoordinator`. On arm,
the next `run_commands` proposal in the same conversation consumes
the slot BEFORE evaluating, so the next command receives ordinary
policy. The slot is cleared in `clearPending` on session teardown.

This is a `BOUNDED_CONVERSATION_CONTINUATION`, not a semantic-intent
chain.

## Source-level provenance (FROZEN)

`containsUnquotedShellPattern(input)` operates on the original
shell-string source text and recognizes the known-bad form:

```text
shell command starting with `find`
followed by an unquoted glob metacharacter
in one of the reviewed pattern positions:
  -name / -iname / -path / -ipath / -regex / -iregex
```

The character class for "non-glob literal pattern" is identical
to the one already encoded in `command-safe-rules.ts:461` for
`host_safe_find`. No reconstructed-argv heuristic. No quote
provenance inference (that is the deferred
`ACT-CLINEMM-COMMAND-RISK-V2-QUOTED-PATTERN-PROVENANCE01`).
## Model-facing feedback (FROZEN)

```text
Host safety policy rejected this command before execution.
Construct a safer equivalent that preserves the intended operation
while preventing shell pathname expansion.
```

No matcher names, no regex internals, no token offsets, no
suggested bypass syntax, no "do not repeat" instruction (host
enforces cardinality; model instructions don't make safety
properties true).

## RED/GREEN matrix

### RED — current behavior

```bash
find . -name *.ts
```
Today:
```
execution       NO
approval UI     YES
```

### GREEN 1 — reformulation seam
```
execution       NO
approval UI     NO
agent rejection YES (prose)
slot armed      (agentId, conversationId)
reasonCode      UNQUOTED_SHELL_PATTERN
```

### GREEN 2 — exact repeat
```
slot consumed before evaluation
ordinary policy evaluation (ASK at V1)
approval UI     YES (today's behavior)
second hidden reformulation  NO
```

### GREEN 3 — quoted form
```
ordinary policy evaluation (ASK at V1)
no special ALLOW claim
```

### GREEN 4 — different unsafe command later in conversation
```
slot may re-arm
ordinary policy evaluation
```

## Conservation

```text
rm -rf "$HOME"              → R5 hard floor (existing)
find . -delete              → ordinary ASK/DENY (different source)
find . -exec rm {} \;       → ordinary ASK/DENY
git push                    → ordinary authority ASK
git branch -D foo           → ordinary authority ASK
bash -c 'find . -name *.ts' → ordinary policy; bash is its own rule family
unknown-command --foo       → ordinary ASK
```

## CLI disposition

```
CLI_REFORMULATION = NOT_IMPLEMENTED
```

CLI host adapter (`apps/cli/src/runtime/command-policy-host.ts`) is NOT
modified in this ACT. The CLI test asserts the absent behavior so future
parity is explicit.

## Out of scope (deferred to subsequent ACTs)

```
quoted-pattern V2 promotion
realpath changes
redirect safety
pipeline safety
cat/head/tail R0 expansion
general model intent classification
automatic rewriting performed by host
multiple reformulation reason families
CLI UX redesign
wire/proto widening
```

## Implementation order (from Factory reviewer)

```
 1. RED production-seam test (current UI behavior)
 2. source-level reformulation classifier + unit tests
 3. host-composition reformulation marker/result
 4. one-shot conversation slot (consume-before-evaluation)
 5. GREEN production-seam tests
 6. cardinality tests
 7. negative controls (R5, find -delete, git push, bash -c, quoted)
 8. ablation
 9. capture code point
10. focused/full gates
11. exact-head installed dogfood
```
