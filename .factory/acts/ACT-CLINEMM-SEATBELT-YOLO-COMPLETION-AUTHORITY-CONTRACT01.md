# ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-CONTRACT01

> Status: **NEXT / HIGH** — opens immediately after `ACT-CLINEMM-COMPLETION-PROTOCOL-LIVENESS02`
> closes. Pure product-policy decision ACT; no production code yet.
>
> **Predecessor**: `ACT-CLINEMM-COMPLETION-PROTOCOL-LIVENESS02` at the closure commit
> (which see for the bound specimen `1787832864738_ik2zh`, the two-prerequisite
> predicate, the retracted `PROMPT_VS_RUNTIME_MISMATCH` claim, and the durable
> transcript + composition evidence).
>
> **Verdict (target)**: `SEATBELT_YOLO_REQUIRES_EXPLICIT_COMPLETION_AUTHORITY` = `YES` | `NO`
> (no fuzzy compromise)

## 0. Mission

Resolve a single product-policy question that the LIVENESS02 recon
surfaced but did not answer:

```text
When ClineMM's effective host authorization is Seatbelted YOLO in
interactive VS Code (every tool auto-approved under the Seatbelt
confinement), must the agent also have explicit completion authority —
i.e., BOTH registration prerequisites satisfied
  (enableSubmitAndExit=true AND toolExecutors.submit present)
— even though conversational mode remains "act"?
```

This is a **product-contract ACT**. No production code lands in this
ACT. The decision determines what the downstream implementation ACT
(if any) must do.

## 1. Why this ACT is real and not upstream-inherited

Upstream makes the concepts independently configurable, so this is a
real ClineMM product choice rather than an upstream invariant we
should blindly copy:

```text
upstream auto-approval (Seatbelt/approval policy)
   ≠
upstream --yolo (core runtime yolo preset)

upstream CLI --yolo:
  - adds submit_and_exit (ToolPresets.yolo.enableSubmitAndExit=true)
  - changes spawn/teams defaults
  - supplies toolExecutors.submit via run-agent.ts

upstream VS Code Cline:
  - has YOLO toggle (UI)
  - never flips config.mode to "yolo"
  - never wires toolExecutors.submit
```

The bound LIVENESS02 specimen occupies a state where:

```text
USER_FACING_SEATBELT_YOLO         = true      (autoApprovalSettings.actions.* all true)
CORE config.mode                 = "act"     (NOT "yolo")
PROMPT variant                   = DEFAULT
resolved enableSubmitAndExit     = false     (ToolPresets.act)
VS Code toolExecutors.submit     = absent    (vscode-session-host.ts:159-186)
SUBMIT_AND_EXIT_REGISTERED       = COMPOSITION_PROVEN_FALSE
PROMPT_TOOLSET_CONTRADICTION     = NONE      (agent not asked to call non-existent tool)
PRODUCT_COMPLETION_SEMANTICS     = UNDECIDED (the live question)
```

So the question is precisely framed: **given** Seatbelt-YOLO + mode=act
+ DEFAULT prompt + absent submit_and_exit, **is** the user-facing
behavior a defect, and if so, which layer should fix it?

## 2. Phase 0 — frozen invariants (decide semantics first)

No production code yet. These invariants must hold under whatever
product decision is made. If any cannot hold, the decision is wrong.

```text
I1. "Completed" means authoritative completion, never prose inference.
    (LIVENESS02/LIV2-C01..C03 + completion-framing lineage)

I2. Seatbelt/approval policy must remain orthogonal to conversational
    Plan/Act semantics unless explicitly chosen otherwise.
    (Preserve the LIVENESS02 §10b.2 decoupling finding.)

I3. Adding completion authority must not silently import the entire
    core yolo preset (no flip of config.mode; no spawn/teams
    side-effects).

I4. Failed/partial submit_and_exit must never produce Completed.
    (A failed submit cannot look like a successful one.)

I5. Explicit completing tool must not create an infinite reminder loop.
    (User must be able to dismiss or extend; not nag.)

I6. Non-autonomous/manual Act mode must retain a sensible follow-up
    path. (awaiting_followup / ask_question path remains valid.)

I7. SDK/CLI consumers that intentionally don't expose a completing
    tool must remain supported.
    (CLI host currently supplies submit; SDK/Hub variants may not.
    Do not assume universal submit_and_exit presence.)
```

Any ACT that violates I1..I7 must halt and re-derive its decision.

## 3. The frozen alternatives

### Option A — explicit completion authority for Seatbelt-YOLO

```text
Seatbelt-YOLO
  + conversational mode remains "act"
  + resolved enableSubmitAndExit=true
  + VS Code supplies submit executor
  → submit_and_exit registered
  → completesRun=true
  → requireCompletionTool=true
```

**Do not** switch the whole runtime to core `mode="yolo"` merely to
acquire the tool. The yolo preset changes additional behavior
(spawn/teams defaults etc.) per the LIVENESS02 §10b.1 evidence.
This is the **narrow overlay**.

