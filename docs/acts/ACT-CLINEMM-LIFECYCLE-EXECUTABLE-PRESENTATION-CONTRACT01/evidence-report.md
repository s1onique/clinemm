# ACT-CLINEMM-LIFECYCLE-EXECUTABLE-PRESENTATION-CONTRACT01-CORR01 — Evidence Report

**Target:** the two P0 evidence defects raised in the review of `94086bc19`
**Verdict:** `PASS_STRUCTURAL_ONLY`
**ENTRY_HEAD:** `94086bc193b5890600ef52d8b8b7a51403f653fa` (main)
**Parent:** `fd0bd11ad8cb8ecf7751e7e60d169f9fd86442c0`

## 0. Why this CORR01 exists

The review of `94086bc19` accepted the work but found two **evidence**
defects — verification paths that could pass without proving the property
their claim names. Both are repaired here. **No production behaviour
changed.** The only non-test source touched is the Chart 04 *validator*
(`lifecycle-transition-contract-verifier.ts`), which is a documentation
guard, not runtime behaviour.

| # | Finding | Status |
|---|---|---|
| P0-1 | P-03 foreign-session isolation was not exercised against shared ownership state | REPAIRED |
| P0-2 | The new Chart 04 validator repeated the old ID-to-edge false-positive problem | REPAIRED |

Both repairs are RED/GREEN-verified against a mutated source: the witnesses
FAIL against the defective semantics and PASS against the corrected ones.

## 1. P0-1 — P-03 shared-ownership isolation

### 1.1 The defect

The original P-03 foreign-session witness built TWO INDEPENDENT harnesses:

```ts
const h = makeHarness()
const foreign = makeHarness({ activeSessionId: "session-foreign", activeTaskId: "task-foreign" })
foreign.ownedJobs.push({ jobId: "job-foreign-1", running: true })
foreign.unconsumed.value = 1
```

The foreign obligation lived in a **separate fixture** with its own
separate `ownedJobs` array and its own separate `unconsumed` counter. The
assertion ("this task's row is still published") was therefore true **by
construction of the fixture**, not by any property of production
ownership. Two independently configured fixtures behaving independently is
not foreign-session isolation.

### 1.2 The repair

The real production ownership authorities are:

- `CommandJobManager.hasRunningBackgroundJobForOwner(ownerSessionId)` —
  ONE manager instance holds the jobs of MANY sessions.
- `BackgroundNotifyCoordinator.unconsumedTerminalCountForOwner(sessionId,
  taskId)` — ONE coordinator instance holds the held obligations of MANY
  owners, keyed by the canonical `ownerKey(sessionId, taskId)`.

The new witness drives **ONE** `BackgroundNotifyCoordinator` shared by BOTH
owners. The foreign owner's obligation is registered against the foreign
`(sessionId, taskId)`; the target owner then queries the same shared
service. The asserted property is exactly the one P-03 claims:

> an outstanding FOREIGN obligation neither HOLDS nor RELEASES the target
> owner's completion.

The witness also asserts the negative space — the foreign obligation is
genuinely outstanding (count 1 for the foreign owner, job id present), so
the isolation is not a fiction of an empty set.

### 1.3 The RED discriminator

A deliberately BROKEN ownership discriminator — one that keys on
`sessionId` only and DROPS the `taskId` — is fed to the same witness and
MUST be rejected. The discriminating case is two owners that share a
SESSION but differ in TASK: the real discriminator isolates them; the
broken one cannot.

### 1.4 RED/GREEN against a MUTATED PRODUCTION SOURCE

The production `ownerKey` in
`apps/vscode/src/sdk/background-notify-coordinator.ts` was mutated to a
session-only key (`${sessionId}\u0000`, dropping the taskId dimension),
the suite was re-run, and the production file was restored byte-for-byte.

| phase | result |
|---|---|
| RED (mutated `ownerKey`) | **2 failed** — "the REAL shared coordinator keeps two owners that share a SESSION but differ in TASK isolated"; "the BROKEN session-only ownership discriminator is REJECTED (RED discriminator)" |
| GREEN (restored) | **41 passed** (41) |

The production file was restored to an EMPTY git diff before continuing.

### 1.5 The original test is retained, but relabelled

The original isolated-fixture test is **retained** as a fixture-independence
check, with a docblock stating explicitly that it is NOT the
foreign-session isolation evidence and pointing at the shared-ownership
block. It is no longer the sole support for the claim.

## 2. P0-2 — Chart 04 ID-to-edge association

