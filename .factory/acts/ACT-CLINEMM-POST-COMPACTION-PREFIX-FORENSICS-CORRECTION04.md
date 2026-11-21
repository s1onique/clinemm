# ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION04

**Type:** bounded correction of the single **evidence-authority** defect raised by
the `ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION03` review.
**Scope:** exactly the P0 named by that review. No new architectural
investigation, no stale-read-policy change, no new inference run, no push, no VSIX
replacement, no Strata restart.

---

## 0. The verdict this correction adopts

`HALT_DUPLICATE_CONFLICT_RESURRECTION` for live forensic qualification — closed
by this ACT.

The review's central claim is **CONFIRMED by execution** and is corrected here.

CORRECTION03 is **RETAINED**: the mandatory-identity lineage gate, the
within-request / consecutive-turn / retry distinction, the three-stage bundle
aggregation, the bundle comparator's own authority validation, the CLI's
four-category report and the non-vacuous negative controls are correct and are
not touched by this correction.

---

## 1. The defect this correction closes

### 1.1 P0 — a conflicting stage could be TRUSTED again

`groupCapturesIntoRequestBundles()` excluded a conflicting duplicate with:

```ts
if (previous === undefined) {
    stages.set(stage, record);
} else if (!sameObservation(previous, record)) {
    stages.delete(stage);
}
```

The exclusion was **not persisted**. The stage's *absence* carried no memory of
the conflict, so a later record for the same identity and stage re-populated the
map:

| Record | Content fingerprint | CORRECTION03 outcome | CORRECTION04 outcome |
| ------ | ------------------- | -------------------- | -------------------- |
| A      | fingerprint A       | stage accepted       | stage accepted       |
| B      | fingerprint B       | stage excluded       | stage excluded       |
| A      | fingerprint A       | **stage accepted again** | stage excluded   |

The sequence `A -> B -> A` left the stage **present** and pointing at A: a
previously disqualified wire observation was **promoted back to usable
evidence**.

This contradicts CORRECTION03's own declared invariant that conflicting
observations must be *excluded rather than resolved by input order*. The
implementation resolved them by input order after all — it merely needed a third
record to do so. The existing `AUTH-06` witness covered only `A -> B`, so it
could not observe the resurrection.

**Correction.** The conflict exclusion is now **persisted**, keyed by the
**request bundle identity plus the stage**. Once two observations of one
`(identity, stage)` disagree, that stage is excluded for the **whole analysis**,
whatever records follow. A conflict in one request never disqualifies the same
stage in a different request of the same session. Identical duplicates are still
**collapsed**.

---

## 2. The reopen condition

> *Prove the result against the real grouping function and through the existing
> CLI. No new instrumentation, architecture or general review is needed.*

| Witness | Control | Result |
|---|---|---|
| AUTH-08 | `A -> A` | **INCLUDED** (identical duplicate collapsed) |
| AUTH-08 | `A -> B` | **EXCLUDED** |
| AUTH-08 | `A -> B -> A` | **EXCLUDED** (the resurrection) |
| AUTH-08 | `A -> B -> B` | **EXCLUDED** |
| AUTH-08 | `B -> A -> B` | **EXCLUDED** |
| AUTH-09 | a conflict in one request | does NOT disqualify the same stage in another request |
| CLI-09 | the same resurrection, through the **real CLI process** | **EXCLUDED**, stage reported unavailable |

### 2.1 RED — the witnesses fail against the CORRECTION03 implementation

The analyzer was reverted to its `3b1d8bb72` content while keeping the new
witnesses:

```
× CLI-09: a CONFLICT is PERMANENT — a later duplicate never resurrects the stage
× AUTH-08: a CONFLICT is PERMANENT — a later identical record never resurrects the stage

Tests  2 failed | 36 passed (38)
```

Both required seams fail: the real grouping function (`AUTH-08`) and the real
CLI process (`CLI-09`).

### 2.2 GREEN

```
Tests  38 passed (38)
```

---

## 3. Conservation

| Gate | Result |
|---|---|
| Analyzer + CLI suite (38 tests) | **PASS** — and **2 FAIL** against the CORRECTION03 implementation |
| shared package sweep | **611 passed / 6 skipped**, 0 failed (was 608: **+3**) |
| llms package sweep | 17 failed / 1170 passed — **identical at pristine HEAD** |
| agents package sweep | 43 failed / 560 passed — **identical at pristine HEAD** |
| Typecheck (shared) | **EXIT 0** |
| Build (`bun run build:sdk`: shared, llms, agents, core, sdk) | **EXIT 0** — bundle **and** declaration emit |
| Biome lint (the three touched files) | **EXIT 0** (3 infos, no errors) |
| Provider semantic delta | **NONE** — no provider request, no retry/compaction behaviour change, no prompt change |
| New inference run | **NONE** |

The llms and agents failures are **pre-existing** and were each measured at
pristine HEAD `3b1d8bb72` in the same session, by stashing **only** the three
touched files and re-running the same commands:

- llms — `src/providers/ai-sdk-reasoning.test.ts` (15) and
  `src/providers/vendors/openai-compatible.wire.test.ts` (2): reasoning-effort
  mapping, unrelated to prefix forensics.
- agents — 9 files covering abort-cause retention, edit-efficiency trace, hub
  trace cardinality and MiniMax reasoning traces: unrelated to prefix forensics.

The change is confined to `@cline/shared`; `groupCapturesIntoRequestBundles()` and
`comparePrefixForensicsBundles()` have **no other in-repo consumer** beyond the
shared package's own index export.

---

## 4. What is NOT changed

- The CORRECTION03 lineage model, the three-stage bundle aggregation, the
  bundle comparator's own authority validation, the CLI's four-category report
  and the non-vacuous negative controls are **RETAINED** as delivered.
- The wire-capture and completeness repairs of CORRECTION01 are **RETAINED**.
- The causal separation is **RETAINED**: `PREFIX_MUTATION_ISOLATED` stays
  **closed**; `STRATA_PLATEAU_CAUSE_UNPROVEN` stays **OPEN**.
- The stale-read policy is **not** touched.
- The synthetic CLI fixtures remain **synthetic**: they establish the
  conflict-exclusion contract, **not** capture-record hash verification against a
  live capture pipeline.
- No push, no VSIX replacement, no inference-service restart, no provider request.

---

## 5. What the next step now is

The last known blocker on the path to the installed-runtime Strata qualification
is closed. The instrumentation is fit for live forensic qualification.

The successor experiment is the one already recorded: correlate ONE rewrite with
the next two or three Strata cache decisions, distinguishing

1. the cost of the initial prefix invalidation,
2. how quickly the rewritten prefix becomes cacheable, and
3. whether checkpoint retention prevents recovery.

Strata's own documentation distinguishes checkpoint PLACEMENT from exact-prefix
MATCHING: `--prompt-cache-spread` changes which checkpoints SURVIVE rather than
restoring compatibility between different token sequences. That is why the
three-request comparison — rewrite, next request, next continuation — is decisive,
and why the corrected CLI must be able to produce exactly that comparison. It now
does, with a permanent conflict exclusion that cannot be defeated by record
order.

**Live qualification is authorized.** The capture must preserve source/build
identity and independently verify the join key; the stale-read policy and the
engine's checkpoint placement are both left untouched by this ACT — the
qualification is a **measurement**, not a change.

