# ACT-CLINEMM-TART-P3-OFFLINE-IMAGE-IMPORT-QUALIFICATION01

**Status:** CLOSED with verdict **`HALT_TRUSTED_IMAGE_ARCHIVE_UNAVAILABLE`**
(proximate halt classifier; root classification: `CLOSED_HALTED_CLEAN`).

**Predecessor:** `ACT-CLINEMM-TART-P2-REAL-GUEST-EXECUTION-RECOVERY01`
(2026-10-15, `CLOSED_HALTED_CLEAN`, `HALT_GUEST_VM_PROVISIONING_BLOCKED_BY_HOST_FS`).

**Goal (per ACT §0):** bypass Tart's failing OCI cache write path using a
trusted offline `.tvm` archive and import a macOS Sonoma VM into an
isolated, writable Tart home.

**Outcome:** Phase 1 (capability recon) and Phase 3 (writable storage probe)
executed. Phase 2 (source-archive acquisition) **halted**: no `.tvm` archive
exists on this host, no local Tart VM exists, no out-of-band source is
reachable from the Seatbelted ClineMM task, and producing one via `tart
pull` / `tart clone` would re-trigger the P2 SQLite WAL failure on the
protect volume. Phases 4-6 not executed (gated out by the Phase 2 halt).
Phase 7 (conservation and safety) **passed**: no launchd mutation, no
Seatbelt bypass, no foreign VM mutation, no OCI retry, no production
ClineMM change.

**Verdict:** `CLOSED_HALTED_CLEAN` with proximate halt
`HALT_TRUSTED_IMAGE_ARCHIVE_UNAVAILABLE`.

## 0. Mission

Bypass Tart's failing OCI cache write path using a trusted offline `.tvm`
archive and import a macOS Sonoma VM into an isolated, writable Tart home.

```text
Trusted Sonoma image
    ↓
Source provenance + SHA-256
    ↓
Offline .tvm archive
    ↓
Writable TART_HOME
    ↓
tart import
    ↓
tart list --source local
    ↓
Verified imported VM
```

**One image, one import, one verification.**

No boot, SSH, launchd repair, or VSIX testing in this ACT.

## 1. Phase 0 — Repository trust (PASS)

Captured at the start of the ACT:

- `git branch --show-current` → `main`
- `git rev-parse HEAD` → `cbb94f6a24b078011c991fef4ed68d2f8c28c6f0`
  (the P2 closure commit; identical to `SUBJECT_HEAD`)
- `git status --short` → empty (no tracked dirt)
- `git stash list` → empty
- `git diff --check` → empty

`ENTRY_HEAD == SUBJECT_HEAD == cbb94f6a24b078011c991fef4ed68d2f8c28c6f0`.
No protected stashes; no unexpected tracked dirt.

## 2. Phase 1 — Verify Tart capabilities (PASS)

- `command -v tart` → `/run/current-system/sw/bin/tart`
  (symlink to `/nix/store/crsnipsi18a4ac0vvim0c4093mwf1l1h-tart-2.34.0/Applications/tart.app/Contents/MacOS/tart`)
- `tart --version` → `2.34.0`
- `tart import --help` → `tart import <path> <name>` (path is a `.tvm` file)
- `tart export --help` → `tart export <name> [<path>]` (export a local VM to a `.tvm` file)
- `tart list --source local --format json` → `[]` (no local VM)
- `tart list --source oci --format json` → 2 entries, including the **pinned digest**
  `ghcr.io/cirruslabs/macos-sonoma-base@sha256:e2ebdfc4d354b336fe00d729c11a8136a019b8046f41cc183a2fe51b85d18f49`
  (Size=30, Disk=50, Source=OCI, State=stopped, Accessed=2026-10-06T20:20:08Z).

## 3. Phase 2 — Acquire a trusted Sonoma archive (HALT)

Per ACT §3, the four preferred sources are:
1. Existing compatible `.tvm` already owned by the operator.
2. Export from an existing local Sonoma VM on another writable Apple Silicon Mac.
3. Provision Sonoma from the pinned OCI digest on another trusted writable Mac, then export it.
4. Another independently verifiable trusted Tart archive.

