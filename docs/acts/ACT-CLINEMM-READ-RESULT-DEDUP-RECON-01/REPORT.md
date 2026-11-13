**Repository:** `clinemm` (`s1onique/clinemm`), branch `main`
**Source HEAD:** `236bbb579452d0f6e95b129e4e34f645270e08e4` (entry; historical anchor `cefe2b0dc95762d42efd553642b1da989a1ef2fd` is its parent)
**Production modification:** none
# ACT-CLINEMM-READ-RESULT-DEDUP-RECON-01

**Decision:** `GO_BOUNDED_REPAIR`

**Repository:** `clinemm` (`s1onique/clinemm`), branch `main`
**Source HEAD:** `236bbb579452d0f6e95b129e4e34f645270e08e4`
**Protected stash:** `stash@{0}: WIP on main: d46223b51 fix(completion-continuation-stall-lifetime)...` — preserved, never popped
**Push / PR:** none. **Production modification:** none.

---

## 0. Terminal report

```text
ACT:
ACT-CLINEMM-READ-RESULT-DEDUP-RECON-01

VERDICT:
GO_BOUNDED_REPAIR

REPRODUCED:
YES — the real production MessageBuilder reproduced the historical rewrite at
provider-request iteration 11: exactly two stale-read markers, prefix break
at provider message index 5, and the latest full read preserved.

DUPLICATION MECHANISM (measured):
Three byte-identical read results of the same file (47,253 chars / 47,777
bytes each, SHA-256 677121b6e1e7a5ddb6caf5f9fbf7ca938d734a521afaf53fdfe26d616653b358)
at canonical messages 8 / 27 / 29. Production's 64 KiB stale-read rewrite
replaces the two HISTORICAL copies with "[outdated - see the latest file
content]", which RE-TEXTS an already-cached provider message and breaks the
provider prefix at message index 5.

CANDIDATE (measured):
An append-only duplicate projection applied to CANONICAL messages BEFORE the
stale-read rewrite. A duplicate read result is replaced by a compact marker
that names the ANCHOR read holding the identical bytes. The anchor keeps its
full bytes and is never re-texted, so the provider prefix is STABLE.

MEASURED at the iteration-11 boundary:
  production preserved prefix : 5 messages / 26,440 bytes  (break at index 5)
  candidate  preserved prefix : 20 messages / 181,354 bytes (NO break)
  ratio                      : 6.86x
  prepared bytes             : 182,140 (A) vs 182,422 (C)  = +282 bytes
  estimated input tokens     : 60,759 (A) vs 60,853 (C)      = +94 tokens
  compaction trigger (86,400): not crossed by either arm
  added build latency        : +0.38 ms (0.189 ms -> 0.568 ms)

EXECUTED:
- 33/33 candidate probe assertions PASS (6 probe files)
- 17/17 adversarial matrix negative controls PASS
- 53/53 existing production MessageBuilder tests PASS (no regression)
- 34/34 adjacent production tests PASS (tool-result-cache, recovery, file-read)

C4 REFERENCE LIFETIME:
SAFE — no new persistent reference store is required. The projection is a
pure function of the canonical messages; every reference resolves inside the
same provider-visible projection (executed as cases 11-14).

C5 MODEL COMPREHENSION:
NOT CLAIMED from structural tests. The model still receives the identical
file bytes; only the attribution of the observation changes. Measured
adversarial case 8 proves the marker does not over-claim completeness.

NEXT ACTION (ONE bounded repair ACT):
ACT-CLINEMM-READ-RESULT-DEDUP-REPAIR01 — move the duplicate projection into
sdk/packages/core/src/session/services/message-builder.ts as a projection
step BEFORE commitOutdatedRewrites, with the 17-case matrix as the shipped
test suite.
```

---

## 1. Exact source identity

| Item | Value | How verified |
|---|---|---|
| Repository | `clinemm` (`s1onique/clinemm`) | `git remote -v` |
| Branch | `main` | `git branch --show-current` |
| HEAD at entry | `236bbb579452d0f6e95b129e4e34f645270e08e4` | `git rev-parse HEAD` |
| Historical anchor | `cefe2b0dc95762d42efd553642b1da989a1ef2fd` (parent of HEAD) | `git log` |
| Worktree at entry | clean (`git status --short` empty) | `git status --short` |
| Protected stash | `stash@{0}: WIP on main: d46223b51 fix(completion-continuation-stall-lifetime): separate REARM lifetime from STALL lifetime at BCB re-registration` — preserved, never popped | `git stash list` |
| Prior ACT evidence | `docs/acts/ACT-CLINEMM-FLINT-EFFICIENCY-RECON-01/`, `docs/acts/ACT-CLINEMM-FLINT-PREFIX-REWRITE-ABLATION-01/` | `git log` |
| Toolchain | bun 1.3.13, node v26.0.0 | runtime |

