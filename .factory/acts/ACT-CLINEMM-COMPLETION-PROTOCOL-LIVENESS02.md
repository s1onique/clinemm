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

## 10a. §3 outcome — DEPRECATED by §10b

> The §3 outcome originally recorded at this location asserted "Branch A
> PROVEN, single-variable chain" with `config.mode = "act"` labelled
> "matches specimen". The factory reviewer correctly identified two
> load-bearing evidence gaps: (1) the bound specimen's runtime-builder
> inputs were inferred from defaults rather than read from durable
> state, and (2) `YOLO_EFFECTIVE = false` conflated two distinct domains
> (user-facing Seatbelt-YOLO host authorization vs. core-runtime `yolo`
> tool preset). The reviewer also flagged `NECESSITY_ABLATION = PASS`
> as unjustified without a one-variable flip.
>
> The full §3 outcome is **superseded by §10b** at this ACT's current
> version. The §10a text is preserved below for the audit trail but
> should be treated as **deprecated evidence**; do not cite §10a's
> "Branch A PROVEN" claim in any subsequent ACT.

### 10a.0 Provenance deprecation notice

```text
§10a verdict (DEPRECATED):  Branch A PROVEN
§10b verdict (CURRENT):     Branch A STRONGLY_SUPPORTED
                            enableSubmitAndExit = CANDIDATE_CAUSAL_VARIABLE
                            Contract tension (prompt vs runtime wiring) SURFACED
                            NECESSITY_ABLATION = NOT_EXECUTED (corrected from PASS)
```

The §10a text that follows is preserved verbatim for the audit trail
but should NOT be cited as the ACT's current position.

---

### 10a.ORIGINAL_VERBATIM — preserved for audit (do not cite)

Discriminator executed against the real production seam on commit
`35f27e4d7`. Bound-specimen relevance: `1787832864738_ik2zh` ran in
interactive Act mode (`mode: "act"`, default).

### 10a.1 Frozen runtime-builder inputs (matches specimen)

```text
config.mode                 = "act"
config.toolPolicies         = (none; default empty)
toolExecutors.submit        = (not provided — no submitAndExit executor)
TEAM_MODE                   = false (no teamName)
YOLO_EFFECTIVE              = false
VS_CODE_INTERACTIVE         = true
providerId                  = (session-dependent; not causal here)
modelId                     = (session-dependent; not causal here)
```

### 10a.2 Frozen registered tool set

Path: `ToolPresets[resolveToolPresetName({ mode: "act" })]` →
`ToolPresets.act` → `createDefaultTools({ ...act, ...overrides })`.

From `sdk/packages/core/src/extensions/tools/presets.ts:18-39`:

```text
act = {
  enableReadFiles       = true
  enableSearch          = true
  enableBash            = true
  enableWebFetch        = true
  enableApplyPatch      = false
  enableEditor          = true
  enableSkills          = true
  enableAskQuestion     = true
  enableSubmitAndExit   = false   <-- decisive
  enableSpawnAgent      = true
  enableAgentTeams      = true
}
```

From `sdk/packages/core/src/extensions/tools/definitions.ts:1095-1158`:

```text
createDefaultTools checks:
  submitExecutor = enableSubmitAndExit ? executors.submit : undefined
  → for act mode: submitExecutor = false ? ... : undefined = undefined
  → "Add submit_and_exit tool if enabled and executor provided"
  → if (submitExecutor) tools.push(createSubmitAndExitTool(...))
  → if (undefined)       tools.push(...) ← branch NOT taken
```

Result:

```text
finalTools ⊇ { read_files, search_codebase, run_commands, web_fetch,
               editor, ask_question, list_files, ... }
finalTools ⊅ { submit_and_exit }
finalTools ⊅ { attempt_completion }   (legacy alias; not in candidate set either)
```

### 10a.3 Existing GREEN tests already prove the absence

`sdk/packages/core/src/runtime/orchestration/runtime-builder.test.ts`:

```text
L297-L314  "keeps ask_question available in non-yolo modes"
           → for (act, plan): runtime.tools ∌ "submit_and_exit"
                              runtime.completionPolicy === undefined
L316-L333  "does not infer yolo preset from auto-approval alone"
           → even with full auto-approval in act mode, submit_and_exit absent
L285-L295  "requires completion only when submit_and_exit is available"
           → even with mode: "yolo", missing toolExecutors.submit ⇒
             submit_and_exit absent, completionPolicy undefined
```

These three tests assert the current behavior and pass GREEN. They
document (do not enforce) the policy choice. They are the closest
existing seams to the reviewer's RED-A spec.

### 10a.4 Downstream architectural confirmation

