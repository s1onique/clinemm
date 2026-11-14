# ACT-CLINEMM-TASK-HEADER-PROVIDER-USAGE-AUTHORITY-01

## Verdict

**PASS_STRUCTURAL_ONLY**

The bounded presentation repair is implemented and structurally qualified. Installed/live operator qualification was not performed, so this ACT is not claimed as `CLOSED_CLEAN`.

## Entry and final state

- Repository: `s1onique/clinemm`
- Branch: `main`
- Entry HEAD: `a02a040e143bccaabad1763ec2ae0fe5e0bdb139`
- Entry tree: `98778a442be674f2ed0b6140e8b890b80fc56010`
- Expected predecessor `da45e2a87f30d1174b28713cdf8d6090e273b7cd` had advanced by one docs-only correction; actual HEAD was used.
- Entry worktree was clean, including untracked files.
- Protected `stash@{0}` was inspected and preserved unchanged; it was not popped, applied, dropped, or rewritten.
- Installed extension identity accessible at `/Volumes/UserData/Users/chistyakov/.vscodium-cline/extensions/s1onique.clinemm-4.1.16-8bcfda4ce`; it was not replaced.

## Production files changed

- `apps/vscode/webview-ui/src/components/chat/task-header/ContextWindow.tsx`
- `apps/vscode/webview-ui/src/components/chat/task-header/ContextWindowSummary.tsx`
- `apps/vscode/webview-ui/src/components/chat/ChatView.tsx` (P1-B: preserve observed zero)
- `apps/vscode/src/shared/getApiMetrics.ts` (P1-B: presence-aware observation helper)

Focused test files changed:

- `apps/vscode/webview-ui/src/components/chat/task-header/ContextWindow.test.tsx`
- `apps/vscode/src/shared/__tests__/getApiMetrics.test.ts`
- `apps/vscode/src/sdk/message-translator.test.ts`

No SDK runtime, agent runtime, estimator, compaction coordinator, protocol, dependency, lockfile, Elm source, or installed extension was changed.

## RED → GREEN

### RED

Command:

```text
cd apps/vscode/webview-ui && bun run test -- src/components/chat/task-header/ContextWindow.test.tsx
```

Exit code: `1`. Six new real-component assertions failed at entry. The primary mismatch was:

- expected P numerator: `68,900`
- expected percentage: `26.914062500000004`
- actual W numerator: `148,800`
- actual percentage: `58.12500000000001`

This reproduces the W-first defect at the real `ContextWindow` production seam. Full command and assertion output are in `evidence/red.txt`.

### GREEN

After the repair:

- `ContextWindow.test.tsx`: 19/19 passed, exit `0`.
- `getApiMetrics.test.ts`: 24/24 passed, exit `0`.
- `message-translator.test.ts`: 189/189 passed, exit `0`.
- Webview and extension `tsc --noEmit`: exit `0`.
- ACT-owned-file Biome check: exit `0`.
- Webview production build: exit `0`.
- `git diff --check`: clean.

The requested `TaskHeader.test.tsx` command still fails before test collection because the unchanged installed dependency graph cannot resolve `react-aria/private/toggle/useToggle` from `@react-aria/toggle`. This is not an ACT-owned-file failure. No dependency workaround or lockfile change was introduced. Details are in `evidence/gates.txt`.

## Frozen accounting semantics

- **P — provider-reported input:** the latest eligible main-model usage observation in the active task's message stream. The normalized disjoint buckets are `tokensIn + cacheReads + cacheWrites`; cached input is included once and output tokens are excluded. `lastApiReqTotalTokens` is not used for occupancy.
- **W — working-context estimate:** the prospective next-request estimate. It is not presented as actual provider input and is used as the main fallback only when P is unavailable.
- **B — compaction budget:** unchanged. No estimator, user ceiling, effective limit, trigger, summarizer, message projection, or compaction behavior changed.

## Request provenance

Recon established that SDK provider usage is emitted as a per-model-request usage delta and translated through the existing `normalizeUsageEvent` into `api_req_started` usage payloads. `getLastApiReqContextInputTokens` scans the active task's combined message stream backward and accepts only `api_req_started`; `subagent_usage`, `deleted_api_reqs`, and session aggregates are excluded from this selector. The usage event is reported during the provider stream, so the temporal label used is **Last reported request**, not **Last completed request**.

Task switching and restoration are structurally isolated by the active task's `clineMessages`/persisted task message stream. The existing usage payload does not carry provider/model identity, so the UI does not claim model identity for the historical P.

## UI precedence and fallback

1. Valid P exists → P is the main displayed input and progress numerator; label/tooltip/accessible title identify provider-reported input for the last reported request.
2. P unavailable, valid W exists → W is the main displayed input and progress numerator; visible label and accessible title say `Estimated` / `Estimated next-request input`.
3. Neither exists → `Context usage unavailable`; no zero is fabricated.

