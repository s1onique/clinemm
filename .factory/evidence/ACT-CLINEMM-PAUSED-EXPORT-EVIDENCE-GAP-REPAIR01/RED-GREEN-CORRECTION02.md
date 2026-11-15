# ACT-CLINEMM-PAUSED-EXPORT-EVIDENCE-GAP-REPAIR01 — CORRECTION02

## RED → GREEN: the post-open cross-epoch CCARD attribution discriminator

**Baseline (parent):** `c86ac36c7e7bd79135f0202fa3c08781a99699a9`
**Counterexample verdict:** `REPRODUCED`
**New suite:** `apps/vscode/src/sdk/__tests__/automatic-incident-export-cross-epoch-ccard01.cecc01.test.ts`

---

## 1. The finding under test

The CORRECTION01 export join accepts a CCARD continuation record when its
`sessionId` + `taskId` match the incident's owner scope, its stage is an
AUTHORITATIVE outcome stage, it was captured at or after the incident's
`openedAt`, and it has the highest `seq` among the qualifying records.

A CCARD record carries **no epoch**. An incident carries an **explicit
epoch** (`identity.epoch`), and the incident's causal identity key is
`(sessionId, taskId, epoch, barrierId)`.

The temporal lower bound (`record.at >= openedAt`) excludes records
captured BEFORE the incident opened. It does **not** exclude a record
captured AFTER the incident opened in a LATER epoch of the same task:

| t0 | Incident A opens, epoch 4 |
| -- | ------------------------- |
| t1 | Task advances to epoch 5 |
| t2 | CCARD records `task_completion_committed` in epoch 5, same session/task |
| t3 | Incident A is exported; the join can assign the epoch-5 outcome to epoch 4 |

`Date.now()` is wall-clock time, not a monotonic causal sequence, so a
timestamp comparison cannot independently establish event ownership.

## 2. Why the export selection path reaches this state

Two independent facts combine:

1. **The CCARD join has no epoch predicate.** `joinContinuation` compares
   `sessionId`/`taskId`, the stage, `record.at >= openedAt`, and `seq`. The
   CCARD record type has no `epoch` field at all
   (`ContinuationCardinalityAuthorityRecord`).
2. **The task-based lookup does not displace the earlier incident.**
   `getAutomaticIncidentForTask` filters the retained incidents by
   `identity.taskId` and returns the **most recent** one
   (`matches[matches.length - 1]`). A later epoch does not remove the
   epoch-4 incident, so the export keeps naming the epoch-4 incident.

`resolveAutomaticIncidentForExport` therefore resolves incident A, and
`joinAutomaticIncidentExportSources(incident)` then joins the epoch-5
CCARD record to it.

## 3. RED — captured against the unmodified baseline

The discriminator was run against the baseline with the production change
removed (git stash of the working tree; the baseline source was restored
byte-for-byte from HEAD `c86ac36c7`).

```
 RUN  v4.1.10 /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/apps/vscode

 × ... > CECC01-1 - the epoch-5 outcome is NOT presented as the epoch-4 incident's exact outcome 20ms
   → expected 'task_completion_committed' to be undefined
 × ... > CECC01-2 - the pre-fix HEAD misattribution is REPRODUCED (RED witness, now inverted) 9ms
   → expected 'task_completion_committed' to be undefined
 × ... > CECC01-3 - the BCAPT exact-epoch attribution is PRESERVED 9ms
   → expected undefined to be 'incident_exact' // Object.is equality
 ✓ ... > CECC01-4 - a BCAPT record from a DIFFERENT epoch never joins 7ms

 Test Files  1 failed (1)
      Tests  3 failed | 1 passed (4)
```

The decisive failure:

```
 FAIL  ... > CECC01-1 - the epoch-5 outcome is NOT presented as the epoch-4 incident's exact outcome
AssertionError: expected 'task_completion_committed' to be undefined

- Expected:
undefined

+ Received:
"task_completion_committed"

 ❯ .../automatic-incident-export-cross-epoch-ccard01.cecc01.test.ts:252:32
    252|     expect(continuation.outcome).toBeUndefined()
```

**This is the reviewer's counterexample, reproduced through the ACTUAL
selection path** (`prepareAutomaticIncidentExport` → decompressed ZIP
archive), not through a synthetic call into the join helper. The verdict is
`REPRODUCED`, not `NOT_REPRODUCED`.

`CECC01-4` passing at RED is the expected control: the BCAPT exact-epoch
predicate was already correct and is not what the finding targets.

## 4. The repair

No new recorder, no protocol, no public API. The join's OUTPUT shape now
states its attribution boundary.

### 4.1 CCARD is demoted to a task-level post-open observation

A joined CCARD record is now reported as:

```json
{
  "status": "available",
  "attribution": "task_level_observation",
  "scope": "task",
  "observedOutcome": "task_completion_committed",
  "origin": "background_terminal",
  "sessionId": "...",
  "taskId": "...",
  "observedAt": 1793900000000
}
```

The `outcome` field is **not set**. `outcome` names the INCIDENT's
outcome, and a CCARD record cannot establish the incident's epoch. The
observation itself is preserved under `observedOutcome`, so no evidence is
lost — only the claim is narrowed. No epoch is asserted.

