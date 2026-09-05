# 05 — R0 remaining-operand trace

Foundation ACT: FOUNDATION_RECON_PHASE step (a). Recon-only ACT.
Recon date: 2026-09-05 (ninetieth-pass acknowledgment cycle).

R0 in `04-r0-current-seam-witness.md` (v2) leaves four NOT_PROVEN
operands: headers, providerSpecificConfig, apiLine/routing, region.
This file traces each to YES/NO/N/A. No NOT_PROVEN survives.
Three independent identity dimensions are kept distinct: providerId
(model-catalog key), routingProviderId (SDK transport/routing
override), apiLine (regional endpoint selector).

## 0. Trace template

For each operand:

```
(1) B at source/store                (writeable; reachable from extension)
(2) B in active effective config     (EffectiveProviderConfig.{field})
(3) handler/provider construction
    reads B                           (ProviderConfig literal built by extension)
(4) next request consumes B          (request path reaches B)
```

Verdict is the conjunction:

```
YES  iff (1) AND (2) AND (3) AND (4)
NO   iff any link is broken at the extension->SDK boundary
N/A  iff no provider in the active set uses this operand at all
```

"NO at extension seam" is a strong result: a same-providerId write
that touches only the broken operand will NOT mutate the next
request, even when storage and the SDK handler would honor the
value if reached. This is the operand-blast-radius problem the
foundation ACT was opened to characterize.

## 1. `headers`

### 1a. (1) B at source/store

The legacy `ApiConfiguration` carries exactly ONE header field:

```
headerFields (apps/vscode/src/sdk/model-catalog/effective-config.ts:101-103)
  openai: "openAiHeaders"     (Record<string,string>)
```

No other providerId has a legacy header slot. StateManager persists
`openAiHeaders` alongside the other `ApiConfiguration` entries
(`apps/vscode/src/shared/storage/state-keys.ts` family; gRPC
`ApiConfiguration` conversion in
`apps/vscode/src/shared/proto-conversions/models/api-configuration-conversion.ts`).

The SDK-side `providers.json` (`ProviderSettings.headers`) also stores
the same field. Both stores are reachable from the extension.

**Verdict (1): YES** — the field exists and is writeable.

### 1b. (2) B in active effective config

`EffectiveProviderConfig.headers` is populated by
`buildEffectiveProviderConfig` (effective-config.ts:381-402):

```
assignIfDefined(merged, "headers",
  stateConfig.headers ?? providerSettings.headers)
```

For `providerId === "openai"`, `stateConfig.headers` resolves to
`config["openAiHeaders"]` (effective-config.ts:234-243,
`readHeadersFromConfig`). For all other providerIds,
`headerFields[provider]` is `undefined`, so the SDK store's
`providerSettings.headers` (if any) wins.

**Verdict (2): YES** — the effective config carries the value.

### 1c. (3) handler/provider construction reads B

This is where the chain breaks. The extension's single inference path
is `buildSdkProviderConfig` (apps/vscode/src/sdk/sdk-api-handler.ts:51-104):

```
const base: ProviderConfig = {
  providerId: toSdkProviderId(providerId),
  modelId: modelId ?? "",
  apiKey: apiKey ?? "",
  baseUrl,
  ...(vertexProviderConfig ?? {}),
  fetch,
  ...(providerId === "bedrock" ? buildBedrockProviderConfig(configuration, mode) : {}),
  ...(providerId === "ollama" ? resolveOllamaProviderConfig(configuration, modelId) : {}),
}
```

`headers` is NOT in this literal. No `resolveHeaders()` call, no read
of `stateConfig.headers`, no read of `openAiHeaders`, no spread of
any headers source. Same for `buildSessionConfig`
(apps/vscode/src/sdk/cline-session-factory.ts:1024-1037):

```
const providerConfig = {
  ...(cloudProviderConfig ?? {}),
  providerId: sdkProviderId,
  modelId,
  ...(apiKey ? { apiKey } : {}),
  ...(baseUrl !== undefined ? { baseUrl } : {}),
  ...(apiLine !== undefined ? { apiLine } : {}),
  ...(knownModels && ... ? { knownModels } : {}),
  ...(maxTokensPerTurn !== undefined ? { maxOutputTokens: maxTokensPerTurn } : {}),
  fetch,
}
```

No `headers` field. The SDK handler chain (handler-factory.ts:211, 249)
would consume `config.headers` if present on `normalizedProviderConfig`,
but the extension's `ProviderConfig` literal never sets it.

**Verdict (3): NO** — the extension's `ProviderConfig` builder drops
`headers` between (2) and (3).

### 1d. (4) next request consumes B

The SDK would consume `headers` if reached: `compat.ts:525` reads
`config.headers` into `GatewayConfig.headers`; vendor `openai.ts` /
`openai-compatible.ts` propagate `config.headers` via the underlying
SDK call. But link (3) is broken, so the value never reaches (4).

**Verdict (4): N/A** — moot given (3) = NO.

### 1e. Operand verdict: `headers` = **NO**

```
(1) source/store         = YES
(2) effective config     = YES
(3) handler construction = NO   <-- chain breaks here
(4) next request         = N/A  (moot)

headers = NO
```

**Causal meaning:** a same-`openai` (or same-`openai-compatible`)
write that changes ONLY `openAiHeaders` while leaving `openAiBaseUrl`
/ `openAiApiKey` / `actModeOpenAiModelId` unchanged will NOT mutate
the next request's effective connection. The user's custom headers
are silently dropped at link (3). The rebuild discriminator
(providerId-only, per evidence 03) does not fire on header-only
writes either, so no rebuild catches the silent drop.

---


## 2. `providerSpecificConfig`

Per `@cline/llms` `config.ts:408-419`, `ProviderSpecificConfig` is the
deprecated-but-still-recognized union of:

```
aws | gcp | azure | sap | oca |
maxInputTokens | apiLine | oauthPath | openRouterProviderSorting
```

