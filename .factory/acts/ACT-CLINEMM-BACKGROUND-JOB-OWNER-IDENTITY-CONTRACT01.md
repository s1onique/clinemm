# ACT-CLINEMM-BACKGROUND-JOB-OWNER-IDENTITY-CONTRACT01

```text
HEAD            : 6ec9bed4f  (parent umbrella RUNTIME-TASK-PROGRESSION-RECON01)
branch          : main
working tree    : clean
production Δ    : 0  (no production change in this ACT body; it is a contract probe, not a repair ACT)
git diff --check: pass
review round    : NEW (this ACT body is what gets the review turn)
```

## 0. Provenance and verdict

This ACT is opened in response to the Factory causal reviewer's
verdict `PASS_WITH_ONE_P1_FIX / C1: GO_CONTRACT` on the
Q1–Q5 bounded recon of `ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01`
(closed at commit `6ec9bed4f` with terminal disposition
`AUTHORITY_IDENTITY_MISSING = PROVEN`). The reviewer correctly
noted that my recommendation to add an optional carrier slot
to `SdkSessionEventCoordinatorOptions` was **one step too
far downstream**: the producer does not yet possess the
identity to transport. The contract ACT MUST therefore
begin at the **producer seam** (job creation + per-job
storage + liveness query), not at the **consumer seam**
(coordinator's options).

This ACT is **minimal**: it defines and minimally implements
the authoritative owner identity carried by a background
command job from creation through liveness/completion,
sufficient for the existing umbrella ACT to execute its
real Q5 RED.

## 1. Mission

> Define and minimally implement the authoritative ownership
> identity carried by a background command job from
> creation through liveness/completion, sufficient for the
> existing `ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01`
> to execute its true Q5 RED. Keep it tiny.

## 2. Scope (what this ACT may do)

- Inspect `apps/vscode/src/sdk/command-job-manager.ts` for
  the real job-creation seam and the existing identity
  available in `AgentToolContext` (which already exposes
  `sessionId` and `conversationId` per
  `sdk/packages/shared/src/agent.ts:349,351`).
- Choose the **minimum** identity to capture on each job
  at creation time.
- Persist that identity on `CommandJob` (interface field
  on `command-job-manager.ts:386`).
- Expose a per-owner liveness query on the manager's public
  surface (semantically either
  `hasRunningBackgroundJobForOwner(ownerId): boolean` or
  `getRunningBackgroundJobs(): Array<{ jobId, ownerSessionId? }>`
  — the exact shape is decided during this ACT, NOT
  pre-decided here).
- Update any code path that constructs a CommandJob to
  populate the identity from the available context.

## 3. Out of scope (what this ACT must NOT do)

- **DO NOT** mutate `awaiting_followup` semantics yet — the
  fix is solely about identity preservation.
- **DO NOT** add a carrier slot to `SdkSessionEventCoordinatorOptions`
  (or any other consumer-side seam) — that decision is
  downstream of this ACT and gated on its closure.
- **DO NOT** rename `backgroundCommandTaskId` (the
  MISLEADING_NAME / STRUCTURAL FACT finding stays frozen for
  a separate contract ACT).
- **DO NOT** mutate any unrelated turn-progression behavior.
- **DO NOT** introduce a new controller-wide boolean
  (per the reviewer's directive: the existing
  `backgroundCommandRunning` is already too lossy for
  authority decisions).
- **DO NOT** poll remote processes or other out-of-process
  sources.
- **DO NOT** add new protocol fields beyond the minimum needed
  to identify the owner.

## 4. Contract questions — progression

```text
Q1. What owner IDs exist at real job creation?
   - Inspect AgentToolContext at command-job-manager.ts:633
     (manager.start signature); what's actually passed?
   - Confirm sessionId / conversationId presence on
     run_commands invocations vs other tools.

Q2. Which one has lifecycle semantics matching the
    session-event owner?
   - In particular, is `conversationId` stable across the
     lifetime of a turn, across rebuilds, across clearTask?
   - Is `sessionId` stable across rebuilds and clearTask?
   - Decide between ownerSessionId / ownerConversationId /
     (only if proven) ownerTaskId.

Q3. RED — starting J loses that owner identity today
   - Write a minimal test (synthetic-real; uses
     /bin/sh -c 'sleep N' as bounded child following
     command-job-manager.test.ts pattern) that starts a
     job, asserts the chosen owner identity is recoverable
     from the job record, and that it FAILS today.

Q4. Bounded addition — persist that identity on CommandJob
   - Add the chosen field(s) to the CommandJob interface
     (command-job-manager.ts:386) and CommandJobSnapshot
     (line 60).
   - Wire manager.start() to capture the identity from the
     available context.
   - Re-run Q3's RED → GREEN.

Q5. Query/lookup exposes running jobs for owner X
   - Expose the chosen semantic on the manager's public
     surface.
   - Add unit tests for the cross-owner control scenarios.

Q6. Controls (mandatory)
   - Job of owner A does NOT count for owner B's lookup.
   - Completed job no longer counts for any owner.
   - Empty repository still reads false.
```

## 5. Anti-overfit guarantee (carried forward verbatim)

```text
This ACT is exclusively about owner identity preservation
on the run_commands background path. It is NOT about:

  - whether the agent runtime should ever emit turnComplete
    while owned background work exists (architectural
    decoupling — that's a separate contract question)
  - whether CLineMM must keep a turn open because a remote
    Unix process is alive (the host cannot generally know)
  - any UX affordance that masks the post-terminal
    progression defect
  - any field renaming on the public webview API

The useful contract is closer to:

  "ClineMM still owns a background job whose completion
   has not been authoritatively observed → local turn
   completion alone cannot claim no work is in flight
   for that owner."

NOT:

  "a remote Unix process is alive → ClineMM must keep
   the turn open."
```

## 6. Relationship to the parent ACT

```text
PRODUCTION_PARENT       = ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01
                          (Q1–Q5 closed at 6ec9bed4f; frozen as
                           AUTHORITY_IDENTITY_MISSING = PROVEN)
PRODUCTION_FILES_TOUCHED_BY_THIS_ACT =
                          apps/vscode/src/sdk/command-job-manager.ts
                          (only what Q4 minimally requires)
TEST_FILES_TOUCHED_BY_THIS_ACT  =
                          apps/vscode/src/sdk/__tests__/command-job-manager.test.ts
                          (only if needed for Q3/Q5/Q6 controls)
PARENT_FACTORY_TERM   = AUTHORITY_IDENTITY_MISSING = PROVEN
PARENT_NEXT_ACT_AT_OPEN = BACKGROUND-JOB-OWNER-IDENTITY-CONTRACT01
PARENT_FACTORY_DISPOSITION_AT_CLOSE = C1: GO_CONTRACT (no further
                          review round required to open this ACT)
SIBLING_AFTER_THIS_ACT_CLOSES = resume ACT-CLINEMM-RUNTIME-TASK-
                          PROGRESSION-RECON01 inside the umbrella ACT
                          for the real Q5 RED (no new parent ACT,
                          no Factory-bound follow-up ACT body required).
```

## 7. Conservation (must hold across this ACT)

- ACAS01 evidence preserved at `b072d9807` — DO NOT rewrite
  or delete; ACAS01 vitest must remain 4/4 PASS post-merge.
- TSWPD provenance preserved.
- No new global state; the owner identity is per-job.
- No remote-process checks.
- No new permanent protocol field beyond the minimum
  needed to identify the owner.
- `backgroundCommandTaskId` MISLEADING_NAME finding frozen
  separately, NOT addressed here.
- The existing `backgroundCommandRunning` controller-wide
  boolean stays as projection-of-fact; this ACT may add
  owner-scoped surfaces but MUST NOT add a parallel
  projection that could lie.

## 8. Honest stop signals

| Outcome | Verbatim stop wording |
|---|---|
| Tests Q3/Q6 all green, identity persisted, query works, controls pass | `OPENED_AND_GREEN / BACKGROUND_JOB_OWNER_IDENTITY_CONTRACT_SATISFIED` |
| Identity gap reappears in a direction we didn't anticipate | `HALT_UNANTICIPATED_IDENTITY_GAP` |
| Manager-side wiring found to require deeper change than this ACT's scope allows (e.g. explicit session ownership at SDK session layer) | `HALT_OUT_OF_SCOPE_FOR_THIS_ACT` → recommend follow-up ACT |
| Producer-side identity is genuinely insufficient (no `sessionId`/`conversationId` actually reaches `manager.start`) | `HALT_PRODUCER_HAS_NO_OWNER_IDENTITY` → escalate |
| We accidentally added a controller-wide boolean | `ROLLBACK_PROJECTION_LIE` |

## 9. TYPECHECK / DIFF-CHECK gates (must pass before ACT closure)

- `bun run check-types` (apps/vscode) clean.
- `git diff --check` silent for any new test file.
- ACAS01 vitest remains 4/4 PASS.
- This ACT does not require completion of
  `ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01`
  for closure (it's a sibling lane).
```
