# ACT-CLINEMM-OBS05-RUNTIME-DURATION-ACCOUNTING-01 — 10 Exit Report

## Verdict

**PASS_STRUCTURAL_ONLY**

Implementation and executable gates passed. Installed live qualification (W7/W8) was NOT
executed — the operator directed that the VSIX be not built and the run stopped after the
code and executable-evidence work.

OBS-05 therefore remains **pending live qualification**.

## Why PASS_STRUCTURAL_ONLY and not PASS_LIVE

The ACT's `PASS_LIVE` exit requires an exact-head artifact identity AND installed-runtime
qualification with native task-header observation. Neither was performed: the artifact was
deliberately not built, and the live L1..L8 observations (human gate timing, webview
recreation under load, terminal stability, extension-host recovery) were therefore not
taken.

Everything else the ACT requires is complete and executable:

* the authoritative accounting is implemented on the real runtime lifecycle owner;
* the conservation identity is exact and asserted after every observation in the matrix;
* the human-wait classification is correct and derived from the authoritative phase;
* no lifecycle semantic regression was introduced (the per-test regression diff against the
  entry HEAD is EMPTY in both directions);
* persistence and the supported recovery path are qualified;
* the executable gates pass.

## Reopen condition

Reopen OBS-05 to reach `PASS_LIVE` when an operator can:

1. build the exact-head dogfood VSIX via the canonical mechanism
   (`python3 scripts/build-dogfood-vsix.py --install`) at a clean tree;
2. install it into the existing ClineMM dogfood profile;
3. execute a controlled task that reaches a real human gate, leaves it pending for ~30 s,
   recreates the webview, answers, completes, and observes the completed task again;
4. record the L1..L8 observations against the header's native rendering.

The executable witnesses already pin every property the live run must confirm, so the live
run is a confirmation, not a discovery.

## Residual risk

The one behaviour a live run could still expose that the deterministic witnesses cannot is
the interaction between the accounting and a REAL human gate — specifically whether the
runtime's actual `awaiting_followup` / `awaiting_approval` writes bracket the human wait
exactly as the synthetic chronology assumes. The phase-driven classification makes this
structurally sound, but only a live run can confirm the real writes land where the
authority says they do.

## Known limitations

* `RECOVERY_INTERVENTION` and `OTHER_HUMAN_GATE` are reserved in the waiting-reason union
  but only `RECOVERY_INTERVENTION` is produced (by the `error` phase). The others are not
  speculatively implemented.
* The compact proportional bar described as OPTIONAL in the ACT was NOT implemented. The
  elapsed/active/waiting/unknown values and the waiting reason ARE implemented and
  distinguishable.
* The accounting is a single visible-task window (matching the tracker's existing
  contract for every other counter on it). Returning to a PREVIOUSLY-VISIBLE task id
  starts its accounting fresh rather than restoring that task's historical totals — the
  persisted record covers the SUPPORTED RECOVERY path (resume / re-activation of the same
  task), not arbitrary task switching.
* Historical session durations remain unqualified. No transcript-based estimation was
  implemented; a legacy task simply reports "unavailable".
