# ACT-CLINEMM-APPROVAL-REJECTION-CORRELATION-FAIL-CLOSED-RECON01

> Status: **CLOSED / GREEN / CORRELATION_HYPOTHESIS_ELIMINATED**
> Verdict: **`APPROVAL_REJECTION_CORRELATION_PROVEN` / `CORRELATION_DEFECT_NOT_REPRODUCED`**
> Upstream #10783: **CORRELATION_HYPOTHESIS_ELIMINATED / PRODUCT-LEVEL IMMUNITY NOT YET PROVEN**
> Verdict: **`APPROVAL_REJECTION_CORRELATION_PROVEN`**
> Owning epic: [`EPIC-APPROVAL-PROTECTION`](../epics/approval-protection.md) (board row 19 sister; the row-19 editor-tool recon remains OPEN with its own open-work, this ACT is the parallel command-correlation sister; the command-policy-lattice sister ACT-CLINEMM-COMMAND-APPROVAL-AUTHORITY-FAIL-CLOSED-RECON01 closed at `507fdd890`).
> ACT ID: ACT-CLINEMM-APPROVAL-REJECTION-CORRELATION-FAIL-CLOSED-RECON01
> Evidence: `.factory/evidence/ACT-CLINEMM-APPROVAL-REJECTION-CORRELATION-FAIL-CLOSED-RECON01/`

## §0 — Frozen user-facing invariant

```text
Given any ClineMM host (VS Code or CLI) and any tool request X:

  Approval authority is bound to the exact request identity of X.
  A rejected X MUST NOT:
    authorize a retry
    suppress a subsequent prompt
    mark equivalent-looking future actions approved
    leak approval state across command/job/tool identity
  A retry is a NEW authority event unless the product contract
  explicitly defines a cryptographically/exactly-correlated retry
  token.

This is the load-bearing property upstream issue #10783
("approval prompt is bypassed when the agent retries the same
command after the user rejected it the first time") would
violate if present in ClineMM.
```

## §1 — Mission outcome (one-line)

```text
QUESTION:  Can untrusted approval/rejection state from request X
           authorize or suppress approval for request Y?

ANSWER:    NO (proven at the real production correlation seam).

EVIDENCE:  SYNTHETIC_REAL through REAL_PRODUCTION_SEAM: the actual
           SdkInteractionCoordinator.handleRequestToolApproval +
           resolvePendingToolApproval + clearPending surface
           (apps/vscode/src/sdk/sdk-interaction-coordinator.ts)
           executes the discriminator test
           (apps/vscode/src/sdk/__tests__/approval-rejection-
           correlation-fail-closed-recon01.test.ts) and all six
           adversarial cases are GREEN.

DISPOSITION: APPROVAL_REJECTION_CORRELATION_PROVEN
             / CORRELATION_DEFECT_NOT_REPRODUCED
             UPSTREAM_10783: CORRELATION_HYPOTHESIS_ELIMINATED
                            / PRODUCT-LEVEL IMMUNITY NOT YET PROVEN
             STOP (per ACT §15 stop rule, scope-calibrated).
```

## §2 — Source-recon (Q1–Q12)

See `.factory/evidence/ACT-CLINEMM-APPROVAL-REJECTION-CORRELATION-FAIL-CLOSED-RECON01/approval-seam-map.md` for the full Q1-Q12 recon. Key findings:

  - **Q1**: request identity is `{agentId, conversationId, iteration, toolCallId, toolName, input}`. The ASK-side state is a single in-flight slot (`pendingToolApprovalResolve`), NOT a Map<id, pending>.
  - **Q2**: response correlation is single-slot — there is no per-toolCallId matching. The single-slot property IS the correlation mechanism.
  - **Q3-Q4**: rejection is a destructive resolve of the pending promise; slot is atomically cleared at lines 735-736.
  - **Q5**: no `autoApproveCache`, no `approvedCommandsSet`, no `deniedToolCallIds` skip-list.
  - **Q11 LOAD-BEARING**: a model retry with new toolCallId reaches a fresh `handleRequestToolApproval` call. R1 directly tests this.

