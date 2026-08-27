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

### Phase-0 finding B: SEATBELT_SELECTED ≠ SEATBELT_AVAILABLE (reviewer at `636d15c31`)

The previous plan (`636d15c31`) bound the capability to
`SEATBELT_EFFECTIVE := resolveExperimentalSandboxMode() === "seatbelt-experimental"`.
That is an evidence-class promotion: the function only proves the
user **selected** Seatbelt, not that the substrate is **available**
(kernel accepts SBPL, binary present, probe round-trips).

The reviewer-corrected plan (`3e2865f34`) introduced the
`getSandboxBackend` check, but mislabeled the resulting conjunction as
`SEATBELT_EFFECTIVE`. That label implies **enforcement** — which is
not what the cached availability probe establishes. Enforcement
happens per-command at `backend.prepare()` time and is fail-closed
via the existing `CommandJobManager.start()` contract.

The four-state Seatbelt lifecycle (precise terminology):

```text
SELECTED   = resolveExperimentalSandboxMode() === "seatbelt-experimental"
             (user/env-var requested Seatbelt)

AVAILABLE  = getSandboxBackend("seatbelt-experimental",
             { mode: "seatbelt-experimental" }) !== undefined
             (cached probe: darwin + /usr/bin/sandbox-exec + minimal SBPL
              round-trips successfully)

PREPARED   = backend.prepare({cap, cmd}) succeeded
             (per-invocation; throws on fail; the canonical
              fail-closed contract already lives in
              CommandJobManager.start() at
              apps/vscode/src/sdk/command-job-manager.ts:574-688)

ENFORCED   = the kernel is actually constraining the running child
             = SEATBELT_PREPARED && spawn returned
             (per-execution; not observable at session construction)
```

At session construction time, only SELECTED and AVAILABLE are
knowable. PREPARED and ENFORCED are per-command / per-execution facts
that the capability derivation deliberately does not depend on; they
are guarded by their own per-invocation fail-closed contract.

CAI-13's intended negative (YOLO requested + Seatbelt ineffective →
authority OFF) was excellent in spirit, but with the old binding it
actually tested "YOLO requested + Seatbelt NOT selected → authority
OFF", which is the trivial case. The load-bearing case — "YOLO
requested + Seatbelt selected + substrate broken → authority OFF" —
is what the corrected plan now covers as **CAI-13B**.

### Phase-0 decision: separate four facts, single helper per fact

The reviewer-corrected finding (after `7d999f4ff`) established that the
prior formulation of "isSeatbeltYoloSessionEnabled" silently conflated
**two distinct facts**:

```text
- USER_INTENT:    "this session requested autonomous execution"
- SAFETY_STATE:   "Seatbelt is available for enforcement"
- PRODUCT_CAP:    "explicit completion authority is granted to the runtime"
```

Conflating them in a single function promotes **user-intent** to
**safety-effective**, which is the evidence-category promotion
Factory normally forbids. It also produces a contract contradiction
when `override === "all"` (which widens authorization) is required to
imply a YOLO-on persisted state (which the override does not in fact
require).

The cleanest V1 architecture is therefore:

```text
fact 1 — YOLO_REQUESTED       (helper, owner = session-auto-approval.ts)
fact 2a — SEATBELT_SELECTED   (canonical: resolveExperimentalSandboxMode)
fact 2b — SEATBELT_AVAILABLE  (canonical: getSandboxBackend)
fact 3 — explicitCompletionAuthority = interactiveVsCode
                                    && YOLO_REQUESTED
                                    && SEATBELT_SELECTED
                                    && SEATBELT_AVAILABLE
```

#### Fact 1 helper (YOLO session-request intent)

```text
apps/vscode/src/sdk/session-auto-approval.ts
  // EXTEND existing module (where the override already lives)
  export function isYoloSessionRequested(
    persisted: AutoApprovalSettings,
    override: SessionAutoApprovalOverride,
  ): boolean
```

Contract (unambiguous — one rule only):

