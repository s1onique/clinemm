# ACT-CLINEMM-PAUSED-CONTAINMENT-EVIDENCE-01 — VERDICT

## VERDICT: `PASS_CAPTURE_DECISIVE`

### 1. Verdict and why (one paragraph)

The incident's paused state is **explained by a genuine containment failure that
legitimately remained blocked**, and the causal boundary is **selected** by
correlated evidence from the *real* production seam: the archive's
`postcondition: "alive"` with `osErrorCode: null` is, under the production
probe (`defaultTerminalPostconditionProbe`,
`apps/vscode/src/sdk/command-job-manager.ts:4260-4274`), **only** producible by
`process.kill(-pgid, 0)` returning **rc=0** — the probe was *permitted* and the
kernel reported the process group as *existing*; the measured spawn->failure
intervals (8.761 s and 6.064 s) both **exceed** the production 5 000 ms
`TERM_GRACE_MS`, so a full SIGTERM->grace->SIGKILL sequence had already run and
the group was still there; and the real production seam proves the two rival
explanations are *discriminated* rather than conflated — a group that exits
inside the bounded reconciliation horizon **is** reconciled and the C10 blocking
set **does** drain (executed, D2), while a group that survives the horizon is
**never** reconciled and the gate stays closed (executed, D1). The archive's
empty `reconciliation-timeline.jsonl` is **not** evidence that reconciliation
never ran: the owning producer still registers and still publishes the
`command_job_containment_reconciled` lifecycle event with the diagnostic sink
disarmed (executed, D3) — the sink is **default-off** and was disarmed in the
public profile that produced the incident. Finally, the archive's
`phase-writers.jsonl` and `continuation-summary.json` are **structurally
un-wired** in the production export call site, so they carry **no** runtime
information at all.

---

## 2. Identity and conservation

| Item | Value |
|---|---|
| **ENTRY_HEAD** | `043a0606f5f43b0d742f8fa0b6a05c7014bf2fce` (branch `main`) |
| **SUBJECT_HEAD** | `043a0606f5f43b0d742f8fa0b6a05c7014bf2fce` (branch `act/clinemm-paused-containment-evidence-01`) |
| Remote | `origin git@github.com:s1onique/clinemm.git` / `upstream https://github.com/cline/cline.git` |
| Tree at entry | `git status --porcelain=v1` -> **empty** (no `HALT_UNEXPECTED_TRACKED_DIRT`) |
| Tree at close | only this ACT's two new untracked paths; **no production file changed** |
| Stashes | `stash@{0}: WIP on main: d46223b51 ...` — **preserved** (restored to `stash@{0}` after the isolation probe) |
| Worktrees | all 5 preserved; **no** worktree/stash/pop/reset/force-checkout/push/release/deploy performed |
| Original ZIP | retained **outside** the repository, immutable, SHA-256 verified, never executed |
| Signals sent | **NONE** to PID 9667 / 13450 / PGID 9667 / 13450 (only `kill -0` existence/permission probes) |
| Live paused instance | **not** modified, restarted, re-instrumented or signalled |
| MCP registry / control seam | **untouched** |

---

## 3. Production seam map

See `RECON.md` (full map with paths, functions and line numbers for all eight
required transitions). Summary of the load-bearing seams:

| # | Transition | Owner | Classification |
|---|---|---|---|
| 1 | Spawn / PID / PGID / birth identity | `command-job-manager.ts:2624`, `:4285` | OBSERVABLE_NOW (seam) / UNAVAILABLE_FROM_TRACE (incident) |
| 2 | Stop request + signal attempt | `command-job-manager.ts:2938-2941`, `:3887-3930` | OBSERVABLE_NOW (seam) / UNAVAILABLE_FROM_TRACE (incident) |
| 3 | After-signal OS postcondition | `command-job-manager.ts:4260-4274` | **OBSERVABLE_NOW** |
| 4 | `containment_failed` publication + retained terminal state | `command-job-manager.ts:3483-3490`, `SdkController.ts:6217-6233` | **OBSERVABLE_NOW** |
| 5 | Reconciliation registration / attempt / outcome / publication | `command-job-manager.ts:1664-1955`, `SdkController.ts:6517-6562` | **MISSING_PRODUCER (observation) — producer exists, sink default-off** |
| 6 | C10 blocking set / reevaluation / suppression / release | `sdk-session-event-coordinator.ts:1202-1263`, `:2733-2831`, `:4914-4943` | **OBSERVABLE_NOW** |
| 7 | Native UI Paused / `resumable` + banner | `sdk-session-event-coordinator.ts:5202`, `turn-phase-contract.ts:438` | **OBSERVABLE_NOW** |
| 8 | Tests / emitters / export joins | see `RECON.md` §8 | OBSERVABLE_NOW |

**First lossy boundary:** the **default-off reconciliation diagnostic sink**
(`reconciliation-diagnostic-capture.ts:216-218`, armed only via
`dogfood-diagnostic-profile.ts:2213-2231` from `extension.ts:544`).

**Structural MISSING_PRODUCER (proven from source):** the production export call
site `automatic-incident-export-runtime.ts:170-174` passes neither
`phaseWriters` nor `continuationSummary`, so `phase-writers.jsonl` is always
empty and `continuation-summary.json` is always the same constant.

---

## 4. Per-job causal timeline

Full record set: `TRACE.jsonl` (36 records, each with provenance and an
explicit classification).

### `cmd_mwh14ea1zuxmau36` (pid/pgid 9667)

| Stage | Time | Class | Source |
|---|---|---|---|
| job accepted / spawned (`backgroundExec`) | 23:20:51.880Z | OBSERVABLE_NOW | LIVE log |
| process birth identity | — | UNAVAILABLE_FROM_TRACE | not persisted |
| stop request | — | UNAVAILABLE_FROM_TRACE | not persisted |
| signal attempt (target/signal/result) | — | UNAVAILABLE_FROM_TRACE | not persisted |
| OS postcondition | 23:21:00.641Z | **OBSERVABLE_NOW** | archive: `alive`, errno `null` (rc=0) |
| terminal publication | 23:21:00.641Z | OBSERVABLE_NOW | archive: `containment_failed`, retained |
| reconciliation registration/attempt/result | — | MISSING_PRODUCER | sink default-off |
| controller reception | — | MISSING_PRODUCER | sink default-off |
| blocking-set mutation | 23:21:00.641Z | OBSERVABLE_NOW | `backgroundCommandJobStates[jobId]` |
| C10 reevaluation | 23:38:36.078Z | OBSERVABLE_NOW | `remainingBlockingJobCount=2` |
| completion / hold phase writer | 23:38:44.760Z | OBSERVABLE_NOW | `unresolved_containment_failure`, `resumable` |
| continuation outcome | — | MISSING_PRODUCER | export constant |

### `cmd_mwh15l67vap32h26` (pid/pgid 13450)

Identical shape; spawn **23:21:50.191Z**, failure **23:21:56.255Z**
(interval **6.064 s**), all subsequent stages as above.

### Session-level

- **23:33:02.217Z** first `held_phase_published` with
  `holdReason: suppress_originating_completion` (12 observations to 23:38:36).
- **23:33:10.022Z -> 23:38:44.760Z** the containment hold repeated **10x** in
  the live log, always with the same two job ids; no release ever occurred.
- **23:38:36.078Z** deferred C10 reevaluation:
  `remainingBlockingJobCount=2`, `unconsumedTerminalCount=0`,
  `ownerStillRunning=false`, `heldObligation=false`,
  `outstandingAutonomousWork=false`, hold `unresolved_containment_failure`.
- **23:38:44.760Z** terminal `held_phase_published`, phase `resumable`.
- **23:38:44.813Z** incident snapshot updated to revision 18;
  `completionCommitted=false`.

### OS truth at ACT time (LIVE, read-only)

