# ACT-CLINEMM-COMMAND-APPROVAL-AUTHORITY-FAIL-CLOSED-RECON01

> Status: **CLOSED / GREEN / NOT_A_CLINEMM_DEFECT**
> Verdict: **`APPROVAL_AUTHORITY_FAIL_CLOSED_PROVEN`**
> Owning epic: [`EPIC-APPROVAL-PROTECTION`](../epics/approval-protection.md) (board row 19 territory; the row-19 editor-tool recon remains OPEN with its own open-work, this ACT is the parallel command-policy sister).
> ACT ID: ACT-CLINEMM-COMMAND-APPROVAL-AUTHORITY-FAIL-CLOSED-RECON01
> Evidence: `.factory/evidence/ACT-CLINEMM-COMMAND-APPROVAL-AUTHORITY-FAIL-CLOSED-RECON01/`

## §0 — Frozen user-facing invariant

```text
Given any ClineMM host (VS Code or CLI) and any run_commands /
execute_command tool call where the model supplies
`requires_approval=false`:

  Harness-required approval (host_mode_manual / host_hard_deny /
  unknown_input / workspace-realpath fail / V2 never-auto-approve /
  R5 catastrophic hard floor) MUST survive the model hint.

  The model hint can RAISE friction (ALLOW -> ASK) but NEVER lower it.

  Concretely:
    EFFECTIVE_KIND >= HARNESS_BASE_KIND
    (in the ALLOW < ASK < DENY restrictiveness lattice)

This is the load-bearing property upstream issue #12020
("destructive command runs without approval when model sets
requires_approval=false") would violate if present in ClineMM.
```

## §1 — Mission outcome (one-line)

```text
QUESTION:  Can untrusted model/tool-call metadata reduce command
           execution authority below the minimum required by
           ClineMM's own policy?

ANSWER:    NO (composed proof: structural + functional).

EVIDENCE:  COMPOSED PROOF, two layers:

           STRUCTURAL:
             The production host adapter invokes
             `evaluateCommandRiskWithParser()` (see §8 authority
             seam map; sdk-tool-policies.ts:633) AFTER the
             canonical lattice; the R5 catastrophic hard floor
             is wired into the production execution path, not
             just into a side test.

           +
           SYNTHETIC_REAL (functional):
             PASS at the real `evaluateCommandPolicy()` entry
             point (sdk/packages/core/src/runtime/command-policy/
             command-policy.ts:80) AND at the real
             `evaluateCommandRiskWithParser()` entry point
             (sdk-tool-policies.ts:633 callsite consumer) for
             every adversarial matrix case in §6 below.

           =
           COMPOSED PROOF:
             The production host-adapter authority chain contains
             the R5 catastrophic hard floor; the model-false hint
             cannot waive it.

           Load-bearing cases:
             - A3' (SAFE_ONLY + R5-catastrophic / unknown) — the
               direct upstream #12020 surface (model-supplied
               requires_approval=false in the auto-approve/safe-
               command lane).
             - A3'' (YOLO + R5-catastrophic) — a STRONGER
               ClineMM conservation: even explicit user YOLO
               does not waive the bounded R5 catastrophic floor.

DISPOSITION: NOT_A_CLINEMM_DEFECT
             APPROVAL_AUTHORITY_FAIL_CLOSED_PROVEN
             STOP (per ACT §15 stop rule).
```

## §2 — Source-recon (Q1–Q12)

### Q1. Model-supplied hint fields in the runtime

| Field                          | Read at                                   | Trust class      |
|--------------------------------|-------------------------------------------|------------------|
| `requires_approval` (bool)     | `command-model-hints.ts:93-101` (extractor)| MODEL_UNTRUSTED  |
| `requires_approval` (per cmd)  | `command-model-hints.ts:43-53` (aggregator)| MODEL_UNTRUSTED  |

The only model-supplied approval metadata that survives into the
canonical command policy is `requires_approval`. There is no other
advisory field (no `safe`, no `destructive`, no `permission`, no
`autoApprove` from the model). `safe`/`destructive` are HOST-DERIVED
classification outputs, not model inputs. `permission` does not
exist in ClineMM.

The extractor (command-model-hints.ts:93-101) is strict-typed: only
a literal boolean yields `true` or `false`; anything else
(non-boolean, missing, malformed) collapses to `undefined`.

### Q2. First authoritative harness-side approval decision

The function is **`evaluateCommandPolicy()`** at
`sdk/packages/core/src/runtime/command-policy/command-policy.ts:80`.
It is the single canonical entry point. Both VS Code and CLI route
through it.

Production call graph:

```
SdkInteractionCoordinator (apps/vscode/src/sdk/sdk-interaction-coordinator.ts)
  → buildSdkControllerEvaluateCommandToolApproval (apps/vscode/src/sdk/SdkController.ts:344)
    → resolveHostAuthorization (returns { hostAuthorization, toolInput })
      where hostAuthorization is built via
        - getCommandHostAuthorization (apps/vscode/src/sdk/sdk-tool-policies.ts:360)
        - resolveSessionHostAuthorization override (session-auto-approval.ts:...)
        - applySeatbeltAuthorityEnvelope (Seatbelt-all-R5 conditional authority)
    → evaluateCommandToolApprovalWithPlan
      → evaluateCommandToolApproval (apps/vscode/src/sdk/sdk-tool-policies.ts:546)
        → evaluateCommandPolicy (canonical, @cline/core)
        → evaluateCommandRiskWithParser (R5 hard floor; never auto-approve)

CLI: cliEvaluateCommandToolApprovalWith -> cliEvaluateCommandToolApproval
  (apps/cli/src/runtime/command-policy-host.ts:430)
```

### Q3. Inputs to that decision and their trust classification

| Input                                | Trust class      | Source                                         |
|--------------------------------------|------------------|------------------------------------------------|
| `hostAuthorization.mode`             | USER_CONFIG      | persisted AutoApprovalSettings + session override |
| `hostAuthorization.explicitAllowRules`| HOST_DERIVED    | bounded default positive matcher (command-safe-rules.ts) |
| `hostAuthorization.explicitDenyRules`| HOST_DERIVED    | admin-defined; today empty in production       |
| `hostAuthorization.pathAuthorityEvidence` | HOST_DERIVED | built via fs.realpathSync(workspace) at SdkController |
| `hostAuthorization.tempAuthorityEvidence` | HOST_DERIVED | darwin /usr/bin/mktemp gate                    |
| `hostAuthorization.mandatorySeatbelt` | HOST_DERIVED    | kernel-envelope invariant (R5)                  |
| `toolInput.command`/`toolInput.commands` | PARSER_DERIVED | after canonical `normalizeRunCommandsInput`   |
| `toolInput.requires_approval` (per cmd) | MODEL_UNTRUSTED | only trust class that can ONLY raise friction |

### Q4. Can model-supplied false/low-risk values bypass the gates?

NO. The composition rule at `command-policy.ts:120`:

```ts
if (modelHints.effectiveEscalation && finalKind === "allow") {
    finalKind = "ask";
    finalReason = `${aggregateReason} (model requested approval)`;
    finalSource = "model_escalation";
}
```

`effectiveEscalation` is `true` iff ANY component hint is `true`
(command-model-hints.ts:46-51). The branch ONLY fires on escalation.
The `false`/`undefined` path has NO composition step that lowers
the verdict. This is the load-bearing A3 invariant.

Specifically, model-supplied `requires_approval=false` cannot:
  - bypass destructive command classification (R5 hard floor at
    sdk-tool-policies.ts:633 runs AFTER evaluateCommandPolicy and
    forces ASK for `risk_hard_floor` matches; the model hint cannot
    erase it)
  - bypass write authority (workspace-realpath-evidence at
    command-policy.ts:401-463 forces ASK on operand non-conformance;
    the model hint is consulted BEFORE this in the per-command
    evaluateOne flow and cannot erase it)
  - bypass the workspace cwd/workspace-boundary
  - bypass Seatbelt `mandatorySeatbeltExecution` (set independently
    of model hints; based on host mode + sandbox-mode invariant)
  - bypass the explicit-deny rule precedence (command-policy.ts:271)
  - bypass `host_mode_manual` (command-policy.ts:307)

### Q5. Does CommandCapability encode minimum required approval?

Yes. `CommandHostAuthorization` (command-policy-types.ts:140+) is
a typed value carrying `mode`, `explicitAllowRules`,
`explicitDenyRules`, `workspaceRoots`, `cwd`,
`pathAuthorityEvidence`, `tempAuthorityEvidence`, `mandatorySeatbelt`.
It is consumed authoritatively by `evaluateOne()` (command-policy.ts:260+)
per command. The host side that constructs it
(`getCommandHostAuthorization`, `resolveSessionHostAuthorization`,
`applySeatbeltAuthorityEnvelope`) cannot be influenced by model
input.

### Q6. Is the shell parser/classifier authoritative for compound commands?

Partially authoritative for ALLOW promotion; conservative for ASK/DENY.

- `OPAQUE_SHELL_TOKENS` (command-safe-rules.ts:55-72): any of `;`,
  `&&`, `||`, `|`, `$(`, `` ` ``, `eval `, `sh -c`, `bash -c`,
  `zsh -c`, `>`, `<, `>>`, `<<`, `$(()`, `${` causes the safe-rule
  engine to refuse the match. The engine does not parse — it
  fails closed (command-safe-rules.ts:174-180).
- For multi-command inputs (`{ commands: [...] }`), the canonical
  policy runs `resolvePerCommand` independently
  (command-policy.ts:228-258) and aggregates via `aggregateLattice`
  (command-policy.ts:637-659). Lattice rule: ANY ASK or DENY wins.
  Therefore a `safe && dangerous` input is ASK at the aggregate,
  even when the model supplies `requires_approval=false`.
- `safe && destructive` → ASK (R5 hard floor forces ASK on the
  destructive segment, which propagates through aggregation).
