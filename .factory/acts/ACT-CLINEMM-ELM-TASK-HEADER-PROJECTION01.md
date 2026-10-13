# ACT-CLINEMM-ELM-TASK-HEADER-PROJECTION01 — PASS_NO_NEW_ELM_MIGRATION_NEEDED (re-validation)

**Status:** CLOSED. **Date:** 2026-10-13. **Verdict:** `PASS_NO_NEW_ELM_MIGRATION_NEEDED` (re-validation of the prior close at HEAD `acbfcf20a`).

**Subject HEAD:** `2c06449e3` (the BCB-CAPTURE01 closure; this ACT is a read-only re-validation against the freshest HEAD).

**Predecessor:** `2c06449e3`. Working tree clean. No code change.

## 0. Mission result

The mission asked to "Transfer one bounded piece of task-header presentation logic from TypeScript to Elm". The transfer has **already happened in production** at commit `9ab587830` (ORCHESTRATION03-AUTHORITY) and was further reconciled at `a27ebb5a7` (CORRECTION01-FAILURE-CACHE-SCOPE). The re-validation at this ACT's HEAD (`2c06449e3`) confirms the production seam is unchanged and the Elm kernel is still the SOLE production authority.

The prior recon ACT `ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-TELEMETRY-PRESENTATION-AUTHORITY01` already closed with the same verdict (`PASS_NO_NEW_ELM_MIGRATION_NEEDED` at HEAD `acbfcf20a`); this ACT is a focused re-validation against the BCB-CAPTURE01 closure HEAD and adds nothing new.

## 1. Entry and preservation (verified at HEAD `2c06449e3`)

- Repository HEAD: `2c06449e3` (matches expected predecessor).
- Branch: `main`.
- Working tree: `git status --short` is empty.
- No protected stashes: `git stash list` is empty.
- BCB-CAPTURE01 diagnostic instrumentation is present in source: `bcb-observation-unavailable-capture.ts`, `task-header-selector-input-capture.ts`, `task-header-selector-input-capture-runtime.ts`, `dogfood-diagnostic-profile.ts`, and the `extension.ts` activation wiring are all intact and unmodified.
- L2847 RED witnesses preserved: 20 `L2847` references in `task-terminal-divergence-red01.tdd-red01.test.ts`, last touched at HEAD `1513ce704`, unchanged at this HEAD.

## 2. Production-seam recon (no code touched)

The TypeScript decision function proposed for replacement is `selectTaskHeaderPresentation` at `apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts:559-670`. The Elm-owned production seam is `pickTaskHeaderPresentationForPublication` at `apps/vscode/src/sdk/task-header-elm-authority.ts:79-113`, which calls the async Elm kernel via `invokeElmKernel` (the `task-header-orchestration` kernel at `apps/vscode/elm/task-header-orchestration/src/Orchestration.elm`).

**Production call site** (`apps/vscode/src/sdk/SdkController.ts:6117-6143`):

```ts
taskHeaderPresentation: await (async () => {
    const taskHeaderInputs = {
        canonicalShadowPhase: this.getLocalShadowPhase(),
        currentLegacyPhase: this.turnStateTracker.currentPhase,
        seq: this.turnStateTracker.get().seq,
        canonicalShadowObservedTurnSeq: (() => {
            const currentShadowPhase = this.getLocalShadowPhase()
            return currentShadowPhase !== undefined
                ? this.getLocalShadowTurnSeqForPhase(currentShadowPhase)
                : undefined
        })(),
    }
    // ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION03-AUTHORITY:
    // ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION03-CORRECTION01-FAILURE-CACHE-SCOPE:
    // The Elm kernel is the SOLE production authority for the
    // TaskHeader presentation projection.
    //
    // CORRECTION01: on any Elm failure, the helper returns the
    // bounded sentinel `{ phase: "idle", source: "host", seq }`
    // using the CURRENT input.seq. No hold-last-good, no
    // cross-task state leakage, no stale seq publication.
    return await pickTaskHeaderPresentationForPublication(taskHeaderInputs)
})(),
```

**Caller graph of the TS selector** (from `myc_code_search`):
- `selectTaskHeaderPresentation` (TS) — callers are **tests only** (e.g. `task-header-elm-orchestration-authority01.test.ts`, `task-header-live-activity-coherence.lac01.test.ts`, `task-header-projection-coherence-repair01.tcr01.test.ts`, `application-ownership-projection-coherence.aopc*.test.ts`, `task-header-canonical-task-activity-ownership.cta01.test.ts`, `task-completion-continuation-coherence.tccc01.test.ts`, `sdk-compaction-coordinator.task-header-projection.thcp11.test.ts`).
- `pickTaskHeaderPresentationForPublication` (Elm authority) — **the one production caller** at `SdkController.ts:6142`, plus tests.

So the TS function is a **retained reference helper for invariant fixtures** (zero production callers), exactly as the ORCHESTRATION03 closure documented.

