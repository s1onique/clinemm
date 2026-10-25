# 05 — EVIDENCE REPORT

**ACT:** ACT-CLINEMM-P0-CONTAINMENT-FAILURE-C10-AUTHORITY-REPAIR01 (CFC10AR01)
**Predecessor:** ACT-CLINEMM-P0-CONTAINMENT-FAILURE-C10-AUTHORITY-REPRO01
(`HALT_P0_REPRODUCED`)
**Evidence class:** SYNTHETIC_REAL
**Verdict:** **PASS_STRUCTURAL_ONLY**

## The claim

The predecessor established, as frozen causal evidence, that the C10
completion-commit barrier consulted four conjuncts and NONE of them was the
per-job containment classification:

- `ownerStillRunningForC10` is the manager's ACTIVE-MAP CARDINALITY question,
  and `CommandJobManager.finalize()` empties the active map on BOTH the clean
  path and the containment-failure path;
- `heldObligationForC10` is the BCB's UNCONSUMED-OBSERVATION count, which
  drains when the agent OBSERVES the terminal fact;
- the Elm completion-authority kernel has NO containment axis at all.

Therefore C10 authorization depended on the DISAPPEARANCE of the observation,
not on proven containment.

**This ACT repairs that.** The classification is now ONE shared, pure,
owner-scoped predicate, consulted at every C10 admission gate and
re-validated at the actual commit boundary.

## The proof

### 1. The defect was reproduced on BOTH paths

| Path | Witness | Failing assertion (pristine production code) |
|---|---|---|
| Immediate | `CFC10A01-RED-03-B` | `AssertionError: expected 1 to be +0` |
| Deferred | `CFC10A01-RED-03-B-DEFERRED` | `AssertionError: expected 1 to be +0` |

The deferred witness exercises the ACTUAL `reevaluateDeferredCompletionBarrier()`
method and the ACTUAL production barrier registration — not a re-implementation.

### 2. The repair is ONE shared predicate

