# ACT-CLINEMM-COMPLETION-PROTOCOL-LIVENESS02

> Status: **OPEN / ACTIVE_RECON** — launched at HEAD `35f27e4d720c5e08ef33a4cb24afb87bb4df5a31`.
> The reopen trigger has fired: a bound LIVE specimen (`1787832864738_ik2zh`,
> 64 captured state-pushes, `attemptCompletionSeen=false`,
> `terminalResponseCommittedThisTurn=false`, `runtimeStatus: running → completed`
> transition at sv=8299) is now durable and SHA-256-bound at
> `.factory/evidence/ACT-CLINEMM-COMPLETION-PROTOCOL-LIVENESS02/`.
> Recon + bounded RED + causal discriminator. No production repair until one
> RED branch is proven and the causal variable is isolated.
> Preempts `ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01` for exactly one
> bounded cycle (per reviewer instruction); that ACT resumes `NEXT` once a
> causal disposition is reached.
> Owned by `EPIC-CLINEMM-COMPLETION-PROTOCOL-LIVENESS02` (reopens the deferred
> LIVENESS02 row in `.factory/epics/runtime-task-progression.md`).

## 0. Frozen starting evidence (BOUND)

The bound specimen was captured by `CLINEMM_PTAD=1` dogfood and dumped to
two JSONL files. SHA-256 bindings below prevent silent drift; re-run on
evidence access to verify.

```text
BOUND_TASK_ID                      = 1787832864738_ik2zh
BOUND_EPOCH                        = 5
TERMINAL_PUSH                      = 8299
FOLLOWING_PUSH                     = 8300
CAPTURE_WINDOW                     = sv=7933..8300   (extension: 64 records)
                                   = sv=8254..8300   (webview:   64 records)

TOOL_CALLS                         = 183    (frozen across the entire capture window)
  edit                             = 43
  command                          = 101
  read                             = 34
  search                           = 0
  mcp                              = 0
  other                            = 5

RUNTIME_STATUS_TRANSITION          = running   → completed    (at sv=8299, +141ms)
SHADOW_STATUS_TRANSITION           = running   → completed    (at sv=8299, +141ms)
LEGACY_PHASE_TRANSITION            = streaming → awaiting_followup   (at sv=8299, +141ms)
TASK_HEADER_PRESENTATION_TRANSITION = {phase:streaming, source:shadow, seq:5849}
                                     → {phase:awaiting_followup, source:host, seq:8298}
THINKING_PRESENTATION_TRANSITION   = {modelStreaming:true,  source:shadow, seq:5849}
                                     → {modelStreaming:false, source:shadow, seq:8298}

attemptCompletionSeen              = false    (across all 64 captured extension-push records)
terminalResponseCommittedThisTurn  = false    (across all 64 captured extension-push records)
```

**Smoking gun**: the canonical `runtimeStatus` and `shadowStatus` both flip
to `completed` at sv=8299, yet the live capture directly proves:

```text
LIVE (from PTAD):
  attemptCompletionSeen              = false   (all 64 extension-push records)
  terminalResponseCommittedThisTurn  = false   (all 64 extension-push records)
```

Composed with the source contract documented at
`apps/vscode/src/sdk/message-translator.ts:343-352, 1631-1650, 1929-1943`,
this means **the canonical completion protocol was neither entered nor
committed during this run**. We do NOT, from the LIVE capture alone,
establish whether `submit_and_exit` / `attempt_completion` was absent,
present-but-unused, or present-and-unused — that is what §3 discriminates.

The host's `taskHeaderPresentation` projection then derives
`phase=awaiting_followup` from the legacy turnState (the
stale-`awaiting_followup` chain that suppresses the `✓ Completed` badge
downstream — see `docs/architecture/elm/completion-framing-live-red-discriminator01.md`
for the projection chain).

**Load-bearing conclusion at this ACT's launch** (only):

```text
COMPLETION_PROTOCOL_WAS_NEVER_ENTERED
```

We do NOT yet infer why. That is the rest of this ACT.

Evidence files (gitignored, local-only at ACT launch; will be committed
with the closure if causal disposition is reached):

