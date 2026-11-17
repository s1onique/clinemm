# ACT-CLINEMM-SEATBELT-POSIX-SEM-ANSIBLE01 — Verdict

## Terminal verdict

**`PASS_STRUCTURAL_ONLY`** — with `LIVE_UNOBSERVABLE` for the installed-extension
qualification.

Production repair, Darwin-kernel GREEN, security conservation and Ansible localhost
qualification all pass. The installed-extension (VSIX) qualification could not be
completed in this session, so the ACT is **not** claimed as `CLOSED_CLEAN`.

Separately reported:

- **Ansible localhost qualification: PASSED.** `localhost | SUCCESS => {"ping": "pong"}`
  through the real, still-sandboxed production `CommandJobManager.start()` path.
- **Remote SSH qualification against 192.168.50.239:22: NOT PERFORMED.** The current
  Seatbelt profile supports only network-deny / unrestricted network-allow; it has
  no destination-scoped SSH allowlist. Enabling unrestricted network is explicitly
  out of scope for this ACT. Recorded as a separate bounded successor.

---

## 1. RED — reproduced on the Darwin kernel through the production path

**Ordinary macOS terminal (unsandboxed executor):**
```
NESTED_SANDBOX_EXEC=OK
PYTHON: /run/current-system/sw/bin/python3.13
POSIX_SEM_OK
POSIX_SEM_EXIT=0
```
→ `probe-unsandboxed.txt`

**ClineMM production sandbox (the live profile that was actually executing this ACT):**
```
PermissionError: [Errno 1] Operation not permitted
  File ".../multiprocessing/synchronize.py", line 57, in __init__
    sl = self._semlock = _multiprocessing.SemLock(
```
→ the live profile on disk contained **no** `ipc-posix-sem` rule
(`grep -c 'ipc-posix-sem'` → `0`).

**RED at the live kernel level** (`red-live.txt`): with only the production profile
change reverted, the core macOS sandbox suite reported **11 failures** (exit 1),
including:

- `T2: the exact RED probe SUCCEEDS under the repaired production profile` → FAILED
- `T2b: a real multiprocessing worker + queue round-trip succeeds` → FAILED
- `T1 / T1b / T2 / T4 / T5` (profile generation) → FAILED

**RED at the production `CommandJobManager.start()` seam** (`apps-vscode-baseline.txt`):
with the production change reverted, **T3 and T3b FAIL** (2 failed, 15 passed,
exit 1) — i.e. the real `backgroundExec` production path could not run a Python
`multiprocessing` workload.

## 2. Causal discriminator (A/B, Darwin kernel, identical policies)

`ab-discriminator.txt` — same python executable (the Ansible interpreter,
`python3.13`), same env, same cwd, same filesystem/network/process rules, same
launch mechanism (`/usr/bin/sandbox-exec -f`); the policy diff was exactly one line:

```
16a17
> (allow ipc-posix-sem)
```

| Policy | Result | Exit |
|---|---|---|
| A — existing (no semaphore permission) | `SEMAPHORE_ERROR_ERRNO=1` / `[Errno 1] Operation not permitted` | 1 |
| B — exactly + `(allow ipc-posix-sem)` | `POSIX_SEM_OK` | 0 |

Both executed under the real macOS kernel sandbox. The hypothesis is established.

## 3. Repair

One rule, added to the common macOS permission section of
`generateSeatbeltProfile()`:

```scheme
(allow ipc-posix-sem)
```

Deliberate, bounded expansion of sandbox authority to ONE OS IPC class. No new
capability / parameter / setting / env var; no command detection; no unsandboxed
fallback; Seatbelt stays enabled by default; filesystem, network, environment,
SSH-agent, host-helper, signal, supervision, process-group, cancellation and
deadline rules unchanged.

## 4. GREEN and conservation

