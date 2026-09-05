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

## Two-stage RED (foundation ACT execution contract)

> **v3 amendment (2026-09-05 third-reviewer verdict PASS_WITH_ONE_BOUNDED_P1):**
> The single-stage RED that lived here through v2 was one abstraction
> level too high. At foundation entry, `ProviderConfigurationInstance`
> does not yet exist as a production concept, so there is literally
> no production action that means `switch(instanceA -> instanceB)`.
> Using the current selection path with `providerId A == providerId B`
> can prove today's path cannot express instance identity, but cannot
> by itself prove the eventual implementation must be Outcome B
> rather than A/C.
>
> **Split into R0 + R1.** R0 is the current-seam characterization
> witness (runs BEFORE any production edits; measures three concrete
> properties of today's path under the real product case). R1 is the
> post-identity semantic RED (runs AFTER the instance abstraction has
> a test-local candidate representation OR the minimal production
> seam needed to express it; primary assertion is the
> `NEXT_EFFECTIVE_CONNECTION` effective-configuration tuple, NOT
> "was restart called").
>
> The original five-question plan (Q1 detection / Q2 rebuild /
> Q3 mutation trace / Q4 request routing / Q5 credential resolution)
> lives under R1 below; the R0 metrics are new and run first.

The literal product case (same providerId, different instanceId,
different connection-bearing configuration) — used in both R0 and R1:

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


### R0 — current-seam characterization witness (BEFORE production edits)

**Purpose:** establish, before the foundation introduces the instance
abstraction, that today's seam truly cannot carry same-provider
different-instance switches. Without R0, a future reader of the recon
evidence will not be able to tell whether R1's failure (if any) is due
to a bad implementation or because the underlying seam genuinely
never carried instance switches.

**Setup (today's production concepts only — no `ProviderConfiguration-
Instance` yet):**

```text
apiConfig A:
  providerId  = openai-compatible
  baseUrl     = http://localhost:11434/v1
  apiKey      = (entry keyed by providerId; value "keyA")
  apiLine     = openai

apiConfig B:
  providerId  = openai-compatible
  baseUrl     = https://corp-gateway.internal/v1
  apiKey      = (entry keyed by providerId; value "keyB")
  apiLine     = openai
```

**Action:** attempt to switch from A to B through the existing
provider/model selection machinery (no new code; no instance
abstraction yet).

**Measure (FREEZE these; evidence decides):**

```text
CURRENT_SEAM_CAN_EXPRESS_INSTANCE_IDENTITY = YES | NO
  Does today's selection path even allow expressing that A and B
  are different configurations of the same provider? (Most likely
  answer today: NO; today's path is keyed by providerId, and two
  apiConfigs with the same providerId would be one record, not two.
  The R0 witness's job is to freeze that fact.)

CURRENT_SEAM_MUTATES_FULL_CONNECTION       = YES | NO
  When the path is forced to swap (e.g. by editing apiConfigs and
  triggering a session reconnect), does it actually mutate the full
  connection tuple (endpoint + credentials + headers + providerSpecific-
  Config) or just one field?

CURRENT_SEAM_REBUILDS_ON_CONFIG_IDENTITY   = YES | NO
  Does the path detect that the underlying configuration identity
  changed (even if expressed as a single providerId key today) and
  rebuild the connection? Or does it leave stale state in place?
```

**Prior (reviewer): NO / NO / NO. Evidence decides.**

**Output:** a frozen R0 table in the foundation ACT's evidence that
downstream readers can cite as "this is what the seam was on day 0,
before the instance abstraction was introduced". Without R0, R1's
failure modes are unactionable.

### R1 — post-identity semantic RED (AFTER instance abstraction exists)

**Purpose:** prove that under the chosen implementation outcome, the
next request after a same-providerId instance switch resolves to
**exactly B's effective configuration tuple**, not a partial / mixed /
A-leftover tuple.

**Setup (now that `ProviderConfigurationInstance` exists, either as
a test-local candidate representation or as the minimal production
seam):**

```text
Instance A:
  providerId                = openai-compatible
  endpoint / baseUrl        = http://localhost:11434/v1
  apiLine / family          = openai
  credential identity       = (secretsKey A)
  headers                   = { ...A... }
  providerSpecificConfig    = { ...A... }
  region                    = (none / local)

Instance B:
  providerId                = openai-compatible
  endpoint / baseUrl        = https://corp-gateway.internal/v1
  apiLine / family          = openai
  credential identity       = (secretsKey B)
  headers                   = { ...B... }
  providerSpecificConfig    = { ...B... }
  region                    = (us-east-1)

bind A
switch to B
observe the next request
```

**Primary assertion (effective configuration tuple — NOT "was restart
called"):**

```text
NEXT_EFFECTIVE_CONNECTION = {
  providerId:                B.providerId,                 // P
  baseUrl:                   B.baseUrl,                    // B
  credentialIdentity:        B.credentialIdentity,         // B
  headers / providerSpecificConfig: B.headers,
                                  B.providerSpecificConfig, // B
  modelId:                   B.modelId                     // B
}

i.e. EVERY component of the effective tuple must equal B's.
If any component equals A's (or anything other than B's), the
instance switch did NOT happen; the implementation must change.
```

The primary assertion is what distinguishes A / B / C at execution
time:

```text
Outcome A (reuse updateConnection):
  Passes R1 iff updateConnection is parameterized by the FULL
  instance tuple (not just modelId). If today's updateConnection
  is hardcoded to modelId-only, A fails and the foundation falls
  back to B.

Outcome B (forced-rebuild discriminator):
  Passes R1 iff the existing Seam 2 rebuild path actually rebuilds
  connection + credentials + headers + providerSpecificConfig when
  it fires (today it does for providerId changes; foundation must
  verify it does for instance identity changes too). The
  discriminator is "instance identity changed" — independent of
  providerId equality.

Outcome C (bounded runtime-switch extension):
  Passes R1 iff a new minimal seam rewires endpoint + credential +
  headers WITHOUT a full session restart, AND the in-flight request
  invariant (SWITCH_DURING_INFLIGHT_MODEL_REQUEST = RESTRICT_UNTIL_
  IDLE) holds without exception. Reviewer's prior probability for
  the foundation picking C is LOW.
```

**Secondary assertion (for Outcome C discriminator):**

```text
NO mutation of an in-flight request was required to satisfy
NEXT_EFFECTIVE_CONNECTION == B's tuple.
```

If a candidate implementation mutates an in-flight request to make
R1 pass, it has violated `SWITCH_DURING_INFLIGHT_MODEL_REQUEST =
RESTRICT_UNTIL_IDLE` and must be rejected.

If all five hypotheses (Q1–Q5) hold under R1's measurement of the
candidate implementation (the likely outcome), the existing seam
cannot carry profile-instance switching. The foundation ACT must
then choose one of three outcomes:

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


### R0 → R1 ordering constraint

```text
STRICT ORDER:
  R0 runs first, freezes CURRENT_SEAM_CAN_EXPRESS_INSTANCE_IDENTITY
  / CURRENT_SEAM_MUTATES_FULL_CONNECTION / CURRENT_SEAM_REBUILDS_ON_
  CONFIG_IDENTITY, and is cited as the "before" measurement.
  THEN the foundation may introduce the instance abstraction.
  THEN R1 runs with the NEXT_EFFECTIVE_CONNECTION primary
  assertion.

  Skipping R0 is forbidden: a future reviewer cannot tell whether
  R1's failure (if any) is due to a bad implementation or due to
  the seam genuinely never having carried instance switches. The
  R0 witness is what makes the R1 outcome interpretable.
```
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
