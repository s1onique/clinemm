# Compaction boundary comparison — R4 evidence across the three authority boundaries

**Labels:** `REAL` (observed in a captured artifact) · `INFERRED` (derived from observed
artifacts by a stated rule) · `NOT_EXECUTED` · `UNAVAILABLE_FROM_TRACE`.

---

## 0. How the three authority boundaries were recovered

| Boundary | Source of A (pre-compaction) | Source of B (generated summary) | Source of C (post-compaction provider-visible) |
|---|---|---|---|
| 36→37 | `37_36` candidate `apiMessages` (74) — the **actual provider request** the summarizer consumed | `63_62` candidate `apiMessages[0]` — the 36→37 summary, carried as the head of the *next* provider request | `63_62` candidate `apiMessages[1..]` |
| 62→63 | `63_62` candidate `apiMessages` (57) | compaction sidecar `messages[0]` | compaction sidecar `messages[1..8]` |

This is a **cross-capture reconstruction**: the 36→37 summary is not stored on its own,
but it is the first message of the next captured provider request, which is exactly
what the model saw at that boundary. `INFERRED` only in the sense of *where* the
summary was recovered from; the summary's **bytes are REAL**.

### Boundary arithmetic (all REAL)

| Boundary | Covered canonical prefix | Provider messages before | Provider messages after | Canonical source prefix |
|---|---|---|---|---|
| 36→37 | indices **0..73** = **74** messages | 74 | 6 | 74 messages ✔ (matches the ACT table) |
| 62→63 | indices **0..125** = **126** messages | 55 | 9 | 126 messages ✔ (matches the ACT table) |

The "provider messages before" column reproduces the ACT's `72 → 6` and `55 → 9`
figures: the ACT counts the *API* messages (`apiMessages`), and the post-boundary
count is the provider-visible continuation length. Both reconcile.

---

## 1. Exact-string probe matrix

Probes are **verbatim substrings** taken from canonical tool results. No paraphrase.

| Probe (exact string) | 36→37 A | 36→37 B | 36→37 C | 62→63 A | 62→63 B | 62→63 C |
|---|---|---|---|---|---|---|
| `/opt/keycloak/bin/kc.sh build` | **5** | **0** | 2 | **7** | **0** | 0 |
| `exec /opt/keycloak/bin/kc.sh start --optimized` | 1 | **0** | 1 | 2 | **0** | 0 |
| `RUN /opt/keycloak/bin/kc.sh build --spi-freemarker--provider-default=roz-fm233` | 1 | **0** | 1 | 1 | **0** | 0 |
| `when you use the start or start-dev command, Keycloak runs a build` | 1 | **0** | 2 | 2 | **0** | 0 |
| `PersistedConfigSource` | 0 | **0** | 10 | **10** | **0** | 7 |
| `R4` | 26 | 1 | 26 | 17 | 1 | 17 |

**Column A** = canonical/provider-visible history before compaction.
**Column B** = the generated summary.
**Column C** = provider-visible continuation after compaction.

### 1b. Authority boundary A measured on the CAPTURED PROVIDER REQUEST (same boundary,
### different projection)

The captured `apiMessages` are the *provider's* projection of the same history. The
API projection renders a tool result differently from the canonical transcript, so the
counts differ — **this is expected and is not a contradiction**.

| Probe (exact string) | A on the 37/36 candidate (74 apiMessages) | A on the 63/62 candidate (57 apiMessages) |
|---|---|---|
| `/opt/keycloak/bin/kc.sh build` | 5 | 2 |
| `exec /opt/keycloak/bin/kc.sh start --optimized` | 1 | 1 |
| `PersistedConfigSource` | 0 | 10 |
| `when you use the start or start-dev command, Keycloak runs a build` | 1 | 2 |

**Both bases agree on the load-bearing fact: the R4 source evidence is present on the
provider-visible side of each boundary and absent from the generated summary.**

> A note on the canonical-vs-API difference for the 62→63 boundary: the canonical
> prefix (0..125) contains 7 occurrences of the witness string, while the captured
> 57-message provider request contains 2. The canonical record additionally holds the
> model's own `thinking` blocks, which repeat the witness string when it reasons about
> it. **The canonical count is the larger and more conservative figure for A** (more
> evidence present before compaction ⇒ a *stronger* claim of loss). The report quotes
> the canonical figures throughout for that reason.

**Every R4 source-provenance probe is present in A and absent in B at both boundaries.**
The R4 *label* survives in B exactly once — inside the task-contract quotation of the
original allegation (see §3).

---

## 2. The G3 six dimensions, per boundary

### Boundary 36→37 (summary = 14 258 bytes, the 36→37 `Context summary:`)

