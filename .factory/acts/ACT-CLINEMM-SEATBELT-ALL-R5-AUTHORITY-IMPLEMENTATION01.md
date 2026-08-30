# ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01

> Status: **OPEN / HIGH**
>
> **Contract authority**: `ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-CONTRACT01`
> (CLOSED; PHASE_0 = PASS; verdict = Architecture B refined;
> product contract frozen: `ALL_IS_LITERAL_INSIDE_MANDATORY_SEATBELT_ENVELOPE`).
>
> **Reviewer disposition** (2026-08-30): `GO_IMPLEMENTATION01`. One
> bounded implementation/fix cycle authorized; no further pre-execution
> review before RED.
>
> **Predecessor**: `ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-CONTRACT01` at
> commit `203244361` (the durable preflight evidence).
>
> **Recon evidence** (durable):
> `.factory/evidence/ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-CONTRACT01/01-architectural-preflight.md`
>
> **Mission**: land Architecture B (refined) at the production seam —
> a conditional authority shape `host_mode_all_seatbelt_required`
> whose executor obligation is "Seatbelt or no execution", with zero
> host-shell fallback.
>
> **Stop conditions** (any one halts the ACT):
>
> ```text
> HALT_UNSANDBOXED_FALLBACK_EXISTS
> HALT_EXECUTOR_CANNOT_BIND_CONSTRAINT
> HALT_EXPLICIT_DENY_BYPASSED
> HALT_SANDBOX_CAPABILITY_EXPANDED
> ```
>
> **Entry conditions**:
> - branch=`main`, HEAD=`203244361` (CONTRACT01 durability fix landed)
> - epic ledger row 23 records `PHASE_0_PASS`,
>   `NEXT_ACT = IMPLEMENTATION01`, LIVE_R5_CLASSIFICATION bound
> - worktree clean of unrelated edits

## 0. Mission

Implement the contract frozen by CONTRACT01. The four load-bearing
cases (the RED matrix that must all pass at the production seam
before any source changes land) are:

```text
T1 RED:
  ALL + R5 + mandatory-seatbelt execution
  current  -> ASK / risk_hard_floor
  expected -> conditional ALLOW with source = host_mode_all_seatbelt_required

T2 ABLATION:
  same request, mandatory-seatbelt fact removed
  expected -> ASK / risk_hard_floor
  (the conditional source MUST NOT appear when the obligation is absent)

T3 NO-FALLBACK (the load-bearing safety gate):
  conditional allow granted
  + Seatbelt prepare fails
  expected -> command NOT executed
              host shell NOT invoked
              result.state = "spawn_failed"
              result.signal carries the sandbox-prepare-failed reason
  any fallback path that reaches spawnSupervisableShellCommand is P0
  and HALTS the ACT.

T4 CAPABILITY CONSERVATION:
  conditional R5 bypass
  must NOT enlarge:
## 1. Architectural invariants (frozen)

```text
INV-1: Distinct authority class
  Decision source  = host_mode_all_seatbelt_required
  Decision kind    = allow
  Execution constraint = seatbelt-required (carried via typed context
                                                slot, see INV-2)

INV-2: Typed authority channel
  AgentToolContext.mandatorySeatbeltExecution: boolean | undefined
  - closed runtime-owned slot, same provenance contract as
    executionCapability / commandExecutionPlan
  - NEVER read from toolCall.metadata
  - NEVER a parallel metadata-derived boolean
  - when true, executor MUST refuse host-shell fallback

INV-3: Executor enforcement
  CommandJobManager.start() with context.mandatorySeatbeltExecution=true:
    if sandboxBackendResolver(mode) === undefined
      -> buildSandboxUnavailableResult(signal="seatbelt-required-but-unavailable")
         NEVER fall through to spawnSupervisableShellCommand
    else (backend present, prepare() invoked)
      if prepare() throws SandboxError
        -> buildSandboxUnavailableResult(signal="sandbox-prepare-failed: ...")
           (existing fail-closed path; never fall through)
      else
        -> use prepared invocation as the authoritative spawn shape
           (existing structural binding path; unchanged)
  NO new code path reaches spawnSupervisableShellCommand when the flag
  is true and Seatbelt fails. The check happens at the TOP of start(),
  BEFORE the existing sandbox branch runs.

