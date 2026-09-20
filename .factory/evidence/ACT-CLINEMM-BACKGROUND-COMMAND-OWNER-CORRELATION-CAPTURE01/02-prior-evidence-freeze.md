# Prior Evidence Freeze (no re-litigation)

Per ACT sec 2, this ACT FREEZES the prior evidence without
re-deriving it. The frozen values below were established by
ACT-CLINEMM-BACKGROUND-COMMAND-AWAITING-FOLLOWUP-GUARD01
(commit e77679a25) and its predecessors.

## Frozen facts

```text
Q5_GUARD_PRESENT             = TRUE
LIVE_WRITER                  = session-event-turn-complete-resumable-straggler-preserve
LIVE_PHASE_TRANSITION        = streaming -> awaiting_followup
LIVE_MANAGED_JOB             = RUNNING
TURN_HEADER_PROJECTION       = CONSERVED
```

## Frozen discriminator (BCAFG01 §8)

```text
matching owner
  -> lookup true
  -> awaiting_followup suppressed

missing/mismatched owner
  -> lookup false
  -> awaiting_followup committed

guard=true
  -> writer suppressed

guard=false
  -> writer commits
```

But the LIVE owner identity remained UNPROVEN at static recon
(no runtime telemetry was available without building a second
diagnostic framework, which BCAFG01 sec 9 explicitly forbade).

Therefore at the entry state of this ACT:

```text
PREVIOUS_VERDICT = CAPTURE_INSUFFICIENT
```

## What this ACT adds (per ACT sec 3-5, NOT re-litigation)

This ACT does NOT re-derive the discriminator above. It ADDS:

1. A bounded diagnostic capture at the Q5 decision boundary
   (`SdkSessionEventCoordinator.handleSessionEvent` else-branch)
   that observes the LIVE ownership tuple WITHOUT modifying
   the existing if/else control flow.
2. A dogfood-only enablement gate (no new env var; no workspace
   toggle) so public installs never emit and dogfood captures
   by default.
3. A host-side dump command (no toggle, no enable) so an
   operator can serialize the captured ring to JSONL under
   `context.globalStorageUri` after reproducing the failure.

The discriminator (G2 proven, H2a vs H2b unproven, G1/G3/G4/G5
REFUTED) is FROZEN and NOT re-litigated here.
