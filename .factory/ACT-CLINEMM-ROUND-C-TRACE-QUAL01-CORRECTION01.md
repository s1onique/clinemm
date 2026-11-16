# ACT-CLINEMM-ROUND-C-TRACE-QUAL01-CORRECTION01

Applied on top of `ACT-CLINEMM-ROUND-C-TRACE-QUAL01` (commits `cc921af7f`,
`37fa244a6`, `56ce0f23f`).

## Mission

Single purpose: "Repair the three P0 evidence-defects that the QUAL01 review
left open — the crosswalk's command-vs-evidence confusion, the Helm hook
misclassification, and the overstated TTFT classification — then re-issue the
successor benchmark's GO decision."

The **compaction-lifecycle repair is NOT reopened and NOT altered**.

## Trigger

The QUAL01 review returned `HALT_EVIDENCE_EQUIVALENCE_UNSOUND` for the
successor benchmark.

## The three P0s and their corrections

### P0-1 — The crosswalk confused commands with evidence

`observed_tool_evidence()` read only the `tool_use` **inputs**. It never joined
a tool call to its `tool_result`, never checked the execution status and never
compared the final reports. A command that merely mentioned `timeout`, `mvn`
or `password` qualified as evidence — even when it failed, returned irrelevant
output, or was never executed.

**Correction.** A tool invocation is evidence only when it was **executed**,
its result **did not fail**, and its **observed output** carries the subject's
evidence. The R5 discriminator additionally reconciles **both runs' final
reports** against the six source-backed identifiers. R1/R9/R10 require the
**exact** rendered semantic evidence; a render file's mere existence never
awards `STRONGER`.

### P0-2 — The Helm hook evidence was misclassified

The hook count used `len(re.findall(r"helm\.sh/hook", text))`, which also
matches `helm.sh/hook-weight`. Helm designates a hook with the **distinct**
`helm.sh/hook` annotation; `helm.sh/hook-weight` only orders hooks that
already exist. Both of the previously reported "2 hooks" were hook-weight
false positives — **the chart contains no Helm hooks at all**.

**Correction.** The hook count counts the distinct `helm.sh/hook` key only;
the hook-weight count is reported **separately**. The receipt records the
values-files provenance and whether the **production values** were applied. The
**placeholder-digest**, **no-image-override** and **watcher** renders are
**distinct artifacts**, recorded separately.

### P0-3 — The first text chunk was certified as true TTFT

The boundary was named `provider_first_token` and documented as "the true
time-to-first-token". A text delta is a **client-side** observation: a
reasoning-first request generates reasoning tokens before any text, and a
tool-call-only request generates tokens without ever emitting text.

**Correction.** The boundary is renamed `provider_first_text` for what it
measures, fires only on a **non-empty** text delta, and carries
`serverSideTtft: "UNAVAILABLE_FROM_TRACE"`. The measurement is preserved; only
the claim is narrowed.

## The bounded correction

No compaction, compaction-eligibility, retention or context-budget behaviour was
touched. No new telemetry subsystem, public configuration option or protocol
expansion was introduced. The crosswalk's public CLI gained only additive
optional flags.

## Executable evidence

- **P0-1** — RED: **12 of 14 failed** (6 failures + 6 errors). GREEN: **14/14
  pass** (`python3 -m unittest scripts.tests.test_roundc_trace_qual01_evidence_crosswalk`).
- **P0-2** — RED: the B-series tests fail against the old regex. GREEN: **14/14
  pass**, including `hookCount == 0` against the real production, no-override
  and dev-watcher renders (`hookWeightCount` 2 / 2 / 7 respectively).
- **P0-3** — RED: **5 of 6 failed**. GREEN: **6/6 pass**
  (`bun x vitest run src/agent-runtime.provider-first-text-classification.correction01.test.ts`).
- The latency module: **88/88 pass**. The agents package: **595/595 pass**.
- The vscode Round C suites: **70/70 pass**.
- `tsc --noEmit`: **EXIT 0**, 0 diagnostics for `agents`, `shared` and `vscode`.
- The crosswalk regenerates **byte-identically**.

## The corrected crosswalk result

**6 `EQUIVALENT` / 3 `STRONGER` / 1 `WEAKER`** — not the previously reported
`7 / 3 / 0`. The single `WEAKER` is **R5**: only **1 of the 6** index
identifiers reconciles against both runs' final reports, even though both runs
observed all six in their tool output. This is a real, source-backed finding.

## Verdict

- **Compaction repair:** `PASS_WITH_NONBLOCKING_RESIDUE` — accepted.
- **Successor benchmark:** **NO-GO** — the R5 reconciliation is open.

The ≈5.57× elapsed-time improvement remains an **observed fact** and remains
**causally unattributed**. The observable identity fields being equal rules
OUT a provider/model-id/branch/repository difference, but it does **not**
establish that the cause lies in the unobservable served-model/quantization/
inference configuration: different reasoning paths, a different number of tool
calls (48 vs 209), different compaction behaviour and stochastic generation
remain possible explanations.

## Conservation

- The protected stash (`stash@{0}`) is preserved and **not popped**.
- The compaction-lifecycle repair is untouched.
- No history rewrite, no force push, no PR, no deployment.
- No new VSIX installed, no Strata run, no broad review round.

EVIDENCE: `.factory/evidence/ACT-CLINEMM-ROUND-C-TRACE-QUAL01-CORRECTION01/`
  `01-red-crosswalk-tests.txt`, `02-green-crosswalk-tests.txt`,
  `03-red-timing-classification-tests.txt`,
  `04-green-timing-classification-tests.txt`,
  `05-correction01-closure-receipt.txt`,
  `06-helm-render-semantic-receipt.json`
