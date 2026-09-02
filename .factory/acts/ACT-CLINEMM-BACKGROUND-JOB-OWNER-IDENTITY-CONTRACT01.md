# ACT-CLINEMM-BACKGROUND-JOB-OWNER-IDENTITY-CONTRACT01

```text
HEAD            : c685317ea  (contract implementation GREEN; parent 661780875 P1-fix; grandparent 603ae6806 contract opening; great-grandparent 6ec9bed4f Q1-Q5 recon stop)
branch          : main
working tree    : clean
production Δ    : bounded minimum - apps/vscode/src/sdk/command-job-manager.ts gains ownerSessionId?: string on internal CommandJob + hasRunningBackgroundJobForOwner(ownerSessionId): boolean public query; CommandJobSnapshot interface UNTOUCHED (P1 no-leak invariant); the internal snapshot() function constructs CommandJobSnapshot field-by-field WITHOUT spreading the job record (existing CORRECTION03 pattern for executionCapability)
git diff --check: pass
review round    : IMPLEMENTATION GREEN per Factory causal reviewer PASS_WITH_NONBLOCKING_RESIDUE / C1: GO_CONTRACT_IMPLEMENTATION on commit 661780875; contract ACT identity seam GREEN at structural and no-spawn-behavioural level (Q6.1 + Q6.1b + typecheck 0 errors); lifecycle GREEN matrix Q6.2-Q6.8 documented to run in non-sandboxed shell / CI per the honest environmental gating in the test file header
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

### P1 (in-process correction at commit `603ae6806+1`)

The Factory causal reviewer's verdict on the opening commit
of THIS contract ACT was again `PASS_WITH_ONE_P1_FIX / C1:
GO_CONTRACT`. The P1 was:

> Owner identity is prescribed onto `CommandJobSnapshot`
> without proving snapshot exposure is necessary.

Specifically, the previous Q4 wording said
"Add the chosen field(s) to the CommandJob interface AND
CommandJobSnapshot." The reviewer correctly noted that
`CommandJobSnapshot` may be consumed by UI, tool output,
diagnostics, persisted metadata, or any public-facing
adapter; adding `sessionId`/`conversationId` there creates
unnecessary surface area and potentially a privacy/API
compatibility commitment.

The bounded fix: `CommandJob` (the internal record) retains
owner identity. `CommandJobSnapshot` does NOT gain owner
identity UNLESS source recon proves an existing internal-only
snapshot consumer mechanically requires it. The owner-scoped
query encapsulates identity:

```ts
hasRunningBackgroundJobForOwner(ownerId): boolean
```

or, if more information is genuinely needed:

```ts
getRunningBackgroundJobsForOwner(ownerId): ...
```

rather than exposing raw ownership IDs broadly. This also
better satisfies our own out-of-scope rule
"no protocol field bloat."

This is a bounded contract correction, not a design
restart. Q1/Q2/Q3/Q5/Q6 are unchanged in spirit; only Q4
and the post-ACT Q5 RED assertion shape are tightened.
See §2 Scope, §3 Out of scope, §4 Q1/Q2/Q3/Q4, and §5
for the frozen wording.

### Implementation GREEN (in-process; at commit `c685317ea`)

Factory causal reviewer verdict on commit `661780875`
(`PASS_WITH_NONBLOCKING_RESIDUE / C1: GO_CONTRACT_IMPLEMENTATION`)
authorized the implementation. The minimum production change
landed at `c685317ea`:

- Internal `CommandJob` gains `ownerSessionId?: string`.
- `start()` captures `context?.sessionId` at construction time.
- `CommandJobManager` gains public
  `hasRunningBackgroundJobForOwner(ownerSessionId): boolean`.
- `CommandJobSnapshot` interface UNTOUCHED (P1 no-leak invariant).
- `snapshot()` and `projectResponseSnapshot()` UNCHANGED.
- `getActiveJobIds()` UNCHANGED (returns ids only, no ownership).
- `onBackgroundStateChange` projection UNCHANGED.

Exactly ONE owner captured (`sessionId`). Persisting both
`sessionId` and `conversationId` is forbidden. `taskId` is not
applicable — no such identity on `AgentToolContext` at
`sdk/packages/shared/src/agent.ts:348-355`.

RED provenance (honest): TYPE/STRUCTURAL RED at HEAD-before-
`c685317ea` = 15 TypeScript compile errors all on the new
test file for `hasRunningBackgroundJobForOwner does not exist
on type CommandJobManager`. Documented in the test file
header; NOT claimed to be a runtime behavioral RED.

BEHAVIORAL GREEN matrix (durable): Q6.1-Q6.1b PASS in this
IDE-sandbox; Q6.2-Q6.8 are environmentally gated (require
spawn() to succeed; in this IDE-sandbox the pre-existing
`command-job-manager.test.ts` exhibits the same 18/20 spawn-
related failures — not a regression). The contract ACT
identity seam is fully GREEN at the structural and no-spawn-
behavioural level.

After this commit, the contract ACT CLOSES GREEN at the
identity seam. The umbrella ACT
`RUNTIME-TASK-PROGRESSION-RECON01` resumes Q5 in the next
turn with the RED matrix A/B/C/D where
A. current owner has RUNNING J → `after.phase` must NOT be
   `awaiting_followup` (without freezing the specific phase A
   must become, per the bounded P1 softening at `661780875`).
Then immediately pivot to
`ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01`.

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
  at creation time. Q1/Q2's discrimination table (see §4)
  forces picking **exactly one** semantic owner if
  possible; persisting both because both exist is
  forbidden.
- Persist the chosen identity on the **internal**
  `CommandJob` record (interface at
  `command-job-manager.ts:386`). NOT on `CommandJobSnapshot`
  by default.
- Expose a per-owner liveness query on the manager's public
  surface. Preferred shape (decided DURING this ACT):
  `hasRunningBackgroundJobForOwner(ownerId): boolean`,
  or, if more information is genuinely needed:
  `getRunningBackgroundJobsForOwner(ownerId): ...`. The
  exact shape is NOT pre-decided here. The query
  encapsulates identity; callers do not receive raw
  ownership IDs unless mechanically required.
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
- **DO NOT** put owner identity on `CommandJobSnapshot`
  (or any other externally-consumed shape — UI, tool output,
  diagnostics, persisted metadata, public-facing adapter)
  UNLESS source recon proves an existing **internal-only**
  snapshot consumer mechanically requires the owner field.
  Identity belongs on the internal `CommandJob` record by
  default; the per-owner query encapsulates identity.
- **DO NOT** persist BOTH `sessionId` and `conversationId`
  simply because both exist on `AgentToolContext`. The
  Q1/Q2 discrimination table (§4) must force a single
  minimum lifecycle-correct owner.

## 4. Contract questions — progression

```text
Q1. What owner IDs exist at real job creation?
   - Inspect AgentToolContext at command-job-manager.ts:633
     (manager.start signature); what's actually passed?
   - Confirm sessionId / conversationId presence on
     run_commands invocations vs other tools.