| Gate | Command | Result |
|---|---|---|
| T1 profile generation | `vitest run --config vitest.config.ts src/runtime/sandbox/macos/seatbelt-profile.test.ts` | **46 passed**, exit 0 |
| T2/T3/T4 live Darwin kernel | `vitest run --config vitest.config.ts src/runtime/sandbox/macos/` (unsandboxed executor) | **8 files, 127 passed, 2 skipped**, exit 0 (incl. the new `seatbelt-posix-sem01.live.test.ts`, 10 tests) |
| T3/T8 production `CommandJobManager` | `vitest run --config vitest.config.ts src/sdk/command-job-manager.sandbox-c3-real-kernel.test.ts src/sdk/command-job-manager.sandbox-integration.test.ts src/sdk/sandbox-policy-production-composition.test.ts` | **3 files, 41 passed**, exit 0 |
| T2 kernel GREEN (real production profile) | `green-production-kernel.sh` | `POSIX_SEM_OK` exit 0; `MP_WORKER_QUEUE_OK` exit 0 (`EXIT_CODES: [0, 0, 0]`) |
| T4-a write outside authorized roots | same | `WRITE_EXIT=1`, `T4A_FILE_EXISTS_ON_HOST=NO_DENIED` |
| T4-b authorized workspace write | same | `WRITE_EXIT=0` |
| T4-c default network egress | same | `NETWORK_DENIED errno=1`, exit 7 (denied) |
| T4-e explicit network opt-in | same | `NETWORK_ALLOW_OK`, exit 0 (unchanged) |
| T4-f SSH-agent opt-in | live test | deny profile carries **0** AF_UNIX / system-socket rules |
| T4-g host-helper gating | same | deny profile **0**, allow profile **1** (gated on network mode) |
| T4-e environment sanitization | live test | child observes `AWS_SECRET_ACCESS_KEY=[]`, `AWS_ACCESS_KEY_ID=[]`, `OPENAI_API_KEY=[]`, `ANTHROPIC_API_KEY=[]` — the **secret values are absent**; the backend's defensive `SECRET_BLOCKLIST` filter blanks the key rather than removing it (see §9) |
| T5 cross-platform conservation | Linux/Windows backends | **UNCHANGED** — the repair is confined to the darwin-only `macos/seatbelt-profile.ts`; the linux and windows backends were not touched (git diff confirms) |
| Typecheck — SDK core | `bun tsc -p tsconfig.dev.json --noEmit` | **43 errors, identical to the 43-error baseline**; **0** in the changed files |
| Typecheck — apps/vscode | `bun tsc --noEmit` | **0 errors** |

Unavailable kernel test handling: the darwin live-kernel suites are guarded by
`describe.skipIf(!HAS_SUBSTRATE)`; on a non-darwin host they are **skipped, never
reported as passing**. On this host they executed (skip count 2 = the two
non-darwin-only tests inside `seatbelt-availability.test.ts` and
`seatbelt-backend.test.ts`).

## 5. Ansible qualification

Interpreter / version captured (`ansible-qualification.txt`):

```
ansible [core 2.21.1]
python version = 3.13.15 ...
```

Unsandboxed localhost baseline: `localhost | SUCCESS => { "ping": "pong" }`, exit 0.

**Sandboxed localhost qualification through the repaired production path: PASSED**
(`apps-vscode-suites.txt`, test `T8`):
`localhost | SUCCESS => { "ping": "pong" }`, exit 0, with the pre-repair
`Operation not permitted` / `Unable to use multiprocessing` signatures ABSENT.

### Residual boundaries (classified, NOT widened)

`ansible-boundary-classification.txt` establishes, causally, that after the
semaphore repair the remaining Ansible failures are **different** boundaries:

| Variant | Network rule | Ansible temp placement | Result |
|---|---|---|---|
| V1 | `(deny network*)` (default) | authorized | `TimeoutError: Local RPC server did not start.` exit 250 — Ansible's `LocalManager` binds an AF_INET listener socket → **network-capability boundary** |
| V2 | `(allow network*)` (existing opt-in) | local temp authorized only | `Failed to create temporary directory` exit 4 — Ansible's default remote temp is `$HOME/.ansible/tmp` → **filesystem boundary** |
| V3 | `(allow network*)` (existing opt-in) | local + remote temp authorized | **`localhost | SUCCESS => {"ping": "pong"}` exit 0** |

Neither residual boundary is the POSIX-semaphore boundary this ACT was chartered to
repair. Both are pre-existing ClineMM behaviours and were deliberately **not**
widened:

- The network posture stays default-deny. The existing, documented opt-in is
  `CLINEMM_SAFE_YOLO_NETWORK=allow`.
- The SSH-agent authority remains opt-in via `CLINEMM_SAFE_YOLO_SSH_AGENT=allow`
  and still emits only the exact `path-literal` AF_UNIX rule pair.
