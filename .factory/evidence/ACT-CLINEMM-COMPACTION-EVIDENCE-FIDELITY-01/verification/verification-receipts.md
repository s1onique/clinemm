# Verification receipts — ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-01

Every executable claim in this ACT has an observed receipt below. No synthetic
result is presented as live, and no inferred cause is presented as proven.

## 1. Entry identity

```
$ git rev-parse HEAD
bd39be9da2d0a610c173fbc205e2bdea570f8e70
$ git branch --show-current
main
$ git status --short
 M sdk/packages/core/src/extensions/context/compaction-shared.ts
 M sdk/packages/core/src/extensions/context/evidence-continuity.ts
?? .factory/evidence/ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-01/
?? sdk/packages/core/src/extensions/context/compaction.evidence-fidelity01.test.ts
$ /opt/homebrew/bin/bun --version
1.3.14
```

The working tree carried NO unexpected tracked dirt at the entry HEAD, and no
protected stash was present (`git stash list` was empty before this ACT began;
the temporary stashes this ACT used for baseline comparison were dropped, and
the final `git stash list` is empty).

## 2. Historical artifact identity (G0)

```
$ cd ~/.vscodium-roz/cline-data/sessions/1795382314359_rb19c/
$ for f in *; do echo "$(shasum -a 256 "$f" | cut -d' ' -f1)  $f"; done
aad44890951aebaef5539e8fea9b2e63dc4ff4d7e804f491e0f86a08a54a1769  1795382314359_rb19c.compaction.json
5f0e9b7b85b3d87e324c9ac9a134c96ab9c17c26d78b958565c3a71838c4d4b8  1795382314359_rb19c.json
31df6daa2ec3ec44122a572627e40e1a96b956f92e811804d38d4f60bf45d27b  1795382314359_rb19c.messages.json
```

Re-checked AFTER the repair: **byte-identical** (C8 — no historical sidecar
was mutated or migrated).

Capture run: 102 files, every one with the root field `mode: "full"`.
Session/capture identity correspondence: the capture's
`correlation.sessionId` is `1795382314359_rb19c` and its `correlation.runId`
is `yHaQSIjO`; the session sidecar's `metadata.sessionHistoryOrigin.version` is
`4.1.26-bd39be9da`, which matches the entry HEAD's short hash.

Full per-capture SHA-256 list: `../artifact-hashes.json`.

## 3. Subject-source verification of the witness fact

```
$ cd /Volumes/UserData/Users/chistyakov/Projects/Znanie/keycloak
$ git rev-parse HEAD
42de653b59708e712d694aeb9732f822b7f8fe5b
$ git branch --show-current
optimize-ftls
$ cat startup.sh
#!/bin/bash
set -e # Exit immediately if a command exits with a non-zero status

/opt/keycloak/bin/kc.sh build

# Execute the main container process using the free arguments passed to Docker
exec /opt/keycloak/bin/kc.sh start --optimized "$@"
```

This is the independent adjudication of the R4 fact: the tool output and the
frozen source revision agree.

## 4. RED (against unchanged production code)

```
$ cd sdk/packages/core
$ bunx vitest run --config vitest.config.ts \
    src/extensions/context/compaction.evidence-fidelity01.test.ts
 Test Files  1 failed (1)
      Tests  3 failed | 4 passed (7)
EXIT=1
```

## 5. DECISIVE RED reproducibility (production reverted to the entry HEAD)

```
$ git checkout -- sdk/packages/core/src/extensions/context/compaction-shared.ts \
                  sdk/packages/core/src/extensions/context/evidence-continuity.ts
$ bunx vitest run --config vitest.config.ts \
    src/extensions/context/compaction.evidence-fidelity01.test.ts
 Test Files  1 failed (1)
      Tests  16 failed | 7 passed (23)
```

## 6. GREEN (after the repair)

```
$ bunx vitest run --config vitest.config.ts \
    src/extensions/context/compaction.evidence-fidelity01.test.ts
 Test Files  1 passed (1)
      Tests  23 passed (23)
EXIT=0
```

## 7. Conservation sweep

```
$ bunx vitest run --config vitest.config.ts src/extensions/context/
 Test Files  26 passed | 1 skipped (27)
      Tests  440 passed | 2 skipped (442)
EXIT=0
```

## 8. Typecheck — ACT-owned diagnostics at zero, baseline preserved

```
$ bun tsc -p tsconfig.dev.json --noEmit | grep -cE '^src/.*error TS'
43
```

43 is the entry-HEAD baseline (verified by stashing the change and re-running
the identical command). The normalized diagnostic SETS are identical:

```
$ diff /tmp/baseline-diags.txt /tmp/current-diags.txt
IDENTICAL TO BASELINE
```

`compaction.evidence-fidelity01.test.ts` contributes 0 diagnostics.

## 9. Full-suite regression check — failing file set IDENTICAL to the entry HEAD

```
$ bunx vitest run --config vitest.config.ts      # WITH the repair
 Test Files  32 failed | 331 passed | 4 skipped (368)
      Tests  154 failed | 5483 passed | 176 skipped (5822)

$ bunx vitest run --config vitest.config.ts      # at the entry HEAD
 Test Files  32 failed | 330 passed | 4 skipped (367)
      Tests  154 failed | 5460 passed | 176 skipped (5799)

$ diff /tmp/failing-baseline.txt /tmp/failing-current.txt
IDENTICAL FAILING FILE SET
```

The 31 failing files are all pre-existing and unrelated (hub, sandbox, MCP,
plugin, codex, checkpoint, agenda suites). **No compaction/context test file
is in the failing set.** The repair adds 1 test file and 23 passing tests and
changes no failing test.

## 10. G6 boundary replay

