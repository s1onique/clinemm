# Evidence 06a — Credential Storage Capability Discriminator

> Bounded evidence file. Answers the five yes/no/source-bound questions raised by the §12 design freeze review (HALT_PROVIDER_INSTANCE_CREDENTIAL_STORE_NOT_BOUND), from the ClineMM source of truth at ACT_HEAD_AT_AUTHOR. Also folds in the active-instance binding authority correction raised by the seventh reviewer's HALT_GLOBAL_ACTIVE_INSTANCE_REINTRODUCES_SESSION_AUTHORITY_COLLAPSE.
>
> This file does not rewrite `06-design-freeze.md`. It supplies the discriminator the §12 freeze skipped and binds the runtime/storage decision the reviewer demanded before the foundation implementation phase can open.

---

## §0. Inputs and provenance

| Item | Value |
|------|-------|
| ACT | `ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01` |
| Reviewer verdict being executed | `HALT_PROVIDER_INSTANCE_CREDENTIAL_STORE_NOT_BOUND` (sixth reviewer verdict on §12 freeze, commit `80723fb9f`) |
| Required outputs | 5 source-bound answers (1–5 below); permitted outcome (A / B / C); corresponding §4 amendments |
| Files added | this file (`.factory/evidence/.../06a-credential-storage-capability.md`) |
| Files amended | `.factory/evidence/.../06-design-freeze.md` (3 surgical P1 edits + 1 P2 trailing-newline strip — listed in §11) |
| Files NOT touched | any source / test / config file (re-verified by `git diff --stat` after this commit, see §11) |
| ACT_HEAD_AT_AUTHOR | `0a3d9c2a5` (unchanged — this is a §12 follow-up; recon-only) |
| PRODUCTION_HEAD | `e06af528522ae2aa471aac9eed30acb51e9fdf92` (unchanged) |
| BOARD_HEAD | ninety-first-pass (`80723fb9f`) → ninety-second-pass will be committed atomically with this evidence |
| Range hygiene | n/a — no production source touched |

---

## §1. Question 1 — Can `StateManager.setSecret` accept arbitrary keys?

### Answer: **NO**

### Source binding

`apps/vscode/src/core/storage/StateManager.ts:277`:

```ts
setSecret<K extends keyof Secrets>(key: K, value: Secrets[K]): void {
```

`apps/vscode/src/shared/storage/state-keys.ts:442-444`:

```ts
export type Secrets = { [K in (typeof SecretKeys)[number]]: string | undefined }
export type SecretKey = (typeof SecretKeys)[number]
```

`apps/vscode/src/shared/storage/state-keys.ts:362-410` (the closed vocabulary — 46 string literals):

```ts
const SECRETS_KEYS = [
    "apiKey",
    "clineApiKey",
    "clineAccountId",
    "cline:clineAccountId",
    "openRouterApiKey",
    "awsAccessKey",
    "awsSecretKey",
    "awsSessionToken",
    "awsBedrockApiKey",
    "openAiApiKey",
    "geminiApiKey",
    "openAiNativeApiKey",
    "ollamaApiKey",
    "deepSeekApiKey",
    "requestyApiKey",
    "togetherApiKey",
    "fireworksApiKey",
    "qwenApiKey",
    "doubaoApiKey",
    "mistralApiKey",
    "liteLlmApiKey",
    "authNonce",
    "asksageApiKey",
    "xaiApiKey",
    "moonshotApiKey",
    "zaiApiKey",
    "huggingFaceApiKey",
    "nebiusApiKey",
    "sambanovaApiKey",
    "cerebrasApiKey",
    "sapAiCoreClientId",
    "sapAiCoreClientSecret",
    "groqApiKey",
    "huaweiCloudMaasApiKey",
    "basetenApiKey",
    "vercelAiGatewayApiKey",
    "difyApiKey",
    "minimaxApiKey",
    "hicapApiKey",
    "aihubmixApiKey",
    "nousResearchApiKey",
    "remoteLiteLlmApiKey",
    "ocaApiKey",
    "ocaRefreshToken",
    "mcpOAuthSecrets",
    "openai-codex-oauth-credentials",
    "wandbApiKey",
] as const
```

