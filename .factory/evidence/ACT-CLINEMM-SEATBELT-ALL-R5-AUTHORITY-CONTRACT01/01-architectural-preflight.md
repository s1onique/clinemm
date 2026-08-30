# ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-CONTRACT01 — Phase 0 architectural preflight

> Status: **OPEN / PHASE_0_PREFLIGHT_ONLY**
> Phase: Architectural preflight ONLY. No RED, no repair.
> Date: 2026-08-30
> Source HEAD: 4d1f1ac2d (continuation session)

## §0 — Authorized mission

The user input authorized ONLY this first task:

> `FIRST_TASK = determine whether approval-time code can prove
>  effective Seatbelt enforcement without trusting configuration alone`

This is the preflight for `ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-CONTRACT01`,
a proposed **product-policy change** (not a defect repair) that would
make task-level `ALL` literal within a verified Seatbelt capability
envelope while retaining R5 ASK whenever that envelope is absent.

No production code change is authorized by this preflight.

## §1 — Frozen doctrine

Three durable conclusions from `.factory/epics/approval-protection.md`
govern any bypass proposal:

1. **"Command policy itself does NOT justify a YOLO bypass"**
   (epic line 23). The prior recon closed at
   `PASS_WITH_NONBLOCKING_RESIDUE C1: GO` after the production-
   equivalent composition (real `buildPathAuthorityEvidence` +
   real `realpathSync(workspace)`) collapsed the load-bearing-
   quadrant ASK count from 15 → 3. The remaining 3 are
## §2 — Architectural question

> Can the approval-time policy (`evaluateCommandToolApproval` /
> `evaluateCommandToolApprovalWithPlan` at
> `apps/vscode/src/sdk/SdkController.ts:842..900`,
> `apps/vscode/src/sdk/sdk-tool-policies.ts`,
> `sdk/packages/core/src/runtime/command-policy/command-policy.ts:79..150`)
> truthfully know whether Seatbelt will be effectively enforced
> when the command is executed, **without** trusting configuration
> alone?

Configuration alone is insufficient because:

* The user/operator could enable Seatbelt via setting then disable it
  via `CLINEMM_EXPERIMENTAL_SANDBOX=off` env var at the next launch
  (the documented break-glass).
* `/usr/bin/sandbox-exec` may be unavailable on the host even if the
## §3 — What the source says

### 3.1 The Seatbelt substrate is real and wired into the executor

* `sdk/packages/core/src/runtime/sandbox/macos/seatbelt-backend.ts:1-46`:
  the real Seatbelt backend. `prepare()` canonicalizes paths,
  generates SBPL, writes a profile, materializes the environment,
  returns a `SandboxPreparedInvocation` whose `executable` is
  `/usr/bin/sandbox-exec` and whose `args` are prefixed
  `["-f", <profile-path>]`. **Any failure throws `SandboxError`**.
* `sdk/packages/core/src/runtime/sandbox/types.ts:37`:
  `SandboxMode = "disabled" | "seatbelt-experimental"`. The default
  is `"disabled"`.
* `apps/vscode/src/sdk/sandbox-policy.ts:11-58`: the Wave-1 capability
  builder is the active workspace capability (read+write grant for
  trusted workspace roots; nothing wider).
* `apps/vscode/src/sdk/command-job-manager.ts:204-217`:
  `CommandJobManager` accepts an optional `sandboxBackendResolver` —
  the **sole DI seam** for the experimental sandbox integration.
* `apps/vscode/src/sdk/sandbox-policy.ts:14-21`: production default
  is SECURE-BY-DEFAULT on darwin hosts (unset / "" / "seatbelt" all
  resolve to "seatbelt-experimental"). The only recognized opt-out
  is the explicit break-glass `CLINEMM_EXPERIMENTAL_SANDBOX=off`.

### 3.2 `prepare()` is invoked by the executor, NOT by the policy layer

`CommandJobManager.start(...)` is what calls
`sandboxBackend.prepare(...)` and then spawns
`spawnSupervisableShellCommand(...)`.

The approval-time callback path
(`buildSdkControllerEvaluateCommandToolApproval` at
`apps/vscode/src/sdk/SdkController.ts:842..900`) calls
`evaluateCommandToolApprovalWithPlan(...)`, which calls
`evaluateCommandPolicy(...)` in the SDK. That path **does not call
`sandboxBackend.prepare(...)`**. It composes a
`CommandHostAuthorization` and asks the SDK for a verdict.

