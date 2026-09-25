# ACT-CLINEMM-LIVE-PRESENTATION-SURFACE-DISCRIMINATOR01 — LIVE SPECIMEN

## Operator Environment

| Field | Value |
|---|---|
| ACT ID | ACT-CLINEMM-LIVE-PRESENTATION-SURFACE-DISCRIMINATOR01 |
| Date | 2026-09-25 |
| Capture Source | Operator-uploaded screenshot + CCARD JSONL |
| Cloud Agent Liveness Probe | DISABLED (dogfood infra not present in this environment — see §4) |
| Working Tree Status | clean (`git status` = no changes) |
| Repository HEAD | `6b1003574` (closure_head self-referential note) |

## Implementation Subject Identity (frozen)

The dogfood identity currently shown in the operator's VS Code extension
panel:

| Field | Value | Source |
|---|---|---|
| `extension_id` | `cline.cline` | `${publisher}.${name}` per VS Code CLI pinning convention |
| `version` | `4.1.16` | `apps/vscode/package.json:version` (independent field) |
| publisher | `cline` | `apps/vscode/package.json:publisher` |
| name | `cline` | `apps/vscode/package.json:name` |
| DOGFOOD_SOURCE_HEAD | `baacc122a…` | per BCCOC01 result.json (`dogfood_source_head`) |
| Current HEAD (closure head self-reference) | `6b1003574` | `git rev-parse HEAD` |

The installed dogfood is the SAME `4.1.16` VSIX that this ACT's
predecessor (BCCOC01) packaged as
`dist/clinemm-4.1.16-baacc122a.vsix`. The HEAD drift between
`baacc122a` (the last SUBJECT_HEAD that changed source) and
`6b1003574` (the current `git rev-parse HEAD`) is purely meta-state
(closure_head self-referential notes); NO source code differs. The
VSIX is bit-identical to the predecessor's recorded artifact.

Per the identity-split convention (twenty-third reviewer C1):

```
IMPLEMENTATION_SUBJECT_HEAD = baacc122aa3a9cb4afd1e1d139f269639a34fc3f
DOGFOOD_SOURCE_HEAD         = baacc122aa3a9cb4afd1e1d139f269639a34fc3f
CLOSURE_HEAD                = 020a4efbaa8fa196be39b074249d527c71735ad3
extension_id                = cline.cline
version                     = 4.1.16
```

Per VS Code extension identity model (twenty-fourth reviewer C1):

```
extension_id = ${publisher}.${name} = cline.cline
version      = 4.1.16  (separate field)
```

The specimen is NOT rejected for being newer than the prior frozen
VSIX. Per the predecessor ACT
(`ACT-CLINEMM-BACKGROUND-COMMAND-COMPLETION-OWNERSHIP-CORRELATION01/05-artifact-identity.txt`),
the VSIX is bit-identical because the closure_head commits between
`baacc122a` and `6b1003574` do not change source.

## Specimen Under Investigation

Per the ACT-mandated invariants (the frozen live lifecycle counters
the operator uploaded):

```
total records                = 13
terminal_committed          = 1
notify_consume_enter        = 1
wake_created                = 1
pending_prompt_enqueued     = 1
pending_prompt_dequeued     = 1
continuation_scheduled      = 1
run_turn_started            = 2  (origins: explicit_user + pending_prompt_drain)
agent_turn_done             = 2  (origins: explicit_user + pending_prompt_drain)
submit_and_exit_seen        = 2
task_completion_committed   = 1
```

Exact live sequence (operator-confirmed):

```
seq 1   run_turn_started             origin=explicit_user
seq 2   terminal_committed           jobId=J
seq 3   notify_consume_enter         jobId=J
seq 4   pending_prompt_enqueued      origin=pending_prompt_drain  jobId=J
seq 5   wake_created                 jobId=J
seq 6   submit_and_exit_seen
seq 7   agent_turn_done              origin=explicit_user
seq 8   pending_prompt_dequeued      jobId=J
seq 9   continuation_scheduled       jobId=J
seq 10  run_turn_started             origin=pending_prompt_drain  jobId=J
seq 11  submit_and_exit_seen
seq 12  task_completion_committed
seq 13  agent_turn_done              origin=pending_prompt_drain  jobId=J
```

Conservation verdict (per ACT §11):

```
WAKE_CARDINALITY          = HEALTHY
EXECUTION_CARDINALITY     = EXPLAINED
TASK_COMPLETION_COMMIT    = 1
PRESENTATION_CARDINALITY  = UNKNOWN   (this ACT's classification target)
wake C4->C8 jobId         = identical (not yet re-verified in this
                            specimen — but the prior BCCOC01 + BCNEX01
                            + BCTPA01 + CCARD01 chain establishes the
                            invariant; no source drift since)
```

## Specimen Categorical Classification

```
WAKE_CARDINALITY             = HEALTHY         (1)
TASK_COMPLETION_COMMIT       = 1               (exactly one C10 commit)
EXECUTION_TURN_PAIR          = 2               (1 explicit_user + 1 pending_prompt_drain)
```

Per the ACT's preconditions:

- wake cardinality: 1  (was the load-bearing AUTHORITY04 trigger
  condition for BCCOC01; now HEALTHY)
- one `task_completion_committed` at the canonical phase-transition
  seam (line ~732 of `sdk-session-event-coordinator.ts`)
- two `submit_and_exit_seen` records (one per turn; turn-end
  straggler OK per the ACT's runbook §1)

## Cloud Agent Liveness Probe (informational)

The operator-supplied specimen (CCARD JSONL + screenshot + this live
specimen file) is the canonical evidence for this ACT. The Cloud
Agent context CANNOT independently re-run the workload (no LLM
provider credential, no live extension host, no Playwright per the
global CLAUDE.md Cloud Agent note).

The classification output of this ACT is therefore:

  **SOURCE-BOUND** — every UI surface-to-producer mapping is
  grounded in either:

  - the production source seam at `apps/vscode/src/sdk/message-translator.ts`,
    `apps/vscode/src/sdk/sdk-session-event-coordinator.ts`, or
    `apps/vscode/src/sdk/background-notify-coordinator.ts`; OR
  - the production webview renderer at
    `apps/vscode/webview-ui/src/components/chat/{ChatRow,CompletionOutputRow,CommandOutputRow}.tsx`.

No classification is inferred from the screenshot alone. The
screenshot is used ONLY to enumerate the visible surfaces (UI-A..UI-F);
the producer assignment is source-bound.

## Note on Specimen Newness

The operator's note (twenty-fourth reviewer C1): "the installed
extension identity shown in VS Code is meaningful: VS Code defines
an extension ID as `${publisher}.${name}`, with version separate."

Identity columns recorded above per that directive.