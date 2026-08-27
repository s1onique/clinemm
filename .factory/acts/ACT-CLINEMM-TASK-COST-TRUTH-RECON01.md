# ACT-CLINEMM-TASK-COST-TRUTH-RECON01

> Status: **OPEN / HOLD_FOR_EXECUTION** — recon-only ACT; binds
> the TaskHeader dollar figure to authoritative per-request cost
> evidence so the "is `$0.8236` correct, surprising, or buggy?"
> question collapses into a deterministic accounting invariant.
> Held until the operational frontier
> (`ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01`,
> `OPEN / WAITING_FOR_LIVE_SPECIMEN`) is bound, then picked up
> as the next independent product recon.
>
> **Primary purpose**: discover whether `TASK_DISPLAYED_COST` is a
> well-defined projection of authoritative per-request cost evidence,
> NOT pre-judge any specific dollar amount. RED is gated on §3
> producing a reproducible accounting break, NOT on the dollar value
> being high or low.
>
> **Predecessor**: none — first ACT in the cost-truth recon lane.
> `EPIC-CLINEMM-COST-DISPLAY-TRUTH01` is CLOSED (canonical cost
> source contract). This ACT targets a *different* surface:
> per-request cost provenance within the request-stream /
> display-stream, not the display-source contract itself.
>
> **Owning epic**:
> [`EPIC-PRODUCT-CONFIG-BRANDING`](../epics/product-config-branding.md)
> · cost-display-truth umbrella · "Open work" backlog.

---

## §0 — Stop rule

This ACT halts at `HALT_COST_NOT_REPRODUCED` if §3 cannot reproduce
the TaskHeader dollar figure from authoritative per-request evidence
on a fresh task of the same provider/model. The dollar amount itself
is **NEVER** the stop rule; the *accounting invariant* is.

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

## §2 — Scope (production-equivalent composition)

### Surface to map

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

The recon must answer, for **at least one** MiniMax-M3 task with the
shape of the captured screenshot:

```text
LIVE_HEADER_COST = $X.YYYY
CANONICAL_BASIS  = provider-reported | local-estimate | mixed | unknown
```

A bug here is *not* "$X.YYYY is too high." It is *only* one of:

```text
(A) arithmetic bug in Σ or in display rounding
(B) retry duplication (the same billed request counted twice)
(C) cumulative-context cost is correct, just high (legitimate)
(D) pricing metadata wrong (tokens × price gives a wrong number)
(E) provider-reported cost differs from local estimate without
    the display saying so (silent mixing)
```

Bucket C is the *expected* outcome for many high-token tasks and is
not a defect.

### What is explicitly NOT in scope

- Re-litigating the canonical cost source contract
  (`EPIC-CLINEMM-COST-DISPLAY-TRUTH01` is CLOSED).
- Changing pricing metadata.
- Inventing a new cost display projection.
- Modifying the TaskHeader layout.

## §3 — Live specimen (NOT YET CAPTURED)

### Required live matrix

```text
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
```

Capture policy: freeze **before** the displayed cost changes; record
provider-reported vs local-estimate in the same capture. If the
display value changes mid-capture, both frozen snapshots are evidence.

### STOP AFTER MATRIX

Do not move to §4 until the matrix is fully captured. A partial
matrix halts at `HALT_MATRIX_INCOMPLETE`.

## §4 — Primary discriminator (deferred to §3)

Buckets A..E per §2 above. Bucket C (cumulative-context cost is
correct) is the **expected** outcome for many tasks and is **not**
a defect — it is the closing condition.

```text
A ⇒ RED: arithmetic / rounding bug
B ⇒ RED: retry-duplication / double-count bug
C ⇒ CLOSING: legitimate cumulative cost (verify the math in §5)
D ⇒ RED: pricing-metadata bug
E ⇒ RED: silent cost-source mixing (worst kind — affects
         user-trust boundary)
```

Bucket C does NOT trigger RED. It triggers §5 verification + §6
"no repair; document why the number is large" + a C1 GO for the
ACT (with the arithmetic verification captured in §10 conservation).

