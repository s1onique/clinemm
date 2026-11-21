# CORRECTION04 — the conflict-exclusion contract

This document states the invariant that the CORRECTION04 patch establishes and
that the `AUTH-08`, `AUTH-09` and `CLI-09` witnesses enforce.

It EXTENDS the CORRECTION03 authority contract; it does not replace it. The
CORRECTION03 invariants I1–I8 remain in force.

---

## 1. The defect

CORRECTION03 introduced the rule that two records for the same request identity
and the same stage that **disagree** cannot be resolved from the capture, so the
stage is excluded from the bundle and reported `UNAVAILABLE_FROM_TRACE`.

The implementation removed the stage with `stages.delete(stage)`, but the
exclusion was **not persisted**:

```
if (previous === undefined) {
    stages.set(stage, record);
} else if (!sameObservation(previous, record)) {
    stages.delete(stage);       // <- the stage is gone, but nothing records WHY
}
```

The stage's *absence* carried no memory of the conflict. A later record for the
same identity and stage therefore re-populated the map:

| Record | Content fingerprint | CORRECTION03 outcome | CORRECTION04 outcome |
| ------ | ------------------- | -------------------- | -------------------- |
| A      | fingerprint A       | stage accepted       | stage accepted       |
| B      | fingerprint B       | stage excluded       | stage excluded       |
| A      | fingerprint A       | **stage accepted again** | stage excluded   |

The sequence `A -> B -> A` left the stage **present** and pointing at A. A
previously disqualified observation was resurrected into usable evidence.

The existing `AUTH-06` witness covered only `A -> B`, so it could not observe the
resurrection.

> **This is the invariant CORRECTION03 violated.** It stated that conflicting
> observations must be *excluded rather than resolved by input order*, but the
> implementation resolved them by input order after all — it merely needed a
> third record to do so.

## 2. The invariant

### I9 — a conflict is PERMANENT

Once two observations of the same `(request bundle identity, stage)` disagree,
that stage is **excluded for the whole analysis**, regardless of which records
arrive afterwards.

The exclusion is keyed by the **request bundle identity** (`cohortId`,
`sessionId`, `iteration`, `preparationRequestId`, `providerAttemptId`) **plus the
stage**, so:

- a conflict in one request never disqualifies the same stage in a **different**
  request of the same session (witness `AUTH-09`), and
- a stage excluded by a conflict is never re-admitted by a record that happens
  to agree with the **first** one (witness `AUTH-08`).

The rationale is the same as CORRECTION03's I6: which of two conflicting
observations is authoritative is **not decidable from the capture**. A third
observation cannot make it decidable either — it can only re-introduce one of
the two candidates that were already disqualified.

### I10 — identical duplicates remain harmless

Two records that agree on every discriminating field are still a harmless
duplicate and are still **collapsed** (`AUTH-07` continues to pass). The
persisted exclusion is only created by a genuine **conflict**.

---

## 3. The required witnesses

The correction requires all five sequences to be observable:

| Sequence    | Required outcome | Witness                       |
| ----------- | ---------------- | ----------------------------- |
| `A -> A`    | INCLUDED         | `AUTH-08`                     |
| `A -> B`    | EXCLUDED         | `AUTH-08` (and `AUTH-06`)     |
| `A -> B -> A` | EXCLUDED       | `AUTH-08`, `CLI-09`           |
| `A -> B -> B` | EXCLUDED       | `AUTH-08`                     |
| `B -> A -> B` | EXCLUDED       | `AUTH-08`                     |

`CLI-09` drives the **real CLI as a process** over a **real directory** of
capture records, with the records written in the `A -> B -> A` order, so the file
order cannot accidentally mask the defect. It asserts that the wire stage stays
in `unavailableStages`, that `allStagesEqual` is `false`, and that the
**surviving** stages are still compared (`differingCategories` contains
`messages`) — so the pair is not vacuously empty.

---

## 4. What is explicitly NOT claimed

- The stale-read **policy** is unchanged by this correction.
- No provider semantics changed. No new inference run was performed. No capture
  instrumentation was added.
- The synthetic CLI fixtures remain **synthetic**: they establish the
  conflict-exclusion contract, **not** capture-record hash verification against a
  live capture pipeline.
- `PREFIX_MUTATION_ISOLATED` stays **closed** (a ClineMM rewrite of a historical
  tool result is real and observed).
- `STRATA_PLATEAU_CAUSE_UNPROVEN` stays **OPEN**. The MiniMax capture corpus
  and the queried Strata endpoint are **not established to be the same serving
  path**, and no joined engine/capture evidence exists.

## 5. Consequence for the live qualification

This correction was the last known blocker on the path to the installed-runtime
Strata qualification. With it closed, the qualification may proceed; it is a
**measurement**, not a change: the stale-read policy and the engine's checkpoint
placement are both left untouched by this ACT.
