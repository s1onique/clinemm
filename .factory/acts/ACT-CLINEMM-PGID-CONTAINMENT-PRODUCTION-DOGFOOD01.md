# ACT-CLINEMM-PGID-CONTAINMENT-PRODUCTION-DOGFOOD01

**Primary epistemic purpose:** `LIVE_VALIDATION`

**Status:** `HALT_PRODUCTION_SEAM_NOT_DRIVABLE_FROM_SHELL` (new halt taxonomy entry; structurally
analogous to `HALT_DOGFOOD_BUILD_NOT_SUBJECT`).

**Authorization:** `C1: GO.`

## 0. Identity

- ACT family: descendants / process-containment / production dogfood.
- Predecessors (frozen, not re-litigated):
  - `ACT-CLINEMM-PGID-CONTAINMENT-PRODUCT-CONTRACT01` — contract `CLEAN_TERMINAL CommandJob ⇒
  PRIMARY OWNED PGID GONE` is the contract under test.
  - `ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01` (correction07) — gauge / state
  machine / incident semantics are the surfaces under test.
  - `ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01` — installed helper architecture is the
  termination authority under test.
  - `ACT-CLINEMM-LAUNCHAGENT-OWNED-PGID-LIVE-QUALIFICATION01[-CORRECTION01]` — LIVE PGID
  qualification inherited.
- Reviewers: ClineMM runtime engineer, macOS process-control engineer, Factory reviewer.

## 1. What this ACT is

> Does the freshly installed production helper, when driven by the real production Codium-ClineMM
> command path, cleanly terminate ordinary non-daemonizing process trees and project the correct
> live telemetry?

Two cases on real same-PGID trees (cooperative + TERM-resistant), driven through the real
Codium-ClineMM chat/tool path (not a Vitest fixture, not a manually-launched shell), with the
real installed helper as termination authority.

## 2. Why this ACT halted

The ACT body §2 says:

> If the running Codium build cannot be tied to the code containing the latest changes:
> `HALT_DOGFOOD_BUILD_NOT_SUBJECT`. Do not continue using a stale installed extension.

§5 says:

> From the actual Codium-ClineMM chat/tool path, instruct the running product to start:
> `.factory/tmp/.../same-pgid-tree.sh`. It must become a real background `CommandJob`, not a
> shell launched manually from Terminal and not a Vitest fixture.
> `COMMAND_PATH = REAL | LIVE | REAL_PRODUCTION_SEAM`

§11 says:

> Drive it through the same real Codium-ClineMM tool path.

The only programmatic production seam that drives the ClineMM tool path from a shell is the
debug harness (`apps/vscode/src/dev/debug-harness/server.ts`, port 19229, `ui.send_message`
posts a `cline.TaskService.newTask` gRPC message into the running webview's exposed
`window.__clineVsCodeApi`).

In this run, the user directive explicitly forbids launching the debug harness. The other
path (a human typing into the ClineMM webview) is not available in this shell-driven
workflow. Therefore §5 cannot be satisfied by any agent — it requires either human UI
interaction or the forbidden harness.

This is **NOT** a code defect. The production build IS the subject
(`clinemm-4.1.16-84a238464 == repo HEAD 84a238464`). The helper IS bound (PID 47013, healthy
socket, build_id present). All §1-§4 prerequisites PASS. §5 halts on a structural constraint.

A new halt taxonomy entry is honestly recorded:

```
HALT_PRODUCTION_SEAM_NOT_DRIVABLE_FROM_SHELL
  = ACT §5 cannot be satisfied from this shell
    because the only programmatic production seam (debug harness) is forbidden
    and the only other path (human UI interaction) is outside this shell.
  Structural analog of HALT_DOGFOOD_BUILD_NOT_SUBJECT (§2).
```

## 3. What WAS verified (entry-side passes)

