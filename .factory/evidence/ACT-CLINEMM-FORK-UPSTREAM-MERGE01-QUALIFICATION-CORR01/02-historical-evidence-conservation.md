# ACT-CLINEMM-FORK-UPSTREAM-MERGE01-QUALIFICATION-CORR01 — C1 Historical Evidence Conservation

## 1. Finding

The U02 merge commit `167f5ca8d` (and its follow-up `3fc91ddda`) MODIFIED TWO
historical evidence artifacts that belong to EARLIER, unrelated ACTs. Both
modifications were unintended regeneration side-effects, not authored
content:

| Artifact | Modification |
|---|---|
| `.factory/evidence/ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-HISTORICAL-REPLAY01/test-replay-summary.json` | the recorded `kernel.path` was re-anchored from the original checkout path to the temporary integration worktree path |
| `.factory/evidence/act-seatbelt-yolo-approval-friction-recon01/inventory.summary.md` | the `Generated:` timestamp was bumped from `2026-09-21T21:19:09.585Z` to `2026-11-02T15:24:33.032Z` |

The exact diffs observed at `265044bf3..HEAD` (before this ACT's repair):

```diff
--- a/.factory/evidence/ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-HISTORICAL-REPLAY01/test-replay-summary.json
+++ b/.factory/evidence/ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-HISTORICAL-REPLAY01/test-replay-summary.json
-    "path": "/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/apps/vscode/elm/completion-authority/vendor/completion-authority.js",
+    "path": "/private/tmp/cline-int-worktree/apps/vscode/elm/completion-authority/vendor/completion-authority.js",
```

```diff
--- a/.factory/evidence/act-seatbelt-yolo-approval-friction-recon01/inventory.summary.md
+++ b/.factory/evidence/act-seatbelt-yolo-approval-friction-recon01/inventory.summary.md
-Generated: 2026-09-21T21:19:09.585Z
+Generated: 2026-11-02T15:24:33.032Z
```

Both are **provenance-damaging**: the first destroys the recorded absolute
identity of the artifact the replay was performed against, and the second
falsifies the generation time of a historical inventory. Neither change adds
information — both are noise produced by re-running an artifact generator in
a different working directory.

## 2. Repair

Both files were restored byte-for-byte from the baseline `265044bf3`:

```
git checkout 265044bf3 -- \
  .factory/evidence/ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-HISTORICAL-REPLAY01/test-replay-summary.json \
  .factory/evidence/act-seatbelt-yolo-approval-friction-recon01/inventory.summary.md
```

## 3. Byte-for-byte verification against baseline `265044bf3`

| File | Baseline SHA-256 | Restored SHA-256 | Bytes (baseline / restored) | Verdict |
|---|---|---|---|---|
| `.factory/evidence/ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-HISTORICAL-REPLAY01/test-replay-summary.json` | `818ae980171ee4fa899adad094c42b2927b1ca46e508d40c320eca26fefe6410` | `818ae980171ee4fa899adad094c42b2927b1ca46e508d40c320eca26fefe6410` | 4735 / 4735 | **BYTE-IDENTICAL** |
| `.factory/evidence/act-seatbelt-yolo-approval-friction-recon01/inventory.summary.md` | `be41bc034ef03c316757372ed80ad01dee6edec410a77ec023e764d1c11ebe58` | `be41bc034ef03c316757372ed80ad01dee6edec410a77ec023e764d1c11ebe58` | 2344 / 2344 | **BYTE-IDENTICAL** |

The `sha256` field INSIDE
`test-replay-summary.json` (`15c61e20468c36ac7bc3caed840c1012f5c5accbb0bcb96e0c748a00ad8d4f4c`,
the Elm kernel's own digest) is the baseline's own value and is therefore
now consistent again with the recorded `kernel.path`.

## 4. Immutability of the historical artifacts — scope confirmation

After the repair, the ONLY difference between the baseline `265044bf3` and
`HEAD` under `.factory/evidence/` is the U02 ACT's own new directory:

```
$ git diff --name-status 265044bf3 HEAD -- .factory/evidence/
M  .factory/evidence/ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-HISTORICAL-REPLAY01/test-replay-summary.json
A  .factory/evidence/ACT-CLINEMM-FORK-UPSTREAM-MERGE01/README.md
A  .factory/evidence/ACT-CLINEMM-FORK-UPSTREAM-MERGE01/command-receipts.md
A  .factory/evidence/ACT-CLINEMM-FORK-UPSTREAM-MERGE01/ledger.json
M  .factory/evidence/act-seatbelt-yolo-approval-friction-recon01/inventory.summary.md
```

(the two `M` rows are the state BEFORE this ACT's repair; the repair reverts
them, so the post-ACT state under `.factory/evidence/` is exactly
`265044bf3` + the U02 directory + this ACT's own directory.)

**No other historical artifact was touched.** No earlier ACT's evidence
directory was modified, moved, renamed or deleted.

## 5. New findings placement

Every new finding, receipt and checksum produced by this ACT lives
EXCLUSIVELY in:

```
.factory/evidence/ACT-CLINEMM-FORK-UPSTREAM-MERGE01-QUALIFICATION-CORR01/
```

The U02 directory
(`.factory/evidence/ACT-CLINEMM-FORK-UPSTREAM-MERGE01/`) is **NOT** modified
by this ACT, so the earlier ACT identifier is satisfied by reference rather
than by duplicated receipts.
