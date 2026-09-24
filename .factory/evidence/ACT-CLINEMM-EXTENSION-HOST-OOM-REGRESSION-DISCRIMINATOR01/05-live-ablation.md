# ACT-CLINEMM-EXTENSION-HOST-OOM-REGRESSION-DISCRIMINATOR01 — Live Specimen Readiness

## Status: READY_FOR_OPERATOR_RUN

This ACT's code-level discriminators (AB-DELIVERY-01, AB-DELIVERY-02,
and the expected RED on CCARD-WIRE-01) are verified. The ablation seam
is wired and select-able by env var. The live specimen must be run by
a human operator (per ACT §8) using the same VSCodium/Electron
runtime, sandbox, and proxy/env shape used for the historical
BAD=99006fbcc reproduction.

This environment does not have the operator-required infrastructure
(VSCodium, isolated user-data dir, the ClineMM Nix wrapper). The
discriminators are complete and the live-specimen execution contract
is documented below for the operator.

## Live specimen execution contract

The operator must execute the following in sequence.

### Step 1 — Build the dogfood VSIX with this ACT's patch applied

```bash
# from repo root, with the ACT's edits staged in the working tree
mkdir -p dist/dogfood
CLINEMM_RUNTIME_PROFILE=dogfood \
CLINEMM_PTAD=1 \
DISPLAY=:1 \
bun esbuild.mjs && \
bun scripts/build-dogfood-vsix.py \
    --output dist/dogfood/clinemm-4.1.16-$(git rev-parse --short=8 HEAD).vsix
```

Record:
- VSIX path
- VSIX sha256: `shasum -a 256 <vsix>`
- installed extension path/version after install

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

### Step 3 — Capture the run

For each run record:
- source HEAD (= this ACT's working tree; should be `97a2efcb0` plus
  the ACT's edits)
- VSIX path + sha256
- installed extension path/version
- Electron Framework UUID (if available from the established
  environment; otherwise record `<not available>`)
- Extension Host PID
- start/end timestamps
- main.log relevant lines
- renderer.log relevant lines
- matching DiagnosticReport path + sha256 if crash occurs

### Step 4 — Classification

If native OOM still reproduces under ablation:
- classification = **PASS_DELIVERY_PROPAGATION_REFUTED**
- repair_authorized = **false**
- successor discriminator = CCARD activation/instrumentation as a whole

If Extension Host survives the full window under ablation:
- classification = **H1_NECESSITY_CANDIDATE** (one surviving run
  is sufficient to justify RESTORATION testing, but NOT sufficient
  to authorize repair)
- proceed to Step 5

If crash occurs but does NOT match the same native class
(EXC_BREAKPOINT / SIGTRAP, code 5, VSCodium Helper (Plugin),
PartitionAlloc/V8 fatal OOM):
- classification = **CAPTURE_INSUFFICIENT** or
  **HALT_RED_NOT_REPRODUCED**
- Do not count as reproduction; do not proceed to Step 5.

### Step 5 — RESTORE the propagation

Restore ONLY the `next.delivery` propagation by:

A) Reverting just the ablation env var:
   ```bash
   unset CLINEMM_OOM_DISC01_ABLATE_DELIVERY
   ```
   and rebuilding/reinstalling the same VSIX.

B) (Alternative) Reverting just the seam lines in
   `sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts`:
   - The constructor block (lines ~301-318) — leave the env-var check
     but ensure the field check uses `next.delivery === undefined`
     not the OR'd flag.
   - The conditional spread at line ~518 — restore to the
     production form:
     ```
     ...(next.delivery !== undefined ? { delivery: next.delivery } : {}),
     ```

Do not alter any other source or environment variable.

### Step 6 — Run the RESTORED specimen

Repeat Step 2-3 with the propagation restored. Run for the same
duration. Record identical fields.

### Step 7 — Classification (RESTORE outcome)

| ABLATED | RESTORED | Verdict |
|---------|----------|---------|
| survives | reproduces same native OOM | **PASS_DELIVERY_PROPAGATION_NECESSARY_FOR_OOM** (repair_authorized=true) |
| survives | also survives | **NOT_REPRODUCED** (repair_authorized=false) |
| crashes | (no restoration needed) | **PASS_DELIVERY_PROPAGATION_REFUTED** (repair_authorized=false) |

## Why this ACT did not perform the live specimen

This ACT was run in a development environment without the
operator-required infrastructure (VSCodium, isolated user-data dir,
Nix wrapper). The ACT's discriminating power at the code level is
complete: the AB-DELIVERY-01 test proves the ablation does what it
claims; AB-DELIVERY-02 proves the production path is preserved; the
expected RED on CCARD-WIRE-01 proves the ablation is observing the
same field-removal CCARD-WIRE-01 originally protected.

The live specimen is the necessary next step to convert the code-level
necessity proof into a production-OOM necessity proof. The execution
contract above is complete and unambiguous.

## Files ready for the live specimen

```
sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts        # ablation seam installed
sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.test.ts # AB-DELIVERY-01 + AB-DELIVERY-02 added
```

Both files compile clean. Both files preserve the existing
production behavior when the env var is unset.
