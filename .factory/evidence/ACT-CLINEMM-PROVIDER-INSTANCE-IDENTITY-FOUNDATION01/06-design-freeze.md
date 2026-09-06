# 06 — §12 Design Freeze

Foundation ACT: §12 design freeze per ACT body §12.
Recon-only ACT — production edits FORBIDDEN in this commit.
Freeze date: 2026-09-06 (fifth-reviewer C1 authorization).

## 0. Reviewer verdict being executed

```text
P0   = NONE
P1   = NONE
P2   = superseded reconstruction-path sections survive before
      Amendment01; explicitly superseded, NON-BLOCKING

EVIDENCE_BINDING                       = PASS
R0_ACTIVE_SESSION_SEAM_NOT_BOUND       = CLOSED
CURRENT_SEAM_CAN_EXPRESS_INSTANCE_IDENTITY = NO
CURRENT_SEAM_MUTATES_FULL_CONNECTION   = NO
CURRENT_ACTIVE_MUTATION_AUTHORITY      = modelId only

R0_EVIDENCE                            = STRUCTURAL
R0_EXECUTED_SWITCH                     = NOT_EXECUTED

FOUNDATION_RECON_PHASE                 = READY FOR §12
FOUNDATION_IMPLEMENTATION_PHASE        = NOT OPEN YET
MODEL_PROFILES_IMPLEMENTATION          = NOT AUTHORIZED

VERDICT                                = C1: GO TO §12 DESIGN FREEZE
                                          → GENUINE R1 RED
```

This file freezes the §12 design choices that the C1 verdict
authorizes. R1 reproduces the §11b per-row NO matrix; the
implementation phase (foundation ACT §13/§14/§15) is gated on a
genuine RED first.

## 1. Scope of §12

§12 freezes four design decisions:

1. **Storage geometry (α / β / γ):** where the
   `ProviderConfigurationInstance` record physically lives.
2. **Semantic credential identity:** the abstract notion of
   "which credential this instance uses," separate from any
   secret-string encoding.
3. **Physical secret-reference encoding:** the wire/storage form
   of the credential reference (opaque pointer vs. literal key
   vs. SDK `ProviderSettings.apiKey` field vs. legacy
   `openAiApiKey` slot).
4. **Runtime strategy (A / B / C):** how a `apply instance B`
   operation on an active session actually changes the next
   effective request.

The freeze must satisfy one external invariant:

```text
CURRENT_SEAM_MUTATES_FULL_CONNECTION becomes YES (post-fix)
        ⇒ every provider-relevant operand in evidence 05 §11b
          reaches the next request after a same-providerId
          instance switch
```

and preserve the conservation witness:

```text
same instance + model A1 → A2
  ⇒ existing updateSessionModel fast path remains active
  ⇒ no full rebuild required
```

## 2. Storage geometry (α / β / γ)

### 2-pre. Authority (precise)

```text
instances.json =
  canonical SAVED PROVIDER-INSTANCE DEFINITIONS only
  (what the user has named and persisted; source of truth
   for "which instances exist" — NOT for "which one is
   active")

ApiConfiguration (legacy globalState.json) + providers.json =
  projected LIVE COMPATIBILITY/CONFIGURATION state
  (what the runtime actually reads when it builds the next
   request; mirrors of whatever instance the caller most
   recently asked to be applied)
```

The two are not equivalent. `instances.json` is the
canonical definition store; the legacy/projection state
is a derived view produced by the APPLY path (§4d).

### Active-instance binding authority (FOUNDATION DOES NOT OWN)

The Foundation explicitly does **not** own the active-
instance binding. Concretely:

```text
INSTANCE_DEFINITION_AUTHORITY      = instances.json
ACTIVE_INSTANCE_BINDING            = CALLER/SESSION-SCOPED,
                                     NOT OWNED BY FOUNDATION
GLOBAL_ACTIVE_INSTANCE_ID          = FORBIDDEN
                                     (would recreate the same
                                      per-session authority
                                      collapse the Model
                                      Profiles correction
                                      already closed at the
                                      profile layer — see
                                      .factory/evidence/
                                      ACT-CLINEMM-MODEL-
                                      PROFILES-QUICK-SWITCH-
                                      RECON01/12-corrected-
                                      freeze.md §RESUME_USES /
                                      §NEW_SESSION_USES /
                                      §SESSION_PROFILE_APPLI-
                                      CATION = SPLIT_ACTION)
```

