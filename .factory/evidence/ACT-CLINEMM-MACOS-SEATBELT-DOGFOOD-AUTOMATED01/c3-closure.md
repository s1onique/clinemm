# ACT-CLINEMM-MACOS-SEATBELT-DOGFOOD-AUTOMATED01 -- C3 CLOSURE

```
PASS_SEATBELT_DOGFOOD_WAVE1
CLOSED_CLEAN
```

C3 is evidence-freeze only. No code changes. The dogfood harness is
a TEMPORARY diagnostic suite (per c1-closure.md, "Why DEFAULT_OFF")
and its removal trigger has now fired: the matrix closed with
`p0Fail=0` and the load-bearing P0 invariants are frozen.

## Provenance identities

```
DOGFOOD_SUBJECT_HEAD = 4cef3d59c5e4d9ea4901a4d3efb5f0e4a3c029db
DOGFOOD_SUBJECT_TREE = 7f42e00d1a651ed450e9e75237024ce6162299fa
C2_CLOSURE_HEAD      = cf0896d4c...   (verdict/closure; run occurred BEFORE this commit)

MANIFEST_VERSION     = "wave-1-rc1-corre04"
MANIFEST_SHA256      = 7d85bc0d850ff7559f00c278b3577bc59e3c40ca5ffa15c78efc43c155e39ad6
```

The dogfood run executed at `DOGFOOD_SUBJECT_HEAD=4cef3d59c`.
G05 captured this verbatim at run time:

```json
{ "id": "G05", "command": "git rev-parse HEAD",
  "exitCode": 0,
  "observedStdoutExcerpt": "4cef3d59c5e4d9ea4901a4d3efb5f0e4a3c029db\n" }
```

`C2_CLOSURE_HEAD=cf0896d4c` is the verdict/closure commit written
AFTER the run; it is NOT the source HEAD that was qualified.

## Load-bearing P0 evidence (3 causal pairs + 1 single-leg)

```
W01 (kernel-deny, p0Sensitive, EXPECTED_DENY):
  control: exitCode=0, controlSignalObserved=true   (sentinel written)
  test:    exitCode=1, denySignatureObserved=true, stateConserved=true
  test.stderrExcerpt: "Operation not permitted"  (kernel EPERM on the redirect)
  --> unsandboxed CONTROL writes OK; sandbox TEST is KERNEL-DENIED;
      sentinel bytes unchanged after TEST  ==> EXPECTED_DENY

N01 (network-deny, p0Sensitive, EXPECTED_DENY):
  control: stdout contains clinemm-dogfood-LOCAL-RESPONSE-TOKEN-...
           (C2 driver bound 127.0.0.1:<assigned> and CONTROL reached it)
  test:    exitCode=7, "curl: (7) Failed to connect to 127.0.0.1 port 55298..."
  --> unsandboxed CONTROL gets the response token; sandbox TEST cannot connect
      ==> EXPECTED_DENY (network is not the missing piece; sandbox is)

C02 (kernel-deny via nested /bin/sh, p0Sensitive, EXPECTED_DENY):
  command: /bin/sh -c 'printf X > ${CLINEMM_DOGFOOD_READONLY_PROBE} 2>&1 || echo NESTED_DENY'
  control: exitCode=0, controlSignalObserved=true
  test:    exitCode=0, denySignatureObserved=true, stateConserved=true
  test.stderrExcerpt: "/bin/sh: .factory/.../readonly-probe-...: Operation not permitted"
  test.stdoutExcerpt:  "NESTED_DENY\n"   (parent shell recovered after the deny)
  --> nested-shell control writes OK; nested-shell test is KERNEL-DENIED;
      sentinel bytes unchanged after TEST  ==> EXPECTED_DENY

E01 (secret-absent, p0Sensitive, single-leg, PASS):
  child stdout: "DOGFOOD_ENV_PROBE_OK:\n"   (positive witness present)
  child stdout: NO synthetic secret value   (sanitized)
  --> child ran AND printed the witness AND the secret was stripped
      by the Wave-1 sanitization layer  ==> PASS
```

`p0Fail=0`, `causalPairFail=0`, `p0Halted=false`. The 3 P0
causal pairs all reached `EXPECTED_DENY` with the C3-quality
discriminator (control-OK + test-deny + state-conserved). E01
reached PASS by satisfying the positive-and-negative witness
property.

## P1 residues (NOT blocking Seatbelt qualification)

These are recorded but do NOT reduce the P0 verdict.

### T01 / T02 -- mktemp kernel EPERM (COMPATIBILITY_FAIL)

```
T01: mktemp       exitCode=1, stderrClass=kernel-eperm  -> COMPATIBILITY_FAIL
T02: mktemp -d    exitCode=1, stderrClass=kernel-eperm  -> COMPATIBILITY_FAIL
```

Earlier rounds in the interactive ClineMM UI saw `mktemp` blocked
at the command-policy layer BEFORE the kernel was reached. The
direct production sandbox lane now reaches the kernel and gets
EPERM. Two independent limitations:

```
interactive ClineMM UI:   mktemp blocked at command-policy layer (pre-sandbox)
direct production seam:   mktemp reaches Seatbelt, kernel EPERM (sandbox layer)
```

Both are real. The next ACT should resolve the sandbox-layer
limitation (private writable temp root bound to $TMPDIR).

### G07 -- git config --get user.name (COMPATIBILITY_FAIL)

```
G07: git config --get user.name   exitCode=1, stdout=""  -> COMPATIBILITY_FAIL
```

The dev shell used by C2 has no global `user.name` configured.
NOT a sandbox issue. P1, no C2 reopen.

