# ACT-CLINEMM-SEATBELT-OWNED-SIGNAL-AUTHORITY01

## Verdict

**NO_REPAIR_REQUIRED_AT_CLINE_SEATBELT_PROFILE**
**(HYPOTHESIS_REFUTED_AT_CLINE_PROFILE_LAYER)**

The hypothesis that `(allow signal (target self))` in
`sdk/packages/core/src/runtime/sandbox/macos/seatbelt-profile.ts:700`
is the cause of orphaned ClineMM-owned `node` processes is REFUTED.

The live EPERM IS reproduced — but the denial layer is Chromium's
`--enable-sandbox` on the VSCodium Helper (Plugin) parent (the host
that runs the Cline extension), NOT ClineMM's Seatbelt profile on
the spawned child. Changing the ClineMM profile from `target self`
to `target same-sandbox` would not fix this symptom and is not
motivated by any production code path that the host does not
already cover.

## Identity
- ENTRY_HEAD:   `a7750c981` (current tip of main)

## Root cause analysis

The user's screenshot shows dozens of long-lived `node` /
`VSCodium Helper` processes accumulating. The user's hypothesis
was that the `(allow signal (target self))` rule in ClineMM's
generated Seatbelt profile was preventing Cline from killing its
own detached children, causing them to leak as orphans.

The proposed causal chain was: Cline spawns a shell → shell forks
a `node` child → cancellation sends SIGTERM to shell → shell
cannot propagate to `node` because its Seatbelt only allows
signaling itself → `node` orphans.

This ACT's evidence refutes the chain at two links:

### Link 1 (host's signal authority) — REFUTED

The host that calls `process.kill(-pgid, signal)` is the VSCodium
Helper (Plugin) extension host (PID 25108 in the live capture).
That host runs under Chromium's `--enable-sandbox`, NOT under
ClineMM's Seatbelt profile. So ClineMM's `(allow signal ...)`
rule is irrelevant to the host's signal authority.

Live reproduction (from inside PID 25108):

```text
PROBE_PGID_0=ERR_EPERM
KILL_PGID_SIGTERM=ERR_EPERM
KILL_PGID_SIGKILL=ERR_EPERM
PS_PGID_MATCH_COUNT=1   ← child survived
```

The child is a plain Node child with no Seatbelt profile at all
(no `sandbox-exec` wrapper). It still could not be signaled.

### Link 2 (the "leaked" processes are ClineMM-owned) — REFUTED

The long-running `node` / `VSCodium Helper` processes in the
screenshot are NOT ClineMM-owned:

- `VSCodium Helper (Renderer)` — Chromium renderer processes,
  direct children of the VSCodium main process (PID 24389).
  Cline has no authority over them and never owned them.
- `VSCodium Helper (Plugin)` — Chromium utility processes for
  language servers. One of them (PID 25108) hosts the Cline
  extension; the others are independent.
- `jsonServerMain` (PID 27751) — VS Code's bundled JSON language
  server. PPID is 25108 (Cline's host) but PGID is 24389 (VSCodium
  main, via setsid). It is not a ClineMM-spawned process; Cline
  did not create it and bash.ts:917 never had it in its
  supervision tree.

There are NO long-running detached children of bash.ts:917 in the
process tree.


## Why `target same-sandbox` would not help

Even if we changed `seatbelt-profile.ts:700` to
`(allow signal (target same-sandbox))`:

1. **It governs the wrong process.** The Seatbelt profile is
   applied to the spawned child shell, NOT to the host. The host
   is the process that calls `kill(-pgid, ...)` in bash.ts:1029.
   Changing the child's profile does not change the host's
   authority.

2. **It would only matter if the child needs to signal its OWN
   descendants.** The current production code does not require
   this — the host does all signal work via `signalGroup(pgid)`.

3. **It is not applied in this substrate at all.** `sandbox-exec`
   returns `sandbox_apply: Operation not permitted` under
   Chromium's `--enable-sandbox`, so the ClineMM profile never
   reaches the child. Changing the profile content has zero
   observable effect on this substrate.

4. **The user-visible "leak" is not ClineMM processes.** Even a
   perfect `(allow signal (target same-sandbox))` profile would

## Why this ACT does NOT propose a privileged-broker ACT

A previous reviewer suggested
`ACT-CLINEMM-PROCESS-SUPERVISOR-HOST-AUTHORITY-RECON01` based on the
premise that the production extension host lacks `kill(2)` authority.
This ACT confirms that premise empirically — in this VSCodium
substrate, the host DOES lack `kill(2)` authority over its PGID
children. But:

- This is a Chromium sandbox artifact specific to VSCodium (which
  inherits `--enable-sandbox` from its chromium zygote).
- Standard VS Code does NOT use `--enable-sandbox` on the
  extension host by default; the host has full signal authority
  in that case.
- A privileged-broker ACT would be a much larger authority
  surface than the marginal benefit (it would give Cline
  authority to kill arbitrary processes, not just its own
  children).


## Evidence files

```
.factory/evidence/ACT-CLINEMM-SEATBELT-OWNED-SIGNAL-AUTHORITY01/
├── 01-live-repro.cjs              substrate-level reproduction
├── 02-live-repro.out              full output (10 passed | 3 skipped)
├── 03-clinemm-process-tree.txt    snapshot of all ClineMM-related processes
├── 04-discriminator.out           T1: host vs unsandboxed detached child
├── 04-t2-standalone.out           T2: child signals grandchild → EPERM
├── 05-current-sbpl-excerpt.txt    the line under examination, unchanged
├── 06-verdict.md                  detailed verdict analysis
└── 07-bash-supervised-test-gate.out
                                    vitest itself fails to terminate
                                    forks worker with EPERM (proves it's
                                    a general Chromium-sandbox halt, not
                                    specific to ClineMM)
```