A single global `instances.json.activeInstanceId` is
forbidden for exactly the same reason a single global
`lastUsedProfileId` was forbidden in the predecessor
recon: it would re-collapse the per-task/session binding
authority one layer lower. The Model Profiles contract
already froze `RESUME_USES = SESSION_ACTIVE_PROFILE (+ GLOBAL
fallback)` and `NEW_SESSION_USES = GLOBAL_DEFAULT_PROFILE`;
the Foundation must not introduce a parallel global
pointer at the instance layer that the implementation ACT
would then have to undo.

Concrete consequence: `applyProviderConfigurationInstance`
takes **both** `fromInstanceId` and `toInstanceId` as
explicit arguments. The caller — which may be a
session-bound binding, a global-default binding, an
implementation-ACT-level profile pointer, or the R1 RED
harness — is the only thing that knows what "currently
active" means in its context. The Foundation just applies
the transition.

Quick-switching mutates `instances.json` (via DEFINE/
UPDATE) and the projected live state (via APPLY), in
distinct phases: the APPLY path projects the chosen
instance into the live state, and the DEFINE/UPDATE path
(§4d) is the only writer that introduces or changes an
instance credential.

### 2a. Definitions

```text
α = providers.json-only
    ProviderConfigurationInstance lives as a sibling of
    ProviderSettings inside providers.json; legacy
    ApiConfiguration remains the live config and is rewritten
    by the extension when an instance is "applied."

β = dual-track
    ProviderConfigurationInstance lives in providers.json
    alongside ProviderSettings; legacy ApiConfiguration stays
    the legacy mirror but is no longer the only writable
    surface for a given field.

γ = dedicated store
    ProviderConfigurationInstance lives in a separate file
    (e.g. instances.json) under ~/.cline/data/, alongside
    globalState.json; providers.json and ApiConfiguration
    continue unchanged.
```

### 2b. Decision: **γ** with a **β-shaped read path**

The current seam splits state across two stores that are not
1:1:

```text
legacy ApiConfiguration
  ⇒ globally keyed in globalState.json
  ⇒ openAiApiKey, openAiBaseUrl, openAiHeaders,
    planModeApiProvider, actModeApiProvider,
    planModeApiModelId, actModeApiModelId, ...
  ⇒ mode-aware (plan/act)

providers.json / ProviderSettings (SDK)
  ⇒ per-providerId
  ⇒ apiKey, baseUrl, modelId (default), headers,
    providerSpecificConfig, apiLine, region, ...
  ⇒ NOT mode-aware; the same record serves both modes
```

α collapses these into one file, which makes the plan/act
split either a load-bearing per-field concept (which it is
today) or a derivable one (which it could become). Either
choice is a behavioral change that has to be reasoned through
**before** the foundation ACT is done.

β keeps both stores but stops pretending one of them is the
single source of truth. It is a writing-through layer on top of
two persistent stores that already diverge.

γ is the smallest-blast-radius geometry because it leaves both
existing stores alone, adds a third, and turns the
`apply instance B` operation into:

```text
1. write chosen instance record into instances.json
2. project instance fields back onto legacy ApiConfiguration
   + (where applicable) ProviderSettings
3. trigger runtime strategy (see §5) on the active session
```

### 2c. Why γ is preferred

α forces a migration of every existing user state into
`providers.json` and removes the legacy `ApiConfiguration`
plan/act split. That is implementation-phase work, not
foundation-phase. It also couples the foundation to a
mode-aware projection of ProviderSettings that does not exist
upstream today.

β is plausible but has the worst long-term property: two
stores, each authoritative for some fields, with no single
read-side contract for "what is the live config." The
extension's `buildSdkProviderConfig` already routes through
`resolveApiKey` / `resolveBaseUrl` / `resolveModelId` which
fan out across both stores; preserving that fan-out while
adding a third writer is the same shape of dual-semantic
problem the reviewer flagged on Strategy C (see §5d).

γ is a third file with a clear contract:

```text
instances.json (new) is the source of truth for which
ProviderConfigurationInstance is "active." It is the only
file written by the `apply instance B` path.

globalState.json (legacy ApiConfiguration) and providers.json
(ProviderSettings) are the live mirrors that the active
session reads from. They are written by a single projection
function called as part of `apply instance B`, before the
runtime strategy is invoked.
```

The extension's existing read-side fans (legacy state vs.
SDK ProviderSettings) do not change. The only new code is:

- a `loadActiveInstanceId()` / `saveActiveInstanceId(id)`
  pair on StateManager, backed by instances.json;
- an `applyProviderConfigurationInstance(instanceId)`
  orchestrator that projects the chosen instance onto legacy
  state and providers.json before triggering the runtime
  strategy.

### 2d. Schema sketch for instances.json