No preferred bucket is pre-baked into this ACT. The classification
is the *output* of §3 + §4, not its input.

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

## §11 — Temporary instrumentation

The existing diagnostic / request-usage / cost surfaces (the
canonical cost source, the per-request cost accumulator, the
provider-response stream) are the **first capture path to try** for
§3. Their sufficiency for binding the complete §3 matrix is
**NOT_YET_PROVEN** — that is precisely what §3 will determine.

If any required field in §3 cannot be bound from the existing
surfaces, halt at `HALT_SEAM_MISSING` and record the missing seam
as evidence for a follow-on ACT. No new instrumentation is
authorized in this ACT; if a seam must be added, it is a follow-on
ACT, not an in-this-ACT instrumentation patch.

PTAD is **not** a presumed source of cost truth. It is a
post-terminal authority diagnostic; its usefulness here is limited
to identity / state binding for §3 correlation. See §14.

## §12 — Forbidden side effects

No source files modified. No tests added. No provider defaults
changed. No `package.json` cost metadata edited.

## §13 — Gates

Recon (this ACT):
```text
[ ] LIVE_HEADER_COST_FROZEN         (deferred to §3)
[ ] REQUEST_STREAM_INVENTORIED      (deferred to §3)
[ ] PROVIDER_REPORTED_COST_PRESENT  (deferred to §3)
[ ] INDEPENDENT_SIGMA_VERIFIED      (deferred to §3 / §5)
[ ] BOUNDARY_A_TO_E_SELECTED        (deferred to §3)
[x] PASS_RECON_SURFACE_MAPPED       (this ACT — surface + buckets +
                                     invariants + forbidden-repair)
[x] PASS_NO_PREFERRED_BUCKET        (this ACT — no verdict pre-baked)
```

Unticked-on-purpose: any gate above `[ ]` is `NOT_YET_CAPTURED`,
not `PASS`. Promotion rules forbid the latter without a specimen.

Repair (NOT in this ACT, only if A/B/D/E):
```text
[ ] RED_REAL_PRODUCTION_SEAM
[ ] CAUSAL_ABLATION
[ ] GREEN
[ ] EAF-C01..C14
[ ] TYPECHECK
[ ] TARGETED_VITEST
[ ] LINT/BIOME
[ ] git diff --check
[ ] exact-head dogfood
```

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
    live-matrix.md            (the §3 frozen matrix)
    bucket-classification.md  (the §4 verdict with evidence)
    independent-sigma.md      (the §5 independent recomputation)
    downstream-decisions.md   (C1: GO with Bucket C, or RED author)
```

factory/docs ≤ 2 (this ACT + evidence dir).

## §16 — Cost-trace ACT relationship

This ACT does NOT supersede `EPIC-CLINEMM-COST-DISPLAY-TRUTH01`
(CLOSED). It targets a *different* surface:

```text
COST-DISPLAY-TRUTH01  = display-source contract           (CLOSED)
TASK-COST-TRUTH-RECON = per-request cost provenance within
                        the request/display stream         (this ACT)
```

The closing condition for this ACT is **either**:

```text
- Bucket C: ACT closes with C1: GO + §10 conservation evidence
            (no RED, no repair; the display is faithful, the
             number is just legitimately large for that task)

- Bucket A/B/D/E: ACT halts at RED, repair ACT spawned under
                  §6 / §7 / §8
```

## §17 — Halt conditions (closed-class)

```text
HALT_COST_NOT_REPRODUCED       — §3 cannot reproduce the displayed
                                  cost from authoritative evidence
HALT_MATRIX_INCOMPLETE        — §3 partial matrix; capture must
                                  resume, not classify
HALT_SEAM_MISSING             — diagnostic seam absent; need a
                                  follow-on ACT, not a repair
HALT_PROVIDER_COST_ABSENT     — provider-reported cost is structurally
                                  unavailable; §3 must capture the
                                  local-estimate basis explicitly and
                                  classify into D or E (or C-with-
                                  estimate caveat)
```

Stop here. **C1: GO_WAIT_FOR_LIVE_TASK**.