### Option B — retain ordinary text completion

```text
mode=act
DEFAULT prompt
no submit_and_exit
ordinary text termination accepted
runtimeStatus=completed
turnState=awaiting_followup
```

The product must then explicitly accept that a finished autonomous
task may remain visually in **Waiting** and have no authoritative
task-completion result. That is the LIVENESS02-bound specimen's
current behavior. Any desire to display a clearer terminal label
belongs to a separate presentation ACT.

### Option C — decouple completion authority from Seatbelt-YOLO

Potentially the strongest design:

```text
explicitCompletionAuthority
```

becomes its own runtime/product capability rather than being inferred
from either:

```text
auto-approval (Seatbelt)
core yolo preset
```

Then Seatbelt-YOLO may choose to turn it on by default, but the
concepts are no longer welded together. Both A and B remain valid
policy choices within this architecture, and the user can configure
them independently.

## 4. Required product decision

```text
SEATBELT_YOLO_REQUIRES_EXPLICIT_COMPLETION_AUTHORITY = YES | NO
```

No fuzzy compromise. The decision may be implemented as either Option A
or Option C (which embeds Option A as a default but exposes it
independently); Option B is only valid if the answer is `NO`.

## 5. If YES

Open:

```text
ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01
```

The implementation ACT's RED should exercise the **real VS Code
runtime-builder seam**:

```text
Given:
  interactive VS Code
  mode=act
  Seatbelt-YOLO effective

Expected:
  submit_and_exit registered
  lifecycle.completesRun=true
  completionPolicy.requireCompletionTool=true

Current (LIVENESS02 binding):
  submit_and_exit absent
  completionPolicy undefined
```

One-variable necessity/ablation then becomes meaningful.
## 6. If NO

Close this contract ACT with:

```text
PASS_CURRENT_COMPLETION_POLICY_INTENTIONAL
```

and do NOT mutate the framing to fake completion. The screenshot
behavior is then expected UX. Any desire to replace `Waiting` with a
clearer terminal label belongs to a separate presentation ACT.

## 7. Quality gates (this ACT)

This ACT makes a decision; no production code lands, so:

```text
PRODUCTION_DELTA       = 0
TEST_DELTA             = 0
DECISION_DELTA         = 1 (the YES/NO answer)
DOCS_DELTA             = closure ledger row + this ACT's closure commit
```

Gates:

| Gate                | Status     | Evidence                                            |
|---------------------|------------|-----------------------------------------------------|
| Invariants I1..I7   | PASS       | all seven frozen in §2 and re-checked at decision    |
| Yes/No decision     | REQUIRED   | no fuzzy compromise                                 |
| Quality-of-decision | EVALUATED  | explicit trade-offs documented                       |
| Provenance          | PASS       | LIVENESS02 closure + this ACT's commit               |
| Board sync          | REQUIRED   | runtime-task-progression.md + epic-board.md updated |

## 8. Stop conditions

```text
1. The ACT attempts to flip config.mode to "yolo" (violates I3).
2. The decision is fuzzy / on-the-fence / "we'll figure it out later"
   (the contract ACT exists precisely to force a yes/no).
3. The ACT produces production code (this is a contract ACT, not an
   implementation ACT).
4. A new RED defect appears in LIVENESS02 evidence (revert to
   LIVENESS02 recon before closing).
5. The product decision would silently break SDK/CLI consumers
   (violates I7).
```
## 9. Acceptance criteria

```text
[ ] Invariants I1..I7 explicitly re-checked at decision time.
[ ] One of YES / NO chosen, with explicit trade-off documentation.
[ ] No production code lands in this ACT.
[ ] If YES: implementation ACT (ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01)
      opened with RED at the real VS Code runtime-builder seam.
[ ] If NO: closure verdict `PASS_CURRENT_COMPLETION_POLICY_INTENTIONAL`
      lands with board updates; LIVENESS02-bound specimen behavior
      remains expected UX.
[ ] Board state (runtime-task-progression.md + epic-board.md) updated
      to reflect closure and any follow-on ACT.
[ ] git diff --check passes.
[ ] EDITOR-TOOL-APPROVAL-FRICTION-RECON01 resumes NEXT status after
      this ACT's closure cycle completes (per the LIVENESS02 one-ACT
      preemption rule).
```

## 10. Provenance

