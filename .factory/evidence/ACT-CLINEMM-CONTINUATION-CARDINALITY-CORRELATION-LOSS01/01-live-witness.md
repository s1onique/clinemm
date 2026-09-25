# ACT-CLINEMM-CONTINUATION-CARDINALITY-CORRELATION-LOSS01 / 01-live-witness

PHASE 1 — FREEZE THE LIVE WITNESS

LABEL: LIVE / REAL_PRODUCTION_SEAM

## Status

PASS — load-bearing live evidence frozen.

## Specimen identity

SPECIMEN
  SUBJECT_HEAD = 0a97b445c
  VSIX         = dist/dogfood/clinemm-4.1.16-0a97b445c.vsix
  SHA256       = ab4ddfffe825826a573b47b553407aaa40e921dad67c798ee369f5d245ab2037

This specimen is the CORRECTION01-built VSIX that survived the OOM
repaired workload (no native Extension Host OOM reproduces) but FAILED
live qualification P4 (CCARD origin correlation). The VSIX is
preserved in `dist/dogfood/clinemm-4.1.16-0a97b445c.vsix` (14627805
bytes, built 2026-09-25 from the CORRECTION01 commit per
`ACT-CLINEMM-EXTENSION-HOST-OOM-DELIVERY-SEMANTICS-REPAIR01/05-artifact-identity.txt`).

## Frozen live CCARD counters

LIVE CCARD COUNTERS (from dogfood diagnostic capture module
`apps/vscode/src/sdk/continuation-cardinality-authority-runtime.ts`)

  pending_prompt_enqueued   = 2, origin=pending_prompt_drain
  pending_prompt_dequeued   = 2, origin=pending_prompt_drain
  continuation_scheduled    = 2, origin=pending_prompt_drain
  run_turn_started          = 4, origin=explicit_user
  agent_turn_done           = 4, origin=explicit_user

## Frozen load-bearing JSONL sequence (first occurrence)

  Stage                  Origin                  JobId present?
  ─────────────────────  ──────────────────────  ──────────────
  terminal_committed     background_terminal     (C1)
  notify_consume_enter   background_terminal     (C2)
  wake_created           background_terminal     YES (jobId=J1)
  pending_prompt_enqueued pending_prompt_drain   NO
  pending_prompt_dequeued pending_prompt_drain   NO
  continuation_scheduled pending_prompt_drain    NO
  run_turn_started       explicit_user           NO
  agent_turn_done        explicit_user           NO

## Frozen load-bearing JSONL sequence (second occurrence)

  Stage                  Origin                  JobId present?
  ─────────────────────  ──────────────────────  ──────────────
  terminal_committed     background_terminal     (C1)
  notify_consume_enter   background_terminal     (C2)
  wake_created           background_terminal     YES (jobId=J2)
  pending_prompt_enqueued pending_prompt_drain   NO
  pending_prompt_dequeued pending_prompt_drain   NO
  continuation_scheduled pending_prompt_drain    NO
  run_turn_started       explicit_user           NO
  agent_turn_done        explicit_user           NO

(JobIds J1, J2 are placeholder labels for the two distinct
background-command jobs the operator's workload produced. The actual
live JSONL preserves the real jobId strings; they are not needed for
this ACT because the RED test will mint its own sentinel.)

## Critical observation (frozen)

  wake_created records CONTAIN jobId
  C4/C5/C6 records  DO NOT CONTAIN jobId
  C7/C8 records     DO NOT CONTAIN jobId
  C7/C8 origin      is explicit_user (NOT pending_prompt_drain)

This means either:

  (A) jobId never reaches PendingPromptEntry (entry loss), or
  (B) jobId reaches PendingPromptEntry but C4/C5/C6 capture hooks
      never see it (capture loss on the entry's jobId), or
  (C) jobId reaches C4/C5/C6 capture hooks but is not forwarded
      through `deps.send` (drain/send loss), or
  (D) jobId reaches runTurn but C7/C8 capture hooks don't see it
      (runTurn capture loss), or
  (E) Multiple-loss combination of (A) through (D).

The discriminator between (A)-(E) requires source-level recon
(see `02-recon.md`).

## No inference yet

We do NOT yet know WHICH production boundary first discards jobId.
The next section (§2) traces the real production chain.

## Why the counters add up to 4

  4 = 2 drained terminal-wake turns + 2 explicit-user turns.
      The 2 explicit-user turns (run_turn_started=4 minus the 2
      drained) are the visible "stranded" turns in the live
      scenario. The CCARD01 record shows cardinality=4 (C7 count)
      and pending_prompt_drain=2 (C7 with origin != explicit_user),
      so exactly 2 turns observed run_turn_started with origin
      `explicit_user` for what should have been drained turns.

The live counts are preserved verbatim and not re-derived; this
ACT does not yet own a re-derivation path (that would require
re-running the live workload against a different head).