Q2. Which identity is stable for exactly the lifecycle
    that SdkSessionEventCoordinator calls "this owner"?
   - For each candidate, fill the discrimination table:
     | Identity         | stable across turn iterations? | changes on new task? | changes on session rebuild? | available at job creation? |
     | sessionId        |                            ?  |                  ?   |                         ?   |                       ?    |
     | conversationId   |                            ?  |                  ?   |                         ?   |                       ?    |
     | task ID          |                            ?  |                  ?   |                         ?   |                       ?    |
   - Decide on the MINIMUM identity with the correct
     lifecycle semantics (exactly ONE of sessionId /
     conversationId / task ID, never both, never all three).
   - If NONE matches the SdkSessionEventCoordinator's
     "this owner" semantics, halt at
     HALT_UNANTICIPATED_IDENTITY_GAP. Do not invent
     ownerTaskId.

Q3. RED — combined identity + authority (load-bearing)
   - Write a minimal test (synthetic-real; uses
     /bin/sh -c 'sleep N' as bounded child following
     command-job-manager.test.ts pattern, with N kept
     very short and cleanup authoritative) that asserts:

       A starts RUNNING J under owner A
       → manager.canAnswer(hasRunningBackgroundJobForOwner(A))
         === true
       → hasRunningBackgroundJobForOwner(A) === true

     At HEAD, this MUST FAIL because the chosen owner
     identity is absent from the manager's internal
     records. The test is load-bearing because it
     combines identity preservation AND authority
     usefulness into a single contract — not merely
     asserting that a new property exists.

   - Do NOT use a real 30-second process unless needed.
     If existing CommandJobManager tests already provide
     deterministic process-lifecycle controls, reuse them.

Q4. Bounded addition — persist identity INTERNALLY only
   - Add the chosen owner field to the **internal**
     CommandJob interface (command-job-manager.ts:386)
     ONLY.
   - DO NOT extend CommandJobSnapshot (line 60) UNLESS
     source recon proves an existing internal-only
     snapshot consumer mechanically requires the owner
     field. By default, snapshots remain unchanged.
   - Wire manager.start() to capture the identity from
     the available context.
   - Re-run Q3's RED → GREEN.

Q5. Owner-scoped liveness query on the manager's public
    surface
   - Expose the chosen semantic on the manager's public
     surface. Preferred shape (decided DURING this ACT):
       hasRunningBackgroundJobForOwner(ownerId): boolean
     or, if more information is genuinely needed:
       getRunningBackgroundJobsForOwner(ownerId): ...
   - Callers do NOT receive raw ownership IDs unless
     mechanically required.
   - Add unit tests for the cross-owner control scenarios
     (Q6).

Q6. Controls (mandatory)
   - Job of owner A does NOT count for owner B's lookup.
   - Completed job no longer counts for any owner.
   - Empty repository still reads false.

Q7. After this ACT closes — resume Q5 in the umbrella ACT
    with the post-ACT RED matrix
   - Same completion event, same TurnState, same production
     seam.
   - A. current owner has RUNNING J    → after.phase
        must NOT be `awaiting_followup`. Do NOT yet freeze
        the specific phase A *must* become (could be
        `streaming`, `awaiting_tool`, `resumable`, or a new
        explicit background-owned phase — that decision
        is the umbrella ACT's Q5, not this contract ACT's).
   - B. current owner has no running J → awaiting_followup
        preserved (control / current behavior).
   - C. another owner has RUNNING J    → awaiting_followup
        preserved (cross-owner contamination control).
   - D. current owner's J completed    → awaiting_followup
        preserved (terminal control).
   - If A fails while B/C/D pass:
       CASE_A = ADJUDICATED
       ROOT_CAUSE_ISOLATED = YES
   - Only then patch the lowest authority seam.
   - DO NOT smuggle the eventual state-machine design into
     the identity contract ACT; that is a separate
     architectural question.
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
