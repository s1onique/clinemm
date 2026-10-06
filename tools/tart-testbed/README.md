# `@clinemm/tart-testbed`

> ACT-CLINEMM-TESTBED-TART-P1-SUBSTRATE01 — reusable, non-interactive Tart testbed substrate for ClineMM Factory ACTs.

## What this is

The smallest reusable execution primitive above the raw `tart` CLI:

```
test specification
  → acquire disposable Tart VM
  → start VM (async, no forever-block)
  → wait for IP + SSH readiness
  → execute bounded commands
  → capture stdout/stderr/exit status
  → optionally copy artifacts
  → always tear down disposable VM
  → emit machine-readable run evidence (`.factory/testbed-runs/<run-id>/result.json`)
```

Scenario-specific concerns (VSIX qualification, myc live-boot-tree logs,
Elm Task Header diagnostics) compose on top of this substrate as
separate ACTs.

This is **infrastructure substrate only**. It does NOT install or
dogfood ClineMM, perform LIVE qualification, exercise UI automation,
or require the operator to provision anything during closure.

## Quick start

```bash
# Run the focused unit suite (70 tests, no VM launched).
bun test tests/

# Type-check.
bunx tsc --noEmit -p tsconfig.json

# CLI smoke (FakeBackend — deterministic, no VM).
./bin/clinemm-testbed run spec.json --backend fake --out /tmp/run-out

# CLI doctor — host readiness report, no VM.
./bin/clinemm-testbed doctor
```

## Architecture

| File | Purpose |
|---|---|
| `src/types.ts` | `TestbedSpec`, `TestbedResult`, `TestbedError`, `HostClassification` |
| `src/process-runner.ts` | `ProcessRunner` interface + `RealProcessRunner` (Bun.spawn) + `FakeProcessRunner` (programmable) |
| `src/vm-identity.ts` | collision-resistant VM names + ownership (`vmOwnedByRun`) |
| `src/host-classification.ts` | `classifyHostPure` — pure, no I/O |
| `src/tart-cli.ts` | pure argv-construction helpers (C3, C17) |
| `src/ssh-argv.ts` | pure ssh argv construction + safe shell quoting |
| `src/backend.ts` | `TestbedBackend` interface (C2) |
| `src/tart-backend.ts` | `TartBackend` — real implementation, argv-only |
| `src/fake-backend.ts` | `FakeTestbedBackend` — deterministic, no VM |
| `src/testbed.ts` | `TestbedOrchestrator` — wires everything together |
| `src/cli.ts` | `run` / `validate` / `doctor` |
| `bin/clinemm-testbed` | shell entry |

## Hard invariants (C3, C4, C11, C13)

- All subprocess calls use argv arrays. No `shell:true`. No template interpolation. Hostile strings stay as one token.
- VM names follow `clinemm-testbed-<specPrefix>-<runId>-<suffix>` and are bounded to 63 chars (POSIX hostname limit).
- `vmOwnedByRun` is structural (substring-of-the-name) — destroying a VM whose name doesn't contain the orchestrator's `runId` segment throws `TESTBED_VM_OWNERSHIP_UNPROVEN`.
- Teardown (stop + delete) runs on EVERY exit path: success, command failure, exception, timeout. Primary failure is preserved over teardown failure.
- `keepVm=true` skips stop/delete and reports `KEEP_VM` (never silently leaks).
- Result JSON contains no secrets, no private keys, no full env. Path-based references only.
- Image refs MUST be `registry/path@sha256:<64-hex>` — no tag drift.

## Non-goals (per ACT spec)

This ACT does NOT:
- run myc LIVE qualification
- install ClineMM into a VM
- automate VSCodium
- provision a custom macOS image
- introduce Chamber / Lima / Qemu / Docker backends
- support nested virtualization
- create a generalized cloud abstraction
- launch Tart VMs at closure

Closure proof comes from the **fake-backend + process-runner suite**
(`bun test tests/`) — no real VM is required.

## Successor ACTs

After this substrate ACT:

```
TART-CLINEMM-DOGFOOD01         install exact VSIX, launch ext host, collect logs
TART-MYC-SESSION-ISOLATION01   two real ClineMM sessions, separate myc children
TART-ELM-TASKHEADER-LIVE01    exercise Task Header, invoke diagnostics command
```

These compose on top of `TestbedOrchestrator` without modifying the substrate.

## License

Internal ClineMM substrate. See repo-level LICENSE for terms.