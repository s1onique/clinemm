# Authority Seam Map — ACT-CLINEMM-COMMAND-APPROVAL-AUTHORITY-FAIL-CLOSED-RECON01

## Production source of truth

| Layer | File | Function | Lines |
|-------|------|----------|-------|
| Canonical entry | `sdk/packages/core/src/runtime/command-policy/command-policy.ts` | `evaluateCommandPolicy()` | 80-151 |
| Composition rule (load-bearing) | `sdk/packages/core/src/runtime/command-policy/command-policy.ts` | (inline) | 116-124 |
| Per-command classification | `sdk/packages/core/src/runtime/command-policy/command-policy.ts` | `evaluateOne()` | 260-635 |
| Aggregate | `sdk/packages/core/src/runtime/command-policy/command-policy.ts` | `aggregateLattice()` | 637-659 |
| Model hint extractor | `sdk/packages/core/src/runtime/command-policy/command-model-hints.ts` | `parseCommandModelHints()` | 43-53 |
| Model hint aggregation rule | `sdk/packages/core/src/runtime/command-policy/command-model-hints.ts` | (inline) | 46-51 |
| Hard floor | `apps/vscode/src/sdk/sdk-tool-policies.ts` | `evaluateCommandRiskWithParser()` | 633-648 |
| VS Code production caller | `apps/vscode/src/sdk/SdkController.ts` | `buildSdkControllerEvaluateCommandToolApproval()` | 344-... |
| VS Code host-authority builder | `apps/vscode/src/sdk/sdk-tool-policies.ts` | `getCommandHostAuthorization()` | 360-... |
| Session override path | `apps/vscode/src/sdk/session-auto-approval.ts` | `resolveSessionHostAuthorization()` | (multiple) |
| Seatbelt envelope stamp | (R5 implementation) | `applySeatbeltAuthorityEnvelope()` | (in tests) |
| CLI production caller | `apps/cli/src/runtime/command-policy-host.ts` | `cliEvaluateCommandToolApprovalWith()` | 430 |

## Authority chain (textual)

```
Model/tool call
  ├── toolInput.command / toolInput.commands (PARSER_DERIVED)
  └── toolInput.requires_approval (MODEL_UNTRUSTED)
         │
         ▼
canonical normalizer (normalizeRunCommandsInput)
         │
         ▼ (failure → ASK + unknown_input)
resolvePerCommand (per-command evaluateOne)
         │     │
         │     ├── explicit deny rules → DENY
         │     ├── explicit allow rules → ALLOW
         │     ├── mode="all"          → ALLOW
         │     ├── mode="safe-only"    → ALLOW or ASK
         │     ├── mode="manual"       → ASK
         │     ├── workspace realpath  → ASK on failure
         │     └── temp-authority      → ASK on failure
         │
         ▼
aggregateLattice (ANY DENY → deny | ANY ASK → ask | else allow)
         │
         ▼
parseCommandModelHints
         │     effectiveEscalation = ANY component is true
         │     (false / missing / malformed ⇒ undefined ⇒ no effect)
         │
         ▼
composition rule — LOAD-BEARING
  if (effectiveEscalation && finalKind === "allow") {
      finalKind = "ask";   // ONLY raises
  }
  // mirror branch for "model says false" does NOT exist
         │
         ▼
R5 hard floor (sdk-tool-policies.ts)
  ALLOW → ASK on risk_hard_floor match (DOWNGRADE-only)
         │
         ▼
VERDICT → approved: boolean
```

## Invariant under test

```
For any (toolInput, hostAuthorization):
  let base = evaluateCommandPolicy(toolInput, hostAuthorization).decision.kind
  let withHintFalse = evaluateCommandPolicy(toolInput + requires_approval=false,
                                              hostAuthorization).decision.kind
  invariant: withHintFalse >= base  (in ALLOW < ASK < DENY lattice)

Equivalently: model hint `false` cannot weaken the verdict kind.
```

## Composition rule verbatim (command-policy.ts:116-124)

```ts
let finalKind = aggregateKind
let finalReason = aggregateReason(perCommand)
let finalSource = aggregateSource(perCommand, input.hostAuthorization, finalKind)

if (modelHints.effectiveEscalation && finalKind === "allow") {
    finalKind = "ask"
    finalReason = `${aggregateReason} (model requested approval)`
    finalSource = "model_escalation"
}
```

The asymmetry is the proof: there is no `if (!effectiveEscalation && finalKind !== "allow")` branch in this file or in `command-model-hints.ts`.

## Production callers (where this verdict flows)

1. **VS Code**:
   `SdkInteractionCoordinator.handleRequestToolApproval(request)` →
   `buildSdkControllerEvaluateCommandToolApproval(...)(request)` →
   `evaluateCommandToolApprovalWithPlan(toolInput, hostAuthorization)` →
   `evaluateCommandToolApproval(toolInput, hostAuthorization)` →
   `evaluateCommandPolicy({ toolInput, hostAuthorization })`.

2. **CLI**:
   `cliEvaluateCommandToolApprovalWith({ toolName, toolInput }, hostAuthorization)` →
   `cliEvaluateCommandToolApproval({ toolName, toolInput }, hostAuthorization)` →
   `evaluateCommandPolicy({ toolInput, hostAuthorization })`.

Both paths route through the same canonical `evaluateCommandPolicy`.

## Host-authority input construction (cannot be model-influenced)

| Builder | File | Accepts model input? |
|---------|------|---------------------|
| `getCommandHostAuthorization(toolName, settings, mcpHub, ...)` | `sdk-tool-policies.ts:360` | NO |
| `resolveSessionHostAuthorization(baseAuth, override)` | `session-auto-approval.ts` | NO (override is USER_CONFIG, not model input) |
| `applySeatbeltAuthorityEnvelope(auth, sandboxMode)` | (R5 implementation) | NO (sandboxMode is ENVIRONMENT_DERIVED) |

`CommandHostAuthorization` is host-built. Model input flows ONLY through `toolInput`.