Validity rejects non-finite and negative counts. Numeric zero remains distinguishable from absence because the prop no longer defaults missing P to `0`.

The tooltip presents P and W as separate rows: `Last reported input`, `Next-request estimate (Estimated)`, and `Total`. Values are never averaged, summed, or substituted across authorities.

## Compaction conservation

Compaction does not manufacture or rescale provider usage. The prior genuine P remains labeled historical, and post-compaction W remains a separate estimate. The existing `getApiMetrics` Strategy-D tests for completed, failed, skipped, missing-counter, and multiple compactions remain green. No compaction policy or estimator changed.

## Provider accounting conservation

Real translator coverage now exercises:

- OpenAI-compatible inclusive input `68,900` with `64,766` cached reads: normalized disjoint buckets sum to `68,900`, not `133,666`.
- Anthropic-style uncached/cache-read/cache-write buckets: all relevant input buckets are counted once and sum to `68,900`.
- Large output tokens remain excluded from occupancy.

Aggregate usage and cost calculations were not changed.

## Deterministic exact verification

Benchmark fixture:

- context `256,000`
- P `68,900`
- W `148,800`

Observed: main `68.9k`, progress `26.914062500000004` (display `26.9%`), provider-reported source label, W shown separately as an estimate.

Fallback fixture (`P` unavailable, W `148,800`): main `148.8k`, explicit `Estimated`, no provider-usage claim.

Compaction fixture (prior P `100,000`, post-compaction W `30,000`, no new provider usage): main remains `100.0k` with historical provider labeling; `30.0k` appears only as the estimate; no fabricated P `30,000`.

## Artifact and live qualification

The webview production bundle was built and verified to contain the provider source label, next-request estimate label, and unavailable state. An exact-head VSIX was subsequently produced and payload-verified (see **Exact-head package** below). No extension installation was changed. Live Flint/Kapitsa operator smoke qualification remains pending and is explicitly unqualified.

## Remaining limitations

1. The historical P payload has no provider/model identity, so the UI cannot prove that P and the currently selected model share a denominator after a model switch. The ACT does not add a protocol field or telemetry subsystem.
2. The requested TaskHeader focused test command is blocked by a pre-existing installed `react-aria` resolution defect; it fails before collection and is unrelated to the changed files.
3. Installed live qualification did not occur; final closure is `PASS_STRUCTURAL_ONLY`.

## Bounded P1 correction — reviewer disposition

Reviewer disposition: `PASS_WITH_ONE_BOUNDED_P1_CORRECTION` with P1-A (forced-open context accordion) and P1-B (observed zero lost before the component).

### P1-A — accordion correction

`ContextWindowSummary` now initializes the context section expanded and binds `isExpanded` to its controlled `expandedSections` state. The focused interaction test proves expand → collapse → expand.

### P1-B — zero-vs-absent correction

`getLastApiReqContextInputObservation` is the presence-aware shared-helper seam:

- observed numeric zero → `{ value: 0 }`
- no eligible provider observation → `undefined`

`ChatView` consumes `observation?.value` directly, so numeric zero remains provider-authoritative while absence remains absent. The legacy numeric `getLastApiReqContextInputTokens` remains available and returns `0` for backward compatibility.

### P1 RED → GREEN

- RED entry: `0c2012e015365b1347d0c9c8442ad81bb062e96c`
- Accordion RED: 1 failed / 19 passed, exit `1`.
- Zero-vs-absent RED: 24 pass / 1 fail, exit `1`.
- GREEN subject: `bbdccf8a2cd7f1467c3addda2c879928c5711056`
- ContextWindow/summary: 21/21 passed.
- Metrics: 25/25 passed.
- Translator: 189/189 passed.
- Typechecks, Biome, webview build, and `git diff --check`: pass.

### Exact-head package

- VSIX: `dist/clinemm-4.1.16-bbdccf8a2.vsix`
- Bytes: `65,316,266`
- SHA-256: `3e83f57b03905c5423da70c5e210741657424abab94dcf56fb4a96f5da65fd3c`
- Payload verified to contain the provider-authority, estimate, and unavailable labels.

The repository's detached exact-head builder was attempted first but its mandatory frozen Bun install was blocked by the host's `PermissionDenied accessing temporary directory`. The package above was then produced from the clean exact committed tree using the installed lockfile-pinned `vsce` binary and the normal `vscode:prepublish` build. Full commands and identity are in `evidence/package.txt`.

### Final qualification

**PASS_STRUCTURAL_ONLY.** The two P1 defects are corrected, the package is exact-head and payload-verified, and the operator's installed extension was not replaced. Live Flint/Kapitsa provider qualification remains not executed; model-switch attribution remains explicitly qualified.