`unresolvedContainmentFailuresForOwner(jobStates, jobOwners, activeSessionId)`
is the only place in the file that compares a job state against
`containment_failed` (pinned by the M5-F source-identity assertion: exactly 1
definition, exactly 1 comparison, 5 call sites — Site A, Site B, Site C, the
R4 boundary helper, and the classifier's own definition).

The Q5 inline copy was DELETED, so the predicate cannot drift again.

### 3. The gates are closed

| Gate | Result |
|---|---|
| G0 — exact production seams and source identity verified | PASS |
| G1 — immediate and deferred unsafe-commit RED demonstrated | PASS |
| G2 — shared classifier preserves Q5 semantics | PASS |
| G3 — immediate failed-containment C10 blocked | PASS |
| G4 — deferred failed-containment C10 blocked | PASS |
| G5 — clean-terminal conservation passes | PASS |
| G6 — foreign/unknown-owner semantics pass | PASS |
| G7 — Elm HOLD/AUTHORIZE boundaries preserved | PASS |
| G8 — async admission interval tested and addressed | PASS (the interval WAS exploitable) |
| G9 — no unauthorized marker promotion or completion capture | PASS |
| G10 — relevant focused regressions pass | PASS |
| G11 — TypeScript, lint and diagram checks pass | PASS |
| G12 — exact-source evidence and artifact hashes verified | PASS |

### 4. The success criterion holds

```
containment_failed + observation_consumed + Elm_AUTHORIZE → C10_completed
```

is now IMPOSSIBLE through the tested production paths, and the
clean-terminal path CONTINUES to work.


## The R4 finding (NEW causal evidence, in the same chain)

Source reconnaissance identified a real time-of-check/time-of-use interval:
`checkElmCompletionAuthority()` AWAITS `flushElmAuthorityForSession` before
it reads the Elm decision, so a containment failure published DURING that
await was invisible to the barrier's earlier read.

The adversarial test CONFIRMED the interval was exploitable (the `completed`
phase committed over a late-published containment failure). The repair
re-reads the SAME owner-scoped classifier at the actual commit boundary on
both paths, with NO additional provider call (the M4-C witness pins exactly
one Elm consult).

## Test results

| Suite | Result |
|---|---|
| `containment-failure-c10-authority-repair01.cfc10ar01.test.ts` (NEW, ACT-owned) | **25/25 PASS** |
| `containment-failure-c10-authority01.cfc10a01.test.ts` (predecessor, retained) | **19/19 PASS** |
| `premature-handoff-containment-failure01.phcf01.test.ts` (the Q5 gate) | **10/10 PASS** |
| `c9-c10-commit-driven-authority-publication01.c9c10cdap01.test.ts` | **20/20 PASS** |
| `c9-c10-statechart-causal-repair01.c9c10scr01.test.ts` | **5/5 PASS** |
| `c9-c10-statechart-causal-repair01.c9c10scr01-cons.test.ts` | **14/14 PASS** |
| `completion-presentation-contract01.cpc01.test.ts` | **41/41 PASS** |
| `completion-authority-effect-discriminator01.cae01.test.ts` | **3/3 PASS** |
| `post-run-completion-authority-reevaluation01.pcra01.test.ts` | **5/5 PASS** |

Total focused: **142/142 PASS**.

Static checks:

| Check | Result |
|---|---|
| `bunx tsc --noEmit -p tsconfig.json` | PASS (exit 0) |
| `biome lint` on the 3 changed/added TS files | PASS (0 diagnostics) |
| `bun scripts/verify-lifecycle-transition-contract.ts` | PASS (3/3 sub-checks) |
| `bun scripts/verify-markdown-mermaid-blocks.ts` (all 4 charts) | PASS (4/4) |
| `bun scripts/verify-chart04-mermaid-parse.ts` (charts 01/02/04) | PASS (real Mermaid parser) |

## Baseline discipline

The full `apps/vscode` vitest suite was run twice with the IDENTICAL
command — once against the pristine coordinator, once against the repaired
one:

| | failing `FAIL` lines |
|---|---|
| PRISTINE ENTRY_HEAD | 278 |
| WITH THE REPAIR | 257 |
| **NEW failures introduced by the repair** | **0** |

The 8 suites the ACT named as pre-existing (`bcb01`, `bcb01-c`, `bcb01-c2`,
`bcb01-c3`, `bcb01-c4`, `pcca01`, and the two `bnca-framework01` files) have
**byte-identical failure counts** before and after the repair (31 total).
They were NOT load-bearing for any conservation claim, so no harness-only
correction was made — per the ACT's instruction, their exact named failures
remain classified as pre-existing and are NOT disguised as a clean baseline.
See `03-baseline-classification.md`.

## Documentation consistency (R7)

- Chart 02's A-02 predicate row now carries the fifth conjunct, the
  conjunct table carries `unresolvedContainmentFailuresForC10`, and a new
  paragraph states the observation-accounting / process-containment
  distinction explicitly.
- The transition ledger's `T-02` and `A-04` rows now require "no unresolved
  containment failure at the commit boundary", and a NEW `A-04b` row records
  the "Elm authorized + unresolved containment failure → C10 withheld"
  transition.
- No new diagram infrastructure was created; the existing validators pass.

## Evidence limits

- **NO live capture.** The defect was reproduced and repaired against the
  REAL production manager / BCB / coordinator / status-tool seams with the
  manager's documented `terminalPostconditionProbe` test seam injected. No
  live process-group containment failure was captured from an installed
  extension, and none is claimed.
- The original live incident (`1792850126157_b9u7x` / epoch 6 /
  `cmd_mvmh3u69j62aclho`) remains separately classified
  **CAPTURE_INSUFFICIENT**, exactly as the predecessor recorded it. THIS
  ACT DOES NOT RE-ADJUDICATE THAT INCIDENT and does not claim the repair
  resolves it.
- No descendant-safety claim is made beyond the existing owned-primary-PGID
  contract.