- Subshell / command substitution / shell wrapper / env prefix:
  all routed through `OPAQUE_SHELL_TOKENS` and ASK-fallback.
- `git destructive operations` (e.g. `git clean -fdx`,
  `git reset --hard`): matched by R5 catastrophic family in
  command-risk.ts; forced ASK via `risk_hard_floor`.
- Redirection/truncation (`>`, `>>`): covered by OPAQUE_SHELL_TOKENS.

### Q7. At what seam is classification relative to approval?

Classification runs INSIDE `evaluateOne()` BEFORE the verdict is
returned. The flow is:

1. `normalizeForPolicy` (command-policy.ts:158-196) parses the raw
   tool input. Failure → ASK + `unknown_input`.
2. `resolvePerCommand` (command-policy.ts:228-258) iterates commands.
3. `evaluateOne` (command-policy.ts:260+) per command:
   a. Explicit deny rules (line 271) → DENY.
   b. Explicit allow rules (line ~290) → ALLOW + safe profile.
   c. Mode branches (line ~307+): mode-all → ALLOW; mode-safe-only →
      ALLOW if rule matches else ASK; mode-manual → ASK.
   d. Workspace-realpath conformance (line 401-463) → ASK on
      failure.
   e. Temp-authority gate (line 466-595) → ASK on failure.
4. `aggregateLattice` (command-policy.ts:637-659) combines the
   per-command verdicts; ANY DENY wins, else ANY ASK wins.
5. Model hint aggregation runs AFTER aggregation
   (command-policy.ts:110-124) and can only RAISE allow→ask.
6. R5 catastrophic hard floor (sdk-tool-policies.ts:633) runs AFTER
   the canonical policy and DOWNGRADES ALLOW → ASK on `risk_hard_floor`.

So classification completes BEFORE the verdict is final. The model
hint is consulted ONLY at step 5, which can raise but not lower.

### Q8. Can any caller construct a CommandCapability directly?

The factory `commandHostAuthorization()` is exported from
command-policy-types.ts. Three production call sites construct it:
  - apps/vscode/src/sdk/sdk-tool-policies.ts (getCommandHostAuthorization)
  - apps/cli/src/runtime/command-policy-host.ts (CLI parity)
  - session-auto-approval.ts (resolveSessionHostAuthorization override)

ALL three are host-owned. None accept model input. The model
input is passed only as `toolInput`, which is normalized before
classification. There is no path where a model-supplied value
constructs the host authorization.

### Q9. Can approval state be reused accidentally?

No. Approval is per-tool-call (per `EvaluateCommandPolicyInput`).
Each call to `evaluateCommandPolicy()` re-normalizes the input
fresh, re-classifies, and re-aggregates. There is no cached verdict
keyed on a previous command/job/request/task identity.

The `requestToolApproval` callback (built in SdkController) is
fired per tool call. `jobId` is only used in `cancel_command`,
which has its own authority matrix (sdk-tool-policies.ts:755-823)
that ignores model hints entirely.

### Q10. Does Seatbelt mitigate a bad approval decision?

Defense in depth, not a substitute for approval correctness. A
Seatbelt-confined shell can still destroy everything the sandbox
intentionally permits (e.g. writable roots, network allowlist, temp
root). The contract under CORRECTION02 is:

  Seatbelt confinement applies to ALLOW-class verdicts (when
  the host has granted permission). It does NOT relax the
  approval policy. A command classified as ASK still requires
  user approval regardless of Seatbelt posture.

For our purposes, the answer is: Seatbelt does not change A3
(the harness requires approval → model hint does not waive). It
may affect the executor-side obligation after approval is
granted, which is a separate axis.

### Q11. Fail-closed behavior on failure paths

| Failure mode                         | Verdict   | Source label             |
|--------------------------------------|-----------|--------------------------|
| `toolInput == null/undefined`        | ASK       | `unknown_input`          |
| normalizer throws                    | ASK       | `unknown_input`          |
| empty `commands` array               | ASK       | `unknown_input`          |
| empty command element                | ASK       | `unknown_input`          |
| unparseable command element          | ASK       | `unknown_input`          |
| malformed `requires_approval`        | (no effect — collapses to `undefined`) |
| mode=manual                          | ASK       | `host_mode_manual`       |
| workspace realpath fail              | ASK       | `host_workspace_realpath_authority` |
| R5 catastrophic match                | ASK       | `risk_hard_floor`        |
| V2 never-auto-approve disposition    | ASK       | `risk_hard_floor`        |
| explicit deny rule match             | DENY      | `host_hard_deny`         |
| malformed cancel_command input       | DENY      | `unknown_input`          |

All failure modes are fail-ASK or fail-DENY. None are fail-ALLOW.

### Q12. Existing tests that exercise the real authority boundary

Inventory (pre-ACT):