The recorded leaders (9667, 13450) are **ABSENT**. The numeric PGIDs are now
occupied by **unrelated** `bun /tmp/seam-host.ts` processes started
**~3 hours after** the incident — **PID/PGID reuse**, and `kill -0` on them now
returns **EPERM**. The incident's original groups are **provably gone**; the
numeric PGID alone is not a valid identity carrier today.

---

## 5. RED / discriminator / ablation

**Command**

```
cd apps/vscode && bunx vitest run --config vitest.config.ts \
  src/sdk/__tests__/paused-containment-evidence01.discriminator.pce01.test.ts
```

**Exact result — EXIT 0, 3 passed (3)**

```
 ✓ D1 REAL_PRODUCTION_SEAM -- an actual survivor keeps the containment gate
      closed and is never reconciled                                      7584ms
 ✓ D2 REAL_PRODUCTION_SEAM -- a group that exits inside the horizon is
      reconciled and the blocker drains                                  2691ms
 ✓ D3 SYNTHETIC_REAL -- the DEFAULT-OFF diagnostic sink hides the
      observation but not the lifecycle event                            3019ms
```

**Ablation (single varying factor = group liveness at the horizon):** D1
survivor -> no reconciliation, no terminal commit, hold retained. D2 group dies
in time -> `command_job_containment_reconciled` published, blocker drains. D3
sink disarmed -> lifecycle event **present**, diagnostic records **empty**.

**Necessity:** a reconciliation event is necessary and sufficient to drain the
C10 blocking set; no other production path writes a non-`containment_failed`
projection for a contained job.

**Conservation:** the gate stays closed for a genuine survivor; release happens
only after a fresh verified `gone` through the real authority path; the
reconciled-marker guard blocks a delayed stale `containment_failed` overwrite;
the default-off diagnostic has **ZERO** state-semantic delta (G18 PASS).

**Note on the ACT's "RED" framing:** the historical incident cannot be
reproduced as a *defect* — the observed behaviour is the **correct** behaviour
of a correctly-implemented gate. Therefore this ACT produced a **passing
discriminator witness** rather than an intentionally failing RED. **No
intentionally failing test was left in the default suite.**

---

## 6. Installed runtime and artifact identity

| Item | Value |
|---|---|
| Incident bundle SHA-256 (recorded) | `48998ee982f7b5bcae8123359bbbbf6a2487a578fd6081f978ed2f4c1a5b62b5` |
| Matched local artifact | `~/.vscodium-clinemm/extensions/s1onique.clinemm-4.1.16-5a1c485cb-e761cea8c/dist/extension.js` (and the `.vscodium-cline` twin) |
| Artifact bytes | **27 411 852** |
| Artifact SHA-256 | `48998ee982f7b5bcae8123359bbbbf6a2487a578fd6081f978ed2f4c1a5b62b5` — **MATCH** |
| Manifest version | `4.1.16-5a1c485cb-e761cea8c` (publisher `s1onique`, name `clinemm`) |
| Candidates hashed | 97 bundles of the matching version; 2 matched |
| Extension host | PID **47602**, PGID 47523, started **2026-11-14T11:57:36Z**, **ALIVE** at ACT time; `lsof` proves it wrote the log and owns the incident's `sessions.db` |
| Host platform | darwin / arm64 (macOS) |
| **Runtime -> SOURCE binding** | **HISTORICAL_RUNTIME_SOURCE_UNBOUND** — `build-identity.json` recorded `provenanceVerification: "UNOBSERVED"`, `verificationNote: "no build provenance artifact was present"`. A version string does **not** encode a source HEAD; the hash identifies the **artifact**, not the **source tree**. |
| Newly instrumented build | **none produced** — the decisive evidence was acquired from the still-alive incident host itself; no new artifact identity is claimed. |

---

## 7. Executable gates

See `GATES.md` for the full table with exact commands and exit codes.

