# ACT-CLINEMM-SEATBELT-POSIX-SEM-ANSIBLE01 — Source Map

## Entry invariants (recorded at ENTRY)

| Item | Value |
|---|---|
| Repository root | `/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm` |
| `ENTRY_HEAD` | `d68def3ae2ddcb635bfbb34955f2cd561205d9c0` |
| Branch | `main` |
| Dirty state at entry | CLEAN (`git status --porcelain` empty) |
| Protected stashes | `git stash list` → empty (none to preserve) |
| Worktrees (preserved, untouched) | `main` (this checkout), `/private/tmp/clinemm-prebase` (prunable), `/private/tmp/clinemm-stash-recovery-20261117` (`recovery/protected-stash-20261117`), `/private/tmp/worktree-bun.7ddCHQ` (prunable), a prunable temp dogfood worktree, `../clinemm-m31-action-first`, `../clinemm-m31-bounded` |
| macOS version | macOS 14.7.4 (Build 23H420), Darwin 23.6.0 arm64 |
| Installed extension identity | `s1onique.clinemm` 4.1.16, installed at `/Volumes/UserData/Users/chistyakov/.vscodium-clinemm/extensions/s1onique.clinemm-4.1.16-5a1c485cb-1f1670b27` (and a stale `...-03ad308f4`) |
| Host helper endpoint | `/Volumes/UserData/Users/chistyakov/.clinemm/host-helper.sock` (AF_UNIX) |
| Ansible | ansible-core 2.21.1, interpreter `python 3.13.15` (`/nix/store/8g76m81yyr8ki19d56l1czx1fqaxkk6b-python3-3.13.15/bin/python3.13`) |

`HALT_UNEXPECTED_TRACKED_DIRT` was **not** triggered: the tree was clean at entry.

## Production execution path (recon-verified)

```text
ClineMM run_commands
  → backgroundExec
  → CommandJobManager.start()            apps/vscode/src/sdk/command-job-manager.ts
  → sandbox backend.prepare()            sdk/packages/core/src/runtime/sandbox/macos/seatbelt-backend.ts
  → generateSeatbeltProfile()            sdk/packages/core/src/runtime/sandbox/macos/seatbelt-profile.ts
  → /usr/bin/sandbox-exec -f <profile>   seatbelt-backend.ts (prepared.executable / prepared.args)
  → sandboxed shell
  → Python / Ansible
  → multiprocessing.SemLock              → sem_open(2) → POSIX semaphore
```

### Effective backend / profile hash (live, captured from the REAL production path)

The agent shell that executed this ACT was itself running inside a ClineMM-generated
Seatbelt profile. The live profile on disk was:

```
/private/var/folders/0g/.../T/clinemm-sandbox-profile-GaHeR5/profile-d58106ad5c1f.sb
sha256 = ff70554530c3a9fcded825468d612b85d8409c490eeb98f0836dd669d36e47c2
```

Its verbatim content contained:

```scheme
(version 1)
(deny default)
(allow process-exec)
(allow process-fork)
(allow signal (target same-sandbox))
(allow sysctl-read)
(allow mach-lookup)
(allow file-read*)
...
(allow network*)
```

`grep -c 'ipc-posix-sem' <profile>` → **0** (`NO_SEM_RULE`). The omission is confirmed
on the LIVE production path, not merely in the source.

### Was the original failure observed through this path?

**YES.** The agent shell was running under exactly this profile, and the ACT's RED
probe reproduced the reported failure verbatim inside it:

```text
PermissionError: [Errno 1] Operation not permitted
  File ".../multiprocessing/synchronize.py", line 57, in __init__
    sl = self._semlock = _multiprocessing.SemLock(
```

This is the same `[Errno 1] Operation not permitted` signature the incident reported
for Ansible's multiprocessing path. The failure was NOT observed through
`vscodeTerminal`, Codex, or another external runner.

## Repair (bounded, minimal)

Primary target: `sdk/packages/core/src/runtime/sandbox/macos/seatbelt-profile.ts`

One rule added to the common macOS permission section:

```scheme
(allow ipc-posix-sem)
```

No new public capability, tool parameter, settings field, or environment variable.
No command-name or Python-executable detection. Filesystem, network, environment
sanitization, SSH-agent, host-helper, signal, supervision, process-group ownership,
cancellation and deadline rules are unchanged. No unsandboxed fallback. Seatbelt
remains enabled by default.

## Test artifacts added

| File | Purpose |
|---|---|
| `sdk/packages/core/src/runtime/sandbox/macos/seatbelt-profile.test.ts` | T1 profile-generation + conservation assertions (added block) |
| `sdk/packages/core/src/runtime/sandbox/macos/seatbelt-posix-sem01.live.test.ts` | T2/T3/T4 live Darwin-kernel qualification (new file) |
| `apps/vscode/src/sdk/command-job-manager.sandbox-c3-real-kernel.test.ts` | T3/T8 production `CommandJobManager.start()` path (added block) |
| `apps/vscode/src/sdk/__tests__/act-posix-sem01.profile-snapshot.test.ts` | Writes the real production profile to disk for the standalone kernel scripts — **opt-in only** (see C1-1) |

