# ACT-CLINEMM-PAUSED-EXPORT-EVIDENCE-GAP-REPAIR01 — VERDICT

## VERDICT: `PASS_EVIDENCE_EXPORT_REPAIRED`

### 1. Verdict and why

The automatic incident evidence export is **repaired**. The export now
carries the evidence the host had ACTUALLY observed, joined to the
selected incident by its EXACT identity, and every member reports an
EXPLICIT availability with a reason.

The defect was a **structural MISSING_PRODUCER at the export call
site**, not a missing producer anywhere in the system. Every source the
export needs was already being recorded by the production seams into
EXISTING host-realm diagnostic rings. The ONE production export call
site simply never read them:

- `apps/vscode/src/sdk/automatic-incident-export-runtime.ts` — the ONE
  production export call — passed neither `phaseWriters` nor
  `continuationSummary` to `buildAutomaticIncidentExportBundle`, so
  `phase-writers.jsonl` was ALWAYS empty and `continuation-summary.json`
  was ALWAYS the same constant `unavailable` object.

A second, independent defect was found and fixed: the manifest's
`sources` block derived a member's status from the member's BYTE
LENGTH. `continuation-summary.json` is a non-empty JSON object even
when it reports `unavailable`, so the manifest was reporting it as
**`available` while it carried NO evidence at all**. The repair makes
the availability explicit and truthful.

### 2. What was repaired, and how it was verified

| Field | Result | Verification |
|---|---|---|
| `phase-writers.jsonl` carries real, available, owner-matched phase-writer records | **REPAIRED** | RED -> GREEN, R1a/R1b, via the REAL export path (decompressed ZIP) |
| `phase-writers.jsonl` is scoped to the matching session/task/epoch | **REPAIRED** | R4a (a foreign task/epoch never joins) |
| `continuation-summary.json` carries the actual owner-matched continuation outcome | **REPAIRED** | RED -> GREEN, R2a, via the REAL export path |
| an unrelated / absent continuation authority stays explicitly unavailable | **PRESERVED** | R2b, R2c (negative controls, green at RED and at GREEN) |
| the manifest's source metadata is truthful | **REPAIRED** | RED -> GREEN, R1b, R5b |
| the reconciliation timeline differentiates sink-not-armed / armed-no-records | **REPAIRED** | RED -> GREEN, R3a, R3b |
| foreign owner / stale phase writer cannot leak | **PRESERVED** | R4a, R4b (negative controls) |
| manifest counts, source availability, hash and size checks stay correct | **PRESERVED** | R4c |
| default-off diagnostics have zero state-semantic delta | **PRESERVED** | R5b |
| no new permanent public API / protocol / MCP operation | **PRESERVED** | R5a |

**No `HALT_RED_NOT_REPRODUCED` applies.** A RED was reproduced against
the REAL export path for R1, R2, R3 and the manifest-truthfulness defect,
and each was turned GREEN by the bounded repair. The R2 producer was
FOUND (the canonical CCARD ring, with the canonical BCAPT ring as the
secondary authority), so `CONTINUATION_PRODUCER_UNAVAILABLE` does not
apply either.

### 3. Identity and conservation

| Item | Value |
|---|---|
| **ENTRY_HEAD** | `14a979cd1b8fb23dbe8a1348af4495eaf36984b8` (branch `main`) |
| **SUBJECT_HEAD** | `14a979cd1b8fb23dbe8a1348af4495eaf36984b8` (branch `main`) |
| Predecessor commit reachable | **YES** (`git cat-file -t` -> `commit`; `git merge-base --is-ancestor` -> exit 0) |
| Tree at entry | `git status --porcelain=v1` -> **empty** (no `HALT_UNEXPECTED_TRACKED_DIRT`) |
| Stashes | `stash@{0}: WIP on main: d46223b51 ...` — **PRESERVED** |
| Worktrees | all 5 preserved; no stash/pop/reset/force-checkout performed on a protected stash or worktree |
| Signals sent | **NONE** |
| Live VSCodium instance | **not** changed, restarted, re-instrumented or signalled |
| Push / VSIX deployment / release / install | **NONE** |
| MCP registry / public API / proto | **UNTOUCHED** |
| Signals, termination/cleanup policy, reconciliation horizon, process group ownership, C10 blocking logic, completion suppression | **UNTOUCHED** |

