# ACT-CLINEMM-TASK-COST-TRUTH-RECON01

> Status: **OPEN / HOLD_FOR_EXECUTION** — recon-only ACT; reframed
> 2026-08-27 against the **billing-semantics layer** that sits
> ABOVE the per-request arithmetic layer. Two reconnaissance
> surfaces are now in scope:
>
>   (a) per-request cost provenance (the original framing) — does
>       `TASK_DISPLAYED_COST` equal `Σ` authoritative per-request
>       cost evidence?
>
>   (b) **billing-semantic presentation** (the reframed layer) —
>       does the displayed monetary value have a TRUTHFUL economic
>       semantic for the active credential / billing mode?
>
> The reframing is forced by an expert product/accounting review
> against a real MiniMax Ultra Token Plan task (see `.factory/evidence/
> ACT-CLINEMM-TASK-COST-TRUTH-RECON01/probe-minimax-ultra-billing-semantics.md`).
> For Ultra, the user's marginal monetary bill depends on the
> quota state of the Token Plan credential, which we have NOT
> established at recon time. What is established is the
> economic invariant:
>
> ```text
> PAYG_EQUIVALENT_ESTIMATE  ≠  AUTHORITATIVE_USER_BILLED_COST
> ```
>
> i.e. the displayed dollar figure on a Token Plan credential is
> a list-price API-equivalent (in the MiniMax Ultra case, ≈
> `$0.8236` per the captured task), not the user's marginal bill.
> ClineMM labelling that figure as task spend without that
> distinction is the Layer-2 bug; the arithmetic itself (Layer 1)
> is **forecasted** to be Bucket C but is NOT established until
> §3 captures a real task and §4 classifies the forensic cell.
> Until §3 / §4 land, Layer 1 = UNPROVEN, Layer 2 = II
> (subscription), runtime plan binding = UNPROVEN, and the
> forecasted cell = (C, II) is forecast only — not established.
>
> Held until the operational frontier
> (`ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01`,
> `OPEN / WAITING_FOR_LIVE_SPECIMEN`) is bound, then picked up
> as the next independent product recon.
>
> **Primary purpose**: discover whether `TASK_DISPLAYED_COST` is a
> well-defined projection of authoritative per-request cost
> evidence, AND whether its **billing-semantic labelling** is
> truthful for the active credential — NOT pre-judge any specific
> dollar amount or any specific billing mode. RED is gated on
> either layer producing a reproducible break, NOT on the dollar
> value being high or low.
>
> **Predecessor**: none — first ACT in the cost-truth recon lane.
> `EPIC-CLINEMM-COST-DISPLAY-TRUTH01` is CLOSED (canonical cost
> source contract, plus the `"show" | "hide" | "subscription"`
> `usageCostDisplay` invariant). This ACT targets a *different*
> surface:
>
>   - The closed contract governs: where the cost value comes FROM.
>   - This ACT governs: what the cost value CLAIMS to represent
>     for the active credential, AND whether the per-request
>     arithmetic that backs it is reproducible.
>
> **Forecasted exit (per expert review):**
> `PASS_COST_PROVENANCE_PRESENTATION_REPAIR_V1` — a
> presentation-repair ACT, NOT an accumulator-repair ACT. Minimal
> repair: relabel the TaskHeader `#price-tag` from `$X.YYYY` to
> `≈$X.YYYY` with an explicit tooltip clarifying that the value is
> a PAYG / list-price API-equivalent estimate and that actual
> charges may differ for subscriptions, token plans, credits,
> caching, or provider billing. Upstream-compatible; safe even if
> we cannot detect the active billing mode. A follow-on, MiniMax-
> specific enhancement (e.g. "Ultra quota used / remaining") is
> deferred behind Phase 0 — see §11.
>
> **Owning epic**:
> [`EPIC-PRODUCT-CONFIG-BRANDING`](../epics/product-config-branding.md)
> · cost-display-truth umbrella · "Open work" backlog.

---

## §0 — Stop rule

