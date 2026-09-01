# ACT-CLINEMM-COMPACTION-TOKEN-ACCOUNTING-TRUTH-RECON01

> Status: **OPEN / RECON_ONLY**
> Verdict: **PENDING**
> Upstream: n/a (factory-internal LIVE symptom, 2026-09-01)
> Owning epic: [`EPIC-CONTEXT-COMPACTION-TOKEN-ACCOUNTING`](../epics/context-compaction-token-accounting.md)
> ACT ID: `ACT-CLINEMM-COMPACTION-TOKEN-ACCOUNTING-TRUTH-RECON01`
> Evidence: `.factory/evidence/ACT-CLINEMM-COMPACTION-TOKEN-ACCOUNTING-TRUTH-RECON01/`

## §0 — Frozen user-facing invariant

```text
Given any ClineMM session:

  The token total the model is billed for at every turn boundary
  MUST equal the sum of:
    (a) the actual tokens in the messages the SDK sent to the provider,
    (b) the actual tokens the provider reported in its response,
    (c) any tool/result tokens that crossed the boundary,
    (d) any summarization tokens consumed by the compaction pipeline.

  The compaction threshold (target tokens for the post-compaction window)
  MUST be honored against (a)+(b)+(c)+(d). If the post-compaction total
  exceeds the model's context window, the turn MUST NOT proceed without
  a visible "context window exceeded" error and a forced re-compaction
  or user-visible abort.

  The compaction pipeline MUST NOT silently drop tokens that the model
  was billed for, MUST NOT double-count tokens, and MUST NOT advertise a
  total below the actual total to the provider on the next turn.

This is the load-bearing property the fresh LIVE symptom described
by the factory causal reviewer (2026-09-01) — "obviously inconsistent
compaction/context accounting" — would violate if present in ClineMM.
```

## §1 — Mission outcome (one-line)

```text
QUESTION:  Does the ClineMM compaction pipeline preserve token-accounting
           truth across the compaction boundary, the model-billing boundary,
           and the context-window threshold?

ANSWER:    PENDING — this ACT is recon-only. No production change is
           authorized until the recon produces a verified classifier.

DISPOSITION: OPEN / RECON_ONLY / EVIDENCE_FIRST
```

## §2 — Scope

This ACT is **read-only / evidence-first**. The recon surface is bounded to:

  1. The SDK compaction pipeline:
     - `sdk/packages/core/src/extensions/context/compaction.ts` (725 lines)
     - `sdk/packages/core/src/extensions/context/compaction-shared.ts` (835 lines)
     - `sdk/packages/core/src/extensions/context/agentic-compaction.ts`
     - `sdk/packages/core/src/extensions/context/basic-compaction.ts`
     - `sdk/packages/core/src/extensions/context/budget-projection/project.ts` (676 lines)
  2. The token-counting utilities:
     - `sdk/packages/core/src/extensions/context/budget-projection/types.ts`
     - `sdk/packages/core/src/utils/json/tokens.ts` and any other token-estimator
  3. The host-side `overflowRecovery` consumer:
     - `sdk/packages/shared/src/agents/types.ts:660` (the `overflowRecovery?` flag)
     - `sdk/packages/shared/src/agent.ts:550`
     - `sdk/packages/core/src/runtime/host/runtime-host.ts:235` (the compaction
       knobs the host hands to the SDK)
  4. The CLI integration seam:
     - `apps/cli/src/runtime/interactive/compaction.ts`
     - `apps/cli/src/tui/cline-account.ts:146`
  5. Desktop sidecar:
     - `apps/examples/desktop-app/sidecar/commands.ts` (the compaction boundary
       the desktop app crosses)

NOT in scope (separate epics own these):
  - `task-presentation.md` (UI rendering of token state — distinct surface)
  - `runtime-task-progression.md` (post-tool-result continuation — distinct surface)
  - `tool-runtime-reliability.md` (CLOSED at `9f0e66353` — distinct surface)

