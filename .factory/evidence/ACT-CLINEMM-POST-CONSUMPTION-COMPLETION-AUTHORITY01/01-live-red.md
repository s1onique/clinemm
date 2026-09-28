# 01 — Live RED (transcript/UI chronology)

The live P0 observed in session 1790582070333_vq1sf during dogfood
qualification work. The continuation path itself executed end-to-end:

```text
submit #1
  → pending_prompt_enqueued = 1
  → agent turn ends
  → pending_prompt_dequeued = 1
  → continuation_scheduled = 1
  → finalization run starts
  → command_status observes held job (state = containment_failed)
  → submit #2
  → agent turn ends
  → NO task_completion_committed = 0
  → UI: Working / Cancel stays visible
```

The captured counters proved the continuation machinery fired:

```text
submit_and_exit_seen      = 2
pending_prompt_enqueued   = 1
pending_prompt_dequeued   = 1
continuation_scheduled    = 1
task_completion_committed = 0
```

The held observation was for a job whose terminal state was
`containment_failed` (the act of returning the terminal snapshot to the
agent did NOT drain the non-notify observation because of the
consumer-guard exclusion described in 02-recon.md).

## Frozen classification (per ACT §1, §2)

```text
LIVE_DUPLICATE_VISIBLE_COMPLETION   = N/A (post-CPA01 fix; visible presentation correct)
LIVE_DOUBLE_AUTHORITATIVE_COMMIT    = UNPROVEN — held submit did not commit
LIVE_TASK_COMPLETION_COMMITTED      = 0
LIVE_BCB_CONTINUATION_AUTHORITY_LOST = YES — second submit blocked on
                                      unconsumed_owned_terminal_results > 0
                                      for a containment_failed job
```

## Defect shape

The BCB/C10 framework authority machinery (BCB01, BCTPA01, BNCA01,
TQCB01, etc.) all worked end-to-end. The continuation substrate worked
(`pending_prompt_enqueued = pending_prompt_dequeued = continuation_scheduled = 1`).
What broke is the user-visible task lifecycle never reached the
authoritative "completed" phase transition (BCB01 §0.1 commit) for the
single logical task.

The downstream consequence the user observed:
- Working / Cancel affordance remained visible
- the user could not progress the workflow
- the held completion was effectively lost