### 2.1 The defect

`verifyChart04CompletionPresentation` grouped Mermaid edges by claim id and
checked that each expected id occurred **exactly once**. It never checked
that the id labelled the correct source and target states. Swapping the
labels of two edges — while preserving both edges and both ids — satisfied
every check:

```
[*] --> PartialRowPublished                  : P-01 content_start ...
PartialRowPublished --> FinalRowPublished     : P-02 content_end ...
```

becomes

```
[*] --> PartialRowPublished                  : P-02 content_start ...
PartialRowPublished --> FinalRowPublished     : P-01 content_end ...
```

This is the same false-positive class the MUT-03 correction (commit
`38cb209ff`) closed for the c9-c10 traceability diagram: an independent
substring-presence check accepts a swapped id-to-edge association.

### 2.2 The repair

The association is now checked as an **ASSOCIATION**, reusing the strict
approach already established for the c9-c10 diagram, with Chart 04's
verified edge mappings:

| ID | Expected Mermaid edge |
|---|---|
| P-01 | `[*] → PartialRowPublished` |
| P-02 | `PartialRowPublished → FinalRowPublished` |
| P-03 | `FinalRowPublished → RowFilteredOut` |
| P-06 | `C10Committed → BadgeShown` |

The table lives in `CHART_04_EXPECTED_EDGES`
(`apps/vscode/src/sdk/lifecycle-transition-contract-verifier.ts`) and is
wired into both the validator script and the witness suite. A witness
asserts the table actually describes the shipping document, so it cannot
drift into describing a diagram that does not exist.

### 2.3 The swapped-label witness

`MUT-05` mutates two DISTINCT edges **BY THEIR ENDPOINTS** (never by an
already-mutated id — locating the second edge by a mutated id is exactly
the MUT-03 defect). It then asserts:

- the mutation itself: both ids survive exactly once, each attached to the
  other's edge;
- the validator reports an association mismatch for **BOTH** ids;
- **NO** error reports an id as "absent from the Chart 04 Mermaid
  projection" and **NO** error reports "expected exactly one" — so the
  rejection cannot come from a missing label or a cardinality change.

`MUT-06` covers the non-swapped case (a claim id moved onto an unrelated
edge) with the same independence assertions.

### 2.4 RED/GREEN against a MUTATED VALIDATOR

The association check inside `verifyChart04CompletionPresentation` was
neutralized (simulating the pre-correction cardinality-only semantics) and
the suite was re-run.

| phase | result |
|---|---|
| RED (association check neutralized) | **2 failed** — "MUT-05: SWAPPED claim labels on existing edges are REJECTED (both associations)"; "MUT-06: a claim id attached to a WRONG (non-swapped) edge is REJECTED" |
| GREEN (restored) | **41 passed** (41) |

A dedicated in-suite control (`MUT-05 (RED control)`) additionally
reimplements the pre-correction cardinality-only semantics faithfully and
asserts that they produce **ZERO** errors on the swapped-label mutation —
which is the direct proof that the pre-correction guard proved nothing.

### 2.5 The claim taxonomy is unchanged

**P-03 remains classified as `GUARD`.** Its diagram edge represents the
OUTCOME of that guard (the row is filtered out), not a claim
reclassification. A dedicated witness asserts `P-03.kind === "GUARD"` and
that its edge is legitimate and present. The taxonomy was NOT bent to
satisfy the validator.

## 3. Evidence binding — 7/7 retained

All seven claims genuinely retain executable evidence. The coverage
generator (`bun scripts/verify-completion-presentation-contract.ts`) RUNS
the witness suite and derives every `result` from the observed outcome:

```
- eligible claims: **7**
- eligible claims with executable evidence (PASS): **7**
- eligible claims that FAILED: **0**
- eligible claims with an explicit gap: **0**
witness suite exit code: 0; eligible claims: 7; executable (PASS): 7; failed: 0; gaps: 0
PASS completion-presentation-contract: all seven claims have executable, executed evidence.
```

## 4. Gates

