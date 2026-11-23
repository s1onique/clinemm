# Adjudication-state matrix — R1…R10, and the two controls

> **CORRECTION01 APPLIES TO THIS FILE.** The R3/R7/R8 verdict-loss rows below are
> **strengthened** by direct measurement against the exact covered prefixes: each verdict
> phrase occurs **1** time in canonical 0..73 and **0** times in both the 36→37 and the
> 62→63 summaries. This is the finding that changes `NEXT_ACTION` from C to **A**.
> See `correction01-boundary-verification.md` §3.
> The R4 row's witness at "idx 194" is **withdrawn** as a pre-compaction witness; the
> correct pre-boundary witness is **canonical idx 124**.

**Rule applied:** `UNKNOWN` wherever support is insufficient. A finding is not credited
with a verdict the canonical record does not contain.

---

## 1. Shallow R1–R10 matrix

Columns:
- **Verdict in canonical record** — does the canonical record contain a *verifiable
  adjudicated verdict* for this finding?
- **Retained in continuing model context** — is that adjudication still present in the
  provider-visible context at the end of the run?

| ID | Verdict in canonical record | Evidence for the verdict | Retained in continuing model context? |
|---|---|---|---|
| **R1** | **`CONFIRMED`** — verifiable, at canonical idx 144 | "R1 CONFIRMED: manual `helm upgrade … -f values.yaml -f values-prod.yaml --set global.env=prod` renders `quay.io/keycloak/keycloak:26.0.7` — stock image, no async-profiler substrate…" | **YES** — formed at idx 144, i.e. **after** the last compaction boundary (idx 125), so it lives in the tail and is still present at idx 194. It was never at risk. |
| **R2** | `UNKNOWN` — the last verdict-shaped segment for R2 (idx 40) is about **R7** | The model gathered provider-timeout evidence (idx 70: Megafon/MTS 3s/10s, Telediscount call timeout up to 79 s, NotificationService 500 ms/1 000 ms configurable, no circuit breaker in the provider code, sync send in the authenticator) but never wrote an R2 verdict | **NO** — the 62→63 summary's `## Next` step 2 lists R2 among the items still to be captured; at idx 194 R2 is still item 1 of 5 remaining |
| **R3** | **`NARROWED`** — verifiable, at canonical idx 64 | "git history confirms the manual arithmetic was actually done (pool adjusted to 36 when replicas=11 → 396 ≤ 400)… So R3 is NARROWED: the risk is a manual process with a comment, no automated enforcement (true)" | **NO** — 0 occurrences of `NARROWED` outside the task-contract rubric in the 62→63 summary. Formed at idx 64, i.e. **before** the 36→37 boundary; **lost at 36→37**. |
| **R4** | **`UNKNOWN`** — 0 verdict-shaped statements for R4 in the entire 196-message record | The strongest R4 statement is at idx 194: "R4's claim of 'unnecessary build' is partially weakened… That's a strong falsification of the 'mixed build/drift' mechanism, at least for the freemarker case… Revised severity maybe 2/5." — a *narrowing in progress*, not a verdict | **NO** — the 62→63 summary retains only the task-contract allegation for R4; all source evidence, provenance and the narrowing reasoning are absent |
| **R5** | `UNKNOWN` — 0 verdict-shaped statements | idx 122 lists "R5 (6 indexes not in changelogs — confirmed)" inside a *planning* sentence, not a verdict. The model had established the 6-index delta at idx 110/112 but had not reconciled it against the changelogs to a verdict | **NO** — 0 occurrences in the 62→63 summary outside the contract |
| **R6** | `UNKNOWN` — 0 verdict-shaped statements | idx 68: "No DELETE anywhere in TokenCode JPA. R6: no retention mechanism in app." — an observation, plus an open question about an external purge | **NO** — idx 194 still lists R6 as item 2 of 5 remaining |
| **R7** | **`CONFIRMED`** (observation-level, severity narrowed) — at canonical idx 40 | "R7 verdict: CONFIRMED (observation-level) but severity may be narrowed: many of these tests are Kafka/tracing unit tests" — corroborated by idx 114/116 counts and idx 122's "43 tracked test java files" | **NO** — formed at idx 40, i.e. **before** the 36→37 boundary; **lost at 36→37** |
| **R8** | **`CONFIRMED` for exposure / `CONDITIONAL` for usability** — at canonical idx 28 | "R8's claim of committed bootstrap admin creds is CONFIRMED as an observation… Whether the credential is currently valid requires production access — NOT_EXECUTED. So verdict: CONFIRMED for exposure (severity maybe narrowed), CONDITIONAL for usability." | **NO** — formed at idx 28, **before** the 36→37 boundary; **lost at 36→37** |
| **R9** | `UNKNOWN` — the verdict-shaped segments (idx 26, 28) are about R1 and R8 | idx 106: "securityContext exists — keycloakx defaults runAsNonRoot: true, runAsUser 1000 → contradicts R9's claim of 'missing Keycloak workload security-context settings'" — counterevidence found, verdict not written | **NO** — idx 194 still lists R9 as item 4 of 5 remaining |

