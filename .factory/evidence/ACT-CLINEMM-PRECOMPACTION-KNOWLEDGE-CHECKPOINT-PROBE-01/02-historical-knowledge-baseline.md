# 02 — Historical knowledge baseline (the RED)

**Evidence class:** `REAL` — measured from the frozen, hash-verified production captures
and the exact canonical transcript.

**Reproduction:** `checkpoint-historical-baseline.test.ts` (6 tests, all passing).

---

## 2.1 The measurement method

The baseline is measured on the **actual provider-visible request** captured at each
iteration, not on the canonical transcript and not on keyword counts in a summary file.

For each witness the suite asserts:

1. a **PRECONDITION** — the exact operational detail WAS in the provider-visible context
   before the boundary (otherwise an absence would not be a loss), and
2. the **ABSENCE** — the exact operational detail is NOT in the provider-visible context
   after the boundary.

The witnesses are matched on their **exact operational tokens**, never on a topic word:

| Witness | Exact token | Why the topic word is not enough |
|---|---|---|
| R4 | `start --optimized` | `kc.sh build` SURVIVES both boundaries as a summary topic; only the second operation is lost |
| R6 | `No delete/purge found in those paths` | The word `retention` survives in the summary as a topic; the bounded observation does not |
| R2 | `MtsOmni` | The topic "Java provider timeout/circuit-breaker code" survives; the provider identifier does not |

---

## 2.2 The measured matrix

| Witness | Capture | Occurrences before | Occurrences after | Boundary | Result |
|---|---|---|---|---|---|
| R4 | `pre.json` -> `post.json` | 2 (`msg[5]` tool-result, `msg[12]` reasoning) | **0** | 15 -> 16 | **LOST** |
| R4 | `second-pre.json` -> `second-post.json` | 2 (`msg[18]` tool-result, `msg[19]` reasoning) | **0** | 33 -> 34 | **LOST** |
| R6 | `second-pre.json` -> `second-post.json` | 1 (`msg[9]` reasoning) | **0** | 33 -> 34 | **LOST** |
| R2 | `pre.json` -> `post.json` | 2 (`msg[17]` tool-result, `msg[18]` reasoning) | **0** | 15 -> 16 | **LOST** |
| R2 | `second-pre.json` -> `second-post.json` | 5 | **0** | 33 -> 34 | **LOST** |

Contextual counts, for the record:

| Token | pre | post | second-pre | second-post |
|---|---|---|---|---|
| `--optimized` | 2 | **0** | 2 | **0** |
| `kc.sh build` | 7 | 2 | 8 | 2 |
| `No delete/purge found in those paths` | 0 | 1 | 1 | **0** |
| `MtsOmni` | 2 | **0** | 5 | **0** |
| `Megafon` | 1 | **0** | 4 | 2 |

(`Megafon` survives at boundary 2 only inside assistant *reasoning* prose, not as a
provider-visible tool observation.)

### The R6 boundary-1 anomaly, stated honestly

At boundary 1 the bounded negative is **0 occurrences in `pre.json` and 1 in
`post.json`**. This is not a loss at boundary 1: the R6 investigation had not yet
produced the bounded negative at boundary 1 — the pre-compaction reasoning still says
*"Now let me check R6 retention: search for any DELETE on PHONE_MESSAGE_TOKEN_CODE,
TTL/cleanup, and whether Keycloak/DB has some purge."* The observation was established
*after* boundary 1 and was then lost at boundary 2. The suite measures the boundary at
which the observation was actually held.

---

## 2.3 R4 — established source observation vs. the configuration-drift allegation

The ACT requires these two to be kept strictly apart.

**The source observation (tool-observed):**

```text
$ cat startup.sh && cat Dockerfile.roz | head -60
```

```text
#!/bin/bash
set -e # Exit immediately if a command exits with a non-zero status

/opt/keycloak/bin/kc.sh build

# Execute the main container process using the free arguments passed to Docker
exec /opt/keycloak/bin/kc.sh start --optimized "$@"
```

**The assistant statement (present pre-compaction):** the assistant explicitly discusses
both operations — in `pre.json` `msg[8]` reasoning it lists *"5. Check startup.sh (R4) —
already read: kc.sh build then start."*, and in `msg[12]` reasoning it reasons about the
semantics of `kc.sh build` and `--optimized`.

**The separate allegation (user-authored, NOT established):** *"Rebuilding Keycloak at
container startup creates configuration consistency and deployment risks ... can create
configuration drift."* This appears in the ORIGINAL USER TASK message (`msg[0]`), never
as an adjudicated finding.

**Post-compaction outcome:** the summary retains the *topic* — `Keycloak startup
`kc.sh build` behavior` — and the R4 *allegation* text is preserved verbatim from the
user message (because the user message is preserved). The **exact observed command pair
is gone**: 0 occurrences of `--optimized` in either post-compaction context.

**At boundary 2 the loss is sharper still.** The single `--optimized` occurrence in
`second-post.json` (`msg[7]`, reasoning) is NOT the observation. It is the model's
**speculation** about upstream CLI semantics:

```text
Actually I'm fairly confident: Keycloak CLI has a hidden `--optimized` flag? Hmm.
```

So the tool-observed fact was **degraded into a model hypothesis**. This is the sharpest
form of the RED: the record does not merely lose a detail, it silently changes the
*epistemic status* of what remains.