| gate | command | result |
|---|---|---|
| Witness suite (H01 + CORR01) | `bun x vitest run src/sdk/__tests__/completion-presentation-contract01.cpc01.test.ts` | **41 passed (41)** |
| Related suites | `bun x vitest run ...cpa01.test.ts ...correction01.test.ts ...cpc01.test.ts` | **3 files, 64 passed (64)** |
| Coverage generator | `bun scripts/verify-completion-presentation-contract.ts` | **PASS, 7/7** |
| Contract validator | `bun scripts/verify-lifecycle-transition-contract.ts` | **PASS (exit 0)** — 4 transitions synchronized; Chart 04 block association-verified |
| Mermaid guard | `bun scripts/verify-chart04-mermaid-parse.ts docs/architecture/task-lifecycle/04-completion-presentation.md` | **PASS (exit 0)** — real Mermaid parser |
| TypeScript | `bun run check-types` / `bun x tsc --noEmit` | **PASS (exit 0, 0 diagnostics)** |
| Lint | `bun x biome check --config-path ./biome.jsonc <changed files>` | **PASS** |

The witness suite grew from **31** to **41** tests (10 added: 6 Chart 04
association + 4 P-03 shared ownership).

## 5. Regression delta

**ZERO regressions.** The `src/sdk` scope was run at the pristine baseline
and with this change. The baseline is **self-inconsistent** across runs
(run 1: 81 failures; run 2: 52 failures — the same code), because the
sandbox cannot spawn child processes (`spawn_failed` / `EPERM`), which
makes the process-spawning suites flaky and aborts the vitest run at a
different point each time.

Comparing the failure-name sets with the two crash-inducing files excluded:

- **"only in with-change" is EMPTY** — this change introduces **zero** new
  failures.
- "only in baseline" lists 27 tests that failed at baseline and passed with
  the change; these are the flaky spawn-dependent tests, not fixes — this
  change touches no runtime behaviour.

The two crash-inducing files in isolation are **identical** at baseline and
with the change (20 failures each, differing only in timing digits), all
of them `spawn_failed` / `EPERM` environment failures.

## 6. Preservation

No production behaviour changed. No completion-authorization policy,
lifecycle state ownership, Elm policy, wire protocol or public API changed.
No new Elm authority, no lifecycle-policy refactoring, no generic tracing
architecture. No worktrees. No dependency or framework additions. The
lifecycle transition trace observer remains DEFAULT_OFF and bounded.

The only non-test source change is the Chart 04 **validator** — a
documentation-synchronization guard, not runtime behaviour — plus the
`expectedEdges` option threaded into it.

## 7. Verdict

`PASS_STRUCTURAL_ONLY` — no live installed-extension capture was taken or
claimed. The two P0 evidence defects are closed with RED/GREEN-verified
witnesses against mutated sources, and all seven Chart 04 claims retain
executable, executed evidence.

---

# ACT-CLINEMM-LIFECYCLE-EXECUTABLE-PRESENTATION-CONTRACT01 — Evidence Report

**Target:** Chart 04 — Completion Presentation
**Verdict:** `PASS_STRUCTURAL_ONLY`
**ENTRY_HEAD:** `fd0bd11ad8cb8ecf7751e7e60d169f9fd86442c0` (main)

## 1. What this ACT establishes

Chart 04's seven completion-presentation claims (`P-01` … `P-07`) are now
**source-bound executable conformance**. Every claim has exactly one stable
id, one production symbol, one executable witness, one observed assertion and
one evidence status. Mermaid rendering and prose agreement are never the
proof — the proof is a concrete failing test when the asserted invariant
regresses.

No production behaviour changed. The ACT adds an executable contract, a
deterministic coverage generator, a documentation guard, and corrects the
documentary contradictions that the executable evidence establishes.

## 2. The seven-claim coverage report

The machine-readable report is [`coverage-report.tsv`](coverage-report.tsv);
the Markdown rendering is [`coverage-report.md`](coverage-report.md). Both
are GENERATED by `bun scripts/verify-completion-presentation-contract.ts`,
which runs the witness suite and derives every `result` from the **observed**
test outcome.

| claim_id | kind | evidence_level | result |
|---|---|---|---|
| P-01 | TRANSITION | REAL_PRODUCTION_SEAM | PASS |
| P-02 | TRANSITION | REAL_PRODUCTION_SEAM | PASS |
| P-03 | GUARD | INJECTED_DECISION | PASS |
| P-04 | PROJECTION | REAL_PRODUCTION_SEAM | PASS |
| P-05 | INVARIANT | REAL_PRODUCTION_SEAM | PASS |
| P-06 | TRANSITION | INJECTED_DECISION | PASS |
| P-07 | INVARIANT | REAL_PRODUCTION_SEAM | PASS |

- **Eligible claims: 7.**
- **Eligible claims with executable evidence (PASS): 7.**
- **Eligible claims that FAILED: 0.**
- **Eligible claims with an explicit gap: 0.**