This ACT halts at `HALT_COST_NOT_REPRODUCED` if §3 cannot reproduce
the TaskHeader dollar figure from authoritative per-request evidence
on a fresh task of the same provider/model. The dollar amount itself
is **NEVER** the stop rule; the two invariants below are.

The two invariants under recon:

```text
INVARIANT 1 — ARITHMETIC (original framing, retained as subordinate):
   Σ canonical per-request cost estimates  ≡  TASK_DISPLAYED_COST
   within the documented rounding tolerance.

INVARIANT 2 — BILLING SEMANTIC (reframed layer, primary):
   DISPLAYED_MONETARY_VALUE has a truthful economic semantic for
   the active credential / billing mode:

     I.    PAYG credential (genuinely metered, billing mode observable):
              displayed cost MAY represent estimated/request cost.

     II.   SUBSCRIPTION / TOKEN PLAN / QUOTA-INCLUDED credential:
              PAYG-equivalent estimate MUST NOT be presented as
              actual task spend. Either suppress or relabel
              "≈ $X.YYYY (API-equivalent)" + tooltip.

     III.  UNKNOWN BILLING MODE (catalog unresolved, credential
              shape uninterpretable):
              value MUST be labelled "estimated / equivalent" or
              suppressed. Never presented as "this task cost you X."

     IV.   PROVIDER-SUPPLIED AUTHORITATIVE COST (billing mode
              observable via provider response):
              use the provider's value, labelled as such.
```

`HALT_BILLING_SEMANTIC_UNPROVEN` is the new halt gate parallel to
`HALT_COST_NOT_REPRODUCED`: if the recon cannot determine which of
I / II / III / IV applies to a captured specimen, the §3 capture is
incomplete and the ACT cannot classify into a presentation-repair
verdict.

## §1 — Entry discipline

Authored under the standard ACT gate contract. This launch is
docs/governance-only. **No production files are modified. No tests
are added. No upstream wholesale copy.** Durable launch artifacts
in this commit are:

```text
- this ACT file (.factory/acts/ACT-CLINEMM-TASK-COST-TRUTH-RECON01.md)
- board bookkeeping (.factory/epic-board.md frontier row)
- epic ledger row (.factory/epics/product-config-branding.md)
- minimal .gitignore durability whitelist entry
  (mirrors the ACT + evidence dir whitelist pattern; the evidence
   dir is reserved here for the §3 / §4 / §5 captures that will
   land in a future commit)
```

This ACT is the recon contract; the per-request cost provenance
itself is NOT in this commit. Recon only.

## §2 — Scope (two-layer recon)

### Layer 1 — Per-request cost provenance (retained)

```text
TaskHeader dollar figure       (UI display)
   ↑ projected by
TaskHeader.cost / useProviderUsageCostDisplay
   ↑ reads from
Canonical session cost source (CLINEMM canonical cost API)
   ↑ produced by
Per-request cost accumulation across the API stream
   ↑ bounded by
provider-reported cost (when available)
   OR
locally-computed cost = Σ (token × pricing-metadata)
```

Arithmetic bug here is one of:

```text
(A) arithmetic bug in Σ or in display rounding
(B) retry duplication (the same billed request counted twice)
(C) cumulative-context cost is correct, just high (legitimate)
(D) pricing metadata wrong (tokens × price gives a wrong number)
(E) provider-reported cost differs from local estimate without
    the display saying so (silent mixing)
```

### Layer 2 — Billing-semantic presentation (NEW, primary)

```text
TaskHeader dollar figure       (UI display)
   ↑ LABELS as
   "spent by user"  |  "API-equivalent"  |  "estimated"
   ↑ derived from
Active credential's billing mode
   ↑ bounded by
provider / catalog / response-stream evidence
```

Semantic bug here is one of:

```text
(F) subscription / token-plan credential is shown as PAYG spend
    (the §0 MiniMax-Ultra case) — the displayed number is a
    list-price API-equivalent, not the user's marginal charge
(G) unknown billing mode is shown as PAYG spend (catalog
    loading state or future SDK value)
(H) provider-billed value is shown without "provided by X"
    attribution
```