| Seam                                                                | Code                                                                                              | Verdict                                                            |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `finalTools → requiresCompletionTool`                               | `runtime-builder.ts:707-711`                                                                      | `requiresCompletionTool = false`                                   |
| `requiresCompletionTool → completionPolicy`                         | `runtime-builder.ts:744-753`                                                                      | `completionPolicy = undefined`                                     |
| `completionPolicy = undefined → getRequiredCompletionToolNames`     | `agent-runtime.ts:1201-1209`                                                                      | returns `[]` — no terminal tool names                              |
| `getRequiredCompletionToolNames() = [] → completionReminderMessages` | `agent-runtime.ts:1211-1226`                                                                     | `[]` — no reminder emitted                                         |
| `no reminder + plain text → finishRun("completed", text)`           | `agent-runtime.ts:1356-1371`                                                                     | run silently completes with the plain assistant text as `done`     |
| `runtimeStatus = completed + submitAndExitObserved = false`         | `local-runtime-host.ts:2283-2293` (fallback `task.completed` from shutdown, source: "shutdown")   | telemetry fires `task.completed` from the shutdown path            |
| `attemptCompletionSeen = false + done → coordinator`                | `message-translator.ts:1940-1955` + `sdk-session-event-coordinator.ts:203-225`                    | coordinator refuses `completed` promotion → `awaiting_followup`    |
| `awaiting_followup → TaskHeader presentation`                       | derived in canonical state projection (PTAD `taskHeaderPresentation.phase = awaiting_followup`)  | user sees no `Completed` badge                                      |

The chain is closed: `enableSubmitAndExit: false` is the **single**
causal variable. Every other seam mechanically follows.

### 10a.5 Branch A verdict

```text
BRANCH_A = PROVEN (interactive Act-mode ClineMM)

The session-termination fallback in local-runtime-host.ts:2283-2293 and
the no-reminder no-enforcement path in agent-runtime.ts:1356-1371 are
the documented, designed behavior for non-yolo sessions — explicitly
described in the local-runtime-host doc-comment as:

  "Fallback `task.completed` emission for completed sessions that
   did not observe an explicit `submit_and_exit` tool call...
   for non-interactive runs not using the yolo preset."

The doc-comment distinguishes "non-interactive runs not using the yolo
preset" — but the absence of `submit_and_exit` from the interactive
Act preset is the same architectural choice. Whether interactive Act
mode SHOULD also expose `submit_and_exit` (and therefore produce a
truthful `Completed` badge) is the product-contract question (Branch D
territory), not a runtime defect per se. See §10a.6.
```

### 10a.6 Open product-contract question (NOT Branch C/D; deferred)

The runtime's doc-comment justifies the fallback for "non-interactive
runs". The interactive Act-mode session class is not non-interactive,
yet it shares the same fallback. Whether this is a **deliberate policy
choice** (Branch D) or a **mis-applied shortcut** (Branch A repair)
requires a separate product-contract ACT that this ACT does not own.

**No production change in this ACT.** Authoring a RED-A test that
asserts the opposite would force a runtime-builder change without
the product-contract decision; that decision is explicitly out of
scope for LIVENESS02.

### 10a.7 §4 / §5 disposition

Per the reviewer-correct discriminator sequence:

```text
§3  registered?   → NO   (Branch A PROVEN)
§4  required?     → n/a  (skipped; no tool to require)
§5  finishReason? → n/a  (skipped; the only relevant "finish" is
                         the silent fallback at agent-runtime.ts:1371,
                         which is a designed terminal-state for non-yolo)
```

§4 and §5 are **not executed** in this ACT. The Branch A classification
is terminal for LIVENESS02's causal question.

### 10a.8 RED-A test disposition

The reviewer-correct RED-A shape is:

```text
Given:
  config.mode = "act"
  no toolExecutors.submit
When:
  new DefaultRuntimeBuilder().build(config)
Then:
  finalTools contains at least one tool with lifecycle.completesRun === true
```

Authoring this RED-A test under the LIVENESS02 ACT is **deferred**:
writing it now would create a failing test that the LIVENESS02 ACT does
not have authority to fix (the fix requires the product-contract
decision from §10a.6). The correct next move is:

```text
1. Branch D product-contract ACT
   ("Should interactive Act-mode ClineMM expose submit_and_exit and
    require explicit completion authority?")
2. If yes → RED-A authored, fix implemented, RED-A goes GREEN
3. If no  → document the intentional policy, mark LIVENESS02 CLOSED,
            advance to LIV2-C04 (awaiting_followup remains valid) and
            downstream UX work (Completed badge suppression etc.)
```

LIVENESS02 records the Branch A classification and stops here.

### 10a.9 Conservation tests touched by this ACT (none yet)

LIV2-C04 (user-owned awaiting_followup remains valid where completion
genuinely was not required) is **the** conservation test directly
implicated by Branch A PROVEN. The runtime's doc-comment and the
existing test `keeps ask_question available in non-yolo modes` together
preserve this invariant — `awaiting_followup` is the truthful projection
when no completion tool exists, and the composer stays enabled via
`turnAllowsFollowup()`.

LIV2-C07/C08 (no text/tail-derived completion_result) are preserved by
the message-translator's HALT_NONTOOL_TERMINAL_AUTHORITY_NOT_PROVEN
verdict (referenced at `message-translator.ts:1940-1943`).

LIV2-C01/C02/C03 (explicit completion conserved, failure conserved,
partial conserved) require a `submit_and_exit` invocation to test — that
is Branch B/C/D territory, not reachable from this ACT's spec.




## 10b. §3b outcome — reclassified after reviewer bound-specimen challenge