```text
isYoloSessionRequested(persisted, override) =
  override === "all"                         // session-level UI widens
  ||
  (
    persisted.actions.readFiles
    && persisted.actions.editFiles
    && persisted.actions.executeSafeCommands
    && persisted.actions.useBrowser
    && persisted.actions.useMcp
  )                                            // OR all canonical persisted
                                              // auto-approval actions enabled
```

Truth table:

```text
persisted all-true  + override "none" → true   (YOLO via persisted alone)
persisted mixed     + override "all"  → true   (YOLO via session override)
persisted mixed     + override "none" → false
persisted all-true  + override "all"  → true   (both routes agree)
```

Why the name is `isYoloSessionRequested` and not
`isSeatbeltYoloSessionEnabled`:

```text
- It answers "user wants autonomous execution", NOT
  "Seatbelt is available".
- "Seatbelt available" is a separate, canonical fact (fact 2).
- CLI --yolo (which is independent of VS Code auto-approval per
  upstream distinction) is also NOT this helper's concern.
- Future ACTs that need a different intent axis (e.g. a future
  "policies" subsystem) can compose with this helper without
  re-defining what it means.
```

#### Fact 2 reuse (canonical Seatbelt AVAILABLE authority)

The reviewer-corrected recon (after `636d15c31`) proved that the
prior binding — `SEATBELT_EFFECTIVE := resolveExperimentalSandboxMode()
=== "seatbelt-experimental"` — was a load-bearing evidence error. That
function only proves **selection** (the user requested Seatbelt via
`CLINEMM_EXPERIMENTAL_SANDBOX`), not that Seatbelt is actually
**enforcing** (kernel accepts SBPL, binary present, probe round-trips).

The Seatbelt lifecycle has four distinct states (precise terminology):

```text
1. SELECTED   resolveExperimentalSandboxMode() === "seatbelt-experimental"
                (configuration fact; user requested Seatbelt)
2. AVAILABLE  (await getSandboxBackend("seatbelt-experimental",
                { mode: "seatbelt-experimental" })) !== undefined
                (substrate capability fact; cached probe succeeded)
3. PREPARED   backend.prepare({cap, cmd}) succeeded
                (per-invocation; throws on fail)
4. ENFORCED   the kernel is actually constraining the running child
                (= PREPARED && spawn returned; per-execution)
```

The "RESOLVED" substate (sandboxBackendResolver(mode) !== undefined)
is subsumed by AVAILABLE: `getSandboxBackend` is the canonical
composition of selection + opt-in + cached-availability-probe.

`getSandboxBackend(mode, optIn)` from
`sdk/packages/core/src/runtime/sandbox/sandbox-backend.ts:73` is the
canonical "is the Seatbelt substrate authorized AND available" check
at the dispatcher layer. It returns the cached
`SeatbeltSandboxBackendExperimental` **iff**:

```text
- mode === "seatbelt-experimental"      (selection)
- optIn provided                        (authorization)
- backend.isAvailable() === true        (cached availability probe:
                                         darwin + /usr/bin/sandbox-exec
                                         present + minimal SBPL
                                         round-trips successfully)
```

See `sdk/packages/core/src/runtime/sandbox/sandbox-backend.ts:73-100`
and `seatbelt-availability.ts:76-120` for the canonical evidence.

The canonical V1 fact (per-session, observable at buildSessionConfig):

```text
SEATBELT_AVAILABLE =
  resolveExperimentalSandboxMode() === "seatbelt-experimental"
  &&
  (await getSandboxBackend("seatbelt-experimental",
                           { mode: "seatbelt-experimental" }))
    !== undefined
```

This is **SELECTED AND AVAILABLE** — i.e. the substrate is
configured, opt-in is granted, and the kernel actually accepts SBPL
profiles. It does **not** prove that the next command's
`backend.prepare()` will succeed; that is a per-invocation fact
resolved at `CommandJobManager.start()` time (PREPARED), where the
per-command fail-closed contract already lives. Capability derivation
is per-session, not per-command, so the canonical authority at
session-construction time is the AVAILABLE check (not the per-command
PREPARED check).