```text
// ~/.cline/data/instances.json
//
// NOTE: NO active_instance_id field. instances.json is
// definition storage ONLY. Active-instance binding is the
// caller's responsibility (see §2-pre Authority).
{
  "schema_version": 1,
  "instances": {
    "local-ollama": {
      "instanceId": "local-ollama",
      "label": "Local Ollama (qwen3)",
      "providerId": "openai-compatible",
      "modelId": "qwen3-local",
      "baseUrl": "http://localhost:11434/v1",
      "credentialRef": { "kind": "secret", "name": "local-ollama-key" },
      "headers": {},
      "providerSpecificConfig": {},
      "apiLine": null,
      "region": null,
      "routingProviderId": null,
      "modes": ["plan", "act"]
    },
    "corp-llm": {
      "instanceId": "corp-llm",
      "label": "Corporate gateway",
      "providerId": "openai-compatible",
      "modelId": "qwen3-corp",
      "baseUrl": "https://llm.corp.example/v1",
      "credentialRef": { "kind": "secret", "name": "corp-llm-key" },
      "headers": { "X-Instance": "corp-llm" },
      "providerSpecificConfig": {},
      "apiLine": null,
      "region": null,
      "routingProviderId": null,
      "modes": ["plan", "act"]
    }
  }
}
```

Notes:

- `providerId` is the model-catalog key (e.g. `openai-compatible`).
- `routingProviderId` is reserved but stays `null` for any
  built-in provider; only set when the user wants custom
  catalog/identity behavior on top of a built-in transport.
- `modes` defaults to `["plan", "act"]`; per-mode instance
  overrides (different plan vs. act instances) are explicitly
  out of scope for this foundation.
- The shape is one instance per `instanceId`, with the active
  id pinned separately. The schema does not embed a graph of
  cross-instance relationships.

### 2e. Read-side projection

The projection from an `Instance` to the legacy `ApiConfiguration`
+ `ProviderSettings` pair is a single, testable function:

```text
projectInstanceToLiveConfig(
  instance: Instance,
  secretValue: string
): {
  apiConfigPatch: Partial<ApiConfiguration>;
  providerSettingsPatch?: Partial<ProviderSettings>;
}
```

Inputs:

- The instance record.
- The user's current secret value (resolved by name from the
  secrets store at the call site — see §4d APPLY step 3).
  The projection is **given** the resolved value; it does
  not resolve it itself and it does not write it back.

Outputs:

- `apiConfigPatch`: the set of legacy ApiConfiguration fields
  that need to be set on the active mode (plan or act).
- `providerSettingsPatch`: the set of ProviderSettings fields
  that need to be written to providers.json (when the chosen
  field path lives in providers.json rather than legacy
  state — see the openai vs openai-compatible precision
  fix in evidence 05 §11c).

The projection does **not** return a `secretWrite` field.
Per §4d the APPLY path is read-only with respect to the
secrets store; the projection's only job is to translate
the instance record (plus the already-resolved credential
value) into a live-configuration patch.

The projection is **the** place where the precision fix in
evidence 05 §11c lives: it routes `openaiHeaders` to legacy
state and `ProviderSettings.headers` (for openai-compatible) to
providers.json.

## 3. Semantic credential identity

### 3a. Definition

```text
credential identity =
  the abstract answer to "which credential does this
  ProviderConfigurationInstance own?"
```

It is *not* the secret string. It is *not* the providerId.
It is *not* the secret-name key in the secrets store.

The invariant that evidence 05 §11 codifies is:

```text
Instance A → credential identity A
Instance B → credential identity B

raw secret duplicated into instance/profile metadata = NO
```

### 3b. Decision: credential identity = `credentialRef.name`

The chosen encoding is the `credentialRef.name` field of the
instance record. Each instance owns exactly one credential
identity, and the credential identity is the name of a
secret in `secrets.json`.

Concretely:

```text
Instance "local-ollama"   → credential identity "local-ollama-key"
                            resolves to secrets["local-ollama-key"]
Instance "corp-llm"       → credential identity "corp-llm-key"
                            resolves to secrets["corp-llm-key"]
```

Properties this encoding satisfies:

- **Same-providerId instances are still distinguishable.**
  Two `openai-compatible` instances with the same `modelId`
  can still have different `credentialRef.name` values.
- **Same-credential identities across providerIds are
  possible.** Two instances with different providerIds can
  share a single secret (e.g. one OpenAI key reused across
  an OpenAI instance and an OpenAI-compatible instance).
- **No secret duplication.** The instance record never
  embeds the secret value. The projection function (§2e)
  reads it at apply time.
- **Secret name reuse across applies is supported.** If the
  user renames a secret in their secrets store, only the
  projection needs to be re-run; the instance record itself
  is unaffected.

### 3c. Why not encode credential identity as providerId

