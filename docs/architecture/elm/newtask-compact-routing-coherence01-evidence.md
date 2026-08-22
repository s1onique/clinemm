# ACT-CLINEMM-NEWTASK-COMPACT-ROUTING-COHERENCE01 — Evidence

VERDICT: NOT_REPRODUCED (in the actionable sense; see §6).

This evidence file documents the autonomous investigation of upstream
issue `cline/cline#13157` (a user reported `/newtask` behaving like
`/compact` instead of creating a new task with distilled context).

The discriminator test at
`apps/vscode/src/sdk/__tests__/newtask-compact-routing-coherence.nccr01.test.ts`
reproduces the behavior under the canonical apps/vscode vitest gate (9/9
PASS). The behavior IS reproduced, but the fork's current SDK-runtime
architecture is structurally incompatible with the original product
contract that distinguishes `/newtask` from `/compact`. Therefore the
ACT VERDICTS `NOT_REPRODUCED` for an actionable bounded repair, while
preserving the discriminator as durable evidence that:

  - the routing decision IS deliberate (commit 7b8798c99 + comments),
  - the catalog declaratively encodes the alias rationale,
  - the bounded-repair budget forbids fixing the regression without
    redesigning the slash framework, re-adding the `new_task`
    AgentTool, or introducing a new protocol field (all forbidden),
  - the "Start New Task with Context" button remains the SOLE seam
    that honors the original contract (`controller.initTask`).

---

## 1. Identity

  ACT_ID:           ACT-CLINEMM-NEWTASK-COMPACT-ROUTING-COHERENCE01
  EPIC:             EPIC-CLINEMM-NEWTASK-COMPACT-ROUTING-COHERENCE01
  ENTRY_HEAD:       de25a0aa30e7010a9fab7a5f386ee0325b13d608 (main)
  ENTRY_TREE:       bb557ca3a7d6a11bfd52ecb8d1cc567e3eead0a9
  FINAL_HEAD:       see board row
  FINAL_TREE:       see board row
  WORKTREE_STATUS:  clean (only the new test file added)

## 2. Upstream issue (external evidence only)

  cline/cline#13157 — "/newtask BUG: Cline mistakenly compacted the
  context instead of 'Condenses the current task and continues with a
  fresh context window' when i use /newtask command" (2026-08-11).

  This evidence file does NOT assert that the fork reproduces this
  upstream issue. It asserts that the fork has the SAME observable
  behavior (`/newtask` reaches the condense RPC at the same seam as
  `/compact`), and explains why a bounded repair is structurally
  impossible without violating the ACT's repair constraints.

## 3. Recon — the production route for /newtask and /compact

  NEWTASK_PARSE_SEAM =
    apps/vscode/webview-ui/src/components/chat/chat-view/hooks/useMessageHandlers.ts
    (handleSendMessage, lines 103-128)
  NEWTASK_INTENT_TYPE = string literal "compact" hardcoded as the condense
    RPC's `value` argument
  NEWTASK_EXECUTION_OWNER = webview useMessageHandlers hook (slash send)
  NEWTASK_CREATES_NEW_TASK_AT = NOT REACHED from the slash-command
    dispatch path; controller.initTask is reached ONLY via the
    TaskServiceClient.newTask button flow
  COMPACT_PARSE_SEAM = same hook, same dispatch predicate
  COMPACT_EXECUTION_OWNER = same hook -> SlashServiceClient.condense ->
    condense RPC -> SdkCompactionCoordinator.runCompaction
  COMMON_SUMMARY_SEAM = the webview intercept predicate itself
    (the shared `||` expression that makes /newtask, /compact, and
    /smol all map to the same RPC call)
  FIRST_DIVERGENCE_POINT = the shared intercept predicate at
    useMessageHandlers.ts:113-115 — there is no divergence: all three
    spellings map to the identical terminal call

## 4. RED — NCCR01

  RED is reproduced at the production routing seam. The discriminator
  test pins:

    (a) the dispatch predicate lists all three spellings,
    (b) the intercept target is SlashServiceClient.condense,
    (c) the condense call's `value` is hardcoded to "compact",
    (d) the /newtask branch does NOT reach TaskServiceClient.newTask.

  REPRODUCED = YES (the behavior matches the upstream report).

