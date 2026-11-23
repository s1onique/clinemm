# 07 — Contract decision (G7)

Exactly one conclusion is selected, as the ACT requires.

## The candidate outcomes

### Option A — Existing assistant text is sufficient

**SELECTED.**

> The actual model/runtime can publish the envelope using existing
> assistant `text` blocks, and the structural gates pass.

Evidence:

1. **The carrier exists and is first-class.** `text` is a canonical
   `ContentBlock`; it is created by the real provider-response adapter, it
   survives canonical persistence byte-identically, and it is NOT dropped
   by the `agentic_summary` budget policy.
2. **Text and tool use coexist in the same canonical turn** — proven
   structurally by reading `agent-runtime.ts` and `ai-sdk.ts`, and proven
   structurally by PROBE-2 in the probe test file.
   ~~and proven LIVE (the publishing turn also carried a tool call).~~
   **WITHDRAWN BY CORRECTION01:** the corrected live measurement records
   `publishedTurnAlsoCarriedToolUse = true` in **0 of 9** schema-valid
   runs. The LIVE claim is refuted; only the STRUCTURAL claim stands.
3. **The envelope survives M1** — the central structural discriminator:
   `assistant text: eligible for summarizer input; thinking only: dropped`.
4. **A REAL model publishes it** — 9 of 10 measured runs produced a
   schema-valid candidate with the qualification intact.
   **CORRECTION01 CONFIRMS this figure** against 10 committed receipts.
   Note that **schema validity is not contract acceptance**: the corrected
   measurement records `candidate_accepted = false` in **10 of 10** runs.
5. **The structural gates pass** — 55/55 probe tests, and every adversarial
   control has the required disposition.

Consequence: **No new public content-block type. No new protocol. No new
persistence subsystem.** The next candidate is a narrowly scoped
compaction-continuity implementation using the existing message carrier.

### Option B — Existing carrier works, but publication is unreliable

**PARTIALLY TRUE, and it is recorded, but it does NOT displace Option A.**

> **CORRECTION — `ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-PROBE-01-CORRECTION01`**
>
> The `9 of 10` figure below is **CONFIRMED** by 10 committed receipts.
> The live measurement is 9 of 10 successful **schema-valid**
> publications, so publication is reliable but **not guaranteed**. The
> ACT's own instruction for Option B is "a bounded model-output
> instruction/contract experiment" — and that is exactly what the live
> probe itself IS: a bounded contract experiment that demonstrated 90%
> compliance with a deliberately requested output.
>
> The successor must additionally distinguish this from **acceptance**:
> the corrected receipts record `candidate_accepted = false` in 10 of 10
> runs. A compliance figure about *publication* is not a compliance figure
> about *acceptance*.
>
> Superseded detail:
> `.factory/evidence/ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-PROBE-01-CORRECTION01/02-live-receipts.md`

The two options are not exclusive here: the carrier is sufficient
(Option A), and the residual unreliability is an instruction-compliance
property that Option B's experiment would have to improve. Selecting B as
the *decision* would misreport the carrier's capability, which is the
question this ACT was chartered to answer. The residual compliance figure
is therefore carried forward as an explicit, measured constraint on the
successor, not as the verdict.

### Option C — Existing message carrier cannot support the contract

**REJECTED.** The adapter produces the required text/tool combination and
the canonical message semantics carry it without modification. This is the
opposite of what the recon found.

### Option D — Representation remains unsafe or insufficient

**REJECTED.** The contract needs no unrestricted text, no arbitrary
thinking extraction, and no confidentiality mechanism beyond a closed
identifier/enum vocabulary. `HALT_CONTRACT_NOT_SAFE` is **NOT** triggered.

## The selected decision, and the boundary it does NOT cross

```text
DECISION:                 OPTION A
PUBLICATION FEASIBILITY:   ESTABLISHED (structurally + live)
CONTINUITY GUARANTEED:    NO — measured, classified, NOT implemented away
```

**The ACT's success criterion is met:** a future-facing adjudication can be
deliberately emitted into an existing non-reasoning carrier, independently
validated as a qualified model-authored claim, and made available to the
compaction path — without copying private reasoning and without carrying
arbitrary source data.

**What is NOT claimed:**

- That the candidate reliably survives compaction. The summarizer may omit
  it; that boundary is measured and classified in
  `05-compaction-consumer-probe.md`.
- That the verdict is correct. Every accepted envelope is `MODEL` /
  `PROVISIONAL` / `NOT_INDEPENDENTLY_ADJUDICATED`.
- That the historical R3/R7/R8 adjudications were recovered. They were
  not, and this ACT explicitly does not attempt it.

## The explicit non-goal, honoured

The historical R3/R7/R8 thinking-only messages were NOT repaired,
recovered, or reinterpreted. They establish the original information-loss
failure; the new contract applies only to FUTURE model outputs.

## Constraints carried forward to the successor

```text
C1  The canonical tool-call id must be made AVAILABLE to the model
    (e.g. in the tool result or the tool schema). The live probe showed a
    real model citing tool NAMES and invented ids, all of which the
    contract correctly rejects. Without this, evidence binding cannot be
    satisfied in practice.

    **CORRECTION01 — C1 REMAINS OPEN AND IS NOW HARDER.** The corrected
    10-run measurement resolves canonical references in only **1 of 10**
    runs, and that single run still failed the source-revision gate, so
    **0 of 10** candidates were accepted. C1 is NOT solved and may NOT
    be treated as solved by the successor.

C2  The summarizer's retention of the candidate is NOT guaranteed
    (G4.3-B). Any continuity implementation must address this boundary
    explicitly and must not claim continuity from the M1 result alone.

    **CORRECTION01 — C2 REMAINS OPEN AND UNCHANGED.** This ACT did not
    touch the summarizer-omission boundary and does not claim to have
    moved it. The successor must establish DETERMINISTIC continuity and
    must re-measure the G4.3-B omission negative control.

C3  Publication is reliable but not guaranteed (9/10 live). The successor
    must treat a missing envelope as a normal, expected outcome.

    **CORRECTION01 — the 9/10 figure is CONFIRMED against 10 committed
    receipts, but it is a PUBLICATION figure, not an ACCEPTANCE figure.**
    Acceptance was 0/10. The successor's acceptance criterion must be
    stated in terms of `candidate_accepted`, never `schema_valid`.

C4  The candidate remains PROVISIONAL. An implementation that would let a
    model-authored candidate become a system/developer instruction, or that
    would promote it above the canonical evidence, is out of bounds.

C5  The vocabulary is TEST-LOCAL. Promoting it to a global ClineMM API
    requires its own ACT.
```