### Matrix summary

| | Count | IDs |
|---|---|---|
| Verifiable adjudicated verdict **present** in the canonical record | **4** | R1, R3, R7, R8 |
| Verifiable adjudicated verdict **absent** (`UNKNOWN`) | **6** | R2, R4, R5, R6, R9, R10 |
| Adjudication **retained** in the continuing model context at run end | **1** | R1 (formed *after* the last compaction, in the tail) |
| Adjudication **lost** at a compaction boundary (formed before it, gone after) | **3** | R3, R7, R8 (all formed before the 36→37 boundary) |

**The single most important structural fact in this matrix:** three of the four
verdicts the model *did* form (R3, R7, R8) were formed **before** the 36→37 compaction
and **lost** at it. The one verdict that survived (R1) survived only because it was
formed *after* the last compaction.

> The evidence-fidelity defect did not only cost the model its *facts*. It cost it
> the **verdicts it had already earned**.

> **CORRECTION01 — this is now the strongest finding (H6), and it is measured.**
> Each verdict phrase was counted directly against the exact covered prefixes:
>
> | Verdict phrase | canonical 0..73 | 36→37 summary | 62→63 summary |
> |---|---|---|---|
> | `R8's claim of committed bootstrap admin creds is CONFIRMED as an observation` | **1** | **0** | **0** |
> | `R7 verdict: CONFIRMED (observation-level) but severity may be narrowed` | **1** | **0** | **0** |
> | `R3 is NARROWED: the risk is a manual process with a comment, no automated enforcement (true)` | **1** | **0** | **0** |
>
> The associated evidence markers are lost too: `KC_BOOTSTRAP_ADMIN` (R8's object)
> 8 → 0, `quay.io/keycloak/keycloak:26.0.7` (R1's object) 12 → 0.
> **Behavioural consequence:** at canonical idx 154 the model re-lists R7 as outstanding
> ("I still need evidence for … R7 (43 tests + skipTests) …") and re-runs the Java-test
> count — work that was already adjudicated at idx 40. **This satisfies the Option A
> precondition: a previously established decision demonstrably disappears at compaction.**

---

## 2. Positive control — R1

**Selection rationale (G5):** R1 is a finding with enough preserved evidence to produce
a defensible adjudication, and the model **does not re-read its sources** afterwards.
This makes it the correct positive control, and the ACT's preference for a control
"where the model does not reread its sources" is met exactly.

| Dimension | Finding |
|---|---|
| **Claim** | The original R1 allegation (manual Helm upgrade deploys the stock image) was retained throughout — it lives in the task contract, which is preserved verbatim. |
| **Evidence** | **Preserved and sufficient.** The model established R1 from three independent sources: (a) `helm template` renders of `.helm/roz` with and without the CI `--set` flags (idx 16, 18, 20, 104, 142); (b) the vendored subchart default extracted from `keycloakx-7.0.1.tgz` → `quay.io/keycloak/keycloak:26.0.7` (idx 136, 138, 140); (c) the documented dev incident (idx 136: "there's documented evidence of a real incident: a release (PROMOTION04, line 192) had image = quay.io/keycloak/keycloak:26.0.7, a regression"). |
| **Provenance** | **Excellent.** File paths, line numbers (`values-dev.yaml` line 58-76; CI `--set` in `.gitlab-ci.yml`), the subchart archive path, and the incident document are all named. |
| **Counterevidence** | **Retained and decisive.** The model explicitly weighed the counterevidence that `values-dev.yaml` *does* pin the image, narrowing R1 to prod/pp manual upgrades: "dev is now pinned… So R1 stands but scope narrowed to prod/pp manual upgrades" (idx 26); and idx 90: "values-dev.yaml pins repository+tag for dev. values.yaml/values-prod.yaml do NOT pin image repository." |
| **Adjudication** | **`CONFIRMED`, verifiable, at canonical idx 144.** A supported verdict with an explicit mechanism. |
| **Remaining work** | **Retained.** idx 144's R1 segment names the residual: the requirement of an operator running a manual `helm upgrade` without the CI `--set`. |

**No re-read of R1's sources after the verdict.** A scan of every assistant tool call at
canonical index > 144 finds **no** re-read of `values.yaml`, `values-prod.yaml`,
`values-dev.yaml` or the subchart `values.yaml` *for R1*. The idx 162/170/172/174/176
calls that touch the subchart are for **R8** (bootstrap-admin credentials) and **R9**
(NetworkPolicy / PDB / securityContext), and they read *different* files
(`networkpolicy.yaml`, `poddisruptionbudget.yaml`, the subchart's `values.yaml`
networkPolicy block).

**Why R1 does not re-read, and R4 does — the contrast that identifies the cause:**

| | R1 | R4 |
|---|---|---|
| Verdict formed | yes, idx 144 | never |
| Formed before or after the last compaction? | **after** (144 > 125) | n/a |
| Re-read after verdict? | **no** | n/a |

---

## 3. Negative control — R5

**Selection rationale (G5):** R5 is a finding with genuinely incomplete/conflicting
evidence, where further investigation is necessary. R3 and R7 were considered and
rejected:

- **R3** is not a valid negative control: it was **adjudicated** (NARROWED, idx 64) and
  the counterevidence was explicit and sufficient. It is a *completed* finding.
- **R7** is not a valid negative control: it was adjudicated at idx 40 and its count
  evidence was re-verified and agreed on at idx 114/116/122 (73 → 43 corrected). It is
  a *completed* finding.
- **R5** qualifies: the model found the six-index delta (idx 110/112), found that the
  provider changelogs *do* run through Keycloak's `JpaEntityProvider` (idx 58) — which
  *conflicts* with a naive reading of the finding — and found `MARK_RAN` preconditions
  whose Russian-language comments say the index may have been created manually on prod
  (idx 54). The evidence points in two directions and was never reconciled.

| Dimension | Finding |
|---|---|
| **Claim** | The original R5 allegation (six production indexes absent from Liquibase changelogs; `MARK_RAN` used for a related precondition; a retracted sub-claim about `KC_LIQUIBASE_DATABASE_ON_STATE_CONFLICT` that must not be resurrected) was retained in the task contract throughout. |
| **Evidence** | **Genuinely incomplete and partly conflicting.** Established: the six-index delta file and its two CSV inventories (idx 110); that the provider changelogs are executed by Keycloak's `JpaEntityProvider.getChangelogLocation()` (idx 58); that `MARK_RAN` preconditions exist with the manual-creation comment (idx 54). **Not established:** whether the six indexes are reproducible from the changelogs; whether `MARK_RAN` is the cause of the gap or a correct guard; the DB1/DB2 identity (which database is production). |
| **Provenance** | **Present but thin.** `pg-index-diff-20260624T070800Z/index_delta_db1_to_db2.sql`, `db1.indexes.sql`, `db2.indexes.sql`, `phone-providers/keycloak-phone-provider/src/main/resources/META-INF/changelog/token-code-changelog.xml` — paths and the changelog's `onFail="MARK_RAN"` line numbers are named. The **revision** is recoverable from the surrounding identity checks. |
| **Counterevidence** | **Present and material** — this is what makes R5 a valid negative control: idx 58 "Keycloak's JpaEntityProvider.getChangelogLocation() causes Liquibase to run those changelogs at startup — so provider schema IS created via Liquibase", which *weakens* the "cannot be reproduced" framing. The model also found the `MARK_RAN` precondition semantics could *legitimately* explain a pre-existing index. |
| **Adjudication** | **`UNKNOWN`.** No verdict-shaped statement exists for R5. The model never wrote "R5 is …". idx 122's mention ("R5 (6 indexes not in changelogs — confirmed)") is a planning list, and the word "confirmed" there describes the *observation*, not a verdict. |
| **Remaining work** | **Specific and retained — at idx 194:** "3. R5: verify the 6 indexes in delta and whether Liquibase changelogs contain them, and MARK_RAN usage." A single, decisive, bounded next action that was **still open at the end of the run**. |

**Why R5 is a valid negative control, and what it demonstrates about the R4 chain:**

Further R5 investigation is **necessary** — the counterevidence is real and
unreconciled, and the model was right to keep working on it. R5 was *also* read
repeatedly across the run (idx 8, 24, 50, 52, 54, 56, 82, 98, 106, 108, 110, 112, 114,
122, 130, 138, 146) — but every one of those reads targeted a **distinct** question
(the delta file, the changelog inventory, `MARK_RAN` semantics, the `JpaEntityProvider`
mechanism, the index-name comparison). None is a repeat of an already-answered
question.

**The contrast is the point:**


---

## 4. Does the R4 case pass H3 or H2's counterexample? (G7)

### H2 counterexample (adjudication continuity) — **NOT met at the decision limb; met at
### the progress limb, for boundary 62→63**

| G7 condition | Met? | Evidence |
|---|---|---|
| 1. The model made a source-supported R4 adjudication before compaction | **PARTIAL** | At 62→63 the model had a source-grounded *narrowing* ("the 'mixed build/drift' mechanism [is] falsified … at least for the freemarker case", idx 148/194), not a terminal verdict. At 36→37 there was **no** adjudication at all (`ADJUDICATION_NOT_YET_ESTABLISHED`). |
| 2. The summary or provider continuation omitted that adjudication | **YES** | 0 occurrences of the docs quote, of `PersistedConfigSource`, and 0 verdict-shaped R4 statements in either summary. |
| 3. The model subsequently investigated the same already-resolved uncertainty | **YES, partially** | After 62→63 the model re-read `startup.sh` (idx 146) and re-grepped `PersistedConfigSource` (idx 148) — the same uncertainty. After 36→37 it re-read `startup.sh` and asked "does startup.sh run `kc.sh start --optimized`?", an answer already held at idx 6. |
| 4. No intervening source change or new contradictory evidence justified reopening | **YES** | HEAD `42de653b…` and a clean tree observed identically at idx 3, 75, 155. No contradictory evidence was introduced. |

**H2's counterexample is NOT fully met** at the decision limb. The honest verdict is
that **adjudication *progress* was demonstrably lost** (conditions 2, 3, 4 fully met;
condition 1 met only in the "progress" sense), while a **decision** was never
established at either boundary and therefore could not be lost.

### H3 counterexample (unnecessary reverification) — **NOT met**

| G7 condition | Met? | Evidence |
|---|---|---|
| 1. All evidence required for the specific question remained provider-visible | **NO** | 0 occurrences of the R4 source evidence immediately before idx 74 and before idx 146. |
| 2. The model nevertheless reread the source | **YES** | idx 74, idx 146. |
| 3. The read yielded no material new information | **YES** | identical substantive `startup.sh` lines; read #5 = 446 bytes re-supplying read #1's facts. |
| 4. The behaviour occurred at an identified model request/action boundary | **YES** | canonical idx 74 and idx 146, each immediately following a compaction boundary. |

**H3's counterexample fails condition 1.** That is the decisive negative: the reads
were not gratuitous; they were *forced* by a context that had been emptied.

### The minimum causal counterexample that IS established

The ACT's success condition is to "classify at least one concrete R4 decision
boundary". The following counterexample **is** fully met:

> **At canonical idx 74 (immediately after the 36→37 compaction boundary):**
> 1. The fact "`startup.sh` contains `/opt/keycloak/bin/kc.sh build` followed by
>    `exec /opt/keycloak/bin/kc.sh start --optimized "$@"`" was independently verified
>    before the boundary (read at idx 6→7, corroborated at idx 52/53 and 60/61).
> 2. The 36→37 summary omits it completely (0 occurrences), and moreover asserts the
>    false claim "Tool outputs are omitted in the transcript".
> 3. The model, immediately after the boundary, re-reads `startup.sh` — asking a
>    question it had already answered ("does startup.sh run `kc.sh start --optimized`?").
> 4. No source change occurred (HEAD identical at idx 3 / 75 / 155; tree clean) and no
>    new contradictory evidence existed.

This is the **H1 counterexample**, fully satisfied, at a named model action boundary.

**Conclusion:** the causal boundary is classified as **`PREVIOUS_EVIDENCE_UNAVAILABLE`
caused by compaction-summary evidence loss**, not as gratuitous re-verification and
not as a general convergence failure.

| | R5 (negative control) | R4 (primary case) |
|---|---|---|
| Question state | genuinely open, counterevidence unreconciled | question was already answered in the canonical record |
| Reads after the question was answerable | each targeted a *new* discriminator | idx 74/146 targeted a question answered at idx 6 |
| Repetition signature | many reads, **no** repeated question | few reads, **repeated question** |

**A finding that genuinely needs more evidence is read many times, each time for a new
reason. A finding whose evidence was lost is read again for the same reason.** R5 is
the control that shows the model's repeated reading of R5 is *not* the same pathology
as its re-reading of R4.

| Re-read after a compaction? | n/a | yes — idx 74, 146 |

**R1's success is explained by a single difference: its adjudication happened to be
formed after the last compaction, so it was never at risk.** That is a boundary-timing
accident, not a model-strength difference. It does not indicate that the model
"converges better" on R1.

| **R10** | `UNKNOWN` — the verdict-shaped segment (idx 26) is about R1 | idx 122: "R10 (hook-weight semantics)" was still open; the model fetched Helm source at idx 94–100 and 178–194 | **NO** — idx 194 still lists R10 as item 5 of 5 remaining |
