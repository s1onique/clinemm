# ACT-CLINEMM-PAUSED-EXPORT-EVIDENCE-GAP-REPAIR01 — RED -> GREEN

## 1. The suite

`apps/vscode/src/sdk/__tests__/automatic-incident-export-gap01.aice01.test.ts`
— 14 tests.

Every test that inspects the archive goes through the **REAL** export
path:

```
prepareAutomaticIncidentExport()      <- the ONE production export call
  -> writeAutomaticIncidentZip()       <- the real ZIP writer
  -> execFileSync("unzip", ...)        <- DECOMPRESS
  -> read the member files             <- what a support engineer receives
```

**NO** test calls `buildAutomaticIncidentExportBundle` with pre-filled
synthetic arguments. The two `buildAutomaticIncidentExportBundle`
synthetic-argument suites that already existed
(`automatic-incident-export01.aice01.test.ts`) were NOT modified.

## 2. RED — the reproduction

Command:

```bash
cd apps/vscode && bun x vitest run --config vitest.config.ts \
  src/sdk/__tests__/automatic-incident-export-gap01.aice01.test.ts
```

**EXIT CODE: 1** — `Tests  6 failed | 8 passed (14)`

| Test | RED failure | What it proves at ENTRY_HEAD |
|---|---|---|
| **R1a** | `expected [ ] to have a length greater than 0` | the host ring held a real, owner-matched phase-writer record; the ZIP's `phase-writers.jsonl` was still EMPTY |
| **R1b** | `expected 'unavailable' to be 'available'` (manifest source status) | the manifest reported the phase-writer member as unavailable even though the record was joined — the source metadata was not truthful |
| **R2a** | `expected 'unavailable' not to be 'unavailable'` | the host held a real, owner-matched CCARD continuation record; the ZIP's `continuation-summary.json` was still the constant |
| **R3a** | `expected undefined to be truthy` (`availabilityReason`) | an empty reconciliation timeline carried NO reason, so a disarmed sink was indistinguishable from an armed sink with no matching records |
| **R3b** | `expected undefined to be truthy` (`availabilityReason`) | (same defect, armed case) |
| **R5b** | `expected 'available' to be 'unavailable'` | the manifest reported `continuation-summary.json` as **`available`** while the file carried NO evidence — an untruthful manifest discovered by the suite |

The 8 tests that PASSED at RED are the NEGATIVE controls. They were
already correct at ENTRY_HEAD and had to STAY correct:

| Test | Negative control |
|---|---|
| R1c | no phase-writer records -> the member stays explicitly unavailable (no invention) |
| R2b | a foreign owner's continuation outcome stays explicitly unavailable (no cross-owner leak) |
| R2c | no continuation authority -> the summary stays explicitly unavailable |
| R4a | a phase writer for another task/epoch is never exported |
| R4b | a foreign owner's continuation outcome never leaks |
| R4c | the manifest counts, hashes and sizes stay correct |
| R4d | the privacy sentinels never reach the archive |
| R5a | no new public API / protocol / MCP operation in the export path |

## 3. The repair (C3)

See `RECON.md` §3. Summary:

1. **NEW** `apps/vscode/src/sdk/automatic-incident-export-sources.ts` —
   the owner-scoped source join over the EXISTING host rings.
2. **CHANGED** `apps/vscode/src/sdk/automatic-incident-export-runtime.ts`
   — the one production export call site now passes the joined sources
   and the explicit availability map.
3. **CHANGED** `apps/vscode/src/sdk/automatic-incident-export.ts` —
   `buildAutomaticIncidentExportBundle` accepts the explicit
   `sourceAvailability`; the manifest's `sources` block uses it instead
   of guessing from the member's byte length.

No signal, termination/cleanup policy, reconciliation horizon, process
group ownership, C10 blocking logic, completion suppression, public
API/proto or MCP registry was touched. The live VSCodium instance was
not changed, restarted or signalled.

## 4. GREEN

Same command, same suite:

**EXIT CODE: 0** — `Tests  14 passed (14)`

## 5. What the GREEN proves and what it does NOT prove

**Proves (verified by execution):**

- A real, available, owner-matched phase-writer record now reaches the
  ZIP's `phase-writers.jsonl` through the REAL export path, and the
  manifest's source metadata is truthful about it.
- A real, authoritative owner-matched continuation outcome now reaches
  the ZIP's `continuation-summary.json`; an unrelated or absent
  authority stays explicitly unavailable.
- The reconciliation timeline differentiates `not_armed` from
  `no_matching_records`, with an explicit `availabilityReason`.
- A foreign owner or a stale phase writer cannot leak; manifest counts,
  source availability, hashes and sizes stay correct.
- The default-off posture has zero state-semantic delta and no new
  public API / protocol / MCP operation.

**Does NOT prove:**

- Nothing about the HISTORICAL incident. The past incident remains
  **HISTORICAL_RECONCILIATION_UNOBSERVED**. The historical installed
  artifact remains **HISTORICAL_RUNTIME_SOURCE_UNBOUND**.
- No installed qualification was executed (see `GATES.md`): the repair
  is verified by tests and structural probes, NOT by a deployed VSIX.
- The repair does NOT make the diagnostic sinks armed by default. A
  public user still needs the existing sanctioned opt-in / dogfood
  arming to obtain a fuller future incident; without it the members
  remain explicitly unavailable, which is the CORRECT outcome.

