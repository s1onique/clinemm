# ACT-CLINEMM-PAUSED-EXPORT-EVIDENCE-GAP-REPAIR01 — RECON

## 0. Scope

**Primary purpose:** repair automatic incident evidence export. NOT
process containment and NOT completion policy.

**Authorized:** one bounded correction to evidence claims, then a focused
RED -> GREEN repair of existing export wiring and diagnostics
availability classification.

**Forbidden (and NOT done):** altering signals, termination/cleanup
policy, reconciliation horizon, process group ownership, C10 blocking
logic, completion suppression, public API/proto or MCP registry;
changing/restarting/signalling the operator's still-running VSCodium
instance; push; VSIX deployment; release.

## 1. C0 — identity, safety and evidence correction

| Item | Value |
|---|---|
| ENTRY_HEAD | `14a979cd1b8fb23dbe8a1348af4495eaf36984b8` |
| Branch | `main` |
| `git status --porcelain=v1` at entry | **empty** (no `HALT_UNEXPECTED_TRACKED_DIRT`) |
| `git remote -v` | `origin git@github.com:s1onique/clinemm.git` / `upstream https://github.com/cline/cline.git` |
| Predecessor commit reachable? | **YES** — `git cat-file -t` -> `commit`; `git merge-base --is-ancestor 14a979cd1 HEAD` -> exit 0 |
| Stashes | `stash@{0}: WIP on main: d46223b51 ...` — **PRESERVED** (never popped/reset by this ACT) |
| Worktrees | all 5 preserved; no worktree/stash/pop/reset/force-checkout performed |
| Signals / restarts of the live VSCodium instance | **NONE** |
| Push / VSIX deploy / release | **NONE** |

The predecessor commit `14a979cd1b8fb23dbe8a1348af4495eaf36984b8` is
**this ACT's ENTRY_HEAD**. The reported predecessor commit was therefore
treated as an existing anchor to VERIFY, not as a predicted entry HEAD.

### 1.1 The evidence correction

An **addendum** was APPENDED to
`.factory/evidence/ACT-CLINEMM-PAUSED-CONTAINMENT-EVIDENCE-01/VERDICT.md`.
No observed raw fact was rewritten; no trace entry was altered. The
addendum carries the five bounded corrections:

1. `process.kill(-pgid, 0)` rc=0 establishes group existence **at the
   observed instant only** — not ownership, not birth identity, not later
   survival.
2. A spawn->failure interval exceeding `TERM_GRACE_MS` does **not**
   independently prove SIGTERM/SIGKILL delivery — the signal attempt and
   its result were unobserved.
3. A controlled D3 event with a disarmed sink does **not** prove that
   either historical job registered or completed reconciliation.
4. D2 proves a **manager-level** reconciliation event in its harness; it
   does **not** establish end-to-end C10 clearing absent a correlated
   controller/C10 assertion.
5. At the later C10 reevaluation the state is **cached**; whether the
   original group had gone after the bounded reconciliation horizon is
   **UNAVAILABLE_FROM_TRACE**.
6. The historical installed artifact
   (`48998ee982f7b5bcae8123359bbbbf6a2487a578fd6081f978ed2f4c1a5b62b5`)
   remains **HISTORICAL_RUNTIME_SOURCE_UNBOUND** to any SOURCE_HEAD.

### 1.2 The LEGITIMATE observation that is preserved

The persisted **alive** postcondition and the **retained**
`containment_failed` states explain the INITIAL fail-closed hold. The
**historical reason for the persistence of the hold until the later hold
is not fully observed** — that gap is unchanged.

## 2. C1 — recon before editing

### 2.1 The actual current implementations that were read

| File | What was read |
|---|---|
| `apps/vscode/src/sdk/automatic-incident-export-runtime.ts` | the ONE production export call (`prepareAutomaticIncidentExport` -> `buildAutomaticIncidentExportBundle`) |
| `apps/vscode/src/sdk/automatic-incident-export.ts` | the ZIP schema, the strict detail allowlist, the manifest, the `sources` block |
| `apps/vscode/src/sdk/reconciliation-diagnostic-capture.ts` | the arming state (`enabled`), the capture entry point, the record lifetime (bounded in-memory ring) |
| `apps/vscode/src/shared/turn-state-writer-provenance.ts` | the record schema, the ring ownership, the execution realm |
| `apps/vscode/src/sdk/turn-state-tracker.ts` | the REAL phase-writer producer seam |
| `apps/vscode/src/sdk/continuation-cardinality-authority.ts` | the canonical CCARD continuation ring |
| `apps/vscode/src/shared/bcb-observation-unavailable-capture.ts` | the canonical BCAPT continuation ring |
| `apps/vscode/src/sdk/automatic-incident-capture.ts` | the incident manager, the identity key, the reconciliation join |

### 2.2 The compact producer -> collection -> join -> export map