### Why this matters

`Secrets` is a **mapped type** keyed by `SecretKey`. The `as const` on `SECRETS_KEYS` produces a tuple-of-string-literals; `SecretKey` is the union of those literals. `setSecret<K extends keyof Secrets>` is then **type-locked** to that union at compile time. TypeScript will reject any call with an unknown string at the type level; at runtime the closed union is enforced by `SecretKeys` (exported as the array `Array.from(SECRETS_KEYS)` at line 459) — there is no fallback path that writes to `secrets.json` outside this vocabulary.

A caller cannot store `secrets["corp-llm-key"]` with an arbitrary `name`. Only the 46 keys above (or future additions to `SECRETS_KEYS`) can be written through this API.

---

## §2. Question 2 — Is `SecretKey` an open string or a closed schema/union?

### Answer: **CLOSED** union of 46 string literals, with a fixed per-`providerId` mapping

### Source binding

Two layers of closure:

1. **Type level** — `SecretKey = (typeof SecretKeys)[number]` is a discriminated union. Adding a new key requires editing `SECRETS_KEYS` and running the `scripts/generate-state-proto.mjs` codegen step (see header comment at `state-keys.ts:24-31`).
2. **Write-time level** — `apps/vscode/src/sdk/model-catalog/store.ts:44-117` (`providerConfigStateKeys`) maps each `ProviderSettingsPatchKey` (`apiKey`, `baseUrl`, `apiLine`, `headers`, `region`, `auth`, `extras`, `aws`, `gcp`) to a fixed per-`providerId` `SecretKey | SettingsKey`. The `apiKey` mapping alone enumerates 33 providers; the `baseUrl` mapping enumerates 12; etc. There is no `providerId → SecretKey` table for providerIds not in this map.

Concretely: `apps/vscode/src/sdk/model-catalog/store.ts:483-492` is the only write gate:

```ts
function writeStateKey(key: SecretKey | SettingsKey, value: unknown): void {
    const stateManager = StateManager.get()
    if (isSecretKey(key)) {
        stateManager.setSecret(key, typeof value === "string" ? value : undefined)
        return
    }
    if (isSettingsKey(key)) {
        stateManager.setGlobalState(key, value as never)
    }
}
```

A user-defined credential key like `"corp-llm-key"` cannot reach this gate: it is neither in `SECRETS_KEYS` nor mapped from any `providerId` in `providerConfigStateKeys`.

---

## §3. Question 3 — Can `ProviderSettingsManager` persist two credentials simultaneously for the same `providerId`?

### Answer: **NO** (the dictionary key IS the `provider` field)

### Source binding

`sdk/packages/core/src/types/provider-settings.ts:36-67`:

```ts
export interface StoredProviderSettingsEntry {
    settings: ProviderSettings;
    updatedAt: string;
    tokenSource: ProviderTokenSource;
}

export interface StoredProviderSettings {
    version: 1;
    lastUsedProvider?: string;
    modes: StoredProviderModes;
    providers: Record<string, StoredProviderSettingsEntry>;
}
```

The dictionary type `Record<string, StoredProviderSettingsEntry>` is **open** at the schema level — `z.record(z.string(), ...)` permits any string key. **But** the only API that writes into `providers` is `saveProviderSettings` at `sdk/packages/core/src/services/storage/provider-settings-manager.ts:150-187`, which uses `validatedSettings.provider` (the `provider` field inside the entry itself, NOT a caller-supplied key) as the dictionary index:

```ts
saveProviderSettings(
    settings: unknown,
    options: SaveProviderSettingsOptions = {},
): StoredProviderSettings {
    const validatedSettings = ProviderSettingsSchema.parse(settings)
    const previous = this.read()
    const providerId = validatedSettings.provider
    // ...
    providers: {
        ...previous.providers,
        [providerId]: { ... },
    },
    // ...
}
```

Two entries with `provider === "openai"` collide on the same key — the second write **silently overwrites** the first. There is no API that lets a caller store two records with the same `settings.provider` under different keys.

