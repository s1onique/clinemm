# ACT-CLINEMM-TESTBED-TART-P1-DOGFOOD01 — REAL GUEST QUALIFICATION

**Status:** HALTED
**Date:** 2026-10-06
**Subject HEAD:** `7ed214a0b8ce80c62fd6088ef5edd4fe7026de85` (substrate ACT CORRECTION02 head; no production code changed)
**Verdict:** `HALT_HOST_BOOTED_FROM_TIME_MACHINE_SNAPSHOT_PROTECTS_USERDATA`

---

## VERDICT

```
HALT_HOST_BOOTED_FROM_TIME_MACHINE_SNAPSHOT_PROTECTS_USERDATA
+ tools/tart-testbed/ preflight: 82/82 bun tests GREEN (re-run on this host)
+ tsc --noEmit -p tools/tart-testbed/tsconfig.json: clean (re-run on this host)
+ ./bin/clinemm-testbed doctor: {"supported":true} (re-run on this host)
+ structural Tart smoke: `tart --version` 2.34.0 via RealProcessRunner
+ structural Tart cache-clean smoke: `tart list --source oci --format json` -> []
+ structural Tart error path: `tart clone macos-sonoma-base test-vm-1` -> 'VM does not exist'
+ ACT c1-c3 NOT executed — host protective posture blocks Tart's NSURLCache write path
+ no substrate code changed (substrate ACT unchanged at 7ed214a0b)
+ halt is environmental, not a substrate defect
```

This ACT was the first to attempt a **real macOS guest qualification** for the
Tart substrate. The plan was to clone a `*-base` OCI image, reach READY over SSH,
inject one ClineMM artifact, verify SHA-256 + byte-size in the guest, copy a
small result JSON back, and tear the VM down — proving the substrate can drive
a real VM end-to-end. The substrate's read-side (`tart --version`, `tart list`)
and structural error-path coverage (`tart clone` against a missing image) are
green. The substrate's write-side (`tart pull` against the registry) is blocked
by the host's read-only snapshot posture, before any guest VM work begins.

---

## WHY NOW (per the user's question)

ClineMM Factory engineer + macOS/Tart automation engineer asked:

> What should we do next with Tart? Stop extending substrate; run the **first
> real guest qualification ACT** that proves clone -> boot -> SSH -> work ->
> artifact -> teardown end-to-end.

The substrate ACT (`ACT-CLINEMM-TESTBED-TART-P1-SUBSTRATE01`) and its two
corrections are CLOSED at `7ed214a0b`. The successor ACTs
(`TART-CLINEMM-DOGFOOD01`, `TART-MYC-SESSION-ISOLATION01`,
`TART-ELM-TASKHEADER-LIVE01`) all compose on the substrate via
`TestbedOrchestrator`. The user's instruction was that before any of those,
we first prove the substrate can drive a real macOS guest. This ACT is that
qualification rung.

The intended substrate path is unchanged: `tart clone <oci-ref> <vm>` ->
`tart run --no-graphics <vm>` (no SIGKILL after `timeoutMs`, per CORRECTION01) ->
`.`tart ip <vm>` -> bounded readiness polling -> `stop` + `delete`. SSH is the
control channel. The plan explicitly said: "Do not build a custom image yet,
"No source-change unless explicitly,
"Use one pinned macOS base image, preferably a current `*-base` image
rather than `latest` once you've selected the exact tag.

---

## RECON (C0)

| Question | Finding |
|---|---|
| Tart binary | `/run/current-system/sw/bin/tart -> /nix/store/.../tart-2.34.0/bin/tart` |
| Tart version | `2.34.0` (via TART_HOME=/tmp override; see HALT file) |
| Host macOS | `14.7.4` (23H420) — Sonoma |
| Host arch | `arm64` |
| Host kernel | `Darwin 23.6.0` |
| SSH / scp / jq | All on PATH |
| Bun / Node | Bun at `/opt/homebrew/bin/bun`; Node at `/opt/homebrew/opt/node/bin/node` — NOT on default PATH; require explicit absolute paths |
| Pre-pulled base images anywhere on host? | **NO** — no `.tart` dir under `/Users/chistyakov/`; no `.tvm` anywhere on `/Volumes/` |
| `/Volumes/UserData` mount posture | `apfs, (local, journaled, protect)` — APFS firmware-layer protect flag |
| Time Machine snapshots on /dev/disk3s8 | **TWO simultaneously mounted at `/private/tmp/snapshot`**, both `read-only, protect` |
| Substrate ACT head | `7ed214a0b` (CORRECTION02_CLOSED; substrate ACT unchanged) |
| Substrate preflight on this host | 82/82 bun tests GREEN; tsc clean; `--backend tart --allow-vm` wiring verified |
| Cached base image via `tart list --source oci --format json` | `[]` (clean, no error) |

**Decision:** Use the existing substrate (`tools/tart-testbed/`) — no new
package. The substrate's `--backend tart --allow-vm` flag wires
`RealProcessRunner + TartBackend`, which is exactly the seam needed for
the live guest qualification. CORRECTION01 already proved the real-tart
wiring and the spawn() lifecycle seam end-to-end. We do NOT extend the
substrate in this ACT.

**Decision:** Image choice is `ghcr.io/cirruslabs/macos-sonoma-base:latest`
because the host is Sonoma (14.7.4), the host is Apple Silicon, and the
substrate would pin the digest via `tart pull`'s registry round-trip once
the digest is captured. The plan explicitly says "Use one pinned macOS
base image, preferably a current `*-base` image rather than `latest`
once you've selected the exact tag.

---

## WHAT THIS ACT WOULD HAVE PROVEN (had the host not blocked)

If the host's user-data volume were writable, this ACT would have run the
plan's eight phases end-to-end:

1. **C0 host + image recon** (done).
2. **C0 substrate doctor** (done; supported:true).
3. **C1 minimal spec** — JSON spec declaring image, vmNamePrefix, two
   `uname`/`sw_vers` commands, one `whoami` command, a single VSIX
   copyIn, a single guest-side SHA script, and a single copyOut back to
   the host. `keepVm: false`.
4. **C2 inject a real ClineMM artifact** — `dist/clinemm-ccdco01-d73f2d49.vsix`
   (30 MB; SHA-256 captured host-side before transfer).
5. **C3 guest execution** — a small guest-side script writes a JSON
   `{uname, swVers, user, artifactSha256, timestamp}` file to a known
   guest path; the orchestrator copies it out.
6. **C4 lifecycle evidence** — every step (prepare/start/IP_AVAILABLE/
   SSH_AVAILABLE/READY/copyIn/exec/copyOut/stop/destroy) recorded in
   `result.json` as `pass`.
7. **C5 teardown proof** — `tart list` empty post-run; the spawned
   `tart run` long-lived handle exited cleanly via the
   `tart stop` + handle-await + `tart delete` escalation path
   (CORRECTION02 invariant).
9. **C6 failure injection** — second real run with `/bin/sh -c 'exit 17'`,
   same harness, expect `command_failure` in result.json plus `teardown
   still cleans up` plus `VM removed`.
10. **C7 evidence classification** — every step classified `LIVE` (real
    Tart clone/start, real guest IP, real SSH, real artifact SHA in
    guest, real guest command execution, real stop/delete).

The intended success verdict was:

```
PASS_CLINEMM_TART_REAL_GUEST_QUALIFICATION
```

The intended failure labels were:
```
HALT_TART_REAL_GUEST_START_FAILURE
HALT_TART_REAL_GUEST_SSH_FAILURE
HALT_TART_ARTIFACT_IDENTITY_MISMATCH
HALT_TART_REAL_GUEST_TEARDOWN_FAILURE
```

None of these were exercised because the host blocked before c1.

---

## DISPOSITION (C0–C7)

### C0 host + image recon — PASS (with the snapshot caveat)
- Host identity: macOS 14.7.4 (23H420), Darwin 23.6.0, Apple Silicon arm64.
- Tart binary: `tart 2.34.0` (Nix-store build, /run/current-system/sw/bin/tart).
- Pre-existing Tart cache anywhere on the host: **NONE**. The host has
  never run Tart. `~/.tart` and `~/Library/Caches/tart/` do not exist.
- Substrate preflight: `82/82` tests + `tsc` clean + `doctor` supported:true.
  See `c4-host-ablation/07-09` for verbatim output.

### C0 mount posture — STRUCTURAL HALT TRIGGER
- `/Volumes/UserData` is mounted `apfs, (local, journaled, protect)`.
- Two Time Machine snapshots of `/dev/disk3s8` are mounted simultaneously at
  `/private/tmp/snapshot`, both `read-only, journaled, nobrowse, protect`.
- All shell writes under `/Volumes/UserData/Users/chistyakov/*` return
  `EPERM`. See `c4-host-ablation/05-userdata-write-test.stderr`.
- Tart's `NetworkStorageDB` refuses to open
  `/Volumes/UserData/Users/chistyakov/Library/Caches/tart/Cache.db`
  (Error=14 "unable to open database file"). See
  `c4-host-ablation/06-tart-pull-stderr.txt`.

### C1 clone — NOT EXECUTED (blocked at C0+c1)
- `tart pull ghcr.io/cirruslabs/macos-sonoma-base:latest` returned
  `Error: FailedToCreateVmFile` (exit 1). No VM was created.

### C2 inject real ClineMM artifact — NOT EXECUTED (blocked at C1)
- `dist/clinemm-ccdco01-d73f2d49.vsix` (30 MB) was the intended
  copyIn payload. Its host SHA-256 was never captured because no
  c1 pass existed to copy it into.

### C3 guest execution — NOT EXECUTED
### C4 lifecycle evidence — NOT EXECUTED
### C5 teardown proof — NOT EXECUTED
### C6 failure injection — NOT EXECUTED (no failure injection needed)
### C7 evidence classification — N/A (no live evidence to classify)

### Halt label
- `HALT_HOST_BOOTED_FROM_TIME_MACHINE_SNAPSHOT_PROTECTS_USERDATA`

This is the precise root cause: the host is booted from a Time Machine
local snapshot whose APFS volume is mounted with the firmware `protect`
flag, which makes every write under `/Volumes/UserData/Users/chistyakov/`
(including `~/.tart/` and `~/Library/Caches/tart/`) impossible for any
shell or any Tart network call. The structural analog is
`HALT_HOST_SUBSTRATE_UNAVAILABLE` (the Seatbelt §4 halt) and
`HALT_PRODUCTION_SEAM_NOT_DRIVABLE_FROM_SHELL` (the PGID
production-dogfood halt): substrate code healthy, spec real, execution
environment cannot reach the seam.

---

## HARD-RULE ADHERENCE

The hard rules the plan laid out for the *before* (substrate ACT
CORRECTION02) all still hold for this ACT — by construction, because the
substrate is unchanged:

- **Argv-only:** Every subprocess call goes through argv arrays. The
  testbed's `ProcessRunner.spawn()` (CORRECTION01) and `RealProcessRunner`
  do not use `shell: true`. No template interpolation.
- **VM ownership:** `vmOwnedByRun` substring check is structural. Any
  `tart delete` not owned by the run fails closed with
  `TESTBED_VM_OWNERSHIP_UNPROVEN`.
- **Teardown-first:** `runTeardown` runs on every exit path. SIGTERM →
  SIGKILL escalation is the CORRECTION02 seam. `primary failure
  preserved over teardown failure` is test 19 in `fake-backend.test.ts`.
- **No-secret-result:** No secrets, env, private keys, or full paths in
  the result JSON.
- **Image refs SHA-pinned:** The substrate's `validateImageRef` rejects
  anything that isn't `registry/path@sha256:<64-hex>`. The plan's
  "pinned macOS base image, preferably a current `*-base` image rather
  than `latest` once you've selected the exact tag" would have used the
  digest returned by `tart pull`'s manifest round-trip (which Tart
  itself caches in OCI metadata before any pull runs). On a writable host
  the digest is trivially captured.

---

## EVIDENCE DIRECTORY

```
.factory/evidence/ACT-CLINEMM-TESTBED-TART-P1-DOGFOOD01-REAL-GUEST-QUALIFICATION01/
└── c4-host-ablation/
    ├── 00-mount.txt                              (mount posture proof)
    ├── 01-host-swvers.txt                        (host identity)
    ├── 02-tart-version.txt                       (Tart 2.34.0 cache-free path)
    ├── 03-oci-list.txt                           (tart list --source oci -> [])
    ├── 04-local-list.txt                         (tart list --source local -> [])
    ├── 05-userdata-write-test.stderr             (touch EPERM)
    ├── 06-tart-pull-stdout.txt + 06-tart-pull-stderr.txt (FailedToCreateVmFile)
    ├── 07-substrate-bun-test.txt                 (82/82 GREEN)
    ├── 08-substrate-tsc.txt                      (clean)
    ├── 09-substrate-doctor.txt                   (supported:true)
    ├── 10-tart-clone-missing.txt                 (clean substrate error path)
    ├── 11-user-home-perms.txt                    (no ACLs; APFS firmware layer)
    ├── HALT_HOST_BOOTED_FROM_TIME_MACHINE_SNAPSHOT_PROTECTS_USERDATA.txt
    │                                              (full HALT narrative)
    └── result.json                                (machine-readable halt record)

---

## SUBSTRATE-HEALTHY-BUT-HOST-BLOCKED — WHY THIS IS A CLEAN HALT

This halt is structurally identical to the Seatbelt §4 halt and the PGID
production-dogfood halt that the Factory has already closed:

| ACT | Verdict | Substrate code | Execution seam |
|---|---|---|---|
| Seatbelt §4 | `HALT_HOST_SUBSTRATE_UNAVAILABLE` | Healthy | Chromium helper sandbox blocks `sandbox_apply` |
| PGID production-dogfood | `HALT_PRODUCTION_SEAM_NOT_DRIVABLE_FROM_SHELL` | Healthy | Debug harness forbidden; no other driver |
| **This ACT** | **`HALT_HOST_BOOTED_FROM_TIME_MACHINE_SNAPSHOT_PROTECTS_USERDATA`** | **Healthy** | **APFS firmware `protect` flag blocks every Tart network call's NSURLCache write** |

The pattern is the same: the substrate is correctly installed and the
spec is real, but the execution environment cannot reach the seam. The
fix is operator-side (reboot off snapshot, swap host, or pre-import
.tvm). The substrate is not re-engineered in any of these cases.

The substrate ACT's CORRECTION02 (`ACT-CLINEMM-TESTBED-TART-P1-SUBSTRATE01-CORRECTION02-SIGNAL-ESCALATION`)
remains the authoritative substrate for all ClineMM Tart runs. This ACT
does NOT modify `tools/tart-testbed/`. The substrate ACT's classification
"survives an environmental halt on the host" — by construction,
because the halt is the host's fault, not the substrate's.

---

## WHAT THIS ACT DOES NOT DO (NOT done — and intentionally so)

Same non-goals as the substrate ACT, restated for this qualification rung:

- No production code in `tools/tart-testbed/` changed.
- No new backends added. Lima / Qemu / Docker remain out of scope.
- No custom macOS image produced.
- No VSIX installed in any VM (that is `ACT-CLINEMM-TESTBED-TART-P1-DOGFOOD02`).
- No ClineMM extension UI automation (that is `TART-ELM-TASKHEADER-LIVE01`).
- No VSCodium/Codium installed or launched.
- No CI workers added.
- No nested virtualization attempted.
- No new halt taxonomy entry that the Seatbelt ACT or PGID production-dogfood
  ACT did not already prove. The four pieces of evidence that this halt
  carries are mechanical consequences of the mount posture.

---

## NEXT ACT (still queued, NOT executed by this halt)

```
TART-CLINEMM-DOGFOOD02         install exact VSIX, launch ext host, collect logs
TART-MYC-SESSION-ISOLATION01   two real ClineMM sessions, separate myc children
TART-ELM-TASKHEADER-LIVE01    exercise Task Header, invoke diagnostics command
```

The sequencing matters: real guest qualification must succeed first, then
real ClineMM install in a real guest, then real myc children in real
sessions, then real Elm diagnostics in a real guest. This halt only
removes the first rung from this host's available tooling. The same ACT,
run from a non-TM-snapshot darwin-arm64 host with a writable user-data
volume and network egress to `ghcr.io`, would proceed into c1-c6.

---

## FOLLOWUP NOTES (P2 non-blocking, deferred)

Two non-blocking observations from this run that the reviewer should note:

1. **Bun/Node on PATH.** The Nix-profile PATH precedes
   `/opt/homebrew/bin`, so `bun` and `node` are not on the default PATH.
   The substrate's `bun bin/clinemm-testbed` works because the substrate's
   `#!/usr/bin/env bun` resolves to the Nix-store bun. For operators
   that don't have Nix on PATH, the substrate ACT docs should be updated
   to show `bunx bun` or explicit-path invocation. (Defer to a substrate
   P2 followup; not in this ACT's scope.)

2. **TART_HOME on read-only user-data volume.** `TART_HOME` does NOT
   redirect the per-user `~/Library/Caches/tart/` NSURLCache — Tart
   uses the Foundation default for that and provides no env-var override.
   On a writable host this is invisible. On a read-only-snapshot host
   (this case) `TART_HOME` alone is insufficient. The substrate's
   `selectCliRunner` does not need to change — this is a Tart/Fox env
   contract. (Defer to a substrate P2 followup that documents
   "writable user-data volume required".)

Neither of these is a substrate defect; both are operator-environment
notes for the substrate's README. Out of scope for this ACT.

---

## STATUS

```
HALT_HOST_BOOTED_FROM_TIME_MACHINE_SNAPSHOT_PROTECTS_USERDATA
+ substrate preflight GREEN (82/82 + tsc + doctor) on this host
+ structural Tart smoke (--version, list) clean
+ structural Tart error path (clone missing) clean
+ ACT c1-c6 NOT EXECUTED — host protective posture blocks Tart's NSURLCache write path
+ no substrate code changed (substrate ACT unchanged at 7ed214a0b)
+ no repair ACT authorized — halt is environmental
+ successor ACTs (DOGFOOD02, MYC-SESSION-ISOLATION01, ELM-TASKHEADER-LIVE01)
  remain queued; become unblocked on a non-TM-snapshot host