`apiLine` is split out as its own operand (§3) per the reviewer's
instruction. This section covers `aws` / `gcp` / `azure` / `sap` / `oca`
structured blocks plus `openRouterProviderSorting` (and any
`ProviderOptions` extensions like `modelCatalog`).

### 2a. (1) B at source/store

The extension persists `aws`, `gcp`, `azure`, `sap`, `oca` structured
fields in two places:

- **Legacy `ApiConfiguration`**: `awsAccessKey`/`awsSecretKey`/
  `awsSessionToken`/`awsAuthentication`/`awsProfile`/`awsRegion`/
  `awsUseCrossRegionInference`/`awsUseGlobalInference`/
  `awsBedrockUsePromptCache`/`awsBedrockEndpoint`/
  `planModeAwsBedrockCustomModelBaseId`/
  `actModeAwsBedrockCustomModelBaseId`/`vertexProjectId`/`vertexRegion`/
  `sapAiCore*`/`oca*`/`liteLlmUsePromptCache`/`lmStudioMaxTokens`/
  `openRouterProviderSorting`/etc.
- **SDK `providers.json`**: `aws`/`gcp`/`azure`/`sap`/`oca`/`extras`
  structured blocks on `EffectiveProviderConfig`.

`extrasFields` (effective-config.ts:105-116) and `readStateExtras`
(effective-config.ts:245-262) bind these to specific providerIds.

**Verdict (1): YES** — writeable for every provider that semantically
uses one of these blocks.

### 2b. (2) B in active effective config

`buildEffectiveProviderConfig` merges cloud structured configs from
both stores:

```
assignIfDefined(merged, "aws", mergeAws(stateConfig.aws, providerSettings.aws))
assignIfDefined(merged, "gcp", mergeGcp(stateConfig.gcp, providerSettings.gcp))
assignIfDefined(merged, "extras", mergeExtras(providerSettings.extras, stateConfig.extras))
```

`mergeAws` / `mergeGcp` / `mergeExtras` (effective-config.ts:336-364)
are last-write-wins by store order; legacy `stateConfig` wins on
Bedrock/Vertex per the explicit comment (effective-config.ts:391-394).

**Verdict (2): YES** — the effective config carries the merged
structured blocks.

### 2c. (3) handler/provider construction reads B

`buildSessionConfig` builds structured provider configs for the four
cloud paths:

```
if (providerId === "bedrock") {
  bedrockProviderConfig = buildBedrockProviderConfig(apiConfig, mode)
}
if (providerId === "vertex") {
  vertexProviderConfig = resolveVertexProviderConfig(apiConfig)
}
if (providerId === "sapaicore") {
  sapProviderConfig = buildSapProviderConfig(apiConfig, mode)
  baseUrl = sapProviderConfig.baseUrl
}
if (providerId === "ollama") {
  ollamaProviderConfig = resolveOllamaProviderConfig(apiConfig, modelId)
}
```

These structured blocks are spread into `providerConfig`
(cline-session-factory.ts:1021-1025):

```
const cloudProviderConfig =
  bedrockProviderConfig ?? vertexProviderConfig ??
  sapProviderConfig ?? ollamaProviderConfig
const providerConfig = {
  ...(cloudProviderConfig ?? {}),  // region/aws/gcp/sap/ollama land here
  providerId: sdkProviderId,
  modelId,
  ...
}
```

`buildSdkProviderConfig` (the standalone utility path,
sdk-api-handler.ts:79) does the same for Bedrock (`buildBedrockProviderConfig`)
and Vertex (`resolveVertexProviderConfig`) inline. SAP and Ollama
structured configs are session-factory-only.

For `openRouterProviderSorting` and other `extras`, see `ProviderOptions`
in the SDK `ProviderConfig` (sdk/packages/llms/src/providers/config.ts:255-260);
these are forwarded via the unified `providerConfig.extras` spread and
then read by `buildGatewayProviderOptions` (handler-factory.ts:38-43).

**Verdict (3): YES** — the extension's `ProviderConfig` builder
forwards every structured provider-specific block where the active
providerId uses one.

### 2d. (4) next request consumes B

The SDK `handler-factory.ts:createAgentModelFromConfig` (lines
197-272) reads `config.aws`/`config.gcp`/`config.azure`/
`config.sap`/`config.oca`/`config.openRouterProviderSorting` and
forwards them into either the gateway `options`
(`buildGatewayProviderOptions`) or the `ProviderSettings` defaults.
Compat (`compat.ts:519-552`) reads `config.gcp?.projectId`,
`config.aws?.accessKey`, etc. into `GatewayConfig.options`. Bedrock
vendor (`vendors/bedrock.ts:221`) reads `config.options?.endpoint`,
`config.options?.sessionToken`, etc.

**Verdict (4): YES** — the SDK handler chain reads every structured
block the extension forwards.

### 2e. Operand verdict: `providerSpecificConfig` = **YES**

```
(1) source/store         = YES
(2) effective config     = YES
(3) handler construction = YES
(4) next request         = YES

providerSpecificConfig = YES
```

**Causal meaning:** a same-providerId write that touches only a
structured block (`aws.useCrossRegionInference`, `gcp.projectId`,
`sap.deploymentId`, `openRouterProviderSorting`, etc.) IS reflected
in the next request's effective connection — for the providers that
use those blocks. For providers with no structured block (most), this
operand is N/A, and that N/A collapses into the same per-provider
"YES for the providers that use it" verdict.

---


## 3. `apiLine`

### 3a. (1) B at source/store

`apiLine` is a regional selector for providers that ship region-specific
endpoints: `qwen`, `moonshot`, `zai`, `minimax` (and the coding
variants `qwen-code`, `zai-coding-plan`). The legacy `ApiConfiguration`
carries the field per `apiLineFields`:

```
apiLineFields (effective-config.ts:81-86)
  qwen      -> "qwenApiLine"
  moonshot  -> "moonshotApiLine"
  zai       -> "zaiApiLine"
  minimax   -> "minimaxApiLine"
```

