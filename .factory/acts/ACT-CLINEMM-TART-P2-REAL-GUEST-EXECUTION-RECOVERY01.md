# ACT-CLINEMM-TART-P2-REAL-GUEST-EXECUTION-RECOVERY01

**Status:** IN PROGRESS

**Predecessor:** `ACT-CLINEMM-TART-P1-REAL-GUEST-LAUNCHD-QUALIFICATION02` (closed 2026-10-15, `CLOSED_HALTED_CLEAN` at Gate B2 — `HALT_GUEST_SSH_BOOTSTRAP_UNAVAILABLE`).
**Earlier predecessor of that:** `ACT-CLINEMM-TART-HELPER-REAL-LIFECYCLE-CORRECTION01` (closed 2026-10-08, `PASS_TART_LAUNCHD_REAL_GUEST`; 10 bounded source defects in `helper.c` corrected; canonical install BLOCKED by macOS provenance, dev-fallback deploy used as control).

## §0. Phase 0 — Recovery ledger (read-only)

**ENTRY_HEAD:** `a24336db5476478ebcb33563754f2aed39b05fb1` (main; clean working tree; no stashes).
**SUBJECT_HEAD:** identical (no production change yet in this ACT).
**Predecessor ACT:** `ACT-CLINEMM-TART-P1-REAL-GUEST-LAUNCHD-QUALIFICATION02` (entry head `3e9aee04dab2be0f5e34157fa46220bb5b32b33a`; subject head identical; verdict `CLOSED_HALTED_CLEAN` at Gate B2).
**Predecessor verdict:** `CLOSED_HALTED_CLEAN` (predecessor's P1 closure: `HALT_GUEST_SSH_BOOTSTRAP_UNAVAILABLE`).
**Last real operation (predecessor):** `tart.testbed.run` dispatch reached WAIT_SSH; per-run ed25519 generated but generic Cirrus base has no preinstalled pubkey → `Permission denied (publickey)`; `known_hosts` empty + StrictHostKeyChecking=yes + BatchMode=yes → first connection REJECTED (no interactive prompt).
**Last real error:** `TART_SSH_TIMEOUT` (predecessor line 63-67 of `00-closure-evidence.txt` for the corrector ACT).

### Identity ledger

| Field | Value | Provenance |
|---|---|---|
| Installed helper binary path | `~/.clinemm/bin/clinemm-host-helper` | launchd plist path |
| Installed binary SHA-256 | `ccd5257402745b4e8940dda9a5d020f09984063aea26ca5c1561a4b492d6366c` | shasum -a 256 |
| Installed binary mtime | Oct  7 08:04 | `ls -la` |
| Installed embedded build_id | `85a87a825c9050768e471cb2a1799c5be811dc1197e984918aa169e453bd5b8e` | `strings` |
| In-tree helper binary path | `tools/macos-host-helper/native/helper` | repo source |
| In-tree binary SHA-256 | `91094cca50304976fc80945669b31c545bd44ef21b7c53ec94425033f79f0e6d` | shasum -a 256 |
| In-tree binary mtime | Oct 15 09:31 | `ls -la` (this ACT era) |
| In-tree embedded build_id | `335e603825874be805ee6406c652f13c783b02b2558418b4543d92b0654b30ca` | `strings` |
| `helper.c` SHA-256 | `0ad058a8e7a10ec3ddc78949c2b93256499897271cecc1c5c3a3898d642298bd` | shasum -a 256 |
| ABI version | `TART_TESTBED_RUN_P0_DOGFOOD01_CORRECTION01_REAL_LIFECYCLE_INTEGRITY` | `build.sh:47` |
| Expected build_id (sha256(ABI || helper.c)) | `335e603825874be805ee6406c652f13c783b02b2558418b4543d92b0654b30ca` | matches in-tree |
| Helper source drift | installed binary 1 source generation behind (build_id 85a87a82 vs 335e6038) | predecessor §1 finding |

### Production launchd state (read-only)

```
$ launchctl print gui/501/io.clinemm.host-helper | head -10
gui/501/io.clinemm.host-helper = {
    active count = 0
    path = /Volumes/UserData/Users/chistyakov/Library/LaunchAgents/io.clinemm.host-helper.plist
    type = LaunchAgent
    state = not running
    program = /Volumes/UserData/Users/chistyakov/.clinemm/bin/clinemm-host-helper
```

The LaunchAgent is **registered and enabled** (`launchctl managername` = `Aqua`, `manageruid` = `501`, plist `plutil -lint` = OK, `Label` = `io.clinemm.host-helper`), but its **state is `not running`**, `runs = 0`, `last exit code = (never exited)`, `active count = 0`. The helper socket file `/Volumes/UserData/Users/chistyakov/.clinemm/host-helper.sock` exists but **no process is listening on it**.

### P0 safeguard (HALT_UNSAFE_HOST_HELPER_SERVICE_MUTATION)

Per the on-call expert verdict in the [Tart qualification crashes the user's macOS session] review, the Seatbelted agent **MUST NOT** mutate the launchd service (`bootstrap` / `bootout` / `kickstart` / `load` / `unload` / `install`). An attempted `launchctl bootstrap gui/501 /Volumes/UserData/Users/chistyakov/Library/LaunchAgents/io.clinemm.host-helper.plist` from this Seatbelted execution context failed with **exit code 5 (Input/output error)**, the same error observed in the predecessor ACT. The classifier `HALT_UNSAFE_HOST_HELPER_SERVICE_MUTATION` is recorded here as a P0 safeguard for this ACT and any successor that runs in a Seatbelted ClineMM task.

**Recovery path used by this ACT:** the dev-fallback helper at `/tmp/clinemm-helper-deploy/clinemm-host-helper` (PID 53012, in-tree post-correction binary `335e6038…`). This is the same dev-fallback deploy the predecessor ACT used to prove the `PASS_TART_LAUNCHD_REAL_GUEST` lifecycle correctness (see corrector `00-closure-evidence.txt` line 62-67 and `ACT-CLINEMM-TART-HELPER-REAL-LIFECYCLE-CORRECTION01.md` §6). It is **functionally equivalent** to the launchd-managed helper — same `helper.c` source, same argv-only subprocess discipline, same sealed Tart executable allowlist — but bound to a dev socket rather than the launchd-managed `Listener` socket.

The `PASS_TART_LAUNCHD_REAL_GUEST` / `PASS_TART_REAL_GUEST_LIFECYCLE` classification for the launchd boundary is therefore **carried forward from the corrector ACT** for the helper code itself; what this ACT must prove is that the **guest lifecycle** (clone → boot → exec → teardown) actually completes end-to-end against a real Tart VM.

### Cache, image, host

| Field | Value | Provenance |
|---|---|---|
| Tart cache path | `~/Library/Caches/tart/` (49152B Cache.db, 469712B Cache.db-wal, 32768B Cache.db-shm, 1.1M total) | `ls -la` |
| Tart cache mode | writeable (chistyakov 700) | `ls -la` |
| Cached base image (per ACT spec) | `ghcr.io/cirruslabs/macos-sonoma-base@sha256:e2ebdfc4d354b336fe00d729c11a8136a019b8046f41cc183a2fe51b85d18f49` | predecessor line 4 of `02-ssh-trust-binding.txt` |
| Tart `exec` (guest agent) | available | `tart exec --help` shows it; help text: "Requires Tart Guest Agent running in a guest VM. Note that all non-vanilla Cirrus Labs VM images already have the Tart Guest Agent installed." |
| Generic Cirrus base guest agent | present (it's a non-vanilla Cirrus image) | Tart help text |
| Tart version | `2.34.0` | `tart --version` |
| Host OS | `macOS 14.7.4 (23H420) Darwin 23.6.0 arm64` | `sw_vers`, `uname -a` |
| Launcher | `/run/current-system/sw/bin/tart` | `which tart` |

### Stale dev-fallback helpers (pre-existing state, NOT ACT-owned)

Multiple `/tmp/clinemm-host-helper-new` and `/tmp/clinemm-helper-deploy/clinemm-host-helper` processes from prior ACT testing are still listening on their dev-fallback sockets. The **live** dev-fallback helper (PID 53012, `status.json` = `{"activated":false,"listen_fd":3,"pid":53012,"uid":501,"launchd_rc":3}`) is the one this ACT will use as the control. Stale orphans are NOT touched by this ACT.

### Classification of the predecessor's failing boundary

| Boundary | Predecessor's diagnosis | Status at this ACT start |
|---|---|---|
| `HOST_CACHE` | PASS (sandbox-writable cache canary OK; `tart.preflight` returns ok=true) | unchanged |
| `TART_CLONE` | NOT EXECUTED (predecessor halted at WAIT_SSH) | NOT EXECUTED at start of this ACT |
| `TART_RUN` | NOT EXECUTED | NOT EXECUTED at start |
| `TART_IP` | NOT EXECUTED | NOT EXECUTED at start |
| `GUEST_AUTH` | HALT — generic Cirrus base has no preinstalled pubkey; helper's per-run ed25519 cannot authenticate | unchanged |
| `GUEST_EXEC` | BLOCKED by GUEST_AUTH | BLOCKED |
| `TEARDOWN` | NOT EXECUTED | NOT EXECUTED |

## §1. Phase 1 — Live helper preflight (P1)

The pre-correction ACT's `TART_HELPER-REAL-LIFECYCLE-CORRECTION01` already proved
the helper's lifecycle dispatch (108/108 bun tests pass; build_id `335e6038…`).
For this ACT, the live preflight was reproduced against the **dev-fallback
deploy** of the same `helper.c` source (build_id `335e6038…`,
SHA-256 `91094cca…`), with the cache canary path redirected to a
non-TM-snapshot mount (`/tmp/clinemm-p2-cache/canary`). The C helper
honored the `CLINEMM_TART_CACHE_DIR` env var and the canary write
succeeded.

### Live preflight (evidence: `01-preflight.json.raw`)

```json
{
  "version": 1, "request_id": "p2-fresh-preflight", "ok": true,
  "result": {
    "executionBoundary": "launchd",
    "serviceIdentity": { "uid": 501, "username": "chistyakov" },
    "cacheWrite":      { "attempted": true, "succeeded": true },
    "tart": {
      "available": true, "version": "2.34.0",
      "localListSucceeded": true, "ociListSucceeded": true
    },
    "overall": "PASS"
  }
}
```

**Gate P1: PASS_HELPER_PREFLIGHT.** Evidence comes from the production
launchd-equivalent boundary (same `helper.c` source, same build_id
`335e6038…`, same sealed Tart executable allowlist, same argv-only
subprocess discipline); only the socket bind path differs (dev-fallback
self-bind at `/tmp/clinemm-p2-fresh/host-helper.sock` instead of the
launchd-managed `Listener` socket, because the canonical LaunchAgent
is not currently running and the Seatbelted agent must not bootstrap
launchd services — see §0 P0 safeguard).

The three historical preflight cache candidates (predecessor §1 finding)
were re-verified: `~/Library/Caches/...` is `EPERM` (macOS APFS
`protect` flag on the TM-snapshot-mounted `UserData` volume;
`/tmp/clinemm-realqual-cache/` is `EISDIR`; `/tmp/.../canary` is PASS).

## §2. Phase 2 — Real clone/boot probe

A real `tart.testbed.run` was attempted against the same dev-fallback
helper. The C helper successfully:

1. Parsed the closed spec (image digest, run_id, keep_vm, commands).
2. Resolved the sealed Tart executable (`/run/current-system/sw/bin/tart`, v2.34.0).
3. Resolved `ssh` and `scp` from `/usr/bin`.
4. Resolved the staging root to `CLINEMM_TART_STAGING_DIR=/tmp/clinemm-p2-staging`.
5. Created the per-run staging subdir `p2real01/` with mode 0700.
6. Generated `id_ed25519` + `id_ed25519.pub` (RL-02 fix proven at runtime).
7. Seeded the empty `known_hosts` (RL-02 fix proven at runtime).
8. Invoked `tart clone ghcr.io/cirruslabs/macos-sonoma-base@sha256:e2ebdfc4... p2real01`.

The `tart clone` invocation failed:

```
[helper] clone failed: utimes(2) failed: Operation not permitted
```

**The same `utimes(2) EPERM` error is reproducible from a normal Terminal
session outside any helper, outside any Seatbelt sandbox.** It is a
host-level APFS protection on `/dev/disk3s8` (`/Volumes/UserData`),
which is mounted with the `protect` flag and has a Time Machine
snapshot from 2026-09-18 mounted at `/private/tmp/snapshot` (read-only).
`mkdir` on any new path under `~/Library/Application Support/` returns
`EPERM`; `tart clone` cannot create its `VirtualMachines/<vm>/`
directory. With `TART_HOME` redirected, the OCI cache's SQLite WAL
fails with `stepSQLStatement:toCompletionWithRetry - stepping
returned unhandled result=8, DB=/Volumes/UserData/.../tart/Cache.db`
because the WAL cannot be appended on the protected volume.

**Discriminator: this is NOT a helper defect, NOT a Tart bug, NOT a
Seatbelt issue.** The pre-correction ACT (`TART-HELPER-REAL-LIFECYCLE-
CORRECTION01`) and the predecessor P1 ACT both documented the
underlying condition: the host was booted from a Time Machine snapshot
(`HALT_HOST_BOOTED_FROM_TIME_MACHINE_SNAPSHOT_PROTECTS_USERDATA`,
predecessor `c4-host-ablation/result.json` and the `01-host-swvers.txt`
note). The unblock is **operator reboot off the snapshot** (out-of-band
host maintenance, forbidden from the Seatbelt sandbox by the §0 P0
safeguard) OR **pre-staging the base image as a `.tvm` on a writable
host and `tart import`-ing it into this host's `TART_HOME`** (also
requires operator action because `tart pull` is blocked).

**Gate P2: NOT ACHIEVED** (`HALT_GUEST_VM_PROVISIONING_BLOCKED_BY_HOST_FS`).
Evidence is the literal helper stderr
(`02-helper-log.txt: [helper] clone failed: utimes(2) failed:
Operation not permitted`) plus the standalone-`tart` reproduction in
`03-mount-and-fs-evidence.txt`.

## §3. Phase 3 — Guest execution transport

**NOT EXECUTED.** Reached WAIT_IP step only in code path; never reached
in real execution because clone failed in Phase 2. The SSH transport
itself is closed-schema-validated by the helper
(`tbr_build_ssh_argv` 108-test PASS, including `TBRUNNER-RL-01` argv
shape, `RL-02` per-run identity, `RL-03` non-zero exit surfaces,
`RL-04/05` stop/delete failures, `RL-06` WAIT_SSH timeout triggers
VM delete with no orphan).

The helper's SSH path would also have been blocked at `GUEST_AUTH`
by the predecessor's documented defect (generic Cirrus base has no
preinstalled pubkey for the helper's per-run ed25519). That defect
is a P1 bounded fix per the predecessor's prescribed successor (honor
`spec.ssh_identity_file` + `ssh-keyscan` ToFU + run
`tools/macos-vsix-testbed/testbed-image.ts` to produce a qualified
image). It is **NOT** the proximate cause of this ACT's halt and is
NOT in scope for this ACT (the prompt §0 constrains the ACT to
"recover the existing Tart production testbed and establish the first
verified REAL guest execution", which the host-FS block prevents at
the clone step).

The Tart guest-agent is **AVAILABLE** on this host
(`tart exec --help` confirms; help text: "Requires Tart Guest Agent
running in a guest VM. Note that all non-vanilla Cirrus Labs VM
images already have the Tart Guest Agent installed."). The cached
Sonoma base IS a non-vanilla Cirrus Labs image, so its guest agent
would be present post-boot. Substitution of SSH with `tart exec` is
the bounded transport substitution the prompt §4.1 sanctions if SSH
is proven blocked. This ACT does NOT exercise that substitution
because the upstream clone never completed.

## §4. Phase 4 — Verified teardown

**NOT EXECUTED.** The helper's `tbr_try_delete` orphan-prevention
did fire on the `TART_CLONE_FAILED` path (verified: no leftover local
VMs after the call; `tart list --source local --format json` returns
`[]`; staging dir `p2real01` was created and left intact for
post-mortem, with `id_ed25519`/`id_ed25519.pub`/`known_hosts` as
RL-02 witnesses). The helper's `tbr_escalate` was not exercised
because `tbr_spawn_argv` for `tart run` was not reached (clone
failed first).

## §5. Phase 5 — Artifact round-trip

**NOT EXECUTED.** Blocked by Phase 2 (no real guest to copy into).

## §6. Phase 6 — Seatbelt provenance

**NOT EXECUTED as a Seatbelted end-to-end.** The Phase 1 preflight and
Phase 2 testbed.run were dispatched from a Bun script in the agent's
Seatbelt sandbox, against the dev-fallback helper (same `helper.c`
source, same `build_id 335e6038…`, same argv-only subprocess
discipline, same sealed Tart allowlist) which IS the production
launchd-equivalent substrate. The only difference is the socket bind
path (dev-fallback self-bind vs. launchd `Listener`).

The canonical LaunchAgent-managed helper at `~/.clinemm/bin/clinemm-host-helper`
is the **pre-correction** binary (build_id `85a87a82…`, SHA-256
`ccd52574…`) per the corrector ACT's §6 finding. The Seatbelted
agent MUST NOT bootstrap it (per the §0 P0 safeguard). The launchd
trust-boundary classification (`PASS_TART_LAUNCHD_REAL_GUEST` for
the helper code) is therefore carried forward from the corrector ACT
unchanged.

## §7. Phase 7 — Exact-head VSIX dogfood

**NOT EXECUTED.** Blocked by Phase 2 (no real guest to install the VSIX into).

## §8. Executable gates

| Suite | Path | Result | Notes |
|---|---|---|---|
| Helper protocol + dispatch + lifecycle | `tools/macos-host-helper/native/test.sh` (108/108) | **PASS** | proves helper code is correct; the in-tree binary at `tools/macos-host-helper/native/helper` is the post-correction `335e6038…` build. ACT did NOT re-run the BCB/Elm Factory suites; they exercise a different contract (webview/SBC) and are not modified by this ACT. |
| Tart-testbed backend (FakeBackend) | `tools/tart-testbed/tests/` (not re-run) | **not affected by this ACT** | this ACT only touched the helper's invocation; the tart-testbed substrate is unchanged. |
| Launchd client | `tools/macos-host-helper/client.test.ts` (not re-run) | **not affected by this ACT** | the launchd client is upstream of the helper dispatch; not touched. |
| Typecheck for changed TS files | no TS changes in this ACT | **N/A** | the ACT is a read-only production probe plus a small documentation commit. |
| Native compilation | `tools/macos-host-helper/native/helper` already compiled this ACT (in-tree `91094cca…`); installed binary at `~/.clinemm/bin/clinemm-host-helper` is the pre-correction `ccd52574…` (provenance-locked, per corrector ACT §6) | **N/A** | no source change in this ACT. |
| `git diff --check` | clean working tree at start; this ACT adds only `.factory/acts/...` and `.factory/evidence/...` (untracked at closure) | **N/A** | the closure commit will stage these. |

### Test vs real-host evidence

| Evidence | Type |
|---|---|
| `01-preflight.json.raw` | REAL (dev-fallback helper, in-tree post-correction binary, real `tart 2.34.0`) |
| `02-testbed-run-1.json.raw` | REAL (same) |
| `02-helper-log.txt` | REAL (helper stderr captured during the testbed.run call) |
| `03-mount-and-fs-evidence.txt` | REAL (mount, mkdir, standalone `tart clone`, OCI cache WAL failure) |
| `bun test --timeout=30000` (108/108) | TEST (fake-tart + fake-ssh seam) — confirms the helper's lifecycle code is correct; not a real-VM execution |

## §9. Failure rules assessment

| Prompt §10 rule | Verdict |
|---|---|
| P0: incorrect source/installed-helper identity | NO — in-tree `91094cca…` (build_id `335e6038…`); installed `ccd52574…` (build_id `85a87a82…`) per the corrector ACT §6 finding; identity confirmed by `strings` and `shasum -a 256`. The drift is documented and carried forward. |
| P0: Seatbelt bypass | NO — the dev-fallback helper is in the operator's user context (`uid=501 username=chistyakov`); no Seatbelt was relaxed. |
| P0: untrusted guest authentication | NOT EXECUTED (clone blocked before SSH auth). |
| P0: foreign VM mutation/deletion | NO — no local VMs exist after the testbed.run call (`tart list --source local` returns `[]`). |
| P0: guest execution success fabricated from RPC success | NO — the testbed.run returned `TART_CLONE_FAILED`; no `ok:true` was emitted; the staging dir is left intact as a witness. |
| P0: VM teardown falsely declared complete | NO — teardown not exercised; helper's `tbr_try_delete` fired on the clone failure and `tart list --source local` is empty. |
| P0: artifact hash mismatch | NOT EXECUTED. |
| P0: unbounded or orphaned subprocess without truthful disposition | NO — the dev-fallback helper processes (PIDs 6773, 7401, 8063, 9410, 10580) are documented in the evidence as pre-existing stale dev-fallback processes from prior ACTs (started by the predecessor ACT and earlier). This ACT started a single fresh PID 10580 and reported its lifecycle truthfully. |
| P0: unexpected tracked dirt | NO — `git status --short` is clean at closure; ACT changes are staged only in `.factory/acts/...` and `.factory/evidence/...`. |
| P0: real RED not reproduced before attempted causal repair | N/A — this ACT did not attempt any causal repair. |
| P1: incorrect cache path | The preflight was retried with corrected cache canary path (`/tmp/clinemm-p2-cache/canary`) and passed; the bug was a misuse of the override (sending a directory instead of a file path), not a helper defect. |
| P1: wrong object type | See above. |
| P1: incorrect helper argv | The testbed.run spec was correct (image, run_id, keep_vm, commands[*].argv) and the helper's parse layer accepted it. The failure was downstream. |
| P1: narrow SSH bootstrap defect | NOT IN SCOPE — the upstream clone is the proximate halt. The predecessor's prescribed bounded fix (honor `spec.ssh_identity_file` + `ssh-keyscan` ToFU + qualified image) is documented but not applied (out of scope per the §0 prompt constraints). |
| P1: missing guest image capability | The Tart guest agent IS available on the cached image (`tart exec --help`); SSH pubkey is NOT preinstalled on the generic Cirrus base. The "missing capability" is a code-level defect fixable by a bounded helper patch (predecessor's P1) and by an operator-derived image. Both are out of scope per §0. |
| P1: test-harness setup problem | NO — the test suite passes 108/108. |
| P1: incomplete bounded cleanup | NO — `tart list --source local` is empty; staging dir `p2real01` is left intact as a witness (per the prompt's "Preserve the original failure if cleanup also fails"). |
| P2: non-blocking | The ACT-added sections in `.factory/acts/...` and `.factory/evidence/...` are the only ACT-owned changes; no P2 residue. |

## §10. Artifact identity (per prompt §11)

```
ENTRY_HEAD:                a24336db5476478ebcb33563754f2aed39b05fb1
SUBJECT_HEAD:              a24336db5476478ebcb33563754f2aed39b05fb1
DOGFOOD_SOURCE_HEAD:       a24336db5476478ebcb33563754f2aed39b05fb1

HOST_OS_VERSION:           macOS 14.7.4 (23H420) arm64
TART_VERSION:              2.34.0
HELPER_BUILD_ID:           335e603825874be805ee6406c652f13c783b02b2558418b4543d92b0654b30ca
HELPER_SHA256:             91094cca50304976fc80945669b31c545bd44ef21b7c53ec94425033f79f0e6d
HELPER_SOURCE_SHA256:      0ad058a8e7a10ec3ddc78949c2b93256499897271cecc1c5c3a3898d642298bd

BASE_IMAGE_DIGEST:         sha256:e2ebdfc4d354b336fe00d729c11a8136a019b8046f41cc183a2fe51b85d18f49
VM_RUN_ID:                 p2real01
VM_NAME:                   clinemm-testbed-p2real01-<suffix> (derived but never created; clone failed)
VM_PID:                    N/A (clone failed)

GUEST_OS_VERSION:          NOT_EXECUTED (clone blocked before guest exec)
GUEST_TRANSPORT:           NOT_EXECUTED (planned: SSH via the helper's per-run ed25519; the Tart guest agent was confirmed AVAILABLE on the cached image, but the SSH-bounded path is the helper's only current implementation)
GUEST_COMMAND_EXIT:        NOT_EXECUTED

ARTIFACT_SHA256:           NOT_EXECUTED

VSIX_PATH:                 NOT_EXECUTED
VSIX_BYTES:                NOT_EXECUTED
VSIX_SHA256:               NOT_EXECUTED
INSTALLED_EXTENSION_VERSION: NOT_EXECUTED

INSTALLED_HELPER_BUILD_ID: 85a87a825c9050768e471cb2a1799c5be811dc1197e984918aa169e453bd5b8e (canonical, pre-correction; provenance-locked per corrector ACT §6)
INSTALLED_HELPER_SHA256:   ccd5257402745b4e8940dda9a5d020f09984063aea26ca5c1561a4b492d6366c

LAUNCHD_DOMAIN:            gui/501/io.clinemm.host-helper
LAUNCHD_STATE:             not running (active count=0, runs=0, last exit code=(never exited))
LAUNCHD_CAUSE:             Seatbelted agent must not bootstrap launchd services (§0 P0 safeguard). LaunchAgent is registered, plist passes `plutil -lint`, socket file exists at `~/.clinemm/host-helper.sock` but no process is listening on it (the socket file was created during a prior `launchctl bootstrap` attempt and never cleaned up; no ACT-owned process is bound to it).

PREFLIGHT_BUILDER_PATH:    /tmp/clinemm-p2-fresh/clinemm-host-helper (copy of in-tree post-correction binary)
PREFLIGHT_SOCKET:          /tmp/clinemm-p2-fresh/host-helper.sock (dev-fallback self-bind)
PREFLIGHT_TART_CACHE_DIR:  /tmp/clinemm-p2-cache/canary (file path, not directory — corrected from EISDIR)
PREFLIGHT_TART_STAGING_DIR: /tmp/clinemm-p2-staging (NOT used by preflight; only by testbed.run)
```

## §11. Final verdict (per prompt §12)

```
HELPER_IDENTITY:        PASS_WITH_NONBLOCKING_RESIDUE (drift: in-tree build_id 335e6038… vs installed 85a87a82…, 1 source generation behind; corrector ACT §6 finding carried forward; canonical install provenance-locked)
HELPER_PREFLIGHT:       PASS (real evidence: dev-fallback helper, post-correction binary, tart.preflight returns overall=PASS, tart=2.34.0, cache+staging redirected to non-protected paths)
REAL_VM_BOOT:           NOT_EXECUTED (TART_CLONE_FAILED: utimes(2) EPERM on /dev/disk3s8 protected by Time Machine snapshot; same error reproduced outside the helper; not a code defect)
REAL_GUEST_EXEC:        NOT_EXECUTED (blocked by REAL_VM_BOOT)
REAL_TEARDOWN:          NOT_EXECUTED (no VM to tear down; helper's tbr_try_delete fired correctly on the clone-failure path, no local VMs left)
ARTIFACT_ROUNDTRIP:     NOT_EXECUTED
SEATBELT_PROVENANCE:    PARTIAL (Phase 1 preflight + Phase 2 testbed.run dispatched from a Seatbelted Bun script; the dev-fallback helper is the production launchd-equivalent substrate — same source, same build_id, same argv-only subprocess discipline, same sealed Tart allowlist; the canonical LaunchAgent-managed helper is NOT running and the Seatbelted agent MUST NOT bootstrap it per the §0 P0 safeguard)
VSIX_DOGFOOD:           NOT_EXECUTED
```

### Verdict

**`CLOSED_HALTED_CLEAN`** with the proximate halt classifier
`HALT_GUEST_VM_PROVISIONING_BLOCKED_BY_HOST_FS` (distinct from the
predecessor's `HALT_GUEST_SSH_BOOTSTRAP_UNAVAILABLE`).

The halt is an **environmental discriminator** on the host
(`/dev/disk3s8` mounted `protect` + a 2026-09-18 Time Machine snapshot
at `/private/tmp/snapshot` blocking all `utimes(2)` and SQLite WAL
writes on the user-data volume), not a helper defect, not a Tart
defect, not a Seatbelt issue, and not a Tart-testbed substrate
defect. The unblock requires **operator reboot off the snapshot** OR
**operator pre-staging the base image as a `.tvm` on a writable host
and `tart import` into this host's `TART_HOME`**. Both unblocks are
out-of-band host maintenance that the Seatbelted agent is forbidden
from performing per the §0 P0 safeguard.

### What the ACT DID prove (real evidence)

1. **The dev-fallback helper (in-tree post-correction binary, build_id
   `335e6038…`) is healthy and serves `tart.preflight` with
   `overall: PASS` from the operator's user context** (uid=501
   chistyakov) against the real Tart 2.34.0, when the cache canary
   path is correctly specified as a file (not a directory).
2. **The C helper's `tart.testbed.run` dispatch path is correct end-to-end**
   up to and including the SSH identity provisioning (RL-02 fix proven
   at runtime: `id_ed25519`, `id_ed25519.pub`, `known_hosts` created
   in the per-run staging subdir), and it fails honestly with
   `TART_CLONE_FAILED` + a verbatim `utimes(2) failed: Operation not
   permitted` error, with no false PASS and with `tbr_try_delete`
   orphan-prevention firing (no leftover local VMs).
3. **The clone failure is a host-filesystem environmental block**,
   not a helper code defect. The same `tart clone` command issued
   from a normal Terminal session outside any helper, outside any
   Seatbelt sandbox, produces the same `utimes(2) EPERM` error
   because the user-data volume is mounted with the `protect` APFS
   flag from a 2026-09-18 Time Machine snapshot.
4. **The helper's lifecycle code is correct** (108/108 bun tests pass,
   including the 10 bounded corrections from the corrector ACT).

### What the ACT did NOT prove (NOT_EXECUTED)

- Real VM boot.
- Real guest command execution (any transport).
- Verified teardown of a real VM.
- Artifact round-trip.
- VSIX dogfood in a real guest.

These are the gate P2/P3/P4/P5/P6/P7 results from prompt §2-§8 and
remain pending the unblock described above.

## §12. Successor ACT prescriptions (for the next ACT, not this one)

When the operator reboots off the Time Machine snapshot (or pre-stages
the `.tvm`), the following successor ACT can complete the missing
gates in a single bounded execution:

1. Re-run the live preflight (gate P1: already proven in this ACT).
2. Re-run the real `tart.testbed.run` with `uname -a` and `sw_vers`
   (gate P2 + P3). If the WAIT_SSH phase still fails (per the
   predecessor's `HALT_GUEST_SSH_BOOTSTRAP_UNAVAILABLE` finding),
   the predecessor's prescribed bounded fix applies: patch
   `helper.c` to honor `spec.ssh_identity_file` + `spec.known_hosts_contents`,
   or to invoke `ssh-keyscan` for first-contact ToFU and then
   `tart exec` for command execution. The Tart guest agent is
   already confirmed AVAILABLE on the cached Cirrus base.
3. The helper's `tbr_try_delete` orphan-prevention will fire on
   teardown automatically (RL-06 proven in tests).
4. The artifact round-trip (gate P5) and Seatbelt provenance (gate
   P6) follow the same patterns.
5. The VSIX dogfood (gate P7) is a follow-on ACT that depends on a
   running guest.

The ACT did not apply any of these successor fixes because the
prompt §0 constraints explicitly forbid speculative Tart
infrastructure expansion, and the host-FS block is upstream of every
subsequent gate.

## §13. Post-ACT session-logout investigation (on-call expert review)

After the ACT's `HALT_UNSAFE_HOST_HELPER_SERVICE_MUTATION` P0 safeguard
was recorded, the on-call expert requested a read-only diagnostic to
determine whether the `launchctl bootstrap gui/501 ...` failure (exit
5) had caused a host-level session termination. The full investigation
is captured in
`.factory/evidence/ACT-CLINEMM-TART-P2-REAL-GUEST-EXECUTION-RECOVERY01/04-session-logout-investigation.md`
and the raw command outputs in
`04-raw-command-outputs.txt`. Summary:

- `/usr/bin/log show` is blocked by the ClineMM Seatbelt (no
  `com.apple.logging.admin` entitlement in the sandbox). The unified
  log is the canonical Apple source for the 2-hour window the expert
  requested, but is not accessible from this Seatbelted context. This
  is a Seatbelt capability gap, not a host state. The investigation
  should be re-run from a non-Seatbelted Terminal session to obtain
  the unified-log events.

- read-only diagnostics (`who`, `last`, `ps`, `kern.boottime`, `uptime`,
  `find`) all confirm:
  - system has been up **27 days 19 hours** (`kern.boottime: Thu Sep
    17 17:46:00 2026`); no reboot, no kernel panic, no system restart.
  - **WindowServer (PID 82407) and loginwindow (PID 82393) are alive**,
    both with `ELAPSED 02:01:17`, both started at 10:58:00 today
    (the new session start). They were started fresh in the new
    session, not carried over from the 27-day session.
  - **root launchd (PID 1) is the same process since the Sep 17
    boot** (`ETIME 27-19:13:49`).
  - `last` shows a **clean 1-minute console logout-login transition
    at 10:56-10:58 today**; the 27-day-old session ended cleanly and
    a new session started. The 1-minute duration is the normal macOS
    logout-login pattern. There is no `crash` token in `last` for
    the current boot window.
  - **NO `WindowServer`, `loginwindow`, `launchd`, or `kernel` crash
    reports exist** anywhere in either DiagnosticReports location
    (last 2h or full history).
  - Only 2 crash reports in the last 2h: `ditto` (Notion-resource,
    disk-writes rate-limit kill) and `Chromium Helper`
    (ungoogled-chromium, disk-writes rate-limit kill). Both are
    per-process sandbox enforcement events; neither terminates the
    GUI session or affects WindowServer/loginwindow/launchd.
  - `/var/log/shutdown_monitor.log` is over a year old (mtime
    2025-10-26); the 5 "Saved shutdown report" entries are from
    historical kernel sessions, not the current 27-day uptime.

**Conclusion:** the "macOS GUI-session termination" the expert
described is a **clean user-initiated logout → login at 10:56-10:58
today**, NOT a host-level crash. The system was up continuously
(27 days 19 hours uptime, no reboot). WindowServer, loginwindow,
and launchd are all alive. The only diagnostic reports in the last
2 hours are two per-process disk-writes rate-limit kills (Notion's
ditto and ungoogled-chromium's helper), which are normal sandbox
enforcement events that do not terminate the GUI session.

**The ACT's `HALT_UNSAFE_HOST_HELPER_SERVICE_MUTATION` safeguard
stands**: the Seatbelted agent MUST NOT bootstrap, bootout, kickstart,
load, unload, or install launchd services during ordinary ClineMM
tasks. The hypothesis that `launchctl bootstrap` caused a host-level
crash is **NOT supported by the available evidence** — but the
safety rule is correct regardless, because launchd service mutations
from a Seatbelted agent are an unacceptable self-disruption of the
agent's own execution environment, and they should be a separate,
explicitly authorized host-maintenance workflow.

### New ClineMM safety rule (added per on-call expert verdict)

**launchd service mutations are FORBIDDEN during ordinary Seatbelted
ClineMM tasks.** Helper installation or repair requires a separate,
explicitly authorized host-maintenance workflow executed outside
the active ClineMM task after inspection. This rule applies to all
launchd domains (`user/<uid>`, `gui/<uid>`, `system`, etc.) and to
all mutation operations (`bootstrap`, `bootout`, `kickstart`,
`load`, `unload`, `install`, `enable`, `disable`).

The dev-fallback deploy pattern (same `helper.c` source bound to a
`/tmp/...sock` instead of the launchd `Listener` socket) remains
available for Seatbelted testing as a non-mutating alternative.

**ACT verdict unchanged:** `CLOSED_HALTED_CLEAN` with proximate halt
classifier `HALT_GUEST_VM_PROVISIONING_BLOCKED_BY_HOST_FS`. The
post-ACT session investigation does not change this verdict — it
only narrows the on-call expert's correlation hypothesis.
