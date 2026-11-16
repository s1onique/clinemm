# ACT-CLINEMM-ROUNDC-COMPACTION-FIDELITY-RECON02 — Recon Report

> **CORRECTED by `ACT-CLINEMM-ROUNDC-COMPACTION-FIDELITY-CORRECTION01`.**
> The expert review of this recon returned `PASS_WITH_CORRECTION_REQUIRED`.
> Two claims in this report were overstated and are corrected below:
> the S2 causal attribution (§1 Q2, §4) and the historical summarizer-input
> count (§2, §3). The S1 finding — the genuine command-classification defect
> — is unchanged and has been repaired. The corrections are marked
> **`[CORRECTED]`** and the correction receipt is in
> `.factory/evidence/ACT-CLINEMM-ROUNDC-COMPACTION-FIDELITY-CORRECTION01/`.

**Primary verdict: `REPRODUCED`** (S1 — the command-classification defect)

**Session:** `1794835772204_hvkkv` · **Source HEAD:** `d397d90c002e9fab136b346771965209d28c6455` ·
**Branch:** `main` · **Repository:** `s1onique/clinemm` · **Implementation authorization:** NO

---

## 1. The two questions, answered

### Q1 — Why did ClineMM preserve substantial investigation output in canonical history yet continue after compaction as though the evidence needed to be collected again?

**Because the evidence content never reached the summarizer, and the evidence
*identity* never reached the continuation.** Two separate mechanisms, at two
separate boundaries:

1. **Result bodies are deliberately omitted (policy).**
   `compaction-shared.ts:247-264` replaces every arbitrary output string in a
   structured `run_commands` payload with `[result omitted]`. The Round C
   reconstruction measured **487** omitted bodies across the covered
   263-message prefix. The summarizer therefore saw
   `[succeeded] helm template: [result omitted]` — a status with no content.

   **`[CORRECTED]`** The 487 figure is a measurement of the **RECONSTRUCTED
   full prefix**, produced by calling `serializeConversation(prefix)`. It is
   **not** a verified count of bodies omitted from the **actual historical
   summarizer request**: the real pipeline selects `previousSummary +
   newMessagesToFold`, applies the budget projection, and only then
   serializes. The exact historical request remains
   `UNAVAILABLE_FROM_TRACE`. The *policy* (arbitrary output is omitted) is
   unchanged and is not in question.

2. **The command classification is EMPTY for every Round C call (miss).**
   `evidence-continuity.ts:476-516` (`classifyCommand`) matches the command's
   **leading words** against a finite allowlist. Every Round C command begins
   `cd <path> && <cmd>`, and `cd` is not in the allowlist. The carried
   verified-outcome line therefore degrades to
   `- run_commands (call_c82e47fda7704342b2f74298): succeeded — 10 commands`
   — **with no indication of what was run**.

So the retained summary's own statement — *"successful command outputs were
omitted … Re-run R7 evidence batch with preserved stdout"* — is an accurate
description of the **symptom** and a **wrong diagnosis of the cause**. The
evidence *was* collected and *was* in canonical history (137/137 tool pairs
matched, 135 non-empty bodies). It was omitted at the summarizer-input
projection, and the carried section could not name the subject even if it had.

### Q2 — Were the repeated compactions justified by the actual model-bound request sizes, or caused by accounting divergence?

**`[CORRECTED]` NOT ESTABLISHED — the causal mechanism is unproven.**

The original answer here read "Accounting divergence." That overstated the
evidence. The corrected answer separates what was measured from what was
inferred:

- **Measured (adjacent-request proxy):** all **10** Round C compaction cycles
  fired while the immediately preceding provider request had reported
  **63,343–81,197** input tokens, against an effective limit of **115,200**
  and an implied trigger of **103,680**.
- **Not measured:** the accounting of the requests that actually triggered
  those compactions. The trace records only
  `{compactionInitiated, effectiveMaxInputTokens}` on the compaction channel,
  so `requestInputTokens`, `requestTriggerTokens`, the calibration factor and
  the request identity at decision time are all unavailable.

