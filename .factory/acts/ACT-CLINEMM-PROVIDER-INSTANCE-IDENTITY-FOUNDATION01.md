# ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01 — Foundation recon (entry)

> **Entry identity (auto-recorded by §0 preflight):**
>
> ```text
> ACT_ID            = ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01
> ENTRY_HEAD        = af1df4a60b73e98190ce5bb1207d7ea1153a61a9
> PREDECESSORS      = ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-RECON01
>                     ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-RECON01-P2-CORRECTION01
> PREDECESSOR_STATE = MP RECON correction cycle CLOSED (P4 PASS_WITH_ONE_BOUNDED_P1)
>                     FOUNDATION_ACT = AUTHORIZED (full; scope per §7.3 of correction)
> F4                = DOES_NOT_EXIST  (Factorize chain terminates by F3 falsification)
> BRANCH            = main
> PROD_EDITS        = FORBIDDEN  (this ACT is recon-only)
> TESTS             = R0 = characterization witness (no RED); R1 = RED;
>                     GREEN = minimum change only
> ```
>
> ```text
> P1_correction01_pointer (amended 2026-09-05 fifth-reviewer verdict):
>   The fifth reviewer on the foundation entry commit issued verdict
>   HALT_R0_FULL_CONNECTION_NOT_PROVEN. Two bounded corrections folded
>   into this commit (per reviewer: "Fold it into the same bounded R0
>   correction. This is P1, not another architecture cycle."):
>
>     P0  R0_FULL_CONNECTION_OVERCLAIM
>         Entry commit froze M2 as CURRENT_SEAM_MUTATES_FULL_CONNECTION
>         = YES but the source evidence supports only the narrower
>         CURRENT_SEAM_OVERWRITES_AND_RERESOLVES_PROVIDER_SLOTS = YES
>         for at least baseUrl, credentialValue, modelId. R0 replaced
>         with a per-component matrix (see §10 amended); four operands
>         (headers, providerSpecificConfig, apiLine/routing, region)
>         are NOT_PROVEN at R0 and must be traced to YES/NO/N/A in
>         FOUNDATION_RECON_PHASE before §12 design freeze. R0_EVIDENCE
>         = STRUCTURAL and R0_EXECUTED_SWITCH = NOT_EXECUTED are
>         labeled explicitly.
>
>     P1  FOUNDATION_ACT_PHASE_CONTRACT_INCONSISTENT
>         Entry preamble said "PROD_EDITS = FORBIDDEN; this ACT is
>         recon-only" but the same ACT body specified R1 RED -> GREEN
>         -> CONSERVATION (production edits in the same ACT). Resolved
>         with a two-phase split per the reviewer's exact phrasing:
>
>           FOUNDATION_RECON_PHASE       (§0..§12; prod edits FORBIDDEN)
>           FOUNDATION_IMPLEMENTATION_PHASE
>                                        (§13..§15; prod edits AUTHORIZED
>                                         ONLY after R0 + §12 + genuine
>                                         R1 RED)
>           FOUNDATION_FINAL_REPORT_AND_HANDOFF
>                                        (§16, §17, §35, STOP; report +
>                                         handoff only)
>           MODEL_PROFILES_IMPLEMENTATION = separate ACT, NOT_AUTHORIZED,
>           gated on §17 four-gate handoff.
>
>   Bounded P1-CORRECTION01 lives at:
>     .factory/acts/ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01-P1-CORRECTION01.md
>
>   This ACT body is recon-only IN ITS RECON PHASE. The recon phase
>   produces R0 + §12 design freeze. Only after both are frozen does
>   the implementation phase open (R1 RED -> GREEN -> CONSERVATION;
>   in the same ACT body, in a different phase, with production edits
>   AUTHORIZED under the phase-split contract). What remains in a
>   "subsequent ACT" is MODEL_PROFILES_IMPLEMENTATION, gated on §17.
>
> PRIMARY_EPISTEMIC_PURPOSE =
>   Establish a durable provider-instance identity and prove that same-providerId
>   instance switching reaches the next request's complete effective connection
>   without secret duplication.
>
>   This is the foundation ACT the MP recon correction cycle CLOSED for.
>   It is bounded by §7.3 of the MP correction ACT body and by the reviewer's
>   epistemic sequence (RECON -> R0 -> DESIGN FREEZE -> R1 RED -> GREEN ->
>   CONSERVATION -> PERSISTENCE -> STOP). Persistence authority is intentionally
>   deferred until R1 has been proven with an injected/test-local registry.
>
> SCOPE_FIREWALL =
>   Does NOT own ModelProfile, profiles.json, activeProfileId, defaultProfileId,
>   profile CRUD, footer picker, Settings UI, migration of profile state, favorites,
>   context-window bug, WAITING_WITHOUT_WAKE_SOURCE. These are explicitly assigned
>   to ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01 (still NOT
>   authorized; gated on this ACT's closure + R0/R1 results).
>
> FACTORY_REFERENCE_NOTE =
>   The four-reviewer chain that produced this authorization is preserved:
>     F3 / F3B (Factorize) -> bfa2ad5929aa4f9f1a1bbff58bde2c144c68157e
>     MP RECON open        -> b55407d03
>     MP RECON P1 wording  -> 97f49582e
>     MP RECON P2 corr     -> 830be436d
>     MP RECON P3 corr     -> 951f171e0
>     MP RECON P4 corr     -> af1df4a60  (this ACT opens at this commit)
>
>   This ACT body is recon-only. Production edits are FORBIDDEN in this ACT;
>   any production change must be authored in a subsequent implementation ACT
>   that consumes the design freeze (§12) and the R1 result (§11).
> ```

---

## §0 — Identity

