# ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01-P1-CORRECTION01 — bounded correction after HALT_R0_FULL_CONNECTION_NOT_PROVEN

> **Entry identity (auto-recorded by §0 preflight):**
>
> ```text
> ACT_ID            = ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01-P1-CORRECTION01
> ENTRY_HEAD        = 40bdeeac2c8d76d7c0ea3d7a47f1d28a2c79ba6d
> PREDECESSORS      = ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01
>                     ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-RECON01-P2-CORRECTION01
> PREDECESSOR_STATE = Foundation ACT entry committed (R0 frozen in evidence 04);
>                     fourth-reviewer on P4 closed the recon correction cycle
>                     with verdict PASS - C1: GO TO FOUNDATION RECON
> VERDICT_ADDRESSED = HALT_R0_FULL_CONNECTION_NOT_PROVEN
>                     (fifth-reviewer verdict on the foundation entry commit)
> DISPOSITION       = ONE_BOUNDED_P0_PLUS_ONE_BOUNDED_P1
>                     (no new architecture cycle; no new P0 beyond what the
>                      reviewer named; no R1 yet; no alpha/beta/gamma yet;
>                      no persistence yet)
> BRANCH            = main
> PROD_EDITS        = FORBIDDEN for this correction ACT body itself
>                     (the foundation ACT body is amended, not the
>                     production source tree)
> TESTS             = 0 new tests in this commit
> ```
>
> ```text
> PRIMARY_CORRECTION_PURPOSE =
>   Apply the fifth-reviewer's bounded correction to the foundation ACT
>   body without reopening the foundation design or adding bookkeeping
>   the reviewer explicitly forbade. Two bounded corrections:
>
>     P0  R0_FULL_CONNECTION_OVERCLAIM
>         Replace the scalar M2 (CURRENT_SEAM_MUTATES_FULL_CONNECTION = YES)
>         with a per-component matrix that names which operands of the
>         R1 effective-connection tuple are proven YES, which are YES|N/A|NOT_PROVEN
>         (i.e. genuinely not proven yet), and which are NO. Derive
>         MUTATES_FULL_CONNECTION honestly from the matrix.
>         Label R0_EVIDENCE = STRUCTURAL and R0_EXECUTED_SWITCH = NOT_EXECUTED.
>         Reframe "what R0 changes for section 12 design freeze" so it
>         does not pre-commit to Outcome A/C or to Outcome B.
>
>     P1  FOUNDATION_ACT_PHASE_CONTRACT_INCONSISTENT
>         Reconcile the foundation ACT body entry's
>         "PROD_EDITS = FORBIDDEN; this ACT is recon-only; any production
>          change must be authored in a subsequent implementation ACT"
>         with the same ACT body's R1 RED -> GREEN -> CONSERVATION contract.
>         Split the foundation ACT into two phases per the reviewer's
>         exact phrasing:
>           FOUNDATION_RECON_PHASE      (R0 + section 12 design freeze;
>                                       production edits forbidden)
>           FOUNDATION_IMPLEMENTATION_PHASE
>                                      (R1 RED + GREEN + CONSERVATION;
>                                       production edits authorized ONLY
>                                       after R0 freeze + section 12
>                                       design freeze + a genuine R1 RED)
>         MODEL_PROFILES_IMPLEMENTATION remains separate and NOT_AUTHORIZED,
>         gated on the foundation ACT body's section 17 four-gate handoff
>         (reframed to gate phase 2 -> MP_IMPLEMENTATION, not the
>         foundation ACT's own closure).
>
> SCOPE_OF_THIS_COMMIT =
>   - amend foundation ACT body (entry preamble, section 4 scope firewall,
>     section 10 R0; section 13 GREEN phase framing; section 17 gates;
>     section 35 successor linkage; STOP)
>   - amend foundation evidence 04-r0-current-seam-witness.md with the
>     component matrix (R0_EVIDENCE label, R0_EXECUTED_SWITCH label,
>     honest MUTATES_FULL_CONNECTION derivation)
>   - amend .gitignore with a comment block describing this correction
>   - amend .factory/epic-board.md with the 89th-pass row narrating this
>     bounded correction
>
>   NOT in this commit:
>   - no production source edits
>   - no test source edits
>   - no alpha/beta/gamma choice
>   - no persistence authority
>   - no new evidence files (the bounded P0 corrects an existing file)
>   - no new ACT bodies beyond this correction ACT body itself
> ```