INV-4: Capability conservation
  buildExperimentalReconCapability inputs/outputs UNCHANGED.
  The mandatorySeatbeltExecution flag does NOT enter the capability
  builder. writableRoots / network / sshAgent are computed identically
  before and after this ACT. T4 pins this end-to-end.

INV-5: Explicit DENY unchanged
  evaluateCommandPolicy still returns kind="deny" with source="host_hard_deny"
  / "model_escalation" / etc. when the user/host has a hard-deny rule.
  The mandatorySeatbeltExecution flag NEVER upgrades a deny.
  T1 explicitly does NOT exercise the deny path; T4's deny witness
  is part of the broader matrix.

INV-6: R5 risk_hard_floor unchanged
  When the R5 catastrophic-classifier downgrades an ALLOW to ASK
  with source=risk_hard_floor, the new flag MUST NOT re-promote it.
  The conditional authority only fires when the canonical lattice
  emits allow; risk_hard_floor is preserved as-is.

INV-7: Fail-closed parser invalidity unchanged
  When the canonical policy returns unknown_input or
  execution_plan_invalid, those return paths are unchanged. The new
  source only appears when mode-based resolution would otherwise
  emit host_mode_all.
```

## 2. Source-of-truth files (the minimal touch surface)

Production files modified:

```text
A) sdk/packages/core/src/runtime/command-policy/command-policy-types.ts
   - CommandDecisionSource adds "host_mode_all_seatbelt_required"
   - CommandHostAuthorization adds mandatorySeatbelt?: boolean
   - commandHostAuthorization() strict-mode constructor carries the field

B) sdk/packages/core/src/runtime/command-policy/command-policy.ts
   - resolveHostDecision (the mode-based switch) emits the new source
     when auth.mode === "all" && auth.mandatorySeatbelt === true
   - selectAggregateSource adds the new branch ahead of host_mode_all
     in the multi-command aggregate (any seatbelt-required wins)

C) sdk/packages/shared/src/agent.ts
   - AgentToolContext adds mandatorySeatbeltExecution?: boolean
   - docblock states the closed-runtime-owned provenance contract
     (same provenance family as executionCapability / commandExecutionPlan)
## 3. Test surface (RED matrix → GREEN)

Test file
`apps/vscode/src/sdk/__tests__/seatbelt-all-r5-authority-implementation01.c1-green.test.ts`
(vitest, command-policy seam + command-job-manager seam).

```text
CASE T1 (RED -> GREEN):
  input:   auth.mode = "all"
           auth.mandatorySeatbelt = true
           R5 catastrophic (rm -rf /tmp/test-target) command
  expect:  result.decision.kind = "allow"
           result.decision.source = "host_mode_all_seatbelt_required"
           result.approved = true
  pre-fix: result.decision.kind = "ask"
           result.decision.source = "risk_hard_floor"
           (this is the LIVE trace corr=G8R987V68S classification)

CASE T2 (ABLATION):
  input:   auth.mode = "all"
           auth.mandatorySeatbelt = undefined  // explicitly removed
           same R5 catastrophic command
  expect:  result.decision.kind = "ask"
           result.decision.source = "risk_hard_floor"
  pre-fix: same (no regression)
  post-fix: SAME — the new source MUST NOT appear when the obligation
            is absent (INV-2 / INV-6)

CASE T3 (NO-FALLBACK — load-bearing safety gate):
  input:   command-job-manager.start() invoked with
             context.mandatorySeatbeltExecution = true
             sandboxBackendResolver returns a backend whose
             prepare() throws SandboxError("profile-generation-failed",
                                          backendId="test-throw")
           (simulates Seatbelt substrate present, prepare() fails)
  expect:  result.state = "spawn_failed"
           result.signal contains "sandbox-prepare-failed"
           the host's spawnSupervisableShellCommand was NEVER invoked
           (asserted via the DI seam: a __supervisorInvoked sentinel
            on the throwing backend remains false)
           (also asserted: buildExperimentalReconCapability was NOT
            widened — writableRoots / network / sshAgent unchanged)
  pre-fix: behavior is identical to the existing "seatbelt + prepare
           throws" path — already fail-closed. The NEW thing this test
           pins is that the SAME fail-closed path applies when the
           approval bypass was granted by the host. Pre-fix the flag
           is absent so this test wouldn't even compile (the new
           AgentToolContext field doesn't exist) — that's the RED.

CASE T4 (CAPABILITY CONSERVATION):
  input:   buildExperimentalReconCapability called with the same
           inputs as the T1 scenario (cwd, workspaceRoots,
           safeYoloCapabilitySource = { network: false, sshAgent: false })
           AND with context.mandatorySeatbeltExecution = true
  expect:  cap.writableRoots === pre-fix cap.writableRoots
           cap.network === pre-fix cap.network
           cap.sshAgent === pre-fix cap.sshAgent
           (cap is BYTE-EQUAL across the fix)
  pre-fix: the flag doesn't exist; this case is the conservation
           witness proving the fix does NOT widen authority.
```

