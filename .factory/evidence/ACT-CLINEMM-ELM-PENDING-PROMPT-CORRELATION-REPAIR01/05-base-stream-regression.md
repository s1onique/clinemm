# 05 — Base-stream regression

The base vitest stream (`vitest.config.ts`) was run twice: once WITH the production
change, once with the two production files (`sdk-session-lifecycle.ts`,
`SdkController.ts`) stashed so the baseline reflects the PRE-repair production source.

```
cd apps/vscode
bunx vitest run --config vitest.config.ts
```

## 05.1 Result

| | failing files | failing tests | passing tests |
| --- | --- | --- | --- |
| baseline (production change stashed) | 63 | 168 | 5813 |
| with the production change | 63 | 168 | 5813 |

## 05.2 Per-file failure sets

The set of failing test FILES is byte-identical between the two runs:

```
$ comm -13 with-change.txt baseline.txt   # only in baseline
(none)
$ comm -23 with-change.txt baseline.txt   # only with the change
(none)
```

**Zero new regressions in the base stream.**

## 05.3 The pre-existing failures are NOT ACT-owned

The 63 failing files / 168 failing tests in the base stream are the repository's
PRE-EXISTING baseline at `159d92dcb`. They are unrelated to this ACT's two changed
production files: the same 63 files fail with and without the change.

This ACT's scope is the Elm pending-prompt correlation seam. It did not attempt to
repair, reclassify or suppress any of those pre-existing failures; doing so would
have widened the ACT beyond its mandate and risked masking real defects.

## 05.4 Note on unrelated generated artifacts

One pre-existing base-stream test regenerates
`.factory/evidence/act-seatbelt-yolo-approval-friction-recon01/inventory.summary.md`
with a fresh `Generated:` timestamp. That file is not ACT-owned; the timestamp-only
delta was reverted with `git checkout --` so it does not appear in this ACT's diff.
