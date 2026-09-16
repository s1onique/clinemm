# ACT-CLINEMM-TRUSTED-CHILD-TERMINATION-PROBE01

## Verdict

**CLOSED_HALTED_CLEAN**
**HALT_HELPER_HAS_NO_SIGNAL_ADVANTAGE**

The proposed repair surface — a new `process-group.terminate-owned`
method on the existing per-user trusted host helper, invoked as a
fallback when `CommandJobManager.cancel()` → `bash.supervised
terminateTree()` hits `EPERM` — **fails its necessity/sufficiency
test on this substrate**. The existing helper has no signal-
authority advantage over the spawning substrate on this developer
Mac. A helper-based fallback would not close the EPERM gap.

```text
HOST_HELPER_EXTERNAL_PGID_KILL = LIVE_EPERM
HELPER_SIGNAL_ADVANTAGE        = REFUTED on current substrate
ROOT_CAUSE_BACKGROUND_SESSION  = INFERRED, NOT PROVEN
```

Helper-based termination capability: **DO_NOT_BUILD**.

## Identity

- ENTRY_HEAD: `a4d8d246a0ffb18576cefb25020f3b150f18f8a2`
- CLOSURE_HEAD: `3b09cb7cf864a06031aeb154fc80fde4735a282c` (board-only commit); evidence/ACT body binding commit applied at closure-correction step (see "Binding correction" below)
- ACT_BODY_BINDING: `.factory/acts/ACT-CLINEMM-TRUSTED-CHILD-TERMINATION-PROBE01.md` (this file)
- EVIDENCE_BINDING: `.factory/evidence/ACT-CLINEMM-TRUSTED-CHILD-TERMINATION-PROBE01/`
- PREDECESSOR: ACT-CLINEMM-SEATBELT-OWNED-SIGNAL-AUTHORITY01
- PREDECESSOR_RESULT: `CLINE_CHILD_SBPL_HYPOTHESIS_REFUTED`, `VSCODIUM_EXTENSION_HOST_SIGNALING=LIVE_EPERM`, `STOCK_VSCODE_SIGNALING=NOT_PROVEN`

## Scope honesty — three corrections applied at closure

The first closure commit (`3b09cb7cf`) shipped only the board
row, did NOT bind the ACT body or evidence files, and used
labels (`REAL`, `LIVE`, `REAL_PRODUCTION_SEAM`, "macOS
Background sessions universally block cross-process signals
regardless of uid") that overstate what was actually proven.

The factory reviewer's correction (HALT_PROBE_EVIDENCE_EXCEEDS_
EXERCISED_SEAM + HALT_TRUSTED_CHILD_TERMINATION_EVIDENCE_NOT_BOUND)
is accepted in full. The following three corrections are applied
here.

### Correction 1 — RED reproduction label

The RED was reproduced via `Node child_process.spawn({detached:
true})` with options **byte-for-byte identical** to
`sdk/packages/core/src/extensions/tools/executors/bash.ts:917`.
That is the production primitive. It is **NOT** the production
seam `CommandJobManager → spawnSupervisableShellCommand → ...
→ cancel() → terminateTree()`. Job registration, the
`SupervisableShellProcess` lifecycle object, `terminateTree()`
sequencing, the `TERM_GRACE_MS=5000` window, and the actual
`process.kill(-childPid, signal)` call sites were not exercised
by this ACT. The honest label is:

```text
RED_REPRODUCTION              = SYNTHETIC_REAL
REAL_PRODUCTION_PRIMITIVE     = YES  (same Node spawn options)
REAL_COMMANDJOBMANAGER_SEAM   = NOT_EXECUTED
LIVE                          = YES  (process actually spawned)
```

This ACT is therefore a *necessary-but-not-sufficient* check:
it proves the helper has no signal-authority advantage over
the spawning primitive on this substrate. It does NOT prove
the same holds for the real `CommandJobManager` path, because
that path adds supervision / cancellation sequencing that may
interact with the kernel signal layer differently. A separate
ACT is required to close that gap (and per §34 the next move
is NOT another termination architecture ACT — it is a true
real-command-seam reproduction if cancellation remains a
user-visible problem).

### Correction 2 — Cause statement narrowing

The first closure said:

> "macOS Background sessions impose cross-process signal
> restrictions … universally blocked regardless of uid"

What was actually proven on this developer Mac:

```text
spawning parent (Background session bun)    → external PGID = EPERM
helper-launched runner (Background session) → same external PGID = EPERM
helper-spawned runner → its own descendants                  = PASS
```

That proves:

- the current helper has no signal authority advantage over the
  spawning substrate, for THIS PGID, on THIS substrate, when
  both run inside the same Background launchd session.

It does NOT prove:

- that "Background session" is the unique kernel cause (the
  helper's own process was a child of the spawning bun in the
  same session, but the helper's spawned runner is a grandchild
  in its OWN new session leader — that new session boundary
  may itself be the cause);
- a universal macOS rule about cross-session signal delivery
  (Apple documents LaunchAgent / LaunchDaemon execution
  environments but does not, in the cited developer
  documentation, enumerate the kernel-level signal rules);
- that a helper bootstrap-launched into `gui/501` or into the
  system LaunchDaemon domain would be subject to the same
  restriction (that was not tested; `launchctl bootstrap` of a
  helper plist into `gui/501` returned `Bootstrap failed: 5:
  Input/output error` on this substrate, which was not
  diagnosed further).

The honest statement is:

```text
HELPER_SIGNAL_ADVANTAGE        = REFUTED on current substrate
ROOT_CAUSE_BACKGROUND_SESSION  = INFERRED, NOT PROVEN
EXACT_KERNEL_CAUSE             = NOT_ISOLATED
```

