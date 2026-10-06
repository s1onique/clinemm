# ACT-CLINEMM-TESTBED-TART-P1-SUBSTRATE01

**Status:** CLOSED
**Date:** 2026-10-06
**Subject HEAD:** (new package at `tools/tart-testbed/`; no production code changed)

---

## VERDICT

**PASS_CLINEMM_TART_TESTBED_SUBSTRATE**

This ACT shipped a reusable, non-interactive Tart testbed substrate for
ClineMM Factory ACTs. The bulk of the executable proof comes from the
`FakeTestbedBackend` + `FakeProcessRunner` test suite — no real VM is
launched at closure, satisfying the substrate ACT's "no LIVE claim"
invariant.

```
PASS_CLINEMM_TART_TESTBED_SUBSTRATE
+ 70/70 tests green (5 files: argv-construction, ssh-argv, vm-identity,
   host-classification, fake-backend)
+ typecheck (tsc --strict, noUncheckedIndexedAccess) GREEN
+ structural Tart smoke: `tart --version` (2.34.0) via RealProcessRunner - no VM
+ git diff --check: clean
+ no VSIX built, no LIVE claim, no operator dependency
```

---

## PURPOSE

Create a reusable, scenario-agnostic Tart testbed substrate for ClineMM
Factory ACTs. The substrate provides:

```text
test specification
  -> acquire disposable Tart VM
  -> start VM (async - no forever-block)
  -> wait for IP_AVAILABLE -> SSH_AVAILABLE -> READY (bounded)
  -> execute bounded commands (argv-only)
  -> optionally copy artifacts out (SHA + size recorded)
  -> ALWAYS tear down disposable VM (every exit path)
  -> emit machine-readable run evidence
```

Future ACTs (TART-CLINEMM-DOGFOOD01, TART-MYC-SESSION-ISOLATION01,
TART-ELM-TASKHEADER-LIVE01) compose on top of this substrate.

---

## RECON (C0)

| Question | Finding |
|---|---|
| Existing Tart substrate? | YES - `tools/macos-vsix-testbed/` is tightly coupled to VSIX qualification (5-arg fixed entry, specific error envelopes, fail-closed pinned-image contract). NOT reusable as-is. |
| Implementation language | **TypeScript + bun** (one language - frozen per C0). |
| Subprocess abstraction | None repo-wide. ProcessRunner introduced as DI seam (C18). |
| JSON result schema | None. TestbedResult introduced (C13). |
| Dogfood artifact discovery | None reusable. Substrate emits `.factory/testbed-runs/<run-id>/result.json` (C13). |
| SSH logic | Tightly coupled to VSIX image pin. New pure `ssh-argv.ts` helper. |
| Testbed location | `tools/tart-testbed/` (new package; does NOT compete with `tools/macos-vsix-testbed/`). |

Decision: build a **NEW scenario-agnostic substrate** in
`tools/tart-testbed/` (NOT refactor the existing
`tools/macos-vsix-testbed/`). The latter remains the
VSIX-qualification-specific runner with its fail-closed CORRECTION03
pins.

## Deliverable

```
tools/tart-testbed/
  package.json                    (ESM, bun, TypeScript 5.6)
  tsconfig.json                   (strict, noUncheckedIndexedAccess)
  README.md                       (architecture, hard invariants, successors)
  bin/clinemm-testbed             (shell entrypoint)
  src/
    types.ts                    (TestbedSpec/Result, error codes, HostClassification)
    process-runner.ts           (ProcessRunner + Real + Fake)
    vm-identity.ts              (collision-resistant naming + ownership)
    host-classification.ts      (pure classifyHostPure - no I/O)
    tart-cli.ts                 (pure argv construction - C3, C17)
    ssh-argv.ts                 (pure ssh argv + shell quoting)
    backend.ts                  (TestbedBackend interface - C2)
    tart-backend.ts             (real TartBackend, argv-only)
    fake-backend.ts             (FakeTestbedBackend, deterministic)
    testbed.ts                  (TestbedOrchestrator - wires everything)
    cli.ts                      (run / validate / doctor)
    index.ts                    (public exports)
  tests/
    argv-construction.test.ts   (15 tests - C3, C17)
    ssh-argv.test.ts            (11 tests - C7, C8)
    vm-identity.test.ts         (10 tests - C4)
    host-classification.test.ts (5 tests - C15)
    fake-backend.test.ts        (29 tests - C16 suite of 25 + extras)
```

