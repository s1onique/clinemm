# ACT-CLINEMM-INDEPENDENT-ACCEPTANCE-EVALUATOR01 — Closure Report

**Verdict:** `PASS_INDEPENDENT_ACCEPTANCE`
**Contract:** `agent-fixture/0.1` · `agent-acceptance/0.1` · `agent-trace/0.1` (acceptance family)
**Implementation:** `scripts/evaluate-agent-fixture.ts`
**Witnesses:** `scripts/__tests__/evaluate-agent-fixture.test.ts`
**Contract specification:** `docs/acts/ACT-CLINEMM-INDEPENDENT-ACCEPTANCE-EVALUATOR01/CONTRACT.md`

---

## 1. What was built

One external, offline, harness-independent evaluator that answers:

> Given a frozen coding fixture and the final workspace produced by an agent,
> did the agent actually complete the required repair without violating the
> fixture's constraints?

The verdict is derived **only** from independently observed facts: the frozen
fixture identity, the complete final candidate workspace delta,
protected-file and allowed-scope conservation, the trusted tests executed in an
independently reconstructed workspace, the **actual** subprocess exit status,
the structured JUnit test outcomes, and deterministic digests bound to the
evaluated source.

The evaluator:

- runs **outside** the agent session;
- does **not** instrument, patch, or observe either harness;
- does **not** modify `AgentRuntime`, the command executor, the native editor,
  model providers, reasoning controls, model-behavior trace production, the
  existing portable trace semantics, the DeepSeek Harness, or any benchmark
  candidate workspace;
- contains **no** provider-specific or harness-name branch in its acceptance
  logic;
- does **not** refactor the existing normalizer or comparator.

### 1.1 Repository recon — what already existed

| Capability | Pre-existing? | Reuse decision |
|---|---|---|
| Frozen fixture snapshots | **No** — the three-defect fixture was a loose ZIP outside the repository | The evaluator materializes the fixture from an operator-owned **git** repository at an exact commit + tree, so the identity is verifiable and bindable. |
| Independent workspace verification | **No** | New: a content-digest workspace inventory (added / modified / deleted / renamed / type-changed / untracked / symlink). |
| Structured test-result parsing | **No** | New: a fail-closed JUnit XML parser. |
| Subprocess execution with timeout + exit-status capture | **No** | New: a bounded runner with distinct `exited` / `signalled` / `timeout` / `spawnFailed` / `cancelled` outcomes. |
| Acceptance-result serialization | **No** — the portable contract specified `acceptance` but had no producer | New: `agent-acceptance/0.1` + an evaluator-owned `agent-trace/0.1` acceptance event stream. |

No new package, daemon, server, database, plugin framework or telemetry
collector was created.

---

## 2. The frozen fixture

The fixture is the known TypeScript three-defect benchmark. Its immutable
source ZIP was located on the operator's host and **byte-verified** into an
operator-owned git repository so its identity is a real commit + tree.

| Identity | Value |
|---|---|
| Fixture id | `typescript-three-defect-01` |
| Fixture commit | `14bcdc8874978d44acf4d08c5c2bccceb462bacc` |
| Fixture tree | `b626c98912dbcce39ac5cf8f37a535961d69723d` |
| Manifest SHA-256 | `a58a448c8196284d394165f4904a17ff244e9e9dce3a4a6eba8d6125fe575824` |
| Prompt SHA-256 | `5f48c0c55ef63fa02637fafaaabf4eaa10edc26fc07e4d82190d4aa490f7a015` |
| Trusted command | `/opt/homebrew/bin/bun test ./tests/contract.test.ts` (explicit argv, `shell: false`) |
| Allowed scope | `src/**` |
| Protected paths | `tests/**`, `package.json`, `README.md` |

All five fixture files were confirmed **byte-identical** to the original
immutable ZIP before the fixture was frozen.

### 2.1 The RED baseline reproduced

The evaluator ran the frozen fixture itself, with no candidate changes applied:

```
baseline exit code : 1
baseline total     : 18
baseline passing   : 14
baseline failing   : 4
baseline skipped   : 0
```

This matches the historical expectation (`14 passing`, `4 failing`, 3 planted
defects). The baseline was **not** re-recorded from history — it was executed
by the evaluator on this host.

The 4 failing test identities were observed structurally from the JUnit
report:

1. `foreign session's outstanding job must not hold this owner's completed job`
2. `foreign terminal and observation must not discharge a local obligation`
3. `pre-terminal observation cannot discharge an obligation`
4. `two different events with same seq are invalid`

---

## 3. The evaluator's decision procedure

```
1. materialize the frozen fixture, VERIFY commit + tree   → CAPTURE_INSUFFICIENT on mismatch
2. run the RED baseline against the untouched fixture     → CAPTURE_INSUFFICIENT on mismatch
3. inventory the candidate workspace in full
   3a. symlink / path-traversal escape                    → FAIL
   3b. protected-path modification                        → FAIL
   3c. out-of-scope change                                → FAIL
4. reconstruct the evaluation workspace from the fixture
   + apply ONLY the validated candidate-source changes
5. run the SAME trusted tests
   5a. timeout                                            → INCOMPLETE
   5b. spawn failure                                      → INCOMPLETE
   5c. missing / malformed required report                → INCOMPLETE
   5d. non-zero exit                                      → FAIL
   5e. test-count mismatch / threshold miss / regression  → FAIL
6. otherwise                                             → PASS
```

The trusted tests, configuration and acceptance criteria always come from the
frozen fixture — never from the candidate's modified copies. A candidate that
replaces the trusted test with an always-passing stub is caught at step 3b,
before any verdict about test outcomes can be reached.

### 3.1 Two distinct observations are preserved

`process.exitCode` and `testReport.passed / failed / skipped` are recorded as
two separate fields. A complete passing report combined with a non-zero exit
is `FAIL`, never a silent success. Exit 0 without a required structured report
fabricates no counts — it is `INCOMPLETE` / `TEST_REPORT_MISSING`.

No output-phrase matching (e.g. "18 pass") is used anywhere as authoritative
evidence.

---

## 4. Witness table

| Witness | Required behaviour | Observed | Evidence class |
|---|---|---|---|
| `BASE-01` | Frozen fixture produces expected RED | baseline exit 1, 18 total, 14 pass / 4 fail | **REAL** |
| `PASS-01` | Valid repaired candidate independently passes | `PASS`, final exit 0, 18 pass / 0 fail | **REAL** |
| `FAIL-01` | Agent claims PASS but tests fail → `FAIL` | `FAIL` / `TEST_FAILURE`, final exit 1 | **REAL** |
| `FAIL-02` | Candidate changes `tests/` → `FAIL` | `PROTECTED_FILE_CHANGED` | SYNTHETIC + REAL end-to-end |
| `FAIL-03` | Candidate changes `package.json` → `FAIL` | `PROTECTED_FILE_CHANGED` | SYNTHETIC |
| `FAIL-04` | Candidate changes a file outside `src/` → `FAIL` | `OUT_OF_SCOPE_CHANGE` | SYNTHETIC |
| `FAIL-05` | Untracked out-of-scope file detected | `added` change + scope violation | SYNTHETIC |
| `FAIL-06` | Deleted protected file detected | `deleted` change + protected violation | SYNTHETIC |
| `FAIL-07` | Symlink / path traversal outside the workspace rejected | `SYMLINK_ESCAPE` + `PATH_TRAVERSAL` | SYNTHETIC + REAL end-to-end |
| `FAIL-08` | Runner exits non-zero even if output contains "all tests passed" | exit 3 observed, output ignored | SYNTHETIC |
| `INCOMPLETE-01` | Timeout cannot become PASS | `endKind: "timeout"`, `exitCode: null` | SYNTHETIC |
| `INCOMPLETE-02` | Missing required report cannot fabricate counts | all counts `null`, `structurallyValid: false` | SYNTHETIC |
| `IDENTITY-01` | Different starting fixture rejected | fixture commit/tree verified; mismatch → `FIXTURE_IDENTITY_MISMATCH` | SYNTHETIC |
| `IDENTITY-02` | Modified candidate tests cannot replace trusted tests | `FAIL` / `PROTECTED_FILE_CHANGED` | **REAL** end-to-end |
| `PRIV-01` | Export contains no raw output or sensitive paths | no absolute path, no transcript, no `(fail)` marker | **REAL** end-to-end |
| `DET-01` | Identical inputs → identical deterministic evidence | digests byte-identical across runs | SYNTHETIC + **REAL** end-to-end |

