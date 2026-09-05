# 13 — Instance-switch semantic recon plan (P3-1)

PRODUCTION HEAD = 97f49582e

This file is the **mechanical RED plan** the named foundation ACT
`ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01` must execute
to close the new P0 `PROVIDER_INSTANCE_SWITCH_SEAM_NOT_BOUND` raised
by the second-reviewer verdict `HALT_PROVIDER_INSTANCE_SWITCH_SEAM_NOT_BOUND`
on the prior `PROFILE_STORAGE_MODEL = I` correction.

The recon ACT's evidence pack (00–12) proved two live-switch seams
under the OLD `(providerId, modelId)` domain:

```text
Seam 1 — in-place same-provider model switch:
  handleProviderConfigChange → isSelectionForActiveModeProvider
  → sessions.updateActiveSessionModel
  → LocalRuntimeHost.updateSessionConnection
  → SessionRuntime.updateConnection (orchestrator: "for subsequent runs")

Seam 2 — provider-change restart:
  handleApiConfigurationChanged
  → SdkProviderChangeCoordinator.handleApiConfigurationChanged
  → rebuilds.request("provider", restartActiveSessionForProviderChange)
  → sessions.replaceActiveSession  (tears down + recreates the session)
```

These proofs are valid for `(providerId, modelId)`. They are
**NOT proven** for `(instanceId, providerId, modelId, effective
provider config)`, which is the domain the corrected product
introduces. Specifically:

```text
Instance A
  instanceId  = local
  providerId  = openai-compatible
  baseUrl     = http://local-litellm/
  apiLine     = (unset)
  headers     = {}
  region      = (unset)
  providerSpecificConfig = {}
  credentialReference = { kind: "apiKey", secretsKey: "provider.litellm-local" }

Instance B
  instanceId  = corporate
  providerId  = openai-compatible   <-- SAME as A
  baseUrl     = https://corp-litellm/
  apiLine     = (unset)
  headers     = { "X-Corp-Tenant": "..." }
  region      = (unset)
  providerSpecificConfig = {}
  credentialReference = { kind: "apiKey", secretsKey: "provider.litellm-corp" }

  active = A
  switch to B
```

Here `old.providerId === new.providerId`. Seam 1's discriminator
("is selection for active mode provider") will say "provider
unchanged"; Seam 2's discriminator ("provider changed") will
say "not triggered". Neither path is exercised.

Even if Seam 1 fires, `updateActiveSessionModel(modelId)` mutates
the **model** field of `SessionRuntime`'s connection state, NOT
the instance-owned fields (`baseUrl`, `apiLine`, `headers`,
`region`, `providerSpecificConfig`, `credential identity`). The
existing same-provider fast path is not equipped to carry the
instance-owned fields across.

## The five mechanical questions the foundation ACT must answer

The reviewer-supplied RED plan. Each question admits a binary
answer; the foundation ACT freezes the answers.

```text
Q1. Does provider-change detection notice the change?
    Hypothesis: NO (providerId unchanged).

Q2. Is the runtime rebuilt?
    Hypothesis: NO (Seam 1 fires, not Seam 2; no rebuild).

Q3. If not rebuilt, which connection/config fields are mutated?
    Hypothesis: ONLY modelId (per current updateActiveSessionModel
    semantics). Instance-owned fields are NOT mutated.

Q4. Does the next request actually go to B?
    Hypothesis: NO (instance-owned config still carries A's
    baseUrl / credential identity).

Q5. Does it resolve B's credentials rather than A's?
    Hypothesis: NO (the credential reference is keyed by providerId
    in the existing secure machinery; see evidence 09 P3-2).
```

If all five hypotheses hold (the likely outcome), the existing
seam cannot carry profile-instance switching. The foundation ACT
must then choose one of three outcomes:

```text
A. existing updateConnection supports the entire effective
   provider-instance configuration
   → reuse it (only if Q3/Q4/Q5 surprise NO)

B. instance change requires forced session rebuild even when
   providerId is equal
   → add instance-change discriminator to rebuild path
   (reviewer's prior probability — likely)

C. neither seam can carry it
   → bounded runtime-switch extension required (new component)
```

