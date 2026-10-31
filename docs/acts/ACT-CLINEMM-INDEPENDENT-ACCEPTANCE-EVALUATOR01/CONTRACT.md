# `agent-fixture/0.1` and `agent-acceptance/0.1` — Independent Acceptance Contracts

**ACT:** `ACT-CLINEMM-INDEPENDENT-ACCEPTANCE-EVALUATOR01`
**Reference implementation:** `scripts/evaluate-agent-fixture.ts`
**Reference witnesses:** `scripts/__tests__/evaluate-agent-fixture.test.ts`
**Successor of:** `ACT-CLINEMM-HARNESS-NEUTRAL-TRACE-CONTRACT-RECON01` §9

---

## 1. Purpose

This contract defines the external evaluator's two records:

- **`agent-fixture/0.1`** — the operator-owned manifest that freezes a coding
  fixture: its identity, the prompt, the permitted scope, the trusted test
  command and the acceptance threshold.
- **`agent-acceptance/0.1`** — the portable verdict record the evaluator
  produces from independently observed facts.

Together they answer exactly one question:

> Given a frozen coding fixture and the final workspace produced by an agent,
> did the agent actually complete the required repair without violating the
> fixture's constraints?

The answer is derived **only** from:

1. the frozen fixture identity (commit + tree), read from the operator-owned
   fixture repository — **never** from the candidate's `.git` pointer or branch
   name;
2. the final candidate workspace state, inventoried in full;
3. protected-file and allowed-scope conservation;
4. execution of the trusted tests in an independently reconstructed workspace;
5. the **actual** subprocess exit status;
6. structured test outcomes (JUnit XML) when the runner supports them;
7. reproducible artifacts bound to the evaluated source.

---

## 2. Non-dependencies

The evaluator MUST NOT depend on:

- any harness's class names, runtime architecture, or event names;
- any model provider;
- any particular tool catalog or editor implementation;
- a model-behavior JSONL file;
- a particular agent completion format.

The evaluator MUST NOT contain a provider-specific or harness-name branch in
its acceptance logic. The candidate is a filesystem path; the fixture is a
manifest; the runner is an argv.

**The acceptance verdict MUST be identical whether or not an optional
model-behavior trace is supplied.** This is the harness-neutrality invariant
and it is pinned by an executable witness.

---

## 3. `agent-fixture/0.1` — the frozen fixture manifest

```jsonc
{
  "schemaVersion": "agent-fixture/0.1",
  "fixtureId": "typescript-three-defect-01",
  "source": {
    "kind": "git",
    "repository": "<operator-owned fixture git repository>",
    "commit": "<exact frozen commit>",
    "tree": "<exact frozen tree>"
  },
  "prompt": { "sha256": "<exact prompt SHA-256>" },
  "allowedChanges": ["src/**"],
  "protectedPaths": ["tests/**", "package.json", "README.md"],
  "test": {
    "argv": ["/opt/homebrew/bin/bun", "test", "./tests/contract.test.ts"],
    "cwd": ".",
    "timeoutMs": 120000,
    "report": { "kind": "junit", "required": true }
  },
  "acceptance": {
    "expectedTestCount": 18,
    "requiredPassingTests": 18,
    "expectedBaseline": {
      "passingTests": 14,
      "failingTests": 4,
      "skippedTests": 0,
      "exitCode": 1
    }
  },
  "environment": { "allow": ["PATH", "HOME", "TMPDIR"], "deny": [] }
}
```

### 3.1 Fixture authority

The manifest and the trusted tests are owned by the **evaluator/operator**. The
candidate cannot define or change:

- which tests count,
- which paths are allowed,
- the acceptance threshold,
- the baseline identity,
- the trusted test command,
- the evaluator's own configuration.

The evaluator MUST reject a candidate that modifies a protected path. It MUST
NOT silently restore protected files inside the candidate and call that
candidate valid.

### 3.2 The manifest is frozen before candidate evaluation

The manifest's `commit` and `tree` are the frozen identity. The evaluator
**verifies** them against the fixture repository before it evaluates anything;
a mismatch is `FIXTURE_IDENTITY_MISMATCH` / `CAPTURE_INSUFFICIENT`.