No claim is excluded from the denominator. The `INJECTED_DECISION` evidence
level means the Elm decision is injected at the existing provider boundary
(`getElmCompletionAuthorityDecision`); **every other seam in those claims is
production code**. No live Elm execution and no installed-extension live
capture is claimed, so the closure is `PASS_STRUCTURAL_ONLY`.

The source-bound assertion inventory — one row per witness case (20 claim
cases + 3 negative witnesses) — is
[`assertion-inventory.tsv`](assertion-inventory.tsv). It is generated from the
same registry and the same executed outcomes, so it cannot drift from the
suite that actually ran.

## 3. The production seams under test

| seam | file | what it owns |
|---|---|---|
| `agentEventToMessages` | `apps/vscode/src/sdk/message-translator.ts` | the LIVE partial/finalized completion rows |
| `finalizePersistedToolUse` / `sdkMessagesToClineMessages` | `apps/vscode/src/sdk/message-translator.ts` | the RESTORATION / reopen translation |
| `handleSessionEvent` (the `hasCompletionResult` filter block) | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` | the BCB message-layer filter |
| `checkElmCompletionAuthority` | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` | the Elm authority gate |
| `promoteCompletionAuthorityMarker` | `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` | the commit-driven promotion |
| `setWithWriter` | `apps/vscode/src/sdk/turn-state-tracker.ts` | the committed phase |
| `MessageStateHandler.addMessages` | `apps/vscode/src/sdk/task-proxy.ts` | the HOST message store (upsert by `ts`) |
| `applyMessage` | `apps/vscode/webview-ui/src/components/chat/chat-view/messageReducer.ts` | the WEBVIEW replica (epoch / seq fencing) |
| `resolveTerminalReportFraming` | `apps/vscode/webview-ui/src/components/chat/terminalReportFraming.ts` | the "Completed" badge projection |

The witness suite uses the **REAL** `MessageTranslatorState`,
`SdkSessionEventCoordinator`, `TurnStateTracker`, `MessageStateHandler`,
`applyMessage` reducer and `resolveTerminalReportFraming`. Nothing in it is
a re-implementation of production behaviour.

## 4. The three negative witnesses

| witness | defect | how it is detected | result |
|---|---|---|---|
| **NEG-01** Premature marker | a finalized row receives the marker BEFORE the C10 commit | the conformance detector `rejectsPrematureAuthority` returns TRUE on a mutant that reproduces the historical "stamp at publication" defect, and FALSE on production | PASS |
| **NEG-02** Stale promotion | an older turn's promotion arrives during a newer epoch | the REAL reducer's epoch fence drops it; the historical/current-turn distinction is by EPOCH / TURN identity, **not** by timestamp ordering — a stale promotion with a much HIGHER `ts` is dropped for the same reason | PASS |
| **NEG-03** Failed publication | the C10 commits but the marker publication throws | the trace records `phase_commit_observed` but NOT `marker_promoted` / `effect_executed`; the causal chain does not validate; the webview carries no authoritative badge | PASS |

### NEG-01 RED/GREEN against a MUTATED PRODUCTION SOURCE

NEG-01 is not only an injected mutant. The historical defect was
**mutated into the real production file** and the whole witness suite was
re-run:

```
$ cp apps/vscode/src/sdk/message-translator.ts /tmp/message-translator.ts.bak
$ # mutate the LIVE content_end branch so the marker is ALWAYS stamped:
$ #   ...(isAuthoritativeCompletion ? { isAuthoritativelyCompletedResult: true } : {})
$ # -> ...(isAuthoritativeCompletion || true ? { isAuthoritativelyCompletedResult: true } : {})

$ bun x vitest run --config vitest.config.ts \
    src/sdk/__tests__/completion-presentation-contract01.cpc01.test.ts
```

**RED — 11 failed | 13 passed (24):**

| failing witness | what it caught |
|---|---|
| NEG-01 | the premature marker is detected |
| NEG-02 | the stale-promotion witness is entangled with the premature marker |
| NEG-03 | the failed-publication witness is entangled with the premature marker |
| P-02 (LIVE) | the LIVE `content_end` stamps the marker |
| P-02 (RESTORATION) | the LIVE path is indistinguishable from the restoration path |
| P-03 (BCB is NOT Elm authorization) | the Elm HOLD leaves an authoritative row |
| P-06 (deferred) | the deferred path promotes an already-marked row |
| P-06 (HOLD) | the HOLD produces an authoritative marker |
| P-06 (Elm FAILURE) | the FAILURE produces an authoritative marker |
| P-07 (held) | the held restoration acquires a marker |
| P-07 (historical identity) | the historical identity is overwritten |