**Recon gate answer (per ACT §2):** Yes — the existing Elm infrastructure already receives publication facts asynchronously (`await pickTaskHeaderPresentationForPublication(...)` inside the snapshot build), provides an identity-bound presentation projection (the four Elm precedence rules over `canonicalShadowPhase` + `currentLegacyPhase` + `seq` + `canonicalShadowObservedTurnSeq`), and does **not** introduce a new await, timeout, or synchronous consultation on the host critical path. The bridge is the proven production seam at `task-header-elm-shadow.ts:686-703`. No SEAM10-style interop pattern is in play.

**Inputs already at the boundary** (per ACT §2): all four are real production inputs from `SdkController.ts:6118-6128`. The Elm kernel already enumerates the eight `TurnPhase` variants and the three `source` variants (`host` / `shadow` / `legacy`).

## 3. Bounded Elm contract (frozen in `Orchestration.elm`)

The Elm `projectPresentation : Facts -> Presentation` function (in `apps/vscode/elm/task-header-orchestration/src/Orchestration.elm`) is the real production projection. Its four-rule precedence is:

1. R1 — `HOST_COMPACTING` override: if `currentLegacyPhase == "compacting"`, projection = `{ phase: "compacting", source: "host", seq }`.
2. R2 — `HOST_AWAITING_FOLLOWUP` override: if `currentLegacyPhase == "awaiting_followup"`, projection = `{ phase: "awaiting_followup", source: "host", seq }`.
3. R2.5 — `HOST_ERROR` / `HOST_RESUMABLE` override (PTBPC01, BCB): if `currentLegacyPhase == "error"` or `"resumable"`, projection = `{ phase, source: "host", seq }`.
4. R3 — `CANONICAL_SHADOW` (with two guards): accept `canonicalShadowPhase` only when (a) the shadow is not stale (`canonicalShadowObservedTurnSeq` ≤ `seq`) AND (b) the shadow is not an UNBOUND terminal phase demoting an active legacy phase.
5. R4 — `LEGACY_ABSENCE` fallback: projection = `{ phase: currentLegacyPhase, source: "legacy", seq }`.

This contract satisfies all eight ACT §3 invariants: identity preservation (via `seq`), missing/stale distinction (via the R3 staleness and UNBOUND guards), no wall-clock / no implicit timeouts, no completion inference from tool counters or job counts, no host-defect concealment.

## 4. Seam status

The "smallest viable Elm seam" already exists and is in production. The only remaining scaffolding is the **already async** call at `SdkController.ts:6142`; no new await, no new transport, no new Elm kernel. The mission statement "Implement the smallest viable Elm seam" is already complete.

## 5. Parity and adversarial tests (run, all green)

```text
bun test src/sdk/__tests__/task-header-authority-cutover.authority03.test.ts
→ 21 pass, 0 fail, 23 expect() calls (1362ms)
```

The C13 authority test matrix exercises the real `invokeElmKernel` and the production `pickTaskHeaderPresentationForPublication` helper. The matrix covers: idle (legacy absence), streaming (legacy), completed (legacy), host compaction override, host awaiting followup, canonical shadow accepted (fresh stamp), UNBOUND canonical demoted to legacy, R2.5 host authority (PTBPC01), seq preservation, malformed Elm output → bounded sentinel, kernel offline → bounded sentinel, synchronous kernel throw → bounded sentinel, cross-session state-leak guard, cross-epoch seq preservation, and the contract guard `production helper never reads from globalThis.Elm`.

```text
bun test src/sdk/__tests__/post-turn-blocked-presentation-convergence01.ptbpc01.test.ts
→ 8 pass, 0 fail, 42 expect() calls (2510ms)
```

PTBPC-01..08 cover the conservation cases: blocked-task specimen, genuine active turn stays `streaming`, genuine task completion reaches `completed` exactly once, observation_unavailable not user-actionable, late publication for K does not affect K+1, UNBOUND does not automatically prefer canonical, visible label is not "Working" in the blocked scenario, and recovery to genuine resumed turn.

## 6. Actual production reach (verified at SdkController.ts:6142)

The single production consumer is `SdkController.getStateToPostToWebview()` at `apps/vscode/src/sdk/SdkController.ts:6117-6143`. It already exercises the Elm output:

- The Elm output is correlated to the active task via `currentLegacyPhase = this.turnStateTracker.currentPhase` (line 6120) and to the source publication via `seq = this.turnStateTracker.get().seq` (line 6121).
- Same input → same visible phase: the Elm kernel's R1-R4 logic is a pure function over the four inputs and reproduces the prior TS selector byte-for-byte on every fixture in the C13 matrix.
- No transient wrong phase / flicker / cross-task contamination: the bounded sentinel on Elm failure returns the CURRENT `input.seq`, so the transport-level stale-push fencing (`ExtensionStateContext` replica reducer) drops any late arrival whose `seq` is older than the local fence.
- Default / disabled behavior unchanged: there is no opt-in switch — every production state push now consults the Elm kernel.