## §3 — Distinct-from assertions (causal ownership)

  - **NOT a duplicate of `task-presentation.md`.** That epic owns rendering.
    This ACT owns the **arithmetic** — whether the post-compaction total is
    the truth the model sees.
  - **NOT a duplicate of `runtime-task-progression.md`.** That epic owns
    post-tool-result progression. This ACT owns the pre-turn boundary.
  - **NOT a duplicate of upstream #12939 (`replace_in_file` CPU).** Different
    defect class — performance, not accounting truth.
  - **NOT a duplicate of upstream #12388 (checkpoint run-identity).** Different
    defect class — run-identity bookkeeping, not token accounting.
  - **WHY NOW.** Per factory causal reviewer (2026-09-01): "Fresh LIVE
    symptom; may affect compaction threshold, context-limit safety and
    long-session behavior" — outranks imported upstream radar because it
    is ours, live, now.

## §4 — Source-recon plan (Q1–Q12)

To be filled in by `recon-step-1`. For each question, output the citation
(`file:line`), the answer in one sentence, and a "load-bearing" marker
if the answer is binding for the contract.

```text
Q1   — What is the data flow for tokens from the model's response to the
       next turn's request payload?
Q2   — Where does the SDK compute the post-compaction token total, and what
       inputs feed that computation?
Q3   — Where is the "actual" token total (the model-reported total) stored
       across turns, and how is it updated?
Q4   — Where does the SDK decide "trigger compaction at N% of context window"?
       Is N a fixed constant, a per-model constant, a per-session knob?
Q5   — Where does the SDK decide "stop, this turn would exceed context"?
       What error path runs if so?
Q6   — Are the SDK's token-counting utilities exact (use provider-reported
       totals) or estimated (use a local char/token heuristic)?
Q7   — What is the bookkeeping for summarization tokens consumed during
       compaction? Are they reflected in the post-compaction total or
       dropped?
Q8   — What happens when the post-compaction total still exceeds the model's
       context window? (forced re-compaction? abort? error?)
Q9   — Does the host's `overflowRecovery` flag mutate the compaction pipeline
       or just label the next turn?
Q10  — Is the per-model `contextWindow` value (used to compute thresholds)
       read from canonical model metadata or from a hard-coded map?
Q11 (load-bearing) — Is there any place where the SDK writes a token total
       to state (conversation history / turn state / cached projection)
       without first deriving it from the actual sent/received messages?
Q12 (load-bearing) — Where does the SDK read the cached total back, and
       does that read have a staleness check?
```

## §5 — Trust model

To be filled in by `recon-step-1`. Output:

```text
  Source-of-truth tokens     → (cite file:line)
  Derived / cached tokens    → (cite file:line, including staleness)
  Estimation-only tokens     → (cite file:line)
  Authority to threshold     → (cite file:line)
  Authority to abort         → (cite file:line)
  Authority to re-compact    → (cite file:line)
```

## §6 — Discriminator plan

To be filled in by `recon-step-1`. The recon shall produce:

  1. **R1 — Token-arithmetic round-trip test.** Given a synthetic
     conversation of N turns, assert that the SDK's pre-turn token total
     for turn N+1 equals the sum of:
       (sum of message tokens in the request payload for turn N+1)
       + (provider-reported tokens from turn N response, if exposed).
     If the SDK uses an estimate, the test should expose the delta
     between estimate and actual at every turn.

  2. **R2 — Compaction-threshold test.** Force a synthetic conversation
     to exceed the model's context window. Assert that the SDK either:
       (a) compacts and emits a post-compaction total below the threshold,
       (b) emits a "context window exceeded" error and aborts.
     It MUST NOT silently proceed with a post-compaction total that
     exceeds the threshold.

  3. **R3 — Summarization-token accounting test.** Force compaction on a
     synthetic conversation. Assert that summarization tokens are either
     (a) reflected in the post-compaction total, or (b) explicitly
     subtracted from the model's billed total and logged.
     They MUST NOT vanish.

  4. **R4 — `overflowRecovery` mutation test.** Set the flag on a synthetic
     turn, assert it does NOT silently bypass the compaction threshold
     or the context-window check.

  5. **R5 — Cache-staleness test (Q11/Q12).** Snapshot the SDK's
     cached token total, mutate the underlying message array (simulating
     a tool result arriving after the snapshot), assert the next-turn
     total reflects the post-mutation state.