| Gate                                       | Evidence                                                   | Verdict |
| ------------------------------------------ | ---------------------------------------------------------- | ------- |
| `ENTRY_CLEAN`                              | `00-entry.txt` — clean working tree, unexpected dirt = 0    | PASS    |
| `INSTALLED_HELPER_IDENTITY_BOUND`          | `01-helper-identity.txt` — PID 47013, build_id present, socket healthy, `gui/501` | PASS |
| `PRODUCTION_CODIUM_IDENTITY_BOUND`         | `02-codium-production-identity.txt` — clinemm-4.1.16-84a238464 matches repo HEAD | PASS |
| Baseline `⎇ 0, ⚠ 0`                       | `03-header-baseline.txt` — helper `active_job_count=0`, `active_client_count=0` | PASS (structured) / webview-header observation UNAVAILABLE |
| `HELPER_RESOURCE_BASELINE_CONSERVED`       | `01-helper-identity.txt` (entry state preserved at halt)   | PASS    |
| `HELPER_REGISTRATION_CONSERVED`            | `01-helper-identity.txt` (`gui/501`, build_id present)     | PASS    |
| `EVIDENCE_BOUND_TO_FINAL_HEAD`             | HEAD frozen at `84a23846477fec081bde6482c518f976245b0f00` (no commits during run) | PASS |

## 4. What was NOT verified (halted before §5)

All `CASE_A_*`, `CASE_B_*`, `PROCESS_NAME_AGNOSTIC`, `NO_GENERAL_PROCESS_SWEEP`,
`FINAL_FIXTURE_STRAGGLERS` gates are PENDING/NA — the fixtures were never built and no
production tool-path invocation was ever attempted.

The pre-existing 11 escape-case nodes + 4 long-horizon-harness nodes from prior ACTs are
**expected tracked dirt** (they are escape-case residuals the bounded invariant
intentionally does not clean, and unrelated harness fixtures). They do not interfere with
PGID probes via identity correlation and are not evidence against any case in this ACT.

## 5. Production qualification verdict

```
PRODUCTION_QUALIFICATION = NOT_QUALIFIED
  halt before production tool-path exercise
  no PGID conservation result was produced by this run
  no telemetry delta was produced by this run
```

## 6. No repair ACT authorized

This is a structural halt, not a code defect. The successor task is not a repair ACT.
Any future attempt at this ACT will hit the same constraint unless one of the following
changes:

1. Human-driven ClineMM webview interaction (manual UI work outside the agent shell).
2. Authorization to launch the debug harness.
3. A new non-debug-harness programmatic seam into the running extension host (a
   Cline-side "trigger command" tool, CLI bridge, or scripting API that bypasses the
   chat UI but is not a debug-only hook).

## 7. What the production-dogfood ACT question is now waiting on

> A future ACT or human run that can drive the production Codium-ClineMM chat/tool path
> from outside the ClineMM webview itself, while the installed helper is the freshly-bound
> `io.clinemm.host-helper` LaunchAgent at `gui/501`, while the installed ClineMM extension
> is `clinemm-4.1.16-84a238464` (HEAD=84a238464), while the bounded invariant
> `CLEAN_TERMINAL CommandJob ⇒ PRIMARY OWNED PGID GONE` holds.

The code is ready for that exercise. The ACT itself cannot proceed without one of the three
enabling changes above.

## 8. STOP rule honored

Per ACT §25: no repair ACT, no launchd-per-command experiment, no Endpoint Security
follow-up, no additional diagnostics ACT. The epic state is unchanged — the previous
`ACT-CLINEMM-PGID-CONTAINMENT-PRODUCT-CONTRACT01` (PASS) and
`ACT-CLINEMM-COMMANDJOB-DESCENDANT-CONSERVATION-TELEMETRY01` (PASS at correction07) remain
the authoritative closures. This ACT did not regress them.

## 9. Evidence packet

```
.factory/evidence/ACT-CLINEMM-PGID-CONTAINMENT-PRODUCTION-DOGFOOD01/
  00-entry.txt                                      (entry freeze)
  01-helper-identity.txt                            (helper: PID 47013, build_id present, socket healthy)
  02-codium-production-identity.txt                 (clinemm-4.1.16-84a238464 == HEAD 84a238464)
  03-header-baseline.txt                            (helper active_job_count=0, active_client_count=0)
  HALT_PRODUCTION_SEAM_NOT_DRIVABLE.txt             (halt rationale + classification)
  40-gates.txt                                      (gate matrix: §1-§4 PASS, §5+ NA)
  result.json                                       (verdict + halt_taxonomy entry)
```
