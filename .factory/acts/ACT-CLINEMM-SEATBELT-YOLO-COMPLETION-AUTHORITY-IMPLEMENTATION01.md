# ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01

> Status: **NEXT / HIGH** — opens immediately after `ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-CONTRACT01`
> closes. Real-seam RED + minimal implementation + bounded production repair.
>
> **Contract authority**: `ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-CONTRACT01`
> (verdict `PASS_SEATBELT_YOLO_REQUIRES_EXPLICIT_COMPLETION_AUTHORITY_OPTION_C`;
> decision = YES; architectural form = independent `explicitCompletionAuthority`
> capability; default ON for Seatbelt-YOLO interactive VS Code, default OFF
> for ordinary manual Act; `core mode` remains `"act"`, no flip to `"yolo"`).
>
> **Predecessor**: `ACT-CLINEMM-COMPLETION-PROTOCOL-LIVENESS02` (CLOSED) +
> `ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-CONTRACT01` (CLOSED).
>
> **Verdict (target)**: `PASS_SEATBELT_YOLO_EXPLICIT_COMPLETION_AUTHORITY_V1`

## 0. Mission

Implement the frozen contract: in interactive VS Code ClineMM, when
the effective host authorization is Seatbelted YOLO, the agent has
**independent explicit completion authority** — a registered
`submit_and_exit` tool with a real VS Code host-side submit executor —
so successful autonomous work requires the canonical completing tool
and failed/non-authoritative termination never receives task-level
Completed framing.

This is **not** a flip of `config.mode` to `"yolo"` (which would import
the entire core yolo preset and unrelated spawn/teams semantics per
LIVENESS02 §10b.1 + CONTRACT01 §3 Option A warning).

This is **not** a new persisted user setting in V1 (per CONTRACT01 §12
and the reviewer decision that architectural independence does not
require user-configurable V1 state).

The capability is **derived**, not persisted: derive it from the
already-composed effective Seatbelt-YOLO authority, not from one
particular ingredient (per-session override OR persisted settings).
Both paths must converge.

## 1. Phase 0 — recon the real seam (already executed)

Construction path traced in this thread:

```text
cline.task.start (UI / VS Code command)
  → SdkController.startNewSession (or resume path)
  → buildSessionConfig()  (apps/vscode/src/sdk/cline-session-factory.ts:736)
        - mode is resolved at line 742: mode === "plan" ? "plan" : "act"
        - config.mode is set at line 1009 (NEVER "yolo")
        - enableSpawnAgent / enableAgentTeams forced false at 993-994
        - enableSubmitAndExit is NOT set on the config
          → core runtime falls back to ToolPresets.act.enableSubmitAndExit=false
  → buildStartSessionInput() (cline-session-factory.ts:1054)
  → ClineCore.create / sessions.startNewSession
  → VscodeSessionHost.create() (apps/vscode/src/sdk/vscode-session-host.ts:142)
        - toolExecutors populated at lines 159-186:
          askQuestion / editor / applyPatch / readFile / bash=undefined
        - submit is NEVER populated (verified LIVENESS02 §10b.5)
  → LocalRuntimeHost builds DefaultRuntimeBuilder
  → createDefaultTools / definitions.ts:1148:
        submitExecutor = enableSubmitAndExit ? executors.submit : undefined
        → both conjuncts false → submit_and_exit NOT added to finalTools
```

### The canonical composed effective host authorization (reviewer correction)

The capability must derive from the **already-composed effective
authorization state**, NOT from any one ingredient (per-session override
OR persisted settings). The LIVENESS02 specimen established user-facing
Seatbelt-YOLO via persisted `autoApprovalSettings.actions.* = true`;
narrowing the capability to one internal source would silently miss
that path.