```text
.factory/evidence/ACT-CLINEMM-COMPLETION-PROTOCOL-LIVENESS02/ptad-extension.jsonl
  SHA-256 = b4f12fcc9d2e0cd3a71e625086eaeb0b8e8378038384e60cf8cbddbff7d1ab29
  size    = 56425 bytes
  records = 64
  source  = ~/.cline2/data/post-terminal-authority-diagnostic-extension.jsonl

.factory/evidence/ACT-CLINEMM-COMPLETION-PROTOCOL-LIVENESS02/ptad-webview.jsonl
  SHA-256 = b1190ae41c63087742aa64e9157433f7bfc0d0ccf272ac5b6e8537aa34e3b5b5
  size    = 51900 bytes
  records = 64
  source  = ~/.cline2/data/post-terminal-authority-diagnostic-webview.jsonl
```

Prior durable record (`docs/architecture/elm/completion-protocol-liveness02-phase0-capture01.md`,
committed `aac6c6986`) reported `SCREENSHOT_TO_SESSION_BINDING = NOT_PROVEN`
against candidate session `1787562381026_jao7c`. This ACT is the
**superseding bound specimen** — a different session
(`1787832864738_ik2zh`) captured later under `CLINEMM_PTAD=1` opt-in.
The `NOT_PROVEN` verdict on the prior candidate is not retracted; it is
simply resolved by the present specimen.

## 1. The causal question

Discriminate:

```text
A. COMPLETION_TOOL_ABSENT
   submit_and_exit / attempt_completion was not registered for this run
   (Branch A hypothesis: enableSubmitAndExit=false or executor omitted).

B. COMPLETION_TOOL_PRESENT_BUT_NOT_REQUIRED
   tool existed, but completionPolicy.requireCompletionTool !== true,
   so ordinary model termination was accepted.

C. COMPLETION_TOOL_PRESENT_AND_REQUIRED_BUT_ENFORCEMENT_ESCAPED
   reminder/enforcement path should have prevented termination, but did not.

D. COMPLETION_TOOL_PRESENT_NOT_CALLED_MODEL_BEHAVIOR
   policy intentionally permits ordinary termination and the model simply
   chose not to invoke the completion tool.

E. CAPTURE_INSUFFICIENT
   required runtime facts cannot be bound to the specimen.
```

A–D are materially different repairs. E is the trap the prior
phase-0 capture fell into; this specimen is designed to close E.

## 2. Recon before design

Inspect the actual current sources for the seams in the reviewer's
spec:

```text
sdk/packages/core/src/runtime/orchestration/runtime-builder.ts
  finalTools                                       (line 706)
  filterAvailableTools                             (lines 87-92)
  requiresCompletionTool derivation                (lines 707-711)
  completionPolicy build                           (lines 744-753)
  teamCompletionGuard                              (lines 712-743)

sdk/packages/core/src/extensions/tools/definitions.ts
  createSubmitAndExitTool                          (lines 1021-1051)
  submit_and_exit registration conditional         (lines 1148, 1155-1158)

sdk/packages/core/src/extensions/tools/types.ts
  lifecycle.completesRun schema

sdk/packages/core/src/types/session.ts
  completionPolicy.requireCompletionTool type

apps/vscode/src/sdk/message-translator.ts
  attemptCompletionSeen flag                        (lines 343-352)
  wasTerminalResponseCommittedThisTurn              (line 365)
  attemptCompletionSeen reset on clearTurnOutcome   (line 543)
  completion-tool handling at content_end           (lines 1631-1650, 1929-1943)

apps/vscode/src/sdk/sdk-session-event-coordinator.ts
  turn-phase promotion rules
  refusal to promote to "completed" without committed terminal response
```

For every edge record:

```text
SOURCE
FUNCTION
INPUT
OUTPUT
AUTHORITY
OBSERVABILITY
```

### Stop rule

```text
HALT_SEAM_MOVED
```

if current production no longer follows this shape.

## 3. First discriminator: tool registration

Before touching runtime policy, reproduce the specimen configuration
as closely as possible and capture the **actual registered tool set**.

Required facts (read production seam; no inference from task complexity):

