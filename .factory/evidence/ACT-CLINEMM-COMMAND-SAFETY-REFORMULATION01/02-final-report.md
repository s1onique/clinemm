# ACT-CLINEMM-COMMAND-SAFETY-REFORMULATION01
# Final Report

## Closure disposition

**Closed at the production-fix commit (HEAD after this ACT).**

The reformulation protocol is wired in production:
- `apps/vscode/src/sdk/sdk-interaction-coordinator.ts` (host composition)
- `apps/vscode/src/sdk/SdkController.ts:448` (production evaluator returns `hostAuthorization`)
- `sdk/packages/core/src/runtime/command-policy/reformulation-classifier.ts` (deterministic source-level probe)

## RED/GREEN proof

### RED — current (pre-fix) UI behavior

`find . -name *.ts` in safe-only mode:
```
execution       NO
approval UI     YES
agent feedback  NONE (model has no remediation guidance)
```

### GREEN 1 — reformulation seam (production seam test)

```ts
test("RED: today, ASK with unquoted-shell-pattern source opens the approval UI")
  → approval UI queued ✓ (PASSES pre-fix; FAILED pre-fix on this test
                           confirms RED was pinned)

test("GREEN 1: reformulatable ASK is short-circuited; no approval UI; agent receives bounded reason")
  → approved: false
  → reason contains "Host safety policy rejected this command before execution"
  → reason contains "preventing shell pathname expansion"
  → no approval UI queued
```

### GREEN 2 — slot consumed on next proposal

```ts
test("GREEN 2: next run_commands in same conversation consumes slot, runs ordinary policy")
  → proposal A: REFORMULATE (approved=false, prose reason)
  → proposal B: ordinary policy -> approval UI queued
  → reformEval called 2x (one for each proposal)
```

### GREEN 3 — later unsafe proposal may reformulate again

```ts
test("GREEN 3: a later unsafe proposal in the same conversation may reformulate again")
  → proposal A: REFORMULATE
  → proposal B: ordinary policy (consumed slot)
  → proposal C (later iteration): REFORMULATE again (slot re-armed)
```

### GREEN 4 — slot does not cross conversation boundaries

```ts
test("GREEN 4: slot does NOT cross conversation boundaries")
  → coord1.conversationA reformulates
  → coord2.conversationB reformulates independently
  → no UI queued in either conversation
```

### Card-clear

```ts
test("clearPending() drops the pending reformulation slot")
  → arm slot via proposal A
  → coordinator.clearPending("test teardown")
  → proposal B (same conversation): reformulates anew
```

## NEGATIVE controls (all pass)

| Test | Outcome |
|---|---|
| DENY decision is unchanged by the reformulation branch | DENY returns `{approved:false, reason:"dangerous command"}` WITHOUT UI |
| ASK from `host_workspace_realpath_authority` source does NOT reformulate | approval UI opens |
| ASK from `host_mode_safe_only_fallthrough` for QUOTED pattern does NOT reformulate | approval UI opens |
| `hostAuthorization.mode === "manual"` does NOT reformulate | approval UI opens |
| `hostAuthorization` field omitted from evaluator result (safe-by-default) | approval UI opens |

## Conservation (production-seam tests at the `SdkInteractionCoordinator` level)

| Test | Outcome |
|---|---|
| emits a tool approval ask and resolves approval from askResponse state | unchanged |
| records the real approval row timestamp that the translator reuses | unchanged |
| resolves denied tool approval with the user reason | unchanged |
| DENY => approval UI NOT opened; approved=false returned immediately | unchanged |
| DENY => approval UI NOT opened even if policy.autoApprove=true | unchanged |
| ASK => approval UI opened; YES => execute with plan | unchanged |
| ASK => approval UI opened; NO => rejected | unchanged |
| ALLOW => auto-approved immediately; no approval UI | unchanged |
| non-command tool with autoApprove=true => auto-approved | unchanged |
| non-command tool with autoApprove=false => approval UI opened | unchanged |

## RED/GREEN matrix (SDK unit tests for the classifier)

```
29/29 reformulation-classifier unit tests pass:
  - REFORMULATION_REASON_CODE
  - REFORMULATION_MODEL_FACING_MESSAGE
    (mentions preventing shell pathname expansion)
    (does NOT mention matcher internals)
    (does NOT include 'do not repeat' / 'last chance')
  - extractShellSource (6 shapes + CAPTURE_INSUFFICIENT)
  - containsUnquotedShellPattern (positive + negative + quoted + bash-c)
  - isReformulatable (eligibility predicate — all 6 conditions)
```

## CLI disposition

```
CLI_REFORMULATION = NOT_IMPLEMENTED
```

