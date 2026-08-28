# Probe — MiniMax Ultra billing semantics

> ACT-CLINEMM-TASK-COST-TRUTH-RECON01 §3 Layer-2 retrospective
> (authored 2026-08-27; NOT a live specimen capture — that
> arrives in a later commit once the editor-tool operational
> frontier is bound and an Ultra-task run is repeated under the
> exact-head dogfood pipeline).
>
> This document captures the *prompted* Layer‑2 finding that
> re-framed the ACT around billing semantics rather than
> per-request arithmetic. The expert input that drove the
> reframe is preserved in the FACTORY REVIEWER table at the top.

---

## FACTORY REVIEWER PROMPT (2026-08-27)

| Expert(s) | Question | Plan |
|---|---|---|
| ClineMM product/accounting engineer · Factory reviewer | Does the `$0.8236` TaskHeader cost mean anything on MiniMax Ultra? | Reclassify the ACT around **billing mode**, not per-call arithmetic |

The expert's framing (verbatim summary, not the full email):

> MiniMax **Ultra is a subscription/token-plan product**, not
> ordinary pay-as-you-go API billing. The MiniMax Token Plan
> includes a large M3 quota per month (currently advertised
> around 12.5B M3 tokens/month on the subscription page) and
> explicitly says you can use the plan's API key with Cline and
> other compatible tools.
>
> For the user's actual account:
>
> ```text
> REAL USER BILLING MODEL = SUBSCRIPTION / INCLUDED QUOTA
>                          ≠ PER-REQUEST DOLLAR CHARGE
> ```
>
> while the ClineMM UI is apparently calculating:
>
> ```text
> TOKEN USAGE × public PAYG API list price
> → "$0.8236"
> ```
>
> The public API rates do exist separately (M3 ≤512K at about
> `$0.30/M` input, `$1.20/M` output, `$0.06/M` cache read),
> with higher long-context rates above 512K — but those rates
> are **not the user's marginal bill** when requests are
> consuming an Ultra Token Plan quota.
>
> That makes our cost ACT much more interesting.

---

## Layer-2 discriminator analysis

### I. PAYG credential

For a genuinely metered MiniMax PAYG key, the public PAYG list
price **is** the marginal per-task spend and rendering
`$0.8236` as task spend is correct. Layer 1 (A/B/C/D/E) is
the whole story; Layer 2 verdict = `I`.

Currently there is **no code path** in ClineMM that
distinguishes a PAYG MiniMax key from a Token Plan Ultra key
(see §11 Phase 0 below). Both reach the webview with
`useProviderUsageCostDisplay("minimax") === "show"`. The
discriminator is, in practice, permanently `I` for every
MiniMax credential — which is exactly the Layer‑2 bug.

### II. SUBSCRIPTION / TOKEN PLAN / QUOTA-INCLUDED credential

For a MiniMax Ultra Token Plan key the marginal monetary charge
is generally **$0** (the request consumes part of the included
12.5B M3 tokens / month). The TaskHeader currently shows
`$0.8236`, which is the *public PAYG list price × tokens* — a
legitimate number for billing-comparative purposes but NOT the
user's actual per-task spend.

**Layer 2 verdict: II** → semantic bug F
("subscription / token-plan credential is shown as PAYG spend").

This is the canonical case the expert review identified. The
UI is materially misleading; the user's mental model is that
the task charged them 82 cents when their marginal spend is $0.

### III. UNKNOWN billing mode

Currently ClineMM treats every "unknown" / "loading" /
"forward-value" case as `"hide"` in
`apps/vscode/webview-ui/src/hooks/useProviderUsageCostDisplay.ts`.
That is the conservative end of III. The open question
(deferred to the presentation-repair ACT) is whether IIIa
(relabel) is preferable to IIIb (suppress) when the SDK later
moves from "hide" to "admit uncertainty."

Layer 2 verdict = `III` for catalog-loading-state cases and
for any future SDK value the webview does not yet recognise.
No live specimen evidence needed; the hook contract documents
the policy.

### IV. PROVIDER-SUPPLIED AUTHORITATIVE COST

MiniMax's public responses at the time of this analysis do NOT
expose an authoritative `usage.cost` field at the wire level
for the standard M3 chat completions endpoint — the only
authoritative cost is what the user's billing portal shows at
the end of the month. ClineMM currently has no way to surface
that.

Layer 2 verdict for "provider-billed cost" is therefore
`UNPROVEN` for MiniMax. For providers that DO expose a
`usage.cost` response field (e.g. OpenRouter-style), Layer 2
verdict = `IV`, and the small attribution gap (verdict H) may
apply — but that is out of scope for this MiniMax-flavoured
recon.

---

