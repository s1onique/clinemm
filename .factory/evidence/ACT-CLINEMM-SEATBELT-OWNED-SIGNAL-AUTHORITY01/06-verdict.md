# ACT-CLINEMM-SEATBELT-OWNED-SIGNAL-AUTHORITY01 — Verdict

## Verdict

**NO_REPAIR_REQUIRED_AT_CLINE_SEATBELT_PROFILE**

The hypothesis that `(allow signal (target self))` in
`sdk/packages/core/src/runtime/sandbox/macos/seatbelt-profile.ts:700`
is the cause of orphaned ClineMM-owned `node` processes is REFUTED.

## Live evidence summary

### 1. The substrate DOES deny signal delivery — but at the HOST layer, not the ClineMM profile layer.

Reproduction (run from inside the VSCodium Helper (Plugin) extension
host that is hosting Cline — same substrate as production):

```text
PARENT_PID=76640
PARENT_PPID=25108 (VSCodium Helper (Plugin) --enable-sandbox ...)
CHILD_SPAWNED pid=76644 (detached, own pgid)
PROBE_PGID_0=ERR_EPERM
KILL_PGID_SIGTERM=ERR_EPERM
PROBE_PGID_0_AFTER_TERM=EXISTS_DENIED_EPERM
KILL_PGID_SIGKILL=ERR_EPERM
PROBE_PGID_0_AFTER_KILL=EXISTS_DENIED_EPERM
PS_PGID_MATCH_COUNT=1   ← child survived

### 2. The denial layer is Chromium's `--enable-sandbox`, not ClineMM's Seatbelt.

T1 (host vs unsandboxed detached child):
```text
PROBE_BEFORE=EXISTS_DENIED_EPERM
KILL_PGID_SIGTERM=ERR_EPERM
KILL_PGID_SIGKILL=ERR_EPERM
CHILD_OUTPUT_AFTER_TERM="READY\nALIVE\nALIVE\nALIVE\nALIVE\n..."   ← child kept running
```
The child is `node -e ...` with no Seatbelt profile at all. Only
authority parent is the Chromium-sandboxed VSCodium Helper. The kernel
still denies signal delivery.

T2 (child-of-host tries to signal its own grandchild):
```text
CHILD_KILL=ERR_EPERM
PROBE=GONE_EPERM
```
Even from the child shell (not the host), `kill(-grandchild_pgid,
SIGKILL)` returns EPERM. The denial is inherited from the
Chromium-sandboxed parent.

### 3. The "leaked node processes" in the user's screenshot are NOT ClineMM-owned.

Process-tree capture:
```text
PID     PPID  PGID     ELAPSED  COMMAND
24389   1     24389    01-23:49 VSCodium main
25108   24389 24389    01-23:49 VSCodium Helper (Plugin) ... --service-sandbox-type=none ← Cline extension host
27751   25108 24389    01-23:48 jsonServerMain (VS Code's JSON LS, PPID=25108 but joined VSCodium main PGID via setsid)
```

Every long-running `node`/`VSCodium Helper` process is either:
  (a) A direct child of PID 24389 (VSCodium main) with PGID 24389.
      Language servers / renderers / GPU processes that VSCodium
      spawned when launching the window. Cline has no authority
      over them.
  (b) PID 27751 (jsonServerMain) — a child of Cline's extension
      host (PPID 25108) but its PGID is 24389 (main VSCodium PGID,
      joined via setsid). It is VS Code's bundled JSON language
      server, not a ClineMM-spawned process.

There are NO long-running detached children of bash.ts:917 in the
current process tree. The "leakage" symptom is the VSCodium process
population, which Cline has no ownership over.

## Why `(allow signal (target self))` is NOT the cause

Seatbelt's `(allow signal ...)` rule governs OUTGOING signals from
the sandboxed process. The child shell is the sandboxed process. With
`(allow signal (target self))`, the child shell can signal itself
(e.g. for `setpgid`) but NOT its own descendants.

The HOST (Node parent, NOT under ClineMM Seatbelt) has its own signal
authority, gated by:
  - The host's own sandbox profile (Chromium `--enable-sandbox` here,
    or the ClineMM host-helper sandbox in production).
  - macOS process / session boundaries.

In this substrate, the host is Chromium-sandboxed, which denies
`kill(-pgid, ...)` outright. Changing the ClineMM Seatbelt profile
does not affect the host's signal authority, because the host is not
under the ClineMM profile.

## Why target-self → target-same-sandbox would NOT fix this

Even if we change the profile, the resulting profile governs:
  - The CHILD shell's outgoing signal authority, NOT the host's.
  - It would only matter if the child shell needed to signal its
    OWN children/grandchildren.

But:
  1. In the current production code (bash.ts:917 + terminateTree),
     the HOST does all the signal work. The child shell's signal
     authority is unused.
  2. In this substrate, the ClineMM profile is NEVER APPLIED to the
     child shell at all (sandbox-exec cannot apply under Chromium
     --enable-sandbox). So changing the profile has zero effect on
     this substrate.
  3. The leak in the user's screenshot is NOT ClineMM-owned
     processes — it is VSCodium's own children.

## Recommendation

**Do not change `seatbelt-profile.ts:700` from
`(allow signal (target self))` to `(allow signal (target same-sandbox))`.**

The evidence shows:
  - The proposed fix does not address the live symptom.
  - The proposed fix is unnecessary for the current production
    architecture (host does all signal work).
  - The proposed fix would marginally widen the child's authority
    without any compensating test coverage for the new capability.
    The current `(target self)` is the documented least-authority
    form and matches the prior ACT's closure posture.

If a future ACT identifies a real code path where the child shell
must signal its own descendants, that ACT should add the
`same-sandbox` rule **and** a focused test that proves the child
can manage its own tree without affecting foreign processes.

## Files
- `01-live-repro.cjs`            : the live EPERM reproduction
- `02-live-repro.out`            : full output of the live reproduction
- `03-clinemm-process-tree.txt`  : snapshot of ClineMM-related processes
- `04-discriminator.out`         : T1 (host vs unsandboxed child)
- `04-t2-standalone.out`         : T2 (child signals grandchild)
- `05-current-sbpl-excerpt.txt`  : the line under examination, unchanged
- `06-verdict.md`                : this file


RED: BOTH SIGTERM AND SIGKILL BLOCKED
```

The child is a plain Node child spawned with `spawn({detached: true})`.
No ClineMM Seatbelt profile is applied (sandbox-exec cannot apply in
this substrate — `sandbox_apply: Operation not permitted`).