The legacy migration at `sdk/packages/core/src/services/storage/provider-settings-legacy-migration.ts:916-920` makes this collision explicit:

```ts
for (const legacyProviderId of candidates) {
    const providerId = resolveMigratedProviderId(legacyProviderId)
    if (next.providers[providerId]) {
        continue   // <-- skip; existing entry wins, no second slot
    }
    // ...
}
```

The legacy migrator deliberately refuses to introduce a colliding entry — confirming that the `providerId` is treated as a singleton key across the entire `providers.json` lifecycle.

`getProviderSettings(providerId)` at line 214 returns a single record per `providerId`. There is no `getProviderSettings(instanceId)` API anywhere.

---

## §4. Question 4 — Is there an existing opaque credential-reference store keyed independently of `providerId`?

### Answer: **NO**

### Source binding

I searched all credential-bearing primitives in the current source tree:

| Primitive | Location | Key namespace | Keyed by `providerId`? | Multiple instances per `providerId`? |
|-----------|----------|---------------|-------------------------|---------------------------------------|
| `StateManager.setSecret` | `apps/vscode/src/core/storage/StateManager.ts:277` | Closed union `SecretKey` (46 literals) | Implicitly (one key per providerId in the `providerConfigStateKeys` table) | No |
| `providerConfigStateKeys` | `apps/vscode/src/sdk/model-catalog/store.ts:44-117` | Per-`providerId` enum → `SecretKey` | Yes (forced) | No |
| `ProviderSettingsManager.saveProviderSettings` | `sdk/packages/core/src/services/storage/provider-settings-manager.ts:150-187` | `Record<string, Entry>` keyed by `settings.provider` | Yes (forced) | No (collision on duplicate) |
| `legacy-state-reader.ts` `readSecrets` | `apps/vscode/src/sdk/legacy-state-reader.ts:139-141` | Direct read of `secrets.json` | No (passes raw key through) | Theoretically yes, BUT only writes go through the closed union (§1, §2), so reading any key not in `SECRETS_KEYS` reads `undefined` from a freshly written store |
| `mcps/mcpOAuthSecrets` | one entry in `SECRETS_KEYS` | singleton | No (MCP-specific) | No |
| `openai-codex-oauth-credentials` | one entry in `SECRETS_KEYS` | singleton JSON blob | No (openai-codex-specific) | No |

The reader at `legacy-state-reader.ts:139-141` can technically read any key:

```ts
const secrets = readSecrets(dataDir)
return secrets[key]
```

But it has no corresponding write path — `setSecret` is the only writer, and it is type-locked to the closed union. So the *namespace of valid stored credentials* is exactly `SECRETS_KEYS ∪ SettingsKeys`.

There is **no** opaque `credentialRef.name → secretValue` mapping in production source today. There is **no** `instanceId → credential` mapping. There is **no** per-instance credential namespace anywhere in the SDK or extension adapter layer.

The read path at `apps/vscode/src/sdk/model-catalog/effective-config.ts:26-64` (`apiKeyFields`) confirms this: it uses the **same closed union**, just routed through legacy `ApiConfiguration` keys (`openAiApiKey`, `qwenApiKey`, `minimaxApiKey`, etc.). There is no generic per-instance credential read API.

---

## §5. Question 5 — What is the smallest existing persistence primitive that can hold `instance A → credential A` and `instance B → credential B` without raw-secret duplication?

### Answer: **NONE EXISTS TODAY.** A new persistence primitive is required.

### Source-bound proof

For a primitive to satisfy Question 5 it must:

1. Accept a key namespace that is **independent of `providerId`** (so two instances with the same `providerId` can coexist).
2. Support **arbitrary user-defined keys** (so `credentialRef.name` can be `"corp-llm-key"` or `"personal-claude"`).
3. **Not store raw secrets** in any file outside the existing 0o600 secrets store (so the existing `PROFILE_CONTAINS_RAW_SECRET = NO` invariant is preserved).
4. Be **type-safe and schema-validated** (consistent with the existing `StoredProviderSettings` zod discipline).

Walking the candidates:

| Candidate | Independent of `providerId`? | Arbitrary user keys? | Secrets-only? | Schema-validated? | Verdict |
|-----------|------------------------------|----------------------|---------------|-------------------|---------|
| `StateManager.setSecret` (§1, §2) | No (forced mapping) | No (closed union) | Yes | Yes | **FAILS** on all three |
| `providerConfigStateKeys` table | No (per-providerId map) | No | Yes | Yes | **FAILS** |
| `ProviderSettingsManager.saveProviderSettings` (§3) | No (key = settings.provider) | Technically yes (open schema), but API forces singleton | No — stores secrets in `providers.json` itself, mode 0o600, BUT collides on duplicate `provider` | Yes | **FAILS** on (1) and (4) — collision defeats identity |
| `instances.json` (proposed in §12) | Yes (keyed by `instanceId`) | Yes (free-form instance records) | Designed for credentials-by-reference (no raw secret) | Will need zod schema | **POTENTIALLY VIABLE** — but the credential *reference* it stores needs to resolve to a real, secret-store-backed value |
| `legacy-state-reader.ts` raw read | Yes | Yes (raw key) | Yes | No | **FAILS** — no write counterpart |

There is **no existing primitive** that simultaneously satisfies (1) and (2) and (3). Therefore a new credential-storage primitive is required. This is **Outcome C** from the reviewer's permitted outcomes.

---

## §6. Reviewer permitted outcomes

Per the reviewer verdict:

> A. Existing arbitrary secret namespace exists → keep `credentialRef.name` design.
> B. ProviderSettings can support provider-instance records with independent credential-bearing records → bind credential reference there.
> C. No suitable existing primitive → introduce a MINIMAL instance-scoped secret namespace as foundation production scope.

### Selected outcome: **C — MINIMAL instance-scoped secret namespace**

### Why not A

`setSecret` rejects arbitrary keys (§1). The 46-key closed union (§2) cannot be extended without modifying `SECRETS_KEYS`, regenerating protos, and migrating existing users — every addition is a schema-level event. Two same-providerId instances cannot land at distinct positions in this namespace without an explosion of new keys. A is structurally impossible.

### Why not B

`ProviderSettingsManager.saveProviderSettings` uses `settings.provider` as the dictionary key (§3). The file schema permits arbitrary keys, but the API forces singleton-per-providerId. Restructuring the manager to use `instanceId` instead of `settings.provider` is a wider blast radius than the foundation needs (it would touch every existing `saveProviderSettings` caller, OAuth refresh, the legacy migrator, and the local-provider-registry). The Foundation's job is the smallest correct primitive that satisfies the product invariant "two same-providerId instances can coexist." B overreaches.

### Why C

C is the smallest possible addition:

- A new file-backed store keyed by `instanceId` (or by `credentialRef.name`, see §7), with the existing `secrets.json` remaining the actual secret-bearing backing store.
- A new typed key namespace (separate from `SECRETS_KEYS`) for instance credentials — the natural shape is the `CredentialRef` discriminated union from `06-design-freeze.md` §4.
- The existing `PROFILE_CONTAINS_RAW_SECRET = NO` invariant is preserved by construction: only references are persisted, not values.
- The 0o600 file permission discipline is preserved by reusing the `ClineFileStorage` primitive (already used for `secrets.json`).

Importantly: C does not require rewriting §12's `storage geometry γ` or `semantic credential identity`. The `Instance.credentialRef` is still the source of truth; what changes is that the *resolver* for `credentialRef.kind = "secret"` is a new minimal namespace rather than the existing `SECRETS_KEYS` union.

---

## §7. Minimal shape of the new credential primitive (foundation scope)

### File layout

```text
~/.cline/data/
  globalState.json
  secrets.json                              # 0o600 (existing; this is where secret VALUES live)
  settings/
    providers.json                          # existing; one record per providerId
    instances.json                          # NEW (proposed §12 γ file)
  workspaces/<hash>/
    workspaceState.json
```

### `instances.json` shape (per §12 γ + this discriminator)