### 4. The corrected evidence claims (C0)

An **addendum** was APPENDED to
`.factory/evidence/ACT-CLINEMM-PAUSED-CONTAINMENT-EVIDENCE-01/VERDICT.md`.
No observed raw fact was rewritten. The five bounded corrections and
the re-affirmed `HISTORICAL_RUNTIME_SOURCE_UNBOUND` binding are stated
in full in the addendum and summarized in `RECON.md` §1.1.

The predecessor's LEGITIMATE observation is preserved verbatim in the
addendum: the persisted alive postcondition and the retained
`containment_failed` states explain the initial fail-closed hold; the
historical reason for the persistence until the later hold is not fully
observed.

### 5. Executable evidence

| Gate | Exit | Result |
|---|---|---|
| G1 — the new RED -> GREEN suite | RED **1** -> GREEN **0** | `6 failed / 8 passed (14)` -> `14 passed (14)` |
| G2 — the existing `automatic-incident-*` aice01 suites | **0** | `5 passed (5)` files, `60 passed (60)` |
| G3 — reconciliation / containment / phase-authority conservation | **1** | `1 failed / 67 passed (68)` — the single failure is a **PROVEN PRE-EXISTING** registry source-text guard (see G3.1) |
| G4 — `tsc --noEmit` | **0** | 0 diagnostics |
| G5 — Biome lint + format on the changed files | **0** / **0** | clean |
| G7 — installed qualification | **NOT_EXECUTED** | no VSIX deployment / install is authorized |

G3.1: both remaining failures across the touched-path sweep
(`CMD02.1` in `turn-state-writer-provenance.wprov.test.ts` and
`BCAPT-CMD.2.1` in `bcb-observation-unavailable-capture.bcapt01.test.ts`)
were reproduced at the **clean ENTRY_HEAD with this ACT's changes
stashed**. They are registry source-text guards unrelated to the export
path and are the **PRE-EXISTING BASELINE**, not regressions of this ACT.
They were recorded, not fixed — fixing them is outside this ACT's
bounded scope.

**No live claim is made.** The repair is verified by TESTS and
STRUCTURAL PROBES only.

### 6. What this ACT does NOT establish

- **The past incident remains `HISTORICAL_RECONCILIATION_UNOBSERVED`.**
  The historical installed artifact
  (`48998ee982f7b5bcae8123359bbbbf6a2487a578fd6081f978ed2f4c1a5b62b5`)
  remains **`HISTORICAL_RUNTIME_SOURCE_UNBOUND`** to any SOURCE_HEAD.
  This ACT repairs FUTURE exports; it does not recover the historical
  incident's evidence.
- The repair does **NOT** arm the diagnostic sinks by default. A public
  user still needs the existing sanctioned opt-in / dogfood arming to
  obtain a fuller future incident. Without it the members remain
  explicitly unavailable — which is the CORRECT, honest outcome, and is
  exactly what the repair's availability classification now states
  (`not_armed`).
- This ACT does **NOT** close a containment or completion-behaviour
  repair. The containment gate, the C10 blocking logic and the
  completion suppression are unchanged.

### 7. The archive

The exact artifact manifest — paths, byte sizes and SHA-256 digests for
every changed file and every evidence file — is
`.factory/evidence/ACT-CLINEMM-PAUSED-EXPORT-EVIDENCE-GAP-REPAIR01/MANIFEST.json`.
It binds to the exact discovered `ENTRY_HEAD` / `SUBJECT_HEAD` and
records the preserved stashes, the preserved worktrees, and the absence
of any push / deploy / release / signal.

---

# CORRECTION01 — VERDICT

