# 03 — The measurement

ACT-CLINEMM-COMPACTION-TASK-CONDITIONED-EVIDENCE-SELECTION-01

## The frozen artefacts

Both were verified, not assumed.

```
FROZEN_PREFIX        = sha256:00720111f28d759454e244ff70200e390b1b710e83e7e77e2136fe2bbe4c22fc
FROZEN_SUMMARY_DIGEST= sha256:9ac862f0a4c1d4c56bca01978e61d5122603e3c3ba9dc2f795a81942bde1e93d
boundary             = 244
fullCanonicalLength  = 246
postBoundaryCount    = 2
```

The prefix hash is recomputed with the **production** hash function and
compared with the sidecar's recorded `source_prefix_hash`; a mismatch throws.
The summary digest is recorded on first use and re-verified on every later
run, so a changed summary cannot silently alter the comparison.

**No summarization request was made.** Every arm reuses the SAME frozen
ordinary summary, the SAME retained tail, the SAME task contract and the
SAME verified-outcome carry-forward. The arms differ ONLY in the selection.

## THE BINDING CONSTRAINT WAS NOT THE SELECTOR — IT WAS THE ADMISSION ORDER

The predecessor's finding was that "the selection is the binding constraint".
The measurement over the frozen W1 workload showed something sharper.

The predecessor's extraction applied the **fragment budget BEFORE** the
ranking:

```
candidates.sort(...)                 // rank the ADMITTED set
const admitted = candidates.slice(0, maxFragments);
```

so the candidate set handed to any selector was already the **first 24
payloads in transcript order**. Measured over the frozen prefix:

```
admitted (predecessor)  = 24 of 122 eligible payloads
decisive indexes 145, 147, 187, 189  ->  NOT ADMITTED
```

**A selector cannot choose a fragment it was never offered.** The decisive
evidence for O1 (the failed render) and O7 (the timeout constants) was
invisible to every arm, including the shape-based baseline.

The repair is `extractSourceBoundEvidenceCandidates()`: the ADMISSION RULES
are applied in full, but the **budget is not**. The confidentiality rules —
the credential-bearing source refusal, the empty-body refusal, the
bound-then-redact order and the value-position sanitizer — are **unchanged**.
Only the ORDER changes: the budget is now spent by the SELECTION, after the
selection.

After the repair: **122 of 122** eligible payloads are admitted, including
every decisive one.

## The selector ladder, measured

All arms over the same frozen prefix, the same frozen summary, the same
budget family, the same scorer.

| arm | budget | selected | estTokens | critOmitted | critPreserved | O1 | O4 | O7 | distortions |
|---|---|---|---|---|---|---|---|---|---|
| baseline (no section) | — | 0 | 0 | **5** | 0 | OMITTED | OMITTED | OMITTED | 0 |
| **S0** SHAPE | 512 | 3 | 512 | 4 | 0 | OMITTED | OMITTED | OMITTED | 0 |
| S0 SHAPE | 1024 | 6 | 1022 | 4 | 0 | OMITTED | OMITTED | OMITTED | 0 |
| S0 SHAPE | 2048 | 8 | 2042 | 4 | 0 | OMITTED | OMITTED | OMITTED | 0 |
| S1 TASK_CONDITIONED | 512 | 3 | 512 | 4 | 0 | OMITTED | OMITTED | OMITTED | 0 |
| S1 TASK_CONDITIONED | 1024 | 3 | 1012 | 4 | **1** | OMITTED | OMITTED | OMITTED | 0 |
| S1 TASK_CONDITIONED | 2048 | 5 | 2034 | 4 | **1** | OMITTED | OMITTED | OMITTED | 0 |
| **S2** SUBJECT_DIVERSITY | 512 | 3 | 512 | 4 | 0 | OMITTED | OMITTED | OMITTED | 0 |
| S2 SUBJECT_DIVERSITY | 1024 | 3 | 1012 | 4 | **1** | OMITTED | OMITTED | OMITTED | 0 |
| **S2 SUBJECT_DIVERSITY** | **2048** | **5** | **2030** | **3** | **1** | OMITTED | OMITTED | **PARTIALLY_PRESERVED** | **0** |
| S3 MINIMAL_WINDOW | 512 | 3 | 490 | 4 | 0 | OMITTED | OMITTED | OMITTED | 0 |
| S3 MINIMAL_WINDOW | 1024 | 4 | 1020 | 4 | 1 | OMITTED | OMITTED | OMITTED | 0 |
| S3 MINIMAL_WINDOW | 2048 | 6 | 2045 | 4 | 1 | OMITTED | OMITTED | OMITTED | 0 |