**Configuration drift is NOT certified by this ACT.** The commands were observed; the
drift mechanism was never proven. The checkpoint must preserve the observation and keep
the drift claim unresolved.

---

## 2.4 R6 — qualified negative observation

**The bounded negative (established):** the assistant's own statement at the boundary is

```text
No delete/purge found in those paths.
```

It follows a grep over the provider JPA and authentication Java sources plus the
Liquibase changelog directory for `delete|purge|retention|cleanup|expired`, whose result
body was `=== changelog retention ===` with **no matching lines**.

**What it is NOT:** it is not evidence that no retention mechanism exists anywhere. An
external cron job, a database-side purge, or an operational process is not excluded. The
scope of the negative is the inspected paths.

**Post-compaction outcome at boundary 2:** the *topic* survives — the summary carries
`Token-code table and retention-related changelogs` and the R6 allegation text (from the
preserved user message). The **bounded negative observation itself is gone**: 0
occurrences of `No delete/purge found in those paths` in `second-post.json`.

---

## 2.5 R2 — incomplete investigation

**Before compaction (boundary 1, `pre.json` `msg[18]` reasoning):** the assistant had
identified the implementation targets and PLANNED to inspect them:

```text
R2: OTP sender fallback paths / circuit breakers — check MtsOmni sender code,
notification-service sender, NsInboxKafkaProducer.
```

This establishes an **investigation target**, not a completed finding about timeout
safety.

**Before compaction (boundary 2, `second-pre.json` `msg[41]` reasoning):** the provider
implementations had been inspected and a partial picture existed — the NS sender has a
`CircuitBreaker` and a Kafka-inbox async path with REST fallback, while MTS Omni /
Megafon / RedSMS / Telediscount "do NOT have circuit breakers, but timeouts are
hardcoded (3000/10000)".

**Post-compaction outcome:** `MtsOmni` is **absent from both** post-compaction
provider-visible contexts (0 occurrences), and `Megafon` survives only inside reasoning
prose at boundary 2. The investigation target and its partial state were lost.

---

## 2.6 Baseline metrics (G2.4)

| Metric | Boundary 1 | Boundary 2 |
|---|---|---|
| `observations_explicit_before` | 3 (R4 command pair, R6 pending, R2 provider identification) | 3 (R4 command pair, R6 bounded negative, R2 provider implementation state) |
| `observations_visible_to_summarizer` | **1** (only `kc.sh build` as a topic) | **1** (only `kc.sh build` as a topic) |
| `observations_retained_after` | **0** (R4 exact pair) | **0** (R4 exact pair, R6 bounded negative, R2 identifier) |
| `qualifications_preserved_after` | **0** | **0** |
| `unresolved_questions_preserved_after` | **0** (R2's planned inspection) | **0** (R2's partial state) |
| `false_certifications` | **0** | **0** — the loss is omission, not false certification |
| `provider_visible_tokens` (pre) | 99 944 (estimated, capture summary) | — |
| `provider_visible_tokens` (post) | — | — |

### Source-derived vs. assistant-authored vs. user-alleged

| Claim class | Examples | Pre-compaction status | Post-compaction status |
|---|---|---|---|
| **Source-derived** (tool-observed) | `startup.sh` contains `kc.sh build` then `start --optimized`; the retention grep returned no match; `MtsOmni`/`Megafon` senders exist | established | **LOST** (exact detail) |
| **Assistant-authored** | "No delete/purge found in those paths"; "MTS Omni connect timeout is hardcoded 3000 ms" | established | **LOST** (R6) / **LOST** (R2 identifier) |
| **User-alleged** | "rebuilding causes configuration drift"; "OTP records accumulate without retention"; "sender lacks circuit breakers" | allegation only | preserved verbatim (the user message survives) — and must never be read as established |

---

## 2.7 The RED requirement

> **Required RED:** At least one independently adjudicated relevant observation or
> qualified statement is not faithfully represented in the post-compaction
> provider-visible context.

**SATISFIED, on independently adjudicated and hash-verified evidence.**

Three such statements are lost:

1. **R4** — the tool-observed command pair (`kc.sh build` then `start --optimized`).
2. **R6** — the bounded negative observation ("No delete/purge found in those paths"),
   with its scope qualification.
3. **R2** — the provider implementation identification and its partial state.

The loss is one of **omission and status degradation**, not of false certification. The
original user allegations survive because the user message survives; that is a
preservation of the *input*, not of the *finding*.

**`HALT_RED_NOT_REPRODUCED` is NOT triggered.** The witnesses were not weakened to make
the probe interesting: they are the ACT's own named witnesses, matched on their exact
operational tokens, with preconditions asserted.

---

## 2.8 Earliest loss boundary and exact production seam

| Witness | Earliest loss | Exact production seam |
|---|---|---|
| R4 | **L2** | `renderStructuredToolPayload()` in `compaction-shared.ts` — the structured `{query, result, success}` payload is rendered as `[succeeded] #1: [result omitted]`; arbitrary command output is never copied. |
| R6 | **L1** | `buildBudgetProjection()` with `policyIntent: "agentic_summary"` in `budget-projection/project.ts` — every `thinking` block is dropped before serialization. |
| R2 | **L2** (boundary 1) / **L1+L2** (boundary 2) | Same structured-payload omission as R4 (boundary 1); thinking-block drop (boundary 2). |

Both seams are **existing, deliberate contracts** — see `01-production-seam-map.md` §1.5.
This ACT does not reopen them; it measures their effect on working knowledge.