| Source | Producer (extension-host realm) | Collection | Join | Export member |
|---|---|---|---|---|
| **Phase writers** | `TurnStateTracker.setWithWriter` (`turn-state-tracker.ts:175`) -> `recordTurnStateWriterProvenance` | `getTurnStateWriterProvenanceRecords()` (TSWPD host ring) | **NONE at ENTRY_HEAD** | `phase-writers.jsonl` — **ALWAYS EMPTY** |
| **Continuation (CCARD)** | the completion-authority seams -> `captureContinuationCardinalityAuthorityRecord` | `getContinuationCardinalityAuthorityCaptureRecords()` (CCARD host ring) | **NONE at ENTRY_HEAD** | `continuation-summary.json` — **ALWAYS THE CONSTANT** |
| **Continuation (BCAPT)** | `sdk-session-event-coordinator.ts:5427` -> `recordBcbObservationUnavailableCapture` | `getBcbObservationUnavailableCaptureRecords()` (BCAPT host ring) | **NONE at ENTRY_HEAD** | (same member) |
| **Reconciliation** | TCRR01 -> `captureReconciliationDiagnostic` (DEFAULT-OFF sink) | `joinReconciliationRecordsToIncidents` (jobId + ownerSessionId) | **WIRED** -> `incident.reconciliationTimeline` | `reconciliation-timeline.jsonl` — **WIRED** |

**The gap, stated exactly:** at ENTRY_HEAD the ONE production export call
site (`automatic-incident-export-runtime.ts:170-174`) passed neither
`phaseWriters` nor `continuationSummary` to
`buildAutomaticIncidentExportBundle`.

### 2.3 The realm question — CONFIRMED, not assumed

The ACT warned: "Do not assume the `getTurnStateWriterProvenanceRecords()`
getter in the extension host can see records produced in the React/webview
JS realm."

**Confirmed by reading the producer sites:** every producer lives in the
**extension-host** JS realm.

- `turn-state-tracker.ts` is imported by the host-side `SdkController`;
  it stamps `@shared/turn-state-writer-provenance`'s module-level ring.
- `continuation-cardinality-authority.ts` is stamped by the host-side
  completion-authority seams.
- `bcb-observation-unavailable-capture.ts` is stamped by
  `sdk-session-event-coordinator.ts` (host).
- `reconciliation-diagnostic-capture.ts` is stamped by
  `command-job-manager.ts` (host).

The webview / React realm NEVER produces these records. The export
runtime itself runs in the extension host and resolves the incident
through the HOST's authority (`getAutomaticIncidentForTask`), never
through a webview-supplied identity. So the host getter sees exactly the
records the production seams wrote — no cross-realm transfer is needed
and none was introduced.

### 2.4 The canonical owner-scoped continuation summary producer — FOUND

There **IS** a canonical owner-scoped continuation authority. It is not
one but TWO existing canonical host rings, both already carrying the
owner identity:

- **CCARD** (`continuation-cardinality-authority.ts`) — the completion
  cardinality authority. Records carry `sessionId`, `taskId`, `stage`,
  `origin`, `at`. Its `task_completion_committed` stage is the C10
  commit-stage boundary.
- **BCAPT** (`shared/bcb-observation-unavailable-capture.ts`) — the BCB
  observation-unavailable decision boundary. Records carry `sessionId`,
  `taskId`, `epoch`, `writerId`, `requestedPhase`, `committedPhase`,
  `capturedAt`.

**No new producer was invented and no protocol was added to transfer a
summary.** The repair REUSES these two rings through a bounded join.

### 2.5 What was NOT built

- No new recorder.
- No new recorder call site.
- No new protocol / proto / RPC.
- No new public API.
- No MCP registry change.
- No new instrumentation subsystem.
- Diagnostic capture is NOT forced on in public profiles: the existing
  sanctioned opt-in / dogfood arming remains the way to obtain a fuller
  future incident.

## 3. The bounded implementation (C3)

### 3.1 The new seam module

`apps/vscode/src/sdk/automatic-incident-export-sources.ts` — the
OWNER-SCOPED SOURCE JOIN. It reads the EXISTING host rings and joins
them to the incident:

- phase writers: `taskId` AND `epoch` must match. A record carrying
  NEITHER is NOT joined (an unscoped record cannot be attributed).
- continuation: CCARD first (`sessionId` + `taskId`), then BCAPT
  (`sessionId` + `taskId` + `epoch`). The first match wins, so the
  summary names ONE authoritative outcome.
- reconciliation: classified as `available` / `not_armed` /
  `no_matching_records` / `unknown`.

Every source reports an EXPLICIT availability with a reason. An empty
collection is NEVER presented as a complete capture.

### 3.2 The production wiring

`prepareAutomaticIncidentExport` now passes `phaseWriters`,
`continuationSummary` and an explicit `sourceAvailability` map into
`buildAutomaticIncidentExportBundle`. This is the ONLY production export
call site, so the repair reaches the real user-facing path.

### 3.3 The manifest truthfulness fix

