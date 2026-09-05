# 01 — Current connection authority (recon stream 1a)

Recon date: foundation ACT entry (pre-R0).
Scope: where the provider configuration becomes the next LLM request, in the
VSCode SDK adapter (post-2026 SDK migration). Per ACT body §7.

This is a source survey. No production edits. No freeze here; the freeze is R0
in evidence file `04-r0-current-seam-witness.md`.

---

## 1. The canonical handler-construction seam

**Single inference path:** `apps/vscode/src/sdk/sdk-api-handler.ts`.

The file's own preamble states:

> "This is the single inference path: the main task loop runs through ClineCore
> (see cline-session-factory.ts), and standalone utility callers (commit message
> generation) use the handler returned here. Both share the same provider/model/
> key/baseUrl resolution so there is no second source of truth."

`buildSdkProviderConfig(configuration, mode, options)` is the single function
that converts a legacy `ApiConfiguration` into an SDK `ProviderConfig`. It:

1. Reads `providerId` from `mode === "plan" ? planModeApiProvider : actModeApiProvider`
   (`sdk-api-handler.ts:64`).
2. Resolves `apiKey` via `resolveApiKey(providerId, configuration)`
   (`sdk-api-handler.ts:66`).
3. Resolves `modelId` via `resolveModelId(providerId, mode, configuration)`
   (`sdk-api-handler.ts:67`).
4. Resolves `baseUrl` via `resolveBaseUrl(providerId, configuration)`
   (`sdk-api-handler.ts:68`).
5. Composes `ProviderConfig` with `providerId` (via `toSdkProviderId`),
   `modelId`, `apiKey`, `baseUrl`, `reasoningEffort`, optional Bedrock/Vertex
   provider configs, plus the proxy-aware `fetch` from `@/shared/net`.

---

## 2. The credential-resolution seams (where the apiKey value comes from)

`apps/vscode/src/sdk/cline-session-factory.ts`:

- **`resolveApiKey(providerId, config)`** (`cline-session-factory.ts:490`)
  - If `providerId` has an auth handler: read the field named in
    `PROVIDER_API_KEY_MAP[providerId]` from the legacy `ApiConfiguration`,
    trim, return; if absent, fall back to `providers.json` via
    `getProviderSettingsManager().resolveProviderApiKeyFromSettings(...)`.
  - Else: read `PROVIDER_API_KEY_MAP[providerId]` field; if absent, same
    `providers.json` fallback.

- **`PROVIDER_API_KEY_MAP`** (`cline-session-factory.ts:369-410`):
  ```text
  anthropic   -> apiKey
  openrouter  -> openRouterApiKey
  openai      -> openAiApiKey
  "openai-native" -> openAiNativeApiKey
  bedrock     -> awsBedrockApiKey
  vertex      -> geminiApiKey
  gemini      -> geminiApiKey
  deepseek    -> deepSeekApiKey
  cline       -> clineApiKey
  "cline-pass" -> clineApiKey
  ollama      -> ollamaApiKey
  lmstudio    -> apiKey
  requesty    -> requestyApiKey
  together    -> togetherApiKey
  fireworks   -> fireworksApiKey
  qwen        -> qwenApiKey
  doubao      -> doubaoApiKey
  mistral     -> mistralApiKey
  litellm     -> liteLlmApiKey
  asksage     -> asksageApiKey
  xai         -> xaiApiKey
  moonshot    -> moonshotApiKey
  zai         -> zaiApiKey
  huggingface -> huggingFaceApiKey
  nebius      -> nebiusApiKey
  sambanova   -> sambanovaApiKey
  cerebras    -> cerebrasApiKey
  groq        -> groqApiKey
  baseten     -> basetenApiKey
  "huawei-cloud-maas" -> huaweiCloudMaasApiKey
  dify        -> difyApiKey
  minimax    -> minimaxApiKey
  hicap       -> hicapApiKey
  aihubmix    -> aihubmixApiKey
  nousresearch -> nousResearchApiKey
  "vercel-ai-gateway" -> vercelAiGatewayApiKey
  wandb       -> wandbApiKey
  "qwen-code" -> qwenApiKey
  oca         -> ocaApiKey
  claude_code -> apiKey (uses anthropic key)
  ```

  **Observation:** For each legacy `providerId`, there is exactly ONE
  `keyof ApiConfiguration` field that holds its API key. There is no
  providerId-keyed slot that can hold TWO different keys for the same
  providerId. Two configurations of the same providerId (e.g. two OpenAI
  Compatible setups) cannot coexist today without one of them losing
  credential identity at any given mode. This corroborates MP RECON P3's
  `SAME_PROVIDER_MULTI_CREDENTIAL_IDENTITY_NOT_BOUND` finding.

