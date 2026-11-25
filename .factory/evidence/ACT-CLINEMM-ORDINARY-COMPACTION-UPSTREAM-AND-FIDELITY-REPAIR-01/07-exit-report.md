# ACT-CLINEMM-ORDINARY-COMPACTION-UPSTREAM-AND-FIDELITY-REPAIR-01

## 07 — Exit report

```text
ACT_ID:      ACT-CLINEMM-ORDINARY-COMPACTION-UPSTREAM-AND-FIDELITY-REPAIR-01
ENTRY_HEAD:  df99675ed40a899ceae2b22ffe5224537c88f2fd
A10_COMMIT:  784f1e95b  fix(core): publish runtime-owned tool labels in the
                          evidence carry-forward
VERDICT:     HALT_FACTUAL_PRESERVATION_NOT_ESTABLISHED
```

### 7.1 WHAT THIS ACT ESTABLISHED

**1. The A10 tool-name publication defect was REPRODUCED and CORRECTED.**
The counterexample was reproduced through both publication destinations. A
fixed runtime-owned tool vocabulary now resolves published tool labels, and
unknown or untrusted tool names publish as the neutral `"tool"`. Internal
canonical tool identity and admission semantics are unchanged. The
correction was committed SEPARATELY, as §2 required, and passed the
reference-trust (17), evidence-continuity (62) and bounded-evidence-contract
(40) suites, with typecheck `45 → 45` (zero delta) and Biome clean on the
changed files.

**2. The ordinary compaction's input loss is at the production serializer,
and it is a COMPLETE-PROPOSITION-ABSENT failure.**
`renderStructuredToolPayload()` in `compaction-shared.ts` omits every
successful result body (`[result omitted]`, 122 of 122) and classifies only
`5/123` payloads, because the command classification fails closed on
pipelines and redirections. The invocation survives; the result and the
correlation do not.

**3. The upstream candidates are all open and unmerged, and none of them
repairs the fidelity loss.**
At upstream commit `34c104e6fc49781cda4adcd73ffdccd8f029fef9`: #15783,
#14732 and #15005 are OPEN; #15787 and #14741 are OPEN and UNMERGED.
#15787 (`REQUIRES_ADAPTATION`) is a transport/cache proposal, not a fidelity
repair, and adopting its serialization wholesale would WORSEN the
structured-result loss, because upstream has no
`renderStructuredToolPayload()` at all. #14732 / #14741 / #15005 are
`APPLICABLE` but were not adopted: #14741's repair is out of this ACT's
scope by the ACT's own §11 rule, and #15005 is an observability proposal.

**4. The model CAN recover the decisive propositions from the original
evidence.** This is the ACT's §6 question, and the answer is unambiguous.
Both the TARGETED SOURCE arm and the FULL SOURCE arm answered O1, O4 and
O7 **correctly**; the current production arm answered them
INCORRECT / PARTIAL / INCORRECT. **None of the three propositions is a
model-capability limitation.** The failure is entirely compaction-caused.

**5. The cache defect is real, large, and separable.** The existing
ordinary summarizer request shares **0.00019** of the working agent's
serialized prefix with it — a complete cache break, as upstream #15783
describes. A native-message representation shares **0.886**. The
summarizer → resumed-agent transition is a **one-time** change (`0.00038`)
in both arms, and the post-compaction prefix is **stable**: the next
ordinary turn read **15 347 of 15 363** prompt tokens from cache and ran
**3.5× faster**. **There is no repeated prefix churn.**

**6. A concrete, separate RED was found for summary completeness.** A
summary the provider reports as INCOMPLETE is installed exactly like a
complete one, replacing the compacted history, with **no warning, no log
and no marker** on the persisted state or the provider-visible
continuation. An EMPTY summary is handled correctly (the compaction is
skipped with a warning); a TRUNCATED one is not. The witness suite is
preserved and **CMP-04 is opened** with the exact owning boundary.


### 7.2 WHAT THIS ACT DID NOT DO

**No ordinary-compaction fidelity candidate was integrated.** The gate
(§12) requires EVERY condition to hold. Two did not:

- **G4 — confidentiality.** The faithful representation publishes the
  result body, which is the thing the ClineMM-only `[result omitted]`
  control exists to withhold. The arm is bounded and sanitized, so it is
  not *unrestricted* publication — but whether publishing the body at all
  is *authorized* is a confidentiality-policy decision this ACT did not
  receive authority to make, and the ACT forbids unrestricted publication
  without a formal confidentiality review. **That review has not happened.**

- **G6 — budget.** The native summarizer request prefills **123 327**
  tokens against the production path's **12 962** (9.5×) and takes
  **333 740 ms** against **45 507 ms** (7.3×) on a cold cache. The ACT's
  primary objective is SPEED × CORRECTNESS, and a 7.3× summarizer latency
  increase, bought with a cache win that only materialises on a warm cache
  that was NOT measured, does not establish a speed improvement.

**The negative result is preserved**, and the smallest existing
canonical-history recovery seam is identified:
**`renderStructuredToolPayload()`** — the single function that owns the
canonical invocation/result correlation, the `[result omitted]` policy and
the fail-closed command classification, called from exactly one place.
A successor ACT should target THAT function, publishing only the bodies of
commands whose classification ALREADY SUCCEEDED, leaving the fail-closed
path untouched.

### 7.3 THE VERIFICATION ACTUALLY RUN

| Gate | Result |
| --- | --- |
| Context suite (`src/extensions/context/`) | **1 187 passed / 2 skipped** (85 files) — was 1 184 before this ACT's 3 new witnesses |
| Summary-completeness witness | **3 passed** (the RED is confirmed present) |
| Typecheck (`tsconfig.dev.json`) | **45 errors, unchanged from baseline**; **zero** ACT-owned diagnostics |
| Biome (changed files) | **clean** |
| `git diff --check` | **clean** |
| A10 reference-trust suite | 17 passed |
| A10 evidence-continuity suite | 62 passed |
| A10 bounded-evidence-contract suite | 40 passed |

No new full-repository baseline campaign was run: no relevant production
dependency changed, and the only production commit is the separately
committed A10 correction, whose own gates are recorded in `00-…`.

### 7.4 THE SCOPE EXCLUSIONS WERE RESPECTED

No PCK revival. No new semantic-memory architecture. No new persistent
evidence store. No value-qualification pairing. No further deterministic
ranking heuristics. No model comparison. No model configuration changes. No
Kurchatov or Strata engine changes. No LEAMAS repair. No B06 repair. No
VSIX packaging or installation without operator authorization.

### 7.5 THE RESEARCH ARTIFACTS

The two research scripts and the witness suite are committed as research
artifacts, NOT as production mechanisms:

- `sdk/packages/core/scripts/compaction-fidelity-repair.arms.ts`
- `sdk/packages/core/scripts/compaction-fidelity-repair.cache.ts`
- `sdk/packages/core/src/extensions/context/compaction.summary-completeness.red01.test.ts`

They are not wired into any build, runtime or default path. The raw
prompts, provider bodies and answers stay in the GITIGNORED
`tmp/compaction-fidelity-repair/` tree.

### 7.6 THE RECOMMENDED SUCCESSOR

**`renderStructuredToolPayload()`-scoped fidelity repair**, subject to a
formal confidentiality decision, measured with the SAME W1 workload, the
SAME O1/O4/O7 questions and the SAME cache discriminator, and it must
demonstrate budget conservation against the 12 962-token production
baseline.

Separately: **CMP-04**, the summary-completeness repair, whose witness is
already in the tree and which must FAIL once the repair lands.