### 3.3 The `test.argv` is an argument vector

The trusted command is an explicit argv, executed with `shell: false`. A shell
string is never interpolated.

### 3.4 The environment starts empty

The candidate test process receives an environment built from an **empty**
base plus the operator's explicit `environment.allow` list, minus
`environment.deny`. Provider credentials and unrelated secrets therefore
cannot leak into an untrusted candidate. Nothing is installed automatically.

---

## 4. Independent candidate snapshot

The candidate workspace path is supplied **explicitly by the operator**.

Before executing any tests the evaluator:

1. resolves and validates the candidate root;
2. inventories tracked modifications, deletions, renames, type changes and
   untracked files;
3. detects changes outside `allowedChanges`;
4. detects modifications to `protectedPaths`;
5. detects symlinks or path traversal that would escape the candidate root;
6. captures the final candidate state under an evaluator-controlled snapshot;
7. calculates deterministic file digests;
8. records exactly which candidate files will be evaluated.

The evaluator MUST NOT mutate the original candidate.

### 4.1 The workspace inventory is complete, not a git diff

`git diff HEAD` alone is NOT a complete workspace inventory and is never used.
The evaluator compares the **content digest** of every file and symlink in the
frozen fixture against the candidate's, and covers added, modified, deleted,
renamed, type-changed and untracked entries plus symlinks.

Modification timestamps are **never** used as proof that a file is unchanged.

### 4.2 The evaluation workspace is reconstructed independently

For the initial Git-backed implementation the evaluator constructs an
independent evaluation workspace from the frozen fixture, then applies **only**
the validated candidate-source changes to it. The trusted tests, configuration
and acceptance criteria therefore always come from the frozen fixture, never
from the candidate's modified copies.

### 4.3 Version-control administrative directories are not workspace content

`.git` is a pointer, not workspace content. The evaluator excludes it from
both sides of the comparison, identically, so it can neither hide a
candidate-side change nor become evidence of fixture identity.

---

## 5. Trusted test execution

The frozen tests run in the independent evaluation workspace.

The first implementation supports:

- process spawn success/failure;
- exit code;
- termination signal;
- timeout;
- cancellation;
- wall-clock duration;
- bounded stdout/stderr capture;
- structured test results when available;
- missing or malformed test-result artifacts.

### 5.1 The exit status is observed, never inferred

`process.exitCode` and `testReport.passed / failed / skipped` are preserved as
**two distinct observations**.

- Exit 0 without a required structured report MUST NOT fabricate test-case
  counts.
- A complete passing test report combined with a non-zero process exit MUST
  NOT be treated as a successful evaluation.
- Output-phrase matching (e.g. "18 pass") is NOT acceptable as authoritative
  structured evidence.

### 5.2 Structured results

The evaluator prefers a runner-supported machine-readable report. For Bun this
is JUnit XML (`--reporter=junit --reporter-outfile=<path>`), appended to the
frozen argv.

The parser is **fail-closed**: a report whose declared counts disagree with its
observed `<testcase>` elements, or which has no `<testsuites>` root, yields
`structurallyValid: false` rather than guessed counts.

The report digest covers the report's **semantic content** (the counts and the
test identities), not its raw bytes: raw JUnit bytes embed wall-clock timing
attributes and are therefore not reproducible across runs.

### 5.3 Execution isolation

Candidate code runs in an operator-approved isolated environment with:

- no provider credentials or unrelated secrets (empty-base environment);
- no unnecessary network access;
- a bounded process lifetime;
- bounded output retention;
- no automatic dependency installation;
- no writes to the agent's original workspace.

This ACT does **not** build a general-purpose sandbox. If safe candidate-code
execution is unavailable, the evaluator returns `NOT_EXECUTED` or
`CAPTURE_INSUFFICIENT` with the exact reason. Untrusted candidate code is
never run with unrestricted host privileges to satisfy the test gate.

---

## 6. The RED baseline is the evaluator's own authority

Before evaluating any candidate, the evaluator executes the frozen fixture
**without applying any candidate changes** and records:

