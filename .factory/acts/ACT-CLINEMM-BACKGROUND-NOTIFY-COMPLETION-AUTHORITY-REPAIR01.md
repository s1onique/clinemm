# ACT-CLINEMM-BACKGROUND-NOTIFY-COMPLETION-AUTHORITY-REPAIR01

PRIMARY PURPOSE: causality / repair

## Mission

Repair the proven double-terminal-completion lifecycle for background
commands launched with:

  notifyOnCompletion = true

The authoritative persisted session demonstrates:

  original explicit_user turn
    -> run_commands(notifyOnCompletion=true)
    -> result status="running", jobId=J
    -> command_status(J, waitMs=30000)
    -> observes state="exited"
    -> submit_and_exit #1

  terminal notification subsystem
    -> terminal_committed(J)
    -> wake_created(J)
    -> pending_prompt_drain turn
    -> submit_and_exit #2

Therefore the defect is NOT:

  duplicate wake
  duplicate terminal commit
  duplicate queue drain
  renderer-only duplication

It is:

  TWO SEMANTIC TERMINAL COMPLETION AUTHORITIES
  FOR ONE notifyOnCompletion BACKGROUND JOB.

The repair must establish exactly one terminal-completion authority.

## Status

Phase: GREEN_AND_ABLATION
Verdict: PASS (seam-level + conservation; live qualification deferred to operator)
Predecessor: ACT-CLINEMM-LIVE-PRESENTATION-SURFACE-DISCRIMINATOR01 (PASS_PRESENTATION_SURFACES_CLASSIFIED_C10_DUPLICATION)
Predecessor's load-bearing evidence: 01a-clineMessages.LIVE_RAW.json (SHA-256 fe1b6bc7...4ae36)

## Evidence

Frozen authoritative transcript (bytes-identical to operator-supplied dump):

  sessionId = 1790335441241_5g7oe
  taskId    = 1790335441241_5g7oe
  jobId     = cmd_mugvhy92x7rm527e
  source    = vscode
  provider  = minimax
  model     = MiniMax-M3

submit_and_exit count for jobId `cmd_mugvhy92x7rm527e`: **2** (proven)

## Repair

H1 (selected): `command_status(J, waitMs>0)` for notify-owned active J
returns state=running with `notification: "pending"` and SUPPRESSES
Path B resolveObligation. The wake-driven turn is the sole
terminal-completion authority.

Implementation seam: `apps/vscode/src/sdk/command-status-tool.ts`

Conservation matrix (R1..R15 per ACT §14): all SATISFIED.

## Test outcomes

  BNCA-RED-01       (RED):    2 tests pass
  BNCA-GREEN-01     (GREEN):  3 tests pass
  BNCA-ABLATION-01  (proof):  2 tests pass
  TQCB01            (gate):  15 tests pass
  BCNEX01           (gate):   7 tests pass
  BCCOC01           (gate):   7 tests pass
  BCTPA01           (gate):   6 tests pass
  CCARD01           (gate):  12 tests pass
  TOTAL                       54 tests pass

TypeScript: clean (`tsc --noEmit -p tsconfig.json` exit 0)
git diff --check: clean

## Halts (all NOT_TRIGGERED)

HALT_REPOSITORY_TRUST, HALT_RED_NOT_REPRODUCED, CAPTURE_INSUFFICIENT,
HALT_AUTHORITY_BOUNDARY_UNOBSERVABLE, HALT_NOTIFICATION_LOST,
HALT_MULTI_JOB_AUTHORITY_CROSSTALK, HALT_NON_NOTIFY_STATUS_REGRESSION,
HALT_OOM_REGRESSION, HALT_CORRELATION_REGRESSION,
HALT_PUBLIC_PROTOCOL_EXPANSION_REQUIRED, HALT_REPAIR_NOT_SUFFICIENT

## What was NOT done (deferred)

- §19 dogfood VSIX build (operator-driven; no UI harness invocation in this session)
- §20 LIVE-A..D live qualification (operator-driven; seam-level proof captured in BNCA-GREEN-01)
- §17 C10 ablation (whether the C10 completion-result filter is still necessary) — the
  H1 repair does not touch the C10 filter; the existing presentation-suppression
  remains in place as a conservation measure. C10 ablation is a downstream ACT.

## Forward direction

Once operator-driven dogfood + LIVE-A..D pass:

  ACT-CLINEMM-BACKGROUND-NOTIFY-COMPLETION-AUTHORITY-REPAIR01
  PASS_BACKGROUND_NOTIFY_COMPLETION_AUTHORITY_LIVE_QUALIFIED

The §17 C10 ablation is then in scope as a separate bounded ACT.

## Files

  .factory/evidence/ACT-CLINEMM-BACKGROUND-NOTIFY-COMPLETION-AUTHORITY-REPAIR01/
    01-authoritative-live-transcript.md
    01a-clineMessages.LIVE_RAW.json
    02-recon.md
    03-red-reproduction.txt
    04-authority-discriminator.md
    05-bnca-test-suite.txt
    05-repair-ablation.txt
    07-artifact-identity.txt
    08-live-qualification.md
    result.json

  apps/vscode/src/sdk/command-status-tool.ts                  (REPAIR)
  apps/vscode/src/sdk/__tests__/background-notify-completion-authority-fire-and-forget-red01.bnca-red01.test.ts
  apps/vscode/src/sdk/__tests__/background-notify-completion-authority-h1-green01.bnca-green01.test.ts
  apps/vscode/src/sdk/__tests__/background-notify-completion-authority-ablation01.bnca-ablation01.test.ts
