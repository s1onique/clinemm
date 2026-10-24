# Task Lifecycle Statecharts

Source-bound state-transition model for the Cline task / turn lifecycle.

**ACT:** `ACT-CLINEMM-P0-C9-C10-STATECHART-CAUSAL-REPAIR01`

These diagrams are a **READ-ONLY AUDIT MODEL**. They are not an
execution authority: no runtime decision reads them, and no code path
is driven by them. They exist so a future engineer can answer
"which transition fired, who owns it, what guard held it, and which
test pins it" without re-deriving the causal chain from scratch.

Every load-bearing transition below carries:

| Field | Meaning |
|---|---|
| `source` | The file:line that owns the transition. |
| `predicate` | The CURRENT source predicate that gates the transition. |
| `effect` | What the transition does to observable state. |
| `test` | The existing test that pins the transition. |
| `kind` | `observed` / `inferred` / `proposed`. |

`transitions.tsv` is the machine-readable index. Every transition in
the charts appears there; every row there points back at a chart.

## The four charts

| Chart | Scope |
|---|---|
| [`01-task-turn-phase.md`](01-task-turn-phase.md) | The task / turn phase machine (`TurnState.phase`). |
| [`02-c9-bcb-elm-c10-authority.md`](02-c9-bcb-elm-c10-authority.md) | Who may commit task completion (C9 / BCB / Elm / C10). |
| [`03-background-command-containment.md`](03-background-command-containment.md) | Background command, containment, terminal observation. |
| [`04-completion-presentation.md`](04-completion-presentation.md) | Completion message publication and presentation. |

## Vocabulary

| Term | Meaning |
|---|---|
| **C9** | `submit_and_exit_seen` — the cardinality capture that fires when the completion tool's terminal response was committed AND the turn-end path is promoting phase. **An attempt, not a completion.** |
| **C10** | `task_completion_committed` — the canonical task-completion commit. Fires at the `setTurnPhase("completed", …)` effect. **The single authority for "the task completed".** |
| **BCB** | Background Completion Barrier — the TS-predicate hold on the C10 commit. |
| **Elm** | The Elm completion-authority kernel. The MANDATORY authority for the C10 commit. There is no silent TS fallback. |
| **Terminal observation** | A background command's terminal result, held until the agent observes it (via `command_status`). |
| **Authoritative row** | A `completion_result` row carrying `isAuthoritativelyCompletedResult: true`. The webview renders the green "Completed" badge for it. |

## The invariant this ACT established

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

## Reading the charts

The charts are Mermaid `stateDiagram-v2` blocks. Solid arrows are
**observed** transitions (a production seam that fires today). Dotted
arrows are **inferred** (a transition that is believed to happen but
has no direct capture). A dashed box marks a **proposed** behaviour
that does not exist in production yet.

The charts are regenerated-by-hand from source. When a transition
changes, update its `source`/`predicate`/`test` entry in
`transitions.tsv` in the same commit.