CLI host adapter is NOT modified. The CLI label test asserts:
- CLI canonical source for the unquoted pattern is `host_mode_safe_only_fallthrough`
- CLI decision reason does NOT contain the reformulation prose
- CLI tests pin the absent behavior so future parity work is explicit

## Conservation: full test suite

| Suite | Result |
|---|---|
| SDK command-policy (`bunx vitest run src/runtime/command-policy`) | 573/573 PASS |
| SDK core unit (`bun run test:unit`) | 2538/2538 PASS (14 pre-existing skips) |
| VSCode vitest (`bun run test:vitest`) | 2076/2076 PASS |
| CLI command-policy-host (`bunx vitest run`) | 48/48 PASS |
| CLI full vitest | 1206/1210 PASS (4 pre-existing failures in `main.test.ts` + `approvals.real-helper.test.ts`, unrelated to this ACT; verified via stash-check on `main`) |
| Apps vscode typecheck (`bunx tsc --noEmit`) | PASS |
| Apps vscode lint | PASS |
| `git diff --check` | clean |

## Trust state

- HEAD: this ACT's commit (to be created)
- Branch: `main`
- origin/main: unchanged (ACT-committed work convention)
- NOT pushed
- All edits surgical; no edits to `out/`, `dist/`, or `src/generated/`

## Files changed (cumulative)

| File | Change |
|---|---|
| `sdk/packages/core/src/runtime/command-policy/reformulation-classifier.ts` | NEW: deterministic source-level probe |
| `sdk/packages/core/src/runtime/command-policy/reformulation-classifier.test.ts` | NEW: 29 unit tests |
| `sdk/packages/core/src/runtime/command-policy/index.ts` | re-export reformulation symbols |
| `sdk/packages/core/package.json` | NEW subpath export `@cline/core/runtime/command-policy` |
| `sdk/packages/core/bun.mts` | add `runtime/command-policy/index.ts` build entry |
| `apps/vscode/src/sdk/sdk-interaction-coordinator.ts` | extend optional evaluator return shape (hostAuthorization?); add pendingReformulationSlot field; add reformulation branch; consume slot at top of runRequestToolApproval; reformulationBlockedForThisCall flag; clear slot in clearPending |
| `apps/vscode/src/sdk/sdk-interaction-coordinator.test.ts` | +12 production-seam tests (RED, GREEN 1-4, NEGATIVE x4, ABLATION, clearPending); refactor makeCoordinator helper typing |
| `apps/vscode/vitest.config.ts` | +1 alias `@cline/core/runtime/command-policy` to live TS source |
| `apps/vscode/src/sdk/SdkController.ts` | production wiring: populate `hostAuthorization` in evaluator return + extend callback return shape |
| `apps/cli/src/runtime/command-policy-host.test.ts` | +2 CLI label tests asserting CLI_REFORMULATION = NOT_IMPLEMENTED |

## Verdict

```
PASS_COMMAND_SAFETY_REFORMULATION_PROTOCOL
```

The bounded reformulation protocol is in place:

- Deterministic source-level probe (no reconstructed-argv heuristic)
- 6-condition eligibility predicate with the actual evaluated host mode
- One-shot slot keyed by (agentId, conversationId) — bounded conversation
  continuation, NOT a semantic-intent chain
- No wire / proto / canonical-lattice widening
- Production wiring populates `hostAuthorization` so the branch fires
  in production today
- CLI parity honestly labeled NOT_IMPLEMENTED with assertion tests
- All NEGATIVE controls (R5, DENY, realpath, manual, quoted) verified at
  the production seam

## Out of scope (frozen for future ACTs)

- quoted-pattern V2 promotion
- realpath changes
- redirect safety
- pipeline safety
- cat/head/tail R0 expansion
- general model intent classification
- automatic rewriting performed by host
- multiple reformulation reason families
- CLI UX redesign
- wire/proto widening
- cross-conversation user experience tuning (slot dies with conversation;
  user cannot carry it across a /new conversation — intentional)

## Reopen conditions

- A new input shape is accepted by `normalizeRunCommandsInput` but
  `extractShellSource` rejects it (the unit tests pin the current
  contract; new shapes must add new tests).
- The trusted parser source-text path becomes available and can prove
  that a quoted pattern is safe (`ACT-CLINEMM-COMMAND-RISK-V2-QUOTED-PATTERN-PROVENANCE01`).
- A new reformulation reason family is introduced (e.g. UNQUOTED_REDIRECT).
  Each new family is a future ACT; V1 ships exactly UNQUOTED_SHELL_PATTERN.
- CLI parity is requested (`CLI_REFORMULATION = IMPLEMENT`). This ACT's
  CLI tests document the absent behavior to enable the follow-up.