## Evidence files

| File | Content |
|---|---|
| `probe-environment.sh` / `probe-unsandboxed.txt` | Execution-boundary probe + the ordinary-macOS-terminal witness (`POSIX_SEM_OK`) |
| `ab-discriminator.sh` / `ab-discriminator.txt` | The A/B causal discriminator (Policy A → EPERM, Policy B → POSIX_SEM_OK; one-line diff) |
| `red-live.txt` | RED proof: production change reverted, live kernel suite → 11 failures including the kernel-level EPERM |
| `apps-vscode-baseline.txt` | RED proof at the production `CommandJobManager` seam: T3/T3b FAIL with the production change reverted |
| `live-kernel-suite.txt` | GREEN: core macOS sandbox suite (8 files, 127 passed, 2 skipped) incl. the new live kernel file |
| `apps-vscode-suites.txt` | GREEN: apps/vscode focused suites (3 files, 41 passed) incl. T3, T3b, T8 |
| `green-production-kernel.sh` / `green-production-kernel.txt` | T2 + T4 kernel-level GREEN against the real production profile |
| `ansible-qualification.sh` / `ansible-qualification.txt` | Ansible interpreter/version capture + unsandboxed localhost baseline |
| `ansible-sandboxed-probe.sh` / `ansible-sandboxed-probe.txt` | Sandboxed localhost ping under the repaired production profile (shows the residual boundary) |
| `ansible-boundary-classification.sh` / `ansible-boundary-classification.txt` | V1/V2/V3 causal classification of the residual Ansible boundaries (V3 = SUCCESS/pong) |
| `gen-production-profile.ts` | Standalone profile generator (superseded by the Vitest snapshot helper for Node-runtime fidelity) |
| `profile-snapshot-optin-contract.txt` | C1-1 proof: the profile-snapshot test is opt-in — DEFAULT (1 passed / 1 skipped, nothing written) and OPT-IN (2 passed, both `.sb` files emitted, repo unpolluted) |
| `run-apps-vscode-baseline2.sh` / `apps-vscode-baseline2.txt` | C1-3 baseline: production change reverted, C3 file alone → **3 failed (T3, T3b, T8) / 15 passed**; the repair is load-bearing and the cleanup test passes in this run |

## Review round C1 — corrections applied to this ACT's own files

| # | Correction | Where | Status |
|---|---|---|---|
| C1-1 | Profile-snapshot evidence emission must be **opt-in**; an ordinary `vitest run` must not fail or write | `apps/vscode/src/sdk/__tests__/act-posix-sem01.profile-snapshot.test.ts` — `it.skipIf(!PROFILE_OUT)` + a companion test pinning the default behaviour | **APPLIED**, both modes proven |
| C1-2 | T4-e must install the synthetic secrets into `process.env` **before** `prepare()`, assert the parent still carries them, assert `prepared.env[name] === ""`, and verify the actual sandboxed child observes no secret value | `sdk/packages/core/src/runtime/sandbox/macos/seatbelt-posix-sem01.live.test.ts` — T4-e block | **APPLIED**; the corrected assertion states the real `materializeEnvironment` contract (blocked key → empty string, value absent) |
| C1-3 | The `profile temp dir is cleaned up after deadline` failure was investigated, not dismissed | pre-existing test in `apps/vscode/src/sdk/command-job-manager.sandbox-c3-real-kernel.test.ts` (NOT ACT-owned) | **Pre-existing flake** — baseline run with the change reverted passes it; three consecutive suite runs are 41/41 green. Not modified (out of scope). |

## Harness notes (environment facts, not production behaviour)

1. **Bun vs Node for `realpathSync` on an AF_UNIX socket.** Bun returns
   `EOPNOTSUPP` for `realpathSync(<socket inode>)` on this filesystem; Node
   resolves it correctly. The production extension host is Node, so this is a
   harness-only concern. The profile-snapshot Vitest helper is used wherever a
   profile containing the host-helper rule is needed.
2. **Nested `sandbox-exec`.** A shell that is already inside a ClineMM Seatbelt
   profile cannot apply another sandbox (`sandbox-exec: sandbox_apply: Operation
   not permitted`). Every live-kernel gate in this ACT was therefore executed from
   an UNSANDBOXED executor (a pane of the long-lived tmux server), and each run
   records `NESTED_SANDBOX_EXEC=OK` as its own pre-condition witness
   (`probe-unsandboxed.txt`).
3. **`env -i` bypasses the executor contract.** Environment sanitization is
   produced by the backend's `materializeEnvironment`, not by the SBPL profile.
   The load-bearing sanitization proof is therefore the live test
   `seatbelt-posix-sem01.live.test.ts` "T4-e", which runs the REAL prepared
   invocation with the REAL materialized environment.
4. **Canonical `/tmp` is always writable BY DESIGN** (ACT-CLINEMM-SEATBELT-TEMP-WRITE-AUTHORITY01),
   so it is not a valid "outside the authorized roots" probe. The T4-a negative
   control uses a path under `$HOME`.

