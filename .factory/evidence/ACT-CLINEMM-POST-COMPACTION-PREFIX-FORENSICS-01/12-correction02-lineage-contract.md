# ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION02 — Lineage Contract Evidence

---

## 1. The runtime's identity model — the authority for the pairing rule

Quoted from `sdk/packages/agents/src/agent-runtime.ts:930-949` (the field
`activePreparationRequestId`):

> *It is set when a prepared request enters `streamPreparedRequest`, so it is
> ALWAYS the identity of the request the provider is about to see. A provider
> RETRY re-enters `streamPreparedRequest` with the SAME prepared request, so the
> preparation id is UNCHANGED across retries while the provider attempt id
> (`this.modelRequestId`) is re-minted. That is the distinction the measurement
> needs: a retry is a new ATTEMPT against the same PREPARED REQUEST, never a new
> compaction decision.*

The minting sites confirm it:

| Site | Line | Effect |
|---|---|---|
| `prepareModelRequest()` | `:2801` `const modelRequestId = createUID("req")` | ONE id per PREPARED REQUEST |
| `streamPreparedRequest()` | `:3011` `this.modelRequestId = createUID("model_request", 21)` | ONE id per PROVIDER ATTEMPT, re-minted on retry |

The corpus evidence agrees independently:
`.factory/evidence/ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01/boundary-map.md:26`
— *"one preparationRequestId -> one prepared request"* — and
`agent-runtime.token-evidence-capture01.test.ts:576` —
`expect(first.preparationRequestId).not.toBe(second.preparationRequestId)`.

**Therefore the CORRECTION01 rule was inverted**: requiring the SAME preparation
identity accepted the RETRY case and rejected the CONSECUTIVE-TURN case.

---

## 2. The corrected pairing contract

| Relation | Condition | Consecutive? |
|---|---|---|
| **within-request** | same session + same iteration + same preparation; differs only by `source` | no — AGGREGATED into one bundle |
| **retry** | same session + same iteration + same preparation + DIFFERENT attempt | no — a retry is never a turn |
| **consecutive turn** | same session + **EXACTLY adjacent** iterations + DISTINCT preparation and attempt | **YES** |

Every required identity is mandatory. When the session id, the iteration, the
preparation identity or the attempt identity is absent, the pair is
`NOT_AUTHORITATIVE` with an explicit reason. **A timestamp is never substituted.**

The negative controls are what make the contract meaningful:

| Control | Why it must be refused |
|---|---|
| a RETRY | it is a second transport attempt of ONE prepared request; treating it as the next turn would compare a request with itself |
| a NON-ADJACENT iteration gap | the missing turn is unobserved; bridging it would compare non-adjacent requests and silently skip a mutation |
| a CROSS-SESSION pair | two different conversations; their fingerprints are not comparable evidence |
| a MISSING stage | the boundary was not observed; it must be reported unavailable, never as "equal" |

---

## 3. The request bundle

The CORRECTION01 CLI compared ONE capture record per side, so it could only ever
compare two observations of the SAME stage. It could not express "the request as a
whole changed at stage X" — which is the comparison the next experiment needs.

A **bundle** is now the unit of comparison:

- the grouping key is the WITHIN-REQUEST identity (cohort, session, iteration,
  preparation, attempt);
- the **stage is the key INSIDE the bundle**, never part of the grouping key — that
  is what keeps the A/B/C stages of one request together even when their file order
  interleaves them with another request's stages;
- `comparePrefixForensicsBundles()` compares the bundles stage-by-stage, so ONE
  comparison covers all three boundaries.

---

## 4. The production side

Stage B and stage C now carry `preparationRequestId`, read from the request metadata
under the established `MODEL_BEHAVIOR_WIRE_REASONING_REQUEST_ID_METADATA_KEY` — the
id the runtime already mints once per prepared request and already carries in that
bag.

| Property | Value |
|---|---|
| New metadata key | **NONE** — an existing key is read |
| New transport field | **NONE** |
| New protocol field | **NONE** |
| New provider request | **NONE** |
| Default-OFF behaviour | **UNCHANGED** |

Witness: `PF-WIRE-06: the wire stage carries the PREPARATION identity, so it groups
with the other stages`.

---

## 5. Executable evidence

### RED — against the CORRECTION01 implementation

```
 ❯ src/runtime/prefix-forensics-analyzer-cli.test.ts (6 tests | 3 failed)
     × CLI-01: two complete three-stage requests produce an authoritative B->C comparison
     × CLI-02: a third append-only continuation produces an authoritative C->D comparison
     ✓ CLI-03: a RETRY of the same preparation is NOT a consecutive turn
     ✓ CLI-04: a NON-ADJACENT iteration gap is refused
     ✓ CLI-05: a CROSS-SESSION pair is refused
     × CLI-06: a bundle with a MISSING stage is reported incomplete, never as equal

 Test Files  1 failed (1)
      Tests  3 failed | 3 passed (6)
```

The CLI produced **0 pairs** for two complete three-stage requests. The three
negative controls passed only VACUOUSLY (no pairs existed to refuse).

### GREEN — against the corrected implementation

```
 ✓ src/runtime/prefix-forensics-analyzer-cli.test.ts (6 tests) 93ms
 ✓ src/runtime/prefix-forensics-analyzer.test.ts (20 tests) 7ms
 ✓ src/providers/provider-request-capture.prefix-forensics-wire.test.ts (6 tests) 7ms

 Test Files  12 passed (12)
      Tests  145 passed | 1 skipped (146)
```

---

## 6. Conservation

| Package | pristine HEAD | with the correction | delta |
|---|---:|---:|---|
| shared | 593 passed / 0 failed | **599 passed / 0 failed** | **+6 new passing** |
| llms | 1167 passed / 19 failed | **1168 passed / 19 failed** | **+1 new passing**, failures identical |
| agents | 560 passed / 43 failed | 560 passed / 43 failed | none |

| Gate | Result |
|---|---|
| Typecheck (shared, llms, agents) | **EXIT 0** |
| Biome lint | **EXIT 0** — 5 infos, the same `noNonNullAssertion` convention as the pre-existing sibling suites |
| Provider semantic delta | **NONE** |
| New provider requests / inference runs | **NONE** |

---

## 7. What remains open

- `PREFIX_MUTATION_ISOLATED` — **CLOSED** (unchanged).
- `STRATA_PLATEAU_CAUSE_UNPROVEN` — **OPEN**. The corrected lineage contract makes
  the successor experiment possible; it does not answer it.
- The stale-read policy — **NOT TOUCHED**. The repair question remains a product
  policy decision, exactly as the original ACT held.

The successor experiment is unchanged: correlate ONE rewrite with the next two or
three Strata cache decisions, distinguishing the cost of the initial prefix
invalidation, how quickly the new prefix becomes cacheable, and whether checkpoint
retention prevents recovery.