```text
// NOTE: NO activeInstanceId field. instances.json is
// definition storage ONLY. Active-instance binding is the
// caller's responsibility (see 06-design-freeze.md §2-pre
// Authority).
{
  "version": 1,
  "instances": {
    "anthropic-prod": {
      "instanceId":   "anthropic-prod",
      "providerId":   "anthropic",
      "modelId":      "claude-sonnet-4-6",
      "label":        "Work Anthropic",
      "credentialRef": { "kind": "secret", "name": "anthropic-prod-key" }
    },
    "anthropic-personal": {
      "instanceId":   "anthropic-personal",
      "providerId":   "anthropic",
      "modelId":      "claude-sonnet-4-6",
      "label":        "Personal Anthropic",
      "credentialRef": { "kind": "secret", "name": "anthropic-personal-key" }
    }
  }
}
```

### Instance-secret namespace (NEW; this is what §1, §2, §4 proved we need)

The two keys `anthropic-prod-key` and `anthropic-personal-key` **cannot** live in `SECRETS_KEYS`. They are instance-scoped, arbitrary, and user-defined.

The minimal correct primitive:

- A new zod schema `InstanceSecretNameSchema = z.string().min(1).regex(/^instance:.+$/)` (or similar) that reserves a key prefix in `secrets.json` exclusively for instance credentials.
- A new typed accessor on `StateManager`: `getInstanceSecret(name: InstanceSecretName): string | undefined` and `setInstanceSecret(name, value): void` — distinct from `getSecretKey` / `setSecret` so type-system enforcement is preserved.
- The keys **still land in `secrets.json`** (mode 0o600, debounced writes, atomic rename — all existing primitives reused). Only the typed accessor is new.

This is the smallest viable C. It does **not** touch `SECRETS_KEYS`, does **not** touch `ProviderSettingsManager`, does **not** touch `ProviderSettings`, and does **not** introduce a new secrets-bearing file.

### Read path (APPLY phase — read-only)

```text
// fromInstanceId and toInstanceId are BOTH supplied by the
// caller. Foundation does NOT consult or maintain a global
// "current active" pointer (see 06-design-freeze.md §2-pre
// Authority). Whoever owns the active-instance binding
// (per-session, global default, profile pointer, R1 harness)
// invokes this with both ids.
applyProviderConfigurationInstance(fromInstanceId, toInstanceId):
  // 1. Idempotency: caller asked for the same instance it
  //    already has active = no-op.
  if (toInstanceId === fromInstanceId) return

  // 2. Resolve instance record from instances.json.
  inst = loadInstance(toInstanceId)

  // 3. Resolve credential VALUE from secrets.json (READ-ONLY).
  secretValue = stateManager.getInstanceSecret(inst.credentialRef.name)
  if (!secretValue) {
    throw new Error(
      `instance credential not found: name=${inst.credentialRef.name}`
    )
  }

  // 4. Project to legacy ApiConfiguration + ProviderSettings
  //    (single function).
  patch = projectInstanceToLiveConfig(inst, secretValue)
  applyApiConfigurationPatch(patch.apiConfigPatch, targetMode)
  if (patch.providerSettingsPatch) applyProviderSettingsPatch(...)

  // 5. Rebuild active session (gated on isRunning === false).
  //    NOTE: NO setActiveInstanceId here. The caller owns the
  //    active-instance binding; the Foundation does not
  //    consult or maintain any global pointer.
  rebuildActiveSession({
    reason: "instance-switch",
    fromInstanceId,
    toInstanceId,
  })
```

### DEFINE/UPDATE phase (separate code path — explicit, out of APPLY)

```text
// Creation/editing concern; not part of quick-switch APPLY.
// Triggered by user saving an instance configuration in the UI (future §17).
defineOrUpdateInstanceCredential(credentialRef, secretValue):
  stateManager.setInstanceSecret(credentialRef.name, secretValue)
  // Persists to secrets.json under the reserved prefix.
```

The two operations are now **distinct**, satisfying the reviewer's discrimination:

> DEFINE/UPDATE INSTANCE CREDENTIAL = creation/editing concern; out of current apply path
> APPLY EXISTING INSTANCE = resolve credential reference read-only → project resolved credential into live runtime/provider config

