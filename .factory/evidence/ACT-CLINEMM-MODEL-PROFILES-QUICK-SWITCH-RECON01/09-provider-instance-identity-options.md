# 09 — Provider-instance identity options (Q-mechanical-1)

PRODUCTION HEAD = 97f49582e (this is recon work; recon does not modify production)

This file answers the reviewer's Q-mechanical-1 from
`HALT_MODEL_PROFILE_CONTRACT_NOT_COHERENT`:

> "What is the smallest identity layer that allows two configurations
> of one provider to coexist without duplicating secrets?"

## The minimum shape required

The product contract cited a concrete case that the prior freeze (R)
could not represent:

```text
Profile A
  provider = openai-compatible
  baseUrl  = http://local-litellm/
  key      = local
  model    = minimax-m3

Profile B
  provider = openai-compatible
  baseUrl  = https://corporate-litellm/
  key      = corporate
  model    = qwen
```

These two must coexist. They share `providerId =
"openai-compatible"` but differ in `baseUrl` and `key`. The current
`StoredProviderSettings.providers: Record<providerId, Entry>` cannot
hold both.

The minimum identity layer is therefore a thin named-config record:

```text
ProviderConfigurationInstance
  instanceId            : string  (durable; survives Profile CRUD)
  providerId            : string  (openai-compatible, anthropic, …)
  baseUrl?              : string
  apiLine?              : string  (per-provider routing tier)
  headers?              : Record<string,string>
  region?               : string  (e.g. AWS region for bedrock)
  providerSpecificConfig? : object (non-secret per-provider knobs)
  credentialReference   : {
    kind    : "ProviderSettingsManager" | "OAuth" | "apiKey"
    // resolved through the EXISTING secure provider machinery.
    // Never the raw secret.
  }
```

The profile then references `instanceId`, never `providerId`. Secrets
never enter the profile record; they live in the existing secure
machinery (`providers.json` + `secrets.json` + OAuth storage) which
already owns `apiKey`, OAuth tokens, and the secure provider path.

## Three concrete options (the foundation ACT will pick one)

### Option α — generalize the existing `ProviderSettingsManager` keys

```text
providers.json: Record<instanceId, ProviderEntry>
// (was: Record<providerId, ProviderEntry>)
```

Cheapest in terms of new files, but breaks every existing key
shape, every existing read site, and the F3B four-site bypass
survey. Migration cost = touching ~100+ legacy per-mode keys.

### Option β — thin separate `provider-instances.json`

```text
~/.cline/data/provider-instances.json
{
  "instances": [
    { "instanceId": "litellm-local",
      "providerId": "openai-compatible",
      "baseUrl": "http://local-litellm/",
      "credentialReference": { "kind": "apiKey",
                               "secretsKey": "provider.litellm-local" } }
  ]
}
```

Cleanest isolation. Zero blast radius on `providers.json`. The
profile references `instanceId`; the runtime resolves the instance
record and then routes to the existing `ProviderSettingsManager` for
credentials. New file is small and additive.

### Option γ — fold into `StoredProviderModes` (mirror `voiceInput`)

Reuse the precedent set by `voiceInput` (an additive block inside
`StoredProviderModes`). One new field:

```text
StoredProviderModes.providerInstances:
  Record<instanceId, ProviderConfigurationInstance>
```

No new file; lives in the existing per-mode settings shape. Slightly
wider blast radius on `StoredProviderModes` than Option β, but
smaller than Option α.

## Recommendation (for the foundation ACT to evaluate)

**Start with Option β** unless source survey proves Option γ cheaper.
The blast radius on existing keys is the decisive factor, and Option
β has zero blast radius.

The recon does NOT pre-decide Option α/β/γ. The foundation ACT must:

1. Survey every read site of `providerId` keys.
2. Survey every write site.
3. Compare Option α (existing-key generalization) vs Option β (new
   file) vs Option γ (additive `StoredProviderModes` block) on
   blast radius + migration cost + schema clarity.
4. Freeze one. Implement it.

## Constraint preservation

Regardless of which Option the foundation ACT picks:

```text
PROFILE_CONTAINS_RAW_SECRET = NO  (still holds — credentials are
                                    ALWAYS resolved through the existing
                                    secure provider machinery, regardless
                                    of which identity Option is chosen)

PROFILE_REFERENCES_INSTANCE_ID = YES  (the profile refers to the
                                       instanceId, not the providerId;
                                       secrets follow from instance)

SECRETS_STAY_IN_SECURE_MACHINERY = YES  (apiKey / OAuth / secrets.json
                                         unchanged)
```

## Open question flagged by second reviewer (P3-2)

A second-reviewer verdict (`HALT_PROVIDER_INSTANCE_SWITCH_SEAM_NOT_BOUND`)
flagged that the credential identity scope is underspecified. The
P2 freeze alternated between two incompatible framings:

```text
credentialReference → existing secure machinery
existing provider credentials are keyed by providerId
```

For two same-provider instances with different keys:

```text
openai-compatible/local      → key A
openai-compatible/corporate  → key B
```

a credential store keyed only by `providerId = openai-compatible`
cannot identify both. Option β above quietly introduced the thing
actually required (`credentialReference.secretsKey =
provider.litellm-local`), which is a NEW credential-reference
identity namespace — not merely "use the existing providerId key".

This is fine architecturally, but the foundation ACT must freeze
the choice honestly:

```text
PROVIDER_INSTANCE_CREDENTIAL_IDENTITY  = NOT_YET_BOUND  (this file)
CREDENTIAL_IDENTITY_SCOPE              = NOT_YET_BOUND  (this file)
                                          Foundation must answer:
                                          PROVIDER_ID |
                                          PROVIDER_INSTANCE_ID |
                                          EXISTING_SECRET_REFERENCE
                                          Result must permit:
                                          instance A → secret A,
                                          instance B → secret B
                                          without copying either secret
                                          into the instance record
```

All three Options above can support `PROVIDER_INSTANCE_ID`
credential scope (Option β's `secretsKey` field is the natural
carrier). The foundation ACT picks one Option AND freezes the
credential identity scope in the same decision.

EVIDENCE CLASS = STRUCTURAL — derives the minimum shape from the
                  product case + the existing persistence contract;
                  does not depend on a live trace. Foundation ACT
                  does the source survey and picks one option.
