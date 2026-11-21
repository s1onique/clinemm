# ACT-CLINEMM-COMPACTION-SUMMARY-CHURN-01

```text
ACT_ID: ACT-CLINEMM-COMPACTION-SUMMARY-CHURN-01
TYPE: causal reproduction and ablation (no production repair authorized)
VERDICT: EVIDENCE_RESTORATION_CAUSAL
ENTRY_HEAD: 60432babb98729f1c6b7116c79f5709750472718   (== EXPECTED ENTRY_HEAD)
BRANCH: main (no ACT branch created)
PRODUCTION_CODE_CHANGES: 0
EXISTING_TEST_MODIFICATIONS: 0   (0 skips, 0 deletions, 0 weakenings)
EVIDENCE: .factory/evidence/ACT-CLINEMM-COMPACTION-SUMMARY-CHURN-01/
  identity.json
  source-map.md
  live-transition-matrix.json
  production-reproduction.md
  production-reproduction.json
  ablation-matrix.json
  conservation-results.md
  test-receipts.txt
  causal-classification.md
  artifact-hashes.json
  tool/reproduce.ts
  tool/probe.ts
```

---

## 1. Mission outcome

The ACT's hypothesis was:

> ClineMM's provider-visible compaction projection repeatedly rebuilds its
> verified-outcome section from the evolving canonical transcript, mutating
> the summary near the beginning of each model-facing request and invalidating
> deeper Strata checkpoints.

**The hypothesis is CONFIRMED as to the producer, and as to the mutation.
It is NOT confirmed as to the engine-side cache effect.**

| Status | Value |
|---|---|
| `LIVE_WIRE_MUTATION` | **observed** |
| `OFFLINE_CAUSAL_MECHANISM` | **established** |
| `ENGINE_CACHE_EFFECT` | **inferred** (not measured) |
| `REPAIR_NECESSITY` | **not evaluated** |

### The producer

`applyVerifiedEvidenceToCompactedMessages()`
— `sdk/packages/core/src/extensions/context/evidence-continuity.ts:1366`

It re-derives the verified-outcome ledger from the ENTIRE canonical
history (`:1370`), renders the section (`:1193`), strips the previous
section and appends the new one (`:1275`), and replaces the summary
message in place (`:1403`).

The section sits at the TAIL of the summary, but the summary's CONTENT
changes — and the summary is the FIRST provider-visible message, so every
deeper prompt-cache checkpoint is invalidated.

### Task-contract restoration

**NOT independently responsible.** The symmetric ablation shows that with
the contract ON and the evidence OFF, the summary is byte-stable across the
same append-only continuations.

---

## 2. Entry identity and repository safety

- `ENTRY_HEAD` = `60432babb98729f1c6b7116c79f5709750472718`, on `main`,
  one commit ahead of `origin/main`.
- `60432babb` **is** an ancestor of HEAD (verified with
  `git merge-base --is-ancestor`).
- The working tree was CLEAN at entry (`git status --short` empty).
  No `HALT_UNEXPECTED_TRACKED_DIRT`.
- Protected stashes: none in this repository. The protected stash worktree
  `clinemm-stash-recovery-20261117` (absolute path redacted) was NOT
  touched.
- No other worktree was touched.

---

## 3. Source recon — the confirmed production order

```
persisted compaction state (sidecar)
   ↓  projectSessionCompactionState()               session/models/session-compaction.ts:168
canonical transcript + sidecar projection
   ↓  applyTaskContractToCompactedMessages()        extensions/context/task-contract.ts:358
task-contract restoration
   ↓  applyVerifiedEvidenceToCompactedMessages()   extensions/context/evidence-continuity.ts:1366
verified-evidence restoration
   ↓  MessageBuilder.buildForApi()                  session/services/message-builder.ts:219
provider-visible messages
   ↓  AI SDK → wire serialization
```

Read from `createCompactionStateAwarePrepareTurn()`
(`extensions/context/compaction.ts:1422`); the provider-visible restoration
path is `compaction.ts:1605-1633`, the freshly-compacted branch is
`compaction.ts:1557-1604`. This matches the ACT's expected logical flow.

Full ownership map: `evidence/source-map.md`.

---

## 4. First discriminator — the exact changing section