The substrate probe (`isAvailable()`) and the per-command
`prepare(...)` are only invoked downstream by
`CommandJobManager.start(...)`.

### 3.3 Consequences

The policy layer at approval time can observe ONLY:

```text
  sandboxMode (configuration-derived)
  sandboxBackendResolver identity (configuration-derived)
  isAvailable() cached result if invoked now
```

It CANNOT truthfully observe, without invoking `prepare()`:

```text
  profile generation success for this exact capability
  profile write success for this exact capability
  environment materialization success for this exact capability
  no fallback path exists at execution time
## §4 — Conservation against the "no sandbox escape by failure" rule

The user-input named a hard anti-pattern:

> policy says ALLOW because "Seatbelt enabled"
> → Seatbelt prepare fails
> → executor silently falls back to host shell

This is a sandbox-escape-by-failure. The current production architecture
**prevents this** by the substrate contract itself:

* `apps/vscode/src/sdk/command-job-manager.ts` documents that the
  executor MUST treat a thrown `SandboxError` as fail-closed.
* The substrate-availability denial (e.g. `sandbox-exec` missing on
  the host) is reported as `spawn_failed` with a sandbox-unavailable
  signal, **not** as a fallback to unsandboxed execution.

So the existing substrate already prevents the silent fallback. Any
new "ALL bypasses R5 under Seatbelt" implementation inherits this
protection for free **as long as the executor path is unchanged**.
## §5 — Two architectures the user-input named

> A. approval policy gets a trustworthy preflight capability:
>    seatbeltWillBeMandatory = true with no fallback execution path
>
> B. R5 bypass is provisional until prepare succeeds;
>    execution is forbidden from falling back unsandboxed

**A** would require:

1. Invoking `prepare()` synchronously at approval time and gating the
   verdict on its success (latency cost; profile lifecycle cost).
2. **Structurally forbidding** the executor from spawning the command
   unless the SAME prepared invocation (or its re-prepared successor
   with the same capability) is what reaches
   `spawnSupervisableShellCommand`. This is not the current
   architecture: today the executor calls `prepare()` independently
   at start time. To guarantee no fallback, the approval would have
   to either pass the prepared invocation through the executor as a
   typed contract, or the executor would have to re-`prepare()` and
   assert identity-equivalence.

   Neither exists today. The implementation cost of (2) is
   substantial and touches the executor supervisor seam, not the
   policy seam.

**B** would require:

1. The policy layer to verdict ALLOW with a **provisional** source
   tag (`host_mode_all_provisional_sandbox`) and a structural
   executor-side check that:
   * Calls `prepare()` itself.
   * Refuses to spawn unless `prepare()` succeeded AND the backend
     identity matches what the policy saw.
   * Surfaces the actual terminal outcome (`spawn_failed` /
     `sandbox_unavailable`) back to the caller with full audit
     trail so a future approval verdict can be revised.

   This is structurally cleaner than A but still requires new
   executor-side plumbing, and the user-facing UX is: "ALL said OK,
   but Seatbelt failed, so the command was denied." That is a
   product-behavior change that needs an explicit UX contract.

## §6 — Decision matrix (per user-input §"First RED matrix")

| Session | Effective Seatbelt | R5 command | Expected (user-input) | Architecture feasible? |
|---------|--------------------|------------|-----------------------|------------------------|
| none    | no                 | yes        | ASK                   | YES (current behavior) |
| ALL     | no                 | yes        | ASK                   | YES (current behavior — substrate unavailable prevents bypass) |
| none    | yes                | yes        | ASK                   | YES (current behavior) |
| ALL     | yes                | yes        | ALLOW                 | **REQUIRES new plumbing** (Architectures A or B above) |
| ALL     | yes + explicit deny | yes       | DENY                  | YES (deny rules outrank; current architecture already supports) |
| ALL     | Seatbelt requested but prepare fails | yes | ASK / fail closed | YES (substrate contract already fail-closed) |
| ALL     | sandbox backend bypassed | yes   | ASK                   | YES (substrate contract already fail-closed; bypassed backends do not exist in current prod) |
| ALL     | yes                | ordinary   | ALLOW                 | YES (current behavior for `host_mode_all` + non-R5) |

The only row whose expected behavior diverges from the current
production architecture is **row 4** (ALL + effective Seatbelt +
R5 command → ALLOW). All other rows are either already enforced
or are unreachable-by-construction under the substrate contract.

## §7 — Architectural finding

**The approval-time code CANNOT truthfully know whether Seatbelt
will be effectively enforced without invoking `prepare()`, and
invoking `prepare()` at approval time has non-trivial cost.**

Either architecture A or B is a **substantial product-policy
change**, not a defect repair. It requires:

1. A clear user-facing contract for what happens when Seatbelt
   prepare fails after a provisional ALLOW (Architecture B) or what
   latency cost the operator accepts (Architecture A).
2. A clear contract for which R5 families are covered by Seatbelt's
   capability model — e.g. `rm -rf $HOME` is deniable at the kernel
   iff `$HOME` is NOT in the capability's `writableRoots`. If `$HOME`
   IS writable (because the user granted it), Seatbelt will not
   prevent the destruction. The bypass is therefore meaningful only
   for **non-capability-granted targets**, and the user-input
   acknowledges this.
## §8 — Halt disposition (this preflight only)

```text
PHASE_0_PREFLIGHT_COMPLETE = YES
PHASE_0_VERDICT = PASS

