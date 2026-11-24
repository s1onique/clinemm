# 04 — The candidate input matrix

## The comparison matrix

| Property | A (ordinary summarizer view) | B (working-agent context) | C (dedicated evidence view) |
|---|---|---|---|
| **R4 source observation visible** | **NO** — `[result omitted]` | **YES** — the tool-result body | **YES** — the tool-result body |
| **R2 source observation visible** | **NO** — the implementation content is omitted | **YES** | **YES** |
| **R6 bounded evidence visible** | **NO** — the empty-match-set body is omitted | **YES** | **YES** |
| **Private thinking forwarded** | **NO** — `dropThinkingBlocks: true` | **NO** — origin-classified and dropped | **NO** — tool results only |
| **Unrestricted command output forwarded** | **NO** — structured bodies omitted | **YES** — as DATA, labelled, never as authority | **YES** — as DATA |
| **Canonical history altered** | **NO** | **NO** | **NO** |
| **Provider authority unchanged** | **YES** | **YES** | **YES** |
| **Extra input tokens** | 0 (it IS the production view) | **+273 810 / +398 988 chars** (≈ 68 K / 100 K est. tokens) | smaller than B; not measured, because C was not needed |
| **Model generation required** | no | **YES** — 2 calls executed | no (a checkpoint can still be generated over it) |
| **Trust-boundary verdict** | fails the requirement by construction | **PASSES** — bounded, origin-classified, no private reasoning | **PASSES** — narrower, evidence-only |

## Why B is the smallest safe candidate

**B is the smallest change that satisfies the requirement.** It differs from
the production view in exactly one respect: **which content class is
forwarded**. The production view forwards assistant prose, user prose and
tool-call labels, and it OMITS the tool-result bodies. B forwards the same
classes **plus** the tool-result bodies, and it still omits private
reasoning.

The three properties B must have (G1.2), all satisfied:

| Property | How B satisfies it | Where it is asserted |
|---|---|---|
| Does NOT insert a new canonical user message | B builds a SEPARATE, read-only string; the canonical history is never mutated | `causal-ablation.test.ts` G7.2 asserts the caller's canonical history is byte-identical before and after |
| Does NOT disturb tool-call pairing | B renders calls and results as READ-ONLY labels; no pairing is rewritten | G7.2 asserts every non-summary message is byte-identical |
| Does NOT consume the already-triggered compaction state | B takes no sidecar, writes no sidecar, never calls `saveState` | G7.2 asserts the message count and roles are unchanged |

## Why C was NOT needed

The ACT's rule was: *"Explore this only if B is unworkable or insufficient."*

B was **sufficient**: the R4, R2 and R6 observations all became visible, the
model published all three faithfully, and the trust gate bounded the
over-claims. C was therefore built (it exists, and the RED suite asserts it
carries the same three witnesses) but **no model generation was run over
C**, and no further work on it is warranted.

C remains a viable, narrower fallback for a future implementation, because
it is the only candidate that forwards tool-result bodies WITHOUT the
assistant's prose. Its cost is that it loses the agent's own public
narrative, which is often the most useful part of a continuation note.

## The evidence labels

| Label | Meaning | Used for |
|---|---|---|
| `REAL_PRODUCTION_SEAM` | produced by the production projection + production serializer over the exact frozen canonical prefix | Input A |
| `SYNTHETIC_REAL` | derived from REAL canonical history using REAL production transforms, but CONSTRUCTED and FILTERED by this ACT | Input B |
| `SYNTHETIC` | assembled by this ACT's own machinery | Input C |
| `REAL_MODEL_RESPONSE` | the actual public response of the authorized provider | the G6 generation |

**Input B is NOT `LIVE`.** It is not an exact replay of a provider-visible
request: the provider-wire projection is a separate, host-supplied, stateful
transform (`MessageBuilder.buildForApi()`), and B applies the ACT's own
origin filter to the canonical history.

## The B1 visibility test

The B1 test is the question: *does the model receive the observation?*

It was answered empirically, by the G6 generation, on the REAL provider:

| | model received it? | how it is known |
|---|---|---|
| R4 `kc.sh build` | **YES** | the published record names it |
| R4 `start --optimized` | **YES** | the published record names it |
| R2 the concrete inspected implementation | **YES** | the published record names the carriers, the 3 s/10 s timeouts and the circuit breaker |
| R6 the underlying empty-match-set evidence | **YES** | the published record reports the bounded search result |

**Exact source origin was evaluated separately from keyword presence.** A
keyword match alone was NOT accepted as evidence: the G6 evaluation asserts
the STRUCTURE of the published record (its kind, its assurance, its status,
its qualifications), not merely that a token appears somewhere in the blob.

## The G6.2 semantic outcome

| | R4 | R2 | R6 |
|---|---|---|---|
| publishes the observation | **YES** — both commands | **YES** — the concrete implementation | **YES** — the bounded negative |
| certifies the unproven | **NO** — drift is qualified and `unresolved` | **NO** — the status stays incomplete | **NO** — global absence is explicitly excluded |
| preserves provenance limits | **YES** — 3 qualifications | **YES** — 1 qualification | **YES** — 1 qualification |
| reproduces private reasoning | **NO** | **NO** | **NO** |

## The over-claim the trust gate caught

The model claimed `runtime_verified` on **2 of 20** records at boundary 1
and **4 of 16** at boundary 2 — 6 records in total.

The trust gate downgraded **every one** of them. The G6 suite asserts that
`boundAssurance()` never returns `runtime_verified` for a model-authored
record, and the over-claim count is asserted to be non-zero so the check is
not vacuous.

**This is the single most important trust finding of the ACT:** a model
given richer input will publish richer claims, and the richer input makes
the over-claim MORE likely, not less. The authority bounding is therefore
not optional — it is the load-bearing part of the design.

## G3 exit

```text
The discriminator is decisive.
```

Candidate B is the smallest safe candidate. It carries the genuine R4, R2
and R6 observations; it forwards no private reasoning; it leaves the
canonical history, the provider authority and the compaction state
untouched; and its over-claims are mechanically bounded.