### The live transition matrix

Built from the preserved prefix-forensics captures of session
`1795229584545_t33f9` (135 records; 46 `runtime_projection`, 46
`ai_sdk_prompt`, 46 `wire_request`).

| Stage | transitions | summary changed | unchanged | same byte length BUT changed |
|---|---:|---:|---:|---:|
| `runtime_projection` | 44 | 19 | 25 | 7 |
| `ai_sdk_prompt` | 44 | 19 | 25 | 7 |
| `wire_request` | 44 | 20 | 24 | 7 |

**The per-stage fingerprints are IDENTICAL for the same iteration.** The
mutation is introduced at `runtime_projection` — inside
`createCompactionStateAwarePrepareTurn()` — and propagates verbatim to the
wire. `MessageBuilder.buildForApi()` is exonerated.

The required transitions:

| Transition | messages | summary bytes | changed | class |
|---|---|---|---|---|
| 25→26 (compaction boundary) | 71 → 15 | 10,114 → 14,761 | **yes** | `SUMMARY_CARRIER_CHANGED` |
| 26→27 (first continuation) | 15 → 18 | 14,761 → 14,802 | **yes** | `SUMMARY_CARRIER_CHANGED` |
| 27→28 (mutation, no length change) | 18 → 21 | 14,802 → 14,802 | **yes** | `SUMMARY_CARRIER_CHANGED` |
| 30→31 (**negative control**) | 26 → 28 | 14,802 → 14,802 | **NO** | `UNCHANGED` |
| 31→32 (renewed mutation) | 28 → 31 | 14,802 → 14,802 | **yes** | `SUMMARY_CARRIER_CHANGED` |
| 33→34, 37→38 (later mutations) | 34→37, 43→46 | 14,802→14,810, 14,810→14,794 | **yes** | `SUMMARY_CARRIER_CHANGED` |

Across iterations 26→39 the summary changed on **12 of 13** adjacent
transitions. The system prompt fingerprint and the ordered tool inventory
were **byte-stable across every single transition**.

### The section-level attribution, and its stated limitation

The preserved captures record only FINGERPRINTS and byte counts — never raw
content. A fingerprint proves two contents DIFFER; it cannot say WHICH
section differs.

The section attribution therefore comes from the OFFLINE reproduction on
the SAME session's REAL sidecar and REAL canonical transcript:

| Transition | changeClass | contract changed | evidence changed | prose changed |
|---|---|---|---|---|
| H0→H1 | `VERIFIED_EVIDENCE_SECTION` | **no** | **yes** | **no** |
| H1→H2 | `VERIFIED_EVIDENCE_SECTION` | **no** | **yes** | **no** |

This limitation is preserved explicitly in
`evidence/causal-classification.md` §4.

---

## 5. Real-production-seam reproduction