```text
SUBMIT_AND_EXIT_REGISTERED
SUBMIT_AND_EXIT_ENABLED
SUBMIT_AND_EXIT_LIFECYCLE_COMPLETES_RUN
ATTEMPT_COMPLETION_REGISTERED   (legacy alias path; definitions.ts:1148)
TEAM_MODE
PROVIDER
MODEL
INPUT.toolPolicies
config.toolPolicies
```

The previous mistake was essentially:

```text
"simple shell task"
→ probably no completion tool
```

That is forbidden. Reproduce the runtime-builder seam with the SAME
inputs the production run used, then read what it actually emitted.

### Desired evidence

Prefer an existing runtime-builder test seam (`sdk/packages/core/src/runtime/orchestration/runtime-builder.test.ts`)
or an existing debug snapshot.

If no safe observable seam exists:

```text
LIVE_UNOBSERVABLE
```

then add the smallest DEFAULT_OFF diagnostic **only if necessary**.
Do not expand PTAD automatically just because it exists.

## 4. Second discriminator: completion policy

Capture the actual value produced by runtime construction
(`runtime-builder.ts:744-753`):

```text
completionPolicy.requireCompletionTool     (boolean | undefined)
completionPolicy.completionGuard           (function | undefined)
teamCompletionGuard                        (function | undefined)
```

Classification:

| Tool registered | requireCompletionTool | Meaning                           |
| --------------- | --------------------: | --------------------------------- |
| no              |       false/undefined | Branch A                          |
| yes             |       false/undefined | Branch B/D                        |
| yes             |                  true | Candidate Branch C                |
| no              |                  true | Configuration invariant violation |

If the last row exists:

```text
HALT_COMPLETION_POLICY_REGISTRY_CONTRADICTION
```

### Strong hypothesis (not verdict)

**No strong hypothesis.** Branches A and B are *a priori* not
discriminable from the LIVE capture alone — §3 must classify the actual
registered tool set and the actual `completionPolicy.requireCompletionTool`
value at the real builder→agent boundary before any causal direction is
named. Naming a strong hypothesis now would pre-classify cause in
violation of §3's discipline.

The reviewer-correct discriminator sequence is therefore:

```text
§3  registered?       → yes / no      → A vs. not-A
§4  required?         → true / false  → B/C/D vs. not-B/C/D
```

Both cheap. Both at the real production seam. Do NOT skip to §5
(`MODEL_FINISH_REASON` etc.) unless §3 and §4 both return `YES / YES`
(registered and required), in which case the `YES/YES` configuration
contradicts the LIVE `false / false` capture and Branch C (enforcement
escape) becomes the only live branch.

This is the upstream architectural pattern
(see `cline/docs/sdk/tools.mdx` — `submit_and_exit` is the canonical
"final-answer-and-stop" tool, while CLI `--yolo` separately enables it
per `apps/cli/README.md`; VS Code ClineMM interactive registration is
the open question).

## 5. Third discriminator: model termination path

For the `false/false` branch capture:

```text
MODEL_FINISH_REASON
COMPLETION_REMINDER_EMITTED
COMPLETION_REMINDER_COUNT
RUNTIME_ACCEPTED_NORMAL_FINISH
DONE_REASON
TASK_COMPLETED_SOURCE
```

Do not conflate:

```text
runtime done(reason="completed")
```

with:

```text
canonical completion response committed
```

Our whole PTAD chain exists because they are different.
The specimen confirms this — `runtimeStatus=completed` at sv=8299 yet
`terminalResponseCommittedThisTurn=false` across all 64 captures.

## 6. RED branches

Write RED **only after** one branch is proven.

### RED-A — completion tool registration defect

If the runtime configuration should expose a completing tool but doesn't:

```text
given normal ClineMM interactive session
when finalTools are built
then at least one enabled tool has:
  lifecycle.completesRun === true
```

Exercise the real runtime-builder seam
(`sdk/packages/core/src/runtime/orchestration/runtime-builder.test.ts`
or a new bounded test under `apps/vscode/src/sdk/__tests__/completion-protocol-liveness02/`).