| Dimension | Question | Finding | Label |
|---|---|---|---|
| Claim | Was the original R4 allegation retained? | **YES** — R4 appears once, inside the `cline-task-contract` block, quoting "startup.sh runs `kc.sh build` even though the image is already built with custom provider configuration … configuration drift, mixed builds and dependence on persisted build options. Original: Severity 4/5, Confidence 3.5/5." | REAL |
| Evidence | Was sufficient source evidence retained? | **NO** — 0 occurrences of the source text, the Dockerfile build line, the Keycloak docs quote, or `PersistedConfigSource`. The summary's own Highlights lists "Startup/build behavior in `startup.sh` and Dockerfile" as an *investigation area*, not as evidence. | REAL |
| Provenance | Could the model identify the supporting source/revision? | **NO** — no file, no line number, no revision, no call id for any R4 fact. The summary's `## Files` section says **`Read: none recorded in transcript`** while simultaneously listing four R4-relevant paths as read. | REAL |
| Counterevidence | Was the strongest counterevidence retained? | **NO** — the model had already fetched the Keycloak documentation (canonical idx 72→73) whose quote is *"By default, when you use the start or start-dev command, Keycloak runs a build command under the covers for convenience reasons."* That quote is 0 occurrences in B. The model's own reasoning at idx 74 (pre-compaction reasoning preserved in the provider capture) used it. | REAL |
| Adjudication | Was a supported/weakened/refuted/unresolved decision retained? | **NO** — 0 verdict-shaped statements. The model had **not** reached a verdict for R4 before this compaction (see §4), so this is `ADJUDICATION_NOT_YET_ESTABLISHED`, not `ADJUDICATION_LOST`. | REAL |
| Remaining work | Was the specific unresolved question retained? | **PARTIALLY, but degraded to generic next-steps.** The summary's `## Next` step 1 says "Re-run and capture visible outputs for Phase 0: `git rev-parse HEAD`, `git branch --show-current`, `git status --porcelain`" and step 2 lists eight commands to "Re-run targeted evidence commands with visible output". **The specific unresolved R4 question — "does the Keycloak-documented implicit build make the explicit `kc.sh build` redundant, and does the startup build erase the CI-baked SPI default?" — is NOT retained.** | REAL |

**The summary's `## Blocked` section asserts:**

> "Tool outputs are omitted in the transcript, so final factual adjudication cannot yet be confirmed."
> "Repository identity and HEAD are not yet visible from the transcript."

Both assertions are **false about the canonical record but TRUE about the summarizer's
own input.** The tool outputs were present in the canonical history *and* in the
main-model provider request — but the **summarizer's** input is built through
`serializeConversation()` → `flattenToolResultContent()` →
`renderStructuredToolPayload()`, which renders a string `run_commands` stdout as the
literal `[result omitted]`. This is proven by the 7 captured summarizer requests
(`cap_41f75c5386d5db78`), each carrying 32–79 `[result omitted]` markers and **zero**
occurrences of the R4 witness.

> **CORRECTION01 (P0-2).** The original report called these assertions "false" and
> proposed suppressing them. **Both are withdrawn.** The summarizer truthfully described
> the input it was given; the loss happened upstream of it, at the serializer. Suppressing
> the assertion would make the summarizer less truthful without recovering any evidence.

**This truthful `Blocked` statement is the direct textual trigger for the re-read at
canonical idx 74.**

**Column B** = the generated summary.
**Column C** = provider-visible continuation after compaction.

**Every R4 source-provenance probe is present in A and absent in B at both boundaries.**

### Boundary 62→63 (summary = 15 981 bytes, the 62→63 `Context summary:`)

| Dimension | Question | Finding | Label |
|---|---|---|---|
| Claim | Was the original R4 allegation retained? | **YES** — R4 appears once, inside the `cline-task-contract` block, quoting the same allegation and "Original: Severity 4/5, Confidence 3.5/5." | REAL |
| Evidence | Was sufficient source evidence retained? | **NO** — 0 occurrences of the source text, the Dockerfile build line, the docs quote, or `PersistedConfigSource`. | REAL |
| Provenance | Could the model identify the supporting source/revision? | **NO** — no file, no line, no revision, no call id for any R4 fact. The summary's `## Files` section lists four R4-relevant paths under `**Read:**` but attaches no provenance to any of them. | REAL |
| Counterevidence | Was the strongest counterevidence retained? | **NO** — the docs quote (A=2) and `PersistedConfigSource` (A=10) are both 0 in B. The model's strongest R4 counterevidence — that `PersistedConfigSource` (ordinal 200) is a config source, so the CI-baked `roz-fm233` selection is *re-persisted* rather than erased — is not retained. | REAL |
| Adjudication | Was a supported/weakened/refuted/unresolved decision retained? | **NO** — 0 verdict-shaped statements for R4. The model's R4 narrowing existed **pre-boundary at canonical idx 124** (inside 0..125): "That's a strong falsification of the 'mixed build/drift' mechanism, at least for the freemarker case … Revised severity maybe 2/5." None of that survives into B. | REAL |
| Remaining work | Was the specific unresolved question retained? | **NO** — the summary's `## Next` step 1 again instructs "Re-run and capture visible outputs for Phase 0" and step 2 again lists the same generic command set. The R4 question is not carried. | REAL |

**The summary's `## Blocked` section again asserts:**

