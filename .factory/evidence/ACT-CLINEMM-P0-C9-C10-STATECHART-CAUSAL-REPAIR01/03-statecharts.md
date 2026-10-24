# Phase 1 — Source-bound statecharts

## Location

```
docs/architecture/task-lifecycle/
  README.md                                  the model + the invariant
  01-task-turn-phase.md                      chart 1
  02-c9-bcb-elm-c10-authority.md             chart 2
  03-background-command-containment.md       chart 3
  04-completion-presentation.md              chart 4
  transitions.tsv                            the machine-readable index
```

## The four charts

| Chart | Scope | Transitions |
|---|---|---|
| 01 — Task / turn phase | The task-level `TurnState.phase` machine and the TaskHeader projection. | T-01..T-09 |
| 02 — C9 / BCB / Elm / C10 authority | Who may commit task completion. | A-01..A-07 |
| 03 — Background command / containment / terminal observation | The job lifecycle the BCB holds on. | B-01..B-09 |
| 04 — Completion message / presentation | How a completion attempt becomes a visible badge. | P-01..P-07 |

## Every load-bearing transition carries

| Field | Meaning |
|---|---|
| `source` | The file:line that owns the transition. |
| `predicate` | The CURRENT source predicate that gates the transition. |
| `effect` | What the transition does to observable state. |
| `test` | The existing test that pins the transition. |
| `kind` | `observed` / `inferred` / `proposed`. |

## Observed vs inferred vs proposed

**All 32 transitions in this model are `observed`.** Every one of them
corresponds to a production seam that fires today and to a test that
pins it. No `inferred` and no `proposed` transition was needed: the
defect was not a missing transition but a MISSING CONSUMER of an
existing decision (the withheld C10 commit).

The one transition that this ACT ADDED is `P-06` (the marker
retraction). It is marked `observed` because it now EXISTS in
production and is pinned by a test — but it was `proposed` before this
ACT, and the `01-causal-analysis.md` document records that transition
explicitly.

## The diagrams are NOT an execution authority

Nothing reads these documents at runtime. They are a READ-ONLY AUDIT
MODEL: a future engineer can use them to answer "which transition
fired, who owns it, what guard held it, and which test pins it"
without re-deriving the causal chain from scratch.

## The transition contract

The charts reflect the TESTED transition contract. The invariant the
whole model exists to protect:

```
Current-turn authoritative completion display
  => C10 committed for the same owner/epoch

C9 attempt
  != C10 completion

Terminal response finalized
  != task completion committed

C10 committed
  => TS conservation passed and Elm authorized

BCB held
  => no authoritative completion display

Held-attempt summary
  => content may remain visible without a false Completed badge
```

Each clause is pinned by at least one test in
`apps/vscode/src/sdk/__tests__/c9-c10-statechart-causal-repair01.c9c10scr01-cons.test.ts`:

| Clause | Test |
|---|---|
| Current-turn authoritative display => C10 committed | CONS-12 (both cases), CONS-01 |
| C9 attempt != C10 completion | CONS-05, CONS-06 |
| Terminal response finalized != task completion committed | RED-01 / RED-02 in the sibling suite |
| C10 committed => TS conservation + Elm authorized | CONS-11, CONS-12 |
| BCB held => no authoritative display | CONS-01, CONS-03 |
| Held-attempt summary => content without a false badge | CONS-13, CONS-04 |
| Exactly-once C10 | CONS-05, CONS-06, CONS-11 |
| Historical summaries preserved across epochs | CONS-07, CONS-10 |
| Session/epoch isolation | CONS-08 |
| Cancellation and resume | CONS-09 |

## Maintenance rule

Any changed transition MUST update its `source` / `predicate` / `test`
entry in `transitions.tsv` in the SAME commit. `transitions.tsv` is the
machine-readable index; the charts are its human-readable rendering.