ARCHITECTURAL_FINDING =
  Approval-time code cannot prove effective Seatbelt
  enforcement without invoking prepare(). Two viable
  architectures (A: synchronous preflight + executor identity
  check; B: provisional ALLOW + structural executor check)
  exist but both require new executor-side plumbing and are
  substantial product-policy changes.

DEFERRAL_DOCTRINE_GATE =
  UNRESOLVED — the exact-shape specimen has NOT been
  classified in the production-equivalent composition. The
  prior recon closed at 15 → 3 collapse, leaving only
  environment-specific residuals. The current proposal must
  prove (a) the targeted cells are non-residual, AND
  (b) Seatbelt's capability model would prevent the targeted
  mutation, BEFORE any source change.

  (Reviewer disposition 2026-08-30: wording correction.
   The live trace G8R987V68S is REAL / LIVE / BOUND for the
   exact-shape command classification ASK / risk_hard_floor
   — the production-equivalent synthetic re-classification is
   therefore not the load-bearing gap. What remains
   unproven is the conservation envelope:
   whether a mandatory Seatbelt execution obligation can
   safely replace R5 human confirmation without creating an
   unsandboxed fallback path or expanding sandbox
   capabilities. See status update below.)

LIVE_R5_CLASSIFICATION =
  REAL / LIVE / BOUND
    corr=G8R987V68S
    artifact=4.1.16-a29a08dc8
    parserResult.validate.v2 = complete / valid
    hostDecision.compose.v2:
      finalDecision = ask
      finalSource   = risk_hard_floor
    approval.ui.branch.v2 (causally explained by ASK)
    approval.ui.published.v2 (causally explained by ASK)
  This binds the R5 classification of the exact-shape
  command at the production seam. A synthetic re-run is
  not the load-bearing gap.

DEFER_NOT_BYPASS_CONSERVATION =
  UNRESOLVED — what remains unproven is whether a mandatory
  Seatbelt execution obligation can safely replace R5 human
  confirmation without:
    (a) creating an unsandboxed fallback path, OR
    (b) expanding sandbox capabilities beyond what the
        existing capability contract already grants.

PRODUCTION_DELTA_THIS_ACT = 0.

PRODUCT_CONTRACT (frozen by Phase 0):
  ALL means literal ALL within the effective Seatbelt
  authority envelope.

  R5 + ALL + MANDATORY_SEATBELT_EXECUTION
      → no human ASK
  R5 + ALL + !MANDATORY_SEATBELT_EXECUTION
      → ASK
  explicit DENY → DENY regardless of ALL or Seatbelt
  parser/structural invalidity → existing fail-closed result
  Seatbelt preparation/invocation failure
      → command MUST NOT fall back to unsandboxed execution

ARCHITECTURE = B (refined)
  Conditional authority result, NOT ordinary ALLOW:
    {
      kind: "allow",
      source: "host_mode_all_seatbelt_required",
      executionConstraint: "seatbelt-required"
    }
  Executor contract:
    decision = ALLOW_SEATBELT_REQUIRED
      → Seatbelt prepare succeeds
      → invocation is /usr/bin/sandbox-exec <bound-profile> ...
      → execute
    OR
      → prepare unavailable/fails
      → invocation identity not Seatbelt
      → HALT/FAIL command
      → NEVER host-shell fallback