The RED cycle:

```text
Step 1: Author the test file with all 4 cases.
Step 2: Run `bun run test:vitest -- seatbelt-all-r5-authority-implementation01`
## 4. Stop conditions (any one halts the ACT)

```text
HALT_UNSANDBOXED_FALLBACK_EXISTS
  Evidence: T3 passes only because the throwing backend short-circuited
            at prepare(); under a non-throwing backend whose spawn()
            is observable, host shell is reached.
  Detection: T3 additionally asserts (via DI sentinel) that
              spawnSupervisableShellCommand was NEVER called when
              mandatorySeatbeltExecution is true and prepare() threw.
              If a future regression re-introduces a fallback path
              to spawnSupervisableShellCommand that bypasses the
              prepare() outcome, the sentinel flips and the test fails.

HALT_EXECUTOR_CANNOT_BIND_CONSTRAINT
  Evidence: AgentToolContext.mandatorySeatbeltExecution is silently
            dropped somewhere between the host's resolveHostAuthorization
            and the executor's start() invocation.
  Detection: T3 uses the AgentToolContext field directly and asserts
              the executor reads it. A drop would surface as
              "mandatorySeatbeltExecution never observed" — the
              test fixture asserts the field reached start().

HALT_EXPLICIT_DENY_BYPASSED
  Evidence: With explicitDenyRules matching a command, the new flag
            upgrades an ASK/DENY to ALLOW.
  Detection: not directly a test in this ACT (the existing
              command-policy.test.ts deny witnesses already pin it),
              but a code review invariant: the mode-based switch in
              resolveHostDecision ONLY emits host_mode_all_seatbelt_required
              when auth.mode === "all" AND the canonical lattice would
              otherwise emit host_mode_all. Explicit DENY / model
              escalation / risk_hard_floor paths are upstream of that
              switch and cannot be bypassed.

HALT_SANDBOX_CAPABILITY_EXPANDED
  Evidence: T4 fails because cap.writableRoots / network / sshAgent
            differs across the fix.
  Detection: T4 pins byte-equality. Any widening is an immediate
              RED that halts the ACT.
```

## 5. Conservation against epic doctrine

```text
- Must NOT weaken risk_hard_floor when MANDATORY_SEATBELT_EXECUTION is
  absent (T2 pins this).
- Explicit deny MUST always DENY (INV-5).
- Parser invalidity MUST remain fail-closed (INV-7).
- The flag is a typed channel, NEVER a metadata-derived boolean
  (INV-2). The existing metadata-provenance.md contract covers this
  field by extension.
```

## 6. Out-of-scope (deferred)

```text
- The UI / Settings / proto surface that surfaces the
  MANDATORY_SEATBELT_EXECUTION knob to the user is OUT OF SCOPE
  for this ACT. The flag is host-attached via
  CommandHostAuthorization.mandatorySeatbelt; the v1 wiring reads
  the existing Seatbelt-availability state and sets it true iff
  Seatbelt is expected to succeed end-to-end.
- The T1 RED test uses the LIVE R5 trace's exact-shape command
  (rm -rf /tmp/test-target-equivalent) and the LIVE
  resolveExperimentalSandboxMode selector.
