# LIVE Screenshot Index

The LIVE screenshot is captured by the operator at the Q5
boundary per ACT sec 28. The screenshot preserves:

```text
jobId = cmd_mu9qjxmwxl5hasi8
card  = Backgrounded
Cancel = visible
status = running
header state = awaiting_followup (post-transition; 1 ms after BOCOR capture)
```

The operator-driven screenshot is preserved at:

  .factory/evidence/ACT-CLINEMM-BACKGROUND-COMMAND-LIVENESS-AUTHORITY-SPLIT01/live-screenshot.png

(actual image file is recorded by the operator during the LIVE
procedure; this file is the index).

For the PRIOR LIVE occurrence (the specimen this ACT is built on),
the operator's screenshot is preserved at the original capture
location (see the existing ACT lineage for path conventions). The
canonical specimen fields are:

  jobId = cmd_mu9qjxmwxl5hasi8
  taskId = 1789903873206_g5qvj
  status = running
  card = Backgrounded
  Cancel = visible

Per ACT sec 28: "Do **not** click Cancel until all three dumps are
captured." The next ACT's procedure captures:

  1. Cline Debug: Dump Background Job Liveness Authority
     → .factory/evidence/.../10-live-bjla.jsonl

  2. Cline Debug: Dump Background Owner Correlation
     → .factory/evidence/.../11-live-bocor.jsonl

  3. Cline: Dump Turn State Writer Provenance Diagnostic
     → .factory/evidence/.../12-live-tswpd.jsonl

Then a UI screenshot is taken to preserve the card / Cancel /
status / header state.

After all three dumps + screenshot, the operator MAY click Cancel
as a discriminator (LA2 / LA5 hypothesis: Cancel returns
unknown_job if the start manager and the guard manager are split).
