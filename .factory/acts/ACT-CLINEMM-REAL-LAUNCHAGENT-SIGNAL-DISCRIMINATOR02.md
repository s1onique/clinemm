# ACT-CLINEMM-REAL-LAUNCHAGENT-SIGNAL-DISCRIMINATOR02

> Status: **C1 GREEN — VERDICT A: GUI_LAUNCHAGENT_SIGNAL_ADVANTAGE = PROVEN**
> Classification (reviewer-corrected): TARGET_SPAWN = REAL_PRODUCTION_FUNCTION,
> DIRECT_CANCEL_RED = SYNTHETIC_REAL over PRODUCTION_TERMINATION_PRIMITIVE,
> REAL_COMMANDJOBMANAGER_SEAM = NOT_EXECUTED.

## Question

Does a real gui/<uid> launchd-managed process have signal authority over
the exact ClineMM-owned process group for which codium-clinemm receives
EPERM?

## Answer (single bit)

**YES.** The same PGID 78326 that the sandboxed codium-clinemm substrate
could not signal (EPERM on both SIGTERM and SIGKILL via the EXACT
production primitive at `bash.ts:1029` / `bash.ts:984`) was terminated
cleanly by a real `gui/501` LaunchAgent probe with a single SIGTERM.
No SIGKILL escalation required.

## Honest seam classification

The driver invoked the EXACT production function `spawnSupervisableShellCommand`
at `sdk/packages/core/src/extensions/tools/executors/bash.ts:1550` — the
same function `CommandJobManager.start` calls at
`apps/vscode/src/sdk/command-job-manager.ts:835`. The driver also invoked
the EXACT production termination primitive calls at `bash.ts:1029`
(`process.kill(-childPid, SIGTERM)`) and `bash.ts:984`
(`process.kill(-childPid, SIGKILL)`) — the same calls `terminateTree`
issues.

What the driver did NOT do:
- It did NOT instantiate `CommandJobManager`.
- It did NOT call `CommandJobManager.start` (which would have wrapped the
  primitive in the registered-job state machine — `active` map insertion,
  `terminalPromise`, deadline timer, sandbox integration).
- It did NOT call `CommandJobManager.cancel` (which would have latched
  the termination reason, set `job.terminationPromise`, and called
  `terminateTree` via the registered-job wrapper).
- It did NOT observe `job.process.exit` to confirm the terminal-state
  classification through the registered-job state machine.

Therefore, per the reviewer-corrected classification:

```
TARGET_SPAWN         = REAL | LIVE | REAL_PRODUCTION_FUNCTION
DIRECT_CANCEL_RED    = SYNTHETIC_REAL | PRODUCTION_TERMINATION_PRIMITIVE
REAL_COMMANDJOBMANAGER_SEAM = NOT_EXECUTED
```

The driver is much stronger than a hand-written `child_process.spawn` —
it uses the production spawn options AND the production call sites of
the kill primitive — but it is NOT the registered-job seam. The full
`CommandJobManager.start → registered job → CommandJobManager.cancel →
terminate → runTerminationSequence → terminateTree` chain remains to be
exercised end-to-end; that is the load-bearing test for the next ACT
(`ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01`).

RED (LIVE, captured under the sandboxed substrate):
- `before_cancel_probe`: EPERM
- `sigterm`: EPERM
- `term_probes` (5 within 5000 ms): all EPERM
- `sigkill`: EPERM
- `group_gone_final`: false; `group_survived`: true

## LaunchAgent probe evidence

Operator bootstrapped `io.clinemm.signal-authority-probe02` from an
unsandboxed Terminal (the Cline-side driver cannot bootstrap from inside
the sandbox — substrate-blocked). The probe (a tiny native C binary
taking only `argv[1]=PGID` and `argv[2]=result_path`) ran under
launchd's supervision in `gui/501 [100109]`, uid=501.

Decisive result (`.factory/tmp/.../result.json`):
- `before.rc=0` — group exists, probe can see it
- `term.rc=0` — SIGTERM sent successfully
- `after_term=ESRCH` — group vanished after SIGTERM
- `kill=NOT_NEEDED` — no SIGKILL escalation needed
- `final.rc=-1, errno=3, errno_name=ESRCH` — group confirmed gone

Independent verification: `ps -o pid,ppid,pgid,command -p 78326 -p 78327`
returns empty. The target group is gone.

## Conservation invariants (PASS)

| invariant | result |
|-----------|--------|
| permanent helper never booted out | PASS |
| permanent helper final health | PASS (PID 14133, gui/501, running) |
| repo helper residue | 0 |
| forbidden-command references in operator packet | 0 (only inside the JSON `forbidden` list) |
| production code changes | NONE |
| host helper protocol changes | NONE |
| root/sudo usage | NONE |
| chromium sandbox disable | N/A (no Cline-side change) |

## Authorized successor ACT

`ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01`. Architecture:

```
spawn job
  → register PGID with the singleton helper io.clinemm.host-helper
  → helper returns opaque client/job capability

cancel:
  direct terminateTree()
    │
    ├─ success → done
    │
    └─ EPERM → helper.terminate(capability)
```

**The load-bearing test for the successor ACT is the REAL
CommandJobManager seam** (not just the production primitive):

```
CommandJobManager.start
    ↓
real registered PGID
    ↓
CommandJobManager.cancel
    ↓
direct terminateTree
    ↓ EPERM only
shared gui/501 host helper
    ↓
opaque ownership capability → registered PGID
    ↓
TERM → grace → KILL if needed
    ↓
ESRCH
    ↓
CommandJobManager terminal state
```

**Client isolation is a P0 design invariant**, not optional hardening:
`CLIENT_A_TOKEN` cannot address `CLIENT_B_PGID`. One helper serves
`codium-clinemm`, `codium-roz`, `codium-granele`, ...

No naked PGID API, no arbitrary PID, no arbitrary signal, no shell
command execution on the helper.

## Evidence

`.factory/evidence/ACT-CLINEMM-REAL-LAUNCHAGENT-SIGNAL-DISCRIMINATOR02/`:
- `00-entry.txt` — entry freeze, helper GREEN, substrate identification
- `01-real-command-seam.txt` — driver invocation + RED chain
- `02-real-cancel-red.txt` — captured EPERM in both signals
- `03-pgid-membership.txt` — bounded membership (no foreign processes)
- `04-operator-packet.txt` — substrate split + operator instructions
- `05-launchagent-registration.txt` — launchd-managed verification
- `06-launchagent-signal-result.txt` — decisive result + verdict A
- `07-permanent-helper-conservation.txt` — before/after helper identity
- `08-cleanup.txt` — Terminal-owned cleanup steps + orphan handling
- `09-gates.txt` — full acceptance-contract gate status (with honest seam labels)