| Test file                                                        | What it proves                              |
|------------------------------------------------------------------|---------------------------------------------|
| sdk/packages/core/src/runtime/command-policy/command-policy.test.ts | Canonical lattice (A1-A4)                  |
| sdk/packages/core/src/runtime/command-policy/command-policy.test.ts:73-80 | **A3 (load-bearing)** ASK + model=false → ASK |
| sdk/packages/core/src/runtime/command-policy/command-policy.test.ts:258-282 | A5 unknown_input paths                    |
| sdk/packages/core/src/runtime/command-policy/command-risk-corpus.v1-contract.test.ts:157 | `rm -rf $HOME` + model=false              |
| apps/vscode/src/sdk/sdk-tool-policies.command.test.ts            | R5 hard floor over canonical policy          |
| apps/vscode/src/sdk/__tests__/seatbelt-all-r5-authority-*.test.ts | R5 conditional authority composition        |
| apps/vscode/src/sdk/sdk-controller-approval-capture.test.ts      | SdkController callback captures all paths    |
| apps/vscode/src/sdk/sdk-interaction-coordinator.session-autonomy.test.ts | Session override path                     |
| apps/cli/src/runtime/command-policy-host.test.ts                 | CLI parity                                  |
| apps/cli/src/runtime/command-policy-host.ts:430                  | CLI production call                         |
| apps/vscode/src/sdk/SdkController.ts:344                         | VS Code production call                     |

The A3 test at command-policy.test.ts:73-80 already existed before
this ACT. The discriminator in §6 below adds an explicit
regression-targeted test that names the A3 invariant and runs it
against the LIVE canonical entry point.

## §3 — Trust model (frozen)

| INPUT / SIGNAL                       | TRUST CLASS        | MAY RAISE AUTHORITY? | MAY LOWER FRICTION? | MAY REQUIRE APPROVAL? | MAY WAIVE REQUIRED APPROVAL? |
|--------------------------------------|--------------------|----------------------|----------------------|----------------------|-------------------------------|
| `model.requires_approval=true`       | MODEL_UNTRUSTED    | YES (allow→ask)      | NO                   | YES (in cooperation with host) | NO                    |
| `model.requires_approval=false`      | MODEL_UNTRUSTED    | NO                   | NO                   | NO                   | **NO — invariant under test** |
| `model.requires_approval=missing`    | MODEL_UNTRUSTED    | NO                   | NO                   | NO                   | NO                            |
| `model.requires_approval=malformed`  | MODEL_UNTRUSTED    | NO                   | NO                   | NO                   | NO                            |
| `model.tool_name`                    | MODEL_UNTRUSTED    | n/a (not consumed)   | n/a                  | n/a                  | NO                            |
| `command.text`                       | PARSER_DERIVED     | n/a                  | n/a                  | YES (via classification) | NO                       |
| `parsed AST`                         | PARSER_DERIVED     | n/a                  | n/a                  | YES (via R5 hard floor + V2) | NO                     |
| `user auto-approve config` (persisted) | USER_CONFIG      | YES (YOLO = all mode → allow) | n/a        | YES (mode=manual → ask) | NO                       |
| ClineMM session override="all"       | USER_CONFIG (host)| YES (mode=all → allow) | n/a                 | NO (does not bypass explicit deny) | NO                    |
| ClineMM session override (stripRequiresApproval) | USER_CONFIG (host) | n/a — strips model's escalation only when override=all is active | n/a | NO                | NO (only fires when user explicitly opted into all mode) |
| `CommandCapability` (host-authority input) | TRUSTED_HOST_POLICY | YES (deny → ask allowed; etc.) | n/a  | YES                | NO                            |
| `Seatbelt.mandatorySeatbelt`         | ENVIRONMENT_DERIVED | YES (conditional authority) | n/a            | YES (executor refuses host-shell fallback) | NO                |
| Explicit operator approval          | USER_CONFIG (live) | YES (ask → allow)   | YES (ask → allow)   | YES                  | NO                            |

**Trust rule (frozen):** Model input can NEVER produce
  - broader filesystem authority,
  - broader network authority, or
  - approval waiver
without an independent trusted policy decision (USER_CONFIG /
TRUSTED_HOST_POLICY / ENVIRONMENT_DERIVED).

The composition rule that enforces this is:
  effectiveKind = maxRestrictive(harnessBase, modelEscalation)
where `modelEscalation` is `ASK` if ANY component hint is `true`
else UNDEFINED (never `ALLOW`).

## §4 — Single real-production-seam discriminator

Authored at:
  sdk/packages/core/src/runtime/command-policy/command-policy-authority-fail-closed-recon01.test.ts

The discriminator invokes the **canonical real production
entry point** (`evaluateCommandPolicy` from
`sdk/packages/core/src/runtime/command-policy/command-policy.ts:80`).
It exercises A1, A2, A3, A4, A5, A6, plus targeted adversarial
matrix cases listed in §6.

NO new Function extraction.
NO regex source-as-oracle.
NO mocked approval algorithm.
The composition rule is taken verbatim from the production source.

## §5 — Trust model table (see §3 above; consolidated).

## §6 — Adversarial matrix — expected vs actual