The preceding provider request's count is an **ADJACENT-REQUEST PROXY**, not
the decision request. A later, unsubmitted request may legitimately cross the
trigger even when the preceding request was far below it. So the ten
compactions may have been unnecessary, but this report does **not** establish
that they were, and it does not identify a causal mechanism.

The upstream v4.1.26 correction (`43a976d93151`, "estimate re-compaction
against API-safe projected messages") **is already present** in this fork
(`compaction.ts:1171` threads `prepareApiMessages`) and is **not** the
explanation here: the Round C trace shows `toolResultShortenedCount = 0` on
every request, so the API-safe projection was not smaller than the canonical
form and the upstream fix could not have suppressed these compactions.

**`[CORRECTED]` The offline counterexample does not exercise the production
decision.** It compares a hand-supplied raw view against a hand-supplied
`MessageBuilder.buildForApi` projection, and evaluates both through a
**locally defined** `shouldCompactOn` helper — it never drives the production
trigger. The production trigger reads `context.apiMessages`
(`compaction.ts:381-389`), and the production orchestrator populates that
field with the **API-safe projection** via `prepareProviderMessagesForApi` →
`MessageBuilder.buildForApi` (`session-runtime-orchestrator.ts:1775`,
`:1846-1856`) **before** the trigger reads it.

What the counterexample therefore establishes is narrow and real: **raw
estimates can exceed projected estimates.** What it does **not** establish is
that the production runtime ever observes the raw representation. It does not.

The downstream conclusion "the ten compactions were not justified" is
withdrawn. The correct disposition is
`HALT_ESTIMATOR_NOT_REPRODUCED_AT_ACTUAL_PATH`, and a matched
decision-time capture is required before any S2 repair.

---

## 2. What was actually observed

| Observation | Authority |
|---|---|
| 273 canonical messages, 137/137 matched tool pairs, 135 non-empty bodies | OBSERVED_CANONICAL (local capture) |
| Last compaction covers a 263-message prefix; 10 messages follow | OBSERVED_CANONICAL |
| 487 result bodies omitted by the policy, measured over the RECONSTRUCTED prefix | OBSERVED_RECONSTRUCTION (production `serializeConversation`) — **`[CORRECTED]` NOT the historical summarizer request**; that is `UNAVAILABLE_FROM_TRACE` |
| 12 verified outcomes carried = exactly `MAX_CARRIED_OUTCOMES` | OBSERVED_RECONSTRUCTION (production `extractVerifiedToolOutcomes`) |
| 24 outcomes rejected (23 `payload_failure`, 1 `no_success_signal`) | OBSERVED_RECONSTRUCTION |
| The installed continuation DOES carry all 12 verified-outcome lines | OBSERVED_CANONICAL |
| Every carried line has an EMPTY command classification | OBSERVED_CANONICAL + OBSERVED_RECONSTRUCTION |
| The R1 Helm render FAILED (rc=1, Go-template error) while the wrapper reported success | OBSERVED_CANONICAL |
| All 10 compactions fired while the PRECEDING provider request was below the implied trigger | OBSERVED_TRACE (adjacent-request proxy) — **`[CORRECTED]` a BOUND, not a per-decision finding** |
| The exact decision-request token accounting | **UNAVAILABLE_FROM_TRACE** |
| **`[CORRECTED]`** The production trigger measures the API-safe PROJECTED view (`context.apiMessages`), not the raw canonical view | SOURCE_FACT (`compaction.ts:381-389` + `session-runtime-orchestrator.ts:1775`, `:1846-1856`) |
| **`[CORRECTED]`** The ten live compactions were unjustified | **NOT ESTABLISHED** — `HALT_ESTIMATOR_NOT_REPRODUCED_AT_ACTUAL_PATH` |

### Capture-generation divergence (recorded, not reconciled away)

The executor's local files are a **newer capture of the same session**, not a
different one. The uploaded frozen observations (249 messages / 125 pairs /
245 prefix / 4 tail) are an earlier generation; the local capture has 273 /
137 / 263 / 10. Proof: the sidecar's `source_last_message_key`
(`id:msg_8nBMg_D6`) lands exactly on the local canonical prefix boundary at
index 262, the matched latency trace carries the same session id and the same
`effectiveMaxInputTokens`, and the retained summary's verified-outcome section
contains the three probe call ids the ACT names. Every delta moves in the
same direction with the same verified-outcome count (12) — the signature of a
longer capture of one session.

---

## 3. Earliest loss boundary, and its nature

| Boundary | Loss | Nature |
|---|---|---|
| `renderStructuredToolPayload` (`compaction-shared.ts:247-264`) | result body | **policy-driven** — deliberate confidentiality |
| `classifyCommand` (`evidence-continuity.ts:476-516`) | command identity | **accidental** — allowlist-matching miss on the `cd <path> && ` prefix |
| `applyVerifiedEvidenceToCompactedMessages` | — | **no loss** — 12/12 carried |
| `MAX_CARRIED_OUTCOMES` | — | **no loss** — the three probes were among the 12 carried |

The primary verdict is `REPRODUCED` because the **accidental** loss (the empty
command classification) reproduces deterministically at the production seam and
is not the stated policy: `evidence-continuity.ts` documents that the carried
section preserves "the command CLASSIFICATION(S) the call declared", and its
own module header explains that the finite allowlist exists precisely so that
no user-supplied argument is ever persisted.

The body omission is separately classified `PRIVACY_BOUNDED_CONTENT_LOSS` — a
deliberate trade-off, not a bug.

---

## 4. Premature compaction: did it reproduce?

**`[CORRECTED]` NO — the causal attribution did not reproduce at the actual
production path.**

The original answer here read "Yes, as an accounting divergence." The
corrected answer is `HALT_ESTIMATOR_NOT_REPRODUCED_AT_ACTUAL_PATH`.

Two independent sub-findings, deliberately NOT collapsed:

- **Reproduced (SYNTHETIC_REAL):** a raw-message estimate can exceed the
  trigger while the provider-visible projection of the same transcript fits.
  This is reproduced **synthetically**: the test constructs two views and
  evaluates both through a **locally defined** `shouldCompactOn` helper. It
  does **not** drive the production trigger, and it does **not** establish
  that the production runtime ever supplies the raw view.
- **`[CORRECTED]` Not reproduced at the ACTUAL path:** the production trigger
  reads `context.apiMessages` (`compaction.ts:381-389`), and the production
  orchestrator populates that field with the **API-safe projection**
  (`session-runtime-orchestrator.ts:1775` → `prepareProviderMessagesForApi` →
  `MessageBuilder.buildForApi`) **before** the trigger reads it. The raw view
  the counterexample compares against is therefore not a representation the
  production trigger can observe.
- **Not isolated (CAPTURE_INSUFFICIENT):** for Round C specifically, the trace
  does not record the decision-request token accounting, so the exact
  estimator error for those ten decisions cannot be computed. The finding is
  therefore a **bound** (every cycle fired below the implied trigger, judged
  against the PRECEDING provider request), not an exact per-decision
  estimator delta. The adjacent provider request is NOT the decision request,
  and no comparison of the two is claimed as one.

**`[CORRECTED]` Consequence:** the claim "the ten compactions were not
justified by the provider-reported request sizes" is WITHDRAWN. The ten
compactions may have been unnecessary, but this report does not establish
that, and it does not identify a causal mechanism. An independent accounting
mismatch may still exist on a different axis.

A second, compatible divergence axis is live but unmeasured for Round C: the
estimator's 3-chars-per-token assumption under-counts token-dense bodies. The
trace cannot separate the two axes for this session. **This axis is NOT
exonerated by the S2 correction** — it remains live and is the most likely
remaining candidate.

**Next step before any S2 repair:** acquire matched decision evidence. Use the
existing compaction diagnostics to capture the request estimate, the
API-projection estimate, the trigger, the calibration factor and the request
identity, default-off and metadata-only, and reproduce a mismatch through the
**actual runtime projection** rather than a manually supplied raw view.

---

## 5. Upstream estimator correction — does it apply?

**It is present and it does not explain Round C.**

- Upstream commit: `cline/cline@43a976d93151a159be7927cdc2424c26ae158e03`,
  "fix(core): estimate re-compaction against API-safe projected messages
  (#15193)", fixes issue `#15159`.
- Upstream mechanism: `createCompactionStateAwarePrepareTurn` passed
  `apiMessages: projectedMessages` (the raw projection); the trigger counted
  full-size tool results that `MessageBuilder.buildForApi` bounds to 8k chars,
  running the estimate ~7× over and re-firing compaction every few tool calls.
- Fork state: **PRESENT**. `compaction.ts:1048` makes `prepareApiMessages`
  required; `compaction.ts:1171` projects through it;
  `local-runtime-host.ts:1063-1070` wires it to
  `agent.prepareProviderMessagesForApi`.
- Why it does not explain Round C: `toolResultShortenedCount = 0` on every
  request, so the provider-visible request carried the **full** tool results
  and the API-safe projection was not smaller than the canonical form.
- Fork ≠ upstream: the fork additionally carries the user-context ceiling
  (`compaction.ts:400-408`) and the provider-usage underestimate factor
  (`compaction.ts:435-447`), plus an isolated `prepareBudgetAccountingMessages`
  projection (`compaction.ts:1068`). The fork's estimator is a **superset** of
  upstream's, not a copy.

---

## 6. Historical claims that remain unsupported

- **"The Helm render succeeded" / "an image was extracted"** — unsupported and
  contradicted. The canonical record shows `rc=1` and a Go-template error. A
  pipefail-free wrapper reported success because `$?` came from `head`.
  A render was **attempted**; no manifest was produced.
- **"The inspected CI executes Java tests"** — **not established**. The
  canonical results establish that Maven is invoked, that skip flags and
  surefire declarations are present, and that Docker builds use `-DskipTests`.
  They do not establish a test-execution step, and they do not separate test
  sources from test classes from helper classes.
- **"Maven evidence must be recollected"** — the **gap** is real; the
  **necessity** is not. The R7 citations were gathered and succeeded. The
  omission happened at the summarizer-input projection, and the carried
  classification was empty because of the `cd` prefix. Re-running the same
  commands in the same shape reproduces the same omission.

---

## 7. Required successor contract (NOT implemented here)

Two bounded, source-backed repairs, each independent:

**S1 — Preserve the command identity through a shell chain.** `C1: GO`.
`classifyCommand` must recognise the executable that a `cd <path> && <cmd>` /
`;` chain actually invokes, while still never carrying the user's arguments.
The invariant to preserve: the carried classification is drawn from the
**finite allowlist**, matched against the **executable word of a chained
command**, not against the literal leading words of the whole line.
Acceptance: the three Round C probes carry a non-empty, allowlisted
classification; a command with no allowlisted executable still carries none;
no argument, path or URL ever appears in the carried section.

**`[CORRECTED]` S1 is additionally bounded by two fail-closed rules** that the
original contract did not state, and that the repair implements:

- A **PIPELINE** (`|`) carries nothing. The shell's exit status of a pipeline
  is the status of its **LAST** element, so a successful wrapper does not
  establish that the earlier element succeeded — this is exactly the R1
  failure (`helm template | head` reported success while Helm failed).
- A **chain naming more than one allowlisted executable** carries nothing.
  Which one ran is not decidable from the command text alone.

A `||` chain carries nothing for the same reason (the second segment runs
only when the first one failed).

**S2 — Make the compaction trigger's accounting representation match the
provider-visible request.** `HALT_ESTIMATOR_NOT_REPRODUCED_AT_ACTUAL_PATH`.

**`[CORRECTED]`** The original contract here was based on a causal attribution
that the expert review found unproven, and it is therefore **not authorized**.
The production trigger ALREADY measures the API-safe projection on both paths
(`compaction.ts:381-389` reads `context.apiMessages`;
`session-runtime-orchestrator.ts:1775` populates it through
`prepareProviderMessagesForApi` → `MessageBuilder.buildForApi`), so the
change this contract asks for is either already present or targets a path
that has not been shown to exist.

The precondition for any S2 repair is **matched decision-time evidence**:
capture the request estimate, the API-projection estimate, the trigger, the
calibration factor and the request identity through the existing compaction
diagnostics — default-off and metadata-only — and reproduce a mismatch
through the **actual runtime projection**, not a manually supplied raw view.

The invariants that would still hold for a future, evidence-backed S2: no
change to `COMPACTION_TRIGGER_RATIO`, no change to the context size, no change
to the provider calibration, and a genuinely oversized request must still
trigger.

**Explicitly out of scope for the successor:** re-inserting raw stdout, command
arguments, URLs, secrets or unrestricted error text into summarizer inputs;
weakening the export confidentiality guarantees; adding a persistent evidence
store or a retrieval subsystem.

---

## 8. Gates actually executed

| Gate | Result |
|---|---|
| Canonical/sidecar identity | GREEN — exact session; prefix boundary `msg_8nBMg_D6` matches `source_last_message_key`; capture-generation divergence recorded |
| Production-seam replay | GREEN — executed offline, no LLM request |
| First-loss discriminator | **REPRODUCED** — empty command classification at `classifyCommand` |
| R1 shell-status negative control | GREEN |
| R7 evidence-status control | GREEN |
| Repeated-compaction conservation | **`[CORRECTED]`** 10/10 cycles below the implied trigger **as judged against the PRECEDING provider request** (adjacent-request proxy — a BOUND, not a per-decision finding); the counterexample reproduces **synthetically** and does **not** drive the production trigger |
| 12-outcome bound | MEASURED — exactly 12 carried, exactly 12 bound; the three probes were carried, so the bound did not evict them |
| Confidentiality | GREEN — synthetic secrets absent from the summarizer request and the installed continuation |
| Upstream comparison | GREEN — exact commit `43a976d93151` and the five affected files documented |
| Typecheck | GREEN — **zero new diagnostics**; baseline 43 before and after |
| Biome | GREEN — zero ACT-owned errors |
| Baseline | GREEN — the existing context suite passes: 16 files passed / 1 skipped, 293 tests passed / 1 skipped |

### Executed commands

```bash
cd sdk/packages/core
CLINE_ROUNDC_SESSION_DIR=<private session dir> bunx vitest run --config vitest.config.ts \
  src/extensions/context/compaction.roundc-fidelity-recon02.test.ts
# -> 20 passed

cd sdk/packages/core
CLINE_ROUNDC_SESSION_DIR=<private session dir> bunx vitest run --config vitest.config.ts \
  src/extensions/context
# -> 16 passed | 1 skipped (17 files); 293 passed | 1 skipped (294 tests)

cd sdk/packages/core && bun tsc -p tsconfig.dev.json --noEmit
# -> 43 errors, identical to the pre-ACT baseline (measured with the ACT file stashed)
# -> 0 diagnostics attributable to the ACT-owned file

cd <repo root> && node_modules/.bin/biome check \
  sdk/packages/core/src/extensions/context/compaction.roundc-fidelity-recon02.test.ts
# -> Checked 1 file. No fixes applied.
```

### Incomplete gates

- **Matched-request attribution** — `CAPTURE_INSUFFICIENT`. The Round C trace
  does not record the compaction-decision token accounting, so the exact
  estimator error for the ten live decisions is not computable. The
  adjacent-request observation is reported as a **bound**, explicitly not as an
  estimator delta.
- **Historical summarizer request** — `UNAVAILABLE_FROM_TRACE`. The generated
  summary is observed; the request that produced it is not. H2 (generative
  omission) therefore cannot be separated from H1 (input omission) for the
  specific facts, and is reported as `NOT_ISOLATED`.

---

## 9. Preservation

No push, PR, VSIX, extension installation, live Strata benchmarking or
Keycloak modification. The protected stash (`stash@{0}`, WIP on
`d46223b51`) and all six worktrees are preserved. No history rewritten. No
temporary instrumentation installed.

**Stop after classification.** No successor repair is implemented by this ACT.