### 1.1 Inputs and hashes

| Evidence | Path | Bytes | SHA-256 |
|---|---|---:|---|
| Transcript | `~/Downloads/1794609208867_ks9o6.messages.json` | 371,215 | `02ba96fd27b7c6317d3444ca7c07e237860c99dd3b34eb9dc10ed273c0ab9e6d` |
| Compaction artifact | `~/Downloads/1794609208867_ks9o6.compaction.json` | 76,498 | `0945cdee353e3dccd57761e3342f1c3397d782773b74ca5c724f6fe186663803` |
| Provider captures | `/tmp/flint-96k-capture.uM3DSA/` (iterations 1–13) | 14 files | per-file, see §2 |

The transcript and compaction artifact hashes are byte-identical to the ones
recorded by `ACT-CLINEMM-FLINT-PREFIX-REWRITE-ABLATION-01`, so this ACT and
that ACT examine the same session.

### 1.2 Probe harness

Disposable, isolated, removable. Created under
`sdk/packages/core/src/probe/__act_readdedup__/` (6 probe files) and removed
after evidence capture. No feature flag was introduced into the permanent
runtime; no production file was modified.

| Probe file | Role |
|---|---|
| `baseline-replay.ts` | transcript loading, locator/payload extraction, prefix measurement |
| `baseline-replay.test.ts` | baseline witness B1–B4 |
| `candidate.ts` | candidate primitives: locator key, eligibility, byte-equality proof |
| `candidate-integrated.ts` | the three projection variants under test |
| `candidate-probe.test.ts` | POST-HOC ordering diagnostic (rejected ordering) |
| `integrated-probe.test.ts` | rejected oldest-owner variant (evidence of rejection) |
| `adversarial-probe.test.ts` | C1–C4, C6 proofs on the historical replay |
| `matrix-probe.test.ts` | 17-case adversarial matrix |
| `conservation.test.ts` | C6 with the production token estimator + arm B |
| `overhead.test.ts` | runtime overhead measurement |

---

## 2. Baseline witness — the real duplication

**Classification: `REAL_PRODUCTION_SEAM`** (the real production
`MessageBuilder` was exercised) over **`REAL`** inputs (original transcript +
provider-request captures).

### 2.1 The three reads are byte-identical

Extracted from the canonical transcript:

| Canonical msg | Tool | `tool_use_id` | Chars | Bytes | SHA-256 of `result` |
|---:|---|---|---:|---:|---|
| 8 | `read_files` | `call_9yjhf9dD5bMlM8OZA4YfKuXH` | 47,253 | 47,777 | `677121b6e1e7a5ddb6caf5f9fbf7ca938d734a521afaf53fdfe26d616653b358` |
| 27 | `read_files` | `call_uwW1Y3r7ngJDGfz6Qwr9zcsc` | 47,253 | 47,777 | `677121b6e1e7a5ddb6caf5f9fbf7ca938d734a521afaf53fdfe26d616653b358` |
| 29 | `read_files` | `call_Ln0ZZ0vaDpxDHq7iO4gBrbHs` | 47,253 | 47,777 | `677121b6e1e7a5ddb6caf5f9fbf7ca938d734a521afaf53fdfe26d616653b358` |

All three read the same absolute path with an **unranged** input
(`{"path": ".../keycloak/.gitlab-ci.yml"}`), so the normalized locator
identity is identical for all three.

**Not full-file content.** The returned payload ends with
`[Showing lines 1-820 of 1854. Use start_line/end_line to read other sections.]`
— the executor's `MAX_READ_OUTPUT_CHARS = 48,000` cap
(`sdk/packages/core/src/extensions/tools/executors/output-limits.ts:47`,
enforced at `file-read.ts:149`) truncated a 1,854-line file to 820 lines.
**This matters for the candidate**: the duplicate is a *paged window*, not the
whole file, and the reference marker must not claim whole-file completeness.

