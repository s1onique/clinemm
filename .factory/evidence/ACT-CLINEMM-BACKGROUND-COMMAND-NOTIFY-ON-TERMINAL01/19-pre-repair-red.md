ACT-CLINEMM-BACKGROUND-COMMAND-NOTIFY-ON-TERMINAL01 / CORRECTION03
PREDECESSOR STRUCTURAL ABSENCE (parent commit ddcf1ad4...)

NOTE (correction03): Per the Factory causal reviewer's preference
option B, this is reclassified as PREDECESSOR_ABSENCE (STRUCTURAL),
NOT a behavioral parent RED reproduction. The probe verifies that
the contract-machinery was not present at the contract-freeze
commit, which is the correct witness for a NEW-CONTRACT
implementation ACT (RED_REQUIRED = NO). It is not equivalent to
"old runtime gave 0 wakes for the new stimulus" (the old runtime
never had the stimulus path; it never had the machinery). The
absence probe's purpose is to demonstrate that the contract was
not silently retro-applied to the parent.
====================================================================

PROBE DESIGN (correction02 P0-4 reviewer ask):

The reviewer's P0-4 ask was to run one probe against the actual parent
commit (ddcf1ad4f076afbebbaf1686b73a3cb040ad0b4b) showing that the
notify-capable request / equivalent stimulus produced zero wakes.

The parent commit is the contract-freeze commit (769281892...) +
correction 03 residue cleanup. It does NOT contain:
  - the BackgroundNotifyCoordinator module
  - the notifyOnCompletion schema field
  - the notifyOnCompletion metadata thread-through in tool factory
  - the run_commands-tool wake consumer

So the pre-repair RED is not a wake-count assertion — it is an
ABSENCE-WITNESS: the machinery for the opt-in wake does not exist.



CORRECTION03: NO PROBE CHANGES
-------------------------------

The probe itself is unchanged. correction02 already rewrote it to
read via `git show <parent>:<path>` (no filesystem ENOENT) and got
3/3 PASS. correction03 only re-labels the witness under the
reviewer's option B framing:

  OLD label:  PRE_REPAIR_RED_BEHAVIORAL = NOT_EXECUTED
  NEW label:  PREDECESSOR_ABSENCE = STRUCTURAL
               RED_REQUIRED = NO (NEW_CONTRACT_IMPLEMENTATION)

The probe remains a load-bearing structural witness: the
notify-capable machinery was not silently present at the parent.
It does not claim behavioral parent-RED reproduction.

CORRECTION02 FIX TO THE CORRECTION01 PROBE
------------------------------------------

correction01 attempted this probe with the WRONG PATH
(`apps/vscode/src/vscode-run-commands-tool.ts` instead of the real
`apps/vscode/src/sdk/vscode-run-commands-tool.ts`) and got
"1 failed | 2 passed" because the wrong-path assertion hit ENOENT
(see the older 19-pre-repair-red-output.txt for that earlier
output). The markdown narrative at the time said "ALL PASS" which
contradicted the raw output — that was the reviewer's P0-1
rejection.

correction02 rewrites the probe to read the file contents via
`git show <parent>:<path>`. That cannot ENOENT (it asks git for the
blob, not the filesystem). All three absence assertions now PASS.

PROBE WITNESS captured at ddcf1ad4:
  (see 19-pre-repair-red-output.txt for full vitest output)

  Test file: apps/vscode/src/sdk/__tests__/background-command-notify-on-terminal01.bcnt01-pre-repair-red.probe.test.ts
  Tests: 3 (file-existence + content-absence assertions)
  Result: 3/3 PASS

  Concretely:
  1. ✓ notifyOnCompletion is absent from
     sdk/packages/core/src/extensions/tools/schemas.ts
  2. ✓ notifyOnCompletion is absent from
     apps/vscode/src/sdk/vscode-run-commands-tool.ts
  3. ✓ apps/vscode/src/sdk/background-notify-coordinator.ts does
     not exist

The probe file is included in the correction02 commit (it is the
documented absence witness). It is observation-only and has no
runtime effect on production.

POST-REPAIR PROOF (correction02 source):
  - BCNT01 (24/24) GREEN: the full coordinator + tool + wake flow
  - BCNT-WIRE-01 (1/1) GREEN: LocalRuntimeHost.runTurn +
    PendingPromptsController.enqueue transport seam
  - BCNT-WIRE-02 (2/2) GREEN: SdkController closure boundary +
    owner-mismatch silent drop (NEW in correction02)
  - BCNT-DEADLINE-03 (1/1) GREEN: real CommandJobManager deadline
    fires deadline_exceeded -> wake (NEW in correction02)
  - Conservation tests PWAOR01 (1/1), BTCONT01 (10/10),
    AGCONT01 (7/7), VRCT (46/46) GREEN

Both probes together satisfy the correction02 P0-4 ask: the
production source at ddcf1ad4 is proven-absent for the wake
machinery (3/3 GREEN), and the post-ACT source is proven-present
and wired (24/24 BCNT01 + 1/1 BCNT-WIRE-01 + 2/2 BCNT-WIRE-02 +
1/1 BCNT-DEADLINE-03).