- The P2 test-comment-precision residue from CONTRACT01 (the
  diagnostic test that describes synthetic policy.autoApprove=true
  + shouldAutoApproveTool=true as literally equivalent to live
  host_mode_all) is NOT addressed here. Reviewer disposition
  explicitly batched it as P2 / NON-BLOCKING.
```

## 7. Disposition (target)

```text
PHASE_1_RED    = PASS       (all 4 cases RED before source changes)
PHASE_2_GREEN  = PASS       (all 4 cases GREEN after source changes)
                 + existing seatbelt-yolo-* + safe-yolo-* suites GREEN
PRODUCTION_DELTA = bounded  (files A..F only; no UI; no proto)
FURTHER_REVIEW  = NOT_AUTHORIZED before RED
                 post-GREEN closure review is a bookkeeping review
                 (board entry + epic ledger update); no design round.
```

## 8. References

- CONTRACT01 preflight (durable):
  `.factory/evidence/ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-CONTRACT01/01-architectural-preflight.md`
- LIVE_R5_CLASSIFICATION binding: corr=G8R987V68S, artifact=4.1.16-a29a08dc8
- Epic ledger row 23: `.factory/epics/approval-protection.md`
- Production seams: `apps/vscode/src/sdk/command-job-manager.ts:535-700`,
  `sdk/packages/core/src/runtime/command-policy/command-policy.ts:540-700`,
  `sdk/packages/core/src/runtime/command-policy/command-policy-types.ts:83-180`,
  `sdk/packages/shared/src/agent.ts:348-460`

        Expect: ALL 4 CASES FAIL (RED). The new types/sources don't
        exist yet, so T1/T2 fail at compile-or-assert, T3 fails at
        compile-or-no-enforcement, T4 fails at compile-or-assert.
Step 3: STOP if any of the 4 stop conditions trigger before the test
        even compiles. In particular:
        - if pre-fix code already silently widens any capability axis
          when mandatorySeatbelt is implied, HALT_SANDBOX_CAPABILITY_EXPANDED
        - if pre-fix code has a fallback path past prepare() failure,
          HALT_UNSANDBOXED_FALLBACK_EXISTS
Step 4: Implement files A..F. Each file change is independently small.
Step 5: Re-run the test file. Expect: ALL 4 CASES PASS (GREEN).
Step 6: Run the broader matrix under test:vitest + test:unit
        (the seatbelt-yolo-* and safe-yolo-* suites must remain green).
```



D) apps/vscode/src/sdk/command-job-manager.ts
   - StartCommandJobOptions is UNCHANGED (the authority travels via context)
   - CommandJobManager.start(): at the top, before the existing
     sandbox branch, an early gate checks
       context?.mandatorySeatbeltExecution === true
     and forces the sandbox path (or buildSandboxUnavailableResult).
   - No new code path to spawnSupervisableShellCommand when the flag is true.

E) apps/vscode/src/sdk/sdk-tool-policies.ts
   - getCommandHostAuthorization reads
     resolveSafeYoloCapabilityFromState (or equivalent Seatbelt-availability
     probe) and sets auth.mandatorySeatbelt = true when the Seatbelt
     obligation can be honored end-to-end (host-side substrate available,
     prepare() expected to succeed under the experimental opt-in).
   - Strict-mode constructor usage respects the new field.

F) apps/vscode/src/sdk/SdkController.ts
   - resolveHostAuthorization in
     buildSdkControllerEvaluateCommandToolApproval threads the
     auth.mandatorySeatbelt flag into hostAuthorization
   - ToolApprovalResult.executionPlan (or a sibling typed field)
     surfaces mandatorySeatbeltExecution on the agent-tool path
```

No other files are touched. Tests live in:

```text
G) apps/vscode/src/sdk/__tests__/seatbelt-all-r5-authority-implementation01.c1-green.test.ts
   - The 4 RED cases (T1, T2, T3, T4) plus the typed-channel guard
   - vitest, runs under apps/vscode's existing test:vitest config
```


    writableRoots
    network authority
    SSH-agent authority
  the canonical buildExperimentalReconCapability output is UNCHANGED;
  the new flag only constrains the execution path, never the capability.
```

The implementation introduces a distinct authority class, not silent
reuse of `host_mode_all`. The host's `CommandJobManager.start(...)`
becomes the executor-side enforcement seam.