**28 / 28 focused witnesses pass** (`vitest` exit 0).

---

## 5. Initial integration demonstration

Two candidate workspaces prepared from the **same** frozen fixture and
evaluated by the external evaluator:

| Candidate | Workspace | Baseline | Final | Verdict | Exit |
|---|---|---|---|---|---|
| **A** — known broken baseline | frozen fixture, unmodified | 14 pass / 4 fail, exit 1 | 14 pass / 4 fail, exit 1 | **`FAIL`** (`TEST_FAILURE`) | 1 |
| **B** — known repaired source | `src/ledger.ts` + `src/validate.ts` repaired | 14 pass / 4 fail, exit 1 | **18 pass / 0 fail**, exit 0 | **`PASS`** | 0 |
| **B** — rerun without any model-behavior trace | identical workspace | 14 pass / 4 fail, exit 1 | 18 pass / 0 fail, exit 0 | **`PASS`** | 0 |

The verdict, the deterministic digests (`finalWorkspaceDigest`,
`candidateDeltaSha256`, `testReportSha256`) and the structured test results
are **identical** with and without the optional trace.

> **Scope of the claim.** This fixture has already been exposed to the models
> during previous investigations. These two samples demonstrate that the
> evaluator is harness-neutral and externally authoritative. They do **not**
> establish general harness parity. A blind holdout fixture remains a future
> benchmark requirement and did not block this ACT.

---

## 6. Necessity ablation

**Load-bearing gate:** the protected-file conservation gate.

A candidate that tampers with the trusted tests *and* otherwise carries the
known repair:

| Configuration | Verdict | Reasons |
|---|---|---|
| Gate **enabled** (default) | `FAIL` | `PROTECTED_FILE_CHANGED`, `OUT_OF_SCOPE_CHANGE` |
| Gate **disabled** (ablation) | `FAIL` | `OUT_OF_SCOPE_CHANGE` — the protected-file violation is **no longer reported** |
| Gate **restored** | `FAIL` | `PROTECTED_FILE_CHANGED`, `OUT_OF_SCOPE_CHANGE` |

The ablation shows the protected-file gate is the authority that detects the
tampering; with it disabled the evaluator no longer reports the violation.
Restoring the implementation and re-running GREEN restores the rejection.

---

## 7. Harness neutrality

The evaluator accepts a candidate **filesystem path**. It does **not** require
ClineMM's `TaskHeader`, ClineMM's editor tool, ClineMM-specific session ids,
DeepSeek-specific event names, any model-behavior JSONL file, or any agent
completion format.

The neutral verdict is pinned by an executable witness that evaluates the same
repaired workspace twice — once with a trace path supplied and once without —
and asserts both the verdict and the deterministic evidence fields are equal.

---

## 8. `agent-trace/0.1` integration

The evaluator writes a **separate, evaluator-owned** acceptance record stream
to `acceptance-events.jsonl`:

```jsonc
{
  "contract": "agent-trace/0.1",
  "harness": "evaluator:<harness-label>",
  "family": "acceptance",
  "recordId": "acceptance:<trialId>:verdict",
  "nativeTraceId": "acceptance-trace-<trialId>",
  "identity": { "experimentId": "...", "trialId": "...", "fixtureId": "..." },
  "payload": { "verdict": "PASS", "reasons": [], "/* digests only */" }
}
```