This corrects the §4d tautology called out by the reviewer: the original `secretWrite` block resolved `secretValue` from the same secret it then compared to — i.e., identity by construction. With the new primitive:

- APPLY path is read-only (`getInstanceSecret`).
- DEFINE/UPDATE path is a separate, user-initiated operation (`setInstanceSecret`).
- No more identity tautology; the two phases never overlap.

---

## §8. Why this still preserves the §12 freeze

| §12 decision | Status after this discriminator |
|--------------|---------------------------------|
| Storage geometry γ | **unchanged** — `instances.json` remains the canonical saved-instance metadata |
| Semantic credential identity = `credentialRef.name` | **unchanged** |
| Physical secret-reference encoding = `{ kind: "secret", name: "<key>" }` | **unchanged at the schema level** — the change is that `name` is now an `InstanceSecretName` (prefixed), not a `SecretKey` |
| Runtime strategy B | **unchanged** — full session reconstruction on `instanceId` change |
| R1 fixture (same providerId+modelId, diverging baseUrl/credential/headers) | **unchanged** — now even stronger: two `anthropic` instances with two completely independent secret names is the canonical case |

The discriminator adds a single typed accessor pair (`getInstanceSecret` / `setInstanceSecret`) and a single zod schema (`InstanceSecretNameSchema`). That is the minimum implementation footprint for Outcome C.

---

## §9. P1 corrections to `06-design-freeze.md` (this commit, in addition to 06a)

The reviewer flagged three P1 issues in §12 that this commit surgically corrects:

### P1.1 — Remove reserved `"inline"` credential kind

**Issue (reviewer):** the frozen `"inline"` reservation directly contradicts the frozen `PROFILE_CONTAINS_RAW_SECRET = NO` invariant. Extensibility does not require reserving insecure semantics now.

**Correction:** delete the `"inline"` bullet from §4c Reserved Kinds and from §9 Freeze Summary's `OUT_OF_SCOPE` line. Keep only `"vault"` (which is genuinely orthogonal — it does not imply storing secrets in `instances.json`).

**Files:** `06-design-freeze.md` §4c, §9 — two surgical edits.

### P1.2 — Replace tautological `secretWrite` algorithm with APPLY/DEFINE separation

**Issue (reviewer):** `secretWrite` resolves `secretValue` from the same secret entry it then compares to — `currentValue == secretValue` by construction. The block is not actually a mechanism for introducing or changing a credential.

**Correction:** rewrite §4d's pseudocode to express:

- APPLY = read-only (`getInstanceSecret(name)`), no writes
- DEFINE/UPDATE = a separate, user-initiated code path (`setInstanceSecret(name, value)`), not invoked from APPLY

Also remove the `secretWrite` field from the `projectInstanceToLiveConfig` return type in §2e (it no longer applies; APPLY is read-only by construction).

**Files:** `06-design-freeze.md` §2e, §4d — two surgical edits.

### P1.3 — Phrase storage-γ authority precisely

**Issue (reviewer):** "instances.json = source of truth" overstates authority; legacy `ApiConfiguration` and `providers.json` are kept as live mirrors. The reviewer's preferred wording:

> `instances.json` = canonical **saved provider-instance definitions**
> `ApiConfiguration` + `providers.json` = projected **live compatibility/configuration state**

**Correction:** add this two-line clarification at the head of `06-design-freeze.md` §2 and in §9's `STORAGE_GEOMETRY` line.

**Files:** `06-design-freeze.md` §2, §9 — two surgical edits.

### P2 (hygiene)

**Issue:** `git diff --check` reports one trailing blank line at `06-design-freeze.md:822`. Trivial to fix; batching here since this commit already touches that file.

**Correction:** remove the trailing blank line.

**Files:** `06-design-freeze.md` end-of-file — one character edit.

---

## §10. Outcome

