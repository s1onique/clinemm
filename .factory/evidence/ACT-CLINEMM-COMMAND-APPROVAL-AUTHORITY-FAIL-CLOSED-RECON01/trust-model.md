# Trust Model — ACT-CLINEMM-COMMAND-APPROVAL-AUTHORITY-FAIL-CLOSED-RECON01

## Inputs that influence the verdict and their trust class

| INPUT | TRUST CLASS | MAY RAISE AUTHORITY? | MAY LOWER FRICTION? | MAY REQUIRE APPROVAL? | MAY WAIVE REQUIRED APPROVAL? |
|-------|-------------|----------------------|---------------------|----------------------|------------------------------|
| `toolInput.requires_approval=true` (per cmd) | MODEL_UNTRUSTED | YES (allow→ask) | NO | YES (in cooperation with host) | NO |
| `toolInput.requires_approval=false` (per cmd) | MODEL_UNTRUSTED | NO | NO | NO | **NO (invariant)** |
| `toolInput.requires_approval` missing | MODEL_UNTRUSTED | NO | NO | NO | NO |
| `toolInput.requires_approval` malformed (non-bool) | MODEL_UNTRUSTED | NO (collapses to undefined) | NO | NO | NO |
| `toolInput.command` (text) | PARSER_DERIVED | n/a | n/a | YES (via classification) | NO |
| `toolInput.commands[]` (multi) | PARSER_DERIVED | n/a | n/a | YES (via per-command + aggregateLattice) | NO |
| `parsed AST` (V2) | PARSER_DERIVED | n/a | n/a | YES (via R5 + V2 structured classifier) | NO |
| `toolInput.tool_name` (model-supplied) | MODEL_UNTRUSTED | n/a (not consumed by policy) | n/a | n/a | NO |
| Persisted `AutoApprovalSettings` (user-config) | USER_CONFIG | YES (YOLO=all → allow) | n/a | YES (manual → ask) | NO |
| `SessionAutoApprovalOverride="all"` | USER_CONFIG (host) | YES (mode=all → allow) | n/a | NO (does not bypass explicit deny) | NO (only when user explicitly opted into all) |
| `stripRequiresApproval` (active under override=all) | USER_CONFIG (host) | n/a — strips model escalation only when override=all is active | n/a | NO | NO (only fires when user explicitly opted into all mode) |
| `CommandHostAuthorization.explicitDenyRules` | HOST_DERIVED | n/a | n/a | YES (→ DENY) | NO |
| `CommandHostAuthorization.explicitAllowRules` | HOST_DERIVED | n/a (positive ALLOW) | n/a | n/a | NO |
| `CommandHostAuthorization.pathAuthorityEvidence` | HOST_DERIVED (fs.realpathSync) | YES (DOWNGRADE only: ALLOW → ASK on non-conformance) | NO | YES | NO |
| `CommandHostAuthorization.tempAuthorityEvidence` | HOST_DERIVED (darwin /usr/bin/mktemp gate) | YES (DOWNGRADE only: ALLOW → ASK on unbound) | NO | YES | NO |
| `CommandHostAuthorization.mandatorySeatbelt` | HOST_DERIVED (kernel envelope) | YES (ALLOW carries Seatbelt obligation) | n/a | YES (executor refuses host-shell fallback) | NO |
| `Seatbelt.sandboxMode` | ENVIRONMENT_DERIVED | YES (R5 conditional authority) | n/a | YES | NO |
| Explicit operator approval (live UI) | USER_CONFIG (live) | YES (ask → allow) | YES (ask → allow) | YES | NO |

## Trust rule (frozen)

```text
MODEL_UNTRUSTED inputs can NEVER produce:
  - broader filesystem authority,
  - broader network authority,
  - approval waiver,
  - or weaken any existing ASK/DENY verdict,

without an independent trusted policy decision
(USER_CONFIG / TRUSTED_HOST_POLICY / ENVIRONMENT_DERIVED).

Enforcement:
  effectiveKind = maxRestrictive(harnessBase, modelEscalation)

where modelEscalation is `ASK` if ANY component hint is `true`,
      else UNDEFINED (never `ALLOW`).

Composition rule in source (command-policy.ts:120):
  if (modelHints.effectiveEscalation && finalKind === "allow") {
      finalKind = "ask";
  }
  // No mirror branch exists.
```

## Source-of-truth enforcement (commands the policy refuses)

The composition rule prevents model input from issuing the following
host-only commands:

| Host-only command                              | How model hint is prevented from issuing it |
|------------------------------------------------|---------------------------------------------|
| "Grant ALLOW for an ASK-required command"     | No mirror branch in composition rule; allow→ask is one-way |
| "Erase the per-command safe execution profile" | Profile attached to EvaluatedCommand survives model hint |
| "Skip the R5 catastrophic hard floor"         | Hard floor runs AFTER composition; downstream of model input |
| "Bypass explicit deny rules"                  | Deny precedence runs in evaluateOne before aggregate |
| "Bypass workspace realpath authority"        | Realpath gate runs in evaluateOne before aggregate |
| "Bypass seatbelt obligation on ALLOW"        | mandatorySeatbeltExecution derived from kernel envelope, not from model hint |
| "Approve a malformed/unknown command"        | Normalizer failure path is ASK + unknown_input |
| "Cross a session/command identity" (replay)  | Per-call fresh normalization; no cached verdict |

## Symmetric proof: `effectiveEscalation` is monotone-only

`parseCommandModelHints` (command-model-hints.ts:46-51):

```ts
let effective = false
for (const h of hints) {
    if (h === true) {
        effective = true
    }
}
return { perCommand: hints, effectiveEscalation: effective }
```

This emits `effectiveEscalation: true` only when at least one hint
is `true`. It cannot emit a "deescalation" signal. Therefore the
composition rule cannot be inverted — `effectiveEscalation === false`
is structurally identical to "no signal".