A **Layer‑2 bug** can exist even when Layer 1 is Bucket C
("arithmetic is fine"). The original framing conflated the two;
this ACT treats them as independent recon surfaces.

### Bucket-to-Layer mapping (forensic)

| Layer 1 verdict | Layer 2 verdict | ACT outcome |
|---|---|---|
| A, B, D, E (any arithmetic bug) | irrelevant | accumulator REPAIR |
| C (arithmetic correct) | I (PAYG, mode observable) | C1: GO (`COST_PROVENANCE_ARITHMETIC_VERIFIED`) |
| C | II, III (sub / unknown) | **F / G** → presentation REPAIR (`PASS_COST_PROVENANCE_PRESENTATION_REPAIR_V1`) |
| C | IV (provider-billed) | minor attestation pass; H if attribution missing |

The expert review's actual case — MiniMax Ultra Token Plan at
`$0.8236` — is the **forecasted** ACT exit. Until §3 captures a
real task and §4 classifies the forensic cell, the
classification is:

```text
Layer 1 = UNPROVEN          (arithmetic not yet exercised end-to-end)
Layer 2 = II                (subscription / token-plan mode inferred
                              from the upstream context, not yet
                              observed in the captured task)
Runtime plan binding = UNPROVEN
Forecasted cell = (C, II)   (only)
```

A `PASS_COST_PROVENANCE_PRESENTATION_REPAIR_V1` ACT may be
authored **only after** (C, II) is established, not before.
The forecasted cell is not a precondition for the presentation
repair; the economic invariant
`PAYG_EQUIVALENT_ESTIMATE != AUTHORITATIVE_USER_BILLED_COST`
is — and that invariant holds regardless of which Layer-1
bucket the actual case falls into.

### What is explicitly NOT in scope

- Re-litigating the canonical cost source contract
  (`EPIC-CLINEMM-COST-DISPLAY-TRUTH01` is CLOSED).
- Changing pricing metadata.
- Inventing a new cost display projection.
- Modifying the TaskHeader layout (a tiny relabel `→ ≈$` + tooltip
  is in-scope for the follow-on presentation-repair ACT, NOT for
  this recon).
- Provider plan / quota detection (Phase 0 — see §11).

## §3 — Live specimen (NOT YET CAPTURED)

### Required live matrix (extended for Layer-2)

```text
# Layer-1 fields (per-request arithmetic provenance)
taskId
provider
model
total input tokens (sum across requests)
total output tokens (sum across requests)
cache reads (sum across requests)            if applicable
cache writes (sum across requests)           if applicable
number of requests
provider-reported cost (if available)
locally-computed cost = Σ tokens × pricing-metadata
displayed TaskHeader cost (frozen at the same instant)
correlation / stateVersion for the displayed value

# Layer-2 fields (billing-semantic provenance)
apiProvider from modeFields                       (catalog id)
useProviderUsageCostDisplay(apiProvider) result   (show | hide |
                                                   subscription |
                                                   undefined)
provider listing's usageCostDisplay value         (raw SDK string;
                                                   may differ from
                                                   the hook's
                                                   returned value
                                                   for forward /
                                                   unknown cases)
credential_observability_class = one of
   "key-shape-distinguishable"   (e.g. MiniMax Token Plan keys,
                                 IF MiniMax documents that
                                 distinction — UNKNOWN today,
                                 see §11 Phase 0)
 | "response-shape-distinguishable"
                                 (e.g. provider returns a
                                 `plan` / `quota` field)
 | "shape-not-distinguishable"  (SDK / ClineMM has no way to
                                 know which credential plan a
                                 given key is on)
evidence_for_the_above (documented spec, observed header, or
                        captured response field — cite the source)
billing_semantic_verdict:  I | II | III | IV | UNPROVEN
```

Capture policy: freeze **before** the displayed cost changes; record
provider-reported vs local-estimate in the same capture. If the
display value changes mid-capture, both frozen snapshots are evidence.

