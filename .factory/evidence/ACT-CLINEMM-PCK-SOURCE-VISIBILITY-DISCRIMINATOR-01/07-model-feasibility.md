# 07 — Model-generation feasibility

## The authorized route

```text
Provider protocol: openai-compatible
Base URL:          https://api.minimax.io/v1   (the operator's own configured URL)
Model:             MiniMax-M3
Context window:    256 000 tokens
```

The identity was DISCOVERED at runtime from the operator-local
`~/.cline/data/globalState.json` and `secrets.json`. It was **not**
substituted, and no new external provider was introduced. The credential was
read from the operator-local secrets store and was **never** written to an
output file, a log line, or an evidence artifact.

The predecessor used exactly this route, so the two ACTs are comparable.

## The call budget

```text
Maximum:  1 generation call per historical boundary
           2 total generation calls
           0 execution tools
           0 autonomous investigation turns
```

**Executed: exactly 2 calls (1 per boundary).** The budget was not
exceeded. The structural controls, the synthetic controls and the ablations
all reuse captured outputs and required **no** additional model calls.

## The input budget

```text
Boundary 1:  273 810 request characters  ~=  68 482 estimated tokens
Boundary 2:  398 988 request characters  ~=  99 777 estimated tokens
Context window: 256 000 tokens
```

Both inputs fit comfortably. `INPUT_BUDGET_INSUFFICIENT` does **not**
apply, and no input was trimmed in a way that could silently remove the
target evidence — the R4, R2 and R6 witnesses are all present in the
measured inputs.

## The measured results

| | Boundary 1 | Boundary 2 |
|---|---|---|
| Provider | openai-compatible | openai-compatible |
| Model | MiniMax-M3 | MiniMax-M3 |
| Latency | **178 853 ms** | **73 827 ms** |
| Input characters | 273 810 | 398 988 |
| Output characters | 76 714 | 70 190 |
| Records emitted | **20** | **16** |
| `runtime_verified` over-claims | 2 | 4 |
| Projection tokens (after selection) | ≤ 1 500 | ≤ 1 500 |

### Predecessor baseline, for comparison

```text
Boundary 1 generation:  66 496 ms
Boundary 2 generation:  80 654 ms
Projected continuation: ~1 010-1 117 estimated tokens
```

**Cost and latency are reported INDEPENDENTLY of semantic success**, as
G6.3 requires. The new approach is not automatically worthwhile merely
because it retains more detail.

### The cost finding

Boundary 1 took **178 853 ms** — roughly 2.7× the predecessor's 66 496 ms.
The cause is the input size: the working-agent view is ≈ 274 K characters
against the predecessor's lossy view, and the predecessor's boundary-1
input was considerably smaller.

Boundary 2 took **73 827 ms**, which is in line with the predecessor's
80 654 ms, despite a *larger* input — the variance is dominated by the
provider, not by the ACT.

**This is a material cost and is stated as such.** A future implementation
must either accept it, generate the checkpoint conditionally, or use a
smaller model. It is a real constraint on any production design.

## The semantic outcome (G6.2)

### R4

```text
The model publishes both observed startup operations:   YES
It does not certify configuration drift:                YES (it is qualified and unresolved)
It preserves evidence provenance limitations:            YES (3 qualifications)
```

The published record states that the startup script runs `kc.sh build` and
then `kc.sh start --optimized`, and qualifies that configuration drift and
mixed builds are **not** established. At boundary 1 the record's status is
`unresolved`.

### R2

```text
The model identifies the concrete provider implementation(s) that were visible to it:  YES
It preserves the incomplete-investigation status:                                  YES
It does not invent timeout or breaker guarantees:                                   YES
```

The published record names the carriers, their **3-second connect and
10-second socket** timeouts, and contrasts them with the notification
service sender's **circuit breaker** and **Kafka-first transport with REST
fallback**. Its qualification states that the effective production sender
and the runtime toggle were **not reconciled**.

This is a decisive improvement over the predecessor, which could publish
only the TOPIC of R2 because the inspected implementation content was never
in its input.

### R6

```text
The model publishes a bounded negative observation:              YES
ONLY if available non-private evidence supports it:              YES
It does not assert global absence:                              YES
It does not reproduce a private reasoning block:                YES
```

The published record states that a bounded repository search found no
application-level DELETE, purge, or retention job for the token-code table,
and qualifies that this supports absence of an application-managed
mechanism in the inspected repository — **not** absence of external database
cleanup or actual production growth.

**The model produced a FRESH conclusion from the non-private evidence. It
did not reproduce the private reasoning block.** That is exactly the ACT's
requirement, and it is the reason R6 is classified
`BOUNDED_NEGATIVE_PUBLISHED` rather than `LIVE_UNOBSERVABLE`.

## The split result

There is **no split result**: R4, R2 and R6 all published successfully.
The reason R6 succeeded is that its underlying evidence was in a
`tool_result` body, which the working-agent view carries — even though the
original English sentence was in a thinking block that the view correctly
drops.

## The over-claim, and why the trust gate is load-bearing

The model claimed `runtime_verified` on **6 records** across the two
boundaries. The trust gate downgraded every one.

This is the ACT's most important design finding, and it is a consequence of
the SUCCESS: **a model given richer input publishes richer claims, and the
over-claim rate goes UP, not down.** A design that trusted the model's
assurance label would have projected six runtime-verification claims that no
runtime had established.

The bounding is therefore not a defensive afterthought — it is what makes
the richer input safe to use at all.

## G6 exit

```text
PASS — controlled model generation is feasible over the working-agent view.
The R4, R2 and R6 observations are published accurately and qualified.
The cost is measured and material.
```
