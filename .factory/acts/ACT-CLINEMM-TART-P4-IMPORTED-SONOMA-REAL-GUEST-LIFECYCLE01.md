# ACT-CLINEMM-TART-P4-IMPORTED-SONOMA-REAL-GUEST-LIFECYCLE01

**Status:** IN PROGRESS (Phase 1 complete; Phases 2-6 awaiting operator-side
guest boot per the on-call expert verdict).

**Predecessor lineage (operator-unblocked):**

| ACT | Verdict | Date |
|---|---|---|
| ACT-CLINEMM-TART-HELPER-REAL-LIFECYCLE-CORRECTION01 | `PASS_TART_LAUNCHD_REAL_GUEST` | 2026-10-08 |
| ACT-CLINEMM-TART-P1-REAL-GUEST-LAUNCHD-QUALIFICATION02 | `CLOSED_HALTED_CLEAN` (`HALT_GUEST_SSH_BOOTSTRAP_UNAVAILABLE`) | 2026-10-15 |
| ACT-CLINEMM-TART-P2-REAL-GUEST-EXECUTION-RECOVERY01 | `CLOSED_HALTED_CLEAN` (`HALT_GUEST_VM_PROVISIONING_BLOCKED_BY_HOST_FS`) | 2026-10-15 |
| ACT-CLINEMM-TART-P3-OFFLINE-IMAGE-IMPORT-QUALIFICATION01 | `CLOSED_HALTED_CLEAN` (`HALT_TRUSTED_IMAGE_ARCHIVE_UNAVAILABLE`) | 2026-10-15 |
| (P3 addendum — operator unblock) | enabled P4 | 2026-10-15 |

**Operator unblock (verbatim, from the Tart virtualization engineer +
Factory reviewer verdict, 2026-10-15):**

> The resumption agent's stale snapshot is reconciled. The trusted
> `.tvm` archive (20,239,886,814 bytes, SHA-256
> `1eaed5f2fbed1b0118e32edace0896b4a427c41bdff09af2d13b271ec3dfba7c`,
> magic `pbze` = tart export v16) is now at
> `/private/tmp/clinemm-tart-p3-archive-20261015T131912Z-30833/sonoma-base.tvm`,
> and `tart list --source local` under
> `TART_HOME=/private/tmp/clinemm-tart-p3-20261015T131912Z-30833` reports
> the imported VM `clinemm-p3-sonoma-imported` in state `stopped`, Size
> 27 GiB, Disk 50 GiB, Accessed 2026-10-15T13:48:41Z. C1: GO — P4 IS
> AUTHORIZED.

**Goal:** boot the operator-imported `clinemm-p3-sonoma-imported` VM, run
guest commands via `tart exec` (Tart Guest Agent, no SSH), and verify a
clean shutdown — proving the real-guest lifecycle end-to-end on a
non-provisioned, non-corrupted, operator-trusted image. After the boot
qualifies, attempt the existing trusted-helper lifecycle (helper
dispatch → guest exec through the sealed-Tart allowlist) on the same
imported VM.

## §0. Mission

```text
Operator-trusted, imported Sonoma VM (clinemm-p3-sonoma-imported)
    ↓
tart run --no-graphics  (operator side; non-Seatbelted terminal)
    ↓
tart exec <vm> /usr/bin/sw_vers   (Tart Guest Agent, no SSH)
tart exec <vm> /usr/bin/uname -a
    ↓
Verified guest identity + clean exit codes
    ↓
tart stop <vm>   (clean shutdown, VM preserved)
    ↓
[ONLY THEN] Helper dispatch → sealed-allowlist exec (trusted-helper lifecycle)
    ↓
Conservation: no launchd mutation, no Seatbelt relaxation, no
replacement helper, no deleted VM, no Elm/completion-authority drift
```

**One VM, one boot, one exec pair, one shutdown, one helper-dispatch.**
No SSH bootstrap. No public-key injection. No `tart clone`. No
`tart pull`.

## §1. P0 / P1 / P2 / Seatbelt / launchd preconditions (PASS at ACT start)