---

## §0 — Identity

```text
ACT_ID =
  ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01-P1-CORRECTION01

PREDECESSORS =
  ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01
  ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-RECON01-P2-CORRECTION01

VERDICT_ADDRESSED =
  HALT_R0_FULL_CONNECTION_NOT_PROVEN
  (fifth-reviewer verdict on the foundation entry commit 40bdeeac2)

EXPECTED_ENTRY_HEAD =
  40bdeeac2c8d76d7c0ea3d7a47f1d28a2c79ba6d

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

Do not touch inherited Factory residue (the foundation entry commit
chain + the MP RECON correction cycle's commit chain must remain intact).

---

# §1 — Why this correction exists (verbatim reviewer reasoning)

The fifth reviewer, on the foundation entry commit, wrote:

> The foundation recon itself is useful, and **M1=NO / M3=NO look
> well-supported**. But I would **not authorize §12 design freeze or
> R1 yet** because the surprising M2 result is stronger than the
> evidence presented.
>
> The ACT says R0 froze:
>   CURRENT_SEAM_MUTATES_FULL_CONNECTION = YES
> while the actual evidence establishes a narrower proposition:
>   CURRENT_SEAM_OVERWRITES_AND_RERESOLVES_PROVIDER_SLOTS =
>     YES for at least:
>       baseUrl
>       apiKey
>       modelId
> The report itself qualifies M2 as "only for the fields that have a
> per-providerId slot." That is not equivalent to **FULL_CONNECTION**,
> whose R1 definition includes provider-relevant `headers`,
> `providerSpecificConfig`, credential identity, etc.

The reviewer's load-bearing critique:

> The current conclusion derived from M2 is: "the foundation does not
> need to invent a new runtime mechanism … only the identity dimension."
> That conclusion is premature.
>
> The source proof currently gives roughly:
>   write B into provider-scoped slots
>   -> later builder reads B.baseUrl
>   -> later builder reads B.apiKey
>   -> later builder reads B.modelId
>
> It does **not yet prove**:
>   write B
>   -> next request receives the complete provider-relevant B tuple
>   -> zero A residue
>
> And that second statement is precisely the invariant R1 exists to
> establish.

The reviewer also flagged the structural vs executed distinction:

> The digest confirms this cycle contains no executed test evidence;
> this is a documentary/source-derived R0 only. Calling M2 `YES`
> therefore also blurs `STRUCTURAL` into something that sounds executed.

And the lifecycle inconsistency:

> The entry says effectively:
>   PROD_EDITS = FORBIDDEN
>   this ACT is recon-only
>   any production change must be authored in a subsequent implementation ACT
> but later the same ACT specifies:
>   R1 RED -> GREEN minimum production change -> CONSERVATION
> and §17 requires that GREEN before the Model Profiles implementation ACT opens.

Reviewer's recommended fix (verbatim):

> One bounded correction, then continue. Do **not** reopen the foundation
> design. Fix R0 once by replacing M2 with a component-level characterization.
>
> I would freeze:
>
>   CURRENT_SEAM_CAN_EXPRESS_INSTANCE_IDENTITY = NO
>
>   CURRENT_SEAM_RERESOLVES_CONNECTION_COMPONENTS =
>     providerId              = SAME
>     baseUrl                 = YES
>     credentialValue         = YES
>     modelId                 = YES
>     headers                 = YES | NO | N/A | NOT_PROVEN
>     providerSpecificConfig  = YES | NO | N/A | NOT_PROVEN
>     apiLine / routing       = YES | NO | N/A | NOT_PROVEN
>     region                  = YES | NO | N/A | NOT_PROVEN
>
>   CURRENT_SEAM_MUTATES_FULL_CONNECTION =
>     YES only iff every provider-relevant component above is proven YES/N/A
>     otherwise NOT_PROVEN or NO
>
>   CURRENT_SEAM_REBUILDS_ON_CONFIG_IDENTITY = NO
>
> Then explicitly classify:
>   R0_EVIDENCE = STRUCTURAL
>   R0_EXECUTED_SWITCH = NOT_EXECUTED

Reviewer's important distinction:

> You have discovered something valuable:
>   M2_BASELINE =
>     SLOT_OVERWRITE_CAN_REFRESH_SOME_CONNECTION_OPERANDS
> Keep that finding. Just don't promote it to:
>   FULL_CONNECTION_REFRESH_ALREADY_EXISTS
> until the complete tuple is accounted for.
>
> That changes the §12 decision substantially:
>   - If all relevant operands follow the same fresh-read construction seam,
>     **Outcome A/C may genuinely be cheaper than expected**.
>   - If some instance-owned operand is retained elsewhere,
>     **Outcome B forced rebuild becomes causally justified**, not merely
>     architectural hygiene.
> That is exactly what the foundation is supposed to discriminate.

---

# §2 — P0 fix: R0 component matrix (the corrected R0)

Replace the scalar `CURRENT_SEAM_MUTATES_FULL_CONNECTION` in the
foundation ACT body §10 with the reviewer's prescribed component matrix.

## 2a. The matrix (applied to evidence 04-r0-current-seam-witness.md)

```text
CURRENT_SEAM_CAN_EXPRESS_INSTANCE_IDENTITY = NO
  (unchanged from prior freeze; first-class instance identity does not
   exist in the SDK contract surface; only ProviderId is branded;
   storage collapses at providerId; corroborated by contracts.ts,
   sdk-api-handler.ts, cline-session-factory.ts PROVIDER_API_KEY_MAP
   and resolveBaseUrl baseUrlMap, providers.json single-keyed entry)