```text
credential identity == providerId    ← WRONG
```

This would make two same-provider instances impossible
(reviewer's §"Credential identity remains the other
load-bearing §12 choice"):

```text
Instance A: providerId = openai-compatible, secret = key-A
Instance B: providerId = openai-compatible, secret = key-B

If credential identity == providerId, then both instances
collapse onto providerId = "openai-compatible" and the
secret slot becomes a single shared field. There is no
mechanism for distinguishing them in active state.
```

The `ProviderSettings.apiKey` field is per-providerId in
providers.json, not per-instance. The legacy `openAiApiKey`
field is per-providerId in globalState.json. Treating
credential identity as providerId is exactly the
conflation the reviewer warned about.

### 3d. Why not embed the raw secret in the instance record

```text
Instance { ..., secret: "sk-..." }   ← WRONG
```

Two reasons:

1. **Persistence durability.** The secret would be written to
   a JSON file under `~/.cline/data/` whose default
   permissions are not the 0o600 mode of `secrets.json`. A
   raw secret in `instances.json` would silently downgrade
   secret-storage security.
2. **Reuse.** A secret shared by multiple instances would
   have to be duplicated across multiple instance records,
   violating the no-duplication invariant and creating a
   consistency obligation across files.

### 3e. What credential identity is **not**

- It is **not** the `apiKey` field on `ProviderSettings`
  (that is the physical encoding used by the SDK).
- It is **not** the secret-name key (that is the binding
  mechanism, but the identity is the abstract "which
  credential this instance owns").
- It is **not** a fingerprint/hash of the secret (the
  semantic identity must remain readable by humans editing
  instances.json; a hash would make the file opaque).

## 4. Physical secret-reference encoding

### 4a. Definition

```text
physical secret-reference encoding =
  the storage-level mechanism that links
  `Instance.credentialRef` to an actual secret value
  at apply time
```

### 4b. Decision: `kind = "secret"` with `name` = secret-store key

The only encoding defined in this foundation is:

```text
credentialRef = { kind: "secret", name: "<secret-store-key>" }
```

where `<secret-store-key>` resolves to a key in the
file-backed secrets store (`secrets.json`). The projection
function (§2e) reads the secret value at apply time and
writes it into the appropriate live-config slot:

- `openAiApiKey` (legacy state) for `providerId === "openai"`.
- `ProviderSettings.apiKey` (providers.json) for
  `providerId === "openai-compatible"` and other SDK-routed
  providerIds.
- Per-providerId legacy slots for the remaining legacy
  providers (e.g. `qwenApiKey`, `geminiApiKey`,
  `mistralApiKey`, etc.).

### 4c. Reserved kinds

```text
credentialRef.kind ∈ { "secret" }   // foundation phase
```

Future kinds the foundation does **not** implement but does
**not preclude**:

- `"vault"`: external vault integration (HashiCorp Vault,
  AWS Secrets Manager, etc.). Reserved as a future kind.
  Vault-backed credentials do NOT violate
  `PROFILE_CONTAINS_RAW_SECRET = NO` because the secret
  value never enters `instances.json` (the profile holds
  only a vault reference, not the secret itself).

A `"raw"` / `"inline"` discriminator is **explicitly not
reserved**: any future kind that stores the secret value
inside the profile record would directly violate the
`PROFILE_CONTAINS_RAW_SECRET = NO` invariant. If such a
requirement ever arises, it must be (a) re-justified against
that invariant and (b) introduced via a `schema_version`
bump + explicit migration code, not by pre-declaring it
here.

The schema-versioning discipline is: any new `kind` value
requires a `schema_version` bump in `instances.json` and
explicit migration code in `applyProviderConfigurationInstance`.

### 4d. Secret-store path (APPLY = read-only; DEFINE = separate write path)

The credential store is touched in exactly two phases, and
the two phases are **distinct code paths**. Conflating them
— as the original draft did — produces an identity
tautology (`currentValue == secretValue` by construction),
so the foundation explicitly forbids it.

#### APPLY (read-only)

The APPLY path runs on every instance switch. It
**resolves** the credential reference but does **not**
write to the secrets store, and it does **not** own any
active-instance binding:

```text
// fromInstanceId and toInstanceId are BOTH supplied by the
// caller. The Foundation does not consult or maintain a
// global "current active" pointer (see §2-pre Authority).
applyProviderConfigurationInstance(fromInstanceId, toInstanceId):
  // 1. Idempotency check: caller asked for the same instance
  //    it already has active = no-op.
  if (toInstanceId === fromInstanceId) return

  // 2. Resolve instance record from instances.json.
  inst = loadInstance(toInstanceId)
  if (inst.credentialRef.kind !== "secret") {
    throw new Error(`unsupported credentialRef.kind
                    = ${inst.credentialRef.kind}`)
  }

  // 3. Resolve credential VALUE from secrets.json (READ-ONLY).
  //    Missing credential is a hard error — the user must
  //    have called defineOrUpdateInstanceCredential first.
  secretValue = stateManager.getInstanceSecret(
    inst.credentialRef.name
  )
  if (!secretValue) {
    throw new Error(
      `instance credential not found: name=${inst.credentialRef.name}`
    )
  }

  // 4. Project instance → live config (single function;
  //    see §2e — no secretWrite field anymore).
  patch = projectInstanceToLiveConfig(inst, secretValue)
  applyApiConfigurationPatch(patch.apiConfigPatch, targetMode)
  if (patch.providerSettingsPatch) {
    applyProviderSettingsPatch(patch.providerSettingsPatch)
  }

  // 5. Rebuild the active session (gated on isRunning === false).
  //    NOTE: there is intentionally NO setActiveInstanceId step
  //    here. The caller — not the Foundation — owns whatever
  //    session/global binding it needs (see §2-pre Authority).
  rebuildActiveSession({
    reason:     "instance-switch",
    fromInstanceId,
    toInstanceId,
  })
```

#### DEFINE / UPDATE (separate write path — user-initiated)

The DEFINE/UPDATE path is **never invoked from APPLY**.
It is the concern of the instance-creation / instance-edit
UI (future §17), and it is what writes the secret value
into the secrets store in the first place:

```text
defineOrUpdateInstanceCredential(credentialRef, secretValue):
  // credentialRef must be a valid CredentialRef (parsed
  // against the InstanceSecretNameSchema in §7).
  if (credentialRef.kind !== "secret") {
    throw new Error(
      `unsupported credentialRef.kind = ${credentialRef.kind}`
    )
  }
  stateManager.setInstanceSecret(credentialRef.name, secretValue)
  // Persists to secrets.json under the reserved "instance:"
  // prefix (see evidence 06a §7). Same atomic-rename
  // discipline as the existing setSecret path.
```

The two phases never overlap:

- APPLY never writes to the secrets store.
- DEFINE/UPDATE is the only writer of instance credential
  values, and it is gated on explicit user intent (saving
  a profile in the UI), not on quick-switch events.

This is consistent with the original product: quick
switching should not mutate secrets every time the user
clicks a profile.

#### Why this replaces the prior `secretWrite` algorithm

The prior draft had:

```text
secretValue = resolveSecretValue(secretName)
currentValue = secrets[secretName]
if (currentValue !== secretValue) {
    setSecret(secretName, secretValue)
}
```

`secretValue` and `currentValue` come from the same secret
entry — barring race/canonicalization differences,
`currentValue == secretValue` by construction. The block
is not a mechanism for introducing or changing a credential;
it is an identity test of a value against itself.

The new shape fixes this by construction: APPLY is
read-only; DEFINE/UPDATE is the only writer; the two are
not the same function.

The secret-store write is **only** triggered by an explicit
DEFINE/UPDATE event. A same-instance model switch
never enters this branch.

## 5. Runtime strategy (A / B / C)

### 5a. Definitions

```text
Strategy A = expand hot mutation
  Add a new live-update path that calls
  updateSessionConnection for the operands supported by
  the SDK ConnectionUpdate shape:
    providerId, modelId, apiKey, baseUrl, headers,
    providerConfig, reasoningEffort, thinking,
    thinkingBudgetTokens
  Same session, in-place mutation, gated on
  isRunning === false.

Strategy B = full session reconstruction
  When instanceId changes, tear down the active session
  and reconstruct it from the projected
  ApiConfiguration + ProviderSettings. Same-instance
  model-only switches keep the existing updateSessionModel
  fast path.

Strategy C = hybrid
  Hot-mutate the subset supported by ConnectionUpdate;
  full-rebuild for the operands not in ConnectionUpdate
  (apiLine, region, structured aws/gcp/azure/sap/oca).
```

### 5b. Decision: **B** (full session reconstruction)

The decision is **B**, for three reasons derived directly
from evidence 05:

1. **Coverage.** A covers at most the SDK `ConnectionUpdate`
   shape (providerId, modelId, apiKey, baseUrl, headers,
   providerConfig, reasoningEffort, thinking,
   thinkingBudgetTokens). It does **not** cover `apiLine`,
   `region`, or the structured `aws`/`gcp`/`azure`/`sap`/
   `oca` blocks (evidence 05 §11b). To reach a YES on every
   provider-relevant operand, A must be paired with a
   rebuild anyway — at which point it is C, not A.
2. **Conservation.** B preserves the existing model-only
   fast path (`updateSessionModel`). A replaces the seam
   wholesale with a richer in-place mutator that has to be
   kept in sync with the SDK `ConnectionUpdate` shape
   forever. B's correctness story is simpler: the rebuild
   reads from the same projected `ApiConfiguration` +
   `ProviderSettings` pair that `buildSdkProviderConfig`
   already uses at construction time.
3. **Headers bridge.** Evidence 05 §6 carries
   `HEADERS_PROVIDERCONFIG_BRIDGE_DROP =
   STRUCTURALLY_PROVEN`. A would require fixing the builder
   *and* threading `headers` through the new mutator. B
   fixes the builder once and rebuilds use the fixed
   builder. Two artifacts to repair under A; one under B.

### 5c. Rebuild semantics

The rebuild is invoked **only** on an `instanceId` change
(`toInstanceId !== fromInstanceId`, both supplied by the
caller — see §2-pre Authority and §4d APPLY). The fast path
on a same-instance model switch is untouched.

```text
applyProviderConfigurationInstance(fromInstanceId, toInstanceId):
  if (toInstanceId === fromInstanceId) {
    // Same-instance: no rebuild, no projection write.
    return
  }
  inst = loadInstance(toInstanceId)
  if (inst.credentialRef.kind !== "secret") {
    throw new Error(`unsupported credentialRef.kind
                    = ${inst.credentialRef.kind}`)
  }
  // 1. Resolve credential value (READ-ONLY; per §4d APPLY).
  secretValue = stateManager.getInstanceSecret(
    inst.credentialRef.name
  )
  if (!secretValue) {
    throw new Error(
      `instance credential not found: name=${inst.credentialRef.name}`
    )
  }
  // 2. Project instance + resolved value to live config (see §2e).
  patch = projectInstanceToLiveConfig(inst, secretValue)
  // 3. Apply patch to legacy ApiConfiguration
  //    (mode-aware: plan OR act, not both).
  applyApiConfigurationPatch(patch.apiConfigPatch, targetMode)
  // 4. Apply patch to providers.json (if any).
  if (patch.providerSettingsPatch) {
    applyProviderSettingsPatch(patch.providerSettingsPatch)
  }
  // 5. Rebuild the active session from the projected config.
  //    NOTE: NO setActiveInstanceId here. The Foundation does
  //    not own active-instance binding (see §2-pre Authority).
  rebuildActiveSession({
    reason: "instance-switch",
    fromInstanceId,
    toInstanceId,
  })
```

Notes:

- **In-flight safety.** Step 6 must be gated on
  `isRunning === false` (the secondary assertion in
  evidence 03). If a request is mid-flight when the user
  applies a different instance, the rebuild is deferred
  until the request completes — the same safety property
  the existing rebuild path (on providerId change) already
  enforces.
- **Mode scope.** This foundation fixes a single
  active-instance id. Per-mode instance overrides (different
  plan vs. act instances) are explicitly out of scope; see
  §7.
- **Idempotence.** Re-applying the same instance id is a
  no-op; the function returns before the projection runs.
  This is the conservative-witness lever.

### 5d. Why not C

C is technically correct but pays a conservation tax
forever:

```text
HOT_MUTATION_RESULT == REBUILD_RESULT
```

for every overlapping operand (providerId, modelId, apiKey,
baseUrl, headers, providerConfig, reasoningEffort, thinking,
thinkingBudgetTokens). A new SDK field added to
`ConnectionUpdate` would have to be reasoned through twice
once C is in place. The reviewer flagged this explicitly:

> It creates two ways of applying instance state and
> therefore a conservation obligation: … for every overlapping
> operand forever. Given the Factorize work you just
> completed, that's exactly the sort of dual-semantic path to
> avoid without necessity.

B has one application path. C has two. The factorize work
makes B the strictly smaller choice.

### 5e. Conservation witness

```text
same instance
  + model A1 → A2
  ⇒ updateSessionModel(A2)            (existing fast path)
  ⇒ no rebuild
  ⇒ no projection write (credential identity unchanged)
  ⇒ no secret-store write
```

This is the same fast path that exists today, minus the
providerId-change-rebuild behavior that already lives in
`cline-session-factory.ts`. The foundation does not touch
that fast path; it only adds the rebuild trigger for
instanceId change.

## 6. R1 geometry (genuine RED)

### 6a. Primary R1 fixture (per reviewer's recommendation)

```text
Instance A:
  instanceId  = A
  providerId  = openai-compatible
  modelId     = same-model       (modelId A == modelId B)
  baseUrl     = https://a.invalid/v1
  credential  = secret-A
  headers     = { X-Instance: A }

Instance B:
  instanceId  = B
  providerId  = openai-compatible
  modelId     = same-model
  baseUrl     = https://b.invalid/v1
  credential  = secret-B
  headers     = { X-Instance: B }
```

This geometry defeats the existing fast path by construction:

```text
providerId A == providerId B
modelId    A == modelId B
```

so `updateSessionModel` (the only live-update primitive the
extension exposes today) cannot produce the desired effect.

### 6b. R1 primary assertion

```text
Given:
  active instance = A
  effective config = projected from A
  NEXT_EFFECTIVE_CONNECTION = {
    providerId           = "openai-compatible",
    modelId              = "same-model",
    baseUrl              = "https://a.invalid/v1",
    credentialIdentity   = "secret-A",
    headers              = { X-Instance: A },
  }

When:
  apply instance B

Then:
  NEXT_EFFECTIVE_CONNECTION = {
    providerId           = "openai-compatible",
    modelId              = "same-model",
    baseUrl              = "https://b.invalid/v1",
    credentialIdentity   = "secret-B",
    headers              = { X-Instance: B },
  }
```

Expected defect (per evidence 05 §11b and §11e):

```text
The extension never calls updateSessionConnection.
The ProviderConfig literal in buildSdkProviderConfig
drops headers.
Therefore, NEXT_EFFECTIVE_CONNECTION == A
after apply instance B.
```

### 6c. Conservation witness (also part of R1)

```text
Given:
  active instance = A
  effective config = projected from A

When:
  model A1 → A2  (same instance)

Then:
  NEXT_EFFECTIVE_CONNECTION.modelId = "A2"
  NEXT_EFFECTIVE_CONNECTION.providerId = "openai-compatible"
  NEXT_EFFECTIVE_CONNECTION.baseUrl = "https://a.invalid/v1"  (unchanged)
  NEXT_EFFECTIVE_CONNECTION.credentialIdentity = "secret-A"  (unchanged)
  NEXT_EFFECTIVE_CONNECTION.headers = { X-Instance: A }      (unchanged)

Expected behavior:
  updateSessionModel(A2) is called.
  No rebuild is triggered.
  The conservation path is preserved.
```

### 6d. R1 observation seam

The reviewer recommends observing the exact configuration
handed to the real handler/request construction seam:

```text
NEXT_EFFECTIVE_CONNECTION :=
  the value the SDK ApiHandler would use on its next
  createMessage call, projected from the live
  ApiConfiguration + ProviderSettings at that moment.
```

No network request to a real provider is necessary. R1 is a
witness test on `buildSdkProviderConfig` + the active session's
cached `ProviderConfig` (when the SDK exposes one). The test
asserts equality on the tuple in §6b.

### 6e. R1 in-flight safety (secondary)

Per evidence 03, an in-flight request must not be mutated
mid-stream. R1 must include:

```text
Given:
  active session isRunning = true
  an in-flight request is mid-stream

When:
  apply instance B

Then:
  NEXT_EFFECTIVE_CONNECTION remains A
  until the in-flight request completes
  then rebuilds with B
```

This is the same invariant the existing providerId-change
rebuild already enforces; R1 confirms it holds for the
instanceId-change rebuild too.

## 7. Out of scope (this foundation)

- Per-mode instance overrides (different plan vs. act instances).
- Cross-instance inheritance or grouping.
- Instance creation UI/UX (a separate ACT).
- Migration of existing single-instance users to the
  multi-instance schema (a separate migration ACT).
- Vault-backed credential kinds (reserved as future
  `credentialRef.kind`).
- Inline secret kinds (reserved as future, never default).
- Multi-credential instances (one instance, multiple
  credentials). Each instance owns exactly one credential
  identity in this foundation.
- **Active-instance binding authority** — per-session
  metadata, session-manifest pointer, global default,
  per-task persistence, profile-to-instance linking,
  resume-from-instance, "Set as default" UI, footer
  quick-switch SPLIT_ACTION semantics. These are
  implementation-ACT scope. The Foundation only provides
  the `applyProviderConfigurationInstance(from, to)`
  function; whoever owns the active-instance binding
  invokes it. See §2-pre Authority and the Model Profiles
  recon freeze
  (`.factory/evidence/ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-RECON01/12-corrected-freeze.md`)
  for the per-session / global-default split.

## 8. Pre-flight (this evidence file)

```text
SCOPE               = recon-only (FOUNDATION_RECON_PHASE §12 design
                                freeze; production edits FORBIDDEN)
ACT_HEAD_AT_AUTHOR  = 0a3d9c2a5  (unchanged; this is an evidence
                                    file; no source files were
                                    touched in this cycle)
PRODUCTION_HEAD     = e06af528522ae2aa471aac9eed30acb51e9fdf92
                      (unchanged; no production edits)
RANGE_HYGIENE       = n/a (no source files touched; only this
                            evidence file added)
TOUCHED_FILES       = .factory/evidence/
                      ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01/
                      06-design-freeze.md   (this file)
SUCCESSORS          = foundation ACT §13/§14/§15 R1 —
                        FOUNDATION_IMPLEMENTATION_PHASE
                        (gated on a genuine R1 RED reproducing the
                        §6b primary assertion; FOUNDATION_IMPLEMENTATION_PHASE
                        opens only after R1 RED is observed)
```

## 9. Freeze summary

```text
STORAGE_GEOMETRY              = γ (dedicated instances.json)
                                AUTHORITY = instances.json is the
                                canonical SAVED INSTANCE
                                DEFINITIONS store; legacy
                                ApiConfiguration + providers.json
                                are projected LIVE COMPATIBILITY/
                                CONFIGURATION state (mirrors
                                written by APPLY; see §2-pre and
                                §4d APPLY phase)

INSTANCE_DEFINITION_AUTHORITY = instances.json
ACTIVE_INSTANCE_BINDING       = CALLER/SESSION-SCOPED,
                                NOT OWNED BY FOUNDATION
                                (caller supplies both
                                 fromInstanceId and toInstanceId
                                 to applyProviderConfigurationInstance)
GLOBAL_ACTIVE_INSTANCE_ID     = FORBIDDEN
                                (would re-collapse the per-session
                                 authority the Model Profiles
                                 correction already closed at the
                                 profile layer; see §2-pre)

SEMANTIC_CREDENTIAL_IDENTITY  = Instance.credentialRef.name
                                (not providerId; not raw secret;
                                 not hash)

PHYSICAL_SECRET_ENCODING      = { kind: "secret", name: "<key>" }
                                (future kind reserved: "vault";
                                 "raw"/"inline" explicitly NOT
                                 reserved — see §4c)

APPLY_PHASE                   = READ-ONLY with respect to the
                                secrets store; resolves credential
                                by name only (see §4d)

DEFINE_UPDATE_PHASE           = separate user-initiated write path
                                (setInstanceSecret); never invoked
                                from APPLY; gated on explicit UI
                                save (see §4d)

RUNTIME_STRATEGY              = B (full session reconstruction on
                                instanceId change; existing
                                updateSessionModel fast path
                                preserved for same-instance model
                                switches)

R1_FIXTURE_PRIMARY            = providerId/modelId identical
                                instances A and B with diverging
                                baseUrl, credential, headers

R1_FIXTURE_CONSERVATION       = same instance, model A1 → A2
                                preserves updateSessionModel fast
                                path

R1_IN_FLIGHT_SAFETY           = rebuild deferred while isRunning = true

OUT_OF_SCOPE                  = per-mode overrides, instance UI,
                                user migration, raw/inline kind
                                (forever, by invariant), vault
                                kind (deferred), multi-credential
                                instances (single credential per
                                instance is the foundation scope),
                                ACTIVE-INSTANCE BINDING AUTHORITY
                                (per-session binding, global
                                default, profile-pointer wiring,
                                resume/new-session binding,
                                "Set as default" UI, footer
                                quick-switch SPLIT_ACTION — all
                                implementation-ACT scope per the
                                Model Profiles recon freeze
                                §RESUME_USES / §NEW_SESSION_USES /
                                §SESSION_PROFILE_APPLICATION)

CREDENTIAL_STORAGE_PRIMITIVE  = C (minimal instance-scoped secret
                                namespace; see evidence 06a);
                                reserved "instance:" prefix in
                                secrets.json; new typed accessor
                                pair (getInstanceSecret /
                                setInstanceSecret); new zod
                                schema InstanceSecretNameSchema

FOUNDATION_RECON_PHASE        = CLOSED (§12 frozen + bound;
                                active-instance binding authority
                                explicitly NOT OWNED by foundation;
                                foundation owns definition storage
                                only; §2-pre Authority freezes the
                                GLOBAL_ACTIVE_INSTANCE_ID = FORBIDDEN
                                invariant to prevent re-collapsing
                                the per-session authority the Model
                                Profiles correction closed)
FOUNDATION_IMPLEMENTATION_PHASE = NOT OPEN (gated on R1 RED)
R1                            = may proceed; produces evidence
                                file 07-r1-red-witness.md
                                against a real handler/request
                                construction seam
MODEL_PROFILES_IMPLEMENTATION = NOT AUTHORIZED
```