```
OUTCOME = C

NEW_PRIMITIVE = MINIMAL instance-scoped secret namespace
                keyed by credentialRef.name
                persisted into the existing secrets.json
                gated by a new typed accessor pair
                (getInstanceSecret / setInstanceSecret)
                with a new zod schema InstanceSecretNameSchema
                that reserves the "instance:" key prefix

PRESERVED_INVARIANTS =
  PROFILE_CONTAINS_RAW_SECRET = NO          (unchanged; references only)
  secrets.json mode 0o600                    (unchanged)
  PRODUCTION_HEAD                            (unchanged: e06af528...)
  ACT_HEAD_AT_AUTHOR                         (unchanged: 0a3d9c2a5)
  RUNTIME_STRATEGY_B                         (unchanged)
  STORAGE_GEOMETRY_γ                         (definitions-only; active
                                             binding explicitly NOT
                                             owned by foundation —
                                             see GLOBAL_ACTIVE_INSTANCE_ID
                                             = FORBIDDEN below)
  SEMANTIC_CREDENTIAL_IDENTITY               (unchanged: credentialRef.name)
  R1_GEOMETRY                                (unchanged; now even cleaner)
  MODEL_PROFILES_PER_SESSION_BINDING         (preserved; foundation does
                                             not introduce a parallel
                                             global pointer at the
                                             instance layer)

INSTANCE_DEFINITION_AUTHORITY  = instances.json
ACTIVE_INSTANCE_BINDING        = CALLER/SESSION-SCOPED,
                                 NOT OWNED BY FOUNDATION
                                 (caller supplies both
                                  fromInstanceId and toInstanceId
                                  to applyProviderConfigurationInstance)
GLOBAL_ACTIVE_INSTANCE_ID      = FORBIDDEN
                                 (would re-collapse per-session
                                  authority the Model Profiles
                                  correction closed at the profile
                                  layer; see .factory/evidence/
                                  ACT-CLINEMM-MODEL-PROFILES-
                                  QUICK-SWITCH-RECON01/
                                  12-corrected-freeze.md
                                  §RESUME_USES / §NEW_SESSION_USES /
                                  §SESSION_PROFILE_APPLICATION
                                  = SPLIT_ACTION)

FOUNDATION_RECON_PHASE          = CLOSED (§12 frozen + bound;
                                       active-binding fix folded in)
FOUNDATION_IMPLEMENTATION_PHASE = NOT OPEN (gated on R1 RED)
R1                              = may proceed; produces evidence
                                  file 07-r1-red-witness.md
                                  against a real handler/request
                                  construction seam
MODEL_PROFILES_IMPLEMENTATION   = NOT AUTHORIZED
```

---

## §11. Disposition

| Item | Value |
|------|-------|
| Files added | `06a-credential-storage-capability.md` (this file) |
| Files amended | `06-design-freeze.md` (active-instance binding authority correction + 3 P1 surgical edits + 1 P2 strip; total diff ~210 insertions / ~55 deletions; each edit localized to one subsection, no rewrites of §5 / §6 / §8) |
| Files NOT touched | any source / test / config file |
| `git status --short` after this commit | (re-verified at commit time) |
| `git diff --stat` after this commit | (re-verified at commit time) |
| New P0 from this commit | NONE (the global-active-instance correction is the closing of a P0 the prior cycle reopened; not a new P0) |
| New P1 from this commit | NONE (the three P1s from the prior cycle and the active-binding correction are all closure of existing P0/P1) |
| Pre-execution review triggered? | NO — per reviewer: "Only a new P0 from §12 source evidence or the genuine R1 result should interrupt execution." |
| Halt condition? | NONE — the credential-storage discriminator is bound, the active-binding authority is now precise, the §4 amendments are localized. |
| Next step | R1 RED on the §6b primary fixture (A vs B with same providerId+modelId, diverging baseUrl/credential/headers). Per the reviewer, the R1 harness passes the desired instance B **explicitly** to the switch operation; no persisted active pointer is necessary. |

If R1 RED reproduces → `FOUNDATION_IMPLEMENTATION_PHASE = OPEN` with the minimal C primitive as the bounded GREEN scope.

If R1 RED does NOT reproduce → the §6b primary fixture expectation was wrong, reopen that one assertion (it does not require pre-execution review).