The IMPLEMENTATION01 ACT does not introduce a new Seatbelt state; it
reuses the existing `getSandboxBackend` and threads its non-undefined
result into the capability derivation. The resolver signature is
`async` and `buildSessionConfig` is already `async`, so awaiting is
free.

#### Fact 3 capability derivation (production seam)

```text
apps/vscode/src/sdk/cline-session-factory.ts:736
  explicitCompletionAuthority =
    interactiveVsCode
    && isYoloSessionRequested(
         stateManager.getGlobalSettingsKey("autoApprovalSettings"),
         getOverride(sessionId),
       )
    && resolveExperimentalSandboxMode() === "seatbelt-experimental"
    && (await getSandboxBackend("seatbelt-experimental",
                                 { mode: "seatbelt-experimental" }))
         !== undefined
```

Both `isYoloSessionRequested` and `getSandboxBackend` are imported as
canonical helpers; neither is reconstructed inline. The capability
derivation awaits the AVAILABLE check.

Invariant (preserved; not changed by this ACT):

```text
Any command requiring Seatbelt:
  prepare() failure → CommandJobManager.start() returns
                     buildSandboxUnavailableResult() and the command
                     fails closed; the unsandboxed path is never taken.
  (apps/vscode/src/sdk/command-job-manager.ts:574-688)
```

If during implementation either helper proves impossible to scope
cleanly (e.g. surgery to multiple modules, or `getSandboxBackend` is
not actually canonical at the construction site, or
`buildSessionConfig` cannot be made async-safe for the awaited
call), HALT_SEAM_MOVED.

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
    export function isYoloSessionRequested(
      persisted: AutoApprovalSettings,
      override: SessionAutoApprovalOverride,
    ): boolean
    (small, pure, testable; single owner of "YOLO intent" semantic;
     does NOT touch Seatbelt state)

(b) REUSE existing canonical Seatbelt AVAILABLE authority at the
    production seam:
      SEATBELT_AVAILABLE = resolveExperimentalSandboxMode()
                              === "seatbelt-experimental"
                           && (await getSandboxBackend(
                                 "seatbelt-experimental",
                                 { mode: "seatbelt-experimental" },
                               )) !== undefined
    (SELECTED AND authorization AND cached-availability-probe-ok;
     imported from sdk/packages/core; NOT reconstructed inline.
     The per-command PREPARED state is owned by the existing
     CommandJobManager.start() fail-closed contract and is
     NOT a session-construction concern.)

(c) derive explicitCompletionAuthority at buildSessionConfig from
    the conjunction: interactiveVsCode && isYoloSessionRequested(...)
                           && SEATBELT_SELECTED && SEATBELT_AVAILABLE
    (consumed via dependency injection; no inline reconstruction;
     buildSessionConfig is already async; await is free)

(d) when derived true:
      config.enableSubmitAndExit = true     (NEW field on CoreSessionConfig)

(e) populate toolExecutors.submit in VscodeSessionHost.create when (c) is true

(f) implement apps/vscode/src/sdk/vscode-submit-executor.ts (NEW)
    - PASSIVE host-facing executor (see §5)
```

## 2. Phase 1 — RED at the real production seam

Three REDs:

(a) Helper RED — pin `isYoloSessionRequested` against every
    persisted/override combination:

```text
persisted { all 5 actions true } + override "none"
  → isYoloSessionRequested = true   (YOLO via persisted alone)

persisted { any actions.* false } + override "all"
  → isYoloSessionRequested = true   (YOLO via session override)

persisted { any actions.* false } + override "none"
  → isYoloSessionRequested = false

persisted { all 5 actions true } + override "all"
  → isYoloSessionRequested = true   (both routes agree)
