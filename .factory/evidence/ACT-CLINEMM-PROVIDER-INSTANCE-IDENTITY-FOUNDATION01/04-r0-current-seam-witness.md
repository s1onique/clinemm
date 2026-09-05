# 04 — R0: current-seam characterization witness

Foundation ACT entry: pre-production-edit R0 witness per ACT body §10.
Recon date: foundation ACT entry.

## AMENDMENT_NOTICE (v2 — 2026-09-05 fifth-reviewer verdict HALT_R0_FULL_CONNECTION_NOT_PROVEN)

This evidence file was authored with a scalar M2:

```text
ORIGINAL (entry commit 40bdeeac2, SUPERSEDED):
  CURRENT_SEAM_MUTATES_FULL_CONNECTION = YES (slot-overwrite)
```

The fifth reviewer flagged this as an overclaim — the source evidence
supports only the narrower `CURRENT_SEAM_OVERWRITES_AND_RERESOLVES_
PROVIDER_SLOTS = YES for at least baseUrl, credentialValue, modelId`,
not the broader R1 effective-connection tuple. Per reviewer verdict
HALT_R0_FULL_CONNECTION_NOT_PROVEN, the corrected R0 replaces the
scalar with a per-component matrix (see §3 below).

```text
CORRECTED (this commit; aligned with foundation ACT body §10 v2):
  CURRENT_SEAM_CAN_EXPRESS_INSTANCE_IDENTITY  = NO
  CURRENT_SEAM_RERESOLVES_CONNECTION_COMPONENTS =
    providerId              = SAME
    baseUrl                 = YES
    credentialValue         = YES
    modelId                 = YES
    headers                 = NOT_PROVEN
    providerSpecificConfig  = NOT_PROVEN
    apiLine / routing       = NOT_PROVEN
    region                  = NOT_PROVEN
  CURRENT_SEAM_MUTATES_FULL_CONNECTION       = NOT_PROVEN
  CURRENT_SEAM_REBUILDS_ON_CONFIG_IDENTITY   = NO
  R0_EVIDENCE                                = STRUCTURAL
  R0_EXECUTED_SWITCH                         = NOT_EXECUTED
```

The four NOT_PROVEN operands must be traced to per-component YES/NO/N/A
verdicts in the FOUNDATION_RECON_PHASE before §12 design freeze; that
trace work produces a new evidence file `05-r0-remaining-operand-
trace.md` (NOT authored in this commit; per reviewer's "DO NOT" list,
this commit does not start R1, choose alpha/beta/gamma, add persistence,
or open another review cycle).

The M1 and M3 measurements from the entry commit are unchanged. The
new M2 derivation is honest: three operands are proven YES (slot-
overwrite + fresh-read construction seam), four are NOT_PROVEN; the
scalar YES was an overclaim; the correct derivation is NOT_PROVEN
until the four NOT_PROVEN operands trace.

See §3 (corrected freeze) and §4 (corrected "what R0 changes for §12")
below. The remaining sections are unchanged from the entry commit.


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

## 3. R0 freeze (the day-0 witness table) — CORRECTED v2