| Rule | Status | Evidence |
|---|---|---|
| `HALT_UNSAFE_HOST_HELPER_SERVICE_MUTATION` | ENFORCED — no `launchctl bootstrap/bootout/kickstart/load/unload/install` will be issued by this ACT | this ACT §1 |
| `HALT_UNSAFE_SEATBELT_RELAXATION` | ENFORCED — no Seatbelt profile changes; the agent runs with the Seatbelted task profile throughout | this ACT §1 |
| `HALT_DELETE_PRODUCTION_VM` | ENFORCED — the imported VM `clinemm-p3-sonoma-imported` will NOT be deleted or renamed; only `tart run` / `tart exec` / `tart stop` (verified shutdown) | this ACT §1 |
| `HALT_REPLACE_TRUSTED_HELPER` | ENFORCED — the in-tree `helper.c` source and the dev-fallback binary (build_id `335e6038…`, SHA-256 `91094cca…`) are unchanged; the launchd-managed helper at `~/.clinemm/bin/clinemm-host-helper` is also unchanged | Phase 0 ledger §0.1 below |
| `HALT_ELM_OR_COMPLETION_AUTHORITY_DRIFT` | ENFORCED — no Elm source change, no completion-authority source change, no controller/task state shadow | this ACT §1 |

### §0.1 Identity ledger (read-only)

