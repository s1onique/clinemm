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

**Measure & FREEZE** (R0 result, evidence file `04-r0-current-seam-witness.md`):

```text
CURRENT_SEAM_CAN_EXPRESS_INSTANCE_IDENTITY = YES | NO
  Can the current seam distinguish A and B as two identities at the live
  session boundary? If yes: how (which dimension)? If no: confirmed
  pre-existing seam gap.

CURRENT_SEAM_MUTATES_FULL_CONNECTION       = YES | NO
  When the user switches from A to B through the existing path, does the
  next request's effective connection actually reflect B's baseUrl +
  credential + modelId? If no: which components did and which didn't?

CURRENT_SEAM_REBUILDS_ON_CONFIG_IDENTITY   = YES | NO
  Does the existing rebuild path fire on this switch? Today it is
  expected to NOT fire because both A and B share the same providerId,
  but R0 freezes the observation.
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

# §17 — Implementation ACT gates (still NOT authorized)

The Model Profiles implementation ACT
`ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01` opens ONLY when:

```text
GATE_FOUNDATION_CLOSED:
  §10 R0 frozen
  §11 R1 PASS (NEXT_EFFECTIVE_CONNECTION == B)
  §12 design freeze recorded
  §13 GREEN minimum change recorded
  §14 conservation proven
  §15 no halt conditions triggered

GATE_SCOPE_TRANSFERRED:
  ProviderConfigurationInstance schema (α / β / γ choice) handed off
  Semantic credential identity scope handed off
  R0 day-0 witness handed off as the baseline citation
  Per-session instance-binding seam CHARACTERIZED (not bound)

GATE_PERSISTENCE_AUTHORITY:
  Implementation ACT may now bind durable storage location
  (this ACT's step 7 was only characterization)

GATE_OUT_OF_SCOPE_STILL_OUT:
  All §4 OWNS / DOES NOT OWN boundaries preserved through the handoff
```

Until all four gates are met, `IMPLEMENTATION_ACT_AUTHORIZED = NO`.

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
MP RECON P4 correction (FOUNDATION AUTH) -> af1df4a60  (this ACT opens at this commit)
FOUNDATION ACT entry                     -> <this commit>
```

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

# STOP — recon correction cycle CLOSED; foundation ACT OPEN at §0

Production edits FORBIDDEN until §13 GREEN + §14 conservation succeed and §17
gates all open.

The next useful artifact is **executable R0 evidence** against HEAD's current
seam, not another documentary amendment.
