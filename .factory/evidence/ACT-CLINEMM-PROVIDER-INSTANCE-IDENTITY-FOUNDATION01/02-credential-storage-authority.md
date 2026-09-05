# 02 — Credential storage / reference authority (recon stream 1b)

Recon date: foundation ACT entry (pre-R0).
Scope: which production seams own credential references today, what the
storage key shape is, and whether an instance-granular primitive already
exists. Per ACT body §8.

Per ACT body §5: this survey only CHARACTERIZES. The semantic-vs-physical
separation forbids binding the physical encoding here; the encoding choice
happens in §12 design freeze after R0 measures the blast radius.

---

## 1. Two storage authorities, one logical credential

There are two seams that today hold credentials. They mirror each other.

### 1a. Legacy `ApiConfiguration` global-state fields

Per `apps/vscode/src/sdk/cline-session-factory.ts:369-410`
(`PROVIDER_API_KEY_MAP`), each legacy providerId maps to exactly ONE
`keyof ApiConfiguration` field. The full list is in evidence file 01 §2.

**Key shape:** `<providerId><Suffix>ApiKey` (e.g. `openAiApiKey`,
`openRouterApiKey`). The key is **providerId-derived**, not instance-derived.
There is no slot for "openai-compatible instance A" vs "openai-compatible
instance B" — only one `openAiApiKey` slot.

### 1b. `providers.json` (single source of truth per `extension.ts:744`)

Per `apps/vscode/src/core/controller/models/resolveModelInfo.ts:69-80`
and the SDK bridge `getProviderSettingsManager()` (from
`apps/vscode/src/sdk/provider-migration.ts`), credentials live in a file
called `providers.json` under the user's CLINE data directory. This is
the SDK's `ProviderSettingsManager` store.

**Key shape (this is what we have to characterize):** the SDK's
`ProviderSettingsManager` keys entries by **providerId only** (per the
contract surface in `model-catalog/contracts.ts`: `read(providerId):
EffectiveProviderConfig`, `readSelection(providerId, mode)`). Same
collapsing problem as the legacy mirror.

To be confirmed at the SDK level (out of scope for recon — handled by
the foundation ACT's R0 + step 7 characterization):

```text
HYPOTHESIS:  ProviderSettingsManager on the SDK side also has no
            per-instance dimension. Two rows for the same providerId
            collapse at the SDK contract surface.

EVIDENCE TO COLLECT in step 7: the SDK's ProviderSettingsManager schema
            (in sdk/packages/core/src/services/provider-settings/ or
            equivalent), whether it carries any opaque ref primitive
            (content hash, stable slug) beyond the providerId key.
```

---

## 2. The collapse — concrete user-visible consequence

Operator intent (from MP RECON's product question):

```text
Profile "Local Ollama":
  providerId=openai-compatible, baseUrl=http://localhost:11434/v1,
  apiKey=local-anything (Ollama doesn't check it), modelId=qwen3-local

Profile "Corporate LiteLLM":
  providerId=openai-compatible, baseUrl=https://llm.corp.example/v1,
  apiKey=corp-key-xyz,                              modelId=qwen3-corp
```

Storage consequence today:

```text
.openAiApiKey
  - writing Profile "Local Ollama" saves "local-anything"
  - writing Profile "Corporate LiteLLM" saves "corp-key-xyz"
  - the FIRST value is overwritten by the SECOND; the operator loses
    local Ollama credential identity when they save the corp profile
  - Same problem on the SDK side: ProviderSettingsManager entry for
    "openai-compatible" is a single record keyed by providerId
```

This is the **same** gap MP RECON P3 named `SAME_PROVIDER_MULTI_CREDENTIAL_IDENTITY_NOT_BOUND`. R0 will witness it; this recon file points at the precise storage seams where the gap lives.

---

## 3. Existing secret-reference primitives (candidates for reuse)

The reviewer's P2 non-blocking correction said:

> "There may already be an existing opaque secret-reference primitive that
> can be reused while instance identity remains the owner. In that case
> the semantic scope is provider-instance, but the physical secret key
> need not literally equal `instanceId`."

The foundation ACT must discover what already exists. Preliminary scan:

### 3a. Content-hash references

No content-hash-derived reference was found in the credential resolution
seams. The fields are stored as raw strings (e.g. `config["openAiApiKey"]`
returns the trimmed string, not a hash). There is no
`openAiApiKeyContentHash` or equivalent anywhere in the resolution path.

### 3b. Stable slugs / opaque refs

None found in `resolveApiKey`, `resolveBaseUrl`, or the
`ProviderConfigStateKeys` mapping. ProviderSettingsManager on the SDK
side has not been inspected at the schema level here — that is part of
step 7 characterization.

### 3c. Pre-existing per-row storage id (apiConfig.<id>)

The legacy `apiConfig.<id>` row format (where each saved configuration
of any provider gets its own row in global state under a generated id)
**does** exist as a storage primitive. But it is NOT used by the SDK
adapter today — the SDK adapter reads the single `openAiApiKey` /
`openAiBaseUrl` / etc. fields, NOT per-row apiConfig entries. So this
primitive is dormant, not active.

**Implication for §12 design freeze:** the α / β / γ choice cannot reuse
`apiConfig.<id>` "for free" without re-plumbing the SDK adapter to read
per-row data. The foundation ACT will likely need to introduce a new
opaque ref or instanceId primitive as part of the seam expansion, and
that primitive IS the physical encoding that §5 keeps distinct from
semantic scope.

---

## 4. What the survey does NOT establish

This survey establishes the storage shape, not the resolution outcome.
The resolution outcome is:

```text
For the OPENAI_COMPATIBLE_A/B case from §2 above:
  resolveApiKey("openai-compatible", currentConfig) returns ONE string
  - either "local-anything" or "corp-key-xyz", whichever was last
    written to openAiApiKey
  - the "other" credential is NOT reachable through resolveApiKey

  -> the credential identity dimension collapses to providerId
  -> two instances of the same providerId share a single credential slot
```

R0 measures whether the runtime can be coerced into resolving a
different credential identity for the same providerId through any
other seam (e.g. a settings write that flips openAiApiKey mid-session).
The expectation per the reviewer's prior is `NO`.

---

## 5. Hand-off note to §12 design freeze

When §12 binds the physical encoding, the candidates ranked by
discoverability (descending):

```text
1. (none discovered yet) Reuse existing primitive if one is found in
   the SDK's ProviderSettingsManager on closer inspection (step 7).
2. instanceId — explicit new opaque ref added to the schema; physical
   storage key becomes e.g. openAiApiKey.<instanceId>.
3. (instanceId)  Same as #2 but bundled under a single new field, to
   avoid the per-field explosion across many providerId-keyed slots.
```

The foundation ACT does NOT pre-commit to any of these. R0 measures the
blast radius and §12 picks.