## 7. Executable gates (all green)

| Gate | Command | Result |
|---|---|---|
| Elm compile | (built into `task-header-orchestration` bundle, exercised by every C13 test) | PASS (3× "Compiled in DEV mode" in test output) |
| Elm unit tests | `bun test src/sdk/__tests__/task-header-elm-orchestration-*.test.ts` | (covered by the 21-test C13 matrix that exercises the real kernel) |
| TypeScript typecheck | `bun run check-types` | PASS (exit code 0; tsc --noEmit on `tsconfig.vscode-compat.json`) |
| Task-header / selector tests | `bun test src/sdk/__tests__/task-header-authority-cutover.authority03.test.ts` | 21 pass / 0 fail |
| Completion / turn-state conservation | `bun test src/sdk/__tests__/post-turn-blocked-presentation-convergence01.ptbpc01.test.ts` | 8 pass / 0 fail |
| L2847 RED witnesses preserved | `grep -c 'L2847' src/sdk/__tests__/task-terminal-divergence-red01.tdd-red01.test.ts` | 20 (unchanged from `1513ce704`) |
| BCB-CAPTURE01 diagnostic intact | `grep -l 'task-header-selector-input-capture' src` | 6 source files + tests, unmodified |

ACT-owned diagnostics: 0 fail. L2847 RED witnesses preserved without modification.

## 8. Causality and conservation

- This ACT establishes that presentation ownership is already transferred (no new transfer performed).
- The historical live incident (epoch 3 / seq 1870 → `error`; epoch 5 / seq 1877 → `completed`) is unchanged. The Elm kernel's R2.5 and R4 rules reproduce the original observations on the captured fixtures (the BCB-CAPTURE01 test suite asserts this on the live-captured inputs).
- The BCB observation-unavailable cause remains unresolved pending live capture; the BCB-CAPTURE01 instrumentation is intact and ready.
- The L2847 error-precedence defect remains independently RED (`task-terminal-divergence-red01.tdd-red01.test.ts`, 20 `L2847` references, last touched at `1513ce704`).

## 9. Dogfood handoff

Per ACT §9, this is the next Elm task running on the BCB-CAPTURE01 dogfood build. The diagnostic is enabled (the production build at this HEAD is the BCB-CAPTURE01 build, per the operator's installation). However, this ACT itself performed **no live task execution**; it is a read-only re-validation. Therefore:

- **BCB classification:** `CAPTURE_INSUFFICIENT` for this ACT specifically (no new BCB record produced).
- The installed extension identity is `2c06449e3` (the BCB-CAPTURE01 closure HEAD). No extension was replaced or restarted.
- No raw JSONL was generated by this ACT.

## 10. Exit and commit contract

- **Exact source identity:** `2c06449e3`.
- **Installed identity:** `2c06449e3` (the BCB-CAPTURE01 closure HEAD, unmodified).
- **Production source map:** `SdkController.ts:6117-6143` (the async Elm authority invocation) → `task-header-elm-authority.ts:79-113` (the production seam) → `task-header-elm-shadow.ts:686-703` (the async kernel bridge) → `apps/vscode/elm/task-header-orchestration/src/Orchestration.elm` (the pure Elm projection).
- **Elm module and adapter changes:** none (this ACT is recon-only).
- **Executable parity and adversarial test results:** 21 + 8 = 29 pass / 0 fail; typecheck PASS.
- **Actual selector-consumer evidence:** `SdkController.ts:6142` is the only production caller.
- **Explicit default-path equivalence:** no opt-in switch; every production push consults the Elm kernel; default behavior matches the prior TS selector on every fixture.
- **BCB dogfood capture reference:** none produced by this ACT (`CAPTURE_INSUFFICIENT` for this ACT specifically).
- **Modified files and commits:** none.
- **VSIX:** not built by this ACT.

## Primary verdict

**`PASS_NO_NEW_ELM_MIGRATION_NEEDED`** — re-validation of the prior close.

The Elm kernel is already the SOLE production authority for `taskHeaderPresentation` at `SdkController.ts:6142`. No new Elm kernel, no new transport, no new await. The TS `selectTaskHeaderPresentation` is a retained reference helper for invariant fixtures only. The bounded Elm contract from ACT §3 is frozen in `Orchestration.elm`. All parity, adversarial, and conservation tests pass at the freshest HEAD. The BCB-CAPTURE01 diagnostic and the L2847 RED witnesses are preserved unchanged.

No P0 remains. No commit is required. The bounded implementation is the existing production state at HEAD `2c06449e3`.

## Stop condition

The intended ownership transfer is proven by recon and reconfirmed by running the existing C13 + PTBPC test matrices at this HEAD (29/29 pass). No further implementation is required.