## §7 — Classification (template — to be filled by `recon-step-1`)

```text
CASE_A — ACCOUNTING_TRUTH_PRESERVED / LIVE_SYMPTOM_EXPLAINED
  R1-R5 GREEN; the post-compaction total matches the actual total;
  no path lets the threshold be silently violated; `overflowRecovery`
  does NOT bypass; cache-staleness is bounded.

CASE_B — ACCOUNTING_DRIFT_CONFIRMED / STRUCTURAL_DEFECT
  R1-R5 RED with a clear causal pattern. The repair ACT is gated on
  the recon's root-cause isolation.

CASE_C — ACCOUNTING_INDETERMINATE / CAPTURE_INSUFFICIENT
  R* inconclusive because of test-environment limitations. The recon
  surfaces what LIVE evidence would discriminate and updates the
  epic file with the live-capture runbook.

CASE_D — HOST_REQUIRED
  Any claim that asserts a real-prompt / real-provider behavior MUST
  either be backed by a live run or carry the HOST_REQUIRED marker.
```

## §8 — Stop rule

  - **R1-R5 GREEN** → `CASE_A` → `CLOSED_NOT_REPRODUCED` (or
    `CLOSED_WITH_RESIDUE` if a non-load-bearing drift is observed but
    explained).
  - **R*-RED with structural defect** → `CASE_B` → recon reports
    `ROOT_CAUSE_ISOLATED` and a future repair ACT is named. This ACT
    closes without authorizing the repair (separate ACT, separate review).
  - **Live capture blocked** → `CASE_C` → `CAPTURE_INSUFFICIENT` and
    the epic detail file gains the LIVE-capture runbook.
  - **Real-prompt required** → `CASE_D` → `HOST_REQUIRED` and the
    recon names the exact LIVE environment needed.

## §9 — Operational action

1. Run the recon against the SDK source tree at HEAD `975d3315c` (post
   board-amendment).
2. Produce `.factory/evidence/ACT-CLINEMM-COMPACTION-TOKEN-ACCOUNTING-TRUTH-RECON01/`
   with: `entry-freeze.txt`, `compaction-arithmetic-map.md` (Q1–Q12),
   `trust-model.md`, R1–R5 discriminator test files (RED-then-GREEN
   progression, source-extraction tests), `classification.md`, `final-report.md`.
3. Update the epic detail file with first durable conclusions if CASE_A.
4. **DO NOT** open `ACT-CLINEMM-COMPACTION-TOKEN-ACCOUNTING-REPAIR01`
   from this ACT. Any repair is a separate ACT with its own scope,
   its own entry-freeze, and its own review.
5. **DO NOT** open `ACT-CLINEMM-MCP-AUTOAPPROVE-OFF-AUTHORITY-RECON01`
   in parallel — sequential after CASE_A, CASE_B, CASE_C, or CASE_D
   lands for this ACT.

## §10 — Acceptance criteria

  - Recon ACT body committed with `OPEN / RECON_ONLY` status.
  - Entry-freeze, Q1-Q12 recon, trust model, R1-R5 discriminator, final report.
  - `bun run check-types` clean on `sdk/packages/core`.
  - `bun x vitest run sdk/packages/core/src/extensions/context/compaction*.test.ts` green.
  - No production code change.
  - No PR; this ACT is recon-only and the closure path is the discriminator
    result, not a code merge.