> "Tool outputs are omitted in the transcript, so final factual adjudication cannot yet be completed."
> "Repository identity and HEAD are not yet visible from the transcript."

Again **false about the canonical record but TRUE about the summarizer's own input** — the
sidecar's own `source_prefix_hash` is
`sha256:1e2a7d45644114b001dbb32773c5025fe0336ebc8b8becab70f1acbdd7056302` over a
126-message prefix that *contains* the tool outputs and the identity check, but the
summarizer's request carried neither (see the CORRECTION01 note above).

> **The identical false assertion appears in BOTH summaries.** It is a *systematic*
> summarizer artifact, not a one-off.

---

## 3. The surviving R4 mention is the allegation, not a verdict

Occurrences of `R4` inside the 62→63 summary, with the position of the task-contract
block (`cline-task-contract:begin` … `cline-task-contract:end`):

| Position | Inside task contract? | Content |
|---|---|---|
| 6 981 | **YES** | the R4 finding text from the task contract |
| 7 087 | **YES** | "`startup.sh` runs `kc.sh build` even though the image is already built…" |
| 7 105 | **YES** | "…configuration drift, mixed builds and dependence on persisted build options" |
| 7 250 | **YES** | "…Original: Severity 4/5, Confidence 3.5/5" |

All four are inside the task contract. **There is no R4 occurrence outside it.**

---

## 4. The adjudication status of R4 before each compaction

A verdict-shaped scan of every assistant `thinking` block in the canonical record:

| Finding | Verdict-shaped statements found | Last one |
|---|---|---|
| R1 | 5 | idx 144 — "R1 CONFIRMED: manual `helm upgrade …` renders `quay.io/keycloak/keycloak:26.0.7` — stock image" |
| R2 | 2 | idx 40 (segment actually concerns R7) |
| R3 | 1 | idx 64 — "So R3 is NARROWED: the risk is a manual process with a comment, no automated enforcement (true)" |
| **R4** | **0** | — |
| R5 | 0 | — |
| R6 | 0 | — |
| R7 | 1 | idx 40 — "R7 verdict: CONFIRMED (observation-level) but severity may be narrowed" |
| R8 | 1 | idx 28 — "R8's claim of committed bootstrap admin creds is CONFIRMED as an observation" |
| R9 | 2 | idx 28 (segment concerns R8's usability) |
| R10 | 1 | idx 26 (segment concerns R1) |

**The model demonstrably can form verdicts** — it did so for R1, R3, R7, R8 within the
first 26–64 canonical messages. It formed **no** verdict for R4 at any point in the
196-message record.

The model's own pre-compaction words at canonical idx 72 (the last turn covered by the
36→37 compaction) are the definitive statement of R4's state:

> "Now I need authoritative upstream docs: 1. Keycloak `kc.sh build` semantics: does
> running build at startup cause drift / is it required?"

and at idx 60:

> "R4: verify Keycloak semantics: does `kc.sh build` at startup cause drift?"

**Therefore: for boundary 36→37, `ADJUDICATION_NOT_YET_ESTABLISHED` — not
`ADJUDICATION_LOST`.**

For boundary 62→63 the situation is different and is the sharper case. By the time of
that compaction the model had *developed* a specific, source-grounded R4
counter-argument — the `PersistedConfigSource` ordinal-200 reasoning, visible at
canonical idx 124's thinking (inside the 0..125 covered prefix):

> "The key point for R4: the original claim was that startup build creates
> 'configuration drift, mixed builds, dependence on persisted build options'. … So the
> bake is preserved across startup re-builds. That's a strong falsification of the
> 'mixed build/drift' mechanism, at least for the freemarker case."

This is a **bounded, source-grounded narrowing of the R4 claim** (the "mixed build /
drift" mechanism falsified for the freemarker case), formed **before** the 62→63
compaction. It is present in A (canonical prefix 0..125) and **absent from B (0
occurrences)**. It is a genuine *loss* of adjudication progress — but note the
discipline required by the ACT: it is not a terminal verdict, and the model continued
to refine it afterwards. It is **progress**, not a **decision**.

---

## 5. Summary of the boundary comparison

| | 36→37 | 62→63 |
|---|---|---|
| R4 source evidence in A | 5 witness occurrences | 7 witness occurrences |
| R4 source evidence in B | **0** | **0** |
| R4 docs/counterevidence in A | 1 | 2 (+10 `PersistedConfigSource`) |
| R4 docs/counterevidence in B | **0** | **0** |
| R4 adjudication in A | none formed (`ADJUDICATION_NOT_YET_ESTABLISHED`) | narrowing of the drift/mixed-build mechanism formed |
| R4 adjudication in B | none | **none — lost** |
| R4 remaining question in B | generic re-run list | generic re-run list |
| "Tool outputs are omitted" assertion in B | **YES** (truthful about the summarizer's own input — CORRECTION01) | **YES** (same) |
| Immediate post-boundary model action | re-read `startup.sh` + `Dockerfile.roz` (idx 74/75) | re-read `startup.sh` (idx 146/147) |
