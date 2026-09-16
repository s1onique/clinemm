# ACT-CLINEMM-TRUSTED-CHILD-TERMINATION-PROBE01-CORRECTION02

## Verdict

**REOPENED_TO_INSUFFICIENT_EVIDENCE**
**CAPTURE_INSUFFICIENT**

The previous closure's verdict `HALT_HELPER_HAS_NO_SIGNAL_ADVANTAGE`
was overreached. The substrate cannot produce the discriminator that
verdict requires.

```text
EVIDENCE_BINDING                          GREEN
SPAWN_PRIMITIVE_RED                       SYNTHETIC_REAL / LIVE
REAL_COMMANDJOBMANAGER_SEAM               NOT_EXECUTED
BACKGROUND_SUBPROCESS_HELPER_KILL         LIVE_EPERM
REAL_LAUNCHAGENT_HELPER_KILL              NOT_EXECUTED
HELPER_SIGNAL_ADVANTAGE                   NOT YET DECIDED
EXACT_KERNEL_CAUSE                        NOT_ISOLATED
```

**Helper-based termination capability: still DO_NOT_BUILD.**
**Helper-advantage branch: also NOT CLOSED.** No production code
changed. No capability added. No plist installed.

## Identity

- ENTRY_HEAD: `540327d4f1217a094ec7fbe0d9da19c4cdabc7ac`
- CLOSURE_HEAD: TBD (this CORRECTION02 commit)
- ACT_BODY_BINDING: `.factory/acts/ACT-CLINEMM-TRUSTED-CHILD-TERMINATION-PROBE01-CORRECTION02.md` (this file)
- EVIDENCE_BINDING: `.factory/evidence/ACT-CLINEMM-TRUSTED-CHILD-TERMINATION-PROBE01-CORRECTION02/`
- PREDECESSOR: ACT-CLINEMM-TRUSTED-CHILD-TERMINATION-PROBE01
- PREDECESSOR_VERDICT: `HALT_HELPER_HAS_NO_SIGNAL_ADVANTAGE` (closure-corrected in commit 540327d4f)
- REVIEWER_REOPEN: `HALT_HELPER_AUTHORITY_PROBE_USED_WRONG_SUBSTRATE`

## What the reviewer got right

The reviewer's verdict identifies three load-bearing defects. All three
hold up under re-examination:

### Defect A — substrate contradiction

PROBE01's entry freeze (`.factory/evidence/ACT-CLINEMM-TRUSTED-CHILD-
TERMINATION-PROBE01/00-entry.txt:6`) says:

```text
HOST_HELPER_STATUS=RUNNING (LaunchAgent-managed; helper pgid 99137)
```

PROBE01's `result.json` (`.factory/evidence/ACT-CLINEMM-TRUSTED-CHILD-
TERMINATION-PROBE01/result.json:41`) simultaneously says:

```json
"helper_subprocess_session": "Background (inherits parent)"
```

These cannot both be true on the same substrate. A real LaunchAgent-
managed helper would be bound to the launchd domain that bootstrapped
it (Aqua session, gui/501 or user/501-Aqua), not the Background
session of the spawning bun shell. The PROBE01 evidence packet
therefore contains an internal substrate contradiction.

The CORRECTION02 substrate-mismatch probe
(`.factory/evidence/ACT-CLINEMM-TRUSTED-CHILD-TERMINATION-PROBE01-
CORRECTION02/13-substrate-mismatch.log`) measures the substrate
directly:

```text
B.1 Are there any registered com.clinemm.* services in user/501?
    (none)
B.2 Are there any registered com.clinemm.* services in gui/501?
    (none)
B.3 Are there any com.clinemm.* plist files in standard LaunchAgent paths?
    (no plist files anywhere under tools/)
B.4 sample helper binary process + its launchd domain
    SAMPLE_PID=641
    launchctl print pid/641 -> type = pid (NOT a "user" or "gui" service),
                                creator = launchctl[17064]
                                (ad-hoc invocation, not a domain-managed
                                 service)
```

The "LaunchAgent-managed" label in PROBE01's entry freeze is
**structurally wrong**. There is no LaunchAgent-managed helper on this
developer Mac. Every running helper binary is an ad-hoc
`launchctl <binary>` invocation from a Background shell, and its
launchd context records it as `type = pid` (not a domain service),
with `creator = launchctl[<ad-hoc-pid>]` (not a launchd-on-behalf-of-
user bootstrap).

The `helper_subprocess_session = "Background (inherits parent)"`
record in PROBE01's result.json is the honest measurement. The entry
freeze's "LaunchAgent-managed" framing is the contradiction.

### Defect B — wrong substrate was tested

PROBE01's §5 discriminator ran:

```text
Background-session bun parent (this shell)
  -> manually spawn helper binary via CLINEMM_HOST_HELPER_SOCKET
     (helper inherits Background session, NOT a LaunchAgent domain)
       -> helper's posix_spawn+setpgid(0,0)+execve testbed runner
          (Background-session grandchild)
             -> helper-spawned runner attempts kill(-externalPGID, ...)
                -> EPERM