The shared map (cline-session-factory.ts:744-747) covers coding
variants that fall back to the base provider's line. SDK
`providers.json` also stores `apiLine` on `EffectiveProviderConfig`.

**Verdict (1): YES** — writeable for the four regional providers and
their coding variants.

### 3b. (2) B in active effective config

`buildEffectiveProviderConfig` merges the apiLine value
(effective-config.ts:388):

```
assignIfDefined(merged, "apiLine",
  stateConfig.apiLine ?? providerSettings.apiLine)
```

`stateConfig.apiLine` resolves via
`readStringFromConfig(config, apiLineFields[provider])`
(effective-config.ts:325, 226-232). The SDK-side fallback
`providerSettings.apiLine` is read from `providers.json`.

**Verdict (2): YES** — the effective config carries the value.

### 3c. (3) handler/provider construction reads B

`buildSessionConfig` resolves `apiLine` via
`resolveApiLine(providerId, apiConfig)` (cline-session-factory.ts:839)
and forwards it onto `providerConfig` (cline-session-factory.ts:1030):

```
...(apiLine !== undefined ? { apiLine } : {}),
```

`buildSdkProviderConfig` (the standalone utility path,
sdk-api-handler.ts:68-85) does NOT call `resolveApiLine` and does NOT
forward `apiLine`. This is a gap on the standalone-utility path; for
the providers where `apiLine` matters (qwen/moonshot/zai/minimax), the
standalone-utility callers do not currently exist for these providers
(the only standalone caller is commit-message generation, which always
uses a default `cline` provider, per the reviewer's noted scope). The
session-factory path is the load-bearing path for the main task loop,
and it forwards `apiLine` correctly.

**Verdict (3): YES** — for the main task loop, `apiLine` is forwarded.
The standalone-utility path is N/A for these providers today; flagged
for §12 design freeze but not load-bearing on R0.

### 3d. (4) next request consumes B

The SDK gateway consumes `apiLine` via `buildGatewayProviderOptions`
(handler-factory.ts:40):

```
apiLine: config.apiLine,
```

This is forwarded as `GatewayConfig.options.apiLine`. The SDK gateway
maps `apiLine` to the provider's regional base URL when no explicit
`baseUrl` is configured (per the `resolveApiLine` docstring:
cline-session-factory.ts:723-736).

**Verdict (4): YES** — for providers that ship `apiLine`, the value
reaches the regional routing decision on every request.

### 3e. Operand verdict: `apiLine` = **YES**

```
(1) source/store         = YES
(2) effective config     = YES
(3) handler construction = YES (session-factory path;
                               standalone-utility path is N/A today
                               for these providers)
(4) next request         = YES

apiLine = YES
```

**Causal meaning:** a same-providerId write to `qwenApiLine` /
`moonshotApiLine` / `zaiApiLine` / `minimaxApiLine` flips the regional
routing on the next request, when the active providerId is one of
those four (or one of their coding variants).

---


## 4. `routingProviderId`

`routingProviderId` is an SDK-level override field on `ProviderConfig`
(sdk/packages/llms/src/providers/config.ts:309). The SDK uses it for
transport/routing reuse in some provider paths:

```
"routingProviderId" lets clients expose a custom provider ID and
model catalog while reusing the runtime behavior of a built-in
provider implementation.
```

It is resolved at the SDK layer via `resolveRoutingProviderId`
(config.ts:395-399) and `withNormalizedProviderId` (providers.ts:83-95).

### 4a. (1) B at source/store

The extension has NO storage slot for `routingProviderId`. It does
not appear in `ApiConfiguration`, in `state-keys.ts`, in the
provider-catalog field maps, or in the gRPC conversion. The
`@cline/core` `ProviderSettingsManager` schema
(sdk/packages/core/src/services/llms/provider-settings.ts:148-150)
does not include `routingProviderId` either.

**Verdict (1): N/A** — the extension has no concept of
`routingProviderId` storage.

### 4b. (2) B in active effective config

`EffectiveProviderConfig` does NOT include `routingProviderId`
(model-catalog/contracts.ts:141-145 lists only providerId/apiKey/
baseUrl/apiLine/headers/region/aws/gcp/contextWindow/auth/extras).

**Verdict (2): N/A** — not in the effective config.

### 4c. (3) handler/provider construction reads B

`buildSdkProviderConfig` (sdk-api-handler.ts:68-85) and
`buildSessionConfig` (cline-session-factory.ts:1024-1037) both build
their `ProviderConfig` literals WITHOUT setting `routingProviderId`.

The only place `routingProviderId` is set in the codebase is
`sdk/packages/core/src/services/llms/configured-provider-registry.ts:124`:

```
routingProviderId: provider.builtinProviderId,
```

inside `registerSelectionConfig`, which is invoked only by
SDK-internal callers that register custom providers with a
`builtinProviderId` (e.g. CLI/HUB custom provider flows). The
extension's extension→SDK plumbing never enters this code path.

**Verdict (3): N/A** — the extension never sets it; the SDK's
custom-handler registration is the only writer, and it is not
reached by the extension.

### 4d. (4) next request consumes B

`resolveRoutingProviderId` and `withNormalizedProviderId` honor it
when set. But link (3) = N/A, so the value never reaches (4) from
the extension seam.

**Verdict (4): N/A** — moot.

### 4e. Operand verdict: `routingProviderId` = **N/A**

```
(1) source/store         = N/A  (extension has no slot)
(2) effective config     = N/A  (not in EffectiveProviderConfig)
(3) handler construction = N/A  (extension never sets; SDK custom
                                handler registry is out of scope
                                for this ACT)
(4) next request         = N/A  (moot)

routingProviderId = N/A
```

**Causal meaning:** `routingProviderId` is independent of `apiLine`
and `providerId`; the extension never exercises it; the operand is
explicitly out of scope for the extension→SDK seam characterization.
§12 design freeze must NOT collapse `apiLine` / `routingProviderId` /
`providerId` into one bucket, per the reviewer's instruction.

---


## 5. `region`

### 5a. (1) B at source/store

`region` is meaningful for cloud providers. The legacy
`ApiConfiguration` carries it via `regionFields`:

```
regionFields (effective-config.ts:88-91)
  bedrock -> "awsRegion"
  vertex  -> "vertexRegion"
```

SDK `providers.json` also stores `region` on `EffectiveProviderConfig`
(per `ProviderSettings.region`, sdk/packages/core/src/services/llms/
provider-settings.ts` family). Non-cloud providers have no `region`
field by design — they have no regional concept.

**Verdict (1): YES** — writeable for bedrock/vertex; N/A for all
others (no `region` slot exists for them).

### 5b. (2) B in active effective config

`buildEffectiveProviderConfig` merges the region value
(effective-config.ts:390):

```
assignIfDefined(merged, "region",
  stateConfig.region ?? providerSettings.region)
```

Where `stateConfig.region` resolves via
`readStringFromConfig(config, regionFields[provider])`
(effective-config.ts:327, 226-232). For Bedrock/Vertex, this binds
to `awsRegion`/`vertexRegion`. For all other providers,
`regionFields[provider]` is `undefined`, so the SDK store's
`providerSettings.region` is the only source (and is typically
`undefined` for non-cloud providers).

**Verdict (2): YES** — for bedrock/vertex the effective config carries
the value; N/A for all others.

### 5c. (3) handler/provider construction reads B

`buildBedrockProviderConfig` (bedrock-config.ts:64-87) explicitly
builds:

```
return {
  region: trimToUndefined(configuration.awsRegion),
  aws,
  useCrossRegionInference: configuration.awsUseCrossRegionInference,
  useGlobalInference: configuration.awsUseGlobalInference,
}
```

`resolveVertexProviderConfig` (cline-session-factory.ts:619-638)
returns:

```
{
  region,
  gcp: { projectId, region },
}
```

Both land in `providerConfig` via the `cloudProviderConfig` spread
in `buildSessionConfig` (cline-session-factory.ts:1021-1025). The
standalone-utility path `buildSdkProviderConfig` (sdk-api-handler.ts:79)
also inlines `buildBedrockProviderConfig` for the bedrock branch and
`vertexProviderConfig` for the vertex branch.

**Verdict (3): YES** — for bedrock/vertex, the region is forwarded
into the SDK `ProviderConfig`. N/A for all other providers
(no region concept in their handler path; `compat.ts:531` defaults
`config.region ?? config.gcp?.region`, both `undefined`).

### 5d. (4) next request consumes B

The SDK handler chain consumes `region` for the providers that
need it:

- `buildGatewayProviderOptions` (handler-factory.ts:39): `region: config.region`
- Bedrock branch (handler-factory.ts:52-65) + `vendors/bedrock.ts:220`
- Vertex branch (handler-factory.ts:67-75) + `vendors/vertex.ts:79`
  (region -> `location` for the underlying SDK)

For non-cloud providers, `config.region` is `undefined`, the SDK
ignores the gateway `options.region`, and no request path touches
region. N/A.

**Verdict (4): YES** — for bedrock/vertex. N/A for all others.

### 5e. Operand verdict: `region` = **YES**

```
(1) source/store         = YES (bedrock/vertex);
                           N/A (others — no field exists)
(2) effective config     = YES (bedrock/vertex);
                           N/A (others)
(3) handler construction = YES (bedrock/vertex);
                           N/A (others)
(4) next request         = YES (bedrock/vertex);
                           N/A (others)

region = YES
```

**Causal meaning:** a same-providerId write to `awsRegion` (when
active providerId = bedrock) or `vertexRegion` (when active
providerId = vertex) flips the regional routing on the next request.
For non-cloud providers, region is N/A (no regional routing at all).

---


## 6. Consolidated R0 component matrix

| Operand                   | (1) src | (2) eff | (3) hdlr | (4) req | **Verdict** | Notes |
|---------------------------|---------|---------|----------|---------|-------------|-------|
| `baseUrl`                 | YES     | YES     | YES      | YES     | **YES**     | Frozen in 04. |
| `credentialValue`         | YES     | YES     | YES      | YES     | **YES**     | Frozen in 04. |
| `modelId`                 | YES     | YES     | YES      | YES     | **YES**     | Frozen in 04. |
| `headers`                 | YES     | YES     | **NO**   | N/A     | **NO**      | Dropped at link (3) by `buildSdkProviderConfig` and `buildSessionConfig`. |
| `providerSpecificConfig`  | YES     | YES     | YES      | YES     | **YES**     | For providers that ship a structured block (aws/gcp/azure/sap/oca). N/A otherwise. |
| `apiLine`                 | YES     | YES     | YES      | YES     | **YES**     | For qwen/moonshot/zai/minimax (and coding variants). N/A otherwise. |
| `routingProviderId`       | N/A     | N/A     | N/A      | N/A     | **N/A**     | Extension never sets; SDK custom-handler registry only. |
| `region`                  | YES     | YES     | YES      | YES     | **YES**     | For bedrock/vertex only. N/A for all other providers. |

**No `NOT_PROVEN` survives.** Every operand that the corrected R0
listed as NOT_PROVEN now has a definitive YES/NO/N/A verdict.

### 6a. R0 → completed

```
CURRENT_SEAM_CAN_EXPRESS_INSTANCE_IDENTITY    = NO
CURRENT_SEAM_RERESOLVES_CONNECTION_COMPONENTS =
  providerId              = SAME
  baseUrl                 = YES
  credentialValue         = YES
  modelId                 = YES
  headers                 = NO          <-- evidence 05
  providerSpecificConfig  = YES (cloud only; N/A otherwise)
  apiLine                 = YES (regional only; N/A otherwise)
  routingProviderId       = N/A         <-- evidence 05
  region                  = YES (bedrock/vertex only; N/A otherwise)
```

### 6b. `CURRENT_SEAM_MUTATES_FULL_CONNECTION` derivation

Per the ninetieth-pass reviewer's derivation rule:

> `CURRENT_SEAM_MUTATES_FULL_CONNECTION = YES` iff every
> provider-relevant operand is `YES` or `N/A`. If any relevant
> operand is `NO`, then `CURRENT_SEAM_MUTATES_FULL_CONNECTION = NO`.

`headers = NO` is a provider-relevant operand (the field exists,
is writeable, and reaches the effective config — the extension just
drops it at link (3)). Therefore:

```
CURRENT_SEAM_MUTATES_FULL_CONNECTION = NO
```

**Causal implication:** a same-providerId write that changes ONLY
`headers` (e.g. a user edits `openAiHeaders` while keeping
`openAiBaseUrl` / `openAiApiKey` / `actModeOpenAiModelId` stable)
does NOT mutate the next request's effective connection. The
extension's `ProviderConfig` literal drops the value. The rebuild
discriminator (providerId-only, per evidence 03) does not fire on
header-only writes either, so no rebuild catches the silent drop.

This is exactly the "headers only / rebuild not justified" gap the
foundation ACT was opened to characterize. It is real, it is
demonstrable from source, and it is now reduced to a concrete
production repair decision (NOT made here; this file only freezes
the trace).

### 6c. R0_EVIDENCE and R0_EXECUTED_SWITCH

These two are unchanged from evidence 04 v2:

```
R0_EVIDENCE                                = STRUCTURAL
R0_EXECUTED_SWITCH                         = NOT_EXECUTED
```

No new dynamic measurement happened in evidence 05; this is a
source-trace widening, not an executed-switch test. R1 (per the
ninetieth-pass reviewer) is the next executable step.

---


## 7. Hand-off to §12 design freeze

`CURRENT_SEAM_MUTATES_FULL_CONNECTION = NO` (causally derived) is the
single most important result of this trace. It narrows §12's design
space:

- A storage-only fix (α or β that captures per-instance overrides in
  providers.json) is necessary but NOT sufficient for headers,
  because the extension→SDK `ProviderConfig` builder itself drops
  the value.
- A runtime-strategy that triggers on same-providerId config changes
  (B or C with an extended rebuild discriminator) DOES catch the
  headers case IF the rebuild path rebuilds the `ProviderConfig`
  literal with `headers` included — which requires fixing the
  `buildSdkProviderConfig` / `buildSessionConfig` literals to read
  `stateConfig.headers` (or `providerSettings.headers`) at link (3).
- A handler-recreation path (A: rebuild only) does NOT help, because
  the new handler reads from the same broken `ProviderConfig` literal
  that drops the value.

§12 must therefore couple any storage decision (α / β / γ) with a
fix to the `ProviderConfig` builder, or it will inherit the
`headers = NO` defect. The exact coupling (which storage strategy +
which builder fix) is §12's call, not evidence 05's. Evidence 05
freezes the trace that bounds the decision.

The N/A carve-outs (`routingProviderId`, plus the per-provider N/A
on `apiLine` / `region` / `providerSpecificConfig`) MUST be preserved
through §12. The reviewer explicitly forbids collapsing:

```
providerId
routingProviderId
apiLine
```

into one bucket. Each is an independent identity dimension in the
`ProviderConfig` type; §12 must either keep them distinct or, if it
chooses to introduce a unifying `ProviderConfigurationInstance`
identity, must demonstrate the mapping is load-bearing (e.g.
`instanceId -> { providerId, routingProviderId?, apiLine?, region? }`
on the persistence side) — not merely a renaming.

## 8. What evidence 05 does NOT establish

- It does NOT characterize the in-flight safety invariant. That is
  R1's secondary assertion (no in-flight mutation during a switch).
- It does NOT pick α / β / γ. That is §12.
- It does NOT pick A / B / C. That is §12.
- It does NOT introduce any new persistence primitive. The trace
  works entirely against today's existing storage shape.
- It does NOT measure whether the rebuild path can be extended to
  fire on same-providerId config-identity changes (per evidence 03's
  M3 = NO). That measurement is R1's primary assertion.
- It does NOT assert that the headers-only defect is the only defect
  in `buildSdkProviderConfig`. The trace verified the four NOT_PROVEN
  operands from evidence 04 v2; other fields (e.g. `maxOutputTokens`,
  `reasoningEffort`, `knownModels`) are out of scope for the R0
  component matrix and may have their own gaps.

---


## 9. Traceability hooks for §12 design freeze + R1

When §12 freezes storage strategy and §13/§14 R1 runs:

```
R1 RED (evidence file to be written in FOUNDATION_IMPLEMENTATION_PHASE)
  MUST begin with:
    "R0 reference: 04-r0-current-seam-witness.md (v2) frozen on
     commit af1df4a60 (foundation entry) and corrected on commit
     eab1ca75c (foundation P1-CORRECTION01 amendment01);
     05-r0-remaining-operand-trace.md frozen on commit 0a3d9c2a5
     (foundation ninetieth-pass acknowledgment cycle):
       CURRENT_SEAM_CAN_EXPRESS_INSTANCE_IDENTITY    = NO
       CURRENT_SEAM_RERESOLVES_CONNECTION_COMPONENTS =
         providerId              = SAME
         baseUrl                 = YES
         credentialValue         = YES
         modelId                 = YES
         headers                 = NO      (extension drops at link 3)
         providerSpecificConfig  = YES (cloud only; N/A otherwise)
         apiLine                 = YES (regional only; N/A otherwise)
         routingProviderId       = N/A
         region                  = YES (bedrock/vertex only; N/A otherwise)
       CURRENT_SEAM_MUTATES_FULL_CONNECTION         = NO
                                                      (causally derived
                                                       from headers=NO;
                                                       fix requires
                                                       either builder
                                                       repair or rebuild-
                                                       triggered handler
                                                       recreation that
                                                       reads headers)
       CURRENT_SEAM_REBUILDS_ON_CONFIG_IDENTITY     = NO
       R0_EVIDENCE                                  = STRUCTURAL
       R0_EXECUTED_SWITCH                           = NOT_EXECUTED
     §12 design freeze: <as recorded in evidence 06-design-freeze.md>"

  R1 must NOT skip the R0/05 citation, per the R0 -> R1 ordering
  constraint in MP RECON evidence 13 v3.

  R1 primary assertion (per ninetieth-pass reviewer):
    Given: Instance A and B
           same providerId
           different provider-relevant connection state
    When:  active instance switches A -> B
    Then:  NEXT_EFFECTIVE_CONNECTION == B

  R1 secondary assertion (per evidence 03):
    Given: same setup as primary
    When:  switch attempted while session isRunning === true
    Then:  in-flight request is unaffected; the live handler does
           not mutate; the new instance takes effect only after
           the current request completes and the next request
           fires (idle-gated rebuild, OR in-place mutation, OR
           handler recreation — whichever §12 picks).

  R1 outcome:
    If primary reproduces the expected defect
      (NEXT_EFFECTIVE_CONNECTION != B):
      FOUNDATION_IMPLEMENTATION_PHASE = OPEN
      -> minimum bounded production repair
    Else (defect does not reproduce):
      HALT_RED_NOT_REPRODUCED
      -> preserve witness, halt Foundation, reopen R0.
```

## 10. Pre-flight (this evidence file only)

```
SCOPE               = recon-only (FOUNDATION_RECON_PHASE step (a);
                                production edits FORBIDDEN)
ACT_HEAD_AT_AUTHOR  = 0a3d9c2a5
                     (ninetieth-pass board row; foundation ACT body
                      + foundation evidence 00 v2 + 04 v2 +
                      P1-CORRECTION01 amendment01 + 89th-pass row
                      all in working tree; no source edits this cycle)
PRODUCTION_HEAD     = e06af528522ae2aa471aac9eed30acb51e9fdf92
                     (unchanged; no production edits)
RANGE_HYGIENE       = n/a (no source files touched; only this
                            evidence file authored)
TOUCHED_FILES       = .factory/evidence/
                     ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01/
                     05-r0-remaining-operand-trace.md   (this file)
PREDECESSORS        = 04-r0-current-seam-witness.md (v2, amendment01)
                     03-rebuild-discriminator.md
                     02-credential-storage-authority.md
                     01-connection-authority.md
                     00-preflight.txt
                     + foundation ACT body + P1-CORRECTION01 body
                     + 89th-pass board row
SUCCESSORS          = 06-design-freeze.md (§12 alpha/beta/gamma +
                                          semantic credential identity
                                          + physical secret-reference
                                          encoding + A/B/C runtime
                                          strategy) — FOUNDATION_RECON_PHASE
                                          step (b)
                     + foundation ACT §13/§14/§15 R1 — FOUNDATION_IMPLEMENTATION_PHASE
                       (gated on §12 design freeze + this trace + the
                       HALT_R0_FULL_CONNECTION_NOT_PROVEN verdict being
                       superseded by the explicit NO derived here)
```

---

## 11. Amendment 01 — R0_ACTIVE_SESSION_SEAM_NOT_BOUND

Status: **this amendment supersedes §6b and §9's R1 hooks.** The
ninetieth-pass reviewer demanded a trace of the **active-session
mutation seam** (the path that runs while a session is already
running), not the session-construction capability. The original §6b
mixed "can a freshly built `ProviderConfig` carry the operand?" with
"does the active-session seam refresh it?". These are not the same
path.

### 11a. The actual active-session mutation seam

The production path from `ProviderConfigStore.subscribe` to the
already-running `SessionRuntime`:

```
write → emit({ kind: "fields" | "selection", providerId, ... })
       ↓
SdkController.handleProviderConfigChange (SdkController.ts:1867)
   if (kind === "selection"
       && this.isSelectionForActiveModeProvider(event)) {
       this.sessions?.updateActiveSessionModel(event.selection.modelId)
   }
   // kind === "fields" → ONLY scheduleProviderConfigStatePost();
   //                      NO active-session transport at all.
       ↓
sessions.updateActiveSessionModel(modelId)  (sdk-session-lifecycle.ts:211)
       ↓
activeSession.sdkHost.updateSessionModel(sessionId, modelId)
       ↓
LocalRuntimeHost.updateSessionModel(sessionId, modelId)
                              (local-runtime-host.ts:1682)
   calls updateSessionConnection(sessionId, { modelId })
       ↓
LocalRuntimeHost.updateSessionConnection  (local-runtime-host.ts:1686)
   normalizeConnectionUpdate(rawUpdates)
   in-place mutate session.config.{providerId,modelId,apiKey,
                                  baseUrl,headers,providerConfig,
                                  reasoningEffort,thinking,
                                  thinkingBudgetTokens}
   session.agent.updateConnection(updates)
       ↓
SessionRuntimeOrchestrator.updateConnection
                              (session-runtime-orchestrator.ts:558)
   // mirrors the same ConnectionUpdate field set on AgentConfig:
   // providerId, modelId, apiKey, baseUrl, headers,
   // providerConfig, reasoningEffort, thinking,
   // thinkingBudgetTokens
   // NO apiLine, NO region, NO routingProviderId,
   // NO aws/gcp/azure/sap/oca as top-level fields
```

For a `providerId` change (which triggers rebuild via
`SdkProviderChangeCoordinator.handleApiConfigurationChanged`
[sdk-provider-change-coordinator.ts:43], gated on
`previousProvider !== nextProvider`):

```
SdkProviderChangeCoordinator
   if (previousProvider === nextProvider) return  // NO REBUILD on
                                                   // same-providerId writes
   rebuilds.request("provider",
                    () => restartActiveSessionForProviderChange())
       ↓
SdkSessionLifecycle.replaceActiveSession  (sdk-session-lifecycle.ts:364)
   // GATED: refuses if isRunning === true (in-flight safety)
   endActiveSession → startNewSession with freshly-built config
       ↓
sessionConfigBuilder.build({ cwd, mode })
   = buildSessionConfig  (cline-session-factory.ts:1024-1037)
   // providerConfig literal here drops headers; reads headers
   // are absent from the spread
```

**Conclusion:** the extension transports `modelId` to the active
session via `updateActiveSessionModel`. **It does NOT transport any
other field.** `updateSessionConnection` exists in the SDK with a
richer field set, but the extension never calls it directly; the
hub server uses it for cross-process clients (CLI/desktop sidecar),
not for the extension's own same-process active session.

### 11b. Per-field classification against the active-session seam

For each operand, the answer is YES/NO/N/A based on whether the
production path above transports the field to the active
`SessionRuntime` before the next request fires.

| Operand          | Active-session transport?            | Source                                              | Verdict |
|------------------|--------------------------------------|-----------------------------------------------------|---------|
| `baseUrl`        | **NO** (extension only calls `updateSessionModel`; not in `modelId`-only path) | updateActiveSessionModel signature takes only modelId | **NO** |
| `credentialValue`| **NO** (same reason)                 | as above                                            | **NO** |
| `modelId`        | **YES** (the only field the extension transports) | updateActiveSessionModel(event.selection.modelId)   | **YES** |
| `headers`        | **NO** (transport exists in SDK but extension doesn't call it; AND even a force-rebuild drops them because `buildSessionConfig` literal omits `headers`) | (a) extension→`updateSessionConnection` not called; (b) `buildSessionConfig:1024-1037` literal omits `headers` | **NO** |
| `aws`            | **NO** (not in `ConnectionUpdate` type at SDK level either; AND `buildSessionConfig` only rebuilds when providerId changes; on same-providerId Bedrock write, `previousProvider === nextProvider === "bedrock"` → no rebuild) | (a) `ConnectionUpdate` field set (connection-update.ts:3-13) does not include `aws`; (b) `SdkProviderChangeCoordinator:48` gates on `previousProvider === nextProvider` | **NO** |
| `gcp`            | **NO** (same reason as aws)          | as above                                            | **NO** |
| `azure`          | **NO** (same reason as aws)          | as above                                            | **NO** |
| `sap`            | **NO** (same reason as aws)          | as above                                            | **NO** |
| `oca`            | **NO** (same reason as aws)          | as above                                            | **NO** |
| `apiLine`        | **NO** (not in `ConnectionUpdate` type; AND `buildSessionConfig` only rebuilds on providerId change) | (a) `ConnectionUpdate` lacks `apiLine`; (b) providerId-gated rebuild | **NO** |
| `region`         | **NO** (same reason as apiLine)      | (a) `ConnectionUpdate` lacks `region`; (b) providerId-gated rebuild | **NO** |
| `routingProviderId` | N/A (extension never sets it; SDK custom-handler registry only; SDK `ConnectionUpdate` also lacks it) | (a) extension has no slot; (b) `ConnectionUpdate` lacks `routingProviderId` | **N/A** |

### 11c. P1 precision fix — `openai-compatible` example

Evidence 05 §1 stated:

> a same-`openai` **or same-`openai-compatible`** write changing only
> `openAiHeaders`...

This was imprecise. The legacy `headerFields` map
(effective-config.ts:101-103) binds ONLY `openai -> openAiHeaders`;
`openai-compatible` has no entry. The `openai-compatible` provider's
headers, when persisted via providers.json, come from
`ProviderSettings.headers` (provider-settings.ts:152, 266), NOT from
`openAiHeaders`. Split:

```
openai (legacy state):
  openAiHeaders is the relevant header source
openai-compatible (providers.json):
  ProviderSettings.headers is the relevant source
```

Both are still `NO` on the active-session seam (extension never
calls `updateSessionConnection`; `buildSessionConfig` literal omits
`headers`), so the verdict is unchanged. The precision matters
because §12 must not assume `openAiHeaders` is the only header
slot; it must consult both legacy-state and providers.json header
paths when designing the rebuild discriminator.

### 11d. P1 precision fix — `providerSpecificConfig` disaggregation

`providerSpecificConfig` is a deprecated convenience union over
`aws | gcp | azure | sap | oca | maxInputTokens | apiLine |
oauthPath | openRouterProviderSorting`. Evidence 05 §2 aggregated
the verdict as `YES` (per-block forward in `buildSessionConfig`),
but the per-block transport on the active-session seam is uniform:
**none of `aws`/`gcp`/`azure`/`sap`/`oca`/`openRouterProviderSorting`
is in `ConnectionUpdate`** and **none of them survives a

### 11e. Re-derived `CURRENT_SEAM_MUTATES_FULL_CONNECTION`

```
SESSION_BUILD_PATH_SUPPORTS_COMPONENT =
  headers                = NO
  providerSpecificConfig = YES (per-block; N/A otherwise)
  apiLine                = YES (regional only)
  region                 = YES (bedrock/vertex only)
  // plus YES for baseUrl, credentialValue, modelId

CURRENT_LIVE_UPDATE_PATH_REFRESHES_COMPONENT =
  // ALL operand rows in §11b except modelId are NO
  baseUrl                = NO
  credentialValue        = NO
  modelId                = YES
  headers                = NO
  aws                    = NO
  gcp                    = NO
  azure                  = NO
  sap                    = NO
  oca                    = NO
  apiLine                = NO
  region                 = NO
  routingProviderId      = N/A

CURRENT_SEAM_MUTATES_FULL_CONNECTION =
  YES iff every provider-relevant LIVE-UPDATE row is YES/N/A.
  Otherwise NO.

  Verdict:
    rows that are YES   = { modelId }
    rows that are N/A   = { routingProviderId }
    rows that are NO    = { baseUrl, credentialValue, headers,
                            aws, gcp, azure, sap, oca, apiLine,
                            region }
    Every provider-relevant row except modelId is NO.
  Therefore:
    CURRENT_SEAM_MUTATES_FULL_CONNECTION = NO
```

This is **much stronger than the §6b derivation** (`headers=NO`
alone). The active-session seam does not refresh ANY operand
except `modelId`. A same-providerId write to `apiKey`, `baseUrl`,
`headers`, `region`, `apiLine`, or any structured `aws`/`gcp`/
`azure`/`sap`/`oca` block does not change the next request's
effective connection — even if the user expects it to. The
session is effectively **frozen at construction time on every field
except `modelId`**.

### 11f. R1 hook update

§9's R1 hooks are amended as follows. The primary assertion is
unchanged, but the **expected defect** is wider:

```
R1 primary assertion (amended):
  Given: Instance A and B
         same providerId
         different provider-relevant connection state
         where the different field is one of
         { apiKey, baseUrl, headers, region, apiLine,
           any aws/gcp/azure/sap/oca structured block }
  When:  active instance switches A -> B
  Then:  NEXT_EFFECTIVE_CONNECTION == B

Expected defect (per §11b):
  A same-providerId write to ANY operand except modelId does NOT
  refresh the active session. The session keeps using the values
  captured at construction time.

  R1 RED reproducer (minimum):
    active provider = openai (legacy) / openai-compatible (SDK)
    write 1: openAiApiKey = "key-A"
    start session → next request uses key-A ✓
    write 2: openAiApiKey = "key-B"  (same providerId)
    next request uses key-B?  EXPECTED: yes;  ACTUAL: NO (still key-A)
    // because the extension only calls updateSessionModel,
    // not updateSessionConnection; even if the SDK were exercised,
    // the buildSessionConfig literal drops headers but does carry
    // apiKey at line 1028; the issue is that the extension never
    // calls updateSessionConnection at all.

  Repeat for: openAiHeaders, openAiBaseUrl, qwenApiLine,
  awsRegion, vertexProjectId, openRouterProviderSorting.
```

### 11g. What this changes for §12

The §12 design freeze now has a stronger causal signal than
evidence 05 originally presented:

- A storage-only fix (α/β) that captures per-instance overrides
  in providers.json does NOT suffice. The active-session seam does
  not read those overrides on a same-providerId write.
- A runtime strategy that triggers a force-rebuild on same-providerId
  config-identity changes (B or C with an extended rebuild
  discriminator that fires on `apiKey`/`baseUrl`/`headers`/
  `region`/`apiLine`/structured-block changes) IS sufficient,
  provided the rebuild path rebuilds the `ProviderConfig` literal
  with `headers` included (a builder repair is also required for
  headers; the other fields are already in the literal).
- An in-place mutation path (A: hot-mutate via
  `updateSessionConnection`) is a smaller-blast-radius alternative
  for the fields that fit the SDK `ConnectionUpdate` shape
  (providerId, modelId, apiKey, baseUrl, headers, providerConfig,
  reasoningEffort, thinking, thinkingBudgetTokens). But:
  - It does not cover `apiLine`/`region` (NOT in ConnectionUpdate).
  - It does not cover structured `aws`/`gcp`/`azure`/`sap`/`oca`
    blocks (they would need a full session restart).
  - It must gate on `isRunning === false` (same in-flight safety
    as evidence 03's secondary assertion).

This combination — a hot-mutate for `apiKey`/`baseUrl`/`headers`/
`providerConfig`/`reasoningEffort`/`thinking` + a force-rebuild for
`apiLine`/`region`/structured-blocks — is the minimum that makes
every row of §11b become `YES` (or N/A). §12 may also choose a
single force-rebuild strategy for all of them; the result is the
same on `MUTATES_FULL_CONNECTION`.

### 11h. Reviewer classification

```
P0 = R0_ACTIVE_SESSION_SEAM_NOT_BOUND   (this amendment addresses it)

P1 = openai-compatible/openAiHeaders example conflates legacy
     openai slot with provider-settings headers
     (fixed in §11c)

P1 = providerSpecificConfig = YES too aggregated
     (disaggregated in §11d)

P2 = none

CURRENT_SEAM_MUTATES_FULL_CONNECTION = NO   (re-derived in §11e;
                                            much stronger than §6b)

HEADERS_PROVIDERCONFIG_BRIDGE_DROP  = STRUCTURALLY_PROVEN
                                     (carried over from §6)

FOUNDATION_RECON_PHASE              = ACTIVE
§12 DESIGN FREEZE                   = may proceed; the active-session
                                       trace is now bound
R1                                   = may proceed; primary assertion
                                       is unchanged, expected defect
                                       set is widened in §11f
```

Reviewer reopen condition satisfied: the small active-session
update matrix is appended; `CURRENT_SEAM_MUTATES_FULL_CONNECTION`
is derived from that seam, not from session-construction capability;
`providerSpecificConfig` is disaggregated; the `openai-compatible`
precision is fixed. §12 + R1 may now proceed without further
pre-execution review unless the next trace reveals another genuinely
new P0.

## 12. Pre-flight (this amendment)

```
SCOPE               = recon-only (FOUNDATION_RECON_PHASE amendment
                                step (a.1) — addresses reviewer reopen
                                condition for evidence 05; production
                                edits FORBIDDEN)
ACT_HEAD_AT_AUTHOR  = 0a3d9c2a5
                     (unchanged; this is an evidence-only amendment
                      to 05-r0-remaining-operand-trace.md; no source
                      files were touched in this cycle)
PRODUCTION_HEAD     = e06af528522ae2aa471aac9eed30acb51e9fdf92
                     (unchanged; no production edits)
RANGE_HYGIENE       = n/a (no source files touched; only this
                            evidence file amended)
TOUCHED_FILES       = .factory/evidence/
                     ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01/
                     05-r0-remaining-operand-trace.md   (this file)
SUCCESSORS          = 06-design-freeze.md (§12 alpha/beta/gamma +
                                           semantic credential identity
                                           + physical secret-reference
                                           encoding + A/B/C runtime
                                           strategy)
                     + foundation ACT §13/§14/§15 R1 — FOUNDATION_IMPLEMENTATION_PHASE
                       (gated on §12 design freeze + this amendment
                       and the HALT_R0_FULL_CONNECTION_NOT_PROVEN
                       verdict being superseded by the explicit NO
                       re-derived in §11e)
```