The §3 outcome in §10a (Branch A PROVEN, single-variable chain) is **reclassified**.
The reviewer correctly identified two load-bearing evidence gaps:

1. **Specimen → runtime-builder input binding was inferred, not read.**
   The original PTAD JSONL did NOT capture `config.mode`; §10a's
   `config.mode = "act"` was inferred from defaults.
2. **"YOLO" was used ambiguously across two distinct domains.**
   ClineMM has a user-facing Seatbelt-YOLO (host authorization policy)
   AND a core-runtime `yolo` tool preset (selected via `config.mode`).
   These are independent, and the user's UI YOLO toggle flows into the
   first but not the second.

The reviewer also flagged `NECESSITY_ABLATION = PASS` as unjustified
without a one-variable flip; that gate is reclassified to
`NOT_EXECUTED` until §3b's ablation below is run.

### 10b.1 Bound specimen → runtime-builder inputs (read from durable state)

| Fact                                     | Value (durable)                                               | Source                                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `taskId`                                 | `1787832864738_ik2zh`                                         | `~/.cline/data/sessions/1787832864738_ik2zh/1787832864738_ik2zh.json:session_id`                                        |
| `source`                                 | `"vscode"`                                                    | `~/.cline/data/sessions/1787832864738_ik2zh/1787832864738_ik2zh.json:source`                                            |
| `interactive`                            | `true`                                                        | `~/.cline/data/sessions/1787832864738_ik2zh/1787832864738_ik2zh.json:interactive`                                       |
| `enable_tools`                           | `true`                                                        | `~/.cline/data/sessions/1787832864738_ik2zh/1787832864738_ik2zh.json:enable_tools`                                      |
| `enable_spawn`                           | `false`                                                       | `~/.cline/data/sessions/1787832864738_ik2zh/1787832864738_ik2zh.json:enable_spawn`                                      |
| `enable_teams`                           | `false`                                                       | `~/.cline/data/sessions/1787832864738_ik2zh/1787832864738_ik2zh.json:enable_teams`                                      |
| `provider`                               | `"minimax"`                                                   | `~/.cline/data/sessions/1787832864738_ik2zh/1787832864738_ik2zh.json:provider`                                          |
| `model`                                  | `"MiniMax-M3"`                                                | `~/.cline/data/sessions/1787832864738_ik2zh/1787832864738_ik2zh.json:model`                                             |
| `mode` (global state)                    | `"act"`                                                       | `~/.cline/data/globalState.json:mode`                                                                                   |
| `mode` derivation in VS Code             | `mode === "plan" ? "plan" : "act"`                            | `apps/vscode/src/sdk/SdkController.ts:1440-1443` (`getCurrentMode()` returns ONLY `"plan" \| "act"`)                   |
| `autoApprovalSettings.enabled`           | `true`                                                        | `~/.cline/data/globalState.json:autoApprovalSettings.enabled`                                                          |
| `autoApprovalSettings.actions.*`         | all ordinary categories `true`                                | `~/.cline/data/globalState.json:autoApprovalSettings.actions` (Seatbelt-YOLO profile)                                  |
| `toolExecutors.submit` (VS Code wiring)  | **NEVER wired** — zero references in `apps/vscode/src/sdk/`   | grep confirms no `submit:`, `submit executor`, `createSubmitAndExitTool`, or `enableSubmitAndExit` in VS Code         |
| `tool_use` blocks in 746-message session | 0 × `submit_and_exit`, 0 × `attempt_completion`               | structural scan of `1787832864738_ik2zh.messages.json`                                                                  |


**Crucial bindings** that §10a missed:

- `mode: "act"` is **read directly from `globalState.json:mode`**,
  not inferred from defaults. The bound specimen definitely ran in
  Act mode at the runtime-builder seam.
- `autoApprovalSettings.actions.*` is **all-true** → Seatbelt-YOLO
  host authorization was active for this session. Yet `mode = "act"`
  means the **core runtime's tool preset** is `act`, which disables
  `submit_and_exit`. **The two YOLO domains are decoupled.**
- The VS Code `apps/vscode/` adapter has **zero wiring** for
  `toolExecutors.submit`. Even if `mode` were flipped to `"yolo"`,
  the runtime builder would still not register `submit_and_exit`
  because the executor is not provided.

### 10b.2 The two YOLO domains (reviewer-correct decomposition)

```text
USER_FACING_CLINEMM_YOLO
  = the Seatbelted-YOLO host authorization mode
  = derived from autoApprovalSettings.actions.*
  = when on: tool approvals auto-pass, hostAuthorization.mode = "all"
  = does NOT touch config.mode or the tool preset

CORE_RUNTIME_PRESET
  = config.mode ∈ {"act", "plan", "yolo", "zen"}
  = selects ToolPresets[resolveToolPresetName({mode})]
  = ToolPresets.yolo.enableSubmitAndExit = true   (the ONLY preset that enables it)
  = ToolPresets.act.enableSubmitAndExit = false   (the bound specimen's preset)

TOOL_AUTO_APPROVAL
  = independent permission policy per tool
  = orthogonal to CORE_RUNTIME_PRESET

SUBMIT_AND_EXIT_AVAILABLE
  = downstream consequence of CORE_RUNTIME_PRESET = "yolo"
                           AND toolExecutors.submit provided
```