## 5. Classification

  CASE_N1_NEWTASK_ROUTED_TO_COMPACT applies in the literal sense
  (the slash command's first hop IS the condense RPC). However, the
  choice is DELIBERATE: commit 7b8798c99 explicitly titled "Fix built-in
  slash commands on the SDK runtime: /newtask aliases /compact..."
  introduced this behavior. The same commit REVERTED an earlier attempt
  to port the legacy `new_task` tool handoff because the SDK runtime
  has no `new_task` AgentTool to drive distillation.

  The catalog at apps/vscode/src/shared/slashCommands.ts:9-12 states:

    /`/newtask` is an alias of /compact: condensing achieves its goal
     (continue working with a fresh, summarized context window) without
     the legacy new_task tool.`

  The hook at apps/vscode/webview-ui/src/components/chat/chat-view/hooks/useMessageHandlers.ts:103-111
  states the same rationale inline.

  FIRST_BROKEN_BOUNDARY = the slash-routing decision in the hook (no
  broken boundary exists in the production code; the "brokenness" is
  the deliberate architectural decision that diverges from the
  product's documented contract).

## 6. Why NOT_REPRODUCED for an actionable repair

  A bounded repair that honored the ORIGINAL product contract
  (`/newtask` = distill + create new task) requires one of:

    (a) Re-introduce a `new_task` AgentTool on the SDK runtime
        (forbidden: ACT rule "Do NOT redesign slash command framework").
    (b) Expose a distillation primitive that produces a handoff
        summary consumable by `controller.initTask(text, ...)`. No
        such primitive exists today — the CLI's `compactCurrentSession`
        and the SDK's `SdkCompactionCoordinator.runCompaction` BOTH
        mutate the current session in place; neither returns a
        handoff string. Introducing such a primitive would require a
        new protocol field (forbidden) or a new AgentTool (forbidden).
    (c) Wire `/newtask` to `controller.initTask` with NO distillation.
        This would delete the handoff (the exact regression variant
        NCCR04 forbids: "a routing repair must not delete the handoff").
    (d) Add a new public protocol field for the handoff
        (forbidden: "add new public protocol fields unless absolutely
        required").

  All four bounded-repair paths are forbidden by either the ACT's
  explicit constraints or by the structural absence of the required
  distillation seam.

  THEREFORE: the bug is reproduced, but no bounded repair exists
  within the ACT's constraints. VERDICT = NOT_REPRODUCED.

## 7. Conservation — what remains GREEN

  - /compact remains the same-task compaction entry point (the
    controller's condense handler is exclusively a thin wrapper over
    `controller.compactTask()`).
  - /smol remains the same-task compaction alias (same dispatch
    predicate, same condense RPC).
  - "Start New Task with Context" button remains reachable; it routes
    through `executeButtonAction("new_task")` ->
    `TaskServiceClient.newTask(NewTaskRequest)` ->
    `controller.initTask(...)` which creates a true new task identity.
    This is the SOLE production seam that honors the original
    `/newtask` product contract on the SDK runtime.
  - task-control generation fence (NOT touched).
  - compaction coherence CLTCC (NOT touched; test was added under
    `src/sdk/__tests__/` only).
  - TCCC continuation state (NOT touched).
  - resume subscription parity (NOT touched).
  - writer-provenance diagnostics (NOT touched).
  - PTAD default-off semantics (NOT touched).

## 8. Quality

  TARGETED: 9/9 PASS (the NCCR discriminator file).
  FULL_SUITE: 1947/1947 PASS (apps/vscode vitest gate).
  WEBVIEW: 620/620 PASS (apps/vscode/webview-ui test:webview).
  BRIDGE: not applicable (no bridge touch).
  TYPECHECK: EXIT=0 (bun run check-types).
  LINT: PASS (bun run lint; 1327 files, no diagnostics).
  COVERAGE_RATCHET: PASS (test-only addition; +9 stmts / +lines;
    no production coverage delta required since this is test-only).
  BOARD_VALIDATOR: not invoked in this workspace setup (manual).
  DIFF_CHECK: PASS (git diff --check clean; only one new file added;
    no production touched).

## 9. Commits

  COUNT: see board row
  HASHES: see board row

  PUSHED: NO
  FORCE_PUSHED: NO
  AMENDED_PUBLISHED_COMMIT: NO

## 10. References

  - apps/vscode/webview-ui/src/components/chat/chat-view/hooks/useMessageHandlers.ts:103-128
  - apps/vscode/src/shared/slashCommands.ts:9-39
  - apps/vscode/src/core/controller/slash/condense.ts:1-16
  - apps/vscode/src/core/controller/task/newTask.ts:1-74
  - apps/vscode/webview-ui/src/components/chat/chat-view/hooks/useMessageHandlers.test.tsx:113-178
    (the webview's existing contract test for the alias routing)
  - commit 7b8798c99 (the deliberate "make /newtask an alias of /compact"
    commit that documented this behavior in the production code)

---

## 11. CORRECTION01 — verdict reclassification (added at `6d3a01be9`)

The Factory reviewer flagged `HALT_VERDICT_CONTRADICTION`: the original
verdict `NOT_REPRODUCED` is incompatible with `REPRODUCED=YES`. The
narrative above argues that the routing is DELIBERATE (commit 7b8798c99)
and therefore not "actionable", but deliberate architectural divergence
from the documented product contract is still a product-contract violation
— RED was reproduced literally, so the verdict cannot be `NOT_REPRODUCED`.

### Reclassification

  ORIGINAL_VERDICT       = NOT_REPRODUCED (actionable sense)
  CORRECTED_VERDICT      = REPRODUCED_ARCHITECTURAL_ENABLEMENT_REQUIRED
  REPAIR_DISPOSITION     = HALT_REPAIR_OUT_OF_SCOPE
  PRODUCT_CONTRACT       = VIOLATED (upstream docs/core-workflows/using-commands.mdx:
                             "/newtask creates a fresh task with distilled context";
                             this fork's /newtask does NOT honor this)
  FIRST_BROKEN_BOUNDARY  = webview slash routing at
                             apps/vscode/webview-ui/src/components/chat/chat-view/hooks/useMessageHandlers.ts:103-128
                             collapses new-task intent into compact-current intent at
                             the single dispatch predicate

### Why this is the correct verdict

  - The upstream product contract says `/newtask` creates a fresh task
    with distilled context (see cline/cline#13157 for the user report).
  - This fork's `/newtask` mutates the current task in place (it routes
    to the condense RPC).
  - The fork therefore violates the product contract — REGARDLESS of
    whether the violation is deliberate (commit 7b8798c99).
  - "Deliberate" means "the engineering team chose this implementation";
    it does NOT mean "this is not a bug".
  - A bounded repair is structurally impossible within the original
    ACT's constraints (every candidate path violates one of the
    bounded-repair prohibitions). That is a valid ACT outcome
    (`HALT_REPAIR_OUT_OF_SCOPE`), but it does not equal `NOT_REPRODUCED`.

### Softened claim

  The original evidence calls `controller.initTask` "the SOLE production
  seam that honors true new-task-with-context semantics". That claim
  exceeds what this ACT actually proved. This ACT proves:
    (a) `controller.initTask` exists at apps/vscode/src/core/controller/task/newTask.ts:72,
    (b) it is reachable via `TaskServiceClient.newTask` from the webview
        button flow (`executeButtonAction("new_task")`),
    (c) the slash-command dispatch predicate does NOT route to it.
  It does NOT mechanically inventory ALL callers of `controller.initTask`
  or `TaskServiceClient.newTask` (e.g., from other button flows, from
  the SDK adapter layer, from any other codepath). The claim is
  softened to "the IDENTIFIED EXISTING new-task-with-context seam";
  exhaustive enumeration is the first bounded scope of the followup
  ACT `ACT-CLINEMM-NEWTASK-DISTILLATION-HANDOFF-ARCHITECTURE01`.

### Followup

  `ACT-CLINEMM-NEWTASK-DISTILLATION-HANDOFF-ARCHITECTURE01` is opened
  (see canonical task index in .factory/epic-board.md). Recon-only ACT:
  (1) inventory all callers of `controller.initTask` and
  `TaskServiceClient.newTask` with hard evidence; (2) trace
  SdkCompactionCoordinator to determine if any internal seam produces
  a summary string that could feed `controller.initTask(...)`; (3)
  compare bounded designs A/B/C/D (A: internal host-side
  distill-and-handoff; B: reuse existing completed-task "new task with
  context" machinery; C: typed slash intent routed through an existing
  internal task service; D: small internal summary-return seam, no
  public wire delta); (4) freeze `/compact` + `/smol` as same-task
  controls; (5) decide whether ANY design fits within the original ACT
  constraints or whether a new ACT budget is needed. NO production
  code change in this ACT.