```text
Predecessor: ACT-CLINEMM-COMPLETION-PROTOCOL-LIVENESS02 (CLOSED,
  PASS_COMPLETION_LIVENESS_RECON_POLICY_DECISION_REQUIRED)
Bound specimen: 1787832864738_ik2zh (interactive VS Code ClineMM
  with Seatbelt-YOLO + mode=act + DEFAULT prompt)
Reviewer evidence classes (§3c corrections):
  SUBMIT_AND_EXIT_INVOKED    = TRANSCRIPT_PROVEN_FALSE
  SUBMIT_AND_EXIT_REGISTERED = COMPOSITION_PROVEN_FALSE
  PROMPT_TOOLSET_CONTRADICTION = NONE
  PRODUCT_COMPLETION_SEMANTICS = UNDECIDED
Upstream references:
  - apps/cli/README.md (CLI --yolo semantics, distinct from approval)
  - apps/cli/src/runtime/run-agent.ts (CLI supplies toolExecutors.submit)
  - sdk/packages/shared/src/prompt/system.ts (DEFAULT vs YOLO prompt)
  - sdk/packages/core/src/extensions/tools/presets.ts (act vs yolo preset)
  - sdk/packages/core/src/extensions/tools/definitions.ts:1148
      (registration predicate submitExecutor = enableSubmitAndExit
       ? executors.submit : undefined)
Owning epic: EPIC-CLINEMM-RUNTIME-TASK-PROGRESSION01
Companion: ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01 (NEXT)
```

## 11. After closure

```text
If YES:
  → ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01
    (RED at the real VS Code runtime-builder seam; minimal overlay;
     does not flip config.mode; preserves I1..I7)

If NO:
  → no implementation ACT; LIVENESS02-bound behavior remains expected UX
  → any "make Waiting clearer" UX work goes to a separate presentation ACT
  → EDITOR-TOOL-APPROVAL-FRICTION-RECON01 resumes NEXT status
```

## 12. Decision (executed)

```text
SEATBELT_YOLO_REQUIRES_EXPLICIT_COMPLETION_AUTHORITY = YES

ARCHITECTURAL_FORM =
  INDEPENDENT_EXPLICIT_COMPLETION_AUTHORITY_CAPABILITY
  (Option C with YES default)

DEFAULT_POLICY =
  Seatbelt-YOLO interactive VS Code → explicitCompletionAuthority = ON
  ordinary manual Act             → explicitCompletionAuthority = OFF (unchanged)
  Plan mode                       → unchanged
  core mode                       → remains "act" (no flip to "yolo")

VERDICT = PASS_SEATBELT_YOLO_REQUIRES_EXPLICIT_COMPLETION_AUTHORITY_OPTION_C
```

### Decision rationale (bound to I1..I7)

```text
I1 "Completed" means authoritative completion, never prose inference
   → YES gives us authoritative submit_and_exit; option C keeps the
     capability orthogonal to prose inference.

I2 Seatbelt/approval policy remains orthogonal to conversational
   Plan/Act semantics
   → YES via Option C keeps the Seatbelt-YOLO toggle AND
     explicitCompletionAuthority as separate axes; Plan/Act mode
     is not modified.

I3 No silent import of the entire core yolo preset
   → YES via Option C does NOT flip config.mode to "yolo"; no
     spawn/teams side-effects inherit.

I4 Failed/partial submit_and_exit must never produce Completed
   → implementation ACT will enforce this explicitly.

I5 No infinite reminder loop
   → implementation ACT will bound the reminder; user can dismiss
     or extend.

I6 Non-autonomous/manual Act retains a sensible follow-up path
   → YES only flips explicitCompletionAuthority under Seatbelt-YOLO;
     manual Act path is unchanged.

I7 SDK/CLI consumers that intentionally don't expose a completing
   tool remain supported
   → Option C is a CAPABILITY, not a requirement; SDK/CLI hosts that
     don't supply toolExecutors.submit continue to work (the capability
     simply defaults to OFF on those hosts).
```

### Why Option C over Option A

```text
Option A hard-codes "Seatbelt-YOLO → submit_and_exit"
  - simple, but couples approval policy and completion authority
  - any future completion-policy change requires re-deriving the
    approval-policy decision

Option C (chosen):
  - explicitCompletionAuthority is its own runtime/product capability
  - Seatbelt-YOLO can opt to default it ON
  - the two axes remain independently configurable
  - preserves both yes/no as policy choices within the architecture
  - users can configure independently
```

### Forward path

```text
ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01 opens next.

RED boundary (per reviewer recommendation):
  Given:
    interactive VS Code
    mode="act"
    Seatbelt-YOLO effective
    explicitCompletionAuthority=true

  Expected:
    resolved enableSubmitAndExit=true
    toolExecutors.submit present
    submit_and_exit registered
    lifecycle.completesRun=true
    completionPolicy.requireCompletionTool=true

  Current:
    enableSubmitAndExit=false
    submit executor absent
    submit_and_exit absent
    completionPolicy undefined

Conservation (mandatory):
  manual Act + completionAuthority off → historical behavior unchanged
  Plan mode                            → unchanged
  SDK host without submit executor     → supported
  explicit submit success              → task completes exactly once
  partial/failed submit                → never Completed
  plain final text while authority required
                                        → bounded reminder, no premature
                                          task completion
  follow-up / ask_question             → remains valid
  spawn/team routing                   → unchanged
  no config.mode="yolo" transition     → enforced

After IMPLEMENTATION01 closes:
  EDITOR-TOOL-APPROVAL-FRICTION-RECON01 resumes NEXT status.
```