```text
ACT_ID =
  ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01

PREDECESSORS =
  ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-RECON01
  ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-RECON01-P2-CORRECTION01

PREDECESSOR_STATUS =
  MP RECON correction cycle CLOSED (P4 PASS_WITH_ONE_BOUNDED_P1)
  FOUNDATION_ACT = AUTHORIZED (full; scope per §7.3 of P2 correction ACT body)
  MP IMPLEMENTATION ACT = NOT AUTHORIZED
  F4 = DOES_NOT_EXIST

EXPECTED_ENTRY_HEAD =
  af1df4a60b73e98190ce5bb1207d7ea1153a61a9

ENTRY_HEAD =
  discover at runtime; do not assume

BRANCH =
  main
```

Preflight:

```bash
git rev-parse --show-toplevel
git rev-parse HEAD
git branch --show-current
git status --porcelain=v1 --untracked-files=all
git stash list
git diff --check
```

Record actual identity.

Unexpected tracked dirt:

```text
HALT_UNEXPECTED_TRACKED_DIRT
```

Do not touch inherited Factory P2 residue (the MP correction cycle's commit chain
must remain intact under this ACT's ancestor chain).

---

# §1 — Primary epistemic purpose

```text
What does "switching from one configured instance of provider P to another configured
instance of provider P" actually mean to the next LLM request, and what minimal
authority must exist so that this switch is mechanically real, observable, and
non-duplicating of secrets?
```

Today, provider configurations are stored keyed by `providerId` (sometimes with a
secondary `id` slug per configured row). Two configurations of the same provider
type — for example two OpenAI-compatible providers, one pointing at a local
`http://localhost:11434/v1` with key "local-key" and one pointing at a corporate
`https://llm.corp.example/v1` with key "corp-key" — share the same `providerId`
namespace. The identity dimension that distinguishes them today is the per-row
storage id (e.g. `apiConfig.<id>` in global state), NOT a first-class
`ProviderConfigurationInstance` concept.

The foundation ACT must establish:

```text
1. Whether the current seam can EXPRESS instance identity at all (R0 witness).
2. Whether the current seam can MUTATE the full connection when identity changes.
3. Whether the current seam REBUILDS on identity-bearing config change.
4. The semantic scope of credential identity (NOT physical secret-key encoding).
5. A minimal runtime instance-switch seam that, with a frozen R0 blast radius,
   closes (1)–(3) without raw-secret duplication.
6. A conservation proof that existing providerId-only users keep working.
7. A characterization (NOT a binding) of the per-session instance-binding seam.
```

Persistence authority — the question "where do instance definitions live in durable
storage?" — is intentionally NOT answered by this ACT until step 5 has been
demonstrated with an injected/test-local registry per the reviewer's epistemic
sequence ("do not implement persistence merely because the ACT is called
'foundation'").

---

# §2 — Frozen foundation question

The primary question is:

> **Can the live session boundary distinguish two configurations of the same
> providerId as two identities, and can a switch between them rewrite the next
> request's complete effective connection without secret duplication?**

This decomposes into the three R0 measurements (§10) and the R1 assertion (§11):

```text
R0 (current-seam characterization witness; runs BEFORE production edits):
  CURRENT_SEAM_CAN_EXPRESS_INSTANCE_IDENTITY = YES | NO
  CURRENT_SEAM_MUTATES_FULL_CONNECTION       = YES | NO
  CURRENT_SEAM_REBUILDS_ON_CONFIG_IDENTITY   = YES | NO

R1 (post-identity semantic RED; runs AFTER the instance abstraction exists):
  NEXT_EFFECTIVE_CONNECTION == B's provider-relevant effective tuple
  where B is the target instance and the tuple spans at least
  { providerId, baseUrl/endpoint, credentialIdentity, headers,
    providerSpecificConfig, modelId }
  with provider-irrelevant fields represented as N/A, not undefined
```

The foundation is "durable" only when (R0 frozen) ∧ (R1 assertion holds end-to-end)
∧ (no raw-secret duplication) ∧ (existing providerId-only behavior unchanged).

---

# §3 — Terminology freeze

Use these terms precisely throughout this ACT body and its evidence.

### `Provider Configuration`

The existing concept: a persisted row keyed by a storage id (e.g. an `apiConfig.*`
entry in global state, or a record in the SDK model-catalog store) that holds the
fields a provider needs to construct a request: `providerId`, `baseUrl`,
`apiKey` / credential reference, `headers`, provider-specific config blob,
`modelId`, plus reasoning / context-window overrides.

### `ProviderConfigurationInstance` (target)

A first-class identity in the seam that bundles a Provider Configuration with an
explicit `instanceId`, so that two configurations of the same `providerId` are
distinguishable as two identities. The instance owns the **semantic** credential
identity; the physical secret-key encoding is separate (see §5).

### `Instance Identity`

The irreducible triple `{ providerId, instanceId }` — sufficient to address a
provider configuration uniquely within the seam. NOT `{ providerId, modelId }`
(the current seam's identity dimension for model switching); NOT `{ providerId,
apiKey-hash }` (collapses under same-credential-same-provider).

### `Credential Identity`

The **semantic** identity that distinguishes which credential is in use for a
given provider configuration. Belongs to the instance, not the provider. The
**physical** encoding (how this identity maps to a secret store key) is a separate
question (§5).

### `Effective Connection` (for R1)

The complete per-request tuple the seam hands to the LLM provider. Spans at
least:

```text
providerId
baseUrl / endpoint
credentialIdentity
headers
providerSpecificConfig
modelId
```

Where a provider does not semantically use one of these fields, the slot is `N/A`
in R1's comparison — the assertion compares the provider-relevant effective tuple,
NOT a mechanically-uniform schema. The reviewer's P2 non-blocking correction
applied this to evidence 12 v3 wording and applies here to R1's primary assertion
shape.

### `Forced Rebuild` (Outcome B of R1)

The mechanism of dropping the live API handler and constructing a new one when
the identity-bearing config changes. Reviewer's prior probability for the
foundation picking this path is HIGH (the existing rebuild path for provider
identity changes is well-understood; same-provider instance may change endpoint
+ auth + headers + routing tier + provider-specific config + handler construction
simultaneously, which makes hot-patching the entire tuple risky).

### `In-place Mutation` (Outcome C of R1, least likely)

The mechanism of mutating the live connection's fields in place without a
handler rebuild. Passes R1 only if `NEXT_EFFECTIVE_CONNECTION == B` holds AND no
in-flight request was mutated to satisfy the assertion. Reviewer's prior: LOW.

---

# §4 — Scope firewall (Owns / Does NOT own)

```text
OWNS:
  ProviderConfigurationInstance schema (one of α / β / γ; pick from
                                       measured blast radius, not prior)
  Semantic credential identity scope (the namespace binding; see §5)
  Runtime instance-switch behavior (R0 + R1 obligations)
  Per-session metadata seam FOR INSTANCE BINDING ONLY
    (characterization, NOT binding of where it lives in durable storage
     until R1 has been proven with an injected/test-local registry)

DOES NOT OWN:
  ModelProfile schema (implementation ACT)
  profiles.json / Profile CRUD (implementation ACT)
  defaultProfileId (global default; implementation ACT)
  activeProfileId profile semantics (implementation ACT)
  Picker UI (footer; implementation ACT)
  "Set as default" UI (implementation ACT)
  Settings "Manage Profiles" UI (implementation ACT)
  Migration of profile state (implementation ACT)
  Favorites (separate feature; not gated by this ACT)
  Context-window bug  (already separately registered as
                       ACT-CLINEMM-EFFECTIVE-MODEL-CONTEXT-WINDOW-AUTHORITY-RECON01)
  WAITING_WITHOUT_WAKE_SOURCE  (already separately registered as
                                ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-ASYNC-JOB-WAKE-OWNERSHIP-RECON01)
```

The foundation ACT opens gates for the implementation ACT only when:

```text
GATE_1:  R0 measurements frozen and cited
GATE_2:  R1 NEXT_EFFECTIVE_CONNECTION assertion holds end-to-end
GATE_3:  PROFILE_CONTAINS_RAW_SECRET = NO (no secret material in any new file)
GATE_4:  Existing providerId-keyed read sites keep working (backward compat)
GATE_5:  Conservation proof for providerId-only users (no behavior regression)
```

If any gate fails, this ACT HALts (see §15).

### Foundation ACT phases (reviewer's P1 fix; added in P1-CORRECTION01)

This ACT body has TWO PHASES, not one "recon-only" body followed by a
separate implementation ACT. The phase split resolves the entry-commit
lifecycle inconsistency (the entry preamble said "recon-only" but the
same ACT body specified R1 RED -> GREEN -> CONSERVATION as in-ACT work).

```text
FOUNDATION_RECON_PHASE =
  scope:
    §0..§12 of this ACT body (entry, primary epistemic purpose,
    frozen question, terminology, scope firewall, semantic-vs-
    physical credential identity, epistemic sequence, the three
    recon streams, R0 component matrix, R1 contract definition,
    design freeze)
  production edits: FORBIDDEN
  outputs:
    R0 frozen (component matrix; honest MUTATES_FULL_CONNECTION;
               R0_EVIDENCE = STRUCTURAL; R0_EXECUTED_SWITCH =
               NOT_EXECUTED; NOT_PROVEN operands traced to
               YES/NO/N/A verdicts via evidence 05-r0-remaining-
               operand-trace.md)
    §12 design freeze (alpha/beta/gamma + semantic credential
                        identity + physical secret-key encoding)
  output evidence files:
    00-preflight.txt
    01-connection-authority.md
    02-credential-storage-authority.md
    03-rebuild-discriminator.md
    04-r0-current-seam-witness.md
    05-r0-remaining-operand-trace.md    (NEW; produced in
                                         FOUNDATION_RECON_PHASE before
                                         §12 design freeze)
    06-design-freeze.md                 (renumbered from earlier 05;
                                         produced as part of §12 freeze)
  gating into FOUNDATION_IMPLEMENTATION_PHASE:
    R0 frozen (component matrix complete; every operand YES/NO/N/A)
    AND §12 design freeze recorded
    AND no halt conditions triggered (§15)

FOUNDATION_IMPLEMENTATION_PHASE =
  scope:
    §13..§15 of this ACT body (GREEN, conservation, halt conditions)
  production edits: AUTHORIZED ONLY AFTER
                      R0 frozen (component matrix complete) AND
                      §12 design freeze recorded AND
                      a genuine R1 RED (with NEXT_EFFECTIVE_CONNECTION
                                        assertion running against an
                                        injected/test-local registry;
                                        not against production code)
  outputs:
    GREEN (minimum change only; smallest set of production seams
                              that satisfies R1)
    CONSERVATION (existing providerId-only users unchanged)
  output evidence files:
    07-green-minimum-change.md
    08-conservation.md

FOUNDATION_FINAL_REPORT_AND_HANDOFF =
  scope:
    §16 evidence directory plan, §17 implementation ACT gates,
    §35 successor linkage, STOP
  production edits: none further; this is a report + handoff
  outputs:
    09-final-report.md  (the terminal freeze)
    §17 four-gate handoff to MODEL_PROFILES_IMPLEMENTATION

MODEL_PROFILES_IMPLEMENTATION =
  ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01
  remains separate and NOT_AUTHORIZED, gated on §17 four-gate handoff
  (reframed in §17 below to gate phase 2 -> MP_IMPLEMENTATION, not the
   foundation ACT's own closure)
```

If any gate fails, this ACT HALts (see §15).

---

# §5 — Semantic vs physical credential identity (reviewer's P2 non-blocking)

Per the reviewer's verdict on the P4 correction, the credential identity scope
must keep **semantic ownership** separate from **physical secret-key encoding**.
This ACT's body entry phrases the credential identity scope as:

```text
CREDENTIAL_IDENTITY_SCOPE = TO_BE_BOUND
REQUIRED_PROPERTY =
  Instance A and instance B under the same providerId can resolve
  different credential identities WITHOUT raw-secret duplication.

LIKELY = PROVIDER_INSTANCE_ID

  (semantic ownership: instance-scoped, NOT provider-scoped)
  (physical encoding: may reuse an existing opaque secret-reference primitive;
   the physical secret key need not literally equal instanceId)

PHYSICAL_SECRET_KEY_ENCODING = TO_BE_DETERMINED
  (may be instanceId, may be a content hash, may be a stable opaque ref;
   the foundation discovers what already exists and reuses it rather
   than inventing a new primitive if a suitable one is present)
```

Why this separation matters:

```text
- If the existing secret store already has an opaque secret-reference primitive
  (e.g. a per-row key derived from a hash, a content-addressable reference, or
  a stable slug), the foundation SHOULD reuse it. Inventing a new instanceId-
  keyed storage scheme when an existing primitive already namespaces credentials
  correctly would be over-fitting the schema to the prior (LIKELY) bias.

- If no existing primitive namespaces credentials at the instance granularity
  required (e.g. today the credential key may be providerId-derived, which
  collapses under same-provider multi-instance), the foundation MUST introduce
  one. The naming/scope decision is recorded in §12 design freeze.

- The semantic test is the only test that matters for R1:
  NEXT_EFFECTIVE_CONNECTION.credentialIdentity must equal B.credentialIdentity,
  regardless of how that identity is physically stored.
```

The foundation does NOT bind the physical encoding in this ACT body; it
discovers what already exists, freezes the discovery in evidence
`02-credential-storage-authority.md`, and chooses the encoding in §12 design
freeze based on the measured blast radius.

---

# §6 — Reviewer-prescribed epistemic sequence

The foundation ACT executes the following sequence. Order is load-bearing.

```text
1. RECON (source survey, no production edits):
     1a. current connection authority          -> §7 evidence
     1b. credential storage/reference authority -> §8 evidence
     1c. current runtime rebuild discriminator  -> §9 evidence

2. R0 (current-seam characterization witness):
     runs BEFORE any production edits; no ProviderConfigurationInstance yet
     measures & freezes three properties on HEAD's current seam
     output: frozen R0 table (the day-0 witness)
     -> §10 evidence (must run before §11)

3. DESIGN FREEZE:
     choose α / β / γ for ProviderConfigurationInstance schema
     bind semantic credential identity (semantic scope, not physical key)
     identify minimum runtime switch mechanism
     -> §12 evidence + this ACT body §12

4. R1 RED:
     bind Instance A, switch to Instance B, observe next request
     PRIMARY assertion: NEXT_EFFECTIVE_CONNECTION == B (provider-relevant tuple)
     SECONDARY assertion (Outcome C discriminator): no in-flight mutation
     -> §11 evidence (must run AFTER §12 design freeze; §10 R0 must already
        be frozen, the R0 -> R1 ordering constraint is forbidden to skip)

5. GREEN:
     minimum change only (the smallest set of production seams that satisfies
     R1 without introducing persistence authority the foundation doesn't need)
     -> §13 evidence

6. CONSERVATION:
     prove existing providerId-only configuration behavior unchanged
     -> §14 evidence

7. PERSISTENCE CHARACTERIZATION:
     identify per-session instance-binding seam ONLY
     (do NOT bind durable storage location; the implementation ACT owns that
      decision based on R0 blast radius + measured GREEN minimal-change set)
     -> §15 evidence

8. STOP
```

The "do not implement persistence merely because the ACT is called 'foundation'"
rule is enforced by step 7's CHARACTERIZATION framing (not a binding) and by the
§4 OWNS list, which limits this ACT to the runtime seam and the semantic scope,
NOT durable storage.

---

# §7 — Current connection authority (recon stream 1a)

**Purpose:** establish which production seams currently own the connection
between a saved provider configuration and the next LLM request.

**Recon outputs** (recorded in `.factory/evidence/ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01/01-connection-authority.md`):

```text
- Where the provider configuration is read at task construction time
  (entry points to the LLM call path).
- Where provider-specific options (baseUrl, headers, region) are
  applied to the request (handler-construction sites).
- Where the credential is resolved (secret store, VSCode SecretStorage,
  file-backed secrets.json, etc.).
- Where the modelId is bound to the request (model selection sites).
- Which seams touch providerId (i.e. existing identity dimension) and
  which do NOT (i.e. they key off storage id / slug instead).
```

**No freeze here** — this is a source survey. The freeze happens in §10 R0
(the witness measurements).

---

# §8 — Credential storage / reference authority (recon stream 1b)

**Purpose:** establish which production seams currently own credential
references, what the storage key shape is, and whether an existing
instance-granular primitive already exists.

**Recon outputs** (recorded in `02-credential-storage-authority.md`):

```text
- The complete list of places credentials are read.
- The storage key shape (providerId-derived? content hash? per-row slug?
  opaque ref?).
- Whether the same physical key can be reached by two different
  ProviderConfigurationInstance rows today, OR whether two rows of the
  same provider type are forced to share one credential slot (this is
  the SAM_PROVIDER_MULTI_CREDENTIAL_IDENTITY_NOT_BOUND pre-existing
  finding from MP RECON P3).
- Whether an existing secret-reference primitive (e.g. a hash-derived
  key, a content-addressable reference) can be reused to namespace
  credentials at instance granularity.
```

**Constraint:** the semantic-vs-physical separation in §5 forbids binding the
physical encoding here. This survey only CHARACTERIZES; the encoding choice
happens in §12 design freeze after the blast radius is measured.

---

# §9 — Current runtime rebuild discriminator (recon stream 1c)

**Purpose:** establish what production seams today cause the API handler to be
rebuilt, and what semantic event triggers each rebuild. This is the baseline
against which R0's `CURRENT_SEAM_REBUILDS_ON_CONFIG_IDENTITY` is measured.

**Recon outputs** (recorded in `03-rebuild-discriminator.md`):

```text
- Existing rebuild-on-provider-change mechanism (per upstream commit c31f33e
  "fix(vscode): restart session when user switches provider").
- What config field(s) participate in the rebuild trigger:
  today: providerId change.
- What config fields do NOT participate in the rebuild trigger today:
  baseUrl change for the same providerId (R0 measures whether this is a bug
  or a deliberate scope).
- Whether a same-providerId config change currently flows through a different
  code path (e.g. settings update without handler rebuild) — this is the
  R0 baseline.
```

This survey is the prior against which R0's three measurements make sense.

---

# §10 — R0: current-seam characterization witness

**Pre-flight:** §7, §8, §9 recon surveys are recorded (entries in
`.factory/evidence/ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01/`).

**Action:** with no production edits, attempt the following on HEAD's current
seam:

```text
Setup (today's production concepts only — NO ProviderConfigurationInstance yet):
  Provider configuration row A:
    providerId = openai-compatible
    baseUrl    = http://localhost:11434/v1
    credential value = "keyA-local"
    modelId    = qwen3-local

  Provider configuration row B:
    providerId = openai-compatible (SAME)
    baseUrl    = https://llm.corp.example/v1 (DIFFERENT)
    credential value = "keyB-corp"           (DIFFERENT)
    modelId    = qwen3-corp

  Action: bind A as the active provider/model, then attempt to switch to B
          through the existing provider/model selection machinery
          (no new code; no instance abstraction yet).
```

**Measure & FREEZE — component matrix** (R0 result, evidence file
`04-r0-current-seam-witness.md`):

```text
CURRENT_SEAM_CAN_EXPRESS_INSTANCE_IDENTITY = NO
  (unchanged; first-class instance identity does not exist; only
   ProviderId is branded; storage collapses at providerId)

CURRENT_SEAM_RERESOLVES_CONNECTION_COMPONENTS =
  providerId              = SAME    (trivially; A and B share providerId)
  baseUrl                 = YES     (resolveBaseUrl re-reads on every
                                     handler construction; slot overwrite
                                     transport works)
  credentialValue         = YES     (resolveApiKey re-reads on every
                                     handler construction; same slot
                                     overwrite transport; with the caveat
                                     that credential identity collapses to
                                     providerId so two same-provider
                                     instances cannot coexist - the
                                     SAME_PROVIDER_MULTI_CREDENTIAL_
                                     IDENTITY_NOT_BOUND finding MP RECON
                                     P3 named, which §12 must close)
  modelId                 = YES     (resolveModelId re-reads on every
                                     handler construction; same transport)
  headers                 = NOT_PROVEN
                                     (foundation must trace where headers
                                     live at handler construction; owned
                                     by FOUNDATION_RECON_PHASE before §12;
                                     evidence 05, new file)
  providerSpecificConfig  = NOT_PROVEN
                                     (same status as headers; for Bedrock/
                                     Vertex/GCP includes region + AWS/GCP
                                     config blocks per sdk-api-handler.ts)
  apiLine / routing       = NOT_PROVEN
                                     (apiLine is providerId-specific;
                                     foundation confirms whether it is or
                                     isn't a per-instance operand; if no
                                     provider uses it today: N/A)
  region                  = NOT_PROVEN
                                     (Bedrock/Vertex/GCP carry region;
                                     foundation traces per provider)

CURRENT_SEAM_MUTATES_FULL_CONNECTION =
  NOT_PROVEN
                                     (honest derivation; because headers,
                                      providerSpecificConfig, apiLine/
                                      routing, region are all NOT_PROVEN,
                                      the scalar YES the entry commit
                                      recorded was an overclaim; corrected
                                      in P1-CORRECTION01 per reviewer
                                      verdict HALT_R0_FULL_CONNECTION_NOT_
                                      PROVEN; becomes YES iff every
                                      provider-relevant component is YES
                                      or N/A)

CURRENT_SEAM_REBUILDS_ON_CONFIG_IDENTITY = NO
  (unchanged; providerId-only discriminant in
   sdk-provider-change-coordinator.ts; the four rebuild reasons in
   sdk-session-rebuild-scheduler.ts are
   provider/mcpTools/terminalExecutionMode/sessionAutoApprovalOverride;
   none fires on same-providerId config flip)

R0_EVIDENCE              = STRUCTURAL
R0_EXECUTED_SWITCH       = NOT_EXECUTED
```

**NOT_PROVEN is a first-class R0 result.** It is NOT a failure of R0; it
is R0 working correctly by not overclaiming. The four NOT_PROVEN
operands must be traced to per-component YES/NO/N/A verdicts in the
FOUNDATION_RECON_PHASE before §12 design freeze; this trace work is
recon (no production edits) and produces evidence file
`05-r0-remaining-operand-trace.md` (new).

**What R0 changes for §12 design freeze (corrected, post-P1-CORRECTION01):**

```text
Three of seven R1 effective-connection operands are proven to follow
the slot-overwrite + fresh-read construction seam (baseUrl,
credentialValue, modelId). Four are NOT_PROVEN at R0 and must be
traced before §12 design freeze. The foundation does NOT yet know
whether the runtime mechanism needs to be extended beyond
slot-overwrite; that is exactly the question §12 is supposed to
answer.

  - If the four NOT_PROVEN operands all trace to N/A or to the same
    slot-overwrite + fresh-read seam, then Outcome A/C is genuinely
    cheaper than the entry commit implied, and §12 favors reusing
    updateConnection (Outcome A) or a bounded runtime switch
    extension (Outcome C).
  - If any of the four NOT_PROVEN operands traces to NO (i.e. it is
    read elsewhere - cached on a long-lived provider object, resolved
    once per session, etc. - and not refreshed by the slot-overwrite
    + fresh-read seam), then Outcome B (forced rebuild) becomes
    causally justified, not merely architectural hygiene.

R0 does NOT pre-commit. R0 + the §10 source-trace work freezes the
operand-by-operand classification. §12 design freeze consumes that
classification. R1 RED consumes §12.
```

**Reviewer's stated prior (R0 measurement, before evidence):**
`NO / NO / NO`. R0 freezes what is actually measured; the prior is overridden
by evidence.

**What R0 is NOT:** R0 is NOT a simulation of the future
ProviderConfigurationInstance abstraction. R0 measures today's seam only.
Per reviewer's confirmation: "These three observations are exactly enough.
Do not add more bookkeeping around R0."

---

# §11 — R1: post-identity semantic RED

**Pre-flight:** R0 (§10) is frozen. §12 design freeze (α / β / γ + semantic
credential identity scope) is recorded.

**Action:** with the minimal runtime instance-switch seam introduced (§12),
plus either a test-local injected instance registry or the minimal
production seam required to express the instance abstraction:

```text
Setup:
  Instance A: providerId = P, endpoint = A, credential = A
              modelId    = mA, headers = hA, providerSpecificConfig = cA
  Instance B: providerId = P (SAME), endpoint = B, credential = B
              modelId    = mB, headers = hB, providerSpecificConfig = cB

  Action: bind A as the active instance, switch to B, observe next request.
```

**PRIMARY assertion** (the load-bearing R1 invariant):

```text
NEXT_EFFECTIVE_CONNECTION == B's provider-relevant effective tuple

  where B's effective tuple is:
    providerId                 = B.providerId
    baseUrl / endpoint         = B.baseUrl
    credentialIdentity         = B.credentialIdentity
    headers                    = B.headers
    providerSpecificConfig     = B.providerSpecificConfig
    modelId                    = B.modelId

  where provider-irrelevant fields (e.g. headers for a provider that does
  not use them) are represented as N/A in both A's and B's tuples, so the
  comparison does not falsely equate "both undefined" with "both N/A".

  If ANY component of the next request's effective tuple equals A's
  (or anything other than B's), the instance switch did NOT happen.
  The test FAILS even if restartActiveSession() was called, because
  the assertion is on the EFFECTIVE CONNECTION, not on the mechanism.
```

**SECONDARY assertion** (Outcome C discriminator, only relevant if the
mechanism chosen in §12 is in-place mutation rather than forced rebuild):

```text
NO mutation of an in-flight request was required to satisfy the primary
assertion. If a request was in flight when the switch was triggered and
the response corresponded to a hybrid A+B tuple (some components from A,
some from B), the secondary assertion FAILS regardless of whether the
primary assertion eventually holds for the next request.
```

**Outcome mapping** (preserved from MP RECON P3 evidence 13):

```text
A = reuse updateConnection path
    PASSES iff the path is parameterized by the full instance tuple,
    NOT just modelId.

B = forced rebuild on instance identity change
    PASSES iff the existing rebuild path (per upstream commit c31f33e)
    is correctly extended to fire on instance-identity change in
    addition to provider-identity change.
    Reviewer's prior probability for the foundation picking B: HIGH.

C = bounded runtime-switch extension
    PASSES iff the runtime can rewire endpoint + credential + headers +
    providerSpecificConfig + modelId without a full session restart AND
    the secondary assertion holds. Reviewer's prior: LOW (the partial-
    semantic-value-flowing-through-several-stages class is what
    Factorize has been removing).
```

**No freeze here** — this is the RED. The freeze happens in §13 GREEN.

---

# §12 — Design freeze (semantic credential identity + α / β / γ choice)

The design freeze lives at the intersection of R0's measured blast radius
(§10) and the reviewer's epistemic sequence step 3. It binds:

```text
- α / β / γ choice for ProviderConfigurationInstance schema
  (α = additive instance registry stored alongside existing rows;
   β = new instance row keyed by instanceId; γ = derived identity from
       a hash of (baseUrl, credential-identity, headers) without a new
       schema row)
  Choice MUST be from the measured R0 blast radius, NOT from prior bias.

- Semantic credential identity scope (per §5):
  CREDENTIAL_IDENTITY_SCOPE = PROVIDER_INSTANCE_ID
    (semantic ownership)
  PHYSICAL_SECRET_KEY_ENCODING = <chosen from §8 survey of existing
    primitives>
  RATIONALE = <why this encoding reuses the existing primitive>
```

The design freeze is recorded as `05-design-freeze.md` in evidence. It is
the input to §13 GREEN.

---

# §13 — GREEN: minimum change only

The smallest set of production seams that satisfies R1 (§11) without
introducing persistence authority the foundation doesn't need.

```text
- The runtime instance-switch seam (per §12 design freeze).
- The semantic credential identity resolution (§5).
- The R0 -> R1 traceability hooks (so R0's day-0 witness remains
  reachable from R1's passing RED).

NOT introduced here:
- Durable storage authority (the implementation ACT owns this;
  step 7 of the epistemic sequence is CHARACTERIZATION only).
- Profile / picker / UI changes (scope firewall §4).
- defaultProfileId / activeProfileId semantics (implementation ACT).
```

Evidence file: `06-green-minimum-change.md`.

---

# §14 — Conservation (existing providerId-only users)

```text
PROVE that an operator who has exactly ONE configured Provider Configuration
row for a given providerId, who never creates a second row, who never
switches to a non-existent instance, sees NO behavior change after the
foundation closes:

  - Same effective connection on the next request.
  - Same handler construction path.
  - Same credential resolution.
  - Same rebuild trigger semantics (rebuild on providerId change is
    preserved; rebuild does NOT fire on a non-change).
```

Evidence file: `07-conservation.md`. If this fails, the foundation HALts
(see §15 halt conditions).

---

# §15 — Halt conditions

```text
HALT_FOUNDATION_INSTANCE_IDENTITY_DUPLICATES_SECRET
  Any step introduces a raw-secret duplication path
  (PROFILE_CONTAINS_RAW_SECRET must remain NO).

HALT_FOUNDATION_INSTANCE_SWITCH_DOES_NOT_REWRITE_EFFECTIVE_CONNECTION
  R1 fails: NEXT_EFFECTIVE_CONNECTION != B's tuple after switch.

HALT_FOUNDATION_CONSERVATION_REGRESSION
  Existing providerId-only user behavior changes.

HALT_FOUNDATION_PERSISTENCE_OVERREACH
  Durable storage authority is bound before R1 is proven with an injected/
  test-local registry.

HALT_FOUNDATION_OUT_OF_SCOPE_EDIT
  Any production edit touches ModelProfile, profiles.json, defaultProfileId,
  activeProfileId, picker UI, or "Manage Profiles" UI before the
  implementation ACT is authorized.

HALT_UNEXPECTED_TRACKED_DIRT
  Inherited Factory P2 residue disturbed.
```

---

# §16 — Evidence directory plan

```text
.factory/evidence/ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01/
  00-preflight.txt
  01-connection-authority.md            (recon stream 1a)
  02-credential-storage-authority.md    (recon stream 1b)
  03-rebuild-discriminator.md           (recon stream 1c)
  04-r0-current-seam-witness.md         (R0 freeze)
  05-design-freeze.md                   (α / β / γ + semantic credential identity)
  06-green-minimum-change.md            (GREEN)
  07-conservation.md                    (Conservation)
  08-persistence-characterization.md    (step 7 CHARACTERIZATION; not a binding)
  09-final-report.md                    (terminal freeze; gates IMPLEMENTATION_ACT)
```

---

# §17 — Implementation ACT gates (still NOT authorized; reframed in P1-CORRECTION01)

The Model Profiles implementation ACT
`ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01` opens ONLY
after BOTH phases of this foundation ACT close, per §4's phase split:

```text
FOUNDATION_RECON_PHASE must be CLOSED first:
  R0 component matrix complete (every operand YES/NO/N/A;
                                evidence 04 + evidence 05)
  §12 design freeze recorded (alpha/beta/gamma + semantic credential
                              identity + physical secret-key encoding;
                              evidence 06)
  §15 no halt conditions triggered during recon phase

THEN FOUNDATION_IMPLEMENTATION_PHASE must be CLOSED:
  §11 R1 PASS (NEXT_EFFECTIVE_CONNECTION == B's provider-relevant
               effective tuple; primary assertion; against an
               injected/test-local registry, not production code)
  §13 GREEN recorded (minimum change only; smallest set of production
                     seams satisfying R1)
  §14 conservation proven (existing providerId-only users unchanged)
  §15 no halt conditions triggered during implementation phase

THEN the four §17 GATEs gate the handoff to MODEL_PROFILES_IMPLEMENTATION:

GATE_FOUNDATION_CLOSED:
  Both phases above closed.

GATE_SCOPE_TRANSFERRED:
  ProviderConfigurationInstance schema (alpha / beta / gamma choice) handed off
  Semantic credential identity scope handed off
  R0 component matrix handed off as the baseline citation
  Per-session instance-binding seam CHARACTERIZED (not bound) handed off

GATE_PERSISTENCE_AUTHORITY:
  Implementation ACT may now bind durable storage location
  (this ACT's FOUNDATION_RECON_PHASE step 7 was only characterization;
   FOUNDATION_IMPLEMENTATION_PHASE produced GREEN with the runtime seam
   but did not bind durable storage either; durable storage authority
   transfers to MODEL_PROFILES_IMPLEMENTATION here)

GATE_OUT_OF_SCOPE_STILL_OUT:
  All §4 OWNS / DOES NOT OWN boundaries preserved through the handoff
  PLUS the FOUNDATION_RECON_PHASE vs FOUNDATION_IMPLEMENTATION_PHASE
  split is reflected in the implementation ACT's own entry preamble
  (so a future reader does not hit the same lifecycle contradiction
   the entry commit's preamble had)
```

Until all four gates are met, `MODEL_PROFILES_IMPLEMENTATION = NOT_AUTHORIZED`.

---

# §35 — Successor linkage

This ACT is the foundation that MP RECON's correction cycle CLOSED for. Its
predecessor chain:

```text
F3  / F3B Factorize                      -> bfa2ad5929aa4f9f1a1bbff58bde2c144c68157e
MP RECON open                            -> b55407d03
MP RECON P1 wording correction           -> 97f49582e
MP RECON P2 correction                   -> 830be436d
MP RECON P3 correction                   -> 951f171e0
MP RECON P4 correction (FOUNDATION AUTH) -> af1df4a60
FOUNDATION ACT entry                     -> 40bdeeac2  (R0 frozen;
                                                     M2 scalar overclaim)
FOUNDATION ACT P1-CORRECTION01           -> <this commit>
                                                  (R0 component matrix;
                                                   phase contract split)
```

### Foundation P1-CORRECTION01 pointer (amended 2026-09-05 fifth-reviewer verdict)

The fifth reviewer on the foundation entry commit issued verdict
`HALT_R0_FULL_CONNECTION_NOT_PROVEN` with two bounded corrections folded
into the same commit (per reviewer: "Fold it into the same bounded R0
correction. This is P1, not another architecture cycle."):

```text
P0  R0_FULL_CONNECTION_OVERCLAIM
    The entry commit froze CURRENT_SEAM_MUTATES_FULL_CONNECTION = YES
    (scalar) but the source evidence supports only the narrower
    CURRENT_SEAM_OVERWRITES_AND_RERESOLVES_PROVIDER_SLOTS = YES for
    at least baseUrl, credentialValue, modelId. The scalar is replaced
    with a per-component matrix that names which operands of the R1
    effective-connection tuple are proven YES, which are YES|N/A|NOT_PROVEN,
    and which are NO. R0_EVIDENCE = STRUCTURAL and R0_EXECUTED_SWITCH =
    NOT_EXECUTED are labeled explicitly. Four operands (headers,
    providerSpecificConfig, apiLine/routing, region) are NOT_PROVEN at
    R0 and must be traced to per-component YES/NO/N/A verdicts in the
    FOUNDATION_RECON_PHASE before §12 design freeze; that trace work
    produces evidence 05-r0-remaining-operand-trace.md (new file, not
    authored in this commit).

P1  FOUNDATION_ACT_PHASE_CONTRACT_INCONSISTENT
    The entry preamble's "PROD_EDITS = FORBIDDEN; this ACT is recon-only"
    conflicted with the same ACT body's R1 RED -> GREEN -> CONSERVATION
    contract. Reconciled with a two-phase split per the reviewer's
    exact phrasing:
      FOUNDATION_RECON_PHASE       (§0..§12; prod edits FORBIDDEN)
      FOUNDATION_IMPLEMENTATION_PHASE
                                   (§13..§15; prod edits AUTHORIZED ONLY
                                    after R0 + §12 + genuine R1 RED)
      FOUNDATION_FINAL_REPORT_AND_HANDOFF
                                   (§16, §17, §35, STOP)
    §17 gates reframed to gate FOUNDATION_IMPLEMENTATION_PHASE ->
    MODEL_PROFILES_IMPLEMENTATION, not the foundation ACT's own
    closure.

REVIEWER'S "DO NOT" LIST (verbatim, applied to this commit):
  DO NOT start R1
  DO NOT choose alpha/beta/gamma
  DO NOT add persistence
  DO NOT open another review cycle
  All four honored.
```

Per the reviewer, the foundation design is NOT reopened; no new
architecture cycle. The bounded P1-CORRECTION01 lives at
`ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01-P1-CORRECTION01.md`.

What R0 NOW says (corrected):

```text
CURRENT_SEAM_CAN_EXPRESS_INSTANCE_IDENTITY = NO
CURRENT_SEAM_RERESOLVES_CONNECTION_COMPONENTS =
  providerId              = SAME
  baseUrl                 = YES
  credentialValue         = YES
  modelId                 = YES
  headers                 = NOT_PROVEN
  providerSpecificConfig  = NOT_PROVEN
  apiLine / routing       = NOT_PROVEN
  region                  = NOT_PROVEN
CURRENT_SEAM_MUTATES_FULL_CONNECTION = NOT_PROVEN
CURRENT_SEAM_REBUILDS_ON_CONFIG_IDENTITY = NO
R0_EVIDENCE              = STRUCTURAL
R0_EXECUTED_SWITCH       = NOT_EXECUTED
```

After this commit, the recon phase resumes:
  (a) trace the four NOT_PROVEN operands to YES/NO/N/A (evidence 05)
  (b) record §12 design freeze (evidence 06)
  (c) gate FOUNDATION_IMPLEMENTATION_PHASE open

The implementation phase (R1 RED -> GREEN -> conservation) opens ONLY
after (a) + (b) + (c) all close, per the corrected §17 gates.

Its successor:

```text
ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01
  (gated on §17 four-gate handoff; not yet authorized)
```

Out-of-scope successor ACTs (already registered, NOT gated by this ACT):

```text
ACT-CLINEMM-EFFECTIVE-MODEL-CONTEXT-WINDOW-AUTHORITY-RECON01
  (MiniMax 1.3M -> 24.6k; independently registered)

ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-ASYNC-JOB-WAKE-OWNERSHIP-RECON01
  (WAITING_WITHOUT_WAKE_SOURCE; independently registered)
```

Reviewer-prescribed execution sequence (verbatim, for traceability):

```text
1. recon exact current connection authority
2. R0 current-seam characterization
3. choose α / β / γ only from measured blast radius
4. bind credential identity namespace
5. RED instance A -> B effective-config transition (R1)
6. minimal repair
7. conservation for existing providerId-only users
8. session-binding seam characterization
9. stop
```

Reviewer's prior probability for foundation outcome: **B** (forced rebuild on
instance identity change). Not frozen — R1 decides.

---

# STOP — recon correction cycle CLOSED; foundation ACT OPEN at §0; P1-CORRECTION01 applied

Production edits are FORBIDDEN IN FOUNDATION_RECON_PHASE (§0..§12) and
AUTHORIZED IN FOUNDATION_IMPLEMENTATION_PHASE (§13..§15) only after R0
component matrix complete + §12 design freeze + a genuine R1 RED,
per §4 phase split.

The next useful artifact is **NOT** another documentary amendment. The
next useful artifacts are, in order:

```text
FOUNDATION_RECON_PHASE (production edits FORBIDDEN):
  (a) evidence 05-r0-remaining-operand-trace.md
      trace headers, providerSpecificConfig, apiLine/routing, region
      to per-component YES/NO/N/A verdicts against HEAD's current
      source (no runtime test; structural source tracing like R0 v3)
  (b) evidence 06-design-freeze.md
      record alpha/beta/gamma + semantic credential identity +
      physical secret-key encoding choice from the corrected R0
      matrix (a)
  (c) gate FOUNDATION_IMPLEMENTATION_PHASE open

FOUNDATION_IMPLEMENTATION_PHASE (production edits AUTHORIZED after (a)+(b)+(c)):
  (d) evidence 07-r1-red-instance-switch.md (or whatever number the
      directory lands on; per §16 plan, this slot is taken by
      "06-green-minimum-change.md" if the renumbering follows)
      R1 RED against an injected/test-local ProviderConfigurationInstance
      registry; primary assertion =
        NEXT_EFFECTIVE_CONNECTION == B's provider-relevant effective tuple
      secondary assertion (Outcome C discriminator) = no in-flight mutation
      R1 must begin with R0 citation per the R0 -> R1 ordering constraint
      in MP RECON evidence 13 v3
  (e) GREEN (minimum change only)
  (f) conservation (providerId-only users unchanged)

FOUNDATION_FINAL_REPORT_AND_HANDOFF:
  (g) terminal freeze (evidence final-report.md)
  (h) §17 four-gate handoff to MODEL_PROFILES_IMPLEMENTATION
      (which remains NOT_AUTHORIZED until that handoff)
```

Reviewer's reopen condition was:

```text
"the corrected R0 component matrix is frozen and the ACT phase
 contract is coherent"
```

Both conditions are met by this commit:

```text
R0 component matrix    = FROZEN   (this commit; §10 amended + evidence 04)
ACT phase contract     = COHERENT (this commit; §4 phases block + §17
                                    reframed + entry preamble + §35)
```

C1: GO TO FOUNDATION_RECON_PHASE (a)+(b)+(c). No further pre-execution
review unless this correction exposes a new P0.