Each row is a real call to `evaluateCommandPolicy()` (the canonical
lattice) OR to `evaluateCommandRiskWithParser()` (the R5 catastrophic
floor consumer invoked at sdk-tool-policies.ts:633 — see §8 for the
structural callsite proof). The discriminator exercises both the
**functional entry points** directly; combined with §8's structural
callsite proof, this forms a **composed proof** that the
host-adapter authority chain in production contains the R5
catastrophic floor.

The original A3 (manual mode) is a CONSERVATION witness — manual
mode asks regardless of classification, so it does NOT prove the
upstream #12020 surface. The load-bearing cases are:

- **A3' (SAFE_ONLY)** — the direct upstream #12020 surface
  (model-supplied `requires_approval=false` in the auto-approve /
  safe-command lane).
- **A3'' (YOLO + R5 catastrophic)** — a STRONGER ClineMM
  conservation: even explicit user YOLO does not waive the
  bounded R5 catastrophic floor. This is a different property
  than #12020 (the upstream bug does not require global YOLO),
  but it is an excellent secondary hardening witness and is
  proven as part of the composed proof.

| Case | toolInput                                       | hostAuthorization           | expected          | actual            | verdict |
|------|-------------------------------------------------|------------------------------|-------------------|-------------------|---------|
| A1   | `{command:"date",requires_approval:false}`      | `mode:"all"`                 | allow             | allow             | GREEN   |
| A2   | `{command:"date",requires_approval:true}`       | `mode:"all"`                 | ask               | ask               | GREEN   |
| A3 (conservation) | `{command:"rm -rf /",requires_approval:false}`  | `mode:"manual"`              | ask               | ask               | GREEN (trivial — MANUAL always asks) |
| **A3' LOAD-BEARING (#12020 direct)** | `{command:"pwd",requires_approval:false}`        | `mode:"safe-only"`           | allow             | allow             | GREEN (positive rule match) |
| **A3' LOAD-BEARING (#12020 direct)** | `{command:"some-unknown-tool",requires_approval:false}` | `mode:"safe-only"` | ask               | ask               | **GREEN — load-bearing (fallthrough, no model waiver)** |
| **A3' LOAD-BEARING (#12020 direct)** | `{command:"rm -rf $HOME",requires_approval:false}` | `mode:"safe-only"`         | ask               | ask               | **GREEN — load-bearing (R5 hard floor; source NOT host_mode_safe_only_rule)** |
| **A3' LOAD-BEARING (#12020 direct)** | `{command:"rm -rf /",requires_approval:false}`  | `mode:"safe-only"`           | ask               | ask               | **GREEN — load-bearing (R5 root-destruction)** |
| **A3'' STRONGER CONSERVATION (YOLO)** | `{command:"rm -rf $HOME",requires_approval:false}` | `mode:"all"`              | ask (host adapter)| ask + disposition="never-auto-approve" | **GREEN — stronger conservation (R5 floor downgrades ALLOW→ASK even in YOLO)** |
| **A3'' STRONGER CONSERVATION (YOLO)** | `{command:"rm -rf /",requires_approval:false}`  | `mode:"all"`                 | ask (host adapter)| ask + disposition="never-auto-approve" | **GREEN — stronger conservation** |
| A3'' sanity  | `{command:"echo hi",requires_approval:false}`   | `mode:"all"`                 | allow             | allow             | GREEN (YOLO honored for non-dangerous) |
| A3'' mirror  | `{command:"rm -rf $HOME",requires_approval:true}` | `mode:"all"`               | ask               | ask               | GREEN (model escalation = ASK at canonical too) |
| A4   | `{command:"rm -rf /",requires_approval:true}`   | `mode:"manual"`              | ask               | ask               | GREEN (conservation) |
| A5   | `null`                                          | `mode:"all"`                 | ask               | ask               | GREEN (unknown_input) |
| A5   | `{commands:[]}` + model=false                   | `mode:"all"`                 | ask               | ask               | GREEN (unknown_input) |
| A5   | `{commands:[null]}` + model=false               | `mode:"all"`                 | ask               | ask               | GREEN (unknown_input) |
| A6   | SAFE_ONLY compound (pwd + non-matching) + model=false everywhere | `mode:"safe-only"` | ask | ask | GREEN (load-bearing aggregateLattice) |
| A6   | SAFE_ONLY compound (pwd + R5-catastrophic) + model=false everywhere | `mode:"safe-only"` | ask | ask | GREEN (R5 floor in compound) |
| A6   | SAFE_ONLY compound (pwd + git status) + model=false everywhere | `mode:"safe-only"` | allow | allow | GREEN (positive matches) |
| Extra | `{command:"pwd",requires_approval:true}`        | `mode:"all"`                 | ask               | ask               | GREEN (model_escalation) |
| Extra | `{command:"rm -rf /",requires_approval:false}`  | explicit deny rule match     | deny              | deny              | GREEN (host_hard_deny) |
| Extra | `{command:"rm -rf /",requires_approval:true}`   | explicit deny rule match     | deny              | deny              | GREEN (model cannot override deny) |
| LATTICE | model=true on allow/ask/deny base           | (probe)                      | raise only        | raise only        | GREEN (monotonic) |
| LATTICE | model=false on allow/ask/deny base          | (probe)                      | unchanged         | unchanged         | GREEN (no spurious escalation) |