- the actual baseline exit status;
- the actual test identities;
- the passing / failing / skipped counts;
- the baseline test-report digest;
- the fixture tree digest;
- the runner and runtime identity.

If the expected baseline does not reproduce, the evaluator stops with
`BASELINE_MISMATCH` / `CAPTURE_INSUFFICIENT`. The tests and the acceptance
threshold are **not** rewritten to fit the observed result.

A pre-recorded historical RED is context; it cannot substitute for the
evaluator's own baseline execution.

---

## 7. GREEN candidate authority

Acceptance requires **all** of:

1. all required tests pass;
2. no previously passing test regresses;
3. protected files are unchanged;
4. all changes remain within the permitted scope;
5. the runner exits successfully;
6. structured test evidence is valid when required;
7. the final evaluated workspace is bound to a deterministic digest.

---

## 8. Verdicts

| Verdict | Meaning |
|---|---|
| `PASS` | Independent acceptance satisfied |
| `FAIL` | Evaluated candidate violated a measured requirement |
| `INCOMPLETE` | Evaluation began but required checks did not finish |
| `NOT_EXECUTED` | The required acceptance execution never ran |
| `CAPTURE_INSUFFICIENT` | Evidence cannot establish a trustworthy result |

Every non-PASS verdict carries a machine-readable reason code:

`TEST_FAILURE` · `PROTECTED_FILE_CHANGED` · `OUT_OF_SCOPE_CHANGE` ·
`BASELINE_MISMATCH` · `TEST_REPORT_MISSING` · `TEST_REPORT_INVALID` ·
`PROCESS_TIMEOUT` · `PROCESS_SPAWN_FAILED` · `CANDIDATE_SNAPSHOT_FAILED` ·
`FIXTURE_IDENTITY_MISMATCH` · `UNSAFE_EXECUTION_ENVIRONMENT` ·
`CANDIDATE_ROOT_INVALID` · `SYMLINK_ESCAPE` · `PATH_TRAVERSAL` ·
`TEST_COUNT_MISMATCH` · `REGRESSION` · `EVALUATOR_INTERNAL_ERROR` ·
`MANIFEST_INVALID`

**An execution failure is never promoted to a candidate correctness failure.**
A failed candidate and an unmeasurable candidate are different outcomes.

---

## 9. `agent-acceptance/0.1` — the portable verdict record

```jsonc
{
  "schemaVersion": "agent-acceptance/0.1",
  "experimentId": { "value": "<id>", "provenance": "OPERATOR_SUPPLIED" },
  "trialId": { "value": "<id>", "provenance": "OPERATOR_SUPPLIED" },
  "fixtureId": { "value": "<id>", "provenance": "OPERATOR_SUPPLIED" },
  "fixtureCommit": { "value": "<sha>", "provenance": "OBSERVED_BY_EVALUATOR" },
  "fixtureTree": { "value": "<sha>", "provenance": "OBSERVED_BY_EVALUATOR" },
  "promptSha256": { "value": "<sha>", "provenance": "OPERATOR_SUPPLIED" },
  "candidateSnapshotSha256": { "value": "<sha>", "provenance": "OBSERVED_BY_EVALUATOR" },
  "candidateChangedFiles": { "value": ["src/ledger.ts"], "provenance": "OBSERVED_BY_EVALUATOR" },
  "candidateScopeViolations": { "value": [], "provenance": "OBSERVED_BY_EVALUATOR" },
  "candidateProtectedViolations": { "value": [], "provenance": "OBSERVED_BY_EVALUATOR" },
  "trustedTestInvocationIdentity": { "value": "<sha>", "provenance": "DERIVED_FROM_VERIFIED_INPUT" },
  "runnerIdentity": { "value": "<sha>", "provenance": "DERIVED_FROM_VERIFIED_INPUT" },
  "baselineProcessOutcome": { "value": { /* ... */ }, "provenance": "OBSERVED_BY_EVALUATOR" },
  "finalProcessOutcome": { "value": { /* ... */ }, "provenance": "OBSERVED_BY_EVALUATOR" },
  "baselineTestResults": { "value": { /* ... */ }, "provenance": "OBSERVED_BY_EVALUATOR" },
  "finalTestResults": { "value": { /* ... */ }, "provenance": "OBSERVED_BY_EVALUATOR" },
  "testReportSha256": { "value": "<sha>", "provenance": "OBSERVED_BY_EVALUATOR" },
  "acceptanceVerdict": { "value": "PASS", "provenance": "OBSERVED_BY_EVALUATOR" },
  "acceptanceReasons": { "value": [], "provenance": "OBSERVED_BY_EVALUATOR" },
  "evaluatorSourceHead": { "value": "<sha>", "provenance": "DERIVED_FROM_VERIFIED_INPUT" },
  "evaluatorVersion": { "value": "1.0.0", "provenance": "DERIVED_FROM_VERIFIED_INPUT" },
  "evaluatorArtifactSha256": { "value": "<sha>", "provenance": "DERIVED_FROM_VERIFIED_INPUT" },
  "evaluatedAt": { "value": "<iso>", "provenance": "OBSERVED_BY_EVALUATOR" },
  "evidenceProvenance": { "value": "OBSERVED_BY_EVALUATOR", "provenance": "OBSERVED_BY_EVALUATOR" }
}
```