## VERDICT: `PASS_EVIDENCE_EXPORT_REPAIRED` (corrected)

### 1. What the review found and what changed

The Factory review returned `HALT_EXPORT_EVIDENCE_MISATTRIBUTION` against
`cee2f28d3`. It found three P0 evidence-correctness issues and one P1
test issue in the join logic. All four are **corrected**, and all four
were reproduced as RED before the correction (`RED-GREEN.md` §C1:
**EXIT 1, 6 failed / 17 passed**).

| Reviewer finding | Status | How it is now correct |
|---|---|---|
| **P0-1** — a phase writer with a matching taskId but NO epoch joined a specific-epoch incident | **CORRECTED** | the join requires `record.epoch === incident.identity.epoch` EXACTLY; an epoch-less record and a different-epoch record are BOTH dropped |
| **P0-2** — the continuation outcome was the FIRST matching CCARD record (arbitrary, possibly stale, possibly cross-epoch) | **CORRECTED** | a record must satisfy the owner scope, the epoch (when it carries one), the incident's temporal LOWER BOUND, an AUTHORITATIVE outcome stage, and the LATEST qualifying record wins (ordered by the ring's monotonic `seq` / position) |
| **additional** — export-time arming was reported as the incident-time reason | **CORRECTED** | the incident-time availability is `unknown` unless records were actually joined; the export-time arming is reported SEPARATELY in a labeled `exportTimeArming` field and never explains historical absence |
| **P1** — the privacy test declared sentinels but never injected them | **CORRECTED** | the sentinels are GENUINELY injected into the source records, their presence there is asserted, and their absence from every archive member is asserted |

### 2. The P1 correction exposed a REAL leak

Fixing the vacuous privacy fixture revealed a genuine defect the empty
fixture had hidden: the export's privacy gate is a **KEY** allowlist, and
it assumed the VALUE of an allowlisted key was a bounded enum member. A
phase slot carrying arbitrary text therefore reached
`phase-writers.jsonl` verbatim through the allowlisted `commitOrigin`
key.

The correction closes it by validating the phase VALUE against the
closed `TurnPhase` set before export (`exportSafePhase`); a value outside
the set is DROPPED. **No new privacy mechanism was added** — the existing
allowlist's assumed invariant is now enforced.

### 3. Executable evidence (CORRECTION01)

| Gate | Exit | Result |
|---|---|---|
| the new suite | RED **1** -> GREEN **0** | `6 failed / 17 passed (23)` -> `24 passed (24)` |
| the existing `automatic-incident-*` aice01 suites | **0** | `60 passed (60)` |
| the reconciliation / containment / phase-authority sweep | **1** | `1 failed / 67 passed (68)` — the SAME pre-existing `BCAPT-CMD.2.1` registry source-text guard |
| `tsc --noEmit` | **0** | 0 diagnostics |
| Biome lint / format | **0** / **0** | clean |

### 4. What the correction does NOT change

- The repaired-export baseline `cee2f28d3` is **preserved**; the
  correction is a separate, additive commit on top of it.
- The historical causality discussion is **not reopened**.
- The historical installed artifact remains
  **`HISTORICAL_RUNTIME_SOURCE_UNBOUND`**; the past incident remains
  **`HISTORICAL_RECONCILIATION_UNOBSERVED`**.
- No signal, termination/cleanup policy, reconciliation horizon,
  process-group ownership, C10 blocking logic, completion suppression,
  public API/proto or MCP registry was touched. The operator's live
  VSCodium instance was not changed, restarted or signalled. No push,
  VSIX deployment, release or install.

### 5. Installed qualification

The review directs an **isolated installed-extension qualification** using
a disposable VSCodium profile after the correction, and only then
`PASS_EVIDENCE_EXPORT_LIVE`. That qualification is **NOT EXECUTED** by
this correction: the correction's scope was the bounded implementation
and its verification. **No live claim is made.** The verdict remains
`PASS_EVIDENCE_EXPORT_REPAIRED` — a tests-and-structural-probes verdict,
not a live one.