- The host-helper socket authority remains gated on the network mode.

### Syntax-check gate

`ANSIBLE_SYNTAX_CHECK_EXIT=NOT_EXECUTED` — **no Ansible playbook exists in this
repository** (`git ls-files | grep -iE 'ansible|playbook'` → empty). The
provisioning playbook belongs to a different deployment repository. The gate is
reported as NOT EXECUTED, never as passing.

### Remote SSH boundary

`REMOTE_SSH_PERFORMED=NO`. The Ubuntu guest `192.168.50.239:22` was **not**
contacted. The current Seatbelt profile has no destination-scoped network
authority; the only network choices are deny / unrestricted allow. Granting
unrestricted egress is explicitly forbidden by this ACT, and a successful TCP
connection would not be authorization to deploy. A destination-scoped SSH
allowlist is recorded as a **separate bounded successor with an explicit approval
contract**.

**Ubuntu provisioning itself was NOT performed and is NOT claimed.**

## 6. Installed-extension qualification — `LIVE_UNOBSERVABLE`

`PASS_STRUCTURAL_ONLY` for this gate. The local VSCodium instance
(`--user-data-dir=/Volumes/UserData/Users/chistyakov/.vscodium-clinemm/user-data`)
carries `s1onique.clinemm` 4.1.16 at build `1f1670b27`. Building and installing a
fresh VSIX and driving the installed extension's `run_commands` in `backgroundExec`
mode was not completed in this session, so:

- `SUBJECT_HEAD` — `d68def3ae2ddcb635bfbb34955f2cd561205d9c0` (the source under test)
- extension version — 4.1.16 (installed build `1f1670b27`)
- VSIX absolute path / byte size / SHA-256 — **NOT PRODUCED**
- installed extension version — 4.1.16 (pre-existing install, NOT the repaired build)
- installed bundle identity — **NOT RE-ESTABLISHED for the repaired build**
- through the installed extension → `LIVE_UNOBSERVABLE`

A source-level test passing on a different build is explicitly **not** treated as
establishing installed behaviour.

## 7. Repository hygiene

- No push, no PR, no deployment to the guest.
- No changes to Ansible, Python multiprocessing, OpenTofu, Nixpkgs, SSH
  configuration, or global macOS sandbox settings.
- No changes to any other repository.
- Protected stashes and worktrees were inspected and preserved; the only stash
  operations were transient `git stash push`/`git stash pop` cycles used to
  produce the RED baseline, always on ACT-owned files and always restored.
- No unrelated dirty file was reset, stashed, or overwritten.

## 8. Final executable gates

| Gate | Command | Exit |
|---|---|---|
| `git diff --check` | `git diff --check` | **0** (clean) |
| Core live Darwin-kernel suite | `vitest run --config vitest.config.ts src/runtime/sandbox/macos/` | **0** — 8 files, 127 passed, 2 skipped |
| apps/vscode focused suites | `vitest run --config vitest.config.ts src/sdk/command-job-manager.sandbox-c3-real-kernel.test.ts src/sdk/command-job-manager.sandbox-integration.test.ts src/sdk/sandbox-policy-production-composition.test.ts` | **0** — 3 files, 41 passed |
| Typecheck — SDK core | `bun tsc -p tsconfig.dev.json --noEmit` | **43** errors = baseline 43; **0** in changed files |
| Typecheck — apps/vscode | `bun tsc --noEmit` | **0** errors |
| Lint — apps/vscode | `bun run lint` (biome lint + proto lint) | **0** |
| Lint — SDK changed files | `biome lint --diagnostic-level=error <3 changed files>` | **0** errors (1 pre-existing "info" on an untouched line) |
| Final git status | `git status --short` | 3 modified tracked files + 2 new test files + this evidence dir — **all ACT-owned** |

### Production delta (non-comment lines)

```diff
+	const posixSemaphoreRule = "(allow ipc-posix-sem)";
+		posixSemaphoreRule,
```

Exactly one profile rule is emitted; every other profile section is byte-identical.

## 9. Review round C1 — bounded P1 corrections (both applied and proven)

Reviewer verdict was **C1: GO**, subject to two bounded test-contract corrections.

### C1-1 — the profile-snapshot evidence-emission test is now explicitly opt-in