### 9.1 Per-field provenance

Every field declares one of:

- `OBSERVED_BY_EVALUATOR` — the evaluator measured it directly;
- `OPERATOR_SUPPLIED` — the operator asserted it; it is NOT independently
  verified;
- `DERIVED_FROM_VERIFIED_INPUT` — computed from verified inputs;
- `UNAVAILABLE` — the fact could not be established.

**An operator-supplied prompt digest is NOT promoted to proof that a harness
received that exact prompt.** That requires a separate runtime attestation.

### 9.2 Determinism

The deterministic evidence fields are stable across identical runs. The
time-dependent fields (`evaluatedAt`, `evaluatorDurationMs`,
`*.durationMs`) vary and MUST be excluded from any deterministic comparison.

---

## 10. Privacy

The portable acceptance artifact MUST contain no:

- prompt text;
- reasoning content;
- shell command output;
- secrets;
- unredacted source;
- absolute private workspace paths.

It retains only authorized metadata, counts, identities, sanitized
classifications and digests. Raw test transcripts needed for debugging remain
**local**, in a separate file (`raw-transcripts.txt`), and are subject to an
explicit retention policy.

---

## 11. `agent-trace/0.1` integration

The existing portable contract includes an `acceptance` event family with no
native ClineMM producer. The evaluator bridges its result into that family as
a **separate, evaluator-owned record stream**:

```
harness trace:         model / tool / workspace / context / run
independent evaluator: acceptance
```

The evaluator owns its own event identities and observation boundaries. The
composition rule is an **explicit `trialId` / experiment manifest
association**. A join based only on timestamp proximity is forbidden, and an
evaluator event id is NEVER equated with a ClineMM run id, a DeepSeek step id,
or a provider request id.

The `agent-trace/0.1` **producer semantics are unchanged**. The native
normalizer's `acceptance` family allowlist stays INTENTIONALLY EMPTY — the
evaluator's acceptance payload never routes through the native normalizer.

The evaluator's acceptance record is written to `acceptance-events.jsonl`:

```jsonc
{
  "contract": "agent-trace/0.1",
  "harness": "evaluator:<harness-label>",
  "family": "acceptance",
  "recordId": "acceptance:<trialId>:verdict",
  "nativeTraceId": "acceptance-trace-<trialId>",
  "identity": { "experimentId": "...", "trialId": "...", "fixtureId": "..." },
  "payload": { "verdict": "PASS", "reasons": [], /* digests only */ }
}
```

---

## 12. Performance boundary

This ACT measures authoritative **final correctness**, not in-session progress
milestones. It may measure the baseline duration, the candidate duration and
the evaluator duration. It MUST NOT fabricate time-to-first-RED, time-to-
first-GREEN, time-to-first-retained-change, or agent thinking time.

The evaluator supplies the **final correctness axis**; the existing trace
supplies the **model/tool efficiency axis**.
