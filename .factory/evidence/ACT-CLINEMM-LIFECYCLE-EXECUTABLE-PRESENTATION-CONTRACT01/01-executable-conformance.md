# ACT-CLINEMM-LIFECYCLE-EXECUTABLE-PRESENTATION-CONTRACT01 — Executable Conformance Evidence

**ENTRY_HEAD:** `fd0bd11ad8cb8ecf7751e7e60d169f9fd86442c0` (main)
**Verdict:** `PASS_STRUCTURAL_ONLY`

## The seven-row matrix

| claim_id | production_seam | test_seam | observed_boundary | status |
|---|---|---|---|---|
| P-01 | `message-translator.ts#agentEventToMessages` (content_start) | `completion-presentation-contract01.cpc01.test.ts` | translator output row: `partial:true`, marker absent | PASS (REAL_PRODUCTION_SEAM) |
| P-02 | `message-translator.ts#agentEventToMessages` (LIVE content_end) + `#finalizePersistedToolUse` (RESTORATION) | same suite, two separate cases | translator output row (live) vs restored row (persistence/reopen) | PASS (REAL_PRODUCTION_SEAM) |
| P-03 | `sdk-session-event-coordinator.ts#handleSessionEvent` (the `hasCompletionResult` filter block) | same suite, four cases (owned running / held observation / foreign session / Elm-HOLD) | coordinator message-layer filter (published message set) | PASS (INJECTED_DECISION) |
| P-04 | `terminalReportFraming.ts#resolveTerminalReportFraming` | same suite, four cases (modern / plan / legacy / phase transition) | webview framing projection | PASS (REAL_PRODUCTION_SEAM) |
| P-05 | `task-proxy.ts#MessageStateHandler.addMessages` + `messageReducer.ts#applyMessage` | same suite, one case asserting BOTH boundaries | host message store + webview replica | PASS (REAL_PRODUCTION_SEAM) |
| P-06 | `sdk-session-event-coordinator.ts#promoteCompletionAuthorityMarker` + `#checkElmCompletionAuthority` + `turn-state-tracker.ts#setWithWriter` | same suite, four cases (immediate / deferred / HOLD / FAILURE) | coordinator C10 commit + lifecycle causal trace + webview replica | PASS (INJECTED_DECISION) |
| P-07 | `message-translator.ts#sdkMessagesToClineMessages` | same suite, four cases (committed / held / historical identity / legacy) | persistence/reopen translation | PASS (REAL_PRODUCTION_SEAM) |

A test filename alone does not establish coverage: each row names the
production symbol it exercises and the boundary at which the assertion is
made, and the suite asserts the property AT that boundary.

## The truth table (confirmed against current source semantics)

| scenario | expected modern SDK row behaviour | observed |
|---|---|---|
| Partial completion | No authority marker | CONFIRMED |
| Finalized, before C10 | No authority marker | CONFIRMED |
| Elm HOLD | No current-turn authoritative marker | CONFIRMED |
| Elm FAILURE | No current-turn authoritative marker | CONFIRMED |
| BCB-held completion | No false authoritative presentation | CONFIRMED |
| C10 committed, publication succeeded | Authoritative row promoted | CONFIRMED |
| Phase committed, publication failed | Do not claim marker delivery | CONFIRMED (NEG-03) |
| Next turn streaming | Historical committed row retains its marker | CONFIRMED (P-04 phase transition) |
| Reopen committed transcript | Committed marker recovered | CONFIRMED (P-07 committed) |
| Reopen held transcript | No manufactured marker | CONFIRMED (P-07 held) |

## The RED/GREEN mutation (the ACT's core criterion)

The historical defect was mutated into the REAL production source
(`apps/vscode/src/sdk/message-translator.ts`, the LIVE `content_end` branch
always stamping `isAuthoritativelyCompletedResult: true`) and the witness
suite was re-run:

**RED — 11 failed | 13 passed (24)**

```
× P-02 (LIVE path): content_end finalizes the row WITHOUT the authority marker
× P-02 (RESTORATION path): the marker is recovered ONLY from a verified persisted completion identity
× P-03 (BCB is NOT Elm authorization): an Elm HOLD leaves the row visible but non-authoritative
× P-06 (deferred path): the EXISTING row is promoted after the deferred C10 commits
× P-06 (HOLD): an Elm HOLD produces NO current-turn authoritative marker
× P-06 (Elm FAILURE): an Elm failure produces NO current-turn authoritative marker
× P-07 (held): the restored row does NOT acquire a marker
× P-07 (historical identity): a historical committed completion is NOT overwritten by a newer turn
× NEG-01: the conformance assertion DETECTS a marker stamped before the C10 commit (RED on the mutant, GREEN on production)
× NEG-02: a stale (older-epoch) promotion is NOT treated as the current turn's authority
× NEG-03: a failed marker publication is NOT recorded as a successful promotion
```

**GREEN** — the production file was restored byte-for-byte and the suite
returned to **24 passed (24)**. The production tree was verified clean
(`git diff --stat apps/vscode/src/sdk/message-translator.ts` → empty).

## Executed commands

| command | result |
|---|---|
| `bun run verify:completion-presentation-contract` | PASS — 7 eligible / 7 executable / 0 failed / 0 gaps; 3 negative witnesses PASS |
| `bun run verify:lifecycle-transition-contract` | PASS — 4 transitions synchronized; Chart 04 projection: 1 block, 4 transition claims labeled, 3 edge-free |
| `bun run verify:markdown-mermaid-blocks` | PASS — 4 documents, 0 errors |
| `bun run verify:chart04-mermaid-parse` | PASS — real Mermaid parser (mermaid@11.16.1) on the embedded Chart 04 block |
| `bun x vitest run --config vitest.config.ts src/sdk/__tests__/completion-presentation-contract01.cpc01.test.ts` | PASS — 1 file, 31 tests |
| `bun x vitest run --config vitest.config.ts <8 existing relevant conformance suites>` | PASS — 8 files, 88 tests |
| `cd webview-ui && bun x vitest run src/components/chat/terminalReportFraming.test.ts src/components/chat/chat-view/messageReducer.test.ts` | PASS — 40 + 16 tests |
| `bun x tsc --noEmit` | PASS — exit 0, 0 diagnostics |
| `bun x biome check ...` (root scripts + apps/vscode sources) | PASS |

## Pre-existing failures (NOT owned by this ACT, delta verified zero)

4 files / 23 tests fail in the BCB `notify=true` per-job barrier suites
(`background-completion-barrier01*.test.ts`,
`background-notify-completion-authority-c10-framework-dispatch-failed*.test.ts`).
Verified pre-existing by stashing the entire change set and re-running the
same four files at the pristine ENTRY_HEAD: the identical 23 failures.

## Preservation

No production code changed. No dependency or framework additions. No worktree.
The pre-existing `stash@{0}` was preserved throughout.