Scenario (the ACT's required scenario, executed against the REAL artifacts):

```
H0 = canonical[0..73)                     the history AT the compaction boundary
H1 = canonical + new successful pair      APPEND-ONLY
H2 = H1 + another successful pair         APPEND-ONLY
```

Append-only invariants, all VERIFIED: `h0IsCanonicalPrefix`,
`canonicalIsPrefixOfH1`, `h1IsPrefixOfH2`, `sidecarUnmodified`.

The persisted sidecar was NOT modified between the preparations, and NO
new compaction summary was created — the sidecar's own summary was
projected.

| Outcome | summary bytes | contract | evidence | prose bytes |
|---|---:|---|---|---:|
| H0 | 14,838 | present | present | 3,468 |
| H1 | 14,850 | present | present | 3,468 |
| H2 | 14,853 | present | present | 3,468 |

### The RED

**A genuine RED witness exists and is retained as an isolated, runnable
receipt:**
`sdk/packages/core/src/extensions/context/compaction.summary-churn01.red.test.ts`
(run with `bun run test:red:summary-churn01`).

It asserts the cache-prefix stability invariant and FAILS against the
original behaviour, showing the observed mutation:

```
 ## Verified tool outcomes (canonical record)
 <!-- cline-evidence:begin -->
 - run_commands (call_red_h0): succeeded — echo
+ - run_commands (call_red_h1): succeeded — echo
 <!-- cline-evidence:end -->
```

It is **EXCLUDED from the default suite** via
`sdk/packages/core/vitest.config.ts` so it never blocks the normal gate.

**This is a cache-prefix stability counterexample, NOT a semantic
correctness bug.** The existing carry-forward behaviour may be intentional.

---

## 6. Causal ablation (2×2)

| Variant | Task contract | Verified evidence | H0→H1 | H1→H2 | Rewritten each continuation |
|---|---|---|---|---|---|
| A — Original projection | OFF | OFF | no | no | no |
| B — Contract only | ON | OFF | **no** | **no** | **no** |
| C — Evidence only | OFF | ON | **yes** | **yes** | **yes** |
| D — Production composition | ON | ON | **yes** | **yes** | **yes** |

The four ACT necessity conditions are all **MET**. The switches exist ONLY
in the disposable offline experiment and the disposable test helper; they
are NOT production feature flags and NOT public API.

**⇒ `EVIDENCE_RESTORATION_CAUSAL`** (not `MULTIPLE_CAUSES`).

---

## 7. Conservation and correctness controls

All guarantees verified as **conserved**; the explicit cost of the
ablation (what is LOST when the evidence carry-forward is disabled) is
recorded in `evidence/conservation-results.md` §7.

The single most important conservation finding: **the repair is NOT
"remove the carry-forward"**. Disabling it loses the verified-evidence
continuity guarantee that
ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-CORRECTION01 was created to
establish — the model would again be able to report a verified success as
`NOT_EXECUTED`.

---

## 8. Live-to-offline evidence composition

| Phase | Live observation | Offline mechanism |
|---|---|---|
| A — Before compaction | summary fingerprint stable across iterations 1–25 | — |
| B — Immediately after compaction | 25→26: 71 → 15 messages, 10,114 → 14,761 bytes; cache legitimately cold | — |
| C — Subsequent continuation | 26→27: summary CHANGED | H0→H1: `VERIFIED_EVIDENCE_SECTION` |
| D — Further continuation | 27→28, 29→30: CHANGED again | H1→H2: `VERIFIED_EVIDENCE_SECTION` |
| E — Negative control | 30→31: UNCHANGED; 31→32: CHANGED again | variant B (evidence OFF): stable; variant C (evidence ON): changes |

**Cross-system join label:** `TEMPORAL_ONE_TO_ONE_SUPPORTED`.

The Strata server logs were NOT rewritten and are NOT presented as an
instrumented causal trace. No shared cross-process request ID was
independently verified.

---

## 9. Quantified benefit — stated as an interval, not false precision

| Quantity | Value |
|---|---|
| Observed prefill cost | `UNAVAILABLE_FROM_TRACE` at the per-request level |
| Estimated recoverable prefill | `UNAVAILABLE_FROM_TRACE` |
| Unrecoverable work | new tokens of the growing tail; the compaction-boundary reread; genuinely changed content (none here — system prompt and tool inventory were byte-stable) |
| Checkpoint limitation | a stable prefix is NECESSARY but NOT SUFFICIENT for a deeper checkpoint to be reusable; the engine's checkpoint granularity, retention and eviction are not observable in the preserved trace |

What the offline evidence DOES establish without any engine measurement:
the provider-visible summary is 14,802 bytes, is the FIRST
provider-visible message after the system prompt, and the mutation replaces
only the evidence section at the TAIL (common prefix 14,020 of ~14,850
bytes). **No counterfactual is presented as an executed speedup.**

---

## 10. Executable gates

| Gate | Evidence | Status |
|---|---|---|
| G1 | Source and artifact identities established | **PASS** — `identity.json` |
| G2 | Real production projection reproduces mutation | **PASS** — `production-reproduction.json` |
| G3 | Task-contract-only discriminator | **PASS** — variant B is stable |
| G4 | Verified-evidence-only discriminator | **PASS** — variant C churns |
| G5 | Full composition discriminator | **PASS** — variant D churns |
| G6 | Necessary ablation changes the expected outcome | **PASS** |
| G7 | Canonical evidence and task obligations conserved | **PASS** — 13 conservation tests |
| G8 | Sidecar and resume invariants conserved | **PASS** — 7 conservation tests |
| G9 | Provider-visible structural attribution correct | **PASS** — the mutation is introduced at `runtime_projection`; the message builder is exonerated |
| G10 | Privacy and artifact identity verified | **PASS** — `artifact-hashes.json`; no raw prompt, tool-result body, transcript, sidecar body, credential or HMAC key is committed |

### The required coverage matrix

| Required case | Test |
|---|---|
| one append-only history that causes a repeated mutation | "rewrites the provider-visible summary when an append-only canonical continuation adds a verified outcome" |
| one unchanged-history positive control | "keeps the summary byte-stable when the canonical history is UNCHANGED" |
| one same-byte-length / different-content case | "changes the summary content while keeping the SAME byte length when the replacement is length-neutral" |
| one new canonical outcome excluded as unverifiable | "does not promote a FAILED outcome into the carried section" |
| one canonical outcome falling out of the rolling 12-item selection | "keeps the rolling 12-outcome selection and drops the OLDEST outcome" |
| one task-contract update without evidence update | "moves the contract section alone when the canonical contract changes but no new outcome is verified" |
| one evidence update without task-contract update | "moves the evidence section alone when a new outcome is verified but the contract is unchanged" |
| one invalid-sidecar negative control | "rejects a corrupted sidecar identity instead of projecting it" |

### The default-suite gate

| Run | total | passed | failed |
|---|---:|---:|---:|
| PRISTINE baseline (entry HEAD, this ACT's files moved aside) | 5,751 | 5,476 | **113** |
| AFTER this ACT | 5,771 | 5,496 | **113** |

**ADDED failures: 0. REMOVED failures: 0.**

The 113 pre-existing failures are ENVIRONMENT failures present at the
pristine entry HEAD (macOS sandbox, hub server suites, bash supervised
startup env, checkpoint hooks, persistence service, path authority,
composio tools). They are identical before and after.

Typecheck: 44 pre-existing errors, **0 contributed by this ACT**.
Lint: **0 diagnostics** on all four touched files.

---

## 11. Privacy and temporary-work policy

- No raw prompt, tool-result body, canonical transcript, sidecar body,
  credential, raw HTTP request or HMAC key is committed.
- The offline probe's keyed-fingerprint key is **not committed**; the
  fingerprints in the JSON receipts are opaque and non-reversible against
  this repository.
- The private absolute paths of the operator's capture directory are NOT
  committed; the probe reads them from environment variables.
- No new tracing framework and no permanent diagnostic instrumentation.
  The existing prefix-forensics infrastructure was reused.
- No disposable probe remains in the production tree. The probe lives
  under `.factory/evidence/.../tool/`, which is the Factory artifact
  location, and it is referenced by the receipts.

---

## 12. Exit and successor decision

Success criteria:

1. **The actual summary producer is identified** — YES:
   `applyVerifiedEvidenceToCompactedMessages()`.
2. **A genuine production-seam reproduction demonstrates the mutation** —
   YES: against the REAL sidecar and REAL canonical transcript.
3. **An ablation establishes necessity** — YES: all four conditions met.
4. **The canonical-evidence and task-contract costs of the ablation are
   explicit** — YES: `conservation-results.md` §7.
5. **The live Strata observations are correlated only to the strength
   supported by their identities** — YES:
   `TEMPORAL_ONE_TO_ONE_SUPPORTED`, never upgraded.
6. **A bounded repair hypothesis is documented without implementing it** —
   YES: `causal-classification.md` §6.

### The possible successor

```
ACT-CLINEMM-COMPACTION-STABLE-PREFIX-REPAIR-01
```

**Proposed invariant:**

> Preserve the existing compaction summary's stable provider-facing prefix
> while making newly verified canonical tool outcomes available later in
> the model-facing context, without losing evidence, ordering, task
> obligations, resume correctness or budget safety.

**This is a PROPOSAL, not an authorized implementation.** The successor
design is deliberately NOT frozen: this ACT's causal discriminator is
complete, and the successor's design is a separate decision.

---

## 13. Not authorized / not done

- No production repair. No production module was modified.
- No installed VSIX replacement.
- No Strata changes and no service restarts.
- No new inference runs.
- No push and no PR.
- No compaction-policy change.
- The disposable ablation switches did not become production feature flags
  or permanent public APIs.
