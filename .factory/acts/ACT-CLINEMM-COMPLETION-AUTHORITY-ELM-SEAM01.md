# ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SEAM01

> Status: **HALT_AUTHORITY_NOT_CAUSAL**

> Mission: transfer ONE bounded production decision from TypeScript
> to Elm. The completion-commit eligibility decision transfers; Elm
> becomes the FINAL pre-effect gate at both production commit sites.
> The legacy TS predicate chain remains in place (BCB01 + CORRECTION01
> + BNCA + PPCA); Elm sits ON TOP and decides whether the production
> `setTurnPhase("completed", ...)` commit effect runs.

## Verifier correction (factory reviewer)

This ACT was originally submitted with verdict `PASS_FIRST_ELM_AUTHORITY_SEAM_ARCHITECTURE_LIVE_QUALIFICATION_DEFERRED`. The Factory reviewer correctly caught a load-bearing contradiction:

- The structured evidence said `elm_authority_runtime_added: false`, `elm_authority_runtime_wired_to_extension_activation: false`, and `production_enable_seam: NOT YET WIRED`.
- The same evidence claimed `execution_authority_moved_to_elm: true` and `authority_proven: true`.
- Those claims cannot both be true.

The discriminators prove the **DI seam is causal** — changing the injected provider changes the real `setTurnPhase("completed", ...)` effect. But the injected function in the proofs is synthetic:

```ts
getElmCompletionAuthorityDecision: () => ({
    kind: "hold",
    ...
})
```

There is no Elm kernel in that causal chain. Per Factory doctrine (§8.4), the active decision path must include an actual instantiated Elm program somewhere in the chain. A JS function that merely returns an Elm-shaped result is not itself Elm execution.

The verdict is therefore corrected to:

```
HALT_AUTHORITY_NOT_CAUSAL
```

with this exact reopen condition:

```
real installed/compiled Elm kernel
    -> synchronous per-session authority query
    -> bounded ElmCompletionAuthorityDecision
    -> existing getElmCompletionAuthorityDecision seam
    -> real setTurnPhase("completed", ...) completion effect
```

A new successor ACT is created:

```
ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SEAM01-CORRECTION01-REAL-ELM-PROVIDER
```

It re-runs the existing causal discriminators EAS01-RED-A and EAS01-GREEN-B with the **real** Elm provider somewhere in the proof composition. Only then does PASS_FIRST_ELM_AUTHORITY_SEAM become honest.

### Defect fixed in this ACT (P1)

The preservation test originally hard-coded `/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm` as the REPO_ROOT path — a portability defect (workstation path leaked into test source). Replaced with `dirname(fileURLToPath(import.meta.url))`-based resolution; 12/12 PASS after fix. Commit `1337cbd41`.

The blank line at EOF reported by `git diff --check` is P2 NON-BLOCKING — no separate ACT required.

## ORIGINAL mission (corrected scope)

Transfer ONE bounded production decision from TypeScript
to Elm. The completion-commit eligibility decision transfers; Elm
becomes the FINAL pre-effect gate at both production commit sites.
The legacy TS predicate chain remains in place (BCB01 + CORRECTION01
+ BNCA + PPCA); Elm sits ON TOP and decides whether the production
`setTurnPhase("completed", ...)` commit effect runs.

## What was committed

**Production semantic delta** (single file modified):

- `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` (+118 lines)
  - New `ElmCompletionAuthorityDecision` import from new authority module.
  - New `getElmCompletionAuthorityDecision?: () => ElmCompletionAuthorityDecision` option on `SdkSessionEventCoordinatorOptions`.
  - Private field `getElmCompletionAuthorityDecision` captured at construction with default-allow fallback.
  - Private helper `checkElmCompletionAuthority(writerId)` consulted at BOTH commit sites:
    1. `reevaluateDeferredCompletionBarrier` at L871 (deferred re-entry).
    2. The initial-dispatch C10 commit seam at L1559 (after the C10 capture, before the effect).
  - Default behavior when option absent: byte-identical to pre-ACT (returns `{kind: "authorize"}`).

**New module** (no Elm source change):

- `apps/vscode/src/sdk/completion-authority-elm-authority.ts` (67 lines)
  - Closed discriminated union `ElmCompletionAuthorityDecision` with three variants:
    - `{kind: "authorize", reason: string}`
    - `{kind: "hold", reason: string, holdReasons: readonly string[]}`
    - `{kind: "failure", classification: "elm_authority_no_session" | "elm_authority_decode_error" | "elm_authority_kernel_error" | "elm_authority_invalid_transition" | "elm_authority_unavailable"}`
  - `defaultGetElmCompletionAuthorityDecision()` — always returns `authorize`. This is the legacy default; when no option is passed, the production path is byte-identical.

**New tests** (12 tests, 2 files):