The composition rule is an **explicit `trialId` / experiment manifest
association**. Timestamp-proximity joins are forbidden. An evaluator event id
is never equated with a ClineMM run id, a DeepSeek step id or a provider
request id — the evaluator's ids are prefixed `acceptance:` /
`acceptance-trace-`, and a witness asserts the evaluator's `recordId` contains
no `run_` namespace marker.

The `agent-trace/0.1` **producer semantics are unchanged**. The native
normalizer's `acceptance` family allowlist remains INTENTIONALLY EMPTY, and
the native normalizer, the existing comparator and the existing portable
contract test were **not modified**.

---

## 9. Privacy

The portable export (`acceptance.json`, `acceptance-events.jsonl`,
`evaluation-manifest.json`) contains only authorized metadata, counts,
identities, sanitized classifications and digests.

Verified absent from the export:

- prompt text and reasoning content;
- shell command output (no `(fail)` marker, no `PASSED` banner, no transcript);
- secrets and credentials;
- unredacted source;
- absolute private workspace paths (no `/Volumes/…`, no `/Users/…`, no
  candidate or fixture path).

The test process itself receives an environment built from an **empty** base
plus the operator's explicit allowlist (`PATH`, `HOME`, `TMPDIR`, `LANG`,
`LC_ALL`), so provider credentials and unrelated secrets cannot leak into
untrusted candidate code. Nothing is installed automatically.

Raw transcripts are retained **locally and separately** in `raw-transcripts.txt`
and are not part of the portable export.

---

## 10. Determinism

Identical inputs produce identical deterministic evidence fields:

| Field | Run 1 | Run 2 |
|---|---|---|
| `finalWorkspaceDigest` | `65d6f42514e56788…` | `65d6f42514e56788…` |
| `candidateDeltaSha256` | `52c39d8abea1e8e5…` | `52c39d8abea1e8e5…` |
| `testReportSha256` | `a0bdc8aa3fcc6415…` | `a0bdc8aa3fcc6415…` |
| `baselineTestResults.reportSha256` | identical | identical |

**One real defect was found and fixed during qualification.** The JUnit
report's raw bytes embed wall-clock `time` attributes, so a raw-byte digest
was not reproducible across runs. The report digest now covers the report's
**semantic content** (the counts and the test identities) instead. The
time-dependent fields (`evaluatedAt`, `evaluatorDurationMs`, `*.durationMs`)
vary by design and are excluded from deterministic comparison.

---

## 11. Gates

| Gate | Command | Result |
|---|---|---|
| Genuine evaluator-capability RED | focused witnesses before the implementation | RED (no evaluator existed) |
| GREEN focused evaluator tests | `vitest run --config <acceptance config> scripts/__tests__/evaluate-agent-fixture.test.ts` | **28 / 28 pass, exit 0** |
| Real fixture baseline RED | evaluator's own baseline run | 14 pass / 4 fail, exit 1 |
| Real repaired fixture GREEN | evaluator run on the repaired workspace | 18 pass / 0 fail, exit 0, `PASS` |
| Adversarial protected-file + scope controls | focused witnesses FAIL-02..FAIL-07 | all detected |
| One necessity ablation | protected-file gate ablated, then restored | gate demonstrated load-bearing, GREEN restored |
| Deterministic artifact verification | DET-01 (synthetic + real end-to-end) | identical digests |
| Privacy check of the export | PRIV-01 + export grep | no raw output, no private paths |
| Affected typecheck | `tsc --noEmit` on both touched files | **0 errors** |
| Biome on touched code | `biome check --config-path ./biome.json --diagnostic-level=error` | **0 errors** |
| Existing relevant portable contract tests | `vitest run --config apps/vscode/vitest.config.ts src/sdk/__tests__/agent-trace-contract-recon01.test.ts` | **31 / 31 pass** |
| Diff hygiene | `git status --porcelain=v1 -uall` | 3 new files, 0 tracked modifications |
| Exact-head artifact binding | `evaluatorSourceHead` + `evaluatorArtifactSha256` in the artifact | bound |