**GREEN** — the production file was restored byte-for-byte
(`git diff --stat apps/vscode/src/sdk/message-translator.ts` → empty) and the
suite returned to **24 passed (24)**.

This is the ACT's core success criterion: a future regression of an asserted
completion-presentation invariant produces a concrete failing test.

## 5. Documentary reconciliation

The starting findings were **documentary discrepancies, not established
runtime defects**. Each was corrected only after the source and the
conformance tests established the truth.

| finding | correction |
|---|---|
| Chart 04's `FinalRowPublished` note still described an authoritative marker stamped at `content_end` | the note now states "NO authority marker. The marker is published by the C10 COMMIT (P-06), never at this seam." The Chart 04 documentation guard (`MUT-01`) now REJECTS any re-introduction of the historical wording. |
| Chart 04's introductory authority table attributed marker stamping to the translator | the table now attributes the marker to the **C10 commit** (`promoteCompletionAuthorityMarker`), the **RESTORATION** path (verified persisted identity), and states that the LIVE `content_end` never stamps it. |
| Chart 02 retained historical Elm HOLD marker behaviour in prose | the Elm HOLD row now states the CURRENT behaviour (visible WITHOUT the badge); the historical incident is preserved under an explicit **HISTORICAL NOTE**. |
| Chart 01 contained historical marker-at-translation wording | the reconciliation paragraph now states that the marker is published by the COMPLETION COMMIT and NOT at the translation seam, with the pre-correction design preserved as history. |
| The existing strict contract-to-Mermaid verifier covers A-03/A-04/A-05/P-06 in a separate `.mmd`, not the full Chart 04 document | `verifyChart04CompletionPresentation` (in the existing `lifecycle-transition-contract-verifier.ts`) now checks the **embedded** Chart 04 Mermaid block: every TRANSITION claim carries exactly one labeled edge, every GUARD / PROJECTION / INVARIANT claim carries NO edge, and the historical "stamped at content_end" note is rejected. The existing `verify-lifecycle-transition-contract.ts` script runs it. Four mutation witnesses (`MUT-01` … `MUT-04`) prove the guard has teeth. |

**The claim taxonomy.** The ACT's taxonomy (`TRANSITION` / `GUARD` /
`PROJECTION` / `INVARIANT` / `HISTORICAL_OBSERVATION`) is a DIFFERENT axis
from the ledger's existing `kind` column (evidence maturity:
`observed` / `inferred` / `proposed`). The two are NOT conflated: the ledger
gained three NEW columns — `claim_kind`, `evidence_witness`,
`evidence_status` — and a conformance test asserts that the ledger rows and
the claim registry agree for all seven claims.

## 6. Verification results

| gate | command | result |
|---|---|---|
| G0 production seams identified | source recon (§3) | PASS |
| G1 all seven claims classified | `completion-presentation-contract.ts` | PASS — 7/7 classified |
| G2 every testable claim has executable evidence or an explicit gap | `bun run verify:completion-presentation-contract` | PASS — 7 eligible, 7 executable, 0 gaps |
| G3 negative tests | NEG-01 / NEG-02 / NEG-03 | PASS — 3/3; NEG-01 additionally demonstrated RED against a mutated production source |
| G4 immediate and deferred C10 paths | P-06 witnesses | PASS |
| G5 host / webview / persistence boundaries distinguished | P-05 / P-07 witnesses | PASS |
| G6 Mermaid + prose contradictions resolved | `bun run verify:lifecycle-transition-contract` + the Chart 04 documentation guard | PASS |
| G7 existing relevant conformance suites pass | focused vitest selection | PASS — 8 files, **88 tests** |
| G8 TypeScript + verification scripts | `bun x tsc --noEmit`; Biome | PASS — exit 0, 0 diagnostics |
| G9 artifact identity bound to the actual source HEAD | [`artifact-manifest.tsv`](artifact-manifest.tsv) | PASS |
| G10 no unjustified production-state delta | `git diff --stat` | PASS — **no production file changed** |

### Commands executed (verbatim results)