### RED-B — policy derivation defect

If `submit_and_exit` exists and `completesRun=true` but:

```text
requireCompletionTool = false
```

RED:

```text
EXPECTED = true
ACTUAL   = false
```

at the real builder → agent configuration boundary.

### RED-C — enforcement escape

If:

```text
tool registered = true
requireCompletionTool = true
```

yet ordinary model termination escapes without completion:

drive the real agent runtime:

```text
model emits final-looking ordinary text
model indicates end of turn
no completesRun tool call
```

Expected:

```text
runtime MUST NOT finalize the run yet
runtime issues bounded completion reminder/retry
```

Actual:

```text
runtime terminates
```

### RED-D — intentional policy

If the configured policy explicitly permits non-tool termination:

```text
NOT_A_BUG_YET
```

Then the product question becomes:

> Should interactive ClineMM require explicit completion authority?

That becomes a separate contract decision, not a disguised bug fix.

## 7. Necessity / ablation

Whatever variable becomes causal must flip the RED.

Examples:

### If `requireCompletionTool` is causal

```text
false → model may finish without completion
true  → reminder/enforcement prevents finish
```

Same model fixture, same tool registry.

### If registration is causal

```text
submit_and_exit absent  → false/false termination possible
submit_and_exit present → explicit completing path becomes available/required
```

Do not change multiple axes at once.

## 8. Bounded repair rules

### Branch A repair

Fix the tool registration / config assembly only. Do not modify framing
or session coordinator.

### Branch B repair

Set/derive `requireCompletionTool` at the narrow runtime-builder seam,
only for the intended interactive session class. Do NOT globally force
it on SDK consumers unless their contract demands it.

### Branch C repair

Fix the reminder/enforcement escape in `agent-runtime`. Preserve bounded
retry behavior; no infinite completion loop.

### Branch D

No repair without an explicit product-contract ACT.

## 9. Conservation tests

Mandatory (LIV2-C01..C10):

```text
LIV2-C01  explicit submit_and_exit still completes exactly once
LIV2-C02  completion tool failure does not falsely mark completion
LIV2-C03  partial/incomplete completion tool call does not mark completion
LIV2-C04  user-owned awaiting_followup remains valid where completion
          genuinely was not required
LIV2-C05  SDK consumers that intentionally omit completesRun tools remain valid
LIV2-C06  teams / completionGuard behavior unchanged unless proven causal
LIV2-C07  no text-derived completion_result synthesis
LIV2-C08  no last-message/tail-derived completion authority
LIV2-C09  task.completed emitted at most once
LIV2-C10  resume behavior unchanged
```

The last-message/text prohibitions are non-negotiable because previous
CRA work deliberately removed that fallback
(`ACT-CLINEMM-COMPLETION-RESPONSE-AUTHORITY01-CORRECTION01`,
commits `0a3f70ae2` + `d521b2df1`).

## 10. Diagnostic discipline

Keep:

```text
CLINEMM_PTAD=1
```

during dogfood. PTAD is evidence infrastructure, not the repair.

Do not permanently add:

```text
modelFinishReason
doneReason
requireCompletionTool
toolRegistry
```

to PTAD unless the present ACT proves one is necessary and existing
test seams cannot discriminate it.

Removal rule remains first of:

```text
root cause isolated
capture insufficient
successor evidence supersedes PTAD
```

## 11. Gates

```text
BOUND_LIVE_SPECIMEN                    PASS    (this ACT §0 — 1787832864738_ik2zh)
PTAD_CAUSAL_BRANCH                     PASS    (terminal-push sv=8299, false/false)

COMPLETION_TOOL_REGISTRY_CLASSIFIED    TBD     (§3 deliverable)
COMPLETION_POLICY_CLASSIFIED           TBD     (§4 deliverable)
MODEL_TERMINATION_PATH_CLASSIFIED      TBD     (§5 deliverable)

RED_REAL_PRODUCTION_SEAM               TBD     (§6 deliverable)
CAUSAL_VARIABLE_DISCRIMINATED          TBD     (§7 deliverable)
NECESSITY_ABLATION                     TBD     (§7 deliverable)

NO_TEXT_DERIVED_COMPLETION             TBD     (LIV2-C07)
NO_TAIL_DERIVED_COMPLETION             TBD     (LIV2-C08)
EXPLICIT_COMPLETION_CONSERVED          TBD     (LIV2-C01..C03)
FAILED_COMPLETION_CONSERVED            TBD     (LIV2-C02)
RESUME_CONSERVED                       TBD     (LIV2-C10)
SDK_CONSUMER_CONSERVATION              TBD     (LIV2-C05)

targeted tests                         TBD
check-types                            TBD
lint                                   TBD
test:unit                              TBD / baseline classified
git diff --check                       TBD
board validator                        TBD / BASELINE_FAIL_UNCHANGED
```