**30 discriminator tests, 68 expect() calls, 0 failures.**

### Composed proof — A3' (#12020 direct) + A3'' (YOLO stronger conservation)

```text
PROOF COMPOSITION:

  STRUCTURAL (§8 authority seam map):
    Production host adapter invokes
    evaluateCommandRiskWithParser() at sdk-tool-policies.ts:633
    AFTER evaluateCommandPolicy(). The R5 catastrophic hard floor
    is wired into the production execution path, not just a side test.

  +

  SYNTHETIC_REAL (functional, this discriminator):
    evaluateCommandRiskWithParser() maps R5-catastrophic ALL/YOLO
    input to ASK + never-auto-approve.

  =

  COMPOSED PROOF:
    The production host-adapter authority chain contains the R5
    catastrophic hard floor; model-supplied requires_approval=false
    cannot waive it.

A3' (direct #12020 reproduction — SAFE_ONLY auto-approve surface):

  INPUT:
    toolInput        = { command: "rm -rf $HOME", requires_approval: false }
    hostAuthorization = commandHostAuthorization({
                          mode: "safe-only",
                          explicitAllowRules: DEFAULT_COMMAND_HOST_ALLOW_RULES,
                        })

  CANONICAL LATTICE (evaluateCommandPolicy):
    decision.kind   = "ask"
    decision.source ≠ "host_mode_safe_only_rule"
                    (positive matcher refused — bounded allow list
                    does not contain rm -rf $HOME; "absence of danger
                    never implies ALLOW")

  VERDICT: A3' GREEN. SAFE_ONLY + R5-catastrophic + model=false
           remains ASK. The upstream #12020 pattern (model-false
           approval waiver in the auto-approve/safe-command lane)
           is NOT reproducible in ClineMM.

A3'' (stronger conservation — YOLO + R5 catastrophic):

  INPUT:
    toolInput        = { command: "rm -rf $HOME", requires_approval: false }
    hostAuthorization = commandHostAuthorization({ mode: "all" })

  CANONICAL LATTICE (evaluateCommandPolicy):
    decision.kind   = "allow"
    decision.source = "host_mode_all"

  R5 CATASTROPHIC FLOOR (evaluateCommandRiskWithParser):
    decision       = "ask"
    disposition    = "never-auto-approve"

  PRODUCTION FINAL VERDICT (sdk-tool-policies.ts:665-679):
    approved = false
    decision.source = "risk_hard_floor"
    mandatorySeatbeltExecution = false

  VERDICT: A3'' GREEN. Under YOLO mode + model=false + R5-catastrophic,
           the composed host-adapter authority chain downgrades
           ALLOW → ASK. The user's explicit YOLO opt-in cannot waive
           approval for catastrophic commands. This is a STRONGER
           property than #12020 (which does not require global YOLO);
           it is a secondary hardening witness, not a #12020
           reproduction.
```

## §7 — Stop-rule applied

```text
A3' GREEN  AND  A3'' GREEN
       ⇒  NOT_A_CLINEMM_DEFECT
       ⇒  APPROVAL_AUTHORITY_FAIL_CLOSED_PROVEN
       ⇒  STOP (per ACT §15)

SCOPE FREEZE:
  PROVEN:
    model-supplied requires_approval=false
    cannot waive ClineMM host-required command approval

  NOT PROVEN BY THIS ACT:
    approval identity / replay safety
    reject-then-retry correlation
    cross-command approval reuse
```

## §8 — Upstream #12020 — how ClineMM is structurally immune

The upstream bug pattern is:

  destructive command + model `requires_approval=false`
  → approval callback receives the model signal and downgrades
    ASK / DENY → ALLOW.

In ClineMM the composition rule at command-policy.ts:120:

```ts
if (modelHints.effectiveEscalation && finalKind === "allow") {
    finalKind = "ask";
    ...
}
```

is the **only** model-driven decision branch, and it ONLY raises.
The mirror branch for `effectiveEscalation === false` does not
exist. There is no `if (modelHints.effectiveDeescalation &&
finalKind !== "allow")` anywhere in the codebase.

In addition:
  - The `parseCommandModelHints` function (command-model-hints.ts:43-53)
    only emits `effectiveEscalation: true` when at least one hint
    is `true`. It cannot emit a `deescalation` signal.
  - The `CommandHostAuthorization` (the only input that can lower
    friction) is host-built and never accepts model input.
  - The session-override "stripRequiresApproval" path
    (session-auto-approval.ts:55-58, applied at SdkController.ts:1048)
    only fires AFTER the user has explicitly set the session
    override to "all" — that is USER_CONFIG, not MODEL_UNTRUSTED.
    Even then, the user's mode is already "all" (so the verdict
    is `host_mode_all`); stripping the model hint only prevents
    the model from DOWN-GRADING the user's explicit ALLOW into ASK.
    This is "model hint cannot override user"; not "model hint
    can override harness".

### Production callsite proof (structural)