> Classification: `REAL` (transcript) + `STRUCTURAL` (the cap's provenance).

### 2.2 The real provider-request captures show the same seam

Provider-request captures `cap_run_7-rR5tCU_10/11/12_*.json`
(`/tmp/flint-96k-capture.uM3DSA/`), session `1794609208867_ks9o6`, model
`flint:16gb`, provider `openai-compatible`:

| Capture iter | Provider msgs | Message index 5 (`call_9yjhf9dD5bMlM8OZA4YfKuXH`) | Stale markers |
|---:|---:|---|---:|
| 10 | 20 | 54,059 bytes — **full content** | 0 |
| 11 | 22 | 3,287 bytes — **`[outdated - see the latest file content]`** | 2 |
| 12 | 24 | still stale | 2 |

**First changed provider message between iterations 10 and 11 = index 5.**
At iteration 11 the newest read (`call_Ln0ZZ0vaDpxDHq7iO4gBrbHs`) is present
in full at provider index 21 (51,069 bytes), and the middle read
(`call_uwW1Y3r7ngJDGfz6Qwr9zcsc`) at index 19 has been reduced to 297 bytes.

> Classification: `REAL` (provider-request captures).

### 2.3 The production seam reproduces it exactly

Running the real production `MessageBuilder` over the captured chronology:

- **Chronology mapping** (derived from the captures, not assumed):
  capture iteration 10 = canonical messages 0–27; capture iteration 11 =
  canonical messages 0–29. Canonical→provider index offset is 1 (provider
  message 0 merges the two user messages).
- `buildForApi` is **stateful** — sticky rewrite decisions persist across
  calls on one instance — so the replay builds sequentially on one instance,
  as production does.

| Baseline assertion | Result |
|---|---|
| B1 three byte-identical reads exist | **PASS** (identical SHA-256, 3 distinct `tool_use_id`) |
| B2 exactly two stale-read markers at iteration 11 | **PASS** (0 at iteration 10, 2 at iteration 11) |
| B3 prior provider prefix broken | **PASS** — first changed message index **5** (matches the capture) |
| B4 latest full result still available | **PASS** — SHA-256 unchanged, 47,777 bytes |

Baseline numbers:

```
prepared10Messages   20        prepared11Messages   22
prepared10Bytes      230,149   prepared11Bytes      182,140
outdatedMarkersIter10 0        outdatedMarkersIter11 2
prefixCommonMessages  5        prefixCommonBytes    26,440
firstChangedIndex    5
changedMsgBytesIter10 52,003  changedMsgBytesIter11 3,067
changedMsgHasOutdatedIter11   true
```

> Classification: `REAL_PRODUCTION_SEAM`.

---

## 3. Production-seam reconnaissance

### 3.1 Ownership and lifetime

| # | Item | Owner | Lifetime | Source |
|---|---|---|---|---|
| 1 | Canonical conversation messages | Session store (`sessions/<id>/…messages.json`) | Durable, per session | `sdk/packages/core/src/session/services/persistence-service.ts` |
| 2 | Provider-prepared message copies | `MessageBuilder.buildForApi` | **Ephemeral, per request**; the builder returns new objects, never mutating the canonical list | `message-builder.ts:175-215` |
| 3 | `tool_use_id` ↔ result correlation | `toolNameByIdCache` (id → tool name) + `addMissingToolResults` | Per builder instance, re-derived by `reindex` | `message-builder.ts:119`, `:314-369`, `:538+` |
| 4 | Read locators (path, start, end) | `readLocatorsByToolUseIdCache` + `readResultLocatorCache` (WeakMap) | Per builder instance | `message-builder.ts:120-129` |
| 5 | Full-file vs ranged read ownership | `latestFullContentOwnerByPathCache` (path → newest `tool_use_id`) | Per builder instance | `message-builder.ts:125-128`, `:356-361` |
| 6 | Tool-result caches and eviction | `ToolResultCache` | **Session-volatile**, 16 MiB / 5 idle iterations; `cline://cache/...` URIs | `sdk/packages/core/src/session/services/tool-result-cache.ts` |
| 7 | Sticky stale-read rewrite decisions | `committedOutdatedRewrites` (id → locator keys) | Per builder instance, survives `resetIndexes`, revalidated/pruned per build | `message-builder.ts:139`, `:371-454` |
| 8 | Compaction / rollback / restoration | `sdk/packages/core/src/extensions/context/compaction.ts` + `persistence-service.ts` | Durable across sessions | — |

### 3.2 The exact mechanism that breaks the prefix

`MessageBuilder.buildForApi` order (real source, `message-builder.ts:175-215`):

```
reindex(messages)            -> builds locator/owner caches
commitOutdatedRewrites(...)  -> STICKY rewrite decisions (64 KiB threshold)
addMissingToolResults(...)
  -> transformBlock map      -> per-block: stale-read rewrite + truncation
  -> applyMediaBudget
  -> truncateToTotalTextBudget
```

`isOutdatedReadLocator` (`:933-946`) marks a read stale when it is not the
newest owner of its path/locator. `commitOutdatedRewrites` (`:371-454`)
batches those markers until reclaimable bytes reach
`DEFAULT_MIN_OUTDATED_REWRITE_BYTES = 65_536` (`:40`).

**The break is a re-text of an already-cached message.** The historical
`.gitlab-ci.yml` read sat at provider message index 5 in iteration 10 with
full content. In iteration 11 the same message index 5 is rewritten to the
41-byte stale marker. The provider's prefix cache is keyed on the byte
sequence of the prompt, so the change at index 5 invalidates everything from
index 5 onward — even though the *content* is still present later in the
conversation at index 21.

### 3.3 What the candidate may use

The candidate needs only:

- the canonical message list (already the builder's input);
- per-result locator identity (already computed by `getReadLocators`);
- byte-exact content comparison (already available in the result entries).

**No new interface, schema, tool, session state, or persistence is
required.** `MessageBuilder` already owns all three. The candidate is a
projection step inside the existing `buildForApi` pipeline.

---

## 4. The candidate

### 4.1 Mechanism

> **Hypothesis, not an approved wire format.** The exact marker text is a
> proposal; the invariants below are what this ACT tested.

When a read result's returned content is byte-identical to content already
present in the conversation under the **same normalized locator**, the LATER
result is replaced by a compact marker naming the read that holds the
identical bytes:

```
tool_use_id: call_Ln0ZZ0vaDpxDHq7iO4gBrbHs
file:        /repo/.gitlab-ci.yml
result:      [same content as earlier read result call_9yjhf9dD5bMlM8OZA4YfKuXH]
             The read completed successfully and returned content identical to
             an earlier read result (the same paged window).
```

The **anchor** (the first occurrence of the byte-identical content under that
locator) keeps its full bytes and is never re-texted.

### 4.2 The ordering constraint — the decisive structural finding

**A post-hoc projection is useless.** The probe first implemented the
projection as a post-processing step on the builder's output. Measured:

```
PREFIX-ORDERING-DIAGNOSTIC
  productionFirstChangedIndex: 5
  candidateFirstChangedIndex:  5
  candidateRestoresPrefix:     false
  productionOutdatedMarkersIter11: 2
  candidateOutdatedMarkersIter11:  2
  bytesSaved: 0
```

**Zero** bytes saved, because production's 64 KiB stale-read rewrite has
already replaced both historical copies with the stale marker *before* any
downstream projection can observe them. The projection therefore **must run
on the canonical messages, before `commitOutdatedRewrites`**.

### 4.3 Three variants were tested; two were rejected

| Variant | Anchor | Prefix stable? | Newest bytes visible? | Verdict |
|---|---|---|---|---|
| Post-hoc (after production) | — | No | n/a | **Rejected** — 0 bytes saved |
| Oldest-owner | oldest | Yes (20/20) | **No** | **Rejected** — hides the freshest observation (C3 violation) |
| Owner-aligned | newest | **No** (5/20) | Yes | **Rejected** — re-texts the owner on each new duplicate, so the prefix still breaks at index 5 |
| **First-anchor** | **first (stable)** | **Yes (20/20)** | No (anchor holds the bytes) | **Selected** |

The first-anchor variant is the only one that keeps the provider prefix
stable, because the anchor's `tool_use_id` never changes. The owner-aligned
variant's marker names the *newest* owner, so each new duplicate re-texts the
already-visible marker and breaks the prefix again.

> Classification: `SYNTHETIC_REAL` (controlled inputs through real production code).

### 4.4 Freshness and the C3 trade-off — stated honestly

The first-anchor variant keeps the **anchor's** bytes visible and turns the
**newest** read's result into a reference. C3 requires that the later read
"remains a separate observation" and that a compact representation "may state
equality of returned content; it must not pretend to have skipped the read."

The candidate satisfies this as follows:

- The read **was** performed. The projection runs on canonical messages that
  already contain the executed read's result; nothing is skipped, no
  authorization is bypassed, and a failed read is never rewritten (matrix
  case 9).
- The marker states **equality of returned content** and **that the read
  succeeded** — it does not claim to be the content.
- Because the three reads returned byte-identical payloads, the model still
  receives exactly the same file bytes; only the *attribution* of the
  observation moves from the newest read to the anchor read.

**This is a real semantic change and it is disclosed, not asserted away.**
The alternative that keeps the newest bytes visible (owner-aligned) provably
breaks the prefix, so the two properties are **mutually exclusive** under
this mechanism at this boundary. A successor repair should decide which
property it wants, and the ACT's evidence supports the first-anchor choice
because prefix stability is the stated objective.

### 4.5 Mandatory constraints — how each is honoured

| Constraint | Mechanism | Executed evidence |
|---|---|---|
| Never skip the underlying read | Projection is post-read, on canonical messages | baseline + all matrix cases |
| Never bypass authorization / workspace authority / filesystem checks | The projection touches **no** executor; `file-read.ts` is untouched | gate 2 (19 file-read tests) |
| Never report a successful read unless it succeeded | `isDedupEligible` rejects `success: false` and `is_error: true` | matrix case 9 |
| Preserve each `tool_use_id` | Only the result **content** is replaced; ids are never touched | C2 test; matrix case 2 |
| Exactly one result per tool call, ordering preserved | The projection never adds/removes/reorders blocks | C2 test; matrix case 17 |
| Exact byte-equivalence check (hash may index but must not prove) | SHA-256 only groups candidates; the group is then re-verified with `g.content === first` byte comparison | `candidate-integrated.ts` group loop; matrix case 6 |
| Compare normalized locator identity, not just path | Locator = path + range; the range is taken from the `tool_use` input because the result entry lacks it | matrix cases 5, 6 |
| Do not equate path identity with content identity | Both are required | matrix case 3 |
| Do not equate overlapping ranges with identical results | Range is part of the locator key | matrix case 5 (initially failed → fixed → passes) |
| Do not deduplicate errors / missing files / binary / images / mixed | `isDedupEligible` excludes `is_error`, `success:false`, image entries, `mediaType`/`mimeType`/`data`/`image`, non-string payloads, stale markers, middle-elided payloads | matrix cases 9, 15, 16 |
| Do not mutate canonical persisted history | The projection builds a new message list; the canonical array is untouched | `projectDuplicates*` returns new objects |
| Do not change tool schemas or public APIs | No schema change | gate 1 + gate 2 |
| Marker must not claim stronger freshness than the read establishes | Paged reads get the "same paged window" wording; no "complete/entire file" claim | matrix case 8 |

---

## 5. Executed conservation proofs

### C1 — Prefix conservation

For the unchanged historical messages, the provider-prepared bytes were
compared before and after the candidate at the iteration-10 → iteration-11
boundary.

| Arm | Prefix common messages | Prefix common bytes | First changed index |
|---|---:|---:|---:|
| A — production (64 KiB rewrite) | 5 | 26,440 | **5** |
| C — first-anchor candidate | **20** | **181,354** | **none — no break** |

**6.86× more provider prefix preserved.** The candidate's projection is
append-only with respect to already-projected messages: the anchor is never
re-texted.

> `REAL_PRODUCTION_SEAM`

### C2 — Result identity

Every `tool_use_id` keeps exactly one result; ids are unique in the
projection; the three historical ids are all present. A reference marker can
never be mistaken for a previously executed tool call because it lives
*inside* the later call's own result slot and names the anchor explicitly.

> `REAL_PRODUCTION_SEAM`

### C3 — Freshness

See §4.4. The read is always executed; the marker asserts equality of
returned content and successful completion, never a skipped read. The
freshest-bytes-visible variant (owner-aligned) was measured and **rejected**
because it breaks the prefix.

> `REAL_PRODUCTION_SEAM` (measured), with the semantic trade-off disclosed.

### C4 — Reference lifetime

| Lifetime event | Executed result |
|---|---|
| Automatic compaction | Matrix case 12: every reference resolves to a non-marker, full-content entry **inside the same projection**; the anchor's SHA-256 is verified |
| Manual compaction | Same invariant — the projection is recomputed from the compacted canonical list; if the anchor is gone, the group has one member and nothing is referenced |
| Budget truncation | Matrix case 16: an already middle-elided payload is excluded from eligibility; the marker makes no completeness claim |
| Stale-read rewriting | The projection runs **before** the rewrite, so the anchor is never rewritten: measured `outdatedMarkers = 0` in the candidate projection |
| Session restoration | Matrix case 13: a fresh build over the restored canonical messages yields the identical projection — no persistent store is consulted |
| History rollback | Matrix case 11: rolling back to the earlier messages removes the referencing call too; the surviving read is not compacted |
| Cache expiry | Matrix case 14: the projection consults **no** out-of-band cache; building from a list that lacks the anchor produces zero references |

**Verdict: SAFE. No new persistent reference store or resolution protocol is
required.** The reference target is always a sibling entry in the same
provider-visible projection. This is the decisive input against
`NO_GO_REFERENCE_LIFETIME`.

> `REAL_PRODUCTION_SEAM` + `SYNTHETIC` (matrix) + `STRUCTURAL` (pure-function argument)

### C5 — Model comprehension

**Not claimed from structural tests.** The probe does not measure model
comprehension, and no such claim is made. What is measured:

- the model still receives the **identical file bytes** (the anchor holds
  them), so no information is lost from the prompt;
- the marker text is checked (matrix case 8) to disclose the paged-window
  nature and to avoid "complete/entire file" over-claims;
- the *attribution* of the observation changes (§4.4) — a real semantic
  difference the successor repair must accept explicitly.

`UNAVAILABLE_FROM_TRACE` for actual model behaviour.

### C6 — Compaction conservation

At the historical iteration-11 boundary, using the **production**
`estimateRequestInputTokens` estimator and the production compaction policy
(effective ceiling 96,000; trigger ratio 0.9 → 86,400):

| Property | A — production | B — 128 KiB predecessor | C — candidate |
|---|---:|---:|---:|
| Prepared bytes | 182,140 | 280,012 | 182,422 |
| Estimated input tokens | 60,759 | 93,034 | 60,853 |
| Compaction triggered (≥ 86,400) | **No** | **Yes** | **No** |
| Full copies of the duplicate | 1 | 3 | 1 |
| Compact references | 0 | 0 | 2 |
| Stale markers | 2 | 0 | 0 |
| Previous cached prefix preserved | 5 msgs / 26,440 B | — | **20 msgs / 181,354 B** |
| Delta vs A | — | +97,872 B / +32,275 tok | **+282 B / +94 tok** |

Arm B reproduces the prior ACT's compaction confound
(`93,034 ≥ 86,400` → compaction), confirming the earlier verdict is not
re-litigated here. **The candidate does not trade a cache miss for an
earlier compaction**: it stays 25,547 tokens below the trigger.

> `REAL_PRODUCTION_SEAM`

---

## 6. Adversarial matrix — 17/17 executed

Every case is an executable assertion against the real production
`MessageBuilder`; none compares constants created by the same test.

| # | Case | Required assertion | Result |
|---:|---|---|---|
| 1 | Two identical full-file reads | later result may be compacted | PASS — `c1` full, `c2` marker, 1 record |
| 2 | Three identical reads | earlier prefix preserved; no dangling references | PASS — `c1` full, `c2`/`c3` markers, every reference resolves to full content |
| 3 | Same path, changed content | full new content retained | PASS — `c2` keeps `B`, 0 records |
| 4 | Same bytes, different path | no cross-path deduplication | PASS — 0 records |
| 5 | Same path, different ranges | no unproven equivalence | PASS — 0 records *(initially FAILED: the range was missing from the locator; fixed by reading `start_line`/`end_line` from the `tool_use` input; the failure is the reason the locator now carries the range)* |
| 6 | Same path/range, different contents | no deduplication | PASS — 0 records |
| 7 | Mixed batched reads | each member handled independently | PASS — different paths → 0 records |
| 8 | Partial or truncated reads | no false claim of complete-content identity | PASS — marker says "the same paged window" and contains no "complete/entire file" |
| 9 | Failed or interrupted read | failure preserved; no reference to successful content | PASS — `ENOENT` preserved, 0 records |
| 10 | File edited between reads | new read remains authoritative | PASS — owner-aligned keeps `new content` in full |
| 11 | Rollback to older messages | no reference to removed future results | PASS — rolled-back projection has 0 records |
| 12 | Compaction removes the original result | reference resolved safely or falls back | PASS — every reference resolves inside the projection, target is not itself a marker, SHA-256 verified |
| 13 | Session restored without transient caches | no dangling reference | PASS — fresh build is identical, anchor resolves |
| 14 | Cache entry expired or evicted | no reliance on unavailable content | PASS — building without the anchor yields 0 references |
| 15 | Images or non-text results | existing media semantics unchanged | PASS — image entry preserved (`type: image`, `data: AAAA`) |
| 16 | Budget truncation | no fabricated content coverage | PASS — middle-elided payloads excluded from eligibility |
| 17 | Independent concurrent reads | stable correlation regardless of completion order | PASS — `c3`→`c1`, `c2` (different path) untouched |

---

## 7. Necessity and ablation

Three deterministic projections against the identical historical input:

| Property | A — existing | B — 128 KiB predecessor | C — candidate (first-anchor) |
|---|---|---|---|
| Historical prefix stable | **No** (break at index 5) | Not applicable (compaction intervenes) | **Yes** (20/20 messages, no break) |
| Duplicate full content retained | Latest only (1 copy) | All copies (3) | One visible copy (anchor) |
| Earlier compaction | No | **Yes** (93,034 ≥ 86,400) | **No** (60,853) |
| Tool identity preserved | Yes | Yes | **Yes — proven** (C2) |
| Reference lifetime safe | Not applicable | Not applicable | **Yes — proven** (C4, 17 matrix cases) |

Arm B reuses the completed experiment's evidence and is reproduced here only
as a comparison point to confirm the compaction confound
(`ABLATION_CONFOUNDED_BY_COMPACTION`); it is **not** re-run as a new
experiment and no latency claim is derived from it.

**No latency or cache-hit claim is made.** Prefix *eligibility* was measured;
a measured Kapitsa cache hit or latency improvement is
`UNAVAILABLE_FROM_TRACE` and is not asserted.

---

## 8. Cost and complexity discriminator

| Dimension | Measurement |
|---|---|
| Production seams modified | **1** — `sdk/packages/core/src/session/services/message-builder.ts`, one new projection step in `buildForApi` before `commitOutdatedRewrites` |
| New session state | **None** — the projection is a pure function of the canonical message list |
| Required persistence behaviour | **None** — no reference store, no schema change, no new file format |
| Runtime hashing / equality overhead | SHA-256 over each eligible read payload once per build; byte comparison only within a hash-matched group |
| Message-preparation latency | **+0.379 ms** per build (0.189 ms → 0.568 ms; 2.0× relative, +0.38 ms absolute, on the 30-message historical input) |
| Reference lookup / fallback complexity | **None** — the reference target is a sibling entry in the same projection; no resolution protocol |
| Additional tests required | 17 matrix cases + 6 conservation proofs ≈ **23 assertions**, already written and passing as the probe |
| Regression risk to other providers / tools | **Low** — the projection only rewrites *read* tool results (`read`, `read_files`); MCP and other tools are untouched; images, errors and non-text payloads are excluded; the existing 53 MessageBuilder tests pass unchanged |
| Probe implementation size | 788 LOC across two probe files, of which ~300 LOC is the candidate logic proper (the rest is the two rejected variants, retained as evidence) |

**Complexity verdict: small and local.** The candidate uses only interfaces
the `MessageBuilder` already owns. It does not require a reference-management
subsystem, a new session store, a new tool schema, or a provider-specific
branch. The `NO_GO_COMPLEXITY` condition is **not** met.

---

## 9. Evidence quality classification

| Observation | Class |
|---|---|
| Three byte-identical `.gitlab-ci.yml` read results | `REAL` (canonical transcript) |
| Provider-request prefix break at message index 5, 2 stale markers | `REAL` (provider-request captures) |
| Production `MessageBuilder` reproducing the rewrite at iteration 11 | `REAL_PRODUCTION_SEAM` |
| Post-hoc projection saving 0 bytes | `REAL_PRODUCTION_SEAM` |
| First-anchor variant preserving 20/20 messages / 181,354 prefix bytes | `REAL_PRODUCTION_SEAM` |
| C6 token/byte/compaction figures | `REAL_PRODUCTION_SEAM` (production estimator + production policy) |
| 17-case adversarial matrix | `SYNTHETIC_REAL` (synthetic inputs, real production code) |
| Runtime overhead +0.379 ms | `REAL_PRODUCTION_SEAM` (measured, single machine) |
| Read is a 820-line paged window of a 1,854-line file | `REAL` (transcript footer) + `STRUCTURAL` (cap provenance) |
| Provider-prepared messages ≡ exact HTTP wire bytes | **NOT CLAIMED** — provider-prepared messages are not proof of wire bytes |
| Kapitsa cache hit / latency improvement | `UNAVAILABLE_FROM_TRACE` — not asserted |
| Model comprehension improvement | **NOT CLAIMED** — structural tests cannot establish it |

---

## 10. Test gates

| Gate | Command | Result |
|---|---|---|
| Existing production MessageBuilder suite | `cd sdk/packages/core && bunx vitest run --config vitest.config.ts src/session/services/message-builder.test.ts` | **53/53 PASS** (exit 0) |
| Adjacent production suites | `bunx vitest run --config vitest.config.ts src/session/services/tool-result-cache.test.ts src/session/services/message-builder-recovery.test.ts src/extensions/tools/executors/file-read.test.ts` | **34/34 PASS** (exit 0) |
| Candidate probe suite (6 files) | `bunx vitest run --config vitest.config.ts src/probe/__act_readdedup__/` | **33/33 PASS** (exit 0) |
| ACT-owned failing tests in the default suite | — | **None** — the probe lived outside the default suite and is removed |
| Unauthorized execution or filesystem change | — | None; only reads of the transcript and captures; no writes outside the ACT directory |
| Persistent diagnostic state | — | None; the probe directory is removed after evidence capture |
| Production configuration change | — | None |
| `git diff --check` | — | clean |

---

## 11. Repository state

```
HEAD (entry)  : 236bbb579452d0f6e95b129e4e34f645270e08e4
Working tree   : clean at entry
Protected stash: stash@{0}: WIP on main: d46223b51 fix(completion-continuation-stall-lifetime)...
                 — preserved, never popped by this ACT
```

This ACT adds exactly one directory,
`docs/acts/ACT-CLINEMM-READ-RESULT-DEDUP-RECON-01/`:

```
REPORT.md
evidence/baseline-replay.txt      — baseline witness B1–B4 + post-hoc ordering diagnostic
evidence/candidate-probe.txt      — candidate variants, C1–C4, C6, runtime overhead
evidence/conservation-matrix.txt  — 17-case adversarial matrix + C6 token/compaction figures
evidence/gates.txt                — production test gates with exit statuses
```

No production file, schema, authorization path, approval path, tool
definition or configuration is modified. The disposable probe under
`sdk/packages/core/src/probe/__act_readdedup__/` is removed after evidence
capture.

**Privacy:** no raw Keycloak source content, no full provider-request
payloads, no credentials and no private prompts are committed. Evidence
contains hashes, byte counts, token counts, marker texts and sanitized
structural excerpts only.

---

## 12. Closure

```text
ACT:
ACT-CLINEMM-READ-RESULT-DEDUP-RECON-01

VERDICT:
GO_BOUNDED_REPAIR

BASELINE (real production MessageBuilder, real captures):
  three byte-identical .gitlab-ci.yml reads (47,253 chars / 47,777 bytes,
  SHA-256 677121b6...) at canonical messages 8 / 27 / 29
  64 KiB stale-read rewrite -> exactly 2 markers at iteration 11
  prior provider prefix broken at message index 5 (matches the capture)

CANDIDATE (append-only duplicate projection, anchor = first occurrence):
  prefix preserved 20/20 messages, 181,354 bytes (production: 5 / 26,440)
  no prefix break; prepared bytes +282; estimated tokens +94
  compaction trigger not crossed (60,853 vs 86,400)
  added build latency +0.379 ms
  no new session state, no persistence, no reference store, no schema change

EXECUTED:
  33/33 probe assertions, 17/17 adversarial controls,
  53/53 + 34/34 existing production tests PASS

ONE NEXT ACTION:
  ACT-CLINEMM-READ-RESULT-DEDUP-REPAIR01 — implement the first-anchor
  duplicate projection inside
  sdk/packages/core/src/session/services/message-builder.ts as a step before
  commitOutdatedRewrites, shipping the 17-case matrix as the test suite.
  The repair must decide explicitly whether the anchor may be older than the
  newest read (C3 trade-off, §4.4).
```