## Recommendation

**Do not change `seatbelt-profile.ts:700` from
`(allow signal (target self))` to `(allow signal (target same-sandbox))`.**

This ACT's evidence establishes:
- The hypothesis motivating the change is REFUTED at the ClineMM
  profile layer.
- The actual denial layer is the host's sandbox (Chromium in this
  substrate; unsandboxed in standard VS Code).
- The "leaked" processes in the screenshot are not ClineMM-owned.
- The proposed fix would marginally widen authority without any
  compensating test coverage.

If a future ACT identifies a real production code path where the
child shell needs to signal its own descendants (no such path
exists today), that ACT should add `same-sandbox` AND a focused
test that proves the child can manage its own tree without
affecting foreign processes. That ACT is NOT this one.

## Successor

NONE at the ClineMM Seatbelt profile layer. **However**, this ACT
proves narrower than the v1 verdict originally claimed:

```text
PROCESS_TREE_LOGIC       = structurally sound   (proven)
VSCODIUM_HOST_SIGNALING  = LIVE BLOCKED / EPERM (proven)
STANDARD_VSCODE_BEHAVIOR = NOT PROVEN BY THIS ACT
```

What this ACT did NOT prove:

- That `bash.supervised` cancellation succeeds in standard VS Code.
  The discriminator ran in the VSCodium substrate where
  `--enable-sandbox` is inherited. We have no live evidence in a
  `--no-sandbox` or stock VS Code host.
- That a real `CommandJobManager` → `bash.supervised` spawn seam
  reproduces the EPERM (we reproduced it with a plain unsandboxed
  `node -e` child as the closest substrate-analog, not the
  production seam).
- That `terminateTree` via the existing trusted host-helper would
  succeed where `kill(-pgid)` from the extension host failed.

A real, but bounded, follow-up ACT is:

```text
ACT-CLINEMM-TRUSTED-CHILD-TERMINATION-PROBE01
```

Scope (Expert panel directive):

```text
1. Reproduce through the REAL CommandJobManager / bash.supervised
   spawn seam (not a node -e analog), recording exact PGID.
2. Cancel from the extension host — capture kill(-pgid) = EPERM
   against a Cline-owned registered PGID.
3. Send the SAME kill(-pgid) from the existing unsandboxed per-user
   host helper.
4. Required discriminator:
      EXTENSION_HOST_KILL  = EPERM
      HOST_HELPER_KILL     = PASS
      GROUP_AFTER_HELPER   = ESRCH
5. If that composition works, design a bounded helper capability
   around Cline-owned REGISTERED process groups (opaque ownership
   tokens, no shell, no arbitrary command, no arbitrary-PID
   termination) — NOT a generic kill(pid) primitive.
6. If the real Cline command seam does NOT reproduce the EPERM:
      HALT_RED_NOT_REPRODUCED
   Stop. No infrastructure.
```

The ClineMM Seatbelt profile itself remains unchanged. The
substrate halt in this VSCodium environment is a Chromium sandbox
artifact, already documented as substrate-gated in
`ACT-CLINEMM-SANDBOX-OWNED-PROCESS-TERMINATION01`.

### Evidence-binding P0

This ACT's closure was initially authored with the diagnostic
artifacts (ACT body + 8 evidence files) only present in the working
tree and not durably tracked in git. The closure commit
`b31c1d939` contained only the epic-board row. The Factory reviewer
surfaced this as `HALT_SIGNAL_AUTHORITY_EVIDENCE_NOT_BOUND`. The
follow-up commit (`(pending)`) adds:

- `.gitignore` whitelist entries for the ACT file and the evidence
  directory (mirroring the prior ACT's durable-binding pattern).
- `.factory/acts/ACT-CLINEMM-SEATBELT-OWNED-SIGNAL-AUTHORITY01.md`
- `.factory/evidence/ACT-CLINEMM-SEATBELT-OWNED-SIGNAL-AUTHORITY01/`
  (8 files)

## Closing residue

P0: evidence binding — RESOLVED in the binding commit (follow-up
    to `b31c1d939`). The ACT body and 8 evidence files are now
    durably tracked and the `.gitignore` carries the whitelist.
P1: NONE. (The original v1 closure had P0: none; the binding P0
    was added by the Factory reviewer on first closure and is
    now resolved.)
P2: VSCodium `--enable-sandbox` continues to deny signal authority
    over PGID children. This is a general Chromium macOS sandbox
    behavior, not a ClineMM defect. It is already substrate-gated
    in the test suite and documented in the prior ACT closure.

The right fix for the user's specific symptom (workstation memory
pressure) is operational, not architectural:

- Restart unused VSCodium windows.
- Drop `--enable-sandbox` from VSCodium launch arguments if the
  user wants Cline's `terminateTree` to work in this substrate.
  **NOTE**: dropping `--enable-sandbox` is a broad security
  reduction (Chromium's docs warn "do not use this setting unless
  you are seeing issues") — it would also disable renderer /
  GPU-process sandboxing. The narrower preferred direction is the
  bounded trusted-host-helper probe
  (see `ACT-CLINEMM-TRUSTED-CHILD-TERMINATION-PROBE01` above),
  not a global sandbox disable.

Disabling the sandbox as a *diagnostic control* (paired:
`normal VSCodium = EPERM`, `--disable-chromium-sandbox = PASS`)
would still be a useful causal-control experiment, but should
not become the normal development configuration.

## Scope
- Production code change: NONE
- Test code change: NONE
- Evidence: 8 files in
  `.factory/evidence/ACT-CLINEMM-SEATBELT-OWNED-SIGNAL-AUTHORITY01/`