**S2 at 2048 is the strongest candidate**: the critical omissions fall
5 → 3, O7 moves `OMITTED` → `PARTIALLY_PRESERVED`, and there are **zero**
material distortions.

## The structural ablation proves it is causal

The ablation is the SAME continuation with the carried section **stripped**.
The summarizer request is byte-identical and the ONLY difference is the
selection.

```
S2 @ 2048              critOmitted=3  critPreserved=1  O7=PARTIALLY_PRESERVED
S2 @ 2048  ABLATED     critOmitted=5  critPreserved=0  O7=OMITTED
```

The improvement is attributable to the selection and to nothing else.

## What the measurement FOUND about the signal

Three iterations of signal refinement were made, and each was measured. The
findings are the ACT's substantive contribution.

### Finding 1 — the tool name is not a subject

Every command-derived fragment's source attribution is the TOOL's name, so
every fragment shares the tokens `run` and `commands`. Those tokens are in
EVERY fragment and carry no information. They are now **excluded** from the
subject tokens — derived from the runtime-owned tool name, so the exclusion
is generic and applies to every tool.

### Finding 2 — the TASK CONTEXT is the wrong signal

The task context is the session's own brief and the **previous session's
PLAN**. Its vocabulary (`phase`, `act`, `watcher`, `job`, `helm`) is
**DECLARED** by the planning fragments, so a fragment can win by declaring
many plan words. A plain token-overlap score therefore selected
`[225, 125, 231, 127, 217, 165]` — none of them decisive.

### Finding 3 — the CALL INPUTS are the right signal

The agent's own tool **call inputs** are the runtime's record of its
operational intent. They are runtime-owned, not model-authored, and not
extracted from a tool result's content. Over the frozen W1 prefix they name
`NotificationServiceClient`, `DEFAULT_SOCKET_TIMEOUT`, `47` and `*Test.java` —
the decisive subjects — while the plan vocabulary does not.

The selection now weights a fragment's **declared subject** by its
**specificity** (the inverse of its document frequency across the candidate
set), and the call-input identifiers carry the strongest weight. The
incidental task-word overlap is discounted and **saturating**, so breadth
cannot win.

### Finding 4 — the subject tokens must exclude the tool

Included in Finding 1's repair. The measurement before and after is in the
exit report.

## The coverage/cost frontier

| candidate | critOmitted | estTokens | verdict |
|---|---|---|---|
| baseline | 5 | 0 | the production omission |
| S2 @ 512 | 4 | 512 | one critical recovered at 512 tokens |
| S2 @ 1024 | 4 | 1012 | one critical recovered; no further gain |
| **S2 @ 2048** | **3** | **2030** | **the frontier point: O7 recovered** |

The frontier is **not** flat: the second critical proposition only appears
at 2048 estimated tokens. The cost is 2030 estimated tokens of the **rendered**
section, including the delimiters and the attribution metadata — not of the
summarizer prompt, which is unchanged.

## The selection's own cost

The selection is DETERMINISTIC and bounded:

- the admission walks the boundary prefix **once**;
- every payload is bounded (2 000 chars) and redacted before it is admitted;
- the ranking is a total order (score descending, then canonical index);
- the budget is applied FAIL-CLOSED: a candidate that does not fit is not
  partially carried.

The total deterministic processing cost is bounded by the **prefix size**,
not by the transcript and not by the carried size. Measured over the frozen
prefix: 122 candidates examined, 0 uncorrelated, and the whole evaluation
(12 arms × 3 budgets) completes in well under a second.