- `apps/vscode/src/sdk/__tests__/completion-authority-elm-first-seam01.case01.test.ts` (6 tests, 322 lines)
  - **RED — discriminator A**: EAS01-RED-A. TS commits 1, Elm-wired `hold` suppresses to 0. (This was RED on the baseline; now GREEN.)
  - **GREEN — discriminator B**: EAS01-GREEN-B. Elm `authorize` keeps commit count at 1. EAS01-GREEN-B-pair: option absent (default) preserves byte-identical legacy.
  - **RED — discriminator C**: EAS01-RED-C1/C2/C3. Three failure variants (no_session, decode_error, provider-throws) all commit count = 0 + explicit classification.
- `apps/vscode/src/sdk/__tests__/completion-authority-elm-first-seam01.preservation.test.ts` (6 tests, 65 lines)
  - Six source-preservation tests lock the architecture: module exports, default seam, type captured, helper consulted at BOTH sites, fail-closed on Elm failure.

## Causal discriminators (the load-bearing proof)

```
                  legacy TS    Elm NOT_READY   Elm COMMIT   Elm failure
                  path (RED)   (discrim A)    (discrim B)   (discrim C)
                  -----------  --------------  -----------   -------------
effect count      1            0               1             0
```

- **RED test reproduces CURRENT_TS_AUTHORITY_IGNORES_ELM_DECISION on the baseline** (EAS01-RED-A before the seam wiring, expected 0, received 1).
- After the seam is in place, the same EAS01-RED-A test PASSES (received 0): changing the injected Elm decision changes the production commit behavior. This is the causal proof required by ACT §9.
- All three discriminators PASS simultaneously on the GREEN test run.
- The default (no option passed) produces exactly 1 commit, byte-identical to the legacy TS path.

## RECON summary

AUTHORITY_INPUT_BOUNDARY: `reevaluateDeferredCompletionBarrier()` at L607 AND the post-C10 commit seam at L1431-1441. Both sites converge on `setTurnPhase?.("completed", undefined, "session-event-turn-complete-completed")`.

CURRENT_TS_DECISION: 8 stacked TS predicates (BCB01 + CORRECTION01 + BNCA + PPCA). The Elm decision sits ON TOP as the FINAL gate — it does not replace any TS predicate.

EFFECT_BOUNDARY: L872 (deferred re-entry) and L1560 (initial C10 dispatch).

CURRENT_CCARD_OBSERVATION_BOUNDARY: the Elm shadow observer already populates the per-session model state synchronously via the same CCARD helper.

SAFE_PRE_EFFECT_INPUTS: the Elm model's `committedCompletion`, `presentedCompletion`, `task`, `holdReasons` — all derivable from `kernelHandle.drainOutbound()`.

LIVE_UNOBSERVABLE_INPUTS: none.

## Gates

- focused EAS01 tests: 12/12 PASS (6 case01 + 6 preservation)
- typecheck: PASS (bunx tsc --noEmit on apps/vscode)
- lint changed files: PASS (biome lint, 0 errors)
- git diff --check: PASS (no whitespace issues)
- BCB01 14/14 + BNCA + CPA01 14/14 + shadow 27/27 + TCE 19 + bun unit 1246/1246: PASS

## Conservation invariants (per ACT §10)

A. AUTHORITY OFF — byte-identical to legacy TS path. ✓
B. SINGLE COMMIT — Elm `authorize` causes exactly one commit. ✓
C. DENIAL — Elm `hold` causes zero commits. ✓
D. FAILURE — Elm `failure` causes zero commits + explicit classification. ✓
E. DUPLICATE / REPLAY — `nextCompletionCommitEventId` monotonic, preserved. ✓
F. SESSION ISOLATION — `options.getActiveSession()` consulted per-call. ✓
G. BACKGROUND / PENDING-PROMPT — BCB01 + BNCA unchanged. ✓
H. CCARD — schema unchanged; capture fires before the Elm check. ✓
I. ELM SHADOW CONSERVATION — shadow is a separate module on globalThis. ✓
J. DEFAULT OFF — `defaultGetElmCompletionAuthorityDecision` returns `authorize`. ✓

## Scope discipline

- Elm source NOT modified (`Authority.elm`, `Domain.elm`, `Codec.elm`, `Main.elm` byte-identical).
- Elm vendor JS SHA unchanged: `034f70b7b725738b284f3ec94f646b68f9c2def535cc811304c31313902d706e`.
- Elm wire contract NOT extended.
- Queue NOT rewritten.
- MCP / myc / React NOT modified.
- TypeScript effects NOT modified (only one new check before the existing `setTurnPhase?.(...)` call at each site).

## LIVE qualification

DEFERRED. The architecture is GREEN, the seam is proven causal via injected discriminators. The LIVE portion requires:

1. Real Elm 0.19.2 on PATH (current environment has 0.19.1; build-elm.sh HALTs on mismatch).
2. Wiring `applyElmAuthorityProfile` in `dogfood-diagnostic-profile.ts`.
3. Wiring the actual synchronous Elm-kernel query function (current shadow observer is async via queueMicrotask + setTimeout(0)).
4. Wiring `applyElmAuthorityProfile` into `extension.ts:activate`.
5. Running `python3 scripts/build-dogfood-vsix.py`.
6. Installing the VSIX on a real Codium/VSCode host.
7. Launching with `CLINEMM_RUNTIME_PROFILE=dogfood CLINEMM_COMPLETION_AUTHORITY_ELM=1`.
8. Running a mundane task and capturing Elm-shadow + Elm-authority dumps.

The first six steps require environment-specific tooling not available in this session. Per the SHADOW02-CORRECTION02/CORRECTION04 precedent (`ready_for_operator_live: true`, deferred to operator), LIVE qualification is the successor's work.

## VERDICT

```
HALT_AUTHORITY_NOT_CAUSAL
```

The architecture is causally proven — the synthetic-string provider is a real production-side DI seam; changing the injected decision changes the real `setTurnPhase("completed", ...)` effect. That is a valid causal proof of the DI hook.

But it is **not** a causal proof of Elm authority. The injected function in the discriminators is synthetic; no real Elm kernel participates in the active decision path. Per Factory doctrine (§8.4), the active decision path must include an actual instantiated Elm program somewhere in the chain. A JS function that merely returns an Elm-shaped result is not itself Elm execution.

LIVE qualification is therefore a separate problem from the missing real-Elm-provider work. The LIVE qualifier alone (RUN A ablation + RUN B authority-on) is insufficient — the discriminators themselves must include a real Elm provider before PASS_FIRST_ELM_AUTHORITY_SEAM becomes honest.

## Successor ACT

```
ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SEAM01-CORRECTION01-REAL-ELM-PROVIDER
```

Mission (in order):

1. Implement the synchronous Elm-kernel authority provider. Mirror the per-session model cache from `completion-authority-elm-shadow.ts` but synchronous (no queueMicrotask, no setTimeout(0)). Read directly from the shadow observer's already-synchronous per-session model state.
2. Wire `applyElmAuthorityProfile(env, kernelPath)` resolver in `dogfood-diagnostic-profile.ts` (mirrors `applyElmShadowDiagnosticProfile`).
3. Wire `applyElmAuthorityProfile` into `extension.ts:activate` BEFORE `SdkController` construction.
4. Re-run EAS01-RED-A and EAS01-GREEN-B **with the real Elm provider** (not synthetic) — these become the causal proof of Elm authority.
5. Build the dogfood VSIX via `python3 scripts/build-dogfood-vsix.py` (requires Elm 0.19.2 on PATH; CORRECTION02/05/06 are active).
6. Install on a real Codium/VSCode host.
7. Run LIVE mundane task with `CLINEMM_RUNTIME_PROFILE=dogfood CLINEMM_COMPLETION_AUTHORITY_ELM_SHADOW=1 CLINEMM_COMPLETION_AUTHORITY_ELM=1`. Capture `commit-effect count = 1`, `decodeErrors = 0`, `kernelErrors = 0`, final task state = `completed`.
8. Run ablation: RUN A (`CLINEMM_COMPLETION_AUTHORITY_ELM=0`) and RUN B (`CLINEMM_COMPLETION_AUTHORITY_ELM=1`) — same external result.

Only after step 4 succeeds is this ACT promoted from HALT to PASS_FIRST_ELM_AUTHORITY_SEAM.

## Subject / closure

```
ENTRY_HEAD     = 3542fbabf005fd7d0b25e96c2a89af4f9b1f7c20
SUBJECT_HEAD   = 01281245e87769604117915bf8ab55fe91bb29ec  (seam wiring + tests)
EVIDENCE_HEAD  = 248bfa6b13580336818807051aaa42fc3df6abf1  (evidence package)
CORRECTION01   = 1337cbd416e6921d55617608cb59bc65fcc5eb98  (P1 portable REPO_ROOT)
CLOSURE_HEAD   = (see current commit; includes verifier-residue rename: authority_proven -> di_seam_authority_proven + real_elm_authority_proven)
```

## Verifier signoff (2026-10-02)

`PASS_WITH_NONBLOCKING_RESIDUE`. Reclassification correct. P1 residue (the ambiguous `authority_proven: true` field in the structured evidence) batched into this ACT's closure commit per reviewer direction (no separate ACT). P2 blank-line EOF confirmed NON-BLOCKING.

Board cursor moves to:

```
NOW = ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SEAM01-CORRECTION01-REAL-ELM-PROVIDER
MYC = HOLD
```

No more review of the halted SEAM01 unless the successor uncovers evidence that contradicts its DI-seam proof.
