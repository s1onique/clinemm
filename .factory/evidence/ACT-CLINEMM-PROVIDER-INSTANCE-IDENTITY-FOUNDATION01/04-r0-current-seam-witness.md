# 04 — R0: current-seam characterization witness

Foundation ACT entry: pre-production-edit R0 witness per ACT body §10.
Recon date: foundation ACT entry.

This file freezes the three R0 measurements against HEAD's current seam
(commit `af1df4a60`). It is the **day-0 witness** the foundation ACT
cites as the baseline. Per reviewer's instruction: "These three
observations are exactly enough. Do not add more bookkeeping around R0."

R0 is a **characterization witness**, not a simulation of the future
ProviderConfigurationInstance abstraction. R0 measures what the seam
actually does today. The reviewer's prior was NO / NO / NO; this file
overrides the prior with evidence.

---

## 1. Setup (today's production concepts only)

```text
Provider configuration row A:
  providerId = "openai-compatible"
  baseUrl    = "http://localhost:11434/v1"
  apiKey     = "local-key"  (stored in openAiApiKey; also in
                              providers.json under "openai-compatible")
  modelId    = "qwen3-local"
  headers    = N/A (openai-compatible does not semantically use headers
                    for the Ollama case)

Provider configuration row B:
  providerId = "openai-compatible"   (SAME providerId)
  baseUrl    = "https://llm.corp.example/v1"
  apiKey     = "corp-key-xyz"
  modelId    = "qwen3-corp"
  headers    = { "X-Corp-Tenant": "engineering" }

Action (hypothetical user click on the picker):
  "switch from profile A to profile B"
```

**The picker itself does not exist today** (it's implementation ACT
scope). But the underlying action — "select the second
`openai-compatible` row" — can be simulated by writing the
B fields into the legacy `ApiConfiguration` slots, then observing what
the next request does.

No production edits performed here. R0 reads the code paths that
WOULD be invoked and characterizes their behavior. The witness is
derived from the source survey in evidence files 01, 02, 03.

---

## 2. The three measurements

### M1. CURRENT_SEAM_CAN_EXPRESS_INSTANCE_IDENTITY

**Question:** Can the current seam distinguish A and B as two
identities at the live session boundary?

**Answer:** **NO**.

**Evidence:**

1. `model-catalog/contracts.ts:33` defines `ProviderId = string &
   { readonly [ProviderIdBrand]: void }`. The only branded identity
   dimension is `ProviderId`. There is no `InstanceId`, no
   `ConfigurationId`, no second identity dimension.
2. `model-catalog/contracts.ts:92` defines `EffectiveProviderConfig`
   with `readonly providerId: ProviderId` as the only identity field.
3. `model-catalog/contracts.ts:371-373` defines `ProviderConfigReader`
   with `read(providerId: ProviderId): EffectiveProviderConfig`. The
   store is single-keyed by providerId.
4. `cline-session-factory.ts:369-410` (`PROVIDER_API_KEY_MAP`) maps
   each providerId to exactly ONE `keyof ApiConfiguration`. There is
   no slot for "openai-compatible instance A" vs "openai-compatible
   instance B".
