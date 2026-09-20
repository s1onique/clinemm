LIVE Screenshot Index
=====================

LIVE QUALIFICATION DID NOT OCCUR IN THIS EVIDENCE
--------------------------------------------------

Per ACT sec 25-26, the LIVE qualification requires the
operator to:

  1. Install this ACT's diagnostic build into a real
     dogfood ClineMM instance.
  2. Reproduce the failure (Working -> Your turn with a
     managed background command).
  3. Run the two dump commands.
  4. Preserve both .jsonl files.
  5. Preserve the screenshot showing jobId / Backgrounded /
     Cancel / Your turn.

This ACT does NOT have access to:
  - a real VS Code host instance
  - the operator's UI
  - the operator-driven reproduction capability

Therefore no LIVE screenshot exists at this evidence.

REQUIRED SCREENSHOT INDEX (when LIVE is run)
--------------------------------------------

The operator MUST capture a screenshot showing the exact
fields required for OC1 / OC2 / OC3 mechanical classification
(per ACT sec 27):

  - jobId (e.g. cmd_mu9mh0uahxjkxbo3 in the BCAFG01 LIVE
    specimen)
  - Backgrounded (the run_commands backgrounded card)
  - Cancel (the operator-observable cancel button on the
    card)
  - Your turn (the Working -> Your turn header transition)

The screenshot path is NOT asserted in this evidence. The
operator MUST add it to this file when LIVE is performed.

CLARIFICATION FOR THE FACTORY REVIEWER
--------------------------------------

This ACT is structurally a BOUNDED DIAGNOSTIC LANDING ACT:
its purpose is to ADD the capture machinery, NOT to diagnose a
fresh LIVE failure. The previous LIVE specimen (BCAFG01 at
taskId 1789897019328_sn0k5, epoch 16) was already captured
by the prior ACT and its evidence files are at
.factory/evidence/ACT-CLINEMM-BACKGROUND-COMMAND-AWAITING-FOLLOWUP-GUARD01/.

If the operator installs this ACT's diagnostic build BEFORE
the next recurrence, the next recurrence will produce a BOCOR
record (file 09) + a TSWPD record (file 10) + a screenshot
(file 11) that can be classified mechanically per ACT sec 27.

This ACT stops after the BUILD BEFORE LIVE gates pass; the
LIVE qualification is the operator's next step.