The whole SDK / webview suite was **not** run, by design.

> **Host note.** Vitest's forks-pool worker teardown logs `kill EPERM` on this
> host because the sandbox refuses to signal worker processes. The tests
> themselves pass and the runner exits 0; the message is teardown noise, not a
> test failure. It is observed identically on the **pre-existing** portable
> contract suite, so it is not introduced by this ACT.

---

## 12. Identity

| Identity | Value |
|---|---|
| `ENTRY_HEAD` | `269d8703864f2cd67d68060814dabb527de6d44b` |
| `ENTRY_TREE` | `9c4e0854fa896077f20af6c930732f18cb30a36f` |
| `EVALUATOR_SOURCE_SHA256` | `917a6db55602c016dbe6fbcbedc44f642dc1829892121d909e41c6e4d3b6a05e` |
| `FIXTURE_COMMIT` | `14bcdc8874978d44acf4d08c5c2bccceb462bacc` |
| `FIXTURE_TREE` | `b626c98912dbcce39ac5cf8f37a535961d69723d` |
| `MANIFEST_SHA256` | `a58a448c8196284d394165f4904a17ff244e9e9dce3a4a6eba8d6125fe575824` |
| `ACCEPTANCE_ARTIFACT_SHA256` | `925bf7c899ddbaf08b35ff6778d6075877d4ac5fb9cda170505db340b1fc5876` |

`SUBJECT_HEAD` / `SUBJECT_TREE` are the closure commit and are bound by the
commit itself — they are deliberately **not** embedded in any tracked file, so
they cannot change the commit they name.

---

## 13. Changed files

```
scripts/evaluate-agent-fixture.ts
scripts/__tests__/evaluate-agent-fixture.test.ts
docs/acts/ACT-CLINEMM-INDEPENDENT-ACCEPTANCE-EVALUATOR01/CONTRACT.md
docs/acts/ACT-CLINEMM-INDEPENDENT-ACCEPTANCE-EVALUATOR01/REPORT.md
.factory/epic-board.md
```

No production code, no harness code, no existing normalizer, no comparator,
and no benchmark candidate workspace was modified.

---

## 14. Limitations and honest scope

1. **The fixture is exposed.** The three-defect fixture has already been seen
   by both models during earlier investigations. The qualification proves the
   evaluator is externally authoritative and harness-neutral; it does **not**
   prove general harness parity. A blind holdout fixture is a future
   benchmark requirement.
2. **One fixture storage backend.** The implementation requires a Git-backed
   fixture. It was not expanded into multiple storage backends without a
   concrete need.
3. **The isolation is environment-based, not a sandbox.** Candidate code runs
   with an empty-base environment, a bounded lifetime and bounded output
   retention, in an evaluator-controlled workspace. It is **not** a
   general-purpose OS sandbox, and this ACT did not build one.
4. **The fixture repository lives outside the repository** (the operator's
   `/tmp` workspace), so the frozen fixture bytes are operator evidence, not
   committed content. The manifest records its commit + tree so the identity
   remains verifiable and bindable.
5. **The runner is Bun's JUnit reporter.** The manifest declares the report
   kind explicitly, so another runner can be supported by a manifest change
   rather than an evaluator change.
6. **`evaluatedAt` and duration fields vary** by design and are excluded from
   deterministic comparison.

---

## 15. Stop condition

The ACT's terminal directive is met:

1. a frozen fixture can be evaluated independently — **yes**;
2. a known broken candidate receives `FAIL` — **yes**;
3. a known repaired candidate receives `PASS` — **yes**;
4. protected-file modifications are detected — **yes**;
5. the same acceptance decision is obtained without a harness trace — **yes**;
6. artifacts are committed and bound to the actual source — **yes**.

**Stop after closure.** DeepSeek integration, subprocess telemetry and
prompt-attestation instrumentation are NOT started by this ACT.