- **`resolveBaseUrl(providerId, config)`** (`cline-session-factory.ts:676`):
  - Hard-coded `baseUrlMap` for select providers (anthropic, openai,
    openai-compatible, ollama, lmstudio, gemini, requesty, litellm, asksage,
    oca, aihubmix, dify). Each providerId maps to exactly ONE
    `keyof ApiConfiguration` field. Same problem as `apiKey`:
    same-providerId second row collapses at the storage level.

- **Storage authority** (per `apps/vscode/src/extension.ts:744`):
  > "NOTE: Credentials now live in providers.json (single source of truth)."

  The actual secret store is `providers.json`, not `secrets.json`. Per
  `apps/vscode/src/sdk/model-catalog/store.ts`:
  - `providerConfigStateKeys.apiKey` (lines 41-79) maps each providerId to
    a SecretKey or SettingsKey in legacy global state; this is the legacy
    mirror that `resolveApiKey` consults first before `providers.json`.
  - `getProviderSettingsManager()` (from `../provider-migration`) is the
    bridge to the SDK's `ProviderSettingsManager` reading `providers.json`.

---

## 3. The model-binding seam

`resolveModelId(providerId, mode, config)` (`cline-session-factory.ts:546`)
selects `config[PROVIDER_MODEL_ID_MAP[providerId][mode]]` for providers that
have dedicated mode-specific model fields; falls back to legacy
`planModeApiModelId` / `actModeApiModelId` for the rest. There is no
per-row model selection; the active model is whatever the (single)
mode-specific field points at.

---

## 4. Identity dimension inventory (today)

```text
Existing identity dimensions in the seam:
  providerId                    (single per ApiConfiguration; e.g. "openai")
  mode                          (plan | act; not a provider dimension)
  modelId                       (mode-specific; chosen at task construction)
  baseUrl                       (single field per providerId)
  apiKey / credential value     (single field per providerId; mirror in
                                  providers.json as single source of truth)

MISSING identity dimension:
  ProviderConfigurationInstanceId (NOT present anywhere in sdk-api-handler.ts,
                                    cline-session-factory.ts,
                                    model-catalog/store.ts, or
                                    model-catalog/contracts.ts)
```

**Confirmation:** `model-catalog/contracts.ts` (485 lines, the canonical
type contract for the provider configuration store) defines:

- `ProviderId` (branded string; produced only by `parseProviderId`)
- `KnownProviderId` (sub-brand of ProviderId; recognized ApiProvider)
- `EffectiveProviderConfig.providerId: ProviderId` — the only identity field
  on an effective config
- `ProviderConfigStore.read(providerId: ProviderId): EffectiveProviderConfig`

There is no `InstanceId`, no `ConfigurationId`, no second identity dimension.
The store's contract is explicitly single-keyed by `providerId`.

---

## 5. Where the request actually flows

Reading `sdk-api-handler.ts:64-90` together with
`cline-session-factory.ts:490-720`:

```text
Task construction
   |
   v
buildSdkProviderConfig(configuration, mode, options)
   |
   +-- resolveApiKey(providerId, configuration)
   |     -> PROVIDER_API_KEY_MAP[providerId] field in legacy ApiConfiguration
   |     -> fallback: providers.json via ProviderSettingsManager
   |
   +-- resolveModelId(providerId, mode, configuration)
   |     -> PROVIDER_MODEL_ID_MAP[providerId][mode] field
   |
   +-- resolveBaseUrl(providerId, configuration)
   |     -> baseUrlMap[providerId] field
   |
   v
createHandler({ providerId, modelId, apiKey, baseUrl, fetch, ... })
   |
   v
@cline/llms handler owns the request from here onward
```

The "switch to a different model" action today is: write a new `modelId`
into `planModeApiModelId` or `actModeApiModelId`. The next handler
construction picks up the new modelId. No rebuild is triggered today on
plain modelId change (per upstream commit c31f33e the rebuild fires on
provider identity change, NOT modelId change — see evidence file
`03-rebuild-discriminator.md`).

The "switch to a different same-providerId instance" action today is:
**undefined**. There is no user-facing action that means this. There is no
production data path that means this either — see evidence file
`04-r0-current-seam-witness.md` for the witness measurement.

---

## 6. What the survey does NOT establish

This survey establishes connection authority — who reads the config and
hands it to the request path. It does NOT establish:

- Whether the runtime can be coerced into switching credentials within a
  single providerId (R0 measures this).
- Whether the rebuild path can be coerced into firing on a same-providerId
  config change (R0 measures this).
- The durable storage location for instance definitions (intentionally
  deferred to step 7 of the epistemic sequence; per ACT body §4 OWNS list
  this ACT does NOT bind durable storage).
