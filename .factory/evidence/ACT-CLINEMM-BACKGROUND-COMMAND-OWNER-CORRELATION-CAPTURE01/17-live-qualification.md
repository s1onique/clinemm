LIVE QUALIFICATION (per ACT sec 36)
====================================

LIVE QUALIFICATION DID NOT OCCUR IN THIS ACT.

Per ACT sec 36, after a successful repair (per ACT sec
31, 32, or 33) the operator MUST rebuild + install +
LIVE re-run a fresh VSIX from the repair HEAD. The
required outcome:

  matching managed job == RUNNING
  owner correlation == valid
  guard == true
  AND
  no:
    session-event-turn-complete-resumable-straggler-preserve
    streaming -> awaiting_followup
  while that matching job remains RUNNING

This ACT does NOT perform a repair (per ACT sec 30 and
file 14). Therefore the LIVE QUALIFICATION AFTER REPAIR
step is NOT executed in this ACT.

LIVE QUALIFICATION BEFORE REPAIR (this ACT's scope)
====================================================

Per ACT sec 25-26, the LIVE QUALIFICATION BEFORE REPAIR
requires the operator to:

  1. Install this ACT's diagnostic build into a real
     dogfood ClineMM instance.
  2. Reproduce the Working -> Your turn failure with a
     managed background command (e.g. `sh -c 'echo
     STARTED; sleep 600; echo FINISHED'`).
  3. Cmd+Shift+P -> Cline Debug: Dump Background Owner
     Correlation.
  4. Cmd+Shift+P -> Cline: Dump Turn State Writer
     Provenance Diagnostic.
  5. Preserve both .jsonl files + a screenshot showing
     jobId / Backgrounded / Cancel / Your turn.

This step is the operator's job. This ACT lands the
diagnostic build; the operator drives the LIVE run.

WHY THIS ACT DOES NOT INCLUDE THE LIVE RUN
==========================================

This Cloud Agent environment does not have:
  - a real VS Code host instance (DISPLAY=:1 is
    configured but the debug harness is forbidden for
    LIVE qualification per prior halted ACTs in this
    lineage)
  - the operator's UI (the operator-driven reproduction
    is the only path that satisfies ACT sec 25)
  - a CLI to exercise ClineMM autonomously without the
    UI shell

Therefore the LIVE QUALIFICATION is the operator's
responsibility after this ACT lands.

NEXT-ACT PROVISION
==================

The next ACT in this lineage
(ACT-CLINEMM-BACKGROUND-COMMAND-OWNER-CORRELATION-
REPAIR01 or successor) will:

  1. Operate on the LIVE BOCOR + TSWPD dumps + screenshot
     produced by the operator.
  2. Mechanically classify the LIVE occurrence per ACT
     sec 27.
  3. Apply the bounded repair per ACT sec 31, 32, or 33.
  4. Execute the LIVE QUALIFICATION AFTER REPAIR (this
     file's contract) on a fresh VSIX built from the
     repair HEAD.

The lifecycle is:

  ACT-CLINEMM-BACKGROUND-COMMAND-AWAITING-FOLLOWUP-GUARD01 (e77679a25)
    - G2 proven, H2a vs H2b unproven
    - verdict CAPTURE_INSUFFICIENT
    - next-act: build the BOCOR diagnostic  <- THIS ACT
        ACT-CLINEMM-BACKGROUND-COMMAND-OWNER-CORRELATION-CAPTURE01
        - diagnostic build landed; capture machinery
          complete; LIVE qualification pending operator
        - verdict CAPTURE_INSUFFICIENT
        - next-act: operator runs LIVE; bounded repair ACT
            ACT-CLINEMM-BACKGROUND-COMMAND-OWNER-CORRELATION-REPAIR01 (planned)
            - LIVE causal tuple captured (OC1 / OC2 / OC3)
            - bounded repair applied
            - LIVE qualification after repair
            - diagnostic removal (per ACT sec 37)
            - verdict PASS_CASE_<X>_REPAIRED

STOP RULE (per ACT sec 42)
==========================

This ACT observes the STOP rule. It adds the diagnostic
machinery, runs the BUILD BEFORE LIVE gates, halts at
CAPTURE_INSUFFICIENT (a legitimate terminal verdict per
ACT sec 40), and does NOT:

  - touch PATH behavior
  - change submit_and_exit
  - change TaskHeader semantics
  - bind Working to activeCommandJobs
  - redesign CommandJobManager
  - change PGID / helper containment
  - mutate terminal rows
  - ban shell backgrounding
  - introduce another diagnostic framework
  - leave temporary diagnostics behind accidentally

The diagnostic is BOUNDED with a REMOVAL TRIGGER (per
ACT sec 37): first successful LIVE binding of the LIVE
cause AND qualification of the bounded repair, OR
CAPTURE_INSUFFICIENT, OR better evidence supersedes it.
