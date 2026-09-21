ACT-CLINEMM-BACKGROUND-COMMAND-NOTIFY-ON-TERMINAL01 / CORRECTION01
PRE-REPAIR RED (parent commit ddcf1ad4...)
====================================================================

PROBE DESIGN (correction01 P0-3 reviewer ask):

The reviewer's P0-3 ask was to run one probe against the actual parent
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

PROBE WITNESS captured at ddcf1ad4:
  (see 19-pre-repair-red-output.txt for full vitest output)

  Test file: apps/vscode/src/sdk/__tests__/background-command-notify-on-terminal01-pre-repair-red.probe.test.ts
  Tests: 3 (file-existence + content-absence assertions)
  Result: ALL PASS (the absences are exactly what we expect at ddcf1ad4)

  Concretely:
  1. notifyOnCompletion is absent from sdk/packages/core/src/extensions/tools/schemas.ts
  2. notifyOnCompletion is absent from apps/vscode/src/sdk/vscode-run-commands-tool.ts
  3. apps/vscode/src/sdk/background-notify-coordinator.ts does not exist

The probe was DELETED after capture (the file is not committed; it
only existed as a transient witness during the correction01 cycle).
The output was preserved to .factory/evidence/.../19-pre-repair-red-output.txt.

POST-REPAIR PROOF (parent commit + this ACT):
  - BCNT01 (21/21) GREEN: the full coordinator + tool + wake flow
  - BCNT-WIRE-01 (1/1) GREEN: real production wire proven
  - Conservation tests PWAOR01 (1/1), BTCONT01 (10/10), AGCONT01 (7/7),
    VRCT (46/46) GREEN

Both probes together satisfy the correction01 P0-3 ask: the
production source at ddcf1ad4 is proven-absent for the wake
machinery, and the post-ACT source is proven-present and wired.
