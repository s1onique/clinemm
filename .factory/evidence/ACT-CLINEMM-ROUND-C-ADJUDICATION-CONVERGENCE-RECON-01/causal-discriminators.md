# Causal discriminators — H1 … H5, evaluated independently

> **CORRECTION01 APPLIES TO THIS FILE.** Three corrections were upheld on review:
> 1. **P0-1 (chronology):** the R4 narrowing witnesses cited below at "canonical idx 148
>    thinking; restated and sharpened at idx 194" are **post**-boundary. The correct
>    pre-boundary witness is **canonical idx 124** (inside 0..125). The H2 conclusion
>    for 62→63 stands on idx 124; §2's H2 text below is corrected in place.
> 2. **P0-2 (serializer):** §0's mechanism is **confirmed and refined** — the loss is at
>    the *serializer* boundary, proven by 7 captured summarizer requests carrying 0
>    occurrences of the R4 witness. The original report's separate claim that the
>    summary's "outputs omitted" assertion was *false* is **withdrawn**: it was truthful
>    about the summarizer's own input.
> 3. **H5:** reclassified `SUPPORTED` → **`INDETERMINATE`** (most cited witnesses are
>    post-boundary and explained by lost-verdict re-verification).
> 4. **New H6** (previously established adjudication outcomes are lost) is established
>    and is the strongest finding; it justifies `NEXT_ACTION: A`.
>
> See `correction01-boundary-verification.md`. The text below is retained as the
> original record, with corrections marked inline.

**Rule applied:** each hypothesis is tested at a named **observation boundary**.
Provider-request *input* is never treated as a model response to that same request.


---

## 0. The production seam that makes the causal chain possible

`REAL_PRODUCTION_SEAM` — `sdk/packages/core/src/extensions/context/compaction-shared.ts`,
function `renderStructuredToolPayload()` (lines 258–280):

```ts
const rawResult = payload.result;
const sourceFileFact = buildSourceFileFact(payload, toolName);
if (sourceFileFact) {
    return `[${status}] source-file ${sourceFileFact.path}: ${sourceFileFact.excerpt}`;
}
const approvedResult =
    typeof rawResult === "boolean" ? `result=${rawResult}`
  : typeof rawResult === "number" && Number.isFinite(rawResult) ? `result=${rawResult}`
  : OMITTED_STRUCTURED_RESULT_MARKER;          // "[result omitted]"
return `[${status}] ${label}: ${approvedResult}`;
```

The production `run_commands` executor emits `{query, result, success}` where `result`
is a **string** (stdout). A string is neither `boolean` nor `number`, so it renders as
the literal `[result omitted]`.

`buildSourceFileFact()` (in `evidence-continuity.ts`) cannot rescue it for two
independent reasons, both verified in source:

1. `SOURCE_FILE_FACT_CARRY_FORWARD_ENABLED = false` (line 525) — the automatic
   carry-forward is **off by default** (CONTAINMENT01).
2. `if (toolName !== SOURCE_FILE_READ_TOOL_NAME) return undefined;` where
   `SOURCE_FILE_READ_TOOL_NAME = "read_files"` (line 341). The observed tool is
   **`run_commands`**.

**Consequence:** a `run_commands` result is projected into the summarizer input as
`[succeeded] #N: [result omitted]`, with **no** stdout content, **no** source path, and
**no** provenance — even though the payload's `query` names the exact command.

This is confirmed by the existing production-seam suite
`compaction.evidence-fidelity01.test.ts` — **CONTROL 12** and **CONTROL 19** both
assert that a `run_commands` payload's stdout is projected as `[result omitted]` and

---

## 1. H1 — Source evidence lost

> *The model reacquires evidence because a necessary source fact was omitted by
> compaction.*

**Discriminator:** an independently verified fact present before compaction, unavailable
afterward, followed by a read targeting that fact.

**Evaluation: `SUPPORTED`.**

| Element | Evidence | Label |
|---|---|---|
| Independently verified fact present before compaction | The R4 witness fact `/opt/keycloak/bin/kc.sh build` was read from `startup.sh` at canonical idx 6→7 and independently corroborated at idx 52/53 (`Dockerfile.roz:189 ENTRYPOINT ["/opt/keycloak/bin/startup.sh"]`) and idx 60/61 (`Dockerfile.roz:186 RUN /opt/keycloak/bin/kc.sh build --spi-freemarker--provider-default=roz-fm233`). 5 occurrences in the 36→37 pre-compaction provider request; 7 in the 62→63 one. | REAL |
| Unavailable afterward | 0 occurrences of the witness, of `start --optimized`, of the Dockerfile build line and of `PersistedConfigSource` in **both** generated summaries. | REAL |
| A read targeting that fact follows | idx 74/75 re-reads `cat startup.sh` **and** `cat Dockerfile.roz`; idx 146/147 re-reads `cat startup.sh` and greps `Dockerfile.roz` for `kc.sh build`. | REAL |
| Independent verification of the fact itself | The fact was verified against the frozen source revision `42de653b…`, and the model's own read at idx 74 confirms the same HEAD with a clean tree (`porcelain \| wc -l` → `0`). | REAL |