```

The reviewer's required discriminator was:

```text
REAL_HELPER_PID         = (a real LaunchAgent-managed instance)
REAL_HELPER_PPID        = (typically 1, but type=gui/user/501 service)
REAL_HELPER_LAUNCHD_DOMAIN = gui/501 (Aqua session) or user/501-Aqua
REAL_HELPER_SESSION_TYPE = Aqua
REAL_HELPER_SOCKET      = (the helper's actual AF_UNIX socket)
```

The actual probe tested a Background-subprocess helper, not a
LaunchAgent-managed helper. Apple documents the LaunchAgent vs
ordinary child distinction: LaunchAgents are managed by `launchd` on
behalf of the logged-in user and operate in the user's Aqua context.
The helper.c itself documents the Background-session limitation
(`helper.c:836-841`: "On macOS Background sessions the per-process
kill() returns EPERM even for our own children"). The helper is
engineered AROUND the Background-session limitation, not AGAINST it.

The §5 discriminator's hypothesis — that a LaunchAgent-managed helper
might have signal authority that the spawning substrate lacks — was
therefore never honestly tested.

### Defect C — labels overstate what was proven

PROBE01's §30 closure was:

```text
HALT_HELPER_HAS_NO_SIGNAL_ADVANTAGE
```

The honest statement the evidence actually supports is narrower:

```text
BACKGROUND_SUBPROCESS_HELPER_SIGNAL_ADVANTAGE = REFUTED
```

Not a universal claim about all helpers; only about THIS helper
configuration on THIS substrate. PROBE01's CORRECTION01 narrowing
(`REFUTED on current substrate`, `ROOT_CAUSE_BACKGROUND_SESSION =
INFERRED, NOT PROVEN`, `EXACT_KERNEL_CAUSE = NOT_ISOLATED`) was the
right move; the §30 closure wording did not fully absorb it.

## What the substrate actually says about real LaunchAgent bootstrap

The CORRECTION02 bootstrap-attempt probe
(`.factory/evidence/ACT-CLINEMM-TRUSTED-CHILD-TERMINATION-PROBE01-
CORRECTION02/03-bootstrap-attempt.txt` + logs 10/11/12/13) attempts
to produce the real LaunchAgent helper instance the §5 discriminator
requires:

```text
launchctl bootstrap gui/501  <helper-binary>      -> rc=5 "Bootstrap failed: 5: Input/output error"
launchctl bootstrap user/501 <helper-binary>      -> rc=5 "Bootstrap failed: 5: Input/output error"
launchctl bootstrap gui/501  <proper plist>       -> rc=5 "Bootstrap failed: 5: Input/output error"
launchctl bootstrap user/501 <proper plist>       -> rc=5 "Bootstrap failed: 5: Input/output error"
sudo launchctl bootstrap user/501 <plist>         -> "operation not permitted: sudo"
launchctl asuser 501 launchctl bootstrap user/501 -> rc=5 "Bootstrap failed: 5: Input/output error"
```

Every variant of the bootstrap operation fails with rc=5 in this
Background shell. The diagnostic hint ("Try re-running the command
as root for richer errors") points at a SIP/credentialing layer that
is not reachable from this shell. Sudo is denied. `launchctl asuser`
does not elevate to bootstrap-capable.

The substrate therefore cannot produce a real LaunchAgent-managed
helper. Per the reviewer's reopen:

> "If your current development sandbox cannot bootstrap/access the
>  real LaunchAgent:
>    CAPTURE_INSUFFICIENT
>  not HALT_HELPER_HAS_NO_SIGNAL_ADVANTAGE."

This is exactly the situation.

## Corrected labels

```text
LABEL                                           PROBE01                 CORRECTION02
-------                                         -------                 ------------
result                                          HALT_HELPER_HAS_NO_     CAPTURE_INSUFFICIENT
                                                 SIGNAL_ADVANTAGE
labels.helper_signal_advantage                  REFUTED on current      NOT YET DECIDED
                                                 substrate
labels.background_subprocess_helper_signal_     (implicit; not          REFUTED  (NEW, narrow)
  advantage                                      separated from
                                                 helper_signal_
                                                 advantage)
labels.real_launchagent_helper_signal_          (not present)           NOT_EXECUTED  (NEW)
  advantage
substrate.helper_subprocess_session             Background              Background (ad-hoc spawn
                                                 (inherits parent)        from this shell; the
                                                                            'LaunchAgent-managed'
                                                                            label in PROBE01's
                                                                            entry freeze is
                                                                            structurally wrong)
substrate.real_launchagent_helper_on_substrate  (not present)           false  (NEW)
substrate.bootstrap_capability_on_substrate     (not present)           false  (NEW)
substrate.bootstrap_attempts_observed           (not present)           [5 entries, all rc=5]
red.real_command_seam                           true                    (renamed to red.real_
                                                                            production_primitive;
                                                                            matches labels block)
ACT body §"What is justified"                   "stock VS Code does     "STOCK_VSCODE_SIGNALING
                                                 not exhibit the         = NOT_PROVEN
                                                 symptom"                (inherited)"
```

All other labels in PROBE01's result.json are accepted as is. The
narrowing of `ROOT_CAUSE_BACKGROUND_SESSION` to `INFERRED, NOT
PROVEN` and `EXACT_KERNEL_CAUSE` to `NOT_ISOLATED` are preserved;
the reviewer explicitly kept these (CORRECTION01's load-bearing
correct narrowings).

## What is now justified

The current `bash.supervised` production architecture
(`bash.ts:917` detached spawn + `bash.ts:1029` `kill(-pgid, ...)`
+ `bash.ts:984` SIGKILL escalation + `command-job-manager.ts:293`
TERM_GRACE_MS) is **NOT** being changed by this correction. The
real-command-seam EPERM has not been demonstrated through
`CommandJobManager.cancel()`; only the production spawn primitive's
EPERM has been demonstrated. Whether the SEAM-level EPERM matches
the primitive-level EPERM is its own measurement, deferred.

Whether stock VS Code exhibits the same EPERM is **NOT_PROVEN**
(inherited from ACT-CLINEMM-SEATBELT-OWNED-SIGNAL-AUTHORITY01).
Public VS Code Code Helper processes can also carry
`--enable-sandbox`, so stock behavior must remain NOT_PROVEN until
measured on a stock VS Code substrate. PROBE01's "stock VS Code does
not exhibit the symptom" phrasing is replaced here with the honest
"NOT_PROVEN, inherited" label.

## What is not justified by this ACT

- Adding `process-group.terminate-owned` (or any `kill(-pgid, ...)`
  capability) to the existing host helper. The discriminator
  measured only the Background-subprocess helper. The REAL
  LaunchAgent helper arm was not executed. A new helper method is
  not justified.
- Closing the helper-advantage branch as impossible. The REAL
  LaunchAgent helper arm was not executed. The branch remains open
  as a future-ACT candidate IF a future substrate can bootstrap a
  real LaunchAgent helper instance (or IF cancellation becomes a
  live user-visible problem that requires authority expansion).
- Building an SMJobBless-style privileged LaunchDaemon helper. That
  is a new security architecture (system-wide higher privilege per
  Apple's LaunchDaemon contract), not a microfix, and is not
  justified by the current evidence.
- Globally disabling VSCodium's `--enable-sandbox`. Electron
  documents this as intended for testing only; it is the wrong
  layer to address.
- A kernel-level session unification or non-signal cancellation
  architecture. Each would require its own ACT with a real-command-
  seam reproduction as its gate.
- Inferring stock VS Code behavior from VSCodium. Stock remains
  NOT_PROVEN until measured.

## Next move recommendation

This branch should stay in `CAPTURE_INSUFFICIENT` state unless one
of the following is independently demonstrated:

1. A future ACT can bootstrap a real LaunchAgent-managed helper
   instance on this developer Mac (the substrate currently refuses
   every bootstrap variant; would require either root privilege to
   bootstrap, or a `~/Library/LaunchAgents/com.clinemm.*.plist`
   installation that bootstraps at user login).
2. A future ACT demonstrates that cancellation is a live user-
   visible problem on this substrate AND reproduces the EPERM
   through the REAL `CommandJobManager` seam (not just the
   production primitive).

Until either happens, the current ACT does not justify any further
termination architecture work, and does not justify closing the
helper-advantage branch.

## Evidence

All files at `.factory/evidence/ACT-CLINEMM-TRUSTED-CHILD-
TERMINATION-PROBE01-CORRECTION02/`:

| File                                   | Purpose                                       |
|----------------------------------------|-----------------------------------------------|
| `00-entry.txt`                         | Entry freeze (substrate classification)       |
| `01-reopen.txt`                        | Reviewer verdict digest                       |
| `02-substrate-classification.txt`      | Substrate measurement (user/501 + gui/501 +  |
|                                        | absence of com.clinemm.* services)            |
| `03-bootstrap-attempt.txt`             | Bootstrap probe summary (5 attempts, all rc=5)|
| `04-evidence-contract-fixes.txt`       | Two internal-contract defect resolutions      |
| `05-result.json`                       | Machine-readable corrected verdict            |
| `06-gates.txt`                         | §31 acceptance contract evaluation            |
| `10-bootstrap-attempt-reproduction.log`| Probe 1 raw output (gui/501 <helper>)         |
| `11-bootstrap-attempt-variants.log`    | Probe 2 raw output (user/501 + bootout)       |
| `12-bootstrap-with-plist.log`          | Probe 3 raw output (with proper plist)        |
| `13-substrate-mismatch.log`            | Substrate mismatch proof (helper processes,   |
|                                        | com.clinemm.* services, helper.c comment)     |
| `com.clinemm.probe.plist`              | The probe plist used in Probe 3 (NOT in       |
|                                        | `~/Library/LaunchAgents/`; never installed)   |
| `scripts/01-bootstrap-attempt-reproduction.sh` | Probe 1 shell script                  |
| `scripts/02-bootstrap-attempt-variants.sh`     | Probe 2 shell script                  |
| `scripts/03-bootstrap-with-plist.sh`           | Probe 3 shell script                  |
| `scripts/04-substrate-mismatch.sh`             | Substrate mismatch proof shell script |

The committed closure range MUST include all of the above.