`apps/vscode/src/sdk/__tests__/act-posix-sem01.profile-snapshot.test.ts` previously
failed an ordinary `vitest run` when `ACT_POSIX_SEM_PROFILE_OUT` was unset. It is
now `it.skipIf(!PROFILE_OUT)`, with a companion test that pins the **default**
behaviour, so the default suite neither fails nor writes into the repository.

Both behaviours proven (`profile-snapshot-optin-contract.txt`):

| Mode | Result | Exit |
|---|---|---|
| **DEFAULT** (`ACT_POSIX_SEM_PROFILE_OUT` unset) | `Test Files 1 passed (1)` / `Tests 1 passed \| 1 skipped (2)` — the emitting test is SKIPPED, nothing written | 0 |
| **OPT-IN** (`ACT_POSIX_SEM_PROFILE_OUT=/tmp/act-prof-optin2`) | `Tests 2 passed (2)`; both `production-profile-deny.sb` and `production-profile-allow.sb` emitted; `SEM_RULE_COUNT=1` in each; `DENY_NETWORK_RULE=(deny network*)`, `ALLOW_NETWORK_RULE=(allow network*)` | 0 |

Repository pollution check: `ls apps/vscode/src/sdk/__tests__/*.sb` → **none**. The
helper writes only into the directory the operator named.

### C1-2 — T4-e now installs the synthetic secrets BEFORE `prepare()`

The previous T4-e passed **vacuously**: the secrets were never placed in the
parent `process.env` before the backend materialized the child environment, so
the sanitizer had nothing to strip and the assertion was satisfied by an
unrelated path.

Corrected contract:

1. install the 4 synthetic secrets into `process.env` **before** `prepare()`;
2. assert the **parent** environment still carries them (so the test is not
   vacuous);
3. assert `prepared.env[name] === ""` — the backend's defensive
   `SECRET_BLOCKLIST` filter sets a blocked key to the **empty string**, it does
   not remove the key;
4. execute the **actual sandboxed child** and verify it observes **no secret
   value**.

With the corrected pre-condition, the child is observed to print
`AWS_SECRET_ACCESS_KEY=[]`, `AWS_ACCESS_KEY_ID=[]`, `OPENAI_API_KEY=[]`,
`ANTHROPIC_API_KEY=[]`. The **secret values are absent** — which is the
load-bearing property — while the variable names survive as empty strings
because that is how `materializeEnvironment` implements the blocklist. The
assertion was corrected to state that contract explicitly rather than assuming
the key is removed.

This correction **strengthened** the test: it now fails if the sanitizer is
bypassed, and it would have failed against the previous vacuous form.

### C1-3 — the "profile temp dir is cleaned up after deadline" failure is a pre-existing flake

One apps/vscode run reported a failure in the pre-existing test
`opt-in seatbelt: profile temp dir is cleaned up after deadline (C2-P2 hygiene
end-to-end)`. This was investigated rather than dismissed:

- **Baseline (`apps-vscode-baseline2.txt`)** — with the production change
  reverted and the C3 file alone: **3 failed (T3, T3b, T8) | 15 passed**,
  `BASELINE_EXIT=1`. The repair is load-bearing, and the cleanup test **passed**
  in that run.
- **Repeat runs** — three consecutive full apps/vscode suite runs: **41 passed,
  0 failed** each (`SUITE_EXIT=0`).
- **Root cause** — the pre-existing test scans the shared
  `/var/folders/.../T/clinemm-sandbox-profile-*` namespace for directories whose
  mtime is within the last 5 seconds and asserts the set is empty. It waits a
  fixed ~500 ms for a *deferred* cleanup hook on the deadline-exceeded job. When
  that hook fires later than the fixed wait, the leftover directory is still
  inside the 5-second mtime window and the test observes it
  (`"/var/folders/0g/.../T/clinemm-sandbox-profile-6CCHqP"`). It is a timing
  race **inside a test this ACT did not author**, and it is independent of the
  POSIX-semaphore change (the baseline run, with the change reverted, passed it).

**Conclusion:** a transient flake in a pre-existing test, not a regression from
this ACT, and not a defect in the ACT's own tests. It was not modified — the
ACT does not own that test, and changing its timing contract is out of scope for
a bounded semaphore repair. The final committed state is green across repeated
runs.