```text
apps/vscode/src/sdk/sdk-tool-policies.ts:359
  getCommandHostAuthorization(toolName, settings, mcpHub?, ctx?, toolInput?)
    → base host authorization
       - command tool + executeSafeCommands: mode = "safe-only"
       - otherwise:                          mode = "manual"

apps/vscode/src/sdk/session-auto-approval.ts:209
  resolveSessionHostAuthorization(baseAuth, override)
    → undefined       if override !== "all"
    → { ...base, mode: "all" }   if override === "all"

apps/vscode/src/sdk/sdk-tool-policies.ts:953
  isToolAutoApproved(toolName, settings, mcpHub?, override = "none")
    → per-tool boolean used for non-command tool path
    → override === "all" widens per-tool auto-approval gates
       (readFiles, editFiles, useBrowser, useMcp)

apps/vscode/src/sdk/SdkController.ts:861, 875-876
  composed effective host authorization =
    resolveSessionHostAuthorization(baseAuth, override) ?? baseAuth
```

So the canonical answer to "may this session execute autonomously
under effective Seatbelt?" is:

```text
SeatbeltYoloEffective =
  effectiveHostAuthorization.mode === "all"
  AND
  all effective tool auto-approve gates are true
  (readFiles + editFiles + useBrowser + useMcp + executeSafeCommands)
```

Both `getOverride(sessionId) === "all"` (session-level UI) AND
persisted `autoApprovalSettings.actions.* = true` (without session
override) are valid contributors. The composition already exists at
SdkController.ts:861-876; this ACT **does not rebuild it**.

### Phase-0 finding: NO canonical session-level "Seatbelt-YOLO effective" boolean exists today

This ACT's reviewer-corrected recon (after `a58db0c20`) confirmed:

```text
# Result of grep -rn 'isSeatbeltYolo|effectiveAuthorization|sessionAutonomy|yoloActive|session.*yolo' \
  apps/vscode/src sdk/packages  (excluding tests + dist):
  (no matches)

# apps/vscode/src/shared/AutoApprovalSettings.ts:
#   No single "isYolo" boolean. Only:
#   - enabled: boolean        (legacy; always true)
#   - actions: { readFiles, editFiles, executeSafeCommands, useBrowser, useMcp }
# Per-tool gates ARE the encoding of "user intended YOLO".

# apps/vscode/src/hosts/vscode/vscode-to-file-migration.ts:264:
#   "The YOLO mode and auto-approve-all toggles were removed: both were
#    blanket 'run without asking' switches that bypassed the per-action
#    auto-approval settings. To keep previously-unattended setups
#    unattended, a user who had either toggle enabled gets every
#    auto-approval action enabled instead."

# apps/vscode/src/sdk/SdkController.ts:861:
#   Per-tool, per-call resolution. NO session-wide semantic.
```

So **no production owner of "this session is in ALL authorization mode"
exists**. The composed `effectiveHostAuthorization` is per-tool / per-call,
not session-wide.

Per the reviewer's Outcome B: do not pretend the canonical session
authority exists. Do not reconstruct one inside `cline-session-factory.ts`.

### Phase-0 decision: introduce a tiny canonical session-level helper (separately reviewed authority seam)

The cleanest V1 path is to introduce a **small, dependency-injected,
testable helper** that answers the session-wide question exactly once,
at a clearly-scoped boundary:

```text
apps/vscode/src/sdk/session-auto-approval.ts
  // EXTEND existing module (where the override already lives)
  isSeatbeltYoloSessionEnabled(
    persisted: AutoApprovalSettings,    // from StateManager.getGlobalSettingsKey("autoApprovalSettings")
    override: SessionAutoApprovalOverride,  // from getOverride(sessionId)
  ): boolean
```

Contract:

```text
isSeatbeltYoloSessionEnabled(persisted, override) =
  // authoritative composition for "this session may execute autonomously"
  //
  // The persisted `actions.*` IS the canonical user-intent encoding
  // for "user wants YOLO" (see vscode-to-file-migration.ts:264). We read
  // the FULL set of gates the legacy YOLO toggle would have enabled.
  // Future categories added to AutoApprovalSettings.actions that are
  // part of the YOLO semantic will extend this check at one location.
  &&
  override is consistent with the persisted state
  (override = "all" implies the persisted state is also YOLO-on;
   override = "none" with all actions.* true is also YOLO-effective;
   override = "none" with any actions.* false is NOT YOLO-effective)
```

Why this is the right seam:

```text
- Single owner. IMPLEMENTATION01 + any future Seatbelt-YOLO policy
  reads this helper. Not a second implementation.
- Dependency-injected. cline-session-factory.ts receives the helper;
  does not reconstruct.
- Testable. RED can pin the helper against every action.* combination
  without touching runtime construction.
- Lives next to the override (session-auto-approval.ts). The override
  IS the only SessionAutoApprovalOverride owner; the helper composes
  the override with the persisted settings encoding.
- NOT in cline-session-factory.ts (per HALT_SEAM_MOVED stop rule).
- NOT in the core runtime (SDK @cline/core is a host-executor contract,
  not a user-intent authority).
```

If during implementation the helper proves impossible to scope cleanly
(e.g. requires surgery to multiple modules), HALT_SEAM_MOVED.

The completion detection wire side is already complete:

```text
apps/vscode/src/sdk/message-translator.ts:882
  return toolName === "submit_and_exit" || toolName === "attempt_completion"

apps/vscode/src/sdk/message-translator.ts:343-352
  private attemptCompletionSeen = false; markAttemptCompletionSeen()
  // sets on submit_and_exit or attempt_completion content_end

apps/vscode/src/sdk/message-translator.ts:365-382
  private terminalResponseCommittedThisTurn = false; ...

apps/vscode/src/sdk/message-translator.ts:1362, 1631
  completion tool handler — produces say="completion_result" + turn phase flip
```

So this ACT's only NEW production surface is:

```text
(a) NEW helper: apps/vscode/src/sdk/session-auto-approval.ts
    export function isSeatbeltYoloSessionEnabled(
      persisted: AutoApprovalSettings,
      override: SessionAutoApprovalOverride,
    ): boolean
    (small, pure, testable; the canonical session-level YOLO semantic)

(b) derive explicitCompletionAuthority from
    isSeatbeltYoloSessionEnabled(persisted, getOverride(sessionId))
    at buildSessionConfig; consume via dependency injection
(c) when derived true:
      config.enableSubmitAndExit = true     (NEW field on CoreSessionConfig)
(d) populate toolExecutors.submit in VscodeSessionHost.create when (a) is true
(e) implement apps/vscode/src/sdk/vscode-submit-executor.ts (NEW)
    - PASSIVE host-facing executor (see §5)
```

## 2. Phase 1 — RED at the real production seam

Two REDs:

(a) Helper RED — pin `isSeatbeltYoloSessionEnabled` against every
    persisted/override combination:

```text
persisted { all 5 actions true } + override "none"
  → isSeatbeltYoloSessionEnabled = true   (YOLO via persisted alone)

persisted { any actions.* false } + override "all"
  → isSeatbeltYoloSessionEnabled = true   (YOLO via session override)

persisted { any actions.* false } + override "none"
  → isSeatbeltYoloSessionEnabled = false

persisted { all 5 actions true } + override "all"
  → isSeatbeltYoloSessionEnabled = true   (both routes agree)

future-category regression:
  add a hypothetical "skills" action; persisted must include it
  for the helper to return true; helper is the single owner of the
  YOLO-gate set
```

(b) Integration RED — bind the helper to the real VS Code seam:

```text
Given:
  source                   = VS Code interactive
  config.mode              = "act"
  isSeatbeltYoloSessionEnabled(persisted, getOverride(sessionId)) = true
  explicitCompletionAuthority = true   (derived at buildSessionConfig)

Expect:
  resolved enableSubmitAndExit   = true
  toolExecutors.submit           = present   (host-side executor)
  submit_and_exit ∈ finalTools   = true
  lifecycle.completesRun         = true
  completionPolicy.requireCompletionTool = true

Current (LIVENESS02 binding):
  resolved enableSubmitAndExit   = false    (ToolPresets.act fallback)
  toolExecutors.submit           = absent
  submit_and_exit ∉ finalTools
  completionPolicy               = undefined
```

If the helper RED does not pass, HALT_RED_NOT_REPRODUCED. If the
integration RED does not pass after the helper is GREEN,
HALT_SEAM_MOVED.

## 3. Phase 2 — necessity discriminator

Pin the registration conjunction (already known from LIVENESS02
§10b.5.1; verified here at the production seam):

```text
A. enableSubmitAndExit=true,   submit executor absent   → submit_and_exit absent
B. enableSubmitAndExit=false,  submit executor present  → submit_and_exit absent
C. enableSubmitAndExit=true,   submit executor present  → submit_and_exit present
```