### Correction 3 — Evidence binding P0

The first closure commit `3b09cb7cf` modified only
`.factory/epic-board.md`. The ACT body file
`.factory/acts/ACT-CLINEMM-TRUSTED-CHILD-TERMINATION-PROBE01.md`
and the entire evidence packet at
`.factory/evidence/ACT-CLINEMM-TRUSTED-CHILD-TERMINATION-PROBE01/`
were sitting untracked in the working tree. The gitignore
negation whitelist did not include them. This is the same
binding defect flagged in ACT-CLINEMM-SEATBELT-OWNED-SIGNAL-
AUTHORITY01.

Closure correction step:

1. Write this ACT body to
   `.factory/acts/ACT-CLINEMM-TRUSTED-CHILD-TERMINATION-PROBE01.md`.
2. Add the two whitelist negations to `.gitignore` so
   `git add` (NOT `git add -f`) binds the ACT body and the
   evidence directory durably.
3. `git add` the ACT body, the evidence files, the probe
   scripts, and the `.gitignore` whitelist delta. Commit with
   a closure-binding commit message that includes the evidence
   range manifest.

After that commit, `git log --stat <closure_head>` MUST list
the ACT body, `result.json`, every evidence file, and both
probe scripts. If it does not, the closure is
HALT_TRUSTED_CHILD_TERMINATION_EVIDENCE_NOT_BOUND and must be
redone.

## Discriminator (§5) — what was actually proven

The ACT's §5 discriminator is:

```text
EXTENSION_HOST_KILL = EPERM  (expected)
HOST_HELPER_KILL    = PASS   (REQUIRED)
GROUP_AFTER_HELPER  = ESRCH  (REQUIRED)
```

Observed:

```text
EXTENSION_HOST_KILL = EPERM     (spawning bun, Background session)
HOST_HELPER_KILL    = EPERM     (helper-spawned testbed runner)
GROUP_AFTER_HELPER  = ALIVE     (PGID 47349 root + grandchild survived)
```

The minimum-condition test FAILED. Specifically the second
clause `HOST_HELPER_KILL = PASS` was not satisfied. The §5
gate halts.

The helper was probed via its own existing
`testbed.run-installed-vsix-smoke` method (one-off diagnostic
runner wired in via `CLINEMM_TESTBED_RUNNER`). That method is
the helper's existing `posix_spawn + setpgid(0,0) + execve`
pathway (`tools/macos-host-helper/native/helper.c:823-845`).
The diagnostic runner received the target PGID encoded in the
`subject_head` field and attempted `kill -0`, `kill -TERM`,
`kill -KILL` against `-<PGID>`. Every attempt returned EPERM.
Sanity check: the same runner CAN `kill -0 -<selfPgid>` and
deliver SIGTERM to itself — so the runner has the right
primitives; what it lacks is the authority to reach external
PGIDs from the Background session.

## What is not justified by this ACT

- Adding `process-group.terminate-owned` (or any
  `kill(-pgid, ...)` capability) to the existing host
  helper. The discriminator proved this surface would not
  close the gap.
- Building an `SMJobBless`-style privileged LaunchDaemon
  helper. That is a new security architecture (system-wide
  higher privilege per Apple's LaunchDaemon contract), not
  a microfix, and is not justified by the current evidence.
- Globally disabling VSCodium's `--enable-sandbox`. Electron
  documents this as intended for testing only; it is the
  wrong layer to address (the substrate is documented
  upstream as substrate-gated, and stock VS Code does not
  exhibit the symptom).
- A kernel-level session unification or non-signal
  cancellation architecture. Each would require its own
  ACT with a real-command-seam reproduction as its gate.

## What is justified

The current `bash.supervised` production architecture
(`bash.ts:917` detached spawn + `bash.ts:1029` `kill(-pgid, …)`
+ `bash.ts:984` SIGKILL escalation + `command-job-manager.ts:293`
TERM_GRACE_MS) is **NOT** being changed by this halt. That
architecture is correct on stock VS Code and on substrates that
do not impose cross-process signal restrictions. The VSCodium
extension-host EPERM observed by the predecessor ACT is a
substrate artifact, not a ClineMM defect.

## Next move recommendation

This branch should stay closed **unless** a future ACT
demonstrates that cancellation is a live user-visible problem
on this substrate AND reproduces the EPERM through the REAL
`CommandJobManager` seam (not just the production primitive).
The current ACT does not justify any further termination
architecture work.

## Evidence

All files at `.factory/evidence/ACT-CLINEMM-TRUSTED-CHILD-
TERMINATION-PROBE01/`:

| File                              | Purpose                              |
|-----------------------------------|--------------------------------------|
| `00-entry.txt`                    | Entry freeze                         |
| `01-recon.txt`                    | Production seam identification       |
| `02-real-command-red.txt`         | RED reproduction (SYNTHETIC_REAL)    |
| `03-process-group-ownership.txt`  | PGID bounded to test singleton       |
| `04-helper-authority-probe.txt`   | §5 discriminator: helper EPERM       |
| `05-no-sandbox-control.txt`       | §6 control: NOT_EXECUTED             |
| `09-gates.txt`                    | §31 acceptance contract evaluation   |
| `result.json`                     | Machine-readable verdict             |
| `scripts/01-spawn-detached.mjs`   | Spawn probe (production primitive)   |
| `scripts/02-real-red-green.mjs`   | Combined RED + wait-for-helper probe |

The committed closure range MUST include all of the above.
