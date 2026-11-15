# ACT-CLINEMM-PAUSED-EXPORT-EVIDENCE-GAP-REPAIR01 — CORRECTION02 VERDICT

**Baseline:** `c86ac36c7e7bd79135f0202fa3c08781a99699a9`
**Counterexample verdict:** `REPRODUCED`
**Repair verdict:** `REPAIRED` — PASS (structural, test-verified)

---

## 1. The review's single remaining finding

> **P0 — post-open cross-epoch attribution.** The correction excludes CCARD
> records captured **before** an incident opens. But it cannot exclude
> records from a subsequent epoch.
>
> **Recommended action:** `HALT_CCARD_EPOCH_UNBOUND` for exact
> incident-outcome claims. Do not reopen the other three corrections.
> One final narrowly targeted discriminator is justified:
>
> 1. Create incident A at epoch 4.
> 2. Emit a later qualifying CCARD outcome representing epoch 5, with the
>    same session/task.
> 3. Export incident A through `prepareAutomaticIncidentExport`.
> 4. Require that the epoch-5 outcome is not presented as an exact outcome
>    of incident A.
> 5. If existing records cannot establish the epoch, either classify CCARD
>    as a *task-level post-open observation* or leave the incident-specific
>    outcome `unavailable`. Preserve exact-epoch BCAPT attribution.
>
> If the counterexample cannot be reproduced through the actual selection
> path, preserve that result as `NOT_REPRODUCED` and proceed.

## 2. The discriminator was run — the counterexample REPRODUCED

The discriminator was executed against the unmodified baseline
`c86ac36c7` through the **actual selection path**
(`prepareAutomaticIncidentExport` → decompressed ZIP archive).

**Result: `REPRODUCED`.** At the baseline:

- `continuation-summary.json` carried `status: "available"`;
- its `outcome` was `"task_completion_committed"` — the **epoch-5**
  outcome;
- it was presented as the **epoch-4** incident A's outcome;
- it asserted no epoch and carried no attribution label.

The RED receipt is preserved in `RED-GREEN-CORRECTION02.md` §3 and was
captured independently (the working tree was stashed so the baseline
source was restored byte-for-byte).

## 3. The repair

The review offered two acceptable dispositions: classify CCARD as a
**task-level post-open observation**, or leave the incident-specific
outcome **`unavailable`**.

**The first option was taken.** It preserves the evidence while narrowing
only the claim, which is strictly more informative than dropping the
record:

- A joined CCARD record is now reported with
  `attribution: "task_level_observation"` and `scope: "task"`.
- Its `outcome` field is **not set** — `outcome` names the incident's
  outcome, and a CCARD record cannot establish the incident's epoch.
- The observation itself is preserved under `observedOutcome`, with its
  origin, session, task and observation timestamp. **No evidence is
  lost.**
- No epoch is asserted for a CCARD record.

**Exact-epoch BCAPT attribution is preserved.** BCAPT carries an epoch
that is compared EXACTLY against the incident's epoch, so a joined BCAPT
record keeps `attribution: "incident_exact"`, `scope: "incident"`, its
`outcome` and its `epoch`.

No new recorder and no new protocol were introduced — the review
explicitly noted that neither is needed to make the uncertainty
explicit.

## 4. What is now established, and what is not

**Established:** the export artifact no longer claims that a same-task
CCARD observation is this incident's exact outcome. The attribution
boundary is explicit and machine-readable in the artifact itself.

**Not established (and not claimed):** which epoch a given CCARD record
belongs to. A CCARD record carries no epoch, and `Date.now()` is
wall-clock time rather than a monotonic causal sequence, so this cannot
be recovered from the existing records. The repair makes the uncertainty
explicit rather than manufacturing an epoch binding.

**No live claim is made.** The installed-extension qualification was
**NOT_EXECUTED**; the review's authorization for isolated
installed-extension qualification on the corrected source HEAD is
conditional on this discriminator, which has now been run and closed,
but the qualification itself is a separate step that was not performed
here.

## 5. The other three corrections remain closed

The review stated: *"Do not reopen the other three corrections."* They
were not reopened. The only assertions touched in the CORRECTION01 suite
were the three that encoded the now-disproven "a CCARD record IS the
incident's outcome" claim, and each was updated to a STRICTER contract
(the evidence must still be present and correct, plus it must carry the
explicit attribution label).

The pre-existing registry guard (BCAPT-CMD.2.1) and the invalid Leamas
gate-summary binding remain non-blocking and were not addressed.

## 6. Gate summary

| Gate | Result |
| --- | --- |
| New discriminator | RED: 3 failed / 1 passed → GREEN: 4 passed / 4 passed |
| Incident + export suites | 108 passed / 108 (10 files) |
| Conservation sweep | 172 passed, 1 pre-existing failure (proven pre-existing) |
| TypeScript | 0 diagnostics (`tsc --noEmit` exit 0) |
| Biome lint / format | clean |
| Installed-extension qualification | `NOT_EXECUTED` |

**VERDICT: REPRODUCED → REPAIRED.** The `HALT_CCARD_EPOCH_UNBOUND` for
exact incident-outcome claims is discharged by this correction: the
export now says exactly what it knows and nothing more.