The implementation must flip BOTH conjuncts. Do not use `mode="yolo"`
as the manipulated variable (violates CONTRACT01 I3).
## 4. Phase 3 — capability derivation

For V1, keep the capability **derived**, not persisted, AND derive
from the canonical session-level helper introduced in this ACT:

```text
explicitCompletionAuthority =
  interactiveVsCode
  AND isSeatbeltYoloSessionEnabled(persisted, getOverride(sessionId))
```

`isSeatbeltYoloSessionEnabled` lives at
`apps/vscode/src/sdk/session-auto-approval.ts` (the existing override
module). Its contract:

```text
isSeatbeltYoloSessionEnabled(persisted, override) =
  // authoritative session-wide YOLO semantic.
  // The persisted `actions.*` IS the canonical user-intent encoding
  // for "user wants YOLO" (see vscode-to-file-migration.ts:264). We
  // read the FULL set of gates the legacy YOLO toggle would have
  // enabled. Future categories added to AutoApprovalSettings.actions
  // that are part of the YOLO semantic extend this check at one
  // location.
  persisted.actions.readFiles
  && persisted.actions.editFiles
  && persisted.actions.executeSafeCommands
  && persisted.actions.useBrowser
  && persisted.actions.useMcp
  && override is consistent with persisted state
     (override = "all" implies persisted is also YOLO-on;
      override = "none" with all actions.* true is also YOLO-effective;
      override = "none" with any actions.* false is NOT YOLO-effective)
```

The helper is the **single owner** of the session-wide YOLO semantic.
IMPULEMENTATION01 + any future Seatbelt-YOLO policy read this helper.
It is dependency-injected into `cline-session-factory.ts` (the
session-config builder) — never reconstructed inline.

If during implementation the helper proves impossible to scope cleanly
(e.g. requires surgery to multiple modules), HALT_SEAM_MOVED.

```text
DO NOT add (in V1):
  - new globalState key
  - new workspaceState key
  - new ExtensionState field
  - new UI toggle
  - new persisted preference
  - new "isYoloSession" / "SessionXoloEffective" sentinel
    anywhere else (the helper is the single owner)
```

If a future ACT wants user decoupling, that's a separate product slice.

## 5. Phase 4 — VS Code submit executor (new file)

New file: `apps/vscode/src/sdk/vscode-submit-executor.ts`

The executor is **PASSIVE** — a host-side capability satisfying the
host-executor API contract. It does **not** independently drive any
completion authority; the existing runtime event flow remains the
sole route into `MessageTranslator` completion authority.

Required invariants:

```text
executor accepts/returns the submitted summary according to the
  host-executor API contract (mirror CLI's submit: submitAndExitInTerminal)

executor does NOT stamp "completed"
executor does NOT mutate turnState.phase
executor does NOT synthesize completion_result
executor does NOT post to webview directly
executor does NOT publish through message-translator
executor does NOT retag messages
```

Completion authority remains in the existing layer:

```text
submit_and_exit tool call occurs
→ core/runtime invokes VS Code submit executor (returns summary)
→ existing runtime tool-event stream drives MessageTranslator authority
  (message-translator.ts:882, 343-352, 365-382, 1362, 1631)
→ terminal response committed
→ completed phase flip
→ authoritative Completed framing
```

Mirror upstream CLI's `submit: submitAndExitInTerminal` injection
pattern: thin host-side executor that returns the submitted summary;
the runtime owns the completion semantics and event flow.

## 6. Phase 5 — GREEN composition

```text
isSeatbeltYoloSessionEnabled(persisted, getOverride(sessionId)) = true
  + mode="act"
  + interactiveVsCode

  → explicitCompletionAuthority = true (derived, not persisted)
  → resolved enableSubmitAndExit = true   (via CoreSessionConfig override)
  → VS Code submit executor present       (via toolExecutors.submit)
  → submit_and_exit registered            (definitions.ts:1148 predicate)
  → completesRun = true
  → requireCompletionTool = true
```

No `config.mode` transition. No flipped yolo preset.
## 7. Phase 6 — conservation suite (CAI-01..CAI-12)