This Seatbelted ClineMM task has access to **none** of the four. Detailed
search evidence in `02-source-archive-search.txt`:

- No `.tvm` file under `/Volumes`, `/private/tmp`, `/tmp`, `/opt`, `/Users`, `/nix`
  (90-second `find` walked the entire `/nix/store` hierarchy without finding one).
- No `sonoma` substring match in `/private/tmp` (the P2 staging dir
  `/private/tmp/clinemm-p2-staging` was cleaned up post-closure).
- `tart list --source local` is `[]` → no local VM to export.
- The OCI cache is **metadata-only** (1.1 MB total: 49 KB SQLite DB + 470 KB
  WAL + 33 KB manifest blob + 431 KB first-disk-layer blob). Re-pulling
  the body requires a registry credential and ~800 MB of network egress,
  AND would re-write the OCI cache DB on the protect volume (where P2
  proved SQLite WAL fails with `unhandled result=8`).
- `tart pull` materializes a local VM into `TART_HOME/VirtualMachines`,
  it does **not** produce a `.tvm` file. The only path to a `.tvm` is
  `tart export <local-vm>`, which requires a local VM.

**Verdict: HALT_TRUSTED_IMAGE_ARCHIVE_UNAVAILABLE.**

## 4. Phase 3 — Validate writable target storage (PASS, probe only)

Phase 3 is independently useful and was executed despite the Phase 2 halt,
to record a ready TART_HOME for the next operator-driven P3 retry.

- `RUN_ID=20261015T131912Z-30833`
- `TART_HOME=/private/tmp/clinemm-tart-p3-20261015T131912Z-30833`
- `mkdir -m 700 "$TART_HOME"` → OK (mode drwx------, owner chistyakov:wheel, 272 GB free on `/dev/disk3s1s1`)
- `touch + touch -t + shasum + rm` probe cycle → OK
  - `shasum -a 256` of the empty probe file is
    `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
    (the well-known empty-file SHA, confirming create + mtime + read + hash + cleanup)

TART_HOME is left empty and bound to the run id; it is NOT durable storage
(per ACT §8).

## 5. Phase 4 — Verify archive integrity (NOT EXECUTED)

Gated out by Phase 2. No archive path or expected SHA-256 was supplied.

## 6. Phase 5 — Offline import (NOT EXECUTED)

Gated out by Phase 4. No `tart import` invocation occurred.

## 7. Phase 6 — Verify imported VM (NOT EXECUTED)

Gated out by Phase 5. The pre-Phase-5 baseline
(`02-local-list-pre.json`) is `[]` and is not re-checked after a
non-existent import (per ACT §9, a re-check would conflate "halted
import" with "successful import", which is forbidden).

## 8. Phase 7 — Conservation and safety (PASS)

Full per-rule evidence in `06-conservation-and-safety.txt`. Summary:

- No `launchctl` mutation (R1).
- No Seatbelt bypass (R2).
- No foreign VM mutation (R3).
- No blind deletion (R4).
- No OCI retry (R5).
- No production ClineMM change (R6) — `git status --short` is empty.
- No credential-bearing archives committed (R7).
- Run-owned TART_HOME identity preserved (R8).
- No reboot or snapshot deletion (R9).
- No Elm work (R10).

## 9. Gates summary

| Gate | Name | Result |
|------|------|--------|
| P3-01 | PASS_TART_OFFLINE_CAPABILITY_RECON | PASS |
| P3-02 | PASS_TRUSTED_TVM_ARCHIVE | **FAIL (HALT)** |
| P3-03 | PASS_TART_WRITABLE_STORAGE | PASS (probe only) |
| P3-04 | PASS_TVM_ARCHIVE_INTEGRITY | NOT REACHED |
| P3-05 | PASS_TART_OFFLINE_IMPORT | NOT REACHED |
| P3-06 | PASS_TART_LOCAL_VM_PRESENT | NOT REACHED |
| P3-07 | PASS_STORAGE_AND_VM_CONSERVATION | PASS |

## 10. Artifact identity (discovered, not predicted)

```text
ENTRY_HEAD                cbb94f6a24b078011c991fef4ed68d2f8c28c6f0
SUBJECT_HEAD              cbb94f6a24b078011c991fef4ed68d2f8c28c6f0 (== ENTRY_HEAD)

