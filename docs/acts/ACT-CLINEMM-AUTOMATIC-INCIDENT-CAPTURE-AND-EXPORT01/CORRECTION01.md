# ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01-CORRECTION01

**Short name:** AICE01-CORRECTION01
**Predecessor:** `ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01` (AICE01)
**Predecessor reviewer verdict:** `HALT_EVIDENCE_PROVENANCE_INTEGRITY`
**ENTRY_HEAD:** `c69d22a287adb40f13a901e6e0eee21daaefabaf`
**Branch:** `main`

---

## 1. Why this correction exists

AICE01 delivered the automatic incident capture, the durable incident
store, the task-header export button and the privacy-filtered ZIP
workflow. The reviewer did NOT dispute any of that. The reviewer
disputed the **causal correctness of the diagnostic report**: the
feature compiles, the tests pass, and the report can still assert
things that never happened.

Four P0 evidence-provenance defects and one non-blocking P1 were
authorized for a single bounded correction.

This correction changes the EVIDENCE SEMANTICS of the incident
capture and nothing else. The completion semantics, the containment
semantics, the C10 barrier semantics, the TCRR01 reconciliation
semantics, the CFPR01 protected retention semantics and the Elm
production-kernel semantics are all **unchanged**.

## 2. The four P0 repairs

### 2.1 P0-1 — Publication identity and ordering

**The defect.** `SdkController.publishContainmentReconciliation`
called `captureControllerReconciliationPublication(event)` BEFORE it
issued the asynchronous state update, so the diagnostic recorded
`controller_reconciliation_published` regardless of whether the
update ever committed. A failed update left the report claiming a
publication that never happened.

Worse, the capture selected its incident with
`getAutomaticIncidentForTask(this.task?.taskId)` — the **active**
task. A reconciliation for task A that arrived while task B was in
the foreground was attributed to task B's incident, silently
corrupting whichever incident happened to be in the foreground.

**The repair.**

1. The capture now happens AT the authoritative publication boundary:
   after `updateBackgroundCommandState` resolves, or after it
   rejects. A rejected publication records the outcome
   `controller_reconciliation_publication_failed` — never a
   successful publication.
2. The incident is resolved with the NEW
   `getAutomaticIncidentForOwnerJob({ ownerSessionId, jobId })`,
   which binds on the ORIGINAL event identity. The job must be in the
   incident's blocking set AND the incident's session must match the
   event's owner session. Nothing about the active task is consulted.
3. The `controllerPublication` coverage field advances ONLY on a
   successful publication. A recorded failure leaves it
   `NOT_OBSERVED`, because an observation of a failure is not an
   observation of a publication.

**Production semantics are unchanged.** The reconciled job is still
marked before the publication (G11: a delayed, stale
`containment_failed` publication cannot overwrite the newer
authoritative state), and the lifecycle handler is still
fire-and-forget.

### 2.2 P0-2 — Evidence semantics

**The defect (a).** `advanceCoverage` advanced
`terminalPublication` to `OBSERVED` on `completion_held`,
`held_phase_published`, `stalled_no_progress` and
`completion_committed`. NONE of those observe the job's own
terminal-state publication — they are whole-incident / phase /
completion boundaries. The report could assert that a blocking job's
terminal state was published when the publication was never observed.

**The repair (a).** The only stage that observes the job's terminal
publication is `containment_failure_published` — the production
boundary that actually publishes the job's terminal state.

**The defect (b).** The recorder emits a `stage` field. The join read
`event` / `outcome`, so BOTH lookups fell through to their fallbacks:
`outcome` became the literal `"reconciliation_observed"` and
`reconciliationTerminalOutcome` became the literal `"OBSERVED"`. The
second fallback is the defect — it asserted a **terminal**
reconciliation outcome for EVERY record, including a registration or
an ordinary probe attempt.

**The repair (b).** The join now reads the `stage` field and derives
the observation semantics from it:

| observed `stage`               | `reconciliationRegistration` | `reconciliationAttempts` | `reconciliationTerminalOutcome` |
| ------------------------------ | ---------------------------- | ------------------------- | -------------------------------- |
| `reconciliation_registered`    | `OBSERVED`                  | `NOT_OBSERVED`           | `NOT_OBSERVED`                   |
| `reconciliation_skipped`       | `NOT_OBSERVED`              | `NOT_OBSERVED`           | `NOT_OBSERVED`                   |
| `reconciliation_attempt`       | `NOT_OBSERVED`              | `OBSERVED`               | `NOT_OBSERVED`                   |
| `reconciliation_resolved`      | `NOT_OBSERVED`              | `NOT_OBSERVED`           | `OBSERVED`                       |

### 2.3 P0-3 — Source-bound export

**The defect.** `prepareAutomaticIncidentExport` passed

```ts
containmentProvenance: { status: persisted ? "available" : "unavailable" }
```