```
$ bun run verify:completion-presentation-contract
... eligible claims: 7; executable (PASS): 7; failed: 0; gaps: 0
PASS completion-presentation-contract: all seven claims have executable, executed evidence.

$ bun run verify:lifecycle-transition-contract
PASS lifecycle transition contract: 4 transitions, Mermaid synchronized
PASS Chart 04 completion-presentation projection: 1 embedded block(s), 4 transition claims labeled, 3 projection/invariant claims correctly edge-free

$ bun run verify:markdown-mermaid-blocks
PASS .../01-task-turn-phase.md: 1 mermaid block(s), no Markdown leaked into a mermaid fence
PASS .../02-c9-bcb-elm-c10-authority.md: 1 mermaid block(s), no Markdown leaked into a mermaid fence
PASS .../03-background-command-containment.md: 1 mermaid block(s), no Markdown leaked into a mermaid fence
PASS .../04-completion-presentation.md: 1 mermaid block(s), no Markdown leaked into a mermaid fence

$ bun run verify:chart04-mermaid-parse
PASS .../04-completion-presentation.md: mermaid block 1/1 parses (real Mermaid parser)
```

The real-Mermaid check uses the pinned `mermaid@11.16.1` package (with a
headless `jsdom` window) — Mermaid's own `mermaid.parse()` entry point. Its
teeth were verified: a deliberately invalid diagram is rejected with a
precise parse error and exit code 1.

```
$ cd apps/vscode && bun x vitest run --config vitest.config.ts \
    src/sdk/__tests__/completion-presentation-contract01.cpc01.test.ts
 Test Files  1 passed (1)
      Tests  31 passed (31)

$ cd apps/vscode && bun x vitest run --config vitest.config.ts \
    <the eight existing relevant conformance suites>
 Test Files  8 passed (8)
      Tests  88 passed (88)

$ cd apps/vscode/webview-ui && bun x vitest run \
    src/components/chat/terminalReportFraming.test.ts \
    src/components/chat/chat-view/messageReducer.test.ts
 ✓ src/components/chat/terminalReportFraming.test.ts (40 tests)
 ✓ src/components/chat/chat-view/messageReducer.test.ts (16 tests)

$ cd apps/vscode && bun x tsc --noEmit
(no diagnostics — exit 0)
```

### Regression delta

The FULL `apps/vscode` vitest suite has **4 pre-existing failing files**
(`background-completion-barrier01*.test.ts`,
`background-notify-completion-authority-c10-framework-dispatch-failed*.test.ts`)
with **23 pre-existing failing tests**. These were verified to be
**pre-existing** by stashing the entire change set and re-running the same
four files at the pristine `ENTRY_HEAD` `fd0bd11ad`: the identical 23
failures. **The delta is zero.**

## 7. Limitations and explicit gaps

| item | classification | reason |
|---|---|---|
| Live Elm completion-authority execution | `INJECTED_DECISION` | the Elm decision is injected at the existing provider boundary. The `completion-authority-elm-authority` provider tests cover the kernel itself; this ACT does not re-qualify it. |
| Installed-extension live capture | not claimed | no live capture was taken, so no live observation is claimed. The closure is therefore `PASS_STRUCTURAL_ONLY`. |
| Generated-sequence testing | **OMITTED (recorded)** | the existing harness already pins every combination the ACT names (`content_start`, `content_end`, HOLD, AUTHORIZE, deferred resolution, phase transition, duplicate publication, reopen) as explicit, individually-named witnesses against the real production seams. A seeded generator would add a state-machine oracle — which the ACT explicitly forbids ("a separate state-machine implementation copying the production reducer is not acceptable evidence") — and more machinery than useful coverage. Omitted deliberately. |
| The BCB `notify=true` per-job barrier suites | **PRE-EXISTING FAILURE (not owned by this ACT)** | the 23 failures above are recorded in the repo's known-failing set. This ACT records them; it does not repair them. They are out of scope: the ACT resolves only the claims necessary to establish the current completion-presentation contract. |

## 8. Preservation

- **No production code changed.** `git diff --stat` touches only documentation,
  the ledger, the verification tooling, the new pure registry module and the
  new test suite.
- No completion-authorization policy, lifecycle state ownership, Elm policy,
  wire protocol or public API changed.
- No new Elm authority, no lifecycle-policy refactoring, no generic tracing
  architecture, no public protocol change.
- No diagnostic side effect inside a React functional updater.
- The lifecycle transition trace observer remains DEFAULT_OFF and bounded.
- No worktrees. No dependency or framework additions. The existing
  `mermaid@11.16.1` and `jsdom@26.1.0` copies already in the workspace store
  are used; nothing was added to any manifest.
- The pre-existing stash (`stash@{0}`) was preserved.