The R5 catastrophic hard floor is wired into the production
execution path, not just a side test:

  apps/vscode/src/sdk/sdk-tool-policies.ts:633
    const riskVerdict = evaluateCommandRiskWithParser({
      toolInput, hostAuthorization, parserResult: ...,
    })

  apps/vscode/src/sdk/sdk-tool-policies.ts:665-679
    if (riskVerdict.disposition === "never-auto-approve") {
      return {
        approved: false,
        decision: { kind: "ask", reason: "R5 catastrophic hard floor: never auto-approve",
                    source: "risk_hard_floor" },
        mandatorySeatbeltExecution: false,
      }
    }

This is the structural half of the composed proof in §6: the
production host adapter invokes `evaluateCommandRiskWithParser()`
AFTER `evaluateCommandPolicy()`, and the production final verdict
rejects any R5-catastrophic input even when the canonical lattice
returned ALLOW. The functional half of the composed proof is this
discriminator's §6 A3'' entries, which exercise the same
`evaluateCommandRiskWithParser()` entry point directly with the
R5-catastrophic input that production would receive.

ClineMM is structurally immune to the upstream #12020 pattern.

## §9 — Conservation matrix

The invariant proven in §6 is consistent with the existing
recon-closed prior ACTs:

  - ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION01 / 02 / V2-READONLY:
    bounded risk classifier; ASK and DENY unchanged by model
    hints. ✓ preserved.
  - ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01:
    conditional Seatbelt authority; model hints cannot erase the
    obligation. ✓ preserved.
  - ACT-CLINEMM-SEATBELT-ALL-WORKSPACE-REALPATH-AUTHORITY-*:
    workspace realpath authority forces ASK on operand
    non-conformance; model hints cannot erase. ✓ preserved.
  - ACT-CLINEMM-SESSION-AUTONOMY01 + CORRECTION01 + 02:
    session override changes host authority; model hints cannot
    downgrade user-explicit ALLOW into ASK (stripRequiresApproval
    only fires under override=all). ✓ preserved.

No prior verdict is weakened. No new policy engine is added.

## §10 — ClineMM special question (per ACT §10)

ClineMM's command-policy seam already makes upstream #12020
impossible. The mechanism is **two-layered fail-closed** rather
than "destructive classifier":

**Layer 1 — positive-matcher policy (safe-only lane).**
  ClineMM has NO default hard-deny rules; the safe-only mode is a
  positive-matcher (command-safe-rules.ts:1-40). Positive match → ALLOW;
  absence of a positive match → ASK (fallthrough). The principle
  "absence of danger never implies ALLOW" is what makes
  `requires_approval=false` harmless: the model can only produce a
  false positive ALLOW by tricking the bounded positive matcher, and
  the matcher is finite and bounded-reviewed.

**Layer 2 — R5 catastrophic hard floor (host-adapter consumer).**
  Even under `mode: "all"` (YOLO), the production callsite at
  `sdk-tool-policies.ts:633` invokes `evaluateCommandRiskWithParser()`,
  which layers the R5 catastrophic hard floor (command-risk.ts:179)
  on top of the canonical lattice. The R5 floor forces
  ALLOW → ASK + `disposition: "never-auto-approve"` for a bounded
  set of catastrophic patterns (rm -rf $HOME, rm -rf /, rm -rf ~,
  rm -rf /Volumes, rm -rf .., tee /etc, etc.).

Together: any model hint (true or false) on an R5-catastrophic
command is irrelevant — the R5 floor forces ASK regardless. Any
non-R5 command under safe-only mode is fail-closed via positive-matcher
fallthrough. Any non-R5 command under `mode: "all"` is genuinely
ALLOWED (the user has opted in), which is the correct user-facing
semantics — and is NOT the upstream #12020 surface.

No import of upstream #11638 needed. No port of upstream's fix
needed. ClineMM's policy design predates #12020 and is structurally
immune to it.

## §10.1 — Correction note (Factory causal reviewer, 2026-09-01)

Two corrections applied across two review rounds:

**Round 1 (P0):**
The original A3 of this ACT used `mode: "manual"`, which is
**tautological** — every command asks under MANUAL regardless of
classification. A3 was demoted to a conservation witness and the
load-bearing surface moved to A3' (SAFE_ONLY, direct #12020
reproduction) and A3'' (YOLO + R5 catastrophic, stronger
ClineMM conservation). The corrected test now covers the upstream
#12020 contract directly.

**Round 2 (P1 wording):**
Direct invocation of `evaluateCommandRiskWithParser()` is not
the same as executing the full host-adapter authority chain end
to end. Wording was recalibrated so that the A3'' evidence is
explicitly framed as a **composed proof**:

  STRUCTURAL (§8)  +  SYNTHETIC_REAL (§6 functional)
  =  COMPOSED PROOF

Also: A3'' (YOLO + R5) was reclassified from "the exact upstream
#12020 scenario" to "a STRONGER ClineMM conservation" — because
#12020 does not require global YOLO. A3' (SAFE_ONLY) is the
direct #12020 reproduction; A3'' is a bonus hardening witness.