### STOP AFTER MATRIX

Do not move to §4 until the matrix is fully captured — Layer-1 AND
Layer-2. A partial matrix halts at `HALT_MATRIX_INCOMPLETE` (if
Layer-1 is missing) or `HALT_BILLING_SEMANTIC_UNPROVEN` (if
Layer-2 is missing). The two halt gates are parallel.

## §4 — Primary discriminator (deferred to §3)

### Layer-1 discriminator (subordinate, retained)

```text
A ⇒ RED: arithmetic / rounding bug
B ⇒ RED: retry-duplication / double-count bug
C ⇒ CLOSING: legitimate cumulative cost (verify in §5)
D ⇒ RED: pricing-metadata bug
E ⇒ RED: silent cost-source mixing (worst kind — affects
         user-trust boundary)
```

### Layer-2 discriminator (NEW, primary)

The discriminator that determines whether the displayed monetary
value has a truthful economic semantic for the active credential:

```text
PAYG (genuinely metered, billing mode observable)
   ⇒ I: displayed cost MAY represent per-request / per-task spend.
        No presentation repair needed IF the credential's billing
        mode is observably PAYG (e.g. standard MiniMax PAYG key,
        OpenRouter PAYG, etc.). The arithmetic layer's verdict
        (A..E) is then the whole story.

SUBSCRIPTION / TOKEN PLAN / QUOTA-INCLUDED (Flat rate, or per-month
quota that the requests consume)
   ⇒ II: PAYG-equivalent estimate MUST NOT be presented as task
         spend. Either suppress the value or relabel `≈$X.YYYY`
         with a tooltip explaining it is an API-list-price
         equivalent. The MiniMax Ultra Token Plan case from §0
         lands here. Closes via presentation repair, not
         accumulator repair.

UNKNOWN BILLING MODE (catalog unresolved, credential shape
uninterpretable, or future SDK value the webview does not yet
recognise)
   ⇒ III: value MUST be relabelled "estimated / equivalent" or
          suppressed. The current `useProviderUsageCostDisplay`
          hook already returns `"hide"` for these cases (see
          `apps/vscode/webview-ui/src/hooks/useProviderUsageCostDisplay.ts`),
          which is the conservative end of III; the question for
          the presentation-repair ACT is whether IIIa (relabel)
          is preferable to IIIb (suppress) when the SDK later
          becomes willing to admit uncertainty vs. silence.

PROVIDER-SUPPLIED AUTHORITATIVE COST (the API response contains
a `usage.cost` / equivalent dollar field)
   ⇒ IV: use the provider's value, labelled "provided by X" so
         the user understands it is the provider's own billed
         amount, not a ClineMM-computed estimate. The
         presentation-repair ACT may need a small IVa attestation
         if such attribution is currently absent.
```

### Combined outcome (Layer-1 × Layer-2)

The two discriminators compose per §2's forensic table. MiniMax
Ultra at `$0.8236` is the canonical *(Layer-1 = C, Layer-2 = II)*
case and forecasts the `PASS_COST_PROVENANCE_PRESENTATION_REPAIR_V1`
exit. **This is forecast only.** Bucket C does NOT trigger RED at
the accumulator level; it triggers the Layer-2 verdict that
drives the presentation-repair follow-on.

```text
Layer 1 = UNPROVEN          (forecasted to be Bucket C; not yet
                              established by §3 capture)
Layer 2 = II                (subscription / token-plan; inferred
                              from the expert review's product
                              context, not yet observed in a
                              captured ClineMM task)
Runtime plan binding = UNPROVEN
Forecasted cell = (C, II)   (only)
```

A `PASS_COST_PROVENANCE_PRESENTATION_REPAIR_V1` ACT may be
authored under the economic invariant
`PAYG_EQUIVALENT_ESTIMATE != AUTHORITATIVE_USER_BILLED_COST`
without waiting for §3 / §4 — that invariant is established by
the upstream product context alone. The presentation-repair ACT
must NOT cite Layer-1 = C as evidence; it must cite only the
invariant.

No preferred verdict is pre-baked. The Layer-1 × Layer-2 pair is
the *output* of §3 + §4, not its input.

## §5 — Causal chronology (deferred to §3)

For Bucket C (correct-cumulative cost), verify independently:

```text
Σ request costs (independently recomputed from the request log)
   === displayed TaskHeader cost
```

within the documented rounding tolerance. Independence here means:
recompute from the raw request stream (NOT from whatever the
canonical source was reading from). If the two disagree, classify
into A / B / D / E and halt at the appropriate gate.

## §6 — RED (deferred to §3)

Not authored in this ACT. RED is gated on §3 producing A, B, D, or
E with sufficient evidence. Bucket C produces no RED — it produces
a §10 conservation suite and a C1 GO.

If §3 cannot reproduce the TaskHeader cost from authoritative
evidence, this ACT halts at `HALT_COST_NOT_REPRODUCED` and the
backlog is amended with a SECOND-recon ACT (cannot do first-attempt
diagnosis without reproduction).

## §7 — Necessity / ablation (deferred to §3)

Per spec. Only required if RED lands (A, B, D, or E).

## §8 — Permitted repair boundaries (deferred to §3)

Per spec. No preferred bucket is pre-baked.

### External radar (informational only)

```text
EXTERNAL_RADAR:
Upstream has had repeated fixes around missing/fallback cost
retrieval and provider-specific cost tracking (Cline's issue
tracker records several "surprising charge" reports against the
extension). That is a real historically fragile surface in any
LLM-extension fork.

Recording this here so the live matrix in §3 captures provider-
reported cost presence/absence explicitly — so a future review
can distinguish "the provider simply does not return cost"
from "the runtime silently mixed estimates".
```

This radar must NOT influence A..E classification. Recording it
only so the evidence gap (provider-reported absent) is captured
cleanly.

## §9 — Explicit forbidden repair

```text
DO NOT:
  - replace the displayed cost with a hand-computed re-estimate
    that does not match the canonical source contract
  - cap or truncate the displayed cost to "look less scary"
  - silently re-base the displayed cost from local-estimate to
    provider-reported (or vice versa) without flagging the change
  - widen the canonical cost source contract
    (EPIC-CLINEMM-COST-DISPLAY-TRUTH01 is closed; do not relitigate)
```

## §10 — Conservation suite (deferred to §3 / §5)

Bucket C conservation (the expected case):

```text
independently recomputed Σ request costs
   === displayed TaskHeader cost
within the documented rounding tolerance
```

Plus the standard EAF-C01..C14 suite only if RED lands (A, B, D, or E).

## §11 — Temporary instrumentation + Phase 0 (provider plan detection)

### Instrumentation (Layer-1)

The existing diagnostic / request-usage / cost surfaces (the
canonical cost source, the per-request cost accumulator, the
provider-response stream) are the **first capture path to try** for
§3 Layer-1. Their sufficiency for binding the complete §3 matrix is
**NOT_YET_PROVEN** — that is precisely what §3 will determine.

If any required field in §3 cannot be bound from the existing
surfaces, halt at `HALT_SEAM_MISSING` and record the missing seam
as evidence for a follow-on ACT. No new instrumentation is
authorized in this ACT; if a seam must be added, it is a follow-on
ACT, not an in-this-ACT instrumentation patch.

PTAD is **not** a presumed source of cost truth. It is a
post-terminal authority diagnostic; its usefulness here is limited
to identity / state binding for §3 correlation. See §14.

### Phase 0 (Layer-2 — MiniMax plan detection)

Per the expert review's "Important constraint: can Cline detect
Ultra?" section: determining whether the credential format itself
distinguishes Token Plan keys, whether MiniMax exposes
account/plan metadata through an API, whether the response
contains billing-plan metadata, or whether Cline currently knows
none of this, is a precondition for the *optional* Layer-2
MiniMax-specific follow-on (e.g. "Ultra quota used / remaining").

Phase 0 rules:

```text
- DO NOT infer Ultra from the key string alone unless MiniMax
  documents that distinction.
- DO NOT commit to provider-id string matching in the SDK for
  Ultra detection (forbidden by the repo-wide
  "provider-exception" rule).
- DO treat catalog / response-shape evidence as the only
  defensible source.
- If none of (key shape, account API, response metadata) is
  safely observable, fall back to Layer-2 III (conservative
  hide / relabel) and stay there. Do not speculate.
```

Phase 0 is **NOT a precondition** for closing this ACT or for
spawning the presentation-repair ACT (which uses the safe global
relabel `≈$X.YYYY` + tooltip). Phase 0 only enables the optional
MiniMax-specific enhancement that would replace the disclaimer with
authoritative plan-aware cost.

## §12 — Forbidden side effects

No source files modified. No tests added. No provider defaults
changed. No `package.json` cost metadata edited.

## §13 — Gates

Recon (this ACT, two-layer):
```text
[ ] L1_LIVE_HEADER_COST_FROZEN     (deferred to §3)
[ ] L1_REQUEST_STREAM_INVENTORIED  (deferred to §3)
[ ] L1_PROVIDER_REPORTED_COST_PRESENT (deferred to §3)
[ ] L1_INDEPENDENT_SIGMA_VERIFIED   (deferred to §3 / §5)
[ ] L1_BUCKET_A_TO_E_SELECTED      (deferred to §3)

[ ] L2_USAGE_COST_DISPLAY_FROZEN   (deferred to §3)
[ ] L2_CREDENTIAL_OBSERVABILITY_BOUND (deferred to §3)
[ ] L2_VERDICT_I_TO_IV_SELECTED    (deferred to §3)

[x] PASS_RECON_SURFACE_MAPPED      (this ACT — both layers +
                                    invariants + forbidden-repair)
[x] PASS_NO_PREFERRED_BUCKET       (this ACT — no verdict pre-baked)
[x] PASS_BILLING_SEMANTIC_FRAMEWORK_RECORDED (this ACT — Layer-2
                                              I/II/III/IV + Phase 0
                                              policy committed)
```

Unticked-on-purpose: any gate above `[ ]` is `NOT_YET_CAPTURED`,
not `PASS`. Promotion rules forbid the latter without a specimen.

Repair (NOT in this ACT, only if Layer-1 A/B/D/E OR Layer-2 F/G/H):
```text
# Layer-1 (arithmetic) repair — only for A/B/D/E buckets
[ ] RED_REAL_PRODUCTION_SEAM
[ ] CAUSAL_ABLATION
[ ] GREEN
[ ] EAF-C01..C14
[ ] TYPECHECK
[ ] TARGETED_VITEST
[ ] LINT/BIOME
[ ] git diff --check
[ ] exact-head dogfood

# Layer-2 (presentation) repair — for F/G verdicts; spawns the
# separate `ACT-CLINEMM-PASS-COST-PROVENANCE-PRESENTATION-REPAIR-V1`
# ACT. This document does NOT carry the repair gates here.
```

The presentation-repair ACT is forecasted as the canonical exit
for the MiniMax Ultra case (Layer-1 = C, Layer-2 = II). Whether
the live specimen at §3 actually lands there or in another
forensic cell of §2's bucket-to-layer mapping table is determined
by §3 evidence, not by this ACT.

## §14 — Live qualification

Use the existing request / usage / cost diagnostics discovered in
§3 to bind the §3 matrix. The canonical per-request cost stream
and the provider-response stream are the natural primary surfaces;
the canonical session cost source is the verification surface.

PTAD may be enabled **only** if useful for task / session / state
correlation (e.g. to bind the TaskHeader capture to a specific
runtime session epoch). PTAD is **not** a source of cost truth
unless §3 recon proves otherwise — its semantics are
post-terminal authority diagnostic, not per-request cost
provenance.