```

(b) Schema-coverage RED — every currently-canonical
    `AutoApprovalSettings.actions` key participates in the persisted
    YOLO classification:

```text
iterate the keys actually present on DEFAULT_AUTO_APPROVAL_SETTINGS.actions
  (the runtime default settings object in
   apps/vscode/src/shared/AutoApprovalSettings.ts) — this is the
   authoritative key inventory at runtime
  → for each currently-declared key, the helper must include
    persisted.actions[key] in the persisted-YOLO conjunction
  → when a new action key is added to AutoApprovalSettings.actions
    in the future, the schema-coverage test breaks compile-time,
    forcing the policy owner to decide whether the new key belongs
    to YOLO semantics (not a hypothetical future key)
```

(c) Integration RED — bind the helper to the real VS Code seam:

```text
Given:
  source                   = VS Code interactive
  config.mode              = "act"
  isYoloSessionRequested(persisted, getOverride(sessionId)) = true
  SEATBELT_SELECTED        = true   (resolveExperimentalSandboxMode)
  SEATBELT_AVAILABLE       = true   (getSandboxBackend !== undefined)
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

Critical negative matrix (load-bearing, prevents ordinary "approve
everything" from being indistinguishable from Seatbelted YOLO):

```text
CAI-13A
  isYoloSessionRequested(persisted, getOverride(sessionId)) = true
  SEATBELT_SELECTED  (resolveExperimentalSandboxMode === "seatbelt-experimental") = false
  → explicitCompletionAuthority = false

CAI-13B   ← load-bearing
  isYoloSessionRequested(persisted, getOverride(sessionId)) = true
  SEATBELT_SELECTED                                              = true
  SEATBELT_AVAILABLE  (getSandboxBackend(..., optIn) !== undefined) = false
  → explicitCompletionAuthority = false
  (this is the substrate-broken case the prior plan missed;
   requires a mocked getSandboxBackend returning undefined
   under SEATBELT_SELECTED)

CAI-13C
  isYoloSessionRequested(persisted, getOverride(sessionId)) = true
  SEATBELT_AVAILABLE                                            = true
  → explicitCompletionAuthority = true   (eligibility)

Given the negative cases:
  → enableSubmitAndExit         = false
  → submit_and_exit             = absent
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
from the conjunction of four distinct canonical facts (per §1
Phase-0 findings A+B and Phase-0 decision):

```text
explicitCompletionAuthority =
  interactiveVsCode
  AND isYoloSessionRequested(persisted, getOverride(sessionId))
  AND resolveExperimentalSandboxMode() === "seatbelt-experimental"
                                   (SEATBELT_SELECTED)
  AND (await getSandboxBackend("seatbelt-experimental",
                                { mode: "seatbelt-experimental" }))
        !== undefined              (SEATBELT_AVAILABLE)
```

Fact 1 helper (`isYoloSessionRequested`) lives at
`apps/vscode/src/sdk/session-auto-approval.ts` (the existing override
module). Its contract (unambiguous — one rule only):

```text
isYoloSessionRequested(persisted, override) =
  // authoritative YOLO session-request intent (not Seatbelt state).
  // CLI --yolo is a separate axis (upstream distinction) and is
  // NOT this helper's concern.
  override === "all"
  ||
  (
    persisted.actions.readFiles
    && persisted.actions.editFiles
    && persisted.actions.executeSafeCommands
    && persisted.actions.useBrowser
    && persisted.actions.useMcp
  )
```

Fact 2 is two distinct canonical facts and the capability uses the
conjunction of both:

```text
SEATBELT_SELECTED  = resolveExperimentalSandboxMode() === "seatbelt-experimental"
                      apps/vscode/src/sdk/sandbox-policy.ts:127

SEATBELT_AVAILABLE = (await getSandboxBackend("seatbelt-experimental",
                       { mode: "seatbelt-experimental" })) !== undefined
                      sdk/packages/core/src/runtime/sandbox/sandbox-backend.ts:73
```

The four-state Seatbelt lifecycle:

```text
SELECTED   = resolveExperimentalSandboxMode() === "seatbelt-experimental"
              (configuration fact; per-session)
RESOLVED   = sandboxBackendResolver(mode) !== undefined
              (subsumed by AVAILABLE; not a separate fact)
AVAILABLE  = getSandboxBackend(mode, optIn) !== undefined
              (substrate capability fact; per-session; SELECTED + optIn
               + cached kernel probe)
PREPARED   = backend.prepare({cap, cmd}) succeeded
              (per-invocation; fail-closed at CommandJobManager.start())
ENFORCED   = PREPARED && spawn returned
              (per-execution; not observable at session construction)
```

Note the precision: "ENFORCED" is what the previous plan called
"EFFECTIVE" — but that label implies per-execution truth and is
incorrect at session-construction time. The capability uses AVAILABLE
(not ENFORCED); PREPARED is delegated to the existing
`CommandJobManager.start()` fail-closed contract.

The four facts stay separate:

```text
YOLO_REQUESTED        = isYoloSessionRequested(...)                          (helper)
SEATBELT_SELECTED     = resolveExperimentalSandboxMode() === "seatbelt-experimental"   (existing)
SEATBELT_AVAILABLE    = (await getSandboxBackend(...)) !== undefined         (existing)
COMPLETION_AUTHORITY  = interactiveVsCode
                          && YOLO_REQUESTED
                          && SEATBELT_SELECTED
                          && SEATBELT_AVAILABLE                             (derived)
```

Both `isYoloSessionRequested` and `getSandboxBackend` are imported as
canonical helpers; neither is reconstructed inline. The capability
derivation awaits the AVAILABLE check (buildSessionConfig is already
async).

If during implementation either proves impossible to scope cleanly
(e.g. surgery to multiple modules, or
`resolveExperimentalSandboxMode` / `getSandboxBackend` is not actually
canonical at the construction site), HALT_SEAM_MOVED.

```text
DO NOT add (in V1):
  - new globalState key
  - new workspaceState key
  - new ExtensionState field
  - new UI toggle
  - new persisted preference
  - new "isYoloSession" / "SessionXoloAvailable" / "SessionXoloEffective"
    sentinel anywhere else (the helper is the single owner of YOLO
    intent; the sandbox-policy module is the single owner of
    SEATBELT_SELECTED; the sandbox-backend module is the single
    owner of SEATBELT_AVAILABLE)
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
isYoloSessionRequested(persisted, getOverride(sessionId)) = true
  AND resolveExperimentalSandboxMode() === "seatbelt-experimental"
  AND (await getSandboxBackend("seatbelt-experimental",
                                { mode: "seatbelt-experimental" })) !== undefined
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
## 7. Phase 6 — conservation suite (CAI-01..CAI-13)

```text
CAI-01A persisted Seatbelt-YOLO state
       (all canonical auto-approval gates true; no session override)
       → isYoloSessionRequested(persisted, "none") = true
       AND SEATBELT_AVAILABLE                      = true
         (resolveExperimentalSandboxMode === "seatbelt-experimental"
          && getSandboxBackend("seatbelt-experimental",
              { mode: "seatbelt-experimental" }) !== undefined)
       → explicitCompletionAuthority = true
       → submit_and_exit present + required
       (proves persisted-only path converges)

CAI-01B per-session "ALL — this task" override
       (any persisted state; override = "all")
       → isYoloSessionRequested(persisted, "all") = true
       AND SEATBELT_AVAILABLE                 = true
       → explicitCompletionAuthority = true
       → submit_and_exit present + required
       (proves session-override path converges)

CAI-02 manual Act / mixed state
       (override = "none" AND any persisted actions.* false)
       → isYoloSessionRequested(persisted, "none") = false
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

CAI-13A negative — YOLO requested + Seatbelt NOT selected
       isYoloSessionRequested(persisted, getOverride(sessionId)) = true
       SEATBELT_SELECTED                                          = false
       → explicitCompletionAuthority = false
       → enableSubmitAndExit         = false
       → submit_and_exit             = absent

CAI-13B  ← load-bearing
       negative — YOLO requested + Seatbelt selected + substrate broken
       isYoloSessionRequested(persisted, getOverride(sessionId)) = true
       SEATBELT_SELECTED                                          = true
       SEATBELT_AVAILABLE  (getSandboxBackend returns defined)    = false
       → explicitCompletionAuthority = false
       (this is the substrate-broken case the prior plan missed;
        cannot be observed without a mocked getSandboxBackend; the
        test must inject a stub returning undefined under
        CLINEMM_EXPERIMENTAL_SANDBOX=seatbelt)

CAI-13C positive — YOLO requested + Seatbelt available
       isYoloSessionRequested(persisted, getOverride(sessionId)) = true
       SEATBELT_AVAILABLE                                            = true
       → explicitCompletionAuthority = true   (eligibility)
       → enableSubmitAndExit         = true
       → submit_and_exit             = present
```

CAI-01A/01B/02/04/06/07/08/11/12/13A/13B/13C are load-bearing.
CAI-01A/01B/02 specifically exercise the new `isYoloSessionRequested`
helper without asserting anything about per-tool semantics — they
test the helper's two input routes converge. CAI-13A/13B/13C
specifically test the Seatbelt AVAILABLE authority at the
SELECTED+AVAILABLE boundary; CAI-13B is the load-bearing substrate-
broken case.

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
    isYoloSessionRequested(persisted, override) is correct for every
    persisted/override combination (CAI-01A/01B/02 inputs).
[ ] Schema-coverage RED passes:
    every key on DEFAULT_AUTO_APPROVAL_SETTINGS.actions
    (apps/vscode/src/shared/AutoApprovalSettings.ts) is included in
    the persisted-YOLO conjunction; adding a new key to
    AutoApprovalSettings.actions breaks the schema-coverage test
    compile-time, forcing the policy owner to decide.
[ ] Integration RED at the real VS Code runtime-builder seam reproduces
    (LIVENESS02's composition_proven_absent claim).
[ ] Implementation flips BOTH conjuncts
    (enableSubmitAndExit AND toolExecutors.submit) without
    flipping config.mode.
[ ] Capability derives from
      interactiveVsCode
      && isYoloSessionRequested(...)
      && resolveExperimentalSandboxMode() === "seatbelt-experimental"
      && (await getSandboxBackend("seatbelt-experimental",
            { mode: "seatbelt-experimental" })) !== undefined
    (four separate canonical facts: user intent + interactivity +
     Seatbelt selection + Seatbelt substrate-available;
     dependency-injected / canonical; NOT reconstructed inline).
[ ] CAI-01A AND CAI-01B AND CAI-02..CAI-13 conservation tests pass.
    CAI-13A/13B/13C test the Seatbelt AVAILABLE authority at the
    SELECTED+AVAILABLE boundary; CAI-13B is load-bearing
    (YOLO requested + Seatbelt selected + substrate broken
     → authority OFF).
[ ] Manual Act path (override = "none" AND any persisted actions.* false)
    is unchanged (bit-equivalent toolset/policy for the no-Seatbelt user).
[ ] Plan mode is unchanged.
[ ] No new persisted setting / UI toggle introduced in V1.
[ ] No new internal "Seatbelt available" sentinel introduced; the
    existing canonical resolveExperimentalSandboxMode and
    getSandboxBackend are reused.
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

Capability anchor (four separate canonical facts):
  // Fact 1 — YOLO session-request intent.
  // NEW helper introduced by THIS ACT at the existing override module.
  apps/vscode/src/sdk/session-auto-approval.ts
    export function isYoloSessionRequested(
      persisted: AutoApprovalSettings,
      override: SessionAutoApprovalOverride,
    ): boolean
    // contract: override === "all"
    //          || (persisted.actions.readFiles
    //              && persisted.actions.editFiles
    //              && persisted.actions.executeSafeCommands
    //              && persisted.actions.useBrowser
    //              && persisted.actions.useMcp)

  // Fact 2a — canonical Seatbelt selector (selection only).
  apps/vscode/src/sdk/sandbox-policy.ts:127
    resolveExperimentalSandboxMode(): SandboxMode | undefined
    // returns "seatbelt-experimental" when Seatbelt is selected
    // (darwin default-on OR explicit opt-in);
    // returns undefined on explicit break-glass
    // CLINEMM_EXPERIMENTAL_SANDBOX=off;
    // throws on unknown values (fail closed).
    // PROVES: selection. NOT: substrate functional availability.

  // Fact 2b — canonical Seatbelt AVAILABLE authority
  // (selection + opt-in + cached substrate probe).
  sdk/packages/core/src/runtime/sandbox/sandbox-backend.ts:73
    export async function getSandboxBackend(
      mode: SandboxMode,
      optIn?: SandboxBackendOptIn,
    ): Promise<SandboxBackend | undefined>
    // returns the cached SeatbeltSandboxBackendExperimental iff
    //   mode === "seatbelt-experimental"
    //   && optIn provided
    //   && SeatbeltSandboxBackendExperimental.isAvailable() === true
    //     (cached probe: darwin + /usr/bin/sandbox-exec present +
    //      minimal SBPL round-trips successfully)
    // returns undefined otherwise. Never throws.
    // PROVES: Seatbelt substrate is selected, authorized, and
    //         available (cached probe ok). NOT: per-command prepare()
    //         will succeed (that is per-invocation at CommandJobManager
    //         and is the PREPARED state).

  // Fact 3 — capability is the conjunction (derived; not persisted).
  // wired at apps/vscode/src/sdk/cline-session-factory.ts:736

  // Why isYoloSessionRequested and not isSeatbeltYoloSessionEnabled?
  // The helper answers "user wants autonomous execution", NOT
  // "Seatbelt is available". Conflating them is the evidence-category
  // promotion Factory normally forbids (see §1 Phase-0 decision).

  // Why reuse getSandboxBackend (not just resolveExperimentalSandboxMode)?
  // The selector alone proves the user selected Seatbelt; the cached
  // availability probe is what proves the substrate is functionally
  // available. Without the availability check, "Seatbelt selected +
  // substrate broken" would silently grant completion authority —
  // CAI-13B's load-bearing case.

  // Why four facts, not one helper that composes them all?
  // CLI --yolo is a separate axis (upstream distinction). VS Code
  // auto-approval is a separate axis. Seatbelt selection is a
  // separate axis. Seatbelt substrate-availability is a separate
  // axis. Forcing them into one function hides the seams.

  // Lifecycle states (precise terminology, per §1 Phase-0 finding B):
  //   SELECTED   = resolveExperimentalSandboxMode() === "seatbelt-experimental"
  //                 (configuration fact; per-session)
  //   AVAILABLE  = getSandboxBackend(mode, optIn) !== undefined
  //                 (substrate capability fact; per-session;
  //                  SELECTED + optIn + cached probe ok)
  //   PREPARED   = backend.prepare({cap, cmd}) succeeded
  //                 (per-invocation; fail-closed at CommandJobManager)
  //   ENFORCED   = PREPARED && spawn returned
  //                 (per-execution; not observable at session construction)
  //
  // Capability uses SELECTED && AVAILABLE (per-session).
  // PREPARED is delegated to the existing CommandJobManager.start()
  // fail-closed contract. ENFORCED is not a session-construction
  // concern.

Wire-side completion detection (already complete):
  apps/vscode/src/sdk/message-translator.ts:882, 343-352, 365-382,
    1362, 1631
  (recognizes submit_and_exit + attempt_completion, drives
   attemptCompletionSeen + terminalResponseCommittedThisTurn)

Owning epic: EPIC-CLINEMM-RUNTIME-TASK-PROGRESSION01
Companion (after closure):
  ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01 → NEXT
```