**Observation boundary:** the compaction boundary — specifically the transition from the
36→37 summary to the model's idx 74 tool call, and from the 62→63 summary to the
model's idx 146 tool call.

**Causal support** is anchored at that boundary, not at the file itself. The evidence
was not absent from the *canonical* record; it was absent from the *provider-visible
continuation* that the model acts on.

---

## 2. H2 — Adjudication progress lost

> *The model had already resolved a claim or identified the precise remaining
> discriminator, but the summary retained only the original allegation or broad next
> steps.*

**Discriminator:** a source-grounded decision or bounded next action exists before
compaction and disappears in the continuing context.

**Evaluation: `SUPPORTED` for boundary 62→63; `REFUTED` (decision limb) / `SUPPORTED`
(bounded-next-action limb) for boundary 36→37.**

### Boundary 36→37

- The **decision** limb fails: the model formed **no** R4 verdict before this
  compaction (0 verdict-shaped statements in the entire canonical record for R4).
  Its own words at idx 72: *"Now I need authoritative upstream docs: 1. Keycloak
  `kc.sh build` semantics: does running build at startup cause drift / is it
  required?"* — an explicitly **open** question.
  → classification: **`ADJUDICATION_NOT_YET_ESTABLISHED`**, not `ADJUDICATION_LOST`.
- The **bounded next action** limb succeeds: the precise remaining discriminator —
  *"does the startup build erase the CI-baked `roz-fm233` SPI default, given that
  `PersistedConfigSource` is a config source?"* — was established pre-compaction and is
  **absent** from the 36→37 summary (B=0 for `PersistedConfigSource`, 0 for the docs
  quote). The summary instead prescribes a generic re-run list.

### Boundary 62→63 — `SUPPORTED` on both limbs.


---

## 3. H3 — Evidence retained, unnecessary reverification

> *The model could already access sufficient evidence and its supporting provenance,
> yet rereads the same source without obtaining materially new information.*

**Evaluation: `REFUTED` as the description of the observed R4 reads.**

The discriminator requires *"relevant evidence is provider-visible immediately before
the repeated read"*. It was **not**:

| Pre-read boundary | Relevant evidence provider-visible immediately before? | Count |
|---|---|---|
| Before idx 74 (post-36→37) | R4 source evidence | **0** |
| Before idx 146 (post-62→63) | R4 source evidence | **0** |
| Before idx 148 (post-62→63) | `PersistedConfigSource` semantics | **0** |

Conditions 2 and 3 of the H3 counterexample *are* met (the read yielded no material
new information; the behaviour occurred at an identified model action boundary — idx
74, idx 146, idx 148). But **condition 1 fails**, and condition 1 is the one that
distinguishes H3 from H1. H3 therefore does not describe the observed reads.

**H3 is not wholly excluded as a *co-existing* mechanism**, because the canonical
record does contain a class of genuinely self-sufficient re-verification that is not
compaction-caused:

- `git rev-parse HEAD` / `git status --porcelain` recur at idx 2, 4, 74, 154 — a
  **Phase-0 identity re-check** the model was *instructed* to perform ("Verify
  repository identity and record working-tree status"), which is legitimate
  re-verification, not redundancy.
- idx 162, 170, 172, 174, 176 re-touch `keycloakx` subchart files, but for **R8/R9/R10**
  (bootstrap credentials, NetworkPolicy, PDB), not for R1's image sources. These are
  **not** R1 source re-reads.

So H3 is `REFUTED` **for the R4 chain**; the re-reads that do occur elsewhere in the
run are either task-mandated or target different findings.

---

## 4. H4 — Legitimate adversarial investigation

> *The original claim survives, but its counterevidence or adjudication is genuinely
> incomplete. The repeated read addresses a specific unresolved counterclaim or adds
> material information.*

**Evaluation: `SUPPORTED` — and it is the *primary* explanation for the reads
themselves; it is only *not* sufficient as an explanation of the *repetition*.**

**H4 is `SUPPORTED` on the facts.** The R4 counterevidence was genuinely incomplete at
both boundaries:

- The 36→37 compaction: the model had fetched 21 951 bytes of Keycloak documentation
  and had **not** yet concluded from it (it was mid-reasoning at idx 74).
- The 62→63 compaction: the model's own final reasoning (idx 194) shows the R4
  counter-argument was **developed but unfinished** — it still needed Keycloak's
  persisted-config source ordering, which it was fetching in its very last tool call
  when the transcript stopped.

**H4 is `SUPPORTED` for read #6** (idx 148→149) on its own terms: it added material
information (`PersistedConfigSource` semantics, the CI persistence assertions, the
repository's own evidence-binding document) that was genuinely absent from the model's

---

## 5. H5 — General model convergence failure

> *Even without compaction-related state loss, the model repeatedly investigates
> sufficiently supported findings and fails to form terminal verdicts.*

**Evaluation: `INDETERMINATE`** — the original report's `SUPPORTED` is **withdrawn**.

> **CORRECTION01 — H5 reclassified.** The original report claimed the witnesses below
> occurred "before any compaction". Exact timing against the first cutoff (canonical
> idx 73) contradicts that: of the java-test counts (36, 114, 116, 154) only **1**
> precedes it; of the `helm template` renders (16, 18, 20, 32, 102, 104, 142, 176, 186)
> only **5** do; of the `tar` attempts (28, 134, 136, 138, 140, 170) only **1** does.
> Moreover the post-boundary instances are **not redundant**: idx 114/116/154 are
> necessary re-verification of R7 **after its verdict was lost** (see
> `correction01-boundary-verification.md` §3); the `helm template` renders addressed
> different sub-questions; the `tar` attempts included explicit error recovery
> ("tar extraction failed because the tgz path… Let me retry").
> **What remains `REAL`:** the session did not converge — no verdict matrix, no terminal
> tool call, 5 findings still open at the final turn. **What is not established:** that
> a *general model convergence defect* caused it. Loss of adjudication (H6) is a
> demonstrated alternative explanation.


**Discriminator:** *"equivalent redundant behaviour occurs before compaction, or in the
presence of complete provider-visible adjudication evidence."*

**Both limbs are satisfied:**

1. **Before compaction.** The model re-read the same source **before** any compaction
   boundary had removed anything:
   - idx 36 → a `git ls-files '*.java' | grep -c '/test/'` count, followed by idx 114
     (`git ls-files | grep -E '\.java$' | grep -i -E 'test' | wc -l`) and idx 116
     (`git ls-files | grep -E 'src/test/.*\.java$' | wc -l`) — **three counts of the
     same quantity**, differing only in the grep pattern, because the model was
     chasing an inconsistency in its own counting method (idx 36: *"73 java test
     files, not 43"*; idx 112: *"the search output format is odd — line numbers seem
     misaligned"*).
   - The `helm template` render was issued at idx 16, 18, 20, 32, 102, 104, 142, 176 —
     **eight** renders of the same chart, each answering a different sub-question
     (image line, replicas, pool, NetworkPolicy/PDB, sed line range).
   - `tar -xzf … keycloakx-7.0.1.tgz` was attempted at idx 28, 134, 136, 138, 140,
     170 — **six** attempts, with the model explicitly diagnosing its own failures
     (idx 138: *"tar extraction failed because the tgz path… Let me retry"*).
2. **With complete provider-visible adjudication evidence.** The model formed a
   **CONFIRMED** verdict for R1 at idx 144 and then **kept re-deriving R1's image
   evidence** at idx 162, 170, 172, 174, 176 (subchart extraction, `helm template`
   with `sed -n`) while working R8/R9/R10 — and, critically, **never re-read R1's own
   image sources** after the verdict.

**Why H5 is not the cause of the R4 rereads:** H5 predicts redundancy *despite*
adequate context. The R4 rereads happened *because* context was inadequate. If H5
were the cause, the model would have re-read `startup.sh` **before** the 36→37
compaction too — it did not: `cat startup.sh` occurs exactly at idx 6, 74 and 146,
i.e. **once before** and **once after each** compaction, and never otherwise.

The cleanest single statement of the whole finding:

> **The repetition is exactly boundary-aligned.** `cat startup.sh` occurs 3 times:
> 1 before any compaction, 1 after each of the 2 compactions. It is not scattered.

**A distinct, independent H5 finding:** the session **never converged**. It produced
**no** verdict matrix, called **no** terminal tool, and ended with R4 still open after
196 messages, 97 tool calls and 44 minutes. The model's own working summary at idx 194
lists **five** remaining findings (R2, R6, R5, R3, R4) as still to be settled.

---

## 6. Hypothesis summary

| Hypothesis | Verdict | Observation boundary of the support |
|---|---|---|
| **H1 — source evidence lost** | **`SUPPORTED`** | 36→37 and 62→63 compaction boundaries: fact present in A (5 / 7 occurrences), 0 in B, targeted read follows |
| **H2 — adjudication progress lost** | **`SUPPORTED` (62→63)**; **`REFUTED` for a lost *decision* at 36→37**; the 36→37 boundary supports only the *bounded-next-action* limb | 62→63 compaction: narrowing reasoning + decisive next step in A, absent from B. 36→37: `ADJUDICATION_NOT_YET_ESTABLISHED` |
| **H3 — evidence retained, unnecessary reverification** | **`REFUTED` for the R4 chain** | Pre-read provider-visible evidence = 0 at both re-read boundaries; condition 1 of the H3 counterexample fails |
| **H4 — legitimate adversarial investigation** | **`SUPPORTED`** (primary for the reads' *content*; insufficient for their *repetition*) | 62→63: counterevidence genuinely incomplete at idx 194; read #6 added material information |
| **H5 — general convergence failure** | **`INDETERMINATE`** (CORRECTION01; was `SUPPORTED`) | Most cited witnesses are post-boundary and are explained by lost-verdict re-verification; the absence of terminal completion is `REAL` but its cause is not established |
| **H6 — previously established adjudication outcomes are lost at compaction** (NEW in CORRECTION01) | **`SUPPORTED`** | R8 CONFIRMED (idx 28), R7 CONFIRMED (idx 40), R3 NARROWED (idx 64) are each present in canonical 0..73 and **0** in both summaries; R7 is re-listed as outstanding at idx 154 and re-verified |

**The hypotheses are not exclusive.** H1 + H4 + H6 all hold, at different boundaries and
explaining different parts of the observed behaviour. The R4 *repetition* is
**H1 + H4**; the loss of already-earned verdicts — and therefore the bulk of the
observed redundant re-work (including the R7 re-verification) — is **H6**; the
session's failure to terminate is `REAL` but its cause is **not established** (H5).

context.

**H4 does not explain read #4 or read #5 as *repeated* work.** Under H4, a read is
legitimate when it adds material information or addresses a *specific unresolved
counterclaim that the model knows about*. Reads #4 and #5:

- returned **no** material new information (identical substantive lines; 446 bytes for
  read #5 re-supplying what read #1 supplied in 805);
- addressed a question ("does startup.sh run `kc.sh start --optimized`?") that was
  **already answered** in the canonical record and that the model **knew it had
  answered** — the model's own thinking says *"Let me re-read startup.sh"*, not
  "let me verify X".

**The resolution:** reads #4 and #5 are legitimate **given the model's context** and
**unnecessary given the canonical record**. That is exactly the conjunction
`PREVIOUS_EVIDENCE_UNAVAILABLE` + H1. H4 and H1 are therefore **not exclusive** —
H4 explains why the investigation was still open, H1 explains why the *same* source had
to be re-read.

- **Decision/progress limb:** before the 62→63 compaction the model had developed the
  source-grounded narrowing that the startup build *re-persists* rather than erases
  the CI-baked SPI default, and that the "mixed build / drift" mechanism is therefore
  **falsified at least for the freemarker case**.
  > **CORRECTION01 — the witness is canonical idx 124** (inside the 0..125 covered
  > prefix), verbatim: *"So the bake is preserved across startup re-builds. That's a
  > strong falsification of the 'mixed build/drift' mechanism, at least for the
  > freemarker case."* and *"the build at startup is redundant work, but not
  > drift-prone. Revised severity maybe 2/5."* The originally-cited idx 148 / idx 194
  > are **post**-boundary and are withdrawn as pre-compaction witnesses.
  It is present in A (canonical prefix 0..125) and **absent
  from B** (0 occurrences of the docs quote, 0 of `PersistedConfigSource`, 0
  verdict-shaped R4 statements).
- **Bounded next action limb:** the model's stated next step was to verify
  the persisted-source ordering from Keycloak's own source — a single, decisive,
  bounded action. It is not in B. (The original report cited idx 194 for this; that
  index is post-boundary and is withdrawn as a *pre*-compaction witness. The bounded
  next action is nonetheless recorded in the canonical prefix at idx 124, which ends
  with "Let me verify Keycloak's config source ordering from source to be safe.")

**Precision required by the ACT:** the lost item is **progress**, not a terminal
decision. The model had not reached a final R4 verdict at either boundary. Reporting
it as a lost *decision* would overstate the evidence.

**Observation boundary:** the 62→63 compaction — the transition from the 62→63 summary
to the model's idx 146 and idx 148 tool calls.

that the secret is absent. That suite was executed in this ACT: **39 passed (39)**,
exit 0.

> **The mechanism was already known and already documented** by
> `ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-01`
> (`.factory/ACT-CLINEMM-COMPACTION-EVIDENCE-FIDELITY-01.md`), whose own text says:
> *"the summarizer then truthfully reported that the outputs were omitted, and the
> model re-ran `cat startup.sh`"*. This ACT does not discover the mechanism; it
> **establishes its causal weight at a named decision boundary** and determines which
> of H1–H5 is the correct description of the *observed* R4 reads.