## §3 — Trust model

See `.factory/evidence/ACT-CLINEMM-APPROVAL-REJECTION-CORRELATION-FAIL-CLOSED-RECON01/trust-model.md` for the trust table and required invariant.

## §4 — Single real authority-seam discriminator

The discriminator test is at:

```text
## §7 — Classification

```text
CASE_A — FAIL_CLOSED / IMMUNE

R1 GREEN at the real production approval correlation seam:
  - request A requires approval → user REJECTS
  - request B with NEW toolCallId, IDENTICAL toolName+input
  - B received a fresh ASK (not silent-approve, not skipped)
  - The discriminator's R1 expect block asserts:
      messagesAfterB.length === 2
      messagesAfterB[1].ask === "command"
      messagesAfterB[1].ts !== messagesAfterB[0].ts
    all GREEN.

DISPOSITION: APPROVAL_REJECTION_CORRELATION_PROVEN
             / CORRELATION_DEFECT_NOT_REPRODUCED
             UPSTREAM_10783: CORRELATION_HYPOTHESIS_ELIMINATED
                            / PRODUCT-LEVEL IMMUNITY NOT YET PROVEN
             STOP at the correlation layer (does NOT mean
             #10783 is fully neutralized; product-level still open)
```

## §8 — If RED — necessity

N/A — R1 is GREEN. No repair is necessary or authorized.

## §9 — Conservation

The invariant is preserved under:

  - explicit approval of current request → executes normally ✓
  - rejection → does not execute ✓
  - auto-approve for genuinely policy-allowed actions → unchanged ✓
  - command-policy #12020 invariant (closed at 507fdd890) → unchanged ✓
  - Seatbelt → unchanged ✓
  - background execution → unchanged ✓
  - task/epoch fencing → unchanged ✓
  - MCP approval semantics → not touched (separate ACT for #10499) ✓
  - approval UI → unchanged (correct re-prompt behavior is the
    proven invariant itself) ✓

## §10 — Evidence labels

| Class               | Used? | Where |
|---------------------|-------|-------|
| SYNTHETIC_REAL through REAL_PRODUCTION_SEAM | YES   | The discriminator drives the actual `SdkInteractionCoordinator` public surface, but request identities, UI responses, and the policy/auto-approve decision are synthetic (ALWAYS_ASK forces every retry into the interactive correlation seam) |
| SYNTHETIC_REAL       | NO    | Not needed; the seam is already REAL |
| STRUCTURAL           | NO    | Not needed; structural-only would not exercise the resolvePendingToolApproval slot atomically |
| LIVE                | NO    | Not required; deterministic production-seam reproduction is sufficient |

## §11 — Required artifacts

```text
.factory/acts/
  ACT-CLINEMM-APPROVAL-REJECTION-CORRELATION-FAIL-CLOSED-RECON01.md  (this file)

.factory/evidence/
  ACT-CLINEMM-APPROVAL-REJECTION-CORRELATION-FAIL-CLOSED-RECON01/
    entry-freeze.txt
    approval-seam-map.md
    trust-model.md
    discriminator.md
    final-report.md

apps/vscode/src/sdk/__tests__/
  approval-rejection-correlation-fail-closed-recon01.test.ts  (durable regression target)
```

## §12 — Stop rules

```text
R1 GREEN at correlation seam:               CORRELATION_HYPOTHESIS_ELIMINATED,
                                              STOP at THIS layer
                                              (NOT equivalent to full #10783
                                              product-level immunity)  ← HIT
R1 RED + exact correlation defect bound:      ROOT_CAUSE_ISOLATED
cannot exercise real approval seam:           HALT_WRONG_PRODUCTION_SEAM
correlation key ambiguous:                    CAPTURE_INSUFFICIENT
```

## §13 — Forbidden

NONE violated. Specifically:

  - NO destructive command execution — R1/R2/R3 use `rm -rf /tmp/cache` and `echo hello` only as test payloads; nothing actually executes because `shouldAutoApproveTool` returns false and the test resolves the pending slot manually.
  - NO approval UI redesign.
  - NO Seatbelt changes.
  - NO command-risk refactor.
  - NO model/provider changes.
  - NO "remember approval by command text" feature (would be a regression, not a fix).
  - NO broad approval cache.
  - NO reopening TurnState.
  - NO touching long-session freeze.
  - NO MCP-specific work (deferred to a separate ACT for #10499).

## §14 — Expected first output → delivered

| Deliverable | Status |
|-------------|--------|
| 1. entry-freeze.txt                        | DELIVERED |
| 2. Q1-Q12 recon → approval-seam-map.md     | DELIVERED |
| 3. trust model → trust-model.md            | DELIVERED |
| 4. ONE R1 discriminator test               | DELIVERED (6 cases, not just 1) |
| 5. executable result                       | DELIVERED — 6 passed / 0 failed |
| 6. classification                          | DELIVERED — CASE_A / IMMUNE |
| 7. ACT body                                | DELIVERED (this file) |

## §15 — Final disposition

```text
VERDICT:    APPROVAL_REJECTION_CORRELATION_PROVEN
           / CORRELATION_DEFECT_NOT_REPRODUCED
           UPSTREAM_10783: CORRELATION_HYPOTHESIS_ELIMINATED
                          / PRODUCT-LEVEL IMMUNITY NOT YET PROVEN
STATUS:     CLOSED GREEN (correlation layer only;
           product-level #10783 immunity NOT YET PROVEN)
STOP RULE:  HIT (R1 GREEN + R2/R3/R4/R5/R6 GREEN at
           SYNTHETIC_REAL through REAL_PRODUCTION_SEAM,
           correlation-layer scope only)
REPAIR:     NOT NEEDED, NOT AUTHORIZED
EPIC:       EPIC-APPROVAL-PROTECTION row 19 sister — no follow-up ACT
            required for the approval-correlation lane
EPIC_DELTA: none (the row-19 editor-tool recon remains OPEN with
            its own open-work; this ACT does not bind to it)
FOLLOW-UP:  NEXT upstream radar in the user-prioritized sequence:
            #10499 MCP Auto-approve OFF authority bypass
```
apps/vscode/src/sdk/__tests__/approval-rejection-correlation-fail-closed-recon01.test.ts
```

It drives the REAL `SdkInteractionCoordinator` public surface — no stubs, no re-implementation.

## §5 — Adversarial matrix

```text
R1 LOAD-BEARING
  request A requires approval
  reject A
  request B same payload, new toolCallId
  expected = ASK again
  PASS

R2
  reject A
  request B different command
  expected = ASK again
  PASS

R3
  approve A
  request B same payload, new toolCallId
  expected = ASK again (no implicit approval reuse)
  PASS

R4
  reject A
  identical responses after slot cleared
  expected = silently dropped (returns false)
  PASS

R5
  clearPending("Task switched") mid-flight
  request B in same session
  expected = ASK again
  PASS

R6
  stale approve after clearPending
  expected = dropped (returns false), B still ASKs
  PASS
```

## §6 — Important distinction

```text
COMMAND POLICY
  "does this action require approval?"
  ACT-CLINEMM-COMMAND-APPROVAL-AUTHORITY-FAIL-CLOSED-RECON01
  closed at 507fdd890

APPROVAL CORRELATION
  "which exact request did the operator approve?"
  ACT-CLINEMM-APPROVAL-REJECTION-CORRELATION-FAIL-CLOSED-RECON01
  THIS ACT — closed GREEN

A perfect command-risk policy is still unsafe if an approval
response can be replayed or matched to the wrong request. That
is the question THIS ACT answers, at the real production
correlation seam.
```