Upstream CLI explicitly distinguishes: `--yolo` enables `submit_and_exit`
in the core runtime (presets.ts:78), while `--auto-approve true` does
NOT change the core preset. ClineMM inherits this distinction but the
VS Code UI surfaces only the Seatbelted-YOLO half — leaving users
without access to the core runtime's `yolo` preset at all (the VS Code
`getCurrentMode()` returns only `"plan" | "act"`).

### 10b.3 Prompt ↔ runtime contract tension (now surfaced)

`sdk/packages/shared/src/prompt/system.ts:65-66` says:

```text
- Always includes tool calls in your response until the task is completed.
  You should only end the task when all the requirements are met by calling
  the 'submit_and_exit' tool.
- Response without the submit_and_exit tool call will considered not
  completed and the task will continue.
```

But the VS Code `apps/vscode/src/sdk/` adapter never wires
`toolExecutors.submit`, so even if the agent tried to comply with the
prompt, `submit_and_exit` is not in `finalTools` and the runtime would
reject any tool call to it as "tool not found" (or simply not receive
the call at all because the model has no schema for it). The agent is
asked to call a tool it cannot invoke — and when it terminates anyway,
the runtime falls through to the "non-interactive runs not using the
yolo preset" fallback path described at `local-runtime-host.ts:2279-2293`.

This is the **real contract tension**: the prompt contract assumes a
completion-tool contract, the runtime contract omits the tool, and the
fallback path permits ordinary termination anyway. **That is not
merely a product-choice question — it is potentially the defect.**


### 10b.4 Ablation — single-variable flip at the real runtime-builder seam

The reviewer asked for a one-variable flip at the real production
runtime-builder seam to test necessity. I executed it statically
(vitest cannot run under this sandbox — `kill EPERM` on worker spawn —
but the production seam is short and direct).

**Inputs held constant** (matches the bound specimen at §10b.1):

```text
providerId               = "anthropic"
modelId                  = "claude-sonnet-4-6"
apiKey                   = "key"
systemPrompt             = "test"
cwd                      = process.cwd()
enableTools              = true
enableSpawnAgent         = false
enableAgentTeams         = false
toolRoutingRules         = (default — DEFAULT_MODEL_TOOL_ROUTING_RULES)
toolPolicies             = (none)
toolExecutors.submit     = (none — VS Code never wires it)
```

