# ACT-CLINEMM-MCP-OWNER-EXCLUSIVITY-CORR02 — Closure Report

**Verdict: PASS.** The cross-process ownership-exclusivity proof gap is closed. Both interleavings
are proven RED against the entry HEAD and GREEN against the corrected head, by executable
witnesses that drive the REAL production functions in REAL independent processes.

```text
ACT_ID: ACT-CLINEMM-MCP-OWNER-EXCLUSIVITY-CORR02
TYPE: bounded P0 ownership-exclusivity correction
EPIC: EPIC-CLINEMM-TRACE-AND-ACCEPTANCE-EVIDENCE
WORKSTREAM: W01 (correction of ACT-CLINEMM-MCP-READONLY-LIVE-QUAL01)
VERDICT: PASS
REPORTED_ENTRY_HEAD: 043a0606f5f43b0d742f8fa0b6a05c7014bf2fce (an ancestor of the actual HEAD)
ACTUAL_ENTRY_HEAD: ef1ef40ab56fc01b7a5ca12b10bd73a75df912e5
BRANCH: main (no ACT branch created)
PUSHED: NO   RELEASED: NO   PUBLISHED: NO   BRANCH_CREATED: NO   NEW_DEPENDENCIES: 0
RED: 3 of the 5 new committed witnesses FAIL at the entry HEAD (R1, R2, C2)
GREEN: 5/5 new witnesses pass; 55/55 across the whole control-seam suite
NO-REGRESSION: full vitest run before vs after -> BYTE-IDENTICAL failing-file sets
        (68 files, 178 failing tests, identical); +2 passing tests, 0 new failures
TYPECHECK: tsc --noEmit EXIT 0 | tsc -p tsconfig.vscode-compat.json EXIT 0
LINT: biome EXIT 0 (2889 files package-wide)
BUNDLE: bun esbuild.mjs --production EXIT 0 -> dist/extension.js 28,089,654 bytes
EVIDENCE: .factory/evidence/ACT-CLINEMM-MCP-OWNER-EXCLUSIVITY-CORR02/
```

## C0 — Preflight

The reported entry HEAD `043a0606f` is an **ancestor** of the actual HEAD
`ef1ef40ab56fc01b7a5ca12b10bd73a75df912e5` (the intervening commits are unrelated
diagnostics/compaction ACTs). The pre-existing stash, all six worktrees, the RECON01/QUAL01
evidence and the existing VSIX were left untouched. The completed upstream integration was NOT
reopened.

## C1 — The reproduced races

Two REAL production functions were inspected:
`acquireControlSeamOwnership()`, `writeControlSeamOwnerRecordAtomic()`,
`releaseControlSeamOwnership()` and `ControlSeamServer.start()`/`dispose()`.

At the entry HEAD the claim was a **read-check followed by a rename-to-overwrite**:
`readControlSeamOwnerRecord()` → (liveness check) → `writeFileSync(tmp)` →
`renameSync(tmp, ownerPath)`. `rename(2)` **overwrites** an existing destination, so it is not an
exclusive claim.

### R1 — Simultaneous acquisition — RED, REPRODUCED

Two independent processes both observed an unowned endpoint, both passed the liveness check, and
both wrote. Observed at the entry HEAD:

```text
A: { "acquired": true,  "observedInstanceId": "A-instance" }
B: { "acquired": true,  "observedInstanceId": "B-instance" }
final owner.json: { "instanceId": "A-instance", "pid": 59301, ... }
```

**Both processes reported a successful acquisition, and one replaced the other's record.**

### R2 — Cleanup versus acquisition — RED, REPRODUCED

`releaseOwnedArtifacts()` released the ownership record **first** and removed the socket/token
**second**. Instance A was a real started `ControlSeamServer`; the parent parked A inside its
production cleanup on the socket removal and let instance B acquire the endpoint. Observed at the
entry HEAD:

```text
recordPresentDuringACleanup: false        <- A had already released ownership
B: { "acquired": true }
afterACleanup: { "socketPresent": false, "tokenPresent": false }
```

**Instance A removed instance B's live socket and token.**

Both interleavings were reproduced **deterministically** (3 consecutive identical runs), not
inferred: the barrier parks each contender at the exact instruction boundary the interleaving
requires, using an interposition on `node:fs` **inside the child process only**. The production
functions were not modified to produce the RED.

## C2 — The bounded correction

### The claim is now EXCLUSIVE, atomic and content-complete

`writeControlSeamOwnerRecordAtomic()` (write-then-rename) was replaced by
`claimControlSeamOwnerRecord()`:

1. the record is written to a private temporary file in the SAME directory (mode 0600), so the
   content is COMPLETE before the claim becomes visible; then
2. `link(2)` creates the owner-record name as a hard link to that temporary file. `link` fails with
   `EEXIST` when the destination exists — it is an EXCLUSIVE create (`O_CREAT | O_EXCL`
   semantics) that the kernel serializes across processes.