```text
CAI-01A persisted Seatbelt-YOLO state
       (all canonical auto-approval gates true; no session override)
       → isSeatbeltYoloSessionEnabled(persisted, "none") = true
       → explicitCompletionAuthority = true
       → submit_and_exit present + required
       (proves persisted-only path converges; helper returns true)

CAI-01B per-session "ALL — this task" override
       (any persisted state; override = "all")
       → isSeatbeltYoloSessionEnabled(persisted, "all") = true
       → explicitCompletionAuthority = true
       → submit_and_exit present + required
       (proves session-override path converges; helper returns true)

CAI-02 manual Act / mixed state
       (override = "none" AND any persisted actions.* false)
       → isSeatbeltYoloSessionEnabled(persisted, "none") = false
       → explicitCompletionAuthority = false
       → submit_and_exit absent
       → historical toolset/policy unchanged

CAI-03 Plan mode
       → unchanged (capability is interactive-VS-Code only)

CAI-04 capability OFF
       → submit_and_exit absent (today's behavior)

CAI-05 host without submit executor
       → supported / fail closed; no fake registration
       (CLI host explicitly supplies submit — its own ACT owns CLI behavior)

CAI-06 explicit successful submit
       → authoritative completion exactly once

CAI-07 failed/partial submit
       → no authoritative Completed framing

CAI-08 plain final text while capability required
       → bounded completion reminder (via existing mistake/retry budget)
       → no premature run completion

CAI-09 ask_question / genuine follow-up
       → remains valid

CAI-10 spawn/team routing
       → unchanged (enableSpawnAgent / enableAgentTeams forced false)

CAI-11 config.mode
       → remains "act"

CAI-12 no text/tail-derived completion authority
       (text-based "completed" framing must not be inferred
        from assistant prose; submit_and_exit is the only path)
```

CAI-01A/01B/02/04/06/07/08/11/12 are load-bearing. CAI-01A/01B/02
specifically exercise the new `isSeatbeltYoloSessionEnabled` helper
without asserting anything about per-tool semantics — they test the
helper's two input routes converge.

## 8. Phase 7 — bounded retry behavior

```text
plain final text
while explicitCompletionAuthority=true
→ reminder / retry
→ bounded by existing mistake / retry limit
```

Never introduce an infinite completion loop. The existing
message-translator + retry budget (already in place per upstream +
CONTRACT01 invariant I5) is the existing mechanism; this ACT does not
re-invent it.

## 9. Phase 8 — exact-head qualification

```text
SOURCE_HEAD
SOURCE_TREE
VERSION
VSIX_PATH
VSIX_BYTES
VSIX_SHA256
INSTALLED_VERSION
```

Launch with:

```bash
CLINEMM_PTAD=1 codium .
```

Success signature:

```text
submit_and_exit observed               = true
attemptCompletionSeen                  = true
terminalResponseCommittedThisTurn      = true
runtimeStatus                          = completed
turnState.phase                        = completed
authoritative completion_result        = present
Completed framing                      = visible
```

Negative-path specimen (force completion failure / no commit):

```text
Completed framing                      = absent
```
## 10. Stop rules

```text
HALT_RED_NOT_REPRODUCED
HALT_SEAM_MOVED                              (canonical auth helper
                                              cannot be reused without
                                              architectural surgery)
HALT_CORE_YOLO_PRESET_SCOPE_CREEP
HALT_NEW_PERSISTED_SETTING_REQUIRED
HALT_DUPLICATE_COMPLETION_AUTHORITY
HALT_TEXT_DERIVED_COMPLETION
HALT_TAIL_DERIVED_COMPLETION
HALT_UNBOUNDED_COMPLETION_RETRY
HALT_MANUAL_ACT_REGRESSION
HALT_PLAN_MODE_REGRESSION
HALT_SDK_HOST_SCOPE_CREEP
```

Only a new P0 stops the chain.

## 11. Acceptance criteria

