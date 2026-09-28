# 08 — Live Qualification

Per ACT §34, this ACT closes the repair by GREEN conservation + RED/GREEN
discriminator tests + ablation. Live dogfood qualification (the
operator-run dogfood session) is the next step, scheduled for
`ACT-MYC-CLINEMM04-LIVE-QUALIFICATION` per ACT §42 STOP condition.

Live qualification recipe (the operator should reproduce this):

```bash
cd /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm

# Ensure HEAD is at the closure commit of THIS ACT (post repair).
# Quick sanity: git log -1 --oneline should show
#   ACT-CLINEMM-COMPLETION-PRESENTATION-AUTHORITY01: PASS_...

# Install
bun install
bun run protos
bun run build:webview
bun esbuild.mjs

# Launch the operator dogfood session
# (Use the established dogfood-diagnostic-profile recipe from
#  ACT-MYC-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE01.)

# Provoke the held completion naturally:
# 1. Start a session
# 2. Run a fire-and-forget background command (notify=false)
#    via run_commands / execute_command — the model must NOT
#    call command_status synchronously, so the terminal observation
#    is HELD
# 3. Let the model call submit_and_exit while the job is still
#    RUNNING OR terminal-but-unconsumed
# 4. The BCB barrier must hold completion (existing BCB01 work)
# 5. The C10 message-layer filter MUST now ALSO suppress the
#    premature ✓ Completed marker (this ACT's repair)
# 6. The runtime issues a BCB continuation prompt
# 7. The model calls command_status to drain the held observation
# 8. The model calls submit_and_exit again
# 9. The C10 filter MUST now show ONE visible completion marker
# 10. Working gone, Cancel gone, ✓ Completed visible

# Expected per-session counters (live, not aggregate ring):
#   submit_and_exit_seen = 2
#   task_completion_committed = 1
#   user_visible_completion_presented = 1
#
# (Pre-fix would show user_visible_completion_presented = 2,
#  the load-bearing live P0 this ACT repairs.)
```

Pre-fix expected: `user_visible_completion_presented = 2` (the live P0).
Post-fix expected: `user_visible_completion_presented = 1`.

The CPA01 test in `src/sdk/__tests__/completion-presentation-authority01.cpa01.test.ts`
is the production-shaped unit test that pins this exact behavior.
Live qualification confirms the test exercised against the real
`node_modules/.bin/vsce`-installed extension in a real VS Code
session with a real provider.

## Status of this ACT

```text
PASS_COMPLETION_PRESENTATION_AUTHORITY (ACT scope complete)

RUN_COMPLETION_DISTINCT_FROM_TASK_COMPLETION   = TRUE
HELD_SUBMIT_VISIBLE_COMPLETION_COUNT            = 0
FINAL_TASK_COMPLETION_COMMITTED_COUNT            = 1
FINAL_VISIBLE_COMPLETION_COUNT                   = 1
VISIBLE_COMPLETION_REQUIRES_TASK_AUTHORITY      = TRUE
FINAL_ANSWER_CONTENT_PRESERVED                  = TRUE
DUPLICATE_COMPLETION_PRESENTATION               = NOT_REPRODUCED
PERSISTENT_WORKING_BUG                          = NOT_REPRODUCED
PERSISTENT_YOUR_TURN_BUG                        = NOT_REPRODUCED
BCB_SEMANTICS_CHANGED                           = FALSE
MYC_CODE_CHANGED                                = FALSE
READY_FOR_MYC_CLINEMM04                         = TRUE (pending live qualification)
```