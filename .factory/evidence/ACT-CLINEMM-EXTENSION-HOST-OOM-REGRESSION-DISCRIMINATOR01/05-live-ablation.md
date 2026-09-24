# ACT-CLINEMM-EXTENSION-HOST-OOM-REGRESSION-DISCRIMINATOR01 / CORRECTION01 — Live Specimen Readiness

## Status: READY_FOR_OPERATOR_RUN

This ACT's code-level discriminators (AB-DELIVERY-01, AB-DELIVERY-02,
AB-ATTEST-01, and the expected RED on CCARD-WIRE-01) are verified. The
ablation seam is wired and select-able by env var. The live specimen
must be run by a human operator (per ACT §8) using the same
VSCodium/Electron runtime, sandbox, and proxy/env shape used for the
historical BAD=99006fbcc reproduction.

## Frozen SUBJECT_HEAD and bundled VSIX

This dev environment built ONE dogfood VSIX from SUBJECT_HEAD and
recorded its identity below. The operator MUST install this VSIX
unchanged for BOTH the ABLATED and RESTORED specimens — the ablation
is selected entirely at launch time by the env var
`CLINEMM_OOM_DISC01_ABLATE_DELIVERY`. No rebuild between specimens.

| Field          | Value                                                                            |
|----------------|----------------------------------------------------------------------------------|
| SUBJECT_HEAD   | `2edd62498` (`2edd6249855b4413b3a45da3717176958dbcf31c`)                          |
| Version        | `4.1.16`                                                                          |
| VSIX path      | `/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/dist/dogfood/clinemm-4.1.16-2edd62498.vsix` |
| VSIX size      | `14627848` bytes (~13.95 MB)                                                     |
| VSIX sha256    | `fa7e3ae6eb36a779c345f0a55f88e3cc60c74c06b628483ce203b110ccb24bdd`              |
| Built via      | `vsce package` (manually invoked, sandbox workaround)                            |
| Env vars at build | `CLINEMM_OOM_DISC01_SUBJECT_HEAD=2edd62498`                                    |
| Bundled identity confirms | bundle contains: `CLINEMM_OOM_DISC01_ABLATE_DELIVERY` runtime lookup, `CLINEMM_OOM_DISC01_SUBJECT_HEAD` define, `CLINEMM_OOM_DISC01_ATTEST` line marker |
| Package files  | 52 (verified via vsce output)                                                    |

## Live specimen execution contract

The operator must execute the following in sequence. **The same VSIX
bytes are used for both specimens** — only the env var toggle changes.

### Step 1 — Install the bundled VSIX

```bash
# Record the SHA-256 BEFORE install; verify the installed extension
# has the same hash after install:
sha256sum /path/to/clinemm-4.1.16-2edd62498.vsix
# expected: fa7e3ae6eb36a779c345f0a55f88e3cc60c74c06b628483ce203b110ccb24bdd
```

Use the same VSCodium install path as the historical
BAD=99006fbcc reproduction. Record:
- VSIX path
- installed extension path/version (expected: `s1onique.clinemm 4.1.16`)
- installed extension SHA-256 (must match the VSIX sha256)

### Step 2 — Run the ABLATED specimen

Set the ablation env var before launching VSCodium:

```bash
CLINEMM_RUNTIME_PROFILE=dogfood \
CLINEMM_PTAD=1 \
CLINEMM_OOM_DISC01_ABLATE_DELIVERY=1 \
DISPLAY=:1 \
./scripts/install-vscodium-dev.sh --isolated-userdata
```

Do NOT enable:
- CLINEMM_DIAG_CPU_PROFILE
- CLINEMM_DIAG_ALLOCATION_PROFILE

(unless already required by the frozen specimen contract).

Run the same background-workload command used for the historical
BAD=99006fbcc reproduction. Run for at least 150 s, or the existing
live-capture helper's bounded duration, whichever is longer.

### Step 3 — Capture positive attestation

When the Extension Host starts, it emits ONE line to stderr with this
exact shape:

```
[CLINEMM_OOM_DISC01_ATTEST] subject=<sha|unknown|unset> ablation_active=true|false env_present="1"|<unset> eh_pid=<int> ppid=<int|unknown> constructed_at=<ISO>
```

For the ABLATED specimen, expect:
- `subject=2edd62498` (the SUBJECT_HEAD baked into the bundle)
- `ablation_active=true`
- `env_present=1`
- `eh_pid=<PID of the Electron extension host process>`

Capture this line. Verify `eh_pid` matches the recorded Extension Host
PID. If `subject=<runtime-unset>`, the build did NOT inline the
SUBJECT_HEAD — STOP, do NOT proceed (the SUBJECT_HEAD identity is
broken).

### Step 4 — Capture the run

For each run record:
- source SUBJECT_HEAD (= `2edd62498`)
- VSIX path + sha256 (`fa7e3ae6eb36a779c345f0a55f88e3cc60c74c06b628483ce203b110ccb24bdd`)
- installed extension path/version
- Electron Framework UUID (if available from the established
  environment; otherwise record `<not available>`)
- Extension Host PID + the `[CLINEMM_OOM_DISC01_ATTEST]` line bound to
  that PID (this is the positive attestation)
- start/end timestamps
- main.log relevant lines
- renderer.log relevant lines
- matching DiagnosticReport path + sha256 if crash occurs

### Step 5 — Classification

If native OOM still reproduces under ablation:
- classification = **PASS_DELIVERY_PROPAGATION_REFUTED**
- repair_authorized = **false**
- successor discriminator = CCARD activation/instrumentation as a whole