| Field | Value | Provenance |
|---|---|---|
| Imported VM `TART_HOME` | `/private/tmp/clinemm-tart-p3-20261015T131912Z-30833` | operator; re-verified by resumption agent |
| Imported VM name | `clinemm-p3-sonoma-imported` | operator; re-verified by resumption agent |
| Imported VM state | `stopped` | `tart list --source local --format json` under the isolated TART_HOME |
| Imported VM Size | 27 GiB | same |
| Imported VM Disk | 50 GiB | same |
| Imported VM last Accessed | 2026-10-15T13:48:41Z | same |
| Imported source archive | `/private/tmp/clinemm-tart-p3-archive-20261015T131912Z-30833/sonoma-base.tvm` (20,239,886,814 bytes) | resumption session move |
| Imported source archive SHA-256 | `1eaed5f2fbed1b0118e32edace0896b4a427c41bdff09af2d13b271ec3dfba7c` | `shasum -a 256` re-verified by resumption session |
| Imported source archive sidecar | `…/SHA256SUMS` (270 bytes; records the operator-verified hash) | resumption session write |
| Imported source digest (OCI) | `ghcr.io/cirruslabs/macos-sonoma-base@sha256:e2ebdfc4d354b336fe00d729c11a8136a019b8046f41cc183a2fe51b85d18f49` | pinned in P3 §1 |
| Tart version | `2.34.0` | `tart --version` |
| Host OS | `macOS 14.7.4 (23H420) Darwin 23.6.0 arm64` | `sw_vers`, `uname -a` |
| `tart exec` availability | documented to require Tart Guest Agent; Cirrus non-vanilla images include it | `tart exec --help` |
| Generic Cirrus base guest agent | present (it's a non-vanilla Cirrus image) | Tart help text |
| Helper binary (in-tree) | `tools/macos-host-helper/native/helper` (build_id `335e6038…`, SHA-256 `91094cca…`) | re-verify in Phase 0.2 |
| Helper binary (installed) | `~/.clinemm/bin/clinemm-host-helper` (build_id `85a87a82…`, SHA-256 `ccd52574…`) | re-verify in Phase 0.2 |
| `helper.c` SHA-256 | `0ad058a8…298bd` (unchanged from P2 ledger) | re-verify in Phase 0.2 |
| Production launchd plist | `/Volumes/UserData/Users/chistyakov/Library/LaunchAgents/io.clinemm.host-helper.plist` | re-verify in Phase 0.2 |
| LaunchAgent state | `not running` (P2 read; re-verify) | `launchctl print gui/501/io.clinemm.host-helper` |

### §0.2 Production-source trust (read-only at ACT start)

- `git branch --show-current` → `main`
- `git rev-parse HEAD` → `4ccd928eec39acd4e9978c9de46e99fff35c702d` (P3
  closure; no production-source change since the addendum record is also
  an evidence-only commit unless promoted)
- `git status --short` → empty (the `sonoma-base.tvm` was moved out of
  the repo root and a `*.tvm` ignore was added; see §0.3)
- `git stash list` → empty

### §0.3 Repository housekeeping (committed as part of this ACT)

- The 19 GiB untracked `sonoma-base.tvm` was moved from
  `$REPO_ROOT/sonoma-base.tvm` to
  `/private/tmp/clinemm-tart-p3-archive-20261015T131912Z-30833/sonoma-base.tvm`
  (sibling of the operator's `TART_HOME`), with a 270-byte
  `SHA256SUMS` sidecar recording the operator-verified hash.
- `.gitignore` was updated with a `*.tvm` entry (with explanatory
  comment) so any future `tart export` artifacts cannot be accidentally
  committed.
- `git status --short` is clean after the housekeeping.

## §2. Phase 1 — Imported VM identity qualification (PASS — 2026-10-15)

Independent re-verification by the resumption session, 2026-10-15
post-16:50Z, under the exact TART_HOME the operator specified:

```text
$ export TART_HOME="/private/tmp/clinemm-tart-p3-20261015T131912Z-30833"
$ export VM_NAME="clinemm-p3-sonoma-imported"

$ ls -la "$TART_HOME"
drwx-xr-x  cache/  tmp/  vms/

$ tart list --source local --format json
[ { "Size":27, "Source":"local", "Accessed":"2026-10-15T13:48:41Z",
    "Running":false, "Name":"clinemm-p3-sonoma-imported",
    "Disk":50, "State":"stopped" } ]

$ shasum -a 256 "$ARCHIVE_DIR/sonoma-base.tvm"
1eaed5f2fbed1b0118e32edace0896b4a427c41bdff09af2d13b271ec3dfba7c  sonoma-base.tvm
```

All three operator claims re-verified. The P2 host-FS halt
(`utimes(2) failed: Operation not permitted`) is **not** invalidated by
this re-verification: it occurred under the **default** TART_HOME
against a different VM identity (`clinemm-sonoma-export`) and a
different storage path (the protect-flagged /private/tmp Time Machine
snapshot mount). The P3 imported VM under the **isolated** TART_HOME is
a separate storage identity; `tart list --source local` under
`TART_HOME=/private/tmp/clinemm-tart-p3-20261015T131912Z-30833`
reports the imported VM in state `stopped` without any `utimes`
warning.

**Phase 1 verdict:** PASS — VM identity qualified.

## §3. Phase 2 — Operator-side real guest boot (DEFERRED to operator)

Per the expert verdict:

> From your normal Terminal, before handing execution to the agent:
>
> ```sh
> export TART_HOME="/private/tmp/clinemm-tart-p3-20261015T131912Z-30833"
> export VM_NAME="clinemm-p3-sonoma-imported"
> tart list --source local --format json
> tart run "$VM_NAME"
> ```
>
> Keep that Terminal open. In another Terminal, after boot:
>
> ```sh
> tart exec "$VM_NAME" /usr/bin/sw_vers
> tart exec "$VM_NAME" /usr/bin/uname -a
> ```

The agent MUST NOT issue `tart run` itself: booting a Tart VM is a
long-running interactive process, and the operator must own the
terminal session to observe VM window/prompt state directly. The agent
records the operator's transcript and stdout from each `tart exec`
invocation into `01-tart-exec-sw_vers.txt` and `02-tart-exec-uname-a.txt`.

**Phase 2 entry conditions (operator-driven):**
- [ ] Operator opens a non-Seatbelted Terminal with the exported env
      above
- [ ] Operator runs `tart list --source local --format json` and
      pastes/transcribes the JSON
- [ ] Operator runs `tart run "$VM_NAME"` and waits for boot
- [ ] In a second terminal, operator runs
      `tart exec "$VM_NAME" /usr/bin/sw_vers`
- [ ] Operator runs `tart exec "$VM_NAME" /usr/bin/uname -a`
- [ ] Operator runs `tart stop "$VM_NAME"` for clean shutdown
- [ ] Operator pastes the four transcripts into this ACT's evidence dir

**Phase 2 verdict (provisional):** DEFERRED to operator; once the
operator pastes the four transcripts and they show clean guest
identity, the ACT advances to Phase 3.

**Phase 2 halt conditions (any of):**
- `tart exec` returns non-zero → HALT_GUEST_AGENT_UNREACHABLE
- `tart exec` returns zero but with empty/wrong/unexpected stdout
  → HALT_GUEST_EXEC_VERIFICATION_FAILED
- `tart run` blocks indefinitely or panics
  → HALT_GUEST_BOOT_TIMEOUT
- The operator observes a kernel panic or VSZ growth
  → HALT_GUEST_BOOT_UNSTABLE

## §4. Phase 3 — Real guest command via Tart Guest Agent (DEFERRED)

If Phase 2 passes, the agent records and verifies the operator's
`tart exec` transcripts:

- `01-tart-exec-sw_vers.txt` must show a `ProductName: macOS` /
  `ProductVersion: 14.x` line (Sonoma), and the `Darwin` kernel
  version on `arm64`.
- `02-tart-exec-uname-a.txt` must show `Darwin … arm64` consistent
  with the `sw_vers` output.

**Phase 3 entry conditions:** Phase 2 PASS.
**Phase 3 verdict:** PASS if both transcripts verify; otherwise HALT
with the matching proximate classifier.

## §5. Phase 4 — Verified clean shutdown (DEFERRED)

Operator runs `tart stop "$VM_NAME"` (graceful ACPI shutdown via
`tart run --no-graphics` is acceptable; the agent records the
`stopped` state transition). The VM is **NOT** deleted; the
`TART_HOME` is **NOT** removed.

**Phase 4 entry conditions:** Phase 3 PASS.
**Phase 4 verdict:** PASS if `tart list --source local --format json`
post-stop shows the same VM identity and `State == "stopped"`. FAIL
or HALT if the VM is gone, renamed, or in an unexpected state.

## §6. Phase 5 — Existing trusted-helper lifecycle on the imported VM (DEFERRED)

Only after Phases 2-4 PASS does the agent attempt the
trusted-helper lifecycle on the imported VM:

1. `tart run "$VM_NAME"` (the agent observes; operator owns the
   terminal). Wait for boot.
2. Agent dispatches a bounded request to the dev-fallback
   `clinemm-host-helper` (build_id `335e6038…`, SHA-256 `91094cca…`)
   that exercises the sealed-Tart allowlist: e.g. `tart exec
   "$VM_NAME" /usr/bin/sw_vers` via the helper's argv-only
   subprocess discipline.
3. Helper returns the guest stdout.
4. Agent records the helper dispatch transcript into
   `03-helper-dispatch-transcript.txt` with full argv, request id,
   and helper response.
5. Operator `tart stop "$VM_NAME"`.

**Phase 5 P0/P1 discipline:**
- No `launchctl bootstrap/bootout/kickstart/load/unload/install`
  against the production LaunchAgent (HALT_UNSAFE_HOST_HELPER_SERVICE_MUTATION).
- No Seatbelt profile changes (HALT_UNSAFE_SEATBELT_RELAXATION).
- The dev-fallback helper is the same binary the P2 ACT used as
  control; the launchd-managed helper at
  `~/.clinemm/bin/clinemm-host-helper` is left untouched.
- The Tart executable in the helper's allowlist is the
  `/nix/store/…/tart` path; the allowlist is unchanged.

**Phase 5 verdict:** PASS if the helper dispatch returns the same
guest stdout as Phase 3 (allowing for re-render) with clean
exit codes and a clean shutdown. HALT otherwise.

## §7. Phase 6 — Conservation and safety (always PASS)

- No `git add` of the imported VM or its archive.
- No `git push`.
- No `tart delete "$VM_NAME"`.
- No `tart delete clinemm-sonoma-export` (the P2 VM in the default
  TART_HOME).
- No `rm -rf` of the `TART_HOME` or the archive directory.
- No `launchctl` mutation.
- No Seatbelt profile change.
- No `helper.c` source change.
- No Elm or completion-authority source change.
- `git status --short` clean at ACT close.

## §8. Next cursor (UNRESOLVED until P4 closes)

`ACT-CLINEMM-TART-P5-…` will be the successor that, on a clean P4
verdict, promotes the proven dev-fallback-helper → imported-VM
pipeline into the launchd-managed helper path, **subject to a fresh
expert verdict and a fresh P0 safeguard** (the launchd mutation
boundary is still active and the existing P0
HALT_UNSAFE_HOST_PUBLICATION_REJECTED is not yet GREEN).

P5 is NOT authorized in this ACT.

## §9. ACT close criteria (all required)

- Phase 1 PASS (immutable; already PASS)
- Phase 2 PASS with operator transcripts
- Phase 3 PASS with verified guest identity
- Phase 4 PASS with clean shutdown and VM preserved
- Phase 5 PASS with helper dispatch transcript
- Phase 6 PASS (conservation)
- P0 / P1 / P2 assessments in §1 ENFORCED throughout
- `git status --short` clean
- `.factory/epic-board.md` updated with the P4 close entry
- This ACT document finalized with verdict line at top
- `SHA256SUMS` regenerated over the new evidence files

**-- end of ACT document; status is IN PROGRESS pending operator
guest boot --**