CURRENT_SEAM_RERESOLVES_CONNECTION_COMPONENTS =
  providerId              = SAME    (trivially; same providerId across A and B)
  baseUrl                 = YES     (resolveBaseUrl re-reads the slot on
                                     every handler construction; slot
                                     overwrite transport works)
  credentialValue         = YES     (resolveApiKey re-reads the slot on
                                     every handler construction; same
                                     slot overwrite transport; with the
                                     caveat that the credential identity
                                     dimension collapses to providerId
                                     so two same-provider instances
                                     cannot coexist - this is the
                                     SAME_PROVIDER_MULTI_CREDENTIAL_
                                     IDENTITY_NOT_BOUND finding MP RECON
                                     P3 named, which the foundation must
                                     close via section 12 design freeze)
  modelId                 = YES     (resolveModelId re-reads the slot on
                                     every handler construction; same
                                     slot overwrite transport)
  headers                 = NOT_PROVEN
                                     (NOT in the foundation ACT body's
                                     initial evidence 04 because the
                                     reviewer's P0 surfaces this as the
                                     load-bearing gap; the foundation
                                     must trace where headers live at
                                     handler construction time and
                                     whether a same-provider config flip
                                     carries them to the next request;
                                     this is part of the section 12
                                     design freeze scope, not deferred
                                     to R1)
  providerSpecificConfig  = NOT_PROVEN
                                     (same status as headers; the
                                     foundation must trace where
                                     providerSpecificConfig is read at
                                     handler construction; not deferred
                                     to R1)
  apiLine / routing       = NOT_PROVEN
                                     (apiLine is providerId-specific;
                                     today's seam does not appear to
                                     surface it as a per-instance
                                     operand; the foundation must
                                     confirm whether it is or isn't)
  region                  = YES | N/A depending on provider
                                     (Bedrock / Vertex / GCP carry
                                     region; the foundation traces
                                     region resolution and classifies it
                                     per provider)

CURRENT_SEAM_MUTATES_FULL_CONNECTION =
  NOT_PROVEN
                                     (because headers, providerSpecificConfig,
                                      and apiLine/routing are all
                                      NOT_PROVEN, the honest derivation
                                      is NOT_PROVEN; the scalar YES that
                                      the foundation entry committed was
                                      an overclaim)

CURRENT_SEAM_REBUILDS_ON_CONFIG_IDENTITY = NO
  (unchanged from prior freeze; providerId-only discriminant in
   sdk-provider-change-coordinator.ts; the four rebuild reasons in
   sdk-session-rebuild-scheduler.ts are
   provider/mcpTools/terminalExecutionMode/sessionAutoApprovalOverride;
   none fires on same-providerId config flip)

R0_EVIDENCE             = STRUCTURAL
R0_EXECUTED_SWITCH      = NOT_EXECUTED
```

## 2b. Why NOT_PROVEN is the honest answer (and not "NO")

The M2 scalar was derived from source tracing of three fields
(baseUrl, apiKey, modelId). The R1 effective-connection tuple includes
**at least** seven fields. The three that were traced cover the
slot-overwrite path; the four that were not (headers,
providerSpecificConfig, apiLine/routing for providers that use it,
region for providers that use it) cannot honestly be claimed YES,
NO, or N/A without further source tracing.

NOT_PROVEN is a first-class R0 result. It is NOT a failure of R0;
it is R0 working correctly by not overclaiming.

## 2c. Where the missing operand traces live (pre-§12 work)

The component matrix above delegates the NOT_PROVEN operands to
**additional source tracing** that must happen before §12 design
freeze. This tracing is recon (no production edits), runs against
HEAD's current code, and produces a per-component YES/NO/N/A verdict
for each not-yet-proven operand.

Pre-§12 source-trace targets:

```text
- headers:
    where is headers read at handler construction?
    (search createHandler, ProviderConfig shape, all provider-specific
     handlers in @cline/llms that take headers; today the legacy
     ApiConfiguration does not appear to carry a generic headers slot,
     but provider-specific fields may be plumbed through other paths)
    -> if headers are not read at handler construction time: N/A
    -> if headers are read but only on providerId change: NO for
       same-providerId flips
    -> if headers are read on every construction: YES (and the M2
       surprise generalizes)

- providerSpecificConfig:
    same trace as headers; for Bedrock/Vertex/GCP, this includes
    region and structured AWS/GCP config blocks per
    sdk-api-handler.ts:75-86
    -> classify per provider; some are N/A, some are YES, some are NO

- apiLine / routing:
    determine whether apiLine is a meaningful per-instance operand
    for any current provider; if no provider uses it today: N/A
    across the board
    -> the foundation traces this and records the result

- region (Bedrock / Vertex / GCP):
    trace how region is plumbed from ApiConfiguration to handler
    construction; for these providers region is part of the
    provider-specific config block (buildBedrockProviderConfig,
    resolveVertexProviderConfig); classify per provider
```

The component matrix is **frozen** at the level of "which operands
are not yet classified." The per-component YES/NO/N/A verdicts
fill in before §12 design freeze. This is recon work, NOT R1 work;
the foundation ACT's recon phase (§3 below) explicitly owns it.

## 2d. Reframing "what R0 changes for §12 design freeze"

The foundation entry commit claimed:

> the foundation does NOT need to invent a fresh runtime mechanism
> for the next request to reflect the new config, only the identity
> dimension. Slot-overwrite already works.

The corrected claim:

> Three of seven R1 effective-connection operands are proven to follow
> the slot-overwrite + fresh-read construction seam (baseUrl,
> credentialValue, modelId). Four are NOT_PROVEN at R0 and must be
> traced before §12 design freeze. The foundation does NOT yet know
> whether the runtime mechanism needs to be extended beyond
> slot-overwrite; that is exactly the question §12 is supposed to
> answer.
>
> If the four NOT_PROVEN operands all trace to N/A or to the same
> slot-overwrite + fresh-read seam, then Outcome A/C is genuinely
> cheaper than the entry commit implied, and the §12 choice favors
> reusing `updateConnection` (Outcome A) or a bounded runtime switch
> extension (Outcome C).
>
> If any of the four NOT_PROVEN operands traces to a NO - i.e. it
> is read elsewhere (e.g. cached on a long-lived provider object,
> resolved once per session, etc.) and not refreshed by the
> slot-overwrite + fresh-read seam - then Outcome B (forced rebuild)
> becomes causally justified, not merely architectural hygiene.
>
> R0 does NOT pre-commit. R0 + the §11 source-trace work freezes
> the operand-by-operand classification. §12 design freeze consumes
> that classification. R1 RED consumes §12.

---

# §3 — P1 fix: foundation ACT phase contract (the corrected lifecycle)

The foundation entry commit had two conflicting lifecycle claims in
the same ACT body:

```text
Entry preamble:
  PROD_EDITS = FORBIDDEN
  this ACT is recon-only
  any production change must be authored in a subsequent implementation ACT

Section 6 / Section 11 / Section 13 / Section 17:
  R1 RED -> GREEN minimum production change -> CONSERVATION
  (R1 + GREEN happen inside the foundation ACT)
```

Per the reviewer's prescribed fix, the foundation ACT is split into
two coherent phases.

## 3a. The two phases (per the reviewer's exact phrasing)

```text
FOUNDATION_RECON_PHASE =
  scope:
    §0..§12 of the foundation ACT body
    (entry, primary epistemic purpose, frozen question, terminology,
     scope firewall, semantic-vs-physical credential identity,
     epistemic sequence, the three recon streams, R0, R1 contract
     definition, design freeze)
  production edits: FORBIDDEN
  outputs:
    R0 frozen (component matrix, honest MUTATES_FULL_CONNECTION,
              R0_EVIDENCE = STRUCTURAL, R0_EXECUTED_SWITCH =
              NOT_EXECUTED, NOT_PROVEN operands traced to
              YES/NO/N/A verdicts)
    §12 design freeze (alpha/beta/gamma + semantic credential
                        identity + physical secret-key encoding)
  gating into FOUNDATION_IMPLEMENTATION_PHASE:
    R0 frozen (with all NOT_PROVEN operands classified)
    AND §12 design freeze recorded
    AND no halt conditions triggered
  output evidence files:
    00-preflight.txt
    01-connection-authority.md
    02-credential-storage-authority.md
    03-rebuild-discriminator.md
    04-r0-current-seam-witness.md  (corrected in this commit)
    05-r0-remaining-operand-trace.md  (NEW; produced in FOUNDATION_RECON_PHASE
                                        before §12 design freeze; per §2c
                                        above)
    06-design-freeze.md  (renamed from §12 evidence; produced as part of
                          FOUNDATION_RECON_PHASE §12 freeze)

FOUNDATION_IMPLEMENTATION_PHASE =
  scope:
    §13..§15 of the foundation ACT body (GREEN, conservation, halt
                                       conditions)
  production edits: AUTHORIZED ONLY AFTER
                      R0 frozen (component matrix complete) AND
                      §12 design freeze recorded AND
                      a genuine R1 RED (with NEXT_EFFECTIVE_CONNECTION
                                        assertion running against an
                                        injected/test-local registry;
                                        not against production code)
  outputs:
    GREEN (minimum change only; smallest set of production seams
                              that satisfies R1; per the foundation
                              ACT body's section 4 OWNS list)
    CONSERVATION (existing providerId-only users unchanged)
  output evidence files:
    07-green-minimum-change.md
    08-conservation.md

FOUNDATION_FINAL_REPORT_AND_HANDOFF =
  scope:
    §16 evidence directory plan, §17 implementation ACT gates,
    §35 successor linkage, STOP
  production edits: no further edits; this is a report + handoff
  outputs:
    09-final-report.md (the terminal freeze)
    §17 four-gate handoff to MODEL_PROFILES_IMPLEMENTATION

MODEL_PROFILES_IMPLEMENTATION =
  ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01
  remains separate and NOT_AUTHORIZED, gated on §17 four-gate handoff
  (reframed below in §3d)
```

## 3b. Why this preserves the foundation design (and is NOT an architecture cycle)

The reviewer said:

> This is **P1**, not another architecture cycle. Fold it into the
> same bounded R0 correction.

The two-phase split is a lifecycle clarification, not a design
change. The foundation ACT body retains:

- The same primary epistemic purpose (§1)
- The same frozen question (§2)
- The same terminology (§3)
- The same scope firewall (§4; minus the lifecycle confusion)
- The same semantic-vs-physical separation (§5)
- The same epistemic sequence (§6)
- The same recon streams (§7/§8/§9)
- The same R0 obligation, just measured component-by-component (§10)
- The same R1 contract (§11)
- The same §12 design freeze obligation (§12)
- The same GREEN, conservation, halt conditions (§13/§14/§15)
- The same evidence directory plan (§16; with file 05 renamed and
  a new file added for the §2c source-trace work)
- The same §17 implementation ACT gates (§17; reframed)
- The same §35 successor linkage (§35; with the phase split made
  explicit)

The only changes are:

1. M2 scalar -> component matrix (the P0 fix)
2. Lifecycle split into recon-phase vs implementation-phase (the P1 fix)
3. §17 gates reframed to gate phase 2 -> MP_IMPLEMENTATION, not
   foundation ACT's own closure

## 3c. What "any production change must be authored in a subsequent
implementation ACT" actually means (now clarified)

The foundation entry commit's entry preamble said:
> any production change must be authored in a subsequent implementation
> ACT that consumes the design freeze (§12) and the R1 result (§11).

The reviewer read this as conflicting with §13/§17's R1->GREEN->CONSERVATION
contract. The clarification (preserved in the corrected foundation ACT
body):

```text
The phrase "subsequent implementation ACT" was imprecise.

CORRECT READING:
  The foundation ACT has TWO phases (§3a). In FOUNDATION_RECON_PHASE,
  production edits are FORBIDDEN. FOUNDATION_RECON_PHASE outputs the
  R0 component matrix + §12 design freeze. Only then does
  FOUNDATION_IMPLEMENTATION_PHASE open, in which R1 RED -> GREEN ->
  CONSERVATION are produced. The GREEN + CONSERVATION of
  FOUNDATION_IMPLEMENTATION_PHASE ARE production edits, but they
  happen in the SAME foundation ACT body, in its implementation phase.

  What remains in a "subsequent ACT" (i.e. separate from the foundation
  ACT) is MODEL_PROFILES_IMPLEMENTATION, which is gated on §17
  four-gate handoff. The foundation ACT's GREEN + CONSERVATION are
  the minimum-viable runtime instance-switch seam; MODEL_PROFILES_
  IMPLEMENTATION builds the user-facing Profile CRUD, picker UI,
  defaultProfileId, activeProfileId semantics, and "Set as default"
  UI on top of that foundation.
```

This reading matches the reviewer's explicit phrasing:

> Pick one meaning. Given the established handoff, I recommend:
>   FOUNDATION_RECON_PHASE:
>     production edits forbidden through R0 + §12
>   FOUNDATION_IMPLEMENTATION_PHASE:
>     production edits authorized only after
>     R0 freeze + §12 design freeze + R1 genuine RED
>   MODEL_PROFILES_IMPLEMENTATION:
>     remains separate and unauthorized
> That preserves the intended single causal foundation ACT without
> pretending it remains "recon-only" after RED.

## 3d. §17 reframed (the handoff gates)

The foundation entry commit's §17 listed 4 gates that all needed to
pass before MP_IMPLEMENTATION opened:

```text
GATE_FOUNDATION_CLOSED
GATE_SCOPE_TRANSFERRED
GATE_PERSISTENCE_AUTHORITY
GATE_OUT_OF_SCOPE_STILL_OUT
```

After this correction, §17 keeps those 4 gates but reframes what
they gate:

```text
§17 (CORRECTED) — Implementation ACT gates (still NOT authorized)

GATE_FOUNDATION_CLOSED:
  FOUNDATION_RECON_PHASE closed:
    R0 component matrix frozen (every operand YES/NO/N/A)
    §12 design freeze recorded
    no halt conditions triggered (§15)
  FOUNDATION_IMPLEMENTATION_PHASE closed:
    §13 GREEN recorded (minimum change only)
    §14 conservation proven (providerId-only users unchanged)
    §15 halt conditions not triggered

GATE_SCOPE_TRANSFERRED:
  ProviderConfigurationInstance schema (alpha/beta/gamma choice) handed off
  Semantic credential identity scope handed off
  R0 component matrix handed off as the baseline citation
  Per-session instance-binding seam CHARACTERIZED (not bound) handed off

GATE_PERSISTENCE_AUTHORITY:
  Per §4 OWNS list + §6 step 7 + §13 GREEN:
    Foundation ACT may have introduced runtime instance-switch seam +
    semantic credential identity resolution + R0->R1 traceability hooks.
    Foundation ACT does NOT bind durable storage location.
  Implementation ACT may now bind durable storage location
  (this ACT's step 7 was only characterization)

GATE_OUT_OF_SCOPE_STILL_OUT:
  All §4 OWNS / DOES NOT OWN boundaries preserved through the handoff
  PLUS the new FOUNDATION_RECON_PHASE vs FOUNDATION_IMPLEMENTATION_PHASE
  split is reflected in the implementation ACT's own entry preamble
```

Until all four gates are met, `MODEL_PROFILES_IMPLEMENTATION = NOT_AUTHORIZED`.

---

# §4 — What this correction does NOT do

Per the reviewer's explicit "DO NOT" list:

```text
DO NOT start R1
DO NOT choose alpha/beta/gamma
DO NOT add persistence
DO NOT open another review cycle
```

This correction:

```text
- does NOT start R1 (R1 is gated on §12 design freeze, which is gated
  on the corrected R0 + the §2c source-trace work for the NOT_PROVEN
  operands; both are recon-phase work, not R1)
- does NOT choose alpha/beta/gamma (§12 design freeze owns that;
  this commit corrects §10 R0 only)
- does NOT add persistence (§4 OWNS list + §6 step 7 + §13 GREEN all
  still exclude durable storage; per-session instance-binding seam is
  CHARACTERIZATION only)
- does NOT open another review cycle (this is the bounded P0+P1
  correction the reviewer authorized; after this commit, the next
  useful work is the §2c source trace for the NOT_PROVEN operands +
  §12 design freeze + R1 RED, all under the corrected foundation ACT
  body, no further pre-execution review unless this correction
  exposes a new P0)
```

---

# §5 — Disposition

```text
VERDICT_ADDRESSED:
  HALT_R0_FULL_CONNECTION_NOT_PROVEN

P0 =
  R0_FULL_CONNECTION_OVERCLAIM
    M2 scalar replaced with component matrix (per §2a)
    MUTATES_FULL_CONNECTION derived honestly (NOT_PROVEN, not YES)
    R0_EVIDENCE = STRUCTURAL labeled
    R0_EXECUTED_SWITCH = NOT_EXECUTED labeled
    NOT_PROVEN operands (headers, providerSpecificConfig, apiLine/
      routing, region) traced to per-component YES/NO/N/A verdicts
      in recon phase before §12 design freeze
    "What R0 changes for §12 design freeze" reframed:
      no pre-commit to Outcome A/C; no pre-commit to Outcome B
      the §2c source trace is the discriminator

P1 =
  FOUNDATION_ACT_PHASE_CONTRACT_INCONSISTENT
    Foundation ACT body split into:
      FOUNDATION_RECON_PHASE      (R0 + §12 design freeze; prod
                                    edits FORBIDDEN)
      FOUNDATION_IMPLEMENTATION_PHASE
                                   (R1 RED + GREEN + CONSERVATION;
                                    prod edits AUTHORIZED ONLY after
                                    R0 + §12 + genuine R1 RED)
    §17 gates reframed to gate phase 2 -> MP_IMPLEMENTATION
    §35 successor linkage updated to name the two phases
    Entry preamble of foundation ACT body updated to make the
      phase split explicit (so a future reader does not hit the
      same contradiction)

P2 =
  NONE worth acting on now (reviewer explicit)

NEXT =
  Recon phase:
    1. trace the §2c NOT_PROVEN operands in evidence 05-r0-remaining-
       operand-trace.md (new file, owned by FOUNDATION_RECON_PHASE;
       produces per-component YES/NO/N/A verdicts)
    2. record §12 design freeze (alpha/beta/gamma + semantic credential
       identity + physical secret-key encoding) in evidence 06-design-
       freeze.md
  Implementation phase (only after recon phase closes):
    3. R1 RED against an injected/test-local ProviderConfigurationInstance
       registry (evidence 07-r1-red-instance-switch.md; the R0 ->
       R1 ordering constraint in MP RECON evidence 13 v3 forbids
       skipping R0; R0 is now the corrected component matrix from
       evidence 04 + the source-trace work from evidence 05)
    4. GREEN (evidence 08-green-minimum-change.md)
    5. conservation (evidence 09-conservation.md)
  Final report:
    6. terminal freeze (evidence 10-final-report.md)
    7. §17 four-gate handoff to MODEL_PROFILES_IMPLEMENTATION

DO NOT (per reviewer):
  - start R1
  - choose alpha/beta/gamma
  - add persistence
  - open another review cycle
```

---

# §35 — Successor linkage (corrected chain)

```text
PREDECESSORS:
  F3 / F3B Factorize                                   -> bfa2ad592
  MP RECON open                                         -> b55407d03
  MP RECON P1 wording correction                        -> 97f49582e
  MP RECON P2 correction                                -> 830be436
  MP RECON P3 correction                                -> 951f171e
  MP RECON P4 correction (FOUNDATION AUTH)              -> af1df4a60
  Foundation ACT entry (R0 frozen, M2 scalar overclaim) -> 40bdeeac2
  Foundation ACT P1-CORRECTION01 (this commit)          -> <this commit>

IN-SCOPE SUCCESSOR:
  FOUNDATION_RECON_PHASE:
    evidence 05-r0-remaining-operand-trace.md  (NEW; recon work)
    evidence 06-design-freeze.md               (alpha/beta/gamma +
                                                 semantic credential
                                                 identity + physical
                                                 secret-key encoding)
  FOUNDATION_IMPLEMENTATION_PHASE:
    evidence 07-r1-red-instance-switch.md      (gated on §11 + R0
                                                 corrected)
    evidence 08-green-minimum-change.md
    evidence 09-conservation.md
  FOUNDATION_FINAL_REPORT_AND_HANDOFF:
    evidence 10-final-report.md
    §17 four-gate handoff

OUT-OF-SCOPE SUCCESSOR (NOT yet authorized):
  ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01
    (gated on §17 four-gate handoff)

INDEPENDENTLY REGISTERED (NOT gated by this ACT):
  ACT-CLINEMM-EFFECTIVE-MODEL-CONTEXT-WINDOW-AUTHORITY-RECON01
  ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-ASYNC-JOB-WAKE-OWNERSHIP-RECON01

REVIEWER-PRESCRIBED EXECUTION SEQUENCE (verbatim, unchanged):
  1. recon exact current connection authority
  2. R0 current-seam characterization
  3. choose alpha / beta / gamma only from measured blast radius
  4. bind credential identity namespace
  5. RED instance A -> B effective-config transition (R1)
  6. minimal repair
  7. conservation for existing providerId-only users
  8. session-binding seam characterization
  9. stop
```

---

# §7.4 — Terminal verdict

This bounded correction closes the reviewer's named P0 (R0 overclaim)
and P1 (phase contract inconsistency). The foundation ACT body's
section 10 (R0) is amended to the component matrix; the foundation ACT
body's section 4 (scope firewall) is amended to split
FOUNDATION_RECON_PHASE from FOUNDATION_IMPLEMENTATION_PHASE; section
13 (GREEN) and section 17 (gates) are reframed accordingly; the entry
preamble is amended to make the phase split explicit; and §35 successor
linkage is updated.

The foundation design is NOT reopened. No new architecture cycle.

After this commit, the recon phase resumes:
  (a) trace the four NOT_PROVEN operands to YES/NO/N/A
  (b) record §12 design freeze (alpha/beta/gamma + semantic
      credential identity + physical secret-key encoding)
  (c) gate FOUNDATION_IMPLEMENTATION_PHASE open

The implementation phase (R1 RED -> GREEN -> conservation) opens ONLY
after (a) + (b) + (c) all close, per the corrected §17 gates.

```text
REOPEN_CONDITION = "the corrected R0 component matrix is frozen and
                    the ACT phase contract is coherent"
```

Both conditions are met by this commit:

```text
R0 component matrix   = FROZEN  (this commit, evidence 04 + §10 amendment)
ACT phase contract    = COHERENT  (this commit, §4 + §13 + §17 + entry
                                     preamble + §35 amendment)
```

C1: GO TO §12 DESIGN FREEZE + R1 RED. No further pre-execution review
unless this correction exposes a new P0.