Standard dogfood path: build exact-head VSIX and bind via the
same codeium/CLINEMM invocation pattern used by IMPLEMENTATION01
§9. Run one task of the same provider/model shape as the captured
screenshot, freeze the §3 matrix before the cost changes, and
proceed to §4 / §5.

## §15 — Evidence layout

```text
.factory/evidence/ACT-CLINEMM-TASK-COST-TRUTH-RECON01/
    probe-minimax-ultra-billing-semantics.md   (this commit —
                                               Layer-2 retrospective
                                               analysis that prompted
                                               the ACT reframe)
    live-matrix.md            (the §3 frozen matrix — both layers)
    bucket-classification.md  (the §4 verdict with evidence —
                               Layer-1 × Layer-2 forensic cell)
    independent-sigma.md      (the §5 independent recomputation)
    downstream-decisions.md   (C1: GO with (C,I), or RED author
                               for (A/B/D/E,*) or (C,II/III))
```

factory/docs ≤ 3 (this ACT + the Layer-2 retrospective already
authored + the deferred §3/§4/§5 captures that will land in
future commits).

## §16 — Cost-trace ACT relationship

This ACT does NOT supersede `EPIC-CLINEMM-COST-DISPLAY-TRUTH01`
(CLOSED). It targets a *different* surface:

```text
COST-DISPLAY-TRUTH01  = display-source contract           (CLOSED)
COST-DISPLAY-TRUTH01.CORRECTION01..02
                       = usageCostDisplay allowlist        (CLOSED)
TASK-COST-TRUTH-RECON = TWO-LAYER recon:

   Layer 1 = per-request cost provenance within
             the request/display stream         (subordinate)
   Layer 2 = billing-semantic presentation      (primary;
             — formerly out-of-scope; reframed 2026-08-27)
```

The closing condition for this ACT is now **Layer-1 × Layer-2**:

```text
(C, I):       ACT closes with C1: GO
              (arithmetic verified, PAYG mode observable)
              label: COST_PROVENANCE_ARITHMETIC_VERIFIED

(A/B/D/E, *): ACT halts at RED-LAYER-1, accumulator repair ACT
              spawned (under §6 / §7 / §8)

(C, II):      ACT halts at RED-LAYER-2; presentation-repair ACT
              PASS_COST_PROVENANCE_PRESENTATION_REPAIR_V1
              spawned (forecasted by the expert review against
              the MiniMax Ultra case)

(C, III):     ACT halts at RED-LAYER-2-G; presentation-repair ACT
              spawned (same family as (C, II))

(*, H):       ACT halts at RED-LAYER-2-H; presentation-repair ACT
              spawned for missing provider attribution
```

## §17 — Halt conditions (closed-class)

```text
# Layer-1 halts (original, retained)
HALT_COST_NOT_REPRODUCED       — §3 cannot reproduce the displayed
                                  cost from authoritative evidence
HALT_MATRIX_INCOMPLETE        — §3 Layer-1 partial matrix; capture
                                  must resume, not classify
HALT_SEAM_MISSING             — diagnostic seam absent; need a
                                  follow-on ACT, not a repair
HALT_PROVIDER_COST_ABSENT     — provider-reported cost is structurally
                                  unavailable; §3 must capture the
                                  local-estimate basis explicitly and
                                  classify into D or E (or C-with-
                                  estimate caveat)

# Layer-2 halts (NEW — parallel gate)
HALT_BILLING_SEMANTIC_UNPROVEN — §3 cannot determine which of
                                  I / II / III / IV applies to the
                                  captured credential. Capture must
                                  resume with one of (key-shape,
                                  response-shape, plan-API, "shape-
                                  not-distinguishable") observability
                                  classification bound.
HALT_PHASE_0_INCOMPLETE       — for cases that resolve to (C, II) or
                                  (C, III) with observation-dependent
                                  attribution: §11 Phase 0 must be
                                  either completed or explicitly
                                  deferred-before-presentation-repair.
                                  Otherwise halt.
```

Stop here. **C1: GO_WAIT_FOR_LIVE_TASK**, with the two-layer
framework committed.