| Gate | Exit | Result |
|---|---|---|
| G1 identity/safety | 0 | clean tree at entry; stash + worktrees preserved |
| G2 archive integrity | 0 | ZIP hash matches; **9/9** manifest members verified |
| G3 artifact binding | 0 | 2 bundles match the incident hash |
| G4 live host binding | 0 | incident host alive and bound |
| G5 OS postcondition | 0 | leaders gone, PGIDs reused, **no signal sent** |
| G6 focused tests | **0** | **7 files / 69 tests passed** |
| G7 typecheck + lint | 0 | `tsc --noEmit` 0 diagnostics; biome lint + format clean |
| G8 pre-existing isolation | n/a | the one failing test fails **identically at pristine ENTRY_HEAD** with this ACT's changes removed => pre-existing; protected stash restored to `stash@{0}` |
| G9 no-production-change | 0 | `git diff --stat HEAD -- apps/vscode/src` empty |

---

## 8. One next action only

**Authorize a bounded repair ACT for the EVIDENCE-GAP class only — not for the
containment gate, which behaved correctly.**

The precise scope of the authorized repair is:

1. **Wire the two orphaned export inputs.** Pass the already-produced
   `getTurnStateWriterProvenanceRecords()` and a real continuation summary into
   `buildAutomaticIncidentExportBundle` at its only production call site
   (`apps/vscode/src/sdk/automatic-incident-export-runtime.ts:170-174`). This
   removes the structural `phase-writers.jsonl` / `continuation-summary.json`
   dead spots, which are **proven by source** and carry **zero** runtime
   information today.
2. **Make the reconciliation timeline observable in the public profile** by the
   existing, sanctioned, user-visible route
   (`clineDetailedLocalDiagnosticsEnabled` /
   `applyReconciliationDiagnosticCaptureProfile`), and make the exporter report
   `reconciliation-timeline.jsonl` as `unavailable` **with its reason**
   ("diagnostic sink not armed") instead of as a bare empty file — so a future
   incident cannot be read as "reconciliation never ran".
3. **Do NOT change** the containment gate, the signal policy, the cleanup
   policy, the blocking logic, or the completion suppression. The evidence
   shows those behaved correctly.

### Exact reopen / repair-eligibility condition

The repair ACT is **eligible now** because:
- the causal boundary is **selected** (the gate held on a genuine survivor;
  the stale-blocker explanation is excluded by an executed D2),
- a **real** RED exists and is reproducible at the identified seam (D1/D2 are
  the real production seam; the pre-repair RED witness
  `transient-containment-reconciliation-repair01.red-only.tcrr01.test.ts` remains
  in the tree), and
- the **first missing producer** is named exactly: the export call site that
  never supplies `phaseWriters` / `continuationSummary`.

The repair ACT is **NOT** eligible to change the containment gate, and this ACT
does **not** authorize any such change.

### If the repair ACT is declined

**Reopen condition (precise):** a future incident in which the reconciliation
diagnostic sink is **armed** (dogfood profile or the public opt-in) and the
reconciliation timeline is **still** empty or shows `reconciliation_exhausted`
for a job whose group is verified `gone`. Only then is the reconciliation
producer itself implicated, and the next ACT should target
`runContainmentReconciliationTick` / `applyContainmentReconciliation` rather
than the export path.

### Residual uncertainty (explicitly bounded)

The fate of the two groups **after** the 5 s reconciliation horizon is not
resolvable from this evidence, because the sink was disarmed. This residual
does **not** change the verdict: the gate was correct at every boundary it could
observe, and the groups are now provably gone.

### Safety notes carried forward

- The numeric PGIDs 9667 / 13450 are **foreign today**. A future ACT must
  **never** signal them on the basis of this archive; the production code's
  requirement of a fresh `gone` verdict from the *same owned identity* is the
  correct guard and must be preserved.
- The incident's extension host (PID 47602) is still running the incident's
  bundle. Any follow-up that needs a live run must use a **separate disposable
  profile**, never this instance.