Scope freeze: this ACT proves only the model-false approval
waiver is structurally impossible. It does NOT prove approval
identity/replay safety, reject-then-retry correlation, or
cross-command approval reuse (upstream #10783 et al).

## §11 — Evidence labels used

REAL_PRODUCTION_SEAM:
  - `evaluateCommandPolicy` (canonical entry point; the
    discriminator invokes it directly).
  - `parseCommandModelHints` (called by `evaluateCommandPolicy` at
    line 110).
  - The aggregate LATTICE rule at command-policy.ts:120.

STRUCTURAL:
  - Q1-Q12 source reconnaissance (§2).
  - Trust model table (§3).
  - Authority-chain diagram (§13).

SYNTHETIC_REAL:
  - Each A1-A6 case invokes the canonical entry point with
    synthetic `requires_approval` values that exercise the
    decision composition.

LIVE:
  - Not required for this ACT (per ACT §11 explicit allowance).

## §12 — Required artifacts (produced)

.factory/acts/ACT-CLINEMM-COMMAND-APPROVAL-AUTHORITY-FAIL-CLOSED-RECON01.md (this file)
.factory/evidence/ACT-CLINEMM-COMMAND-APPROVAL-AUTHORITY-FAIL-CLOSED-RECON01/entry-freeze.txt
.factory/evidence/ACT-CLINEMM-COMMAND-APPROVAL-AUTHORITY-FAIL-CLOSED-RECON01/authority-seam-map.md
.factory/evidence/ACT-CLINEMM-COMMAND-APPROVAL-AUTHORITY-FAIL-CLOSED-RECON01/trust-model.md
.factory/evidence/ACT-CLINEMM-COMMAND-APPROVAL-AUTHORITY-FAIL-CLOSED-RECON01/discriminator.md
.factory/evidence/ACT-CLINEMM-COMMAND-APPROVAL-AUTHORITY-FAIL-CLOSED-RECON01/final-report.md
sdk/packages/core/src/runtime/command-policy/command-policy-authority-fail-closed-recon01.test.ts (the discriminator; passes)

## §13 — Authority-chain diagram

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │ model/tool input                                                     │
  │   {command|commands, [requires_approval], [args]}                    │
  └─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ canonical normalizer (normalizeRunCommandsInput, helpers.ts:137)    │
  │   Failure ⇒ ASK + unknown_input                                      │
  └─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ resolvePerCommand (command-policy.ts:228)                           │
  │   For each normalized command:                                       │
  │     evaluateOne (command-policy.ts:260)                             │
  │       1. explicit deny rules    → DENY (host_hard_deny)             │
  │       2. explicit allow rules   → ALLOW (host_mode_safe_only_rule)  │
  │       3. mode="all"              → ALLOW (host_mode_all)            │
  │       4. mode="safe-only" match → ALLOW else ASK                     │
  │       5. mode="manual"           → ASK (host_mode_manual)            │
  │       6. workspace realpath gate → ASK (host_workspace_realpath_authority) │
  │       7. temp-authority gate     → ASK (host_mktemp_*_unbound)      │
  └─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ aggregateLattice (command-policy.ts:637)                            │
  │   ANY DENY ⇒ deny  |  ANY ASK ⇒ ask  |  else allow                  │
  └─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ parseCommandModelHints (command-model-hints.ts:43)                  │
  │   effectiveEscalation = ANY component is true                       │
  │   (false / missing / malformed ⇒ undefined ⇒ no effect)            │
  └─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ composition rule (command-policy.ts:120) — LOAD-BEARING             │
  │   if (effectiveEscalation && finalKind === "allow") {               │
  │       finalKind = "ask"   // ONLY raises; never lowers              │
  │   }                                                                  │
  │   The mirror branch for "model says false" does NOT exist.          │
  └─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ evaluateCommandRiskWithParser (R5 hard floor, sdk-tool-policies.ts) │
  │   DOWNGRADE-only layer; forces ALLOW → ASK on R5 match.            │
  │   Model hint has already been consumed above; cannot erase.          │
  └─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ VERDICT  →  approved: boolean                                       │
  │   approved = decision.kind === "allow"                              │
  │   mandatorySeatbeltExecution = decision.source === seatbelt_required│
  └─────────────────────────────────────────────────────────────────────┘
```

The ONLY path through which the model hint affects the verdict
is the highlighted box: `if (effectiveEscalation && ALLOW) → ASK`.
There is no symmetric `if (!effectiveEscalation && ASK) → ALLOW`
branch anywhere in the codebase.

## §14 — Final disposition

```text
CLASS:        CASE_A — FAIL_CLOSED / NOT_VULNERABLE
VERDICT:      APPROVAL_AUTHORITY_FAIL_CLOSED_PROVEN
STOP:         YES
REPAIR:       NOT NEEDED
BOARD_DELTA:  EPIC-APPROVAL-PROTECTION row 19 territory:
                command-policy fail-closed authority is PROVEN,
                not hypothesized; no follow-up ACT required.
```