```text
Foundation ACT R0 witness (commit af1df4a60; CORRECTED 2026-09-05
per fifth-reviewer verdict HALT_R0_FULL_CONNECTION_NOT_PROVEN):

  CURRENT_SEAM_CAN_EXPRESS_INSTANCE_IDENTITY  = NO

  CURRENT_SEAM_RERESOLVES_CONNECTION_COMPONENTS =
    providerId              = SAME    (trivially; A and B share providerId)
    baseUrl                 = YES     (resolveBaseUrl re-reads on every
                                       handler construction; slot overwrite
                                       transport works; see §2 M2 evidence)
    credentialValue         = YES     (resolveApiKey re-reads on every
                                       handler construction; same slot
                                       overwrite transport; with the caveat
                                       that the credential identity
                                       dimension collapses to providerId
                                       so two same-provider instances
                                       cannot coexist - this is the
                                       SAME_PROVIDER_MULTI_CREDENTIAL_
                                       IDENTITY_NOT_BOUND finding MP RECON
                                       P3 named, which §12 must close)
    modelId                 = YES     (resolveModelId re-reads on every
                                       handler construction; same transport)
    headers                 = NOT_PROVEN
                                       (foundation must trace where
                                       headers live at handler
                                       construction time; owned by
                                       FOUNDATION_RECON_PHASE before §12;
                                       evidence 05-r0-remaining-operand-
                                       trace.md, new file)
    providerSpecificConfig  = NOT_PROVEN
                                       (same status as headers; for
                                       Bedrock/Vertex/GCP includes
                                       region + structured AWS/GCP config
                                       blocks per sdk-api-handler.ts)
    apiLine / routing       = NOT_PROVEN
                                       (apiLine is providerId-specific;
                                       foundation confirms whether it is
                                       or isn't a per-instance operand;
                                       if no provider uses it today: N/A)
    region                  = NOT_PROVEN
                                       (Bedrock/Vertex/GCP carry region;
                                       foundation traces per provider)

  CURRENT_SEAM_MUTATES_FULL_CONNECTION       = NOT_PROVEN
                                       (honest derivation; because
                                        headers, providerSpecificConfig,
                                        apiLine/routing, region are all
                                        NOT_PROVEN, the scalar YES that
                                        the entry commit recorded was an
                                        overclaim; becomes YES iff every
                                        provider-relevant component is YES
                                        or N/A)

  CURRENT_SEAM_REBUILDS_ON_CONFIG_IDENTITY   = NO

  R0_EVIDENCE                                = STRUCTURAL
  R0_EXECUTED_SWITCH                         = NOT_EXECUTED

Reviewer's prior (before evidence, from the foundation ACT body's
MP RECON §6): NO / NO / NO.
Entry commit (v1, SUPERSEDED): NO / YES(slot-overwrite) / NO.
v2 (this commit, CORRECTED):     NO / component-matrix / NO with
                                  MUTATES_FULL_CONNECTION = NOT_PROVEN
                                  and R0_EVIDENCE = STRUCTURAL,
                                  R0_EXECUTED_SWITCH = NOT_EXECUTED.
```