70 tests across 5 files. 170 expect() calls. ~33ms wall-clock.

## Success Criteria Checklist

| Criterion | Status |
|---|---|
| one testbed CLI exists | OK `./bin/clinemm-testbed` |
| one backend interface exists | OK `TestbedBackend` in `backend.ts` |
| Tart backend exists | OK `TartBackend` in `tart-backend.ts` |
| fake backend exists | OK `FakeTestbedBackend` in `fake-backend.ts` |
| ProcessRunner is injectable | OK `RealProcessRunner` + `FakeProcessRunner` |
| VM ownership is explicit | OK `vmOwnedByRun` structural check (C4) |
| non-owned VM deletion fails closed | OK test 22 + `TESTBED_VM_OWNERSHIP_UNPROVEN` code |
| startup is asynchronous | OK `tart run` bounded via timeoutMs (C6) |
| IP + SSH readiness are bounded | OK `ipReadyMs`/`sshReadyMs` deadlines (C7) |
| remote commands return structured results | OK `CommandRecord` (C8) |
| artifact collection records size + SHA | OK test 13 (C10) |
| teardown runs on all normal failure paths | OK tests 14, 15, 16 (C11) |
| primary failure survives teardown failures | OK test 19 (C11) |
| keep-vm is explicit and default-off | OK test 20 (C12) |
| result.json is emitted | OK `.factory/testbed-runs/<run-id>/result.json` |
| unsupported hosts classify cleanly | OK tests in `host-classification.test.ts` (C15) |
| no shell interpolation exists | OK tests in `argv-construction.test.ts` (C3) |
| focused tests all green | OK 70/70 |
| type/lint gates green | OK `tsc --noEmit` clean |
| git diff --check green | OK clean |
| no Tart VM launched | OK only `tart --version` (structural smoke) |
| no VSIX built/installed | OK N/A - substrate |
| no LIVE claim made | OK explicitly NOT LIVE - substrate |

## Hard-Rule Adherence (C3, C4, C11, C13)

- Argv-only: every subprocess call uses argv arrays. No `shell:true`.
  Hostile input like `"foo; rm -rf /"` or `"$(evil)"` stays as ONE
  argv element. Verified by
  `argv-construction.test.ts > tart-cli argv never embeds shell
  metacharacters as separate elements`.
- VM ownership: `vmOwnedByRun` does a structural substring check
  against the runId. Test 22 confirms non-owned VMs trigger
  `TESTBED_VM_OWNERSHIP_UNPROVEN`.
- Teardown-first: the orchestrator's `runTeardown` runs on every
  exit path. Test 19 confirms primary failure is preserved when
  teardown fails.
- No-secret-result: test 24 explicitly asserts the result JSON
  contains no private-key contents, env, or raw path strings.

## Non-Goals (confirmed NOT done)

- No myc LIVE qualification
- No ClineMM install
- No VSCodium automation
- No custom macOS image
- No Tart base-image production
- No CI workers added
- No Chamber integration
- No Lima/Qemu/Docker backends
- No nested virtualization
- No generalized cloud abstraction
- No operator interaction required

## Follow-up ACTs (not part of this closure)

After this substrate lands, the operator can move small ACTs off
manual qualification:

```
TART-CLINEMM-DOGFOOD01         install exact VSIX, launch ext host, collect logs
TART-MYC-SESSION-ISOLATION01   two real ClineMM sessions, separate myc children
TART-ELM-TASKHEADER-LIVE01    exercise Task Header, invoke diagnostics command
```

Each will compose on `TestbedOrchestrator` without modifying the substrate.

```
bun test tests/                # 70/70 pass, 0 fail
bunx tsc --noEmit -p tsconfig.json   # clean
git diff --check               # clean
./bin/clinemm-testbed doctor   # darwin-arm64 + tart + ssh -> supported
./bin/clinemm-testbed validate /tmp/tart-spec.json  # {"ok":true}
./bin/clinemm-testbed run /tmp/tart-spec.json --backend fake --out /tmp/x   # PASS, result.json written
```

## Status

**PASS_CLINEMM_TART_TESTBED_SUBSTRATE**

The substrate is ready for the successor ACTs. No blocker, no further
correction needed.
