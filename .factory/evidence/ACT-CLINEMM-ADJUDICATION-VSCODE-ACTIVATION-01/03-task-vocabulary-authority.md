# 03 — Task vocabulary authority (G2)

**ACT:** ACT-CLINEMM-ADJUDICATION-VSCODE-ACTIVATION-01
**Classification:** STRUCTURAL

## G2.1 The contract

The SDK's existing `CoreAdjudicationConfig`
(`sdk/packages/core/src/types/adjudication-config.ts`) requires:

```ts
{
  enabled: true,
  vocabulary: authorizedTaskVocabulary,
  revisionResolver: trustedRevisionResolver,
  secretProvider: trustedSessionSecretProvider
}
```

All four fields already existed and were already consumed by
`LocalRuntimeHost.startResolvedSession`. The ACT did NOT change that
interface, did NOT add a proto message, and did NOT add a public tool.

## G2.2 How the authorization is carried

### The constraint

The vocabulary is TASK-SCOPED: `S1` and `manual_enforcement_only` are
meaningful only inside the task that defined them. The ACT therefore had to
find a mechanism that:

- carries an EXPLICITLY AUTHORIZED, task-scoped vocabulary;
- is NOT derivable from a prompt, a workspace file, repository content, tool
  output, the model's interpretation, the presence of compaction, or
  provider/model identity;
- does NOT introduce a new global vocabulary;
- does NOT require a new public protocol or a new settings subsystem.

### The rejected candidates

| Candidate | Why it was rejected |
|---|---|
| A new `Settings` field (e.g. `adjudicationVocabulary`) | `Settings` is a GLOBAL persisted surface. A vocabulary there would be a GLOBAL vocabulary — exactly what the SDK contract and G2.2 forbid. It would also need a proto change (`Settings` is a proto message), i.e. a NEW PUBLIC PROTOCOL → `HALT_SCOPE_EXPANSION`. |
| Reading a repository file (e.g. `.cline/adjudication.json`) | A repository-controlled file must NOT silently authorize a privileged host capability (G2.2). It would also let any clone authorize itself. |
| Deriving the vocabulary from the prompt | Untrusted model/user content widening the contract it is supposed to constrain. |
| Deriving the vocabulary from tool output or thinking | Explicitly forbidden by the SDK contract and G0.2 (the historical M1 loss of thinking-only adjudications). |

### The ADOPTED mechanism — the existing `SessionAutoApprovalStore` pattern

The codebase already contains the exact shape this ACT needs:
`SessionAutoApprovalStore` (`apps/vscode/src/sdk/session-auto-approval.ts`)
is a host-owned, in-memory, ONE-SHOT armed intent that binds to the NEXT
session id and is consumed EXACTLY ONCE at the authoritative allocation
point.

The ACT adopted the identical discipline in
`apps/vscode/src/sdk/adjudication-task-contract.ts`:

```
arm(contract)                      // an explicit, user-authorized act
   ↓
peekArmed()                        // PURE read by the config producer
   ↓
consumeForSession(sessionId)        // CONSUMED EXACTLY ONCE, at the
   ↓                               // authoritative session-id allocation
getBound(sessionId)                // point (SdkTaskStartCoordinator)
```

Properties this gives, each witnessed by a test:

| Property | Witness |
|---|---|
| Ordinary tasks are UNCHANGED | RED-1: `config.adjudication` is `undefined` |
| An unrelated task NEVER inherits the contract | RED-2: `store.getBound("session-B")` is `undefined` after `session-A` consumed the arm |
| The arm is consumed EXACTLY ONCE | RED-2: `store.hasArmed()` is `false` after consumption |
| A RESUME/REBUILD keeps the in-flight contract | `getBound(input.sessionId)` is consulted first by the producer |
| A repository file CANNOT authorize it | Only `arm()` authorizes; nothing reads the workspace |
| No new public protocol | No proto change; no new tool; no new settings field |

### The store is transport-agnostic on purpose

`AdjudicationTaskContractStore` deliberately owns NO proto message, NO UI and
NO settings field. The host's task-authority seam decides HOW a user
authorizes a contract and calls `arm()`. That keeps the production delta at
"the real VS Code host-configuration boundary and its directly necessary
trusted adapters" — exactly the authorized scope — and keeps the public
protocol untouched.

**Consequence, stated plainly:** the ACT provides the AUTHORIZATION MECHANISM
and wires it end-to-end through the real producer and consumer, but it does
NOT ship a UI control that arms it. The arming call site is a host-authority
seam; a follow-up that exposes it to a user surface is a separate, smaller
ACT.

## G2.3 The task-scoped vocabulary fixture

The first smoke test uses the small, explicitly-approved synthetic vocabulary
from the ACT brief. It is a TEST FIXTURE, not a new global vocabulary:

```ts
{
  findingIds: ["S1"],
  decisions: ["supported", "narrowed", "refuted", "unresolved"],
  qualificationCodes: ["manual_enforcement_only"],
  remainingQuestions: { "S1.automated_enforcement": "S1" },
  allowedDecisionsByFinding: { S1: ["narrowed", "unresolved"] },
}
```

The runtime-chain suite additionally asserts the LOAD-BEARING qualification
(`requiredQualificationsByFinding: { S1: ["manual_enforcement_only"] }`), so
the "missing essential qualification" rejection is genuinely exercised rather
than vacuously satisfied.

**No permanent Keycloak/Round C vocabulary was created.** A real Round C
activation requires an explicitly authorized contract defining R1-R10 and
their allowable qualifications; nothing here guesses at those.

`HALT_VOCABULARY_AUTHORITY_UNRESOLVED` does **NOT** apply: the existing
task interface CAN carry an authorized task-scoped vocabulary, through the
existing armed-intent seam.