ARCHITECTURE_A = DEFER
  Synchronous approval-time Seatbelt preparation duplicates
  lifecycle work (profile creation, retry semantics, latency)
  and still does not prove executor identity-binding unless
  approval and execution become one reservation transaction.
  Defer in favor of Architecture B.

NEXT_ACT (operator-driven):
  ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01
  Not another recon ACT. Phase 0 has answered the architectural
  question sufficiently.

  Primary epistemic purpose:
    Implement conditional R5 auto-approval as an
    executor-enforced Seatbelt obligation, with zero
    unsandboxed fallback.

  Load-bearing RED (NOT merely "ALL + R5 → ALLOW"):
    ALL + R5 + executor-guaranteed Seatbelt
    → approval bypass carrying mandatory Seatbelt constraint

  Two executable conservation tests:
    (1) Necessity / ablation:
        mandatory Seatbelt = true  → no approval prompt
        ablate mandatory Seatbelt fact → ASK / risk_hard_floor
    (2) No-fallback test:
        Force prepare() to fail after policy grants the
        conditional bypass.
        EXPECTED: executor rejects/fails command; host
        command runner never invoked; file remains unchanged.
        If any fallback path exists, it is P0 and the ACT
        halts before enabling R5 bypass.

  Capability confinement (v1 proof scope):
    workspace writable target
      → deletion MAY succeed under ALL+Seatbelt
    outside authorized writable roots
      → identical destructive operation denied by kernel
    network disabled → R5 bypass does not add network authority
    SSH-agent disabled
      → R5 bypass does not add AF_UNIX/agent authority
    Abstraction: ALL expands approval authority, never
    sandbox capability authority.

NO_RED_WRITTEN = YES (no production-seam test authored)
NO_SOURCE_CHANGED = YES
NO_UI_CHANGED = YES
```

## §9 — Source-seam map (for any follow-on ACT)

```text
Approval-time policy path:
  apps/vscode/src/sdk/SdkController.ts:842..900
    buildSdkControllerEvaluateCommandToolApproval
      -> getCommandHostAuthorization
      -> resolveSessionHostAuthorization (when override="all")
      -> evaluateCommandToolApprovalWithPlan

Policy composer:
  apps/vscode/src/sdk/sdk-tool-policies.ts
    evaluateCommandToolApproval
    evaluateCommandToolApprovalWithPlan
    evaluateCancelCommandToolApproval

Canonical SDK composer:
  sdk/packages/core/src/runtime/command-policy/command-policy.ts:79..150
    evaluateCommandPolicy (ALLOW/ASK/DENY lattice)

R5 hard floor:
  sdk/packages/core/src/runtime/command-policy/command-risk.ts:1..43
    module header (R5 is DOWNGRADE-only and outranks host_mode_all)
  sdk/packages/core/src/runtime/command-policy/command-risk.ts:445..488
    floor composition (finalDecision="ask", finalSource="risk_hard_floor")

R5 rule set (frozen telemetry contract):
  sdk/packages/core/src/runtime/command-policy/command-risk.ts:179..270
    R5_HARD_FLOOR_RULES
  sdk/packages/core/src/runtime/command-policy/command-policy-types.ts:83..100
    CommandDecisionSource taxonomy (includes "risk_hard_floor")

Substrate (where prepare() actually lives):
  sdk/packages/core/src/runtime/sandbox/macos/seatbelt-backend.ts:1..46
  sdk/packages/core/src/runtime/sandbox/types.ts:37 (SandboxMode)
  apps/vscode/src/sdk/sandbox-policy.ts:11..58 (Wave-1 capability)
  apps/vscode/src/sdk/command-job-manager.ts:204..217 (DI seam)

Motivating-incident invariant (must remain green):
  apps/vscode/src/sdk/sdk-tool-policies.command-policy.test.ts:128..140
    "Even in all-mode (YOLO), an R5 catastrophic command
     (rm -rf /) is downgraded to ASK with disposition
     never-auto-approve. The motivating ClineMM incident
     surface is VSCodium (i.e. THIS host), so this wiring is
     the load-bearing safety invariant."

Deferred work (epic durable):
  .factory/epics/approval-protection.md:23
    "Command policy itself does NOT justify a YOLO bypass"
  .factory/epics/approval-protection.md:54
    "defer-not-bypass" doctrine
```
