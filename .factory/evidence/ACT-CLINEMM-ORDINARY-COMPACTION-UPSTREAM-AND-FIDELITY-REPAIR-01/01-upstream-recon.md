# ACT-CLINEMM-ORDINARY-COMPACTION-UPSTREAM-AND-FIDELITY-REPAIR-01

## 01 — Upstream reconnaissance

```text
UPSTREAM_REMOTE:  upstream = https://github.com/cline/cline.git (fetch)
UPSTREAM_HEAD:   34c104e6fc49781cda4adcd73ffdccd8f029fef9
                 ("Move the third party notices to the root on the CLI install (#15836)")
UPSTREAM_DATE:   2026-11-23 13:06:22 +0100
INSPECTION:      a shallow fetch of that exact commit into a scratch directory.
                 The current branch and the remotes were NOT modified.
```

### 1.1 The actual status of each candidate

| Ref | Actual status at the inspected commit | Files |
| --- | --- | --- |
| Issue #15783 (agentic compaction invalidates prompt/KV caches) | **OPEN**, 1 comment, no linked changeset | — |
| PR #15787 ("Fix/15783 compaction kv cache") | **OPEN, NOT MERGED**, `merged_at: null`, `draft: false`, 2 comments | `agentic-compaction.ts` (+239/-38), `compaction-shared.ts` (+52), `compaction.ts` (+16), `summary-generation.ts` (+18/-4), `compaction.test.ts` (+289) |
| Issue #14732 (incomplete summary installed silently) | **OPEN**, 8 comments | — |
| PR #14741 ("retry and warn when the summarizer truncates") | **OPEN, NOT MERGED**, `merged_at: null`, 4 comments | `agentic-compaction.ts` (+129/-19), `compaction-shared.ts` (+18), `compaction.test.ts` (+192) |
| Issue #15005 (no machine-readable fidelity status) | **OPEN**, 4 comments | — |

**NONE of the four is merged upstream.** Both candidate PRs are open and
unmerged at the inspected commit, so neither is "already present" upstream
either. There is no upstream changeset to import: the `.changeset/` directory
does not exist at that commit, so the changesets were inspected as **absent**,
not as overlooked.

### 1.2 Upstream symbol → ClineMM counterpart

| Upstream symbol | ClineMM counterpart | Note |
| --- | --- | --- |
| `runAgenticCompaction()` | `sdk/packages/core/src/extensions/context/agentic-compaction.ts` | **IDENTICAL** at the inspected commit (byte-for-byte) |
| `generateSummary()` | `sdk/packages/core/src/extensions/context/summary-generation.ts` | **IDENTICAL** at the inspected commit |
| `serializeConversation()` | `compaction-shared.ts` | present in both; **our copy diverges** (see 1.3) |
| `renderStructuredToolPayload()` | `compaction-shared.ts` | **ABSENT upstream** — a ClineMM-only addition |
| `buildSummaryRequest()` | `compaction-shared.ts` | present in both |
| `createContextCompactionPrepareTurn()` | `compaction.ts` | present in both; our copy carries more carry-forward seams |
| `createCompactionStateAwarePrepareTurn()` | `compaction.ts` | present in both; our copy carries the PCK / task-contract / source-bound / adjudication seams |
| `estimateRequestInputTokens()` | `@cline/shared` | present in both |

### 1.3 The upstream serializer is NOT a fidelity improvement

Upstream's `flattenToolResultContent()` has this `default:` branch:

```ts
default:
    return "";
```

An unrecognized tool-result entry therefore contributes NOTHING to the
summarizer's input. Upstream has **no `renderStructuredToolPayload()` at
all**: it has no `[result omitted]` marker, no status classification, and no
command classification.

**This is the same defect class as the one this ACT is repairing, in its
worse form.** ClineMM's `renderStructuredToolPayload()` at least preserves the
STATUS and the command CLASSIFICATION and marks the omission explicitly
(`[result omitted]`); upstream drops the entry silently.

**Consequence:** the upstream "in-place" path is not a fidelity mechanism and
cannot be adopted as one. Adopting it would REGRESS our input fidelity
relative to the current production serializer.


### 1.4 Per-candidate classification

```text
#15783 (cache invalidation issue)          NOT_APPLICABLE   (an issue, not a change;
                                                        the linked PR is unmerged)
#15787 (in-place summarizer / KV cache)    REQUIRES_ADAPTATION
#14732 (incomplete summary installed)      APPLICABLE
#14741 (retry + warn on truncation)        APPLICABLE
#15005 (fidelity status on the summary)    APPLICABLE
```

**#15787 — REQUIRES_ADAPTATION.** The mechanism is sound and matches this
fork's `runAgenticCompaction()` byte-for-byte at the base, so the adaptation
surface is the seam, not the algorithm. But it is a CACHE mechanism, not a
FIDELITY mechanism: it changes HOW the summarizer's input is TRANSPORTED
(native messages replayed verbatim + one instruction message) rather than
WHAT the input contains. Adopting it verbatim would also REGRESS the input
fidelity, because upstream's serializer drops the structured tool-result
entries entirely (§1.3).

The one upstream idea this ACT evaluates is the TRANSPORT shape, and it is
exactly the "smallest bounded representation that preserves the
invocation/result relationship" the ACT asks for in §8: **replay the
canonical messages as native provider messages instead of re-serializing
them into one flat text string**. The upstream implementation transports the
*canonical* messages; this ACT evaluates whether it can transport a
*faithful* rendering of the invocation/result pairs while conserving the
confidentiality posture.

**#14732 / #14741 — APPLICABLE.** The defect is REAL in this fork: see §11.
The upstream PR's disposition — warn, retry once with a reduced input budget,
install the result with `truncated` / `truncatedReason` /
`retriedAfterTruncation` metadata — is bounded and does not change the
request count in the success path. It adds at most ONE extra summarizer
request on the truncation path, which is a FAILURE path, not the ordinary
path.

**#15005 — APPLICABLE.** The metadata shape is a small, additive schema
extension to `CompactionSummaryMetadata`, whose reader already validates
defensively, so an absent field reads as absent rather than throwing.

### 1.5 Why upstream wholesale is not merged

- Neither candidate PR is merged upstream, so there is no upstream release to
  track.
- Upstream's serializer is a fidelity REGRESSION against this fork.
- This fork carries seams upstream does not have at all: the PCK, the
  task-contract carry-forward, the verified-outcome carry-forward, the
  source-bound evidence, the adjudication continuity, the stable-prefix
  repair and the user-context ceiling. An upstream merge would have to be
  re-derived against every one of them.
- The ACT explicitly forbids merging upstream wholesale.