## 12. Stop rules

```text
HALT_RED_NOT_REPRODUCED
HALT_SEAM_MOVED
CAPTURE_INSUFFICIENT
HALT_COMPLETION_POLICY_REGISTRY_CONTRADICTION
HALT_LEADING_HYPOTHESIS_REPAIR
HALT_TEXT_DERIVED_COMPLETION_REGRESSION
HALT_TAIL_DERIVED_COMPLETION_REGRESSION
HALT_SDK_CONSUMER_SCOPE_CREEP
HALT_UNBOUNDED_COMPLETION_RETRY
```

Only a new P0 stops the chain.

## 13. Legitimate exits

```text
PASS_COMPLETION_TOOL_REGISTRATION_REPAIR_V1
```

or:

```text
PASS_COMPLETION_POLICY_ENFORCEMENT_REPAIR_V1
```

or:

```text
PASS_COMPLETION_RUNTIME_ENFORCEMENT_REPAIR_V1
```

or:

```text
NOT_A_BUG_POLICY_DECISION_REQUIRED
```

or:

```text
CAPTURE_INSUFFICIENT
```

Never:

```text
"make the green Completed badge appear"
```

as an acceptance criterion by itself. The badge is downstream evidence,
not the authority.

## 14. Live qualification

After GREEN, build exact-head VSIX and bind:

```text
SOURCE_HEAD
SOURCE_TREE
VERSION
VSIX_PATH
VSIX_BYTES
VSIX_SHA256
INSTALLED_VERSION
```

Run a real task that naturally ends.

Expected successful path:

```text
attemptCompletionSeen                 = true
terminalResponseCommittedThisTurn     = true
runtimeStatus                         = completed
turnState.phase                       = completed
canonical completion_result exists
Completed framing visible
```

Negative task: force/induce completion-tool failure.

Expected:

```text
NO false Completed framing
```

## 15. Board sequencing

After committing `PTAD-ENV-OPTIN01`:

```text
PTAD-DORMANT-DIAGNOSTIC-SUBSTRATE  CLOSED
PTAD-ENV-OPTIN01                   CLOSED
COMPLETION-PROTOCOL-LIVENESS02     OPEN / ACTIVE_RECON
EDITOR-TOOL-APPROVAL-FRICTION      OPEN / HIGH (queued behind LIVENESS02)
```

This is a deliberate one-ACT preemption because we now possess rare
bound LIVE evidence for completion liveness.

Once LIVENESS02 reaches a causal disposition:

```text
EDITOR-TOOL-APPROVAL-FRICTION-RECON01
→ NEXT again
```

## 16. Provenance

Reviewer: factory reviewer · ClineMM runtime/diagnostics engineer
ACT spec source: factory review of `ACT-CLINEMM-PTAD-ENV-OPTIN01` closure
Bound specimen source: `.factory/evidence/ACT-CLINEMM-COMPLETION-PROTOCOL-LIVENESS02/`
Supersedes: `docs/architecture/elm/completion-protocol-liveness02-phase0-capture01.md`
NOT_PROVEN verdict (different session `1787562381026_jao7c`; not retracted,
just resolved by this specimen)
Companion: `docs/architecture/elm/completion-framing-live-red-discriminator01.md`
Owning epic: `EPIC-CLINEMM-RUNTIME-TASK-PROGRESSION01`
(see `.factory/epics/runtime-task-progression.md` for in-flight state)
