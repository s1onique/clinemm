# ACT-CLINEMM-ORDINARY-COMPACTION-UPSTREAM-AND-FIDELITY-REPAIR-01

## 06 — The production integration gate (§12)

```text
VERDICT:            HALT_FACTUAL_PRESERVATION_NOT_ESTABLISHED
NO PRODUCTION DELTA WAS INTEGRATED.
NO DEFAULT-OFF PRODUCTION MECHANISM WAS ADDED.
THE NEGATIVE RESULT IS PRESERVED.
```

### 6.1 THE GATE, ITEM BY ITEM

The ACT (§12) admits a bounded input-fidelity change only if the candidate
demonstrates EVERY one of the following.

| # | Gate condition | The faithful candidate | Result |
| --- | --- | --- | --- |
| G1 | Correct production source ownership | The faithful representation is a **research rendering**, not a production seam. `serializeConversation()` / `renderStructuredToolPayload()` are the owning seams, and they were NOT changed. | **NOT SATISFIED** |
| G2 | Improved knowledge conservation or behavioural correctness | **SATISFIED** — O1/O4/O7 all move from INCORRECT/PARTIAL to CORRECT (§05.4). | SATISFIED |
| G3 | No newly observed material factual substitutions | **SATISFIED** — the only material substitution observed (PROD's O1 "succeeded") is a property of the EXISTING path and is eliminated by the candidate. | SATISFIED |
| G4 | Existing confidentiality and authority controls conserved | **NOT SATISFIED** — see §6.2. | **NOT SATISFIED** |
| G5 | Valid provider-message structure | **SATISFIED** — the native-message summarizer request was accepted by the provider and answered. | SATISFIED |
| G6 | Complete-request budget conservation | **NOT SATISFIED** — see §6.3. | **NOT SATISFIED** |
| G7 | Existing task-contract conservation | **SATISFIED** — the task-contract and verified-outcome carry-forwards were exercised in the replay and behaved identically. | SATISFIED |
| G8 | Existing failure/fallback behaviour conserved | **SATISFIED** — no failure path was touched. | SATISFIED |
| G9 | No additional mandatory inference request | **SATISFIED** — every measured arm used exactly ONE physical request per question. | SATISFIED |

**G4 and G6 are not satisfied. The gate is not met. Nothing was integrated.**


### 6.2 G4 — THE CONFIDENTIALITY CONTROL IS NOT CONSERVED

This is the decisive failure, and it is NOT a matter of degree.

The current production path's `[result omitted]` policy is a **deliberate,
executable confidentiality control**. `renderStructuredToolPayload()` is a
**ClineMM-only** addition (ABSENT upstream at the inspected commit). It
exists because the summarizer input is transmitted to a provider, and a raw
command stdout can carry:

- credentials and tokens echoed by a failed authentication,
- the contents of `.env` files, key material and certificates,
- customer data in a log tail or a query result,
- private reasoning not intended for publication.

The faithful representation publishes the **result body itself** — the
thing the control exists to withhold — merely applying the existing
sanitizer and a 2 000-character bound.

The ACT's §8 requirement is "original observed values preserved **where
authorized**" and "**no unrestricted raw command or stdout publication**".
The faithful arm is bounded and sanitized, so it is not *unrestricted*. But
whether publishing the body at all is *authorized* is a **confidentiality
policy question that this ACT did not receive authority to answer**, and
the ACT explicitly forbids "unrestricted raw command or stdout publication"
without a formal confidentiality review.

**The broader disclosure has not had that review. The gate therefore fails.**

This is precisely the open question recorded before the measurement:

> "Whether faithful/native replay can preserve evidence without violating
> the existing rule against publishing arbitrary command stdout."

**The measurement answers the first half — YES, the evidence can be
preserved and the propositions recovered — and does NOT answer the second
half.** The second half is a policy decision that must be made before the
production delta lands, not after.

### 6.3 G6 — THE BUDGET IS NOT CONSERVED

The faithful/native summarizer request prefills **123 327 prompt tokens**
against the current production path's **12 962** — a **9.5× increase** — and
takes **333 740 ms** against **45 507 ms**, a **7.3× increase**, on the
measured W1 workload.

The native representation does buy back **88.6%** of the working agent's
serialized prefix (`0.886` against the production path's `0.00019`), which
is a genuine and large cache win. But on a **cold** cache the prefill is
still paid in full, and the ACT's primary objective is **SPEED ×
CORRECTNESS**. A 7.3× summarizer latency increase, bought with a cache
win that only materialises on a warm cache (which was NOT measured), does
not establish a speed improvement.

Additionally, the faithful rendering **doubles** the summarizer input
relative to the production path (170 504 chars of pairs vs 59 535 chars of
serialized input for the same 122 command results), which pushes the
summarizer input toward the very context limit that triggered the
compaction in the first place.


### 6.4 THE CACHE IMPROVEMENT IS RECORDED SEPARATELY

The ACT (§12) requires a demonstrated cache improvement to be recorded
separately, and states that a cache improvement alone does not authorise a
factually inferior compacter. Here the cache improvement is real, and it
does **not** authorise the change, for the independent reasons above.

```text
CACHE_IMPROVEMENT_DEMONSTRATED = YES
  working-agent -> summarizer prefix equality:
    production (A): 0.00019
    native      (B): 0.886
  summarizer -> resumed-agent prefix equality: 0.00038 (one-time, unavoidable)
  post-compaction stable cache recovery: 15347/15363 cached, 3.5x latency reduction
  no repeated prefix churn: CONFIRMED
```

### 6.5 THE SMALLEST EXISTING CANONICAL-HISTORY RECOVERY SEAM

The ACT (§12) requires, when no candidate qualifies, that the negative
result be preserved AND that the **smallest existing canonical-history
recovery seam** be identified.

**The seam is `renderStructuredToolPayload()` in
`sdk/packages/core/src/extensions/context/compaction-shared.ts`.**

It is the single function that decides what a structured tool result looks
like in the summarizer input. It already:

- owns the canonical invocation/result correlation (it receives the
  `tool_use_id` and the tool name),
- owns the `[result omitted]` policy,
- owns the command classification that fails closed on pipelines and
  redirections,
- is called from exactly one place — `serializeConversation()` — which is
  called from exactly one place — `buildSummaryRequest()`.

Changing **only** that function's *rendering* of an ALREADY-AUTHORIZED
body — for example, publishing the bounded, sanitized result of a command
whose classification SUCCEEDED, and keeping `[result omitted]` for the
~118/123 payloads that fail closed — would:

- keep the existing confidentiality control's shape intact (the fail-closed
  path is unchanged),
- recover the decisive values for the payloads that are already
  classified,
- touch one function,
- add no inference request,
- add no new default-OFF mechanism.

**This seam is the recommended target of a successor ACT.** It is NOT
implemented here: the ACT does not authorise a confidentiality-policy
change, and the narrower variant has not itself been measured for
behavioural correctness.

### 6.6 WHAT WAS NOT DONE

- **No production source was changed** by this ACT beyond the A10
  correction (which was committed separately, as §2 required).
- **No default-OFF mechanism was added.**
- **No semantic-memory subsystem, no persistent evidence store, no
  ranking heuristic, no model comparison, no model configuration change.**
- **No PCK revival.**
- **No additional mandatory inference request** — measured at exactly one
  physical request per question in every arm.
- **No VSIX packaging and no installation.**

### 6.7 THE SUMMARY-COMPLETENESS DEFECT IS A SEPARATE ACT

§4 established a concrete RED for the installation of a known-incomplete
summary, with the exact owning boundary. **It was NOT repaired here** — the
ACT forbids combining an unrelated summary-installation repair with the
input-fidelity repair. It is preserved as a witness suite and **CMP-04 is
opened**.