**Variable flipped across two rows** (the reviewer's exact ablation):

| Row | Variable value                                       | Reading from production source                                                                                       |
| --- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| A   | `mode = "act"` (bound specimen value)                | `presets.ts:18-39` → `ToolPresets.act.enableSubmitAndExit = false`                                                  |
| B   | `mode = "yolo"` (alternative hypothetical)           | `presets.ts:73-89` → `ToolPresets.yolo.enableSubmitAndExit = true`                                                  |

**Predicted outcomes** (read from `runtime-builder.ts:706-753` + `createDefaultTools`):

| Seam                                           | A (`mode=act`)                                  | B (`mode=yolo`, but no `submit` executor)                |
| ---------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------- |
| `finalTools ⊇ {submit_and_exit}`               | **NO** (presets.act.enableSubmitAndExit=false)  | **NO** (definitions.ts:1148: `submitExecutor = false ? ... : undefined`)    |
| `finalTools ⊇ {attempt_completion}`            | **NO** (legacy alias; not in candidate set)     | **NO** (same)                                            |
| `requiresCompletionTool`                       | **false**                                       | **false** (no submit tool → flag stays false)            |
| `completionPolicy`                             | **undefined**                                   | **undefined**                                            |

The ablation **does NOT flip** for the canonical completion tool under
the current VS Code wiring — **because VS Code never provides
`toolExecutors.submit`**. This is a stronger statement than §10a's
"act preset disables it": **even flipping `mode` to `"yolo"` would
not register `submit_and_exit` until the VS Code adapter supplies the
executor.** The executor is a separate missing wiring.

The ablation also confirms that `mode` is **necessary but not
sufficient**: it is a precondition, but the executor must also be
provided. The single-variable causal claim therefore is:

```text
NECESSARY_PREREQUISITES = {
  enableSubmitAndExit === true  (one source: ToolPresets.yolo, but NOT the only source)
  AND
  toolExecutors.submit !== undefined
}
```

The static ablation at row A establishes that `(1)` is unsatisfied
for the bound specimen (mode="act" → presets.act.enableSubmitAndExit=false),
and at row B it establishes that even `(1)` alone does not register
the tool without `(2)`. Either prerequisite missing → completion tool
absent → same observable symptom as the bound specimen. **This is the
correct static-discriminator reading**: a structural proposition about
the registration predicate, not a vitest-flipped necessity proof.


### 10b.5 Updated verdict

```text
BRANCH_A                            = STRONGLY_SUPPORTED (was: PROVEN)
BOUND_SPECIMEN_RUNTIME_CONFIG       = BOUND (was: NOT_YET_BOUND)
CAUSAL_VARIABLE                     = CANDIDATE — TWO PREREQUISITES (was: SINGLE)
NECESSITY_ABLATION                  = STATIC_DISCRIMINATOR_PASS / RUNTIME_ABLATION_NOT_EXECUTED (was: PASS)
CONTRACT_TENSION                    = SURFACED (was: SURFACED §10a.6)
PROMPT_VS_RUNTIME_MISMATCH          = NOT BOUND FOR THIS SPECIMEN — see §10c.1 (was: claimed SURFACED)

The §10a single-variable chain is correct in shape (the seams are
real), but its evidence base did not bind the specimen's actual
runtime-builder inputs. The chain is now properly anchored at §10b.1.
The ablation §10b.4 reveals that the registration predicate is the
conjunction of two prerequisites — neither alone is sufficient.
Reading directly from `sdk/packages/core/src/extensions/tools/definitions.ts:1148`:

  const submitExecutor = enableSubmitAndExit ? executors.submit : undefined;

So the actual registration predicate is:

  SUBMIT_AND_EXIT_REGISTERED ⇔
      (resolved enableSubmitAndExit === true)
      AND
      (toolExecutors.submit !== undefined)

Two missing prerequisites, neither sufficient alone:

  (1) the resolved default-tools configuration must set
      enableSubmitAndExit=true. Selecting core mode="yolo" is ONE
      way to obtain this (ToolPresets.yolo.enableSubmitAndExit=true
      at presets.ts:78), but the model-tool routing table can also
      set enableSubmitAndExit independently of mode. So mode="yolo"
      is NOT intrinsically necessary — only enableSubmitAndExit=true is.

  (2) the VS Code host must supply toolExecutors.submit.
      `apps/vscode/src/sdk/` currently does not wire this executor
      (zero references to `submit:`, `createSubmitAndExitTool`, or
      `enableSubmitAndExit` in the VS Code adapter).

Neither prerequisite alone is sufficient. The original §10b.5 wording
("Either repair, by itself, would expose submit_and_exit") was
internally inconsistent with the ablation §10b.4 (which showed
mode="yolo" alone does not register the tool) — corrected here.
```

### 10b.6 Open work and §6 RED-A disposition

The reviewer-correct contract ACT is now more precisely scoped:

```text
ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-CONTRACT01
QUESTION:
  When ClineMM's effective host authorization is Seatbelted YOLO
  (autoApprovalSettings.actions.* all true),
  must the core runtime also expose a completesRun tool and require
  explicit completion authority, even though its conversational mode
  remains "act"?
POSSIBLE ANSWERS:
  YES:
    preserve act-mode editing/tool semantics
    overlay enableSubmitAndExit=true + submit executor
    + requireCompletionTool=true
  NO:
    accept awaiting_followup as the truthful terminal UX
    (LIV2-C04 remains the canonical UI projection)
```

This avoids changing the entire runtime into `mode="yolo"` (which would
also disable spawn/teams per the preset). The narrower contract ACT
decides whether the gap between prompt and runtime is a defect.

The original §6 RED-A shape (asserting `finalTools ⊇ completesRun=true`
under Act mode) is **preserved as the discrimination contract** for the
product-contract ACT — it will become RED if the answer is YES, GREEN
if the answer is NO (after a corresponding documentation change in
the prompt).

### 10b.7 §3 / §4 / §5 disposition

```text
§3  registered?         → NO   (Branch A STRONGLY_SUPPORTED, not PROVEN)
§4  required?           → n/a  (skipped; no tool to require)
§5  finishReason?       → n/a  (skipped; the silent fallback at
                              agent-runtime.ts:1371 is a designed
                              terminal state for non-yolo sessions)

§3b binding table       → DONE (§10b.1)
§3b ablation            → DONE structurally (§10b.4; vitest unavailable)
NECESSITY_ABLATION      = NOT_EXECUTED — needs runtime test (vitest EPERM
                          in this sandbox); the static ablation above
                          establishes the candidates' necessity, but
                          not their sufficiency.
```


## 10c. §3c outcome — prompt variant binding (final discriminator)

The second-pass reviewer correctly challenged §10b.3's
`PROMPT_VS_RUNTIME_MISMATCH = SURFACED` claim. Upstream defines **two**
system prompts:

```text
DEFAULT_CLINE_SYSTEM_PROMPT  (system.ts:1-36)   — no mention of submit_and_exit
YOLO_CLINE_SYSTEM_PROMPT     (system.ts:38-68)  — requires submit_and_exit at lines 65-66
```

The variant selection is at `sdk/packages/shared/src/prompt/cline.ts:161-162`:

```typescript
const basePrompt =
    mode === "yolo" ? YOLO_CLINE_SYSTEM_PROMPT : DEFAULT_CLINE_SYSTEM_PROMPT;
```

So the prompt variant is bound by `mode` alone — same selector as the
tool preset. For the bound specimen (`mode = "act"`), the bound prompt
must be **`DEFAULT_CLINE_SYSTEM_PROMPT`**.

### 10c.1 Prompt variant bound directly from durable state

The session JSONL persists the constructed `system_prompt` field
verbatim at `1787832864738_ik2zh.messages.json:system_prompt`. Reading
it directly:

```text
length                      = 4296 chars
opens with                  = "You are Cline, an AI coding agent..."     ← DEFAULT opening
contains 'submit_and_exit'  = False                                         ← no YOLO
contains 'attempt_completion' = False
contains "completed"         = 4 occurrences — semantic, not tool-specific
contains "Response without tool calls will considered as completed
  with final answer."       = True                                          ← DEFAULT line ~30
```

The bound specimen's persisted prompt **does NOT mention `submit_and_exit`**.
The DEFAULT prompt's completion semantic is:

> "Always includes tool calls in your response until the task is completed.
> Response without tool calls will considered as completed with final answer."

This is **Reviewer's Case P2** confirmed: the prompt and runtime
contract are NOT in contradiction for this specimen. The agent is
permitted to terminate with a text-only response, and the runtime
fallback path that yields `awaiting_followup` is consistent with that
prompt semantic.

### 10c.2 §10b.3 claim retracted

`PROMPT_VS_RUNTIME_MISMATCH = SURFACED` is **retracted** as overstated.
The §10b.3 reasoning conflated the YOLO-specific prompt (which DOES
require `submit_and_exit`) with the prompt actually bound to this
specimen (DEFAULT, which does NOT).

If a future specimen runs with `mode = "yolo"` AND the runtime still
omits `submit_and_exit`, then the prompt/runtime contradiction would
be real. That scenario is **not this specimen**. The reviewer-correct
distinction is:

```text
Case P1 (PROMPT_VS_RUNTIME_CONTRACT_VIOLATION):
  Seatbelt-YOLO user-facing + mode="yolo" + prompt=YOLO_CLINE_SYSTEM_PROMPT
  + resolved enableSubmitAndExit=false + submit executor absent
  → agent told to call a tool that isn't in its toolkit
  → STRONG product defect signal
  → Out of scope for this specimen.

Case P2 (NO INTERNAL CONTRADICTION):
  Seatbelt-YOLO user-facing + mode="act" + prompt=DEFAULT_CLINE_SYSTEM_PROMPT
  + resolved enableSubmitAndExit=false + submit executor absent
  → agent's prompt permits text-only completion; runtime fallback honors it
  → Terminal UX = awaiting_followup is consistent with both prompt and runtime.
  → THE BOUND SPECIMEN IS HERE.
```

### 10c.3 The narrower product question

With the prompt/runtime contradiction retracted, the product question
collapses to a pure product policy question:

> When ClineMM's user-facing Seatbelted-YOLO host authorization is
> active (every tool auto-approved under the Seatbelt confinement),
> should the agent also have explicit completion authority — i.e.,
> `enableSubmitAndExit=true` AND an executor for `submit_and_exit`?
>
> Or is `awaiting_followup` a sufficient terminal UX for non-YOLO-core
> sessions, with the implicit understanding that Seatbelted-YOLO
> users accept ordinary text termination?

This is genuinely normative. There is no internal inconsistency in
the current architecture to "fix"; there is only a question of
product intent. The downstream ACT must decide whether the gap is a
defect (and which layer to fix it at: prompt relax? tool wiring? both?).

### 10c.4 Complete product/runtime relationship table (now fully bound)

```text
USER_FACING_CLINEMM_YOLO       = true       (autoApprovalSettings.actions.* all true)
CORE config.mode               = "act"      (NOT "yolo" — see §10b.1)
PROMPT variant                 = DEFAULT    (NOT YOLO — see §10c.1)
resolved enableSubmitAndExit   = false      (ToolPresets.act.enableSubmitAndExit=false)
toolExecutors.submit present   = false      (VS Code never wires it — see §10b.1)
submit_and_exit registered     = false      (consequence of the two above)
requiresCompletionTool         = false
completionPolicy               = undefined
finalTools ⊇ {submit_and_exit} = NO
finalTools ⊇ {ask_question}    = YES        (preserved at L297-314 test)

OBSERVED:
  attemptCompletionSeen        = false
  terminalResponseCommitted    = false
  legacyPhase                  = streaming → awaiting_followup
  runtimeStatus                = running → completed
  prompt mentions submit_and_exit? NO
  agent asked to call submit_and_exit? NO
  terminal UX consistent with prompt? YES

DISPOSITION:
  Internal prompt/runtime contradiction = NONE for this specimen
  Product policy gap                    = OPEN (downstream contract ACT)
  Causal prerequisites identified       = 2 (enableSubmitAndExit + executor)
  Static-discriminator proposition      = PASS (sub-claim a/b/c above)
  Runtime-ablation                      = NOT EXECUTED (vitest EPERM)
```


## 11. Gates

```text
BOUND_LIVE_SPECIMEN                    PASS    (this ACT §0 — 1787832864738_ik2zh)
PTAD_CAUSAL_BRANCH                     PASS    (terminal-push sv=8299, false/false)
BOUND_SPECIMEN_RUNTIME_CONFIG          PASS    (§10b.1 — mode="act" + Seatbelt-YOLO read from durable state)
BOUND_SESSION_PROMPT_VARIANT           PASS    (§10c.1 — DEFAULT_CLINE_SYSTEM_PROMPT verified by reading
                                                1787832864738_ik2zh.messages.json:system_prompt verbatim;
                                                contains no 'submit_and_exit' reference)

COMPLETION_TOOL_REGISTRY_CLASSIFIED    STRONG_SUPPORT (§10b.5 — Branch A STRONGLY_SUPPORTED, not PROVEN)
COMPLETION_POLICY_CLASSIFIED           n/a     (§4 skipped; no tool ⇒ no policy to classify)
MODEL_TERMINATION_PATH_CLASSIFIED      n/a     (§5 skipped; fallback is designed for non-yolo)

RED_REAL_PRODUCTION_SEAM               DEFER   (§6 — RED-A author requires §10b.6 product-contract)
CAUSAL_VARIABLE_DISCRIMINATED          TWO_PREREQUISITES (§10b.5 — neither alone sufficient;
                                                enableSubmitAndExit=true AND toolExecutors.submit)
                                                (was: CANDIDATE single variable)
NECESSITY_ABLATION                     STATIC_DISCRIMINATOR_PASS / RUNTIME_ABLATION_NOT_EXECUTED
                                                (§10b.4 static predicate-discrimination passes;
                                                 vitest runtime flip EPERM-blocked in this sandbox)

USER_FACING_YOLO_VS_CORE_PRESET_DECOUPLED   SURFACED (§10b.2 — distinct domains; VS Code UI toggle does NOT flow to config.mode)
PROMPT_VS_RUNTIME_MISMATCH            RETRACTED (§10c.2 — not present for this specimen;
                                                DEFAULT prompt permits text-only completion;
                                                runtime fallback is consistent with prompt semantic;
                                                reviewer's Case P2 confirmed)
VS_CODE_EXECUTOR_WIRING_MISSING       SURFACED (§10b.4 — apps/vscode/src/sdk/ never wires toolExecutors.submit)
REGISTRATION_PREDICATE_BOUND           PASS    (§10b.5 — definitions.ts:1148:
                                                submitExecutor = enableSubmitAndExit ? executors.submit : undefined)
SUBMIT_AND_EXIT_NOT_IN_FINALTOOLS     PROVEN   (§10b.1 — 746-message transcript contains 0 tool_use blocks
                                                for submit_and_exit or attempt_completion)

NO_TEXT_DERIVED_COMPLETION             PASS    (LIV2-C07 — preserved by HALT_NONTOOL_TERMINAL_AUTHORITY)
NO_TAIL_DERIVED_COMPLETION             PASS    (LIV2-C08 — preserved by HALT_NONTOOL_TERMINAL_AUTHORITY)
USER_OWNED_AWAITING_FOLLOWUP_CONSERVED PASS    (LIV2-C04 — preserved by existing test "keeps ask_question...")
EXPLICIT_COMPLETION_CONSERVED          n/a     (LIV2-C01..C03 unreachable from this ACT's spec)
RESUME_CONSERVED                       n/a     (LIV2-C10 — out of scope)
SDK_CONSUMER_CONSERVATION              PASS    (LIV2-C05 — yolo preset + opt-in explicitly preserve)

targeted tests                         n/a     (no production/test change in this ACT)
check-types                            TBD / PASS  (re-run on commit)
lint                                   TBD / PASS  (re-run on commit)
test:unit                              n/a     (no production change; static ablation only)
git diff --check                       TBD / PASS
board validator                        TBD / PASS
```

The §10b.1 binding table, §10b.4 ablation, §10b.5 two-prerequisite
predicate, and §10c.1 prompt-variant read are the load-bearing gates.
§3 classifies as **STRONG_SUPPORT, not PROVEN** — the reviewer correctly
identified the inferred-from-defaults gap (now closed at §10b.1) and the
PROMPT_VS_RUNTIME_MISMATCH overclaim (now retracted at §10c.2 — the
bound specimen's prompt is DEFAULT and permits text-only completion).
NECESSITY_ABLATION is downgraded to STATIC_DISCRIMINATOR_PASS /
RUNTIME_ABLATION_NOT_EXECUTED. RED-A gate remains DEFER pending the
§10c.3 product-contract ACT.



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

or (this ACT's actual path — reclassified by §10b and §10c):

```text
PASS_BRANCH_A_STRONG_SUPPORT_BOUND_PROMPT_VARIANT_PRODUCT_POLICY_DECISION_REQUIRED
  ACT-CLINEMM-COMPLETION-PROTOCOL-LIVENESS02 closes here with:
    BOUND_LIVE_SPECIMEN                    = PASS  (1787832864738_ik2zh)
    PTAD_CAUSAL_BRANCH                     = PASS  (false / false at sv=8299)
    BOUND_SPECIMEN_RUNTIME_CONFIG          = PASS  (§10b.1 — mode="act" + Seatbelt-YOLO from durable state)
    BOUND_SESSION_PROMPT_VARIANT           = PASS  (§10c.1 — DEFAULT_CLINE_SYSTEM_PROMPT verified by reading
                                                 1787832864738_ik2zh.messages.json:system_prompt verbatim;
                                                 contains zero 'submit_and_exit' references)
    COMPLETION_TOOL_REGISTRY_CLASSIFIED    = STRONG_SUPPORT (§10b.5)
    CAUSAL_VARIABLE_DISCRIMINATED          = TWO_PREREQUISITES (§10b.5 — enableSubmitAndExit=true AND
                                                 toolExecutors.submit; neither alone sufficient;
                                                 mode="yolo" is ONE source of (1), not the only one)
    NECESSITY_ABLATION                     = STATIC_DISCRIMINATOR_PASS / RUNTIME_ABLATION_NOT_EXECUTED
                                                 (§10b.4 predicate discrimination passes; vitest EPERM-blocked)
    PROMPT_VS_RUNTIME_MISMATCH             = RETRACTED — NONE FOR THIS SPECIMEN (§10c.2)
    USER_FACING_YOLO_VS_CORE_PRESET        = DECOUPLED (§10b.2)
    VS_CODE_EXECUTOR_WIRING                = MISSING (§10b.4 — neither prerequisite is wired in VS Code)
    REGISTRATION_PREDICATE                 = BOUND (§10b.5 — definitions.ts:1148)
    SUBMIT_AND_EXIT_NOT_IN_FINALTOOLS      = PROVEN (§10b.1 — 0/746 tool_use blocks)
    RED-A_TEST_AUTHORED                    = DEFER (deferred to product-contract ACT per §10c.3)
  Provenance: §10c.5 full relationship table + §10b.5 verdict + §10c.1 prompt read
  Next: open ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-CONTRACT01
        question: when Seatbelt-YOLO host authorization is active, must
        the agent also have explicit completion authority (i.e. both
        registration prerequisites satisfied), even though conversational
        mode is "act"? (NO internal prompt/runtime contradiction exists
        for the bound specimen — this is a pure product-policy question)
        (decision tree in §10c.3)
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
PTAD-DORMANT-DIAGNOSTIC-SUBSTRATE            CLOSED
PTAD-ENV-OPTIN01                             CLOSED
COMPLETION-PROTOCOL-LIVENESS02               OPEN / ACTIVE_RECON
                                              → §10b.5: Branch A STRONG_SUPPORT
                                              → §10c:  PROMPT VARIANT BOUND (DEFAULT)
                                              → §10c.3: needs SEATBELT-YOLO-CONTRACT01 (pure policy)
EDITOR-TOOL-APPROVAL-FRICTION                OPEN / HIGH (queued behind LIVENESS02)
```

This is a deliberate one-ACT preemption because we now possess rare
bound LIVE evidence for completion liveness.

After §10c.5 verdict (Branch A STRONG_SUPPORT + TWO_PREREQUISITES
identified + PROMPT_VARIANT BOUND to DEFAULT + PROMPT_VS_RUNTIME_MISMATCH
RETRACTED for this specimen), LIVENESS02 is ready to close pending a
downstream Seatbelt-YOLO completion-authority contract ACT. The
closure path:

```text
1. LIVENESS02 closes with PASS_BRANCH_A_STRONG_SUPPORT_BOUND_PROMPT_VARIANT_PRODUCT_POLICY_DECISION_REQUIRED
   (§13 exit shape; provenance §10c.5 + §10c.1 + §10b.5 + §10b.4 + §10b.1)

2. ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-CONTRACT01 opens:
   "When ClineMM's effective host authorization is Seatbelted YOLO,
    must the agent also have explicit completion authority (i.e.
    BOTH registration prerequisites satisfied), even though its
    conversational mode remains 'act'?"
   Owner: same factory lane (runtime/task-progression).
   §10c.3 is the question; §10b.1 + §10b.4 + §10c.1 are the chain.

3. EDITOR-TOOL-APPROVAL-FRICTION-RECON01 resumes NEXT status once
   LIVENESS02 closes (per the one-ACT preemption rule).
```

Decision tree (for the Seatbelt-YOLO contract ACT author):

```text
yes (expose submit_and_exit even with mode="act")
  → preserve act-mode editing/tool semantics
  → overlay enableSubmitAndExit=true (without flipping config.mode
    to "yolo" and inheriting unrelated preset semantics)
  → supply toolExecutors.submit in apps/vscode/src/sdk/
  → SUBMIT_AND_EXIT_REGISTERED becomes true per definitions.ts:1148
  → requiresCompletionTool=true; reminder path fires
  → user sees truthful Completed badge on explicit submit_and_exit
  → RED-A (finalTools ⊇ completesRun) becomes GREEN

no (keep the fallback as the documented policy)
  → LIVENESS02's STRONG_SUPPORT verdict is the final answer
  → LIV2-C04 (awaiting_followup remains valid) is the canonical UI
    projection — already CONSISTENT with the bound DEFAULT prompt
    (which permits text-only completion)
  → no prompt rewrite needed (the prompt's "Response without tool
    calls will considered as completed with final answer" is
    already compatible with awaiting_followup semantics)
  → downstream UX work (badge suppression messaging, etc.) goes
    elsewhere
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