`buildAutomaticIncidentExportBundle`'s `sources` block derived its
status from `file.contents.trim().length > 0`. That was UNTRUTHFUL for
every member whose file legitimately carries a non-empty "unavailable"
envelope — `continuation-summary.json` is a non-empty JSON object even
when it says `unavailable`, so the manifest reported it as `available`.
The builder now accepts an explicit `sourceAvailability` map and falls
back to the old heuristic for callers that do not state it, so no other
call site's behaviour changes.

### 3.4 The arming-state honesty

The reconciliation arming state is read at EXPORT time. The export
reports `not_armed` when the sink was disarmed and never claims to know
the arming state AT INCIDENT TIME when that cannot be established. The
`reconciliation-timeline.jsonl` member's `availabilityReason` names the
state, so an empty JSONL is no longer evidence of "no reconciliation".

---

# CORRECTION01 — the corrected join design

## 1. Why the FIRST join was wrong

The first correction's join used three weak predicates:

1. **phase writers:** `record.epoch !== undefined && record.epoch !== epoch`
   — an epoch-LESS record joined a specific-epoch incident;
2. **continuation:** the FIRST CCARD record matching `sessionId + taskId`
   — an arbitrary choice that could be stale, cross-epoch, or a
   mid-flight ENTER-only stage;
3. **reconciliation:** the sink's arming state read AT EXPORT TIME was
   reported as if it described the incident.

Each of these can attach evidence to an incident that does not own it.
That is a TRUST defect, not a cosmetic one: the export is the
user-facing support artifact.

## 2. The corrected predicates

### 2.1 Phase writers — EXACT task AND epoch

```
record.taskId === incident.identity.taskId
record.epoch   === incident.identity.epoch      // EXACT; undefined never joins
```

A record that carries no epoch cannot be attributed to one epoch, so it
is dropped. A record from a different epoch is dropped.

### 2.2 Continuation — five conjunctive predicates

```
1. record.sessionId === incident.identity.sessionId
2. record.taskId    === incident.identity.taskId
3. record.epoch     === incident.identity.epoch     // when the record carries one
4. record.at        >= incident.openedAt            // the temporal LOWER BOUND
5. an AUTHORITATIVE outcome stage, and the LATEST qualifying record wins
```

**Why `openedAt` and NOT `[openedAt, updatedAt]`.** The first attempt used
the full window `[openedAt, updatedAt]` and it broke a legitimate case:
a continuation outcome is a CONSEQUENCE of the hold, so it legitimately
occurs AFTER the incident's last observation. The upper bound rejected
it. The causal discriminator that matters is the LOWER bound: a record
captured BEFORE the incident opened belongs to an earlier epoch of the
same task. The upper side is discriminated by the epoch match (BCAPT)
and by selecting the LATEST qualifying record (CCARD).

**Why an authoritative-stage requirement.** CCARD is a CYCLE recorder:
it observes the whole lifecycle. Its ENTER-only stages
(`run_turn_started`, `execute_turn_prelude_enter`, `terminal_committed`,
`notify_consume_enter`, `wake_created`, `pending_prompt_enqueued`,
`pending_prompt_dequeued`, `continuation_scheduled`, `task_started`,
`continuation_started`) record that something STARTED. Presenting one as
the incident's outcome would report a mid-flight observation as a
terminal verdict. Only the outcome-bearing stages qualify:
`agent_turn_done`, `submit_and_exit_seen`, `task_completion_committed`.

**Why the LATEST record wins, and how ties are broken.** "First match"
was arbitrary. "Latest match" names the incident's most recent outcome.
CCARD carries a MONOTONIC `seq`, which is strictly increasing even when
two records land in the same millisecond. BCAPT carries no per-record
sequence, so the ring's own POSITION is the tiebreaker there.

### 2.3 Reconciliation — incident-time and export-time are SEPARATE

| Field | Meaning | Values |
|---|---|---|
| `availabilityReason` | the INCIDENT-TIME availability | `unknown` (never established) or absent (records were joined) |
| `exportTimeArming` | the EXPORT-TIME arming state | `armed` / `disarmed` |

The incident does NOT record the arming state it was in when it opened.
The sink may have been armed or disarmed at any time between the
incident and the export. So the incident-time reason is `unknown` unless
records were ACTUALLY joined, and the export-time arming is reported
separately and is NEVER used to explain the absence of historical
evidence.

### 2.4 The privacy value invariant

The export's privacy gate is a KEY allowlist (`sanitizeDetail`). It
assumed the VALUE of an allowlisted key was bounded. For the phase
writer's `commitOrigin`, the value is a `TurnPhase` — a closed string
union — but nothing enforced it.

`exportSafePhase` now validates the value against the closed
`LEGITIMATE_TURN_PHASES` set. A value outside the set is DROPPED. This
closes the real leak that the CORRECTION01 privacy fixture exposed, and
it adds no new privacy mechanism: it enforces the allowlist's existing
assumed invariant.

## 3. What was NOT changed

No new recorder, no recorder call site, no protocol, no public API, no
MCP operation, no signal, no termination/cleanup policy, no
reconciliation horizon, no process-group ownership, no C10 blocking
logic, no completion suppression. The repair stayed entirely inside the
existing export sources, the existing export runtime/builder and the
focused test suite.