The claim is therefore atomic, exclusive and content-complete. A second contender can never
change the owner's token, socket or record: its `link` fails, it re-reads, it sees a live owner,
and it fails closed.

### The stale reclaim is serialized

A DEAD owner leaves a stale record. Reclaiming it is now done under a **transient, exclusively
created reclaim token** (`owner.json.reclaim`, created with Node's `wx` flag = `O_CREAT | O_EXCL`),
so two reclaimers can never both remove the stale record and both "win" the endpoint. The
reclaimer re-reads the record **inside** the critical section and removes only the record it
positively identified as stale. The reclaim token is released at the end of the critical section
and is **not** reclaimed automatically — a crashed token holder leaves the endpoint fail-closed.

### Ownership is held until the cleanup finishes

`releaseOwnedArtifacts()` was reordered:

1. verify this instance still owns the endpoint — if not, remove NOTHING;
2. remove the socket and the token **while the exclusive claim is still held**;
3. release the ownership claim — only now may another instance take the endpoint.

### Force recovery is loud, never silent

`CLINEMM_CONTROL_SEAM_FORCE=1` remains the only override and is still an explicit, operator-authored
act. It now **logs a warning** when it displaces a LIVE owner and when it breaks an UNREADABLE
record, so it can never silently bypass a live owner's protection. (The force path also had a
latent defect at the entry HEAD — it could not break an *unreadable* record at all; that is closed
and covered by `COR02-C3`.)

### The six required invariants

| # | Invariant | How it is enforced | Witness |
|---|-----------|--------------------|---------|
| 1 | At most one process acquires an endpoint | the claim is an exclusive `link` create | `COR02-R1` |
| 2 | A second contender never changes the owner's token, socket or record | the loser's `link` fails; it re-reads and fails closed | `COR02-R1`, `COR02-C1` |
| 3 | Ownership remains held until the owned socket/token artifacts are gone | the release moved to AFTER the artifact removal | `COR02-R2` |
| 4 | Cleanup never removes another instance's artifacts | ownership is verified immediately before the removal, while the claim is held | `COR02-R2` |
| 5 | A crashed owner fails closed; automatic stale reclamation does not race a live acquisition | the stale reclaim is serialized by an exclusive reclaim token, and the retry is an exclusive create | `COR02-C2` |
| 6 | Explicit force recovery does not silently bypass a live owner's protection | FORCE logs a warning when it displaces a live owner or breaks an unreadable record | `COR02-C3`, `QL06` |

**No generic lock service, no new RPC layer, no additional permanent infrastructure.** The change
is confined to two existing files under `apps/vscode/src/sdk/control-seam/`; the only new
filesystem artifact is a transient per-endpoint reclaim token in the existing private directory.

## C3 — GREEN and conservation

```text
CONTROL-SEAM SUITE: 55/55 PASS (4 pre-existing files, 50 tests, unchanged and green
                     + 1 new file, 5 new witnesses)
  control-seam-proxy.test.ts                         5 tests  PASS
  control-seam.recon01.test.ts                      21 tests  PASS
  control-seam.qual01.test.ts                       21 tests  PASS
  control-seam-authority.production-shape.test.ts    3 tests  PASS
  control-seam.owner-exclusivity.cor02.test.ts       5 tests  PASS (NEW)

TWO MCP TOOLS:  unchanged — clinemm_capabilities + clinemm_get_run, both mutating: false
DEFAULT OFF:    unchanged — resolveControlSeamEnablement() still resolves to default-off
TCP LISTENER:   NONE — server.listen(socketPath) binds an AF_UNIX path; no INET bind
TRANSCRIPT:     NONE — the correction touches no payload, authority or protocol surface
APPROVAL PATH:  NONE — no approval, session or mutation surface is reachable
DIFF SURFACE:   2 production files, BOTH under apps/vscode/src/sdk/control-seam/
                + 1 new test file in the same directory
                + the evidence directory and this report
FORBIDDEN:     no C9/C10, no BCB, no Elm, no native-editor, no session-lifecycle change;
                no proto/, no registry.ts, no shared barrel, no SdkController.ts change
```

**No-regression proof.** The full `apps/vscode` vitest suite was run before and after the
correction. The failing-FILE sets are **byte-identical** (68 files; 178 failing tests in both
runs) — those 178 are the pre-existing baseline of unrelated ACTs on this host. The correction
adds exactly **+2 passing tests** and **0 new failures**.

## C4 — Closure

One bounded correction, committed on `main`. No push, no release, no installation.

**Successor (unchanged):** the operator-run installed VSCodium observation and the Codex Desktop
read-only handshake against the corrected exact-head build. Mutation-control operations remain
unauthorized until `PASS_READONLY_LIVE`.