`boundary-replay.json` in this directory holds the raw per-boundary
measurements. Summary:

| Boundary | Historical: fact in the compacted summary? | Corrected projection: fact carried? |
|---|---|---|
| 7 -> 8 | NO (0) | YES |
| 23 -> 24 | NO (0); survived only in the preserved tail | YES |
| 41 -> 42 | NO (0) | YES |
| 62 -> 63 | NO (0) | YES |
| 84 -> 85 | NO (0) | YES |

## 11. Confidentiality check

```
$ git status --short
?? .factory/evidence/ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-01/
```

The evidence directory contains only: markdown reports, JSON summaries with
safe fixture values, and the boundary-replay measurements. It contains NO
canonical transcript, NO provider payload, NO credential and NO secret path.
The only credential-shaped string anywhere in the repository copy is the
explicitly synthetic `SYNTHETIC-DO-NOT-USE-pw-abc123` in the negative
control.

---

# CORRECTION01 receipts

## C-1. The corrected per-boundary canonical prefixes

Derived from each boundary's own PRE-compaction provider request (the last tool-call id in that
request, looked up in the canonical transcript):

```
$ compare tool-calls(req84) vs tool-calls(req85)
req84 tool-calls: 24
req85 tool-calls: 4
IN-84  {"requests": [{"prompt": "Does this class write/persist build-time configuration
IN-84  {"requests": [{"prompt": "Quote the code showing how the build command persists
IN-84  {"commands": ["cd ... && grep -rn -l \"startup.sh\" ...
IN-84  {"commands": "cd ... && git rev-parse HEAD ...
```

| Boundary | Prefix end | Prefix size | Source-file reads in the prefix |
|---|---|---|---|
| 7 -> 8 | 15 | 16 | 6 |
| 23 -> 24 | 49 | 50 | 8 |
| 41 -> 42 | 85 | 86 | 8 |
| 62 -> 63 | 127 | 128 | 8 |
| 84 -> 85 | 171 | 172 | 10 |

The persisted sidecar's `source_message_count = 217` /
`source_last_message_key = id:msg_AdPPg-ET` (canonical index 216) independently confirms the
method.

## C-2. The realistic outside-the-budget RED (P0-2)

```
# against e9ab27bc8 (the reviewed repair):
× SCENARIO 16: with the R4 fact outside the 12-outcome budget and the summarizer
  omitting it, the provider-visible projection must still carry the fact
 Test Files  1 failed (1)
      Tests  6 failed | 22 passed (28)

# against the CORRECTION01 repair:
 Test Files  1 passed (1)
      Tests  28 passed (28)
EXIT=0
```

## C-3. The confidentiality boundary (P0-3)

```
CONTROL 16: a credential in a SOURCE FILE is redacted from the carried excerpt     PASS
CONTROL 17: a credential in a SOURCE FILE never reaches the summarizer request
            OR the persisted/provider-visible projection                         PASS
CONTROL 18: a PEM private key in a source file is redacted                       PASS
CONTROL 19: an ARBITRARY COMMAND's stdout is still never carried                PASS
```

## C-4. The corrected chronology (P0-4)

```
req85 tool-calls: 4  -- ALL FOUR are already present in req84
first NEW tool call after the boundary (req 86):
  {"commands": ["cd ... && git rev-parse HEAD && git branch --show-current && git status --porcelain | head -30", ...]}
```

The `read_files` of `startup.sh` occurs EXACTLY ONCE in the canonical transcript (canonical
index 6). The model never re-read it after the boundary.

Disposition: `BEHAVIORAL_CAUSE_UNPROVEN`.

## C-5. The fixture identity (P1)

```
assistant idx 6 tool_use id = call_362cfbf4cd5d44c19d876aeb name = read_files
user      idx 7 tool_result tool_use_id = call_362cfbf4cd5d44c19d876aeb name = read_files
```

The id and the tool name are both the historical ones. The original file's DOCSTRING was wrong
and has been corrected.

## C-6. Final verification

```
$ cd sdk/packages/core
$ bunx vitest run --config vitest.config.ts src/extensions/context/
 Test Files  26 passed | 1 skipped (27)
      Tests  445 passed | 2 skipped (447)
EXIT=0

$ bun tsc -p tsconfig.dev.json --noEmit | grep -cE '^src/.*error TS'
43
```
43 is the entry-HEAD baseline; the ACT-owned diagnostics are 0.

```
$ bunx vitest run --config vitest.config.ts
 Test Files  32 failed | 331 passed | 4 skipped (368)
      Tests  154 failed | 5488 passed | 176 skipped (5827)
```
The failing count (32 files / 154 tests) and the failing file set are IDENTICAL to the entry
HEAD. The repair adds 5 passing tests relative to `e9ab27bc8` and changes no failing test.

```
$ bunx biome check <the two modified production files> <the new test file>
Checked 3 files. 0 errors, 0 warnings.
```

## C-7. Historical artifacts unchanged (C8)

```
$ cd ~/.vscodium-roz/cline-data/sessions/1795382314359_rb19c/
$ for f in *; do echo "$(shasum -a 256 "$f" | cut -d' ' -f1)  $f"; done
aad44890951aebaef5539e8fea9b2e63dc4ff4d7e804f491e0f86a08a54a1769  1795382314359_rb19c.compaction.json
5f0e9b7b85b3d87e324c9ac9a134c96ab9c17c26d78b958565c3a71838c4d4b8  1795382314359_rb19c.json
31df6daa2ec3ec44122a572627e40e1a96b956f92e811804d38d4f60bf45d27b  1795382314359_rb19c.messages.json
```

Byte-identical to the entry-HEAD values. No historical sidecar was mutated or migrated.