```text
[ ] Helper RED passes:
    isSeatbeltYoloSessionEnabled(persisted, override) is correct for
    every persisted/override combination (CAI-01A/01B/02 inputs).
[ ] Integration RED at the real VS Code runtime-builder seam reproduces
    (LIVENESS02's composition_proven_absent claim).
[ ] Implementation flips BOTH conjuncts
    (enableSubmitAndExit AND toolExecutors.submit) without
    flipping config.mode.
[ ] Capability derives from isSeatbeltYoloSessionEnabled
    (single owner; dependency-injected). NOT reconstructed inline.
[ ] CAI-01A AND CAI-01B AND CAI-02..CAI-12 conservation tests pass.
[ ] Manual Act path (override = "none" AND any persisted actions.* false)
    is unchanged (bit-equivalent toolset/policy for the no-Seatbelt user).
[ ] Plan mode is unchanged.
[ ] No new persisted setting / UI toggle introduced in V1.
[ ] No core yolo preset import.
[ ] Submit executor is PASSIVE: it accepts/returns the submitted summary
    per the host-executor API contract; it does NOT stamp completed /
    mutate turnState.phase / synthesize completion_result /
    publish through message-translator / post to webview / retag messages.
    The existing runtime event flow remains the sole completion authority.
[ ] exact-head VSIX built; live dogfood via CLINEMM_PTAD=1 captures
    the success signature AND the negative-path signature.
[ ] git diff --check passes; typecheck + lint + workspace tests PASS.
[ ] Board state updated to reflect closure or RED.
```

## 12. Exit

Target verdict: `PASS_SEATBELT_YOLO_EXPLICIT_COMPLETION_AUTHORITY_V1`

Supported claim (per CONTRACT01 §12):

> In interactive VS Code ClineMM, Seatbelt-YOLO independently enables
> explicit completion authority without changing conversational Act mode
> or importing the core YOLO preset; successful autonomous completion
> requires the canonical completing tool, and failed/non-authoritative
> termination never receives task-level Completed framing.

After closure:

```text
EDITOR-TOOL-APPROVAL-FRICTION-RECON01 → NEXT
```

## 13. Provenance

```text
Contract: ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-CONTRACT01 (CLOSED)
Recon:    ACT-CLINEMM-COMPLETION-PROTOCOL-LIVENESS02 (CLOSED)
Spec:     LIVENESS02 §10b.5.1 composition proof (binding configuration)
          LIVENESS02 §10b.5.2 registration preconditions
          CONTRACT01 §3 (A/B/C alternatives) + §12 decision (Option C)
          CONTRACT01 invariants I1..I7 (must hold under GREEN)

Construction seam:
  apps/vscode/src/sdk/cline-session-factory.ts:736 (buildSessionConfig)
  apps/vscode/src/sdk/cline-session-factory.ts:1009 (config.mode = "act")
  apps/vscode/src/sdk/vscode-session-host.ts:142 (create)
  apps/vscode/src/sdk/vscode-session-host.ts:159-186 (toolExecutors)
  sdk/packages/core/src/extensions/tools/definitions.ts:1148
    (submitExecutor = enableSubmitAndExit ? executors.submit : undefined)
  sdk/packages/core/src/extensions/tools/presets.ts:34
    (ToolPresets.act.enableSubmitAndExit = false — current default)

Capability anchor (canonical session-wide YOLO semantic):
  // NEW helper introduced by THIS ACT at the existing override module.
  apps/vscode/src/sdk/session-auto-approval.ts
    export function isSeatbeltYoloSessionEnabled(
      persisted: AutoApprovalSettings,
      override: SessionAutoApprovalOverride,
    ): boolean

  // Why not reuse the per-tool / per-call helpers?
  // getCommandHostAuthorization / resolveSessionHostAuthorization /
  // isToolAutoApproved all answer per-tool, per-call questions.
  // No canonical session-wide "is this session in ALL authorization
  // mode" boolean exists today (see §1 Phase-0 finding). The helper is
  // the single owner; any future Seatbelt-YOLO policy reads it; not
  // reconstructed inline.

Wire-side completion detection (already complete):
  apps/vscode/src/sdk/message-translator.ts:882, 343-352, 365-382,
    1362, 1631
  (recognizes submit_and_exit + attempt_completion, drives
   attemptCompletionSeen + terminalResponseCommittedThisTurn)

Owning epic: EPIC-CLINEMM-RUNTIME-TASK-PROGRESSION01
Companion (after closure):
  ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01 → NEXT
```