### F03 / F04 -- fixture/cwd ambiguity (TOOL_MISSING, ambiguous)

```
F03: rg SandboxBackend sdk apps         exitCode=2 -> TOOL_MISSING
F04: find sdk -maxdepth 2 -type d       exitCode=1 -> TOOL_MISSING
```

The C2 driver ran from cwd `apps/vscode/`, but these commands
treat `sdk` and `apps` as repo-root-relative paths. From cwd
`apps/vscode/` they don't resolve. The classifier reports
`TOOL_MISSING` because it conflates "no such file/path" with
"executable missing"; the actual `rg` and `find` binaries are
present and runnable.

Freeze as `CLASSIFICATION_AMBIGUOUS` (likely fixture/cwd error).
P1, no C2 reopen. A successor ACT may either fix the fixture
paths to be CWD-relative (`apps/vscode/sdk`, `apps/vscode/apps`)
or split the classifier's `TOOL_MISSING` rule by exit code.

### POLICY_LANE = NOT_EXECUTED

`policy-matrix.tsv` contains only the header. The C2 driver did
NOT supply an `evaluatePolicy` callback, so the policy lane was
not exercised. This is NOT "every command had neutral policy" --
it is "the policy lane was not run". Record as
`POLICY_LANE = NOT_EXECUTED`. Separate live command-policy
observations from earlier ACTs (`ACT-CLINEMM-COMMAND-RISK-V2-*`)
remain your authoritative evidence for the policy lane.

### S02 -- deadline termination NOT OBSERVED

```
S02: state="running"  exitCode=null  durationMs=505
     classification=PASS (because expected="informational" auto-passes)
```

The S02 probe spawned a long-running sleep, the runner returned
after its bounded wait budget (505 ms), and the classifier
auto-passed it as `informational`. This dogfood row therefore
proves only that the bounded wait returned while the job was
still running. It does NOT prove that the host would have
issued `deadline_exceeded` if the runner had waited longer. The
C3 production integration tests in
`command-job-manager.sandbox-c3-real-kernel.test.ts` are the
authoritative evidence for supervision/deadline conservation.
Do NOT upgrade S02 beyond "wait budget returned while running".

(S01 is also `informational` and similarly does not assert
stdout/stderr conservation on its own.)

## Evidence bundle (gitignored, local-only)

```
apps/vscode/.factory/evidence/ACT-CLINEMM-MACOS-SEATBELT-DOGFOOD-AUTOMATED01/
  probe-results.jsonl   13868 bytes  31 per-probe results with classification + raw observations
  summary.json            331 bytes  run summary (p0Fail=0, causalPairFail=0, p0Halted=false)
  policy-matrix.tsv        34 bytes  header only -- POLICY_LANE = NOT_EXECUTED
  scratch-1787689749659/    empty    C2 cleanup removed it after writeRunArtifacts
```

## Files (production, committed)

```
apps/vscode/src/dev/dogfood/.gitignore
apps/vscode/src/dev/dogfood/dogfood-c2-driver.ts
apps/vscode/src/dev/dogfood/seatbelt-dogfood-manifest.ts
apps/vscode/src/dev/dogfood/seatbelt-dogfood-runner.ts
apps/vscode/src/dev/dogfood/seatbelt-dogfood-runner.test.ts
apps/vscode/vitest.config.ts   (modified: include dogfood tests)
.factory/epic-board.md          (modified: C1/C2/C3 rows)
```

## Removal trigger (TEMPORARY harness)

The c1-closure.md documents that `apps/vscode/src/dev/dogfood/`
is a TEMPORARY diagnostic suite meant to be removed after the
dogfood matrix closes. The matrix has closed with `p0Fail=0`.
The runner may now be removed as part of the C3 cleanup:

```bash
git rm -r apps/vscode/src/dev/dogfood/
# apps/vscode/vitest.config.ts had only a +1 include line; restore prior config
```

A successor ACT that wishes to graduate the harness into a
maintained sandbox conformance suite must come with a fresh
scope review (per c1-closure.md "Why DEFAULT_OFF").

## Next-ACT candidate (evidence-driven, NOT speculative)

```
ACT-CLINEMM-COMMAND-SANDBOX-TEMP-CAPABILITY01
```

Both `mktemp` and `mktemp -d` have REAL_PRODUCTION_SEAM evidence
of failure. Design a private writable temp root, bind `TMPDIR`
to it, prove host `/tmp` remains unavailable except through that
canonical root, then re-run the dogfood manifest as an ablation
on T01/T02. Expected outcomes:

```
T01/T02:  EXPECTED_DENY (kernel EPERM on /tmp)        BEFORE
T01/T02:  PASS (write succeeds via $TMPDIR)            AFTER  (if the private root is wired)
```

Address Git/global-config (G07) and rg/find fixture-cwd (F03/F04)
separately, on their own evidence.

## Trust state

```
C1_HEAD    = 4cef3d59c5e4d9ea4901a4d3efb5f0e4a3c029db  (committed; 54/54 vitest pass + C2 driver + .gitignore)
C1_TREE    = 7f42e00d1a651ed450e9e75237024ce6162299fa
C2_HEAD    = cf0896d4c                                 (committed; verdict/closure)
DOGFOOD_SUBJECT_HEAD = 4cef3d59c...                    (captured at run time by G05)
DOGFOOD_SUBJECT_TREE = 7f42e00d1a...
branch     = main
origin/main = unchanged
NOT pushed
```

Verdict: PASS_SEATBELT_DOGFOOD_WAVE1 CLOSED_CLEAN.