## Trace plan (foundation ACT Phase 0 recon)

The foundation ACT must execute this trace before any implementation.
This file is the recon blueprint; the foundation ACT writes the
trace results into its own evidence.

```text
Step 1 — INSTANCE-A READ
  Read the live SDK session after applying Instance A.
  Capture:
    - SessionRuntime connection fields (baseUrl, headers, region,
      apiLine, providerSpecificConfig, credential identity)
    - active providerConfig / handler factory output
    - secrets resolution trace (which secrets.json key was read)

Step 2 — SWITCH ATTEMPT
  Invoke the switch from Instance A to Instance B.
  Use the EXISTING live switch path (don't invent a new entry
  point; the foundation must characterize the existing one).
  Capture:
    - Which Seam (1 or 2) fired
    - Whether replaceActiveSession was called
    - Whether updateActiveSessionModel was called
    - What fields were mutated in SessionRuntime
    - Whether the credential lookup used providerId or instanceId

Step 3 — NEXT REQUEST READ
  Make the next model request.
  Capture:
    - The exact baseUrl the request was sent to
    - The exact credential used
    - The exact modelId
    - The effective connection state

Step 4 — ASSERTIONS
  For the switch to be valid:
    - request went to B's baseUrl, not A's (Q4 YES)
    - credential resolved through B's reference, not A's (Q5 YES)
    - modelId is whatever B says (not strictly required for this
      P0; the modelId question is Q-mech-3's territory)

Step 5 — OUTCOME FREEZE
  Map Q1–Q5 answers to A/B/C outcome.
  If outcome B: the foundation ACT authorizes an
  instance-change discriminator addition to the rebuild path.
  If outcome C: the foundation ACT authorizes a bounded
  runtime-switch extension.
  If outcome A (surprising): the foundation ACT simply
  documents that updateConnection already covers it.
```

## What this trace is NOT

```text
NOT a characterization test of the in-place same-provider
model switch (that is Q-mech-3 from P2 / evidence 11).

NOT a characterization of credential storage migration (that is
Q-mech-2's persistence seam question from P2 / evidence 10).

NOT a profile-UI question (profiles are an implementation ACT
concern; the foundation is profile-free).

NOT a test of the provider-change restart path with providerId
DIFFERENT (that is Seam 2 under the old domain; already known).
```

## Why this RED is the one that matters

Reviewer's framing, verbatim:

> "That is much stronger than testing 'provider changes.'"
>
> "Construct the real semantic case:
>   same providerId, different instanceId, different baseUrl,
>   different credential reference
> Then:
>   active = A, switch to B, next request effective config = B
> Pre-foundation this should either fail or prove that an
> existing seam already handles it."

The profile abstraction is meaningless without this RED. Any
implementation ACT that proceeds without it would build UI on a
runtime that cannot actually carry the model — exactly the
HALT_MODEL_PROFILE_CONTRACT_NOT_COHERENT problem the corrected
freeze closed at the product-contract level.

## Pre-flight: required production-side reads (foundation ACT scope)

The foundation ACT must read (NOT modify) these sources as part
of Step 1–Step 3:

```text
apps/vscode/src/sdk/cline-session-factory.ts
apps/vscode/src/sdk/SdkController.ts
apps/vscode/src/sdk/sdk-provider-change-coordinator.ts
apps/vscode/src/sdk/model-catalog/store.ts
apps/vscode/src/shared/storage/state-keys.ts
sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts
sdk/packages/core/src/types/provider-settings.ts
```

Plus any read site for `ProviderSettingsManager`,
`StoredProviderSettings.providers`, `secrets.json`, and the OAuth
storage layer that the foundation survey finds.

EVIDENCE CLASS = RED PLAN (mechanical; the foundation ACT
                  executes this and writes its own evidence).
                  This file is the recon blueprint; the
                  foundation ACT is the test executor.