## Two-layer forensic cell for the canonical Ultra case

| Field | Value |
|---|---|
| Provider / model | MiniMax / M3 (≤512K context family) |
| Captured task | (captured later — deferred) |
| Layer-1 arithmetic verdict | **C** (expected — high token count, math should verify) |
| Layer-2 billing-semantic verdict | **II** |
| Combined forensic cell | **(C, II)** |
| ACT outcome | RED-LAYER-2; presentation-repair ACT spawned |
| Forecasted repair ACT id | `ACT-CLINEMM-PASS-COST-PROVENANCE-PRESENTATION-REPAIR-V1` |
| Repair shape (forecast) | `$0.8236` → `≈$0.8236` + tooltip + safe global relabel fallback |

---

## Why this is a presentation bug and NOT an accumulator bug

Per the expert's framing (paraphrased):

> Even if `$0.8236` is mathematically perfect against the
> MiniMax PAYG tariff, showing `$0.8236` with no qualification
> strongly implies "this task cost you 82 cents." For Ultra,
> that's not the economic truth.

```text
PAYGCostNumericallyCorrect      == TRUE
DisplayedLabelImpliesUserSpend  == TRUE
BillingModeIsSubscription       == TRUE
Therefore
DisplayedCostIsMisleading       == TRUE     (Layer-2 F)
```

The accumulator (Σ canonical per-request cost estimates) is
honest; the **renderer** is dishonest. That is a presentation
bug, full stop. An accumulator repair (Layer-1 A/B/D/E) would
either:

  * change a number that the canonical source contract is
    correctly computing, OR
  * hide a number that the user has a comparative right to see
    (PAYG-equivalent is useful as a relative metric).

Both of those are worse than relabelling.

---

## Phase 0 — provider plan detection (per §11)

Whether the credential format itself distinguishes Token Plan
keys, whether MiniMax exposes account/plan metadata through an
API, whether the response contains billing-plan metadata, or
whether Cline currently knows none of this — is gated out of
this commit and recorded as a future-proofing artefact here:

```text
Known at the time of this evidence:
- MiniMax publishes a Token Plan landing page with
  subscription pricing tiers (12.5B M3 tokens/month on the
  advertised Ultra tier, per the subscription page surfaced by
  the expert review).
- MiniMax publishes separate public PAYG rates for M3 chat
  completions (input / output / cache-read).
- ClineMM has no MiniMax-specific plan-detection seam in the
  SDK today.

NOT known at the time of this evidence (requires a Phase 0
investigation):
- Whether the credential format differs between PAYG and Token
  Plan keys (URL prefix? length? header shape?).
- Whether the MiniMax API exposes a
  /v1/account or /v1/billing endpoint that returns the active
  plan / quota.
- Whether the standard chat-completions response surface
  includes a usage.cost or equivalent field.
- Whether other reverse-engineered / community sources
  document any of the above.
```

Per §11 Phase 0 rules, this evidence MUST NOT trigger
provider-id string matching in the SDK for Ultra detection,
and MUST NOT infer Ultra from the key string alone.

Until Phase 0 is completed, the safe presentation-repair is
the **global relabel** (every metered credential, not just
MiniMax) so the user is never again shown a bare `$X.YYYY`
that implies "you spent X":

```text
$0.8236 → ≈$0.8236

with tooltip:
"Estimated API-equivalent cost. Actual charges may differ for
 subscriptions, token plans, credits, caching, or provider
 billing."
```

That is upstream-compatible and safer than attempting
provider-plan detection immediately. A later MiniMax-specific
enhancement (e.g. "94M tokens · Ultra quota") is deferred
behind Phase 0.

---

## Linkages

* ACT: `.factory/acts/ACT-CLINEMM-TASK-COST-TRUTH-RECON01.md`
  (re-framed 2026-08-27 against this evidence)
* Closed contracts that bound this recon:
  - `ACT-CLINEMM-COST-DISPLAY-TRUTH01` (canonical cost source)
  - `ACT-CLINEMM-COST-DISPLAY-TRUTH01.CORRECTION01..02`
    (`usageCostDisplay` allowlist)
* Existing primary surface:
  `apps/vscode/webview-ui/src/hooks/useProviderUsageCostDisplay.ts`
  (already returns `"show" | "hide" | "subscription"`; this
  reframe adds the additional truthfulness-of-label layer
  above it)
* Forecasted follow-on ACT:
  `ACT-CLINEMM-PASS-COST-PROVENANCE-PRESENTATION-REPAIR-V1`
  (NOT YET SPAWNED — this reframe prepares the recon surface
  for it; the spawn is a separate docs/governance commit
  sequenced after the editor-tool operational frontier lands)