5. `cline-session-factory.ts:676-693` (`resolveBaseUrl`'s `baseUrlMap`)
   has the same shape: one `keyof ApiConfiguration` per providerId.

**Consequence:** the seam cannot express `instanceA.providerId ==
instanceB.providerId && instanceA != instanceB` as a meaningful
distinction. The two rows collapse at every storage seam.

**Frozen R0 value:**

```text
CURRENT_SEAM_CAN_EXPRESS_INSTANCE_IDENTITY = NO
```

### M2. CURRENT_SEAM_MUTATES_FULL_CONNECTION

**Question:** When the user switches from A to B through the existing
path (i.e. writes the B fields into the legacy ApiConfiguration slots,
so `openAiBaseUrl` becomes `https://llm.corp.example/v1`,
`openAiApiKey` becomes `corp-key-xyz`, `actModeOpenAiModelId` becomes
`qwen3-corp`), does the next request's effective connection actually
reflect B?

**Answer:** **YES — but only at the resolution-of-NEXT-construction
boundary, and only for the fields that have a per-providerId slot**.

**Evidence:**

1. `sdk-api-handler.ts:64-90` (`buildSdkProviderConfig`) reads
   `providerId`, `apiKey`, `modelId`, `baseUrl` per-request from
   `resolveApiKey` / `resolveModelId` / `resolveBaseUrl`. Each of
   these resolves from the current `ApiConfiguration` snapshot at
   the time of handler construction.

2. There is no handler cache in `sdk-api-handler.ts` that pins the
   prior values; each call to `buildSdkProviderConfig` re-reads
   the latest `ApiConfiguration` from `stateManager`.

3. Therefore: if the user writes `openAiBaseUrl = B's baseUrl`,
   the next request's handler will be constructed with
   `baseUrl: "https://llm.corp.example/v1"`. Same for `apiKey`,
   `modelId`, and any other providerId-keyed field.

**Caveat (load-bearing):** the mutation happens because B overwrites
A in the SAME storage slot. There is no "both A and B exist and the
next request picks B" — only "A's value is GONE because B overwrote
it." This is a slot overwrite, not a true identity-bearing mutation.

**Consequence:** if the user later writes A's values back to switch
back to A, the slot is overwritten again and A's effective connection
returns. The seam does carry one of A or B at any time, but never
both simultaneously.

**For the R0 question:** the seam DOES mutate the next effective
connection (in the "write B, then read next request" sense), but
NOT in the identity-bearing sense (it cannot simultaneously carry
A and B). The reviewer's R0 question is the narrower one — "does
the next request reflect B?" — and the answer is YES.

**Frozen R0 value:**

```text
CURRENT_SEAM_MUTATES_FULL_CONNECTION = YES  (slot-overwrite semantics;
                                              not identity-bearing)
```

### M3. CURRENT_SEAM_REBUILDS_ON_CONFIG_IDENTITY

**Question:** Does the existing rebuild path fire when the user
switches from A to B (same providerId, different config)?

**Answer:** **NO**.

**Evidence:**

1. `sdk-provider-change-coordinator.ts:42-58` (`handleApiConfigurationChanged`):
   the rebuild discriminant is `previousProvider !== nextProvider`
   where `previousProvider = providerForMode(previous, mode)` and
   `nextProvider = providerForMode(next, mode)`. Both A and B have
   the same providerId `openai-compatible`; after
   `toLegacyApiProvider` canonicalization, the comparison returns
   equal. The rebuild is NOT requested.
2. `sdk-session-rebuild-scheduler.ts:9` lists the four rebuild
   reasons: `provider`, `mcpTools`, `terminalExecutionMode`,
   `sessionAutoApprovalOverride`. None of these fires on
   same-providerId config flip.
3. No other rebuild path was found in `sdk-session-rebuild-scheduler.ts`
   or any related seam. The single rebuild discriminator is
   providerId-only.

**Consequence:** switching from A to B through the existing path
does NOT trigger a session rebuild. The session continues with the
same handler. The next request is constructed by
`buildSdkProviderConfig`, which (per M2) re-reads the latest
`ApiConfiguration` and so picks up B's baseUrl / apiKey / modelId
— but the handler construction path itself is the SAME as for A;
no fresh handler-from-scratch is built in response to the flip.

**Frozen R0 value:**

```text
CURRENT_SEAM_REBUILDS_ON_CONFIG_IDENTITY = NO
```

---

## 3. R0 freeze (the day-0 witness table)

```text
Foundation ACT R0 witness (commit af1df4a60):

  CURRENT_SEAM_CAN_EXPRESS_INSTANCE_IDENTITY = NO
  CURRENT_SEAM_MUTATES_FULL_CONNECTION       = YES  (slot-overwrite;
                                                     not identity-bearing)
  CURRENT_SEAM_REBUILDS_ON_CONFIG_IDENTITY   = NO

Reviewer's prior (before evidence): NO / NO / NO.
Override: M2 flips from NO to YES, with the load-bearing caveat that
          the YES is slot-overwrite semantics, not identity-bearing
          semantics. M1 and M3 match the prior.
```

---

## 4. What R0 changes for the foundation ACT

The reviewer's prior was NO / NO / NO. The actual measurement is
NO / YES(slot-overwrite) / NO. The M2 surprise is significant and
shapes the §12 design freeze in two ways:

### 4a. The "minimal runtime switch mechanism" choice is bounded above

The foundation ACT does NOT need to invent a new runtime mechanism to
make the next request reflect the new config — `buildSdkProviderConfig`
already re-reads the latest `ApiConfiguration` on every handler
construction, and (in the absence of a handler cache) every handler
construction is effectively fresh.

What the foundation ACT DOES need to invent is the **identity
dimension**. Once the seam can express `{ providerId, instanceId }`
and bind an `instanceId` to an instance of providerId, the slot-
overwrite mechanism plus a per-instance storage layout produces a
true identity-bearing mutation.

### 4b. The rebuild discriminator extension is NOT the only question

Because M2 is YES (slot-overwrite already works), the foundation ACT
does not HAVE to extend the rebuild discriminator to fire on
instance-identity change to satisfy R1's primary assertion. R1's
primary assertion is on the EFFECTIVE CONNECTION, not on whether
the rebuild fired.

But: extending the rebuild discriminator is still likely the right
call for R1's outcome B (forced rebuild). The reasons are upstream
architectural, not correctness:

```text
- Same-provider instance may change endpoint + auth + headers +
  routing tier + provider-specific config + handler construction
  simultaneously. Each of these is a partial semantic value; if
  any one of them is read at handler construction and any other
  is read at request construction, the seam re-introduces the
  "partial semantic value flowing through several independently
  mutable stages" class that Factorize has been removing.
- The rebuild discriminator exists precisely to retire that class.
- Extending it from "providerId change" to "instanceId change"
  is a small surface extension with high consistency benefit.
```

The foundation ACT does not pre-commit to this. R0 just establishes
that the rebuild-discriminator extension is not load-bearing for R1's
correctness — only for R1's architectural hygiene.

---

## 5. What R0 does NOT establish

- R0 does NOT measure the in-flight safety invariant. That is R1's
  secondary assertion (no in-flight mutation). R0 is run without
  any in-flight request; R1 measures the assertion in the presence
  of one.
- R0 does NOT characterize the SDK's `ProviderSettingsManager` schema
  beyond what `resolveApiKey` exposes. The deeper schema inspection
  is part of step 7 of the epistemic sequence (persistence
  characterization), not R0.
- R0 does NOT propose α / β / γ. That is §12 design freeze, after
  the blast radius is now bounded by the M2 surprise (slot-overwrite
  works, so the foundation can lean on the existing handler-
  construction seam rather than introducing a fresh runtime).

---

## 6. Traceability hooks for R1

When §11 R1 runs, the assertion must reference this R0 file:

```text
R1 RED (evidence file to be written: 05-r1-red-instance-switch.md)
  MUST begin with:
    "R0 reference: 04-r0-current-seam-witness.md frozen on commit
     af1df4a60: M1=NO, M2=YES(slot-overwrite), M3=NO."
  R1 must NOT skip the R0 citation, per the R0 -> R1 ordering
  constraint in MP RECON evidence 13 v3.
```