---

# CORRECTION01 — the review's bounded correction

**Trigger:** the Factory review returned `HALT_EXPORT_EVIDENCE_MISATTRIBUTION`
against commit `cee2f28d3` with three P0 evidence-correctness issues and
one P1 test issue. `cee2f28d3` is preserved as the repaired-export baseline.

## C1. The RED reproduction (before the correction)

```bash
cd apps/vscode && bun x vitest run --config vitest.config.ts \
  src/sdk/__tests__/automatic-incident-export-gap01.aice01.test.ts
```

**EXIT 1 — `Tests  6 failed | 17 passed (23)`**

| Test | RED failure | Defect |
|---|---|---|
| **C-1a** | `expected [ { …(2) } ] to have a length of +0 but got 1` | a record with the MATCHING taskId but NO epoch JOINED the incident |
| **C-2a** | `expected 'unavailable' not to be 'unavailable'` | a CCARD record captured BEFORE the incident opened became the outcome |
| **C-2b** | `expected 'unavailable' not to be 'unavailable'` | a NON-AUTHORITATIVE (`run_turn_started`) stage became the outcome |
| **C-3a** | `expected 'not_armed' not to be 'not_armed'` | the EXPORT-time arming was reported as the INCIDENT-time reason |
| **C-3b** | `expected 'unknown' to be 'unknown'` | the export-time arming was not reported separately |
| **C-4a** | `sentinel commandText leaked into phase-writers.jsonl` | **a REAL privacy leak**: the value in an allowlisted key was never validated |

C-4a is notable: the original R4d privacy test was VACUOUS — it declared
sentinels but never injected them. Fixing the fixture exposed a REAL leak
that the empty fixture had hidden. The leak was in the VALUE, not the KEY:
the export's privacy gate is a key allowlist, and it assumed the value of
an allowlisted key (`commitOrigin`) was a bounded enum member. It was not.

## C2. The correction

### P0-1 — phase writers cross epoch boundaries

**Before:** `if (record.epoch !== undefined && record.epoch !== epoch) continue`
— a record with NO epoch joined a specific-epoch incident.

**After:** `if (record.epoch !== epoch) continue` — EXACT match. A record
with no epoch and a record with a different epoch are BOTH unattributable
and BOTH dropped.

### P0-2 — stale / misclassified continuation outcomes

**Before:** the FIRST CCARD record matching `sessionId + taskId` won.

**After:** a record must satisfy ALL of:

1. the incident's session AND task;
2. the incident's EPOCH, when the record carries one (BCAPT always does;
   CCARD never does);
3. the incident's temporal LOWER BOUND — the record must not have been
   captured BEFORE the incident opened (a record from an earlier epoch of
   the same task is dropped);
4. for CCARD, an AUTHORITATIVE outcome stage
   (`agent_turn_done` / `submit_and_exit_seen` /
   `task_completion_committed`); and
5. the LATEST qualifying record is selected — ordered by the ring's
   MONOTONIC `seq` (CCARD) or the ring position (BCAPT), so a tie inside
   one millisecond is still resolved deterministically.

There is deliberately NO upper bound: a continuation outcome is a
CONSEQUENCE of the hold, so it legitimately occurs AFTER the incident
opened.

### The additional issue — export-time is not incident-time

**Before:** `classifyReconciliation` read the sink's arming state AT
EXPORT TIME and reported `not_armed` / `no_matching_records` as if it
described the incident. The sink may have changed state between the
incident and the export.

**After:** the INCIDENT-TIME availability is `unknown` unless records
were ACTUALLY joined to the incident. The EXPORT-TIME arming is reported
SEPARATELY in a new, explicitly labeled `exportTimeArming` field
(`armed` / `disarmed`) and is NEVER used to explain the absence of
historical evidence.

### P1 — the vacuous privacy test, and the real leak it exposed

**Before:** R4d declared three sentinels and searched the archive for
them, but never injected them into the source records — so the assertion
passed without exercising anything.

**After:** C-4a GENUINELY injects the sentinels into the source records
(the phase slot and the CCARD `correlationId`), ASSERTS that they are
present in the source records, and then asserts that they are absent
from every archive member. That is a non-vacuous exclusion claim.

The REAL leak the fixed fixture exposed is closed by validating the
phase VALUE against the closed `TurnPhase` set (`exportSafePhase`) before
export. A value outside the set is DROPPED. No new privacy mechanism was
added; the existing allowlist's assumed invariant is now enforced.

## C3. The GREEN (after the correction)

**EXIT 0 — `Tests  24 passed (24)`** (14 original + 10 correction tests).

## C4. Conservation

| Suite | Exit | Result |
|---|---|---|
| the new suite (24 tests) | **0** | `24 passed (24)` |
| the existing `automatic-incident-*` aice01 suites | **0** | `60 passed (60)` |
| the reconciliation / containment / phase-authority sweep | **1** | `1 failed / 67 passed (68)` — the SAME pre-existing `BCAPT-CMD.2.1` registry source-text guard, already proven pre-existing at the clean entry head |
| `tsc --noEmit` | **0** | 0 diagnostics |
| Biome lint / format | **0** / **0** | clean |

**No intentionally failing test is in the default suite.**