where `persisted` meant "an automatic incident snapshot exists on
disk". That is not a statement about the CFPR01 protected
containment records at all — the incident snapshot and the protected
provenance store are DIFFERENT artifacts with DIFFERENT lifetimes.
The ZIP could therefore claim `status: "available"` while carrying
NO protected records.

**The repair.** The new
`src/sdk/automatic-incident-containment-provenance.ts` reads the
REAL protected store through the production reader
(`getBackgroundJobLivenessAuthorityProvenanceSnapshot`) and joins it
against the incident's EXACT blocking job ids.

- A job with both retained records → `JOIN_COMPLETE`.
- A job with one retained record → `JOIN_INCOMPLETE`.
- A job with neither → `UNAVAILABLE_FROM_TRACE`.
- When NO blocking job has any retained record, the whole block is
  `UNAVAILABLE_FROM_TRACE` with an explicit reason.

The exported block is built from an explicit ALLOWLIST — the source
records are never serialized wholesale.

### 2.4 P0-4 — Durability

**The defect (a).** The reconciliation sink forwards observations
asynchronously into the incident manager. The join updated the
in-memory incident but never persisted it, so a reconciliation
exhaustion that was the last relevant event before an extension-host
crash left the persisted incident WITHOUT that exhaustion outcome.

**The repair (a).** The incident manager exposes a
`setAutomaticIncidentDurabilityHook` seam. The manager invokes it
after EVERY state-changing mutation, including the join. The host
installs the hook at activation.

**The defect (b).** `persistAutomaticIncident` reports failures
through `{ succeeded: false }` and NEVER rejects. The production
callers observed only the rejected promise via `.catch()`, so a
`{ succeeded: false }` result was silently ignored.

**The repair (b).** Every production caller now inspects the result
and logs the failure.

**The defect (c).** The export read the persisted artifact
unconditionally, so an OLDER persisted revision could replace a
NEWER in-memory snapshot — the export (the user-facing artifact) would
be weaker than the live snapshot.

**The repair (c).** `readPersistedAutomaticIncident` compares the
persisted revision with the in-memory revision and falls back to the
in-memory snapshot when the persisted artifact is older.

## 3. The non-blocking P1

`applyReconciliationDiagnosticCaptureProfile` considered ONLY
`isDogfood`. The advertised behaviour is that a PUBLIC user can opt in
to detailed local diagnostics, and the incident manager honours that
opt-in by raising the capture DEPTH to `detailed` — but the
reconciliation SINK was never armed, so the detailed depth produced
an incident with an EMPTY reconciliation timeline. The opt-in
contradicted the advertised behaviour.

The resolver now honours the explicit public-user opt-in as well. The
opt-in is the persisted, user-visible setting
(`clineDetailedLocalDiagnosticsEnabled`) — NOT an env override and
NOT a new matrix.

## 4. What this correction did NOT change

- No new process probe, signal, or shell inspection.
- No completion-state change, C10 predicate change, or containment
  semantics change.
- No new telemetry subsystem.
- No new dependency.
- No env-var override matrix.
- No change to the CFPR01 protected store's own semantics.

## 5. Verification

See `evidence/verification-correction01.txt` for the verbatim command
output.

| Gate                                          | Result                                  |
| --------------------------------------------- | --------------------------------------- |
| RED reproduction (all four P0 defects)        | REPRODUCED                              |
| Correction suite (`automatic-incident-correction01.aice01.test.ts`) | 26 / 26 PASS              |
| Focused + adjacent suites                     | 155 / 155 PASS across 10 suites        |
| Base typecheck (`tsc --noEmit`)               | PASS                                    |
| VS Code compatibility typecheck               | PASS                                    |
| Lint (biome, error level)                     | 0 errors                                |

## 6. Known limitations

1. **No installed-VSCodium LIVE qualification was performed as part
   of this correction.** The correction is source-level; the LIVE
   qualification remains the next operator step after the commit.
2. The uploaded AICE01 artifact was a **dirty-worktree snapshot**, so
   the predecessor's reported "final tree" identity could not be
   independently certified. This correction is bound to the committed
   `ENTRY_HEAD` above plus its own diff.

| `reconciliation_exhausted`     | `NOT_OBSERVED`              | `NOT_OBSERVED`           | `OBSERVED`                       |
| `reconciliation_cancelled`     | `NOT_OBSERVED`              | `NOT_OBSERVED`           | `OBSERVED`                       |

**The defect (c).** The per-job observation used
`additions.find(...)` — the FIRST record for the job — so a later
exhaustion / resolution record for the same job was discarded
entirely. The timeline was also appended once PER OBSERVED JOB, so a
two-job incident received every record twice.

**The repair (c).** The per-job observation aggregates EVERY record
for that job, and the timeline is appended exactly ONCE per join.

**A depth-independent coverage.** The coverage is now advanced from
the ORIGINAL boundary detail, not from the depth-restricted copy. The
detail restriction is a privacy control over what is RETAINED; the
per-job coverage is a load-bearing PUBLIC field retained at both the
minimal and the detailed depth, so its verdict must not depend on the
capture depth.