### 4.2 BCAPT exact-epoch attribution is PRESERVED

A joined BCAPT record still carries an epoch that was compared EXACTLY
against the incident's epoch, so it remains incident-exact:

```json
{
  "status": "available",
  "attribution": "incident_exact",
  "scope": "incident",
  "outcome": "session-event-bcb-blocked-observation-unavailable",
  "epoch": 4,
  "..."
}
```

### 4.3 The attribution vocabulary

| `attribution` | `scope` | Meaning | Source |
| --- | --- | --- | --- |
| `incident_exact` | `incident` | Bound to THIS incident by exact epoch identity | BCAPT |
| `task_level_observation` | `task` | A post-open observation of the same task; cannot be bound to the incident's epoch | CCARD |

`AutomaticIncidentExportContinuationAttribution` and
`AutomaticIncidentExportContinuationScope` are the two new exported
types in `automatic-incident-export-sources.ts`.


## 5. GREEN — after the repair

```
 RUN  v4.1.10 /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/apps/vscode

 ✓ ... > CECC01-1 - the epoch-5 outcome is NOT presented as the epoch-4 incident's exact outcome 18ms
 ✓ ... > CECC01-2 - the pre-fix HEAD misattribution is REPRODUCED (RED witness, now inverted) 7ms
 ✓ ... > CECC01-3 - the BCAPT exact-epoch attribution is PRESERVED 8ms
 ✓ ... > CECC01-4 - a BCAPT record from a DIFFERENT epoch never joins 7ms

 Test Files  1 passed (1)
      Tests  4 passed (4)
```

## 6. Regression sweep

### 6.1 The automatic-incident export / incident suites

```
bunx vitest run src/sdk/__tests__/automatic-incident-export \
  src/sdk/__tests__/automatic-incident-persistence01.aice01.test.ts \
  src/sdk/__tests__/automatic-incident \
  src/sdk/__tests__/completion-incident-bundle

 Test Files  10 passed (10)
      Tests  108 passed (108)
```

### 6.2 The conservation sweep

```
bunx vitest run src/sdk/__tests__/reconciliation src/sdk/__tests__/containment \
  src/sdk/__tests__/phase-authority src/sdk/__tests__/bcb-observation \
  src/sdk/__tests__/continuation-cardinality

 Test Files  1 failed | 9 passed (10)
      Tests  1 failed | 172 passed (173)
```

The single failure is the **pre-existing BCAPT-CMD.2.1 registry
source-text guard** (`bcb-observation-unavailable-capture.bcapt01.test.ts`
line 692, the `prefix + ".debug.…"` regex). It was proven PRE-EXISTING by
running the same file with this working tree stashed (baseline restored):
the same 1 failure / 25 passed result was observed. It is non-blocking and
unrelated to the export join.

### 6.3 Three pre-existing assertions updated (not weakened)

The CORRECTION01 suite asserted the now-disproven claim that a CCARD
record IS the incident's outcome. Those assertions encoded exactly the
claim this review halts, so they were updated to the stricter contract —
the observation is still REQUIRED to be present and correct, but it is no
longer allowed to occupy the incident's `outcome` field.

| Test | Before | After |
| --- | --- | --- |
| `R2a` | `outcome === "task_completion_committed"` | `outcome` undefined; `observedOutcome === "task_completion_committed"`; `attribution === "task_level_observation"`; `scope === "task"` |
| `C-2c` | `outcome === "task_completion_committed"` | `outcome` undefined; `observedOutcome === "task_completion_committed"`; `attribution === "task_level_observation"` |
| `C-2d` | `outcome === "task_completion_committed"` | `outcome` undefined; `observedOutcome === "task_completion_committed"` (latest-wins ordering still enforced) |

Each updated assertion is STRICTER than before: the evidence must still
be present and correct, and it must additionally carry the explicit
attribution label.

## 7. Static gates

| Gate | Command | Result |
| --- | --- | --- |
| TypeScript | `bunx tsc --noEmit` | exit 0, 0 diagnostics |
| Biome lint | `biome lint … --diagnostic-level=error` | exit 0, clean (3 files) |
| Biome format | `biome format … --semicolons=as-needed` | clean (3 files) |

## 8. Scope

**Touched:**
- `apps/vscode/src/sdk/automatic-incident-export-sources.ts` — the join's
  attribution boundary and the summary's shape.
- `apps/vscode/src/sdk/__tests__/automatic-incident-export-gap01.aice01.test.ts`
  — 3 assertions updated to the stricter contract.
- `apps/vscode/src/sdk/__tests__/automatic-incident-export-cross-epoch-ccard01.cecc01.test.ts`
  — the new discriminator.

**NOT touched:** no signal, no termination/cleanup policy, no
reconciliation horizon, no process-group ownership, no C10 blocking
logic, no completion suppression, no public API/proto, no MCP registry, no
recorder, no new protocol. The operator's live VSCodium instance was not
changed, restarted or signalled. No push, no VSIX deployment, no release,
no install.

**Installed-extension qualification:** `NOT_EXECUTED`. The review's
authorization for isolated installed-extension qualification was
conditional on this single discriminator; the discriminator has been run
and the finding is closed, but the installed qualification itself has NOT
been executed here and no live claim is made.
