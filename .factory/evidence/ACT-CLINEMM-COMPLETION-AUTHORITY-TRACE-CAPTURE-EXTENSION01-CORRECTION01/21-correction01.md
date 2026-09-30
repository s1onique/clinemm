# ACT-CLINEMM-COMPLETION-AUTHORITY-TRACE-CAPTURE-EXTENSION01-CORRECTION01 — Ablation Evidence

This file documents the §17 ablation RED→GREEN observation made while
re-verifying the corrected HEAD in this session.

## Observation
The previous CORRECTION01 file's TCE-P04.GREEN #1 asserted:
1. exactly one `command_job_terminal_committed` lifecycle event per jobId;
2. exactly one `terminal_committed` CCARD stage record per jobId;
3. full sequence sanity (`process_started`, `terminal_committed`).

It did NOT bind the ownerId-against-production-seam invariant: the
ownerId assertion lived in TCE-P04.GREEN #2, which wrote directly to the
capture ring (via `captureContinuationCardinalityAuthorityRecord`) rather
than driving the production seam (`CommandJobManager.finalize`). Removing
`ownerId: job.ownerSessionId` from `command-job-manager.ts:2672`
therefore passed all 39 tests — i.e. the §17 ablation would have falsely
shown PASS with the previous code.

## Strengthened test
This session strengthened TCE-P04.GREEN #1 to additionally assert:
- `(c1Records[0] as { ownerId?: string }).ownerId === "OWNER-P04-LAUNCH"`
  (the value passed into `manager.start` at line 501)
- `"terminalKind" in (c1Records[0])` is `false` (v1 schema)

Now the production-seam test does bind both the §7 ownerId and the
§7 no-terminalKind invariants to the production code path. The §17
ablation now works as the spec requires.

## Ablation evidence

```text
with `ownerId: job.ownerSessionId` present:
  TCE-P04.GREEN #1  PASS
  TCE-P04 full file  39/39 PASS

with `ownerId: job.ownerSessionId` removed from command-job-manager.ts:2672:
  TCE-P04.GREEN #1  FAIL  (expected ownerId === "OWNER-P04-LAUNCH", got undefined)
  TCE-P04 full file  1 failed | 38 passed (39)

restored:
  TCE-P04 full file  39/39 PASS
```

`CORRECTION01_ABLATION=PASS`.

The terminalKind assertion also flips RED if a `terminalKind` field is
added to the capture call (it would be present in the record and
`"terminalKind" in record` would return true).