HOST_MACOS_VERSION        14.7.4 (23H420)
HOST_ARCH                 arm64 (Apple Silicon)
TART_VERSION              2.34.0
TART_BINARY_PATH          /nix/store/crsnipsi18a4ac0vvim0c4093mwf1l1h-tart-2.34.0/Applications/tart.app/Contents/MacOS/tart
                          (canonical: /run/current-system/sw/bin/tart)

SOURCE_VM_NAME            N/A (no local source VM)
SOURCE_IMAGE_REFERENCE    ghcr.io/cirruslabs/macos-sonoma-base
SOURCE_IMAGE_DIGEST       sha256:e2ebdfc4d354b336fe00d729c11a8136a019b8046f41cc183a2fe51b85d18f49 (in OCI cache; metadata only)

ARCHIVE_PATH              N/A (no archive obtained)
ARCHIVE_BYTES             N/A
ARCHIVE_SHA256            N/A

TART_HOME                 /private/tmp/clinemm-tart-p3-20261015T131912Z-30833 (left empty, 700 mode)
RUN_ID                    20261015T131912Z-30833
IMPORTED_VM_NAME          N/A (no import)
IMPORTED_VM_STATE         N/A
IMPORT_EXIT_CODE          N/A (no invocation)

REAL_GUEST_BOOT           NOT_EXECUTED
GUEST_COMMAND             NOT_EXECUTED
VSIX                      NOT_BUILT
```

## 11. Factory stop conditions

### P0 — HALT (none triggered)

- Untrusted image provenance: HONORED (no image accepted; halt before any acceptance)
- Archive SHA-256 mismatch: N/A (no archive)
- Foreign VM mutation: HONORED (no foreign VM touched)
- Seatbelt relaxation: HONORED (no Seatbelt relaxation)
- Launchd mutation: HONORED (no launchd mutation)
- Protected-volume mutation: HONORED (no write to /dev/disk3s8 attempted; the only filesystem
  writes were to /private/tmp, which is on /dev/disk3s1s1, the root APFS volume)
- Unexpected tracked dirt: HONORED (working tree is clean at HEAD)
- Import failure falsely reported successful: HONORED (no import was executed; halt is
  reported truthfully)
- Real guest boot claimed without execution: HONORED (real guest boot is recorded as
  NOT_EXECUTED in §10 and the evidence files)

### P1 — bounded correction (none needed)

- The P3-01 capability recon was clean; no syntax/format correction was needed.
- The P3-03 storage probe was clean; no permission or path correction was needed.
- The P3-02 halt is an out-of-band problem (no archive available), not a bounded
  in-process correction; a single in-process correction cannot conjure a `.tvm`
  that does not exist on this host.

### P2 — non-blocking (none)

## 12. Closure

Verdict: `CLOSED_HALTED_CLEAN` with proximate halt
`HALT_TRUSTED_IMAGE_ARCHIVE_UNAVAILABLE`.

The halt is an **out-of-band** source-availability problem:
- The P2 host-FS unblock path (`/private/tmp` TART_HOME) is confirmed valid
  in this ACT's Phase 3.
- The P3-01 capability recon is confirmed.
- What is missing is the **input**: a trusted `.tvm` archive file on this host.

No in-process correction can produce that input. The unblock requires an
operator with access to a different writable Apple Silicon Mac (or a
Tart-aware CI host) to:
1. run `tart pull ghcr.io/cirruslabs/macos-sonoma-base@sha256:e2ebdfc4...` there,
2. run `tart export <pulled-vm> /path/on/writable/storage/sonoma-base.tvm` there,
3. record the source-host Tart version, source VM name, archive bytes, and archive SHA-256,
4. deliver the `.tvm` to a path on this host readable by the ClineMM task runtime
   (any path under `/private/tmp` is acceptable; the run-bound TART_HOME at
   `/private/tmp/clinemm-tart-p3-20261015T131912Z-30833` is left ready for use).

After delivery, a future P3 ACT can re-execute Phases 4-6 against that
archive.

## 13. Next cursor (UNCHANGED)

`ACT-CLINEMM-TART-P3-OFFLINE-IMAGE-IMPORT-QUALIFICATION01-CORRECTION01` (or
successor), once a trusted `.tvm` archive is delivered to this host. The
P4 cursor `ACT-CLINEMM-TART-P4-IMPORTED-SONOMA-REAL-GUEST-LIFECYCLE01` is
**not** opened until P3 has a real import success.

## 14. Evidence manifest

All evidence files in
`/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/.factory/evidence/ACT-CLINEMM-TART-P3-OFFLINE-IMAGE-IMPORT-QUALIFICATION01/`:

```
00-closure-evidence.txt
01-tart-capability-recon.txt
02-source-archive-search.txt
03-oci-cache-deep-inspection.txt
04-tart-home-storage-probe.txt
05-import-failure-classification.txt
06-conservation-and-safety.txt
01-oci-list-pre.json
02-local-list-pre.json
SHA256SUMS
```

SHA-256 manifest is in `SHA256SUMS` (10 lines, 9 evidence files + the
manifest itself, which is a self-referencing-free manifest per the P2
correction's pattern).

No `.tvm` archive is in this directory. No SSH key, no Apple credential,
no Keychain blob, no docker config, no production source diff is
committed by this ACT.

## 15. Post-closure expert review (accepted with wording corrections)

A panel of three experts (Tart virtualization engineer, macOS filesystem
engineer, Factory reviewer) accepted the verdict
`CLOSED_HALTED_CLEAN` with proximate halt
`HALT_TRUSTED_IMAGE_ARCHIVE_UNAVAILABLE`. Two evidence qualifications and
one important finding were applied; the corrections refine wording
precision but do not change the verdict.

**Qualification 1 — archive search was incomplete:** the 90-second
filesystem-wide `find` was cancelled; it does NOT prove that no `.tvm`
exists anywhere on the machine. The corrected language: the inspection
covered the natural Tart storage locations and the empty `tart list
--source local` is the authoritative local-inventory result, so the halt
is supported; but the search was not exhaustive over the entire host
filesystem.

**Qualification 2 — Time Machine snapshot does not establish protect-flag
causality:** the P3 report said the new snapshot "freshly reinforced" the
`protect` flag. The expert's correction: a new snapshot and an unchanged
mount flag establish chronology, not causality. The P2 classification
(`HOST_FILESYSTEM_OPERATION_DENIED = PROVEN, TIME_MACHINE_SNAPSHOT_CAUSED_DENIAL
= INFERRED, REBOOT_WILL_FIX_IT = NOT PROVEN`) is preserved.

**Important finding — anonymous OCI pull is permitted for public repos:**
the P3 report overclaimed when it said "Re-pulling the body requires a
registry credential." Verified in this correction: a 68-character
anonymous Bearer token can be obtained from `https://ghcr.io/token`
without any credential, and the registry returns HTTP 200 +
`docker-content-digest: sha256:e2ebdfc4...` for the pinned manifest. The
credential-blame is removed from the out-of-band unblock instruction;
an operator on a writable Mac can run `tart pull` directly without
`TART_REGISTRY_USERNAME/PASSWORD`. The P3 halt's proximate cause is
unaffected (no `.tvm` on this host), and the deeper P2 halt (SQLite WAL
write fails on the protect volume) is also unaffected (anonymous pull
still goes through the OCI cache, and the OCI cache DB write is what
fails). See `.factory/evidence/ACT-CLINEMM-TART-P3-OFFLINE-IMAGE-IMPORT-QUALIFICATION01/07-expert-review-corrections.txt`
for the full diffs and the verified anonymous-OCI-pull test.








