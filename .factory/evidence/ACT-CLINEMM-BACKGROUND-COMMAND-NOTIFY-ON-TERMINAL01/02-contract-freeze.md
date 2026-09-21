ACT-CLINEMM-BACKGROUND-COMMAND-NOTIFY-ON-TERMINAL01 — CONTRACT FREEZE POINTER
==========================================================================

This ACT treats the frozen product contract at
ACT-CLINEMM-BACKGROUND-COMMAND-WAIT-SEMANTICS01 as input.
No re-interpretation, no rebind, no review cycle.

Contract-freeze commit (load-bearing, immutable):
  769281892e43401bcf81f7e22765f24b60eb5932

Correction cycles (frozen text, not re-litigated here):
  cycle 01: §20-contract-correction-01.md (HALT_WAIT_SEMANTICS_CONTRACT_NOT_FROZEN)
  cycle 02: §21-contract-correction-02.md (HALT_WAIT_SEMANTICS_STALE_CONTRACT_AUTHORITY)
  cycle 03: §22-contract-correction-03.md (HALT_WAIT_SEMANTICS_CORRECTION02_STALE_EPOCH_AUTHORITY)

Frozen v1 contract (input to this ACT):

  v1 semantic:
    WAIT(v1) = NOTIFY
    STRICT_WAIT = OUT_OF_V1

  default: notifyOnCompletion = false

  notify=true:
    background command may finish after the current agent turn
    terminal completion queues exactly one bounded prompt
    back into the owning task/session

  notify=false:
    terminal completion never resurrects the agent

  notification lifetime:
    same sessionId + same taskId => KEEP
    different session/task       => DISCARD
    epoch is NOT part of notification lifetime

  notification authority:
    coordinator-owned marker/set
    NOT CommandJob-owned state

  terminal trigger:
    per-job command_job_terminal_committed
    NOT owner-level >0→0

  wake transport:
    PendingPromptsController.enqueue(...)
    bounded prompt string

  persistence:
    EPHEMERAL_ONLY

  containment_failed:
    NO automatic wake

Epistemic purpose of THIS ACT:
  Implementation + executable qualification of the frozen
  opt-in NOTIFY contract. Move from prose to executable
  evidence, NOT redesign wait semantics.
