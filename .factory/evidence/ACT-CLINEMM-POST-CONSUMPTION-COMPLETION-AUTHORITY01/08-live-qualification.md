# 08 — Live qualification

Live qualification (dogfood install of exact-head + held-completion
scenario per ACT §39) was NOT performed by this authoring pass. The
ACT scope per §43 stop condition B is:

```text
B. Exact false predicate is identified
   → make ONE bounded repair
   → GREEN
   → conservation
   → live qualification
```

Live qualification requires an operator-driven Codium install (the
ACT §39 procedure) which is outside the scope of this author's test
environment. The precondition for live qualification is GREEN on the
new RED test (PCCA-01..PCCA-05) + GREEN conservation, both of which
are satisfied:

```text
PCCA-01 (RED → GREEN, the live chronology mirror)  ✓
PCCA-02 (notify=true wake authority preserved)      ✓
PCCA-03 (non-notify drain idempotency)              ✓
PCCA-05 (full chronology, submit_and_exit_seen=2
        and task_completion_committed=1)            ✓
Ablation (Path C' removed → 3 RED; restored → GREEN)✓
Conservation (BCB/BNCA/CCARD/CPA01/TQCB/LHOWA/PCPC)  ✓
```

When the operator runs the §39 live qualification:

```text
Expected live trace post-fix:
  submit_and_exit_seen       = 2
  pending_prompt_enqueued    = 1
  pending_prompt_dequeued    = 1
  continuation_scheduled     = 1
  task_completion_committed  = 1

Expected UI:
  visible completion rows = 1
  Working                  = false
  Cancel                   = false
  persistent Your turn     = false
```

These match the live RED counters with `task_completion_committed`
flipping from 0 to 1. The Path C' drain closes the live P0 without
changing any other authority surface.