**NOT_PROVEN is a first-class R0 result.** It is NOT a failure of R0;
it is R0 working correctly by not overclaiming. The four NOT_PROVEN
operands (headers, providerSpecificConfig, apiLine/routing, region)
must be traced to per-component YES/NO/N/A verdicts in the
FOUNDATION_RECON_PHASE before §12 design freeze; this trace work is
recon (no production edits) and produces evidence file
`05-r0-remaining-operand-trace.md` (new, NOT authored in this commit
per reviewer's DO NOT list).


---

## 4. What R0 changes for the foundation ACT — CORRECTED v2

The reviewer's prior was NO / NO / NO. The entry commit measured
NO / YES(slot-overwrite) / NO (the v1 scalar overclaim). The corrected
measurement is NO / component-matrix / NO with MUTATES_FULL_CONNECTION
honestly derived as NOT_PROVEN.

### 4a. Three operands proven YES — but ONLY three

baseUrl, credentialValue, and modelId each trace to the slot-overwrite
+ fresh-read construction seam in `buildSdkProviderConfig`. Writing B's
value into the per-providerId slot causes the next handler construction
to read B's value. This is a real, verifiable, structural property of
the seam.

But this covers only three of the seven operands in the R1 effective-
connection tuple. The remaining four (headers, providerSpecificConfig,
apiLine/routing, region) are NOT_PROVEN at R0. The entry commit's v1
conclusion that "the foundation does not need to invent a new runtime
mechanism … only the identity dimension" is therefore **premature**.

### 4b. The §12 design freeze is the discriminator — R0 does NOT pre-commit

Per the reviewer's correction, §12 is the place that picks Outcome A
(reuse updateConnection), Outcome B (forced rebuild), or Outcome C
(bounded runtime switch extension). The choice depends on what the
four NOT_PROVEN operands trace to:

```text
- If all four trace to N/A (no provider uses them) or to the same
  slot-overwrite + fresh-read construction seam, then Outcome A/C is
  genuinely cheaper than the entry commit implied. The foundation
  can lean on the existing handler-construction seam; the identity
  dimension is the only missing piece. §12 favors Outcome A
  (reuse updateConnection parameterized by the full instance tuple)
  or Outcome C (bounded runtime switch).

- If any of the four traces to NO (read elsewhere - cached on a
  long-lived provider object, resolved once per session, etc. - and
  not refreshed by the slot-overwrite + fresh-read seam), then
  Outcome B (forced rebuild on instance-identity change) becomes
  causally justified. It is not merely architectural hygiene; it is
  the only mechanism that guarantees the next request's effective
  tuple refreshes that operand.

R0 does NOT pick. The trace work for the four NOT_PROVEN operands
(evidence 05-r0-remaining-operand-trace.md, new, authored in
FOUNDATION_RECON_PHASE) is the discriminator. §12 design freeze
consumes the trace. R1 RED consumes §12.
```

### 4c. Why NOT_PROVEN is the honest answer (and not "NO" or "YES")

The M2 scalar was derived from source tracing of three fields. The R1
effective-connection tuple includes seven. The three that were traced
cover the slot-overwrite path; the four that were not cannot honestly
be claimed YES, NO, or N/A without further source tracing.

Calling them NO would overclaim that the seam fails to transport them.
Calling them YES would overclaim that the slot-overwrite + fresh-read
seam covers them. N/A would overclaim that no provider uses them.
None of these is honest without the trace.

NOT_PROVEN is a first-class result. R0 v1 conflated "not yet proven"
with "the seam demonstrably works" because the three fields it traced
were the easiest ones to trace, and because the next question (does
R1 need a fresh runtime?) is more naturally framed in binary terms.
The corrected R0 separates the two: three fields are proven YES at
R0; four are NOT_PROVEN at R0; MUTATES_FULL_CONNECTION is the derived
honest answer.

### 4d. The rebuild discriminator remains unchanged at NO (M3)

The rebuild discriminator is providerId-only. M3 stays NO. The question
of whether to EXTEND the rebuild discriminator from "providerId change"
to "instance-identity change" is part of §12 design freeze, gated on
the trace work in 4b above. If any of the four NOT_PROVEN operands
traces to NO, the rebuild-discriminator extension becomes the natural
fix. If they all trace to YES/N/A, Outcome A/C handles them and the
rebuild discriminator need not be extended.

The foundation ACT does not pre-commit.

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

When §11 R1 runs (gated on §12 design freeze + this corrected R0 +
the four NOT_PROVEN operands traced via evidence 05), the R1
assertion must reference this R0 file:

```text
R1 RED (evidence file to be written in FOUNDATION_IMPLEMENTATION_PHASE)
  MUST begin with:
    "R0 reference: 04-r0-current-seam-witness.md (v2) frozen on
     commit af1df4a60 (foundation entry) and corrected on commit
     <this commit> (foundation P1-CORRECTION01):
       CURRENT_SEAM_CAN_EXPRESS_INSTANCE_IDENTITY    = NO
       CURRENT_SEAM_RERESOLVES_CONNECTION_COMPONENTS =
         baseUrl / credentialValue / modelId = YES (slot-overwrite)
         headers / providerSpecificConfig / apiLine/routing /
           region                            = NOT_PROVEN
         (full classification frozen in evidence 05-r0-remaining-
          operand-trace.md before R1)
       CURRENT_SEAM_MUTATES_FULL_CONNECTION         = NOT_PROVEN (v2)
                                                       YES iff every
                                                       provider-relevant
                                                       component is
                                                       YES or N/A
       CURRENT_SEAM_REBUILDS_ON_CONFIG_IDENTITY     = NO
       R0_EVIDENCE                                  = STRUCTURAL
       R0_EXECUTED_SWITCH                           = NOT_EXECUTED
     §12 design freeze: <as recorded in evidence 06-design-freeze.md>"

  R1 must NOT skip the R0 citation, per the R0 -> R1 ordering
  constraint in MP RECON evidence 13 v3.
```
