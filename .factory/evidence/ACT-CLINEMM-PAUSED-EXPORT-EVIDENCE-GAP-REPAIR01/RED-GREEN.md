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