If Extension Host survives the full window under ablation:
- classification = **H1_NECESSITY_CANDIDATE** (one surviving run
  is sufficient to justify RESTORATION testing, but NOT sufficient
  to authorize repair)
- proceed to Step 6

If crash occurs but does NOT match the same native class
(EXC_BREAKPOINT / SIGTRAP, code 5, VSCodium Helper (Plugin),
PartitionAlloc/V8 fatal OOM):
- classification = **CAPTURE_INSUFFICIENT** or
  **HALT_RED_NOT_REPRODUCED**
- Do not count as reproduction; do not proceed to Step 6.

### Step 6 — RESTORE the propagation (no rebuild)

The same VSIX is used for both specimens. To switch from ABLATED to
RESTORED, simply unset the env var at the next launch:

```bash
unset CLINEMM_OOM_DISC01_ABLATE_DELIVERY
# Verify env is gone: printenv | grep CLINEMM_OOM_DISC01_ABLATE_DELIVERY
# (must return nothing — if it returns, the env leaked)
```

The VSIX sha256 MUST NOT change between specimens — the operator
should re-record sha256 from the on-disk VSIX to confirm.

After launch with the env var unset, expect the attestation line to
show:
- `ablation_active=false`
- `env_present=<unset>`

### Step 7 — Run the RESTORED specimen

Repeat Step 2-4 with the env var unset. Run for the same
duration. Record identical fields.

### Step 8 — Classification (RESTORE outcome)

| ABLATED | RESTORED | Verdict |
|---------|----------|---------|
| survives | reproduces same native OOM | **PASS_DELIVERY_PROPAGATION_NECESSARY_FOR_OOM** (repair_authorized=true) |
| survives | also survives | **NOT_REPRODUCED** (repair_authorized=false) |
| crashes | (no restoration needed) | **PASS_DELIVERY_PROPAGATION_REFUTED** (repair_authorized=false) |

## Why this ACT did not perform the live specimen

This ACT was run in a development environment without the
operator-required infrastructure (VSCodium, isolated user-data dir,
Nix wrapper). The ACT's discriminating power at the code level is
complete:
- AB-DELIVERY-01 proves the ablation does what it claims
- AB-DELIVERY-02 proves the production path is preserved
- AB-ATTEST-01 proves the positive attestation is emitted and
  parseable, bound to the live process PID
- The expected RED on CCARD-WIRE-01 proves the ablation is
  observing the same field-removal CCARD-WIRE-01 originally protected
- The bundled VSIX contains the runtime lookup of
  `process.env.CLINEMM_OOM_DISC01_ABLATE_DELIVERY`, the inline of
  `CLINEMM_OOM_DISC01_SUBJECT_HEAD`, and the `[CLINEMM_OOM_DISC01_ATTEST]`
  line marker (verified by grepping the bundled extension.js)
- The bundled VSIX sha256 is recorded for byte-identical ABLATED/RESTORED
  specimens

The live specimen is the necessary next step to convert the code-level
necessity proof into a production-OOM necessity proof. The execution
contract above is complete and unambiguous.

## Files ready for the live specimen

```
sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts        # ablation seam installed
sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.test.ts # AB-DELIVERY-01 + AB-DELIVERY-02 + AB-ATTEST-01 added
apps/vscode/esbuild.mjs                                                   # CLINEMM_OOM_DISC01_SUBJECT_HEAD define wired
dist/dogfood/clinemm-4.1.16-2edd62498.vsix                                # BUILT ONCE, used for both ABLATED and RESTORED
```

All files compile clean. All tests pass: 15/15 in production mode,
14/15 + 1 expected RED on CCARD-WIRE-01 in ablation mode.

## Focused test gate results

| Gate | Mode | Result |
|------|------|--------|
| pending-prompt-service.test.ts | production | 15/15 PASS, exit 0 |
| pending-prompt-service.test.ts | ablation | 14/15 PASS + 1 expected RED (CCARD-WIRE-01), exit 1 |
| sdk/core typecheck | n/a | 0 new errors in touched files (67 pre-existing errors in unrelated files) |
| apps/vscode typecheck | n/a | exit 0, clean |
| git diff --check | n/a | clean |
| vitest-pool worker termination | both | `EPERM: operation not permitted, kill` observed on the worker shutdown, but the suite exit code is consistent with the assertion result (0 for all-pass, 1 for any-fail). This is a sandbox/worker-shutdown quirk, NOT an assertion result. Operator-run live specimen is unaffected. |

## Halt conditions evaluated (CORRECTION01)

| Halt | Status |
|------|--------|
| HALT_VSIX_BYTES_DIFFER_BETWEEN_SPECIMENS | NOT TRIGGERED (single VSIX built once; env var toggled at launch) |
| HALT_SUBJECT_HEAD_NOT_BAKED_INTO_BUNDLE | NOT TRIGGERED (verified via grep on extracted extension.js: `CLINEMM_OOM_DISC01_SUBJECT_HEAD` define, `CLINEMM_OOM_DISC01_ABLATE_DELIVERY` runtime lookup, `CLINEMM_OOM_DISC01_ATTEST` line marker all present) |
| HALT_ATTESTATION_NOT_EMITTED | NOT TRIGGERED (AB-ATTEST-01 verifies emission from the controller constructor) |
| HALT_QUEUE_STEER_SEMANTICS_ALTERED | NOT TRIGGERED (only the conditional spread of `next.delivery` is touched; all other forwarding preserved per AB-DELIVERY-02) |
| HALT_VITEST_EPERM_TREATED_AS_ASSERTION_FAILURE | NOT TRIGGERED (separately characterized: worker-shutdown EPERM is sandbox-related, not assertion-related; suite exit code matches the assertion result) |
