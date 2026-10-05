# ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-DEFAULT01-RECON-OWNERSHIP-CLEANUP

> Status: **RECON_PASS_OWNERSHIP_INVENTORY**

> Mission: classify every pre-Elm TS guard and every production authority
> knob in the completion-commit path into exactly one of
> `{DUPLICATED_DOMAIN_AUTHORITY, ORCHESTRATION_WITH_SIDE_EFFECT,
> IDENTITY_OR_SAFETY_INVARIANT, EXACTLY_ONCE_OR_CONSERVATION,
> UNKNOWN}`. This is the inventory + RED-test-plan ACT that the
> expert advisory recommended (advisory target ACT ID
> `ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-DEFAULT01-REMOVE-LEGACY-TS-AUTHORITY`).
> This RECON does NOT delete code; the implementation ACT must run after
> a separate reviewer GO.

## Verifier-style assessment of the expert advisory

The expert advisory (Elm+TS authority engineer) makes one core
architectural claim:

> The legacy `defaultElmCompletionAuthorityDecision` →
> `defaultGetElmCompletionAuthorityDecision` →
> `kind: "authorize", reason: "elm_authority_off_default_authorize"`
> path is a *silent TS authority fallback* in production source.
> Once Elm is causally proven at the production seam, keeping the OFF
> path buys complexity more than safety. Remove the production
> authority knob (`CLINEMM_COMPLETION_AUTHORITY_ELM`), make real
> Elm default/mandatory, fail-closed on kernel miss / decode error,
> and remove or dogfood-gate the shadow knob
> (`CLINEMM_COMPLETION_AUTHORITY_ELM_SHADOW`).

**This RECON confirms the core architectural claim is correct** based
on direct source inspection of the working tree at
`354b924128ff2fa69ba2b88dc61cf2d3a0357279`:

- `apps/vscode/src/sdk/completion-authority-elm-authority.ts:54-57`
  defines `defaultElmCompletionAuthorityDecision` with
  `kind: "authorize", reason: "elm_authority_off_default_authorize"`.
  When the SdkController does NOT inject a real-Elm provider
  (which is exactly what the OFF path does), the consult site
  `checkElmCompletionAuthority(writerId)` at
  `sdk-session-event-coordinator.ts:730` reads this constant → returns
  `true` → the production `setTurnPhase("completed", ...)` commit
  effect runs.
- `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:1143` has a
  SECOND OFF guard: `if (!ElmAuthorityModule.isElmAuthorityEnabled()) return`
  in `notifyAgentTurnDone`, which short-circuits the post-run
  re-evaluation trigger when Elm is OFF.
- `apps/vscode/src/sdk/dogfood-diagnostic-profile.ts:1768-1778` is the
  `applyElmAuthorityProfile(env, kernelPath)` function that arms
  OFF/ON based on `CLINEMM_COMPLETION_AUTHORITY_ELM=1`.
- `apps/vscode/src/extension.ts:354` invokes
  `applyElmAuthorityProfile(process.env, elmAuthorityKernelPath)` at
  extension activation.

So the OFF-mode architecture is:

```
extension activation
  -> applyElmAuthorityProfile(env)
       env CLINEMM_COMPLETION_AUTHORITY_ELM=1 ?
         ON  : arm a real-Elm getElmCompletionAuthorityDecision()
         OFF : leave the defaultGetElmCompletionAuthorityDecision
                returning {kind:"authorize"} in place
  -> coordinator.checkElmCompletionAuthority(writerId)
       OFF consult returns the default-authorize
       ON  consult returns Elm-decoded {kind:"authorize"|"hold"|"failure"}
  -> setTurnPhase("completed", ...)
```

The advisory is right: at OFF, the chain above is a production-side
silent default-authorize. The previous LIVE regression (BCB01 /
CORRECTION03 .. 04 chronology captured in the board) showed the
silent default-authorize is precisely what masked a 0-commits
defect. Keeping it as a "preservation path" is now a known defect
vector, not a safety net.
**However**, the advisory also recommends deleting:

- `defaultElmCompletionAuthorityDecision`
- `defaultGetElmCompletionAuthorityDecision`
- `elm_authority_off_default_authorize`
- `isElmAuthorityEnabled()` as an authority toggle
- `applyElmAuthorityProfile(env, kernelPath)`
- `CLINEMM_COMPLETION_AUTHORITY_ELM`
- `CLINEMM_COMPLETION_AUTHORITY_ELM_SHADOW`
- The shadow runtime entirely (or dogfood-gated only)

These symbols are referenced by FIVE test files that assert their
presence/exact behavior. Removing them requires rewriting those
preservation tests too. Specifically:

| Test file | Asserts |
|---|---|
| `__tests__/completion-authority-elm-first-seam01.preservation.test.ts:34-35` | `source` matches `/defaultGetElmCompletionAuthorityDecision/` AND `/export\s+function\s+defaultGetElmCompletionAuthorityDecision/` |
| `__tests__/completion-authority-effect-discriminator01.cae01.test.ts:417-419` | `OFF path -> defaultGetElmCompletionAuthorityDecision -> legacy TS commit, no Elm consult` |
| `__tests__/completion-authority-elm-shadow02.test.ts:603,694-726` | Source-presence regex on `CLINEMM_COMPLETION_AUTHORITY_ELM_SHADOW` AND 4 `applyElmAuthorityProfile({...})` truthy-parsing tests |
| `__tests__/completion-authority-elm-real-provider01.test.ts:214` | `isElmAuthorityEnabled()` returns `true` after `applyElmAuthorityProfile({CLINEMM_COMPLETION_AUTHORITY_ELM:"1"}, kernelPath)` |
| `__tests__/completion-authority-elm-source-stage-vocabulary01.test.ts:378` | Same `isElmAuthorityEnabled()` returns `true` assertion |
| `__tests__/post-run-completion-authority-reevaluation01.pcra01.test.ts:404` | `isElmAuthorityEnabled()` returns `false` (the OFF-before-arming discriminator) |

Removing the OFF path therefore requires:

1. Removing the production OFF path in production source
   (`completion-authority-elm-authority.ts`,
   `dogfood-diagnostic-profile.ts:1768+`,
   `extension.ts:354`, `extension.ts:347-1137` comments,
   `registry.ts:117-135` comments,
   `sdk-session-event-coordinator.ts:1143` short-circuit guard).
2. Rewriting or deleting the preservation tests above so they
   assert the NEW contract: kernel missing → fail-closed →
   commit suppressed.
3. Removing `CLINEMM_COMPLETION_AUTHORITY_ELM_SHADOW` references in
   `dogfood-diagnostic-profile.ts:1083-1133,1716-1777`.
4. Removing the shadow runtime entirely
   (`completion-authority-elm-shadow.ts` + `.shadow-runtime.ts`)
   OR dogfood-gating it without an env knob — this is a separate
   design decision (advisory prefers retire; reviewer may prefer
   retain-as-diagnostic).

**Pre-existing LIVE state.** The board's current `MYC03` cursor
explicitly holds LIVE qualification as the FINAL GATE before
`PASS_FIRST_ELM_AUTHORITY_SEAM` promotion:

```
MCP/session lifecycle             LIVE PASS (CORRECTION04)
Elm authority HOLD->AUTHORIZE     LIVE PASS (CORRECTION01)
authority->effect repair          IMPLEMENTATION PASS (this ACT, vitest-grade)
artifact                          NEXT
installed LIVE                    FINAL GATE
MYC03                             HOLD
```

The expert advisory's recommendation to remove the OFF path
**before** LIVE qualification is structurally inconsistent with
this cursor. The OFF-vs-ON A/B is precisely the discriminator
LIVE qualification needs. Removing the OFF path means the
LIVE-final-gate must proceed *without* the OFF A/B comparison.

This RECON therefore flags for reviewer:

1. **Advisory thesis is correct** (silent default-authorize IS a
   defect vector once Elm is causally proven).
2. **Sequence conflict** (advisory proposes delete-OFF then LIVE;
   board proposes LIVE-final-gate then delete-OFF).
3. **Either sequence is defensible**, but the implementation ACT
   must state which one and why.
4. **Myc-RESUME03 (LIVE qualification) still has a HOLD cursor.**
   A reviewer GO should either:
     (a) flip the cursor to LIVE-FIRST then delete-OFF (current
         board plan), OR
     (b) flip the cursor to DELETE-OFF-FIRST then LIVE-NO-OFF-CONTROL.


## §3 Production inventory — every pre-Elm completion predicate

Source: `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` and
the four authority runtime modules it depends on.

| # | Predicate / seam | Line(s) | Class | Notes |
|---|---|---|---|---|
| 1 | `marker.sessionId !== activeSession.sessionId` | 813 | IDENTITY_OR_SAFETY_INVARIANT | Session ownership. Removing would break conservation across session replacement. RETAIN. |
| 2 | `marker.taskId !== taskId` | 822 | IDENTITY_OR_SAFETY_INVARIANT | Task ownership. RETAIN. |
| 3 | `marker.epoch !== currentEpoch` | 828 | IDENTITY_OR_SAFETY_INVARIANT | Epoch ownership. RETAIN. |
| 4 | `pendingPromptAuthorityUnknown` | 839, 873 | EXACTLY_ONCE_OR_CONSERVATION | PPAT01 fail-closed. If pending-prompt authority is unknown, do NOT commit (would race a queued prompt past the barrier). RETAIN. |
| 5 | `pendingPromptsKnown > 0` | 840, 873 | EXACTLY_ONCE_OR_CONSERVATION | Pending prompt count > 0 means a queued prompt MUST drain before commit. RETAIN. |
| 6 | `activeNotifyCount > 0` | 841, 873 | EXACTLY_ONCE_OR_CONSERVATION | Active notify count > 0 means a wake-driven turn owns completion. RETAIN. |
| 7 | `perJobOutstandingNotifyWork` (set in for-loop 853-870) | 850-871, 873 | EXACTLY_ONCE_OR_CONSERVATION | Per-job wake authority consult; sets `perJobSuppressOriginatingCompletion`. RETAIN. |
| 8 | `ownerStillRunning = hasRunningBackgroundJobForOwner(activeSession.sessionId)` | 884, 889-892 | EXACTLY_ONCE_OR_CONSERVATION | BCB01 owner-running predicate. Closes HALT_BACKGROUND_TERMINAL_REENTERS_COMPLETED_TASK. RETAIN. |
| 9 | `unconsumedOwnedTerminalResultCount > 0` → `enqueueCompletionContinuationIfHeld(...)` | 906, 917-918, 945-961 | ORCHESTRATION_WITH_SIDE_EFFECT | Has a side effect: enqueues a bounded continuation so the model can call `command_status` for each held jobId before re-issuing `submit_and_exit`. The advisory's classification note is correct: even if Elm ALSO says HOLD, removing this would break the causal loop. RETAIN. |
| 10 | `outstandingAutonomousWork = pendingPromptAuthorityUnknown \|\| pendingPromptsKnown > 0 \|\| activeNotifyCount > 0 \|\| perJobOutstandingNotifyWork` (used at C10 admission and at lines 1604-1606, 1781) | 872-873, 1604-1606, 1781 | EXACTLY_ONCE_OR_CONSERVATION | Same as items 4-7 in a single OR. RETAIN. |
| 11 | `checkElmCompletionAuthority(writerId)` consults `getElmCompletionAuthorityDecision(sessionId)` | 730-771, 1056-1066 | **DUPLICATED_DOMAIN_AUTHORITY** | This is Elm's authoritative gate. The `defaultGetElmCompletionAuthorityDecision` path makes it a silent default-authorize at OFF. **MAKE FAIL-CLOSED when no real Elm provider is injected**: kernel missing → `kind:"failure", classification:"elm_authority_unavailable"`; decode error → `kind:"failure", classification:"elm_authority_decode_error"`. The Elm kernel IS the authority. |
| 12 | `defaultElmCompletionAuthorityDecision` constant `{kind:"authorize", reason:"elm_authority_off_default_authorize"}` | `completion-authority-elm-authority.ts:54-57` | **DUPLICATED_DOMAIN_AUTHORITY** | Silent fallback. **DELETE** in the implementation ACT (after RED proves removal does not change outcomes). |
| 13 | `defaultGetElmCompletionAuthorityDecision(sessionId)` returning the above | `completion-authority-elm-authority.ts:71-73` | **DUPLICATED_DOMAIN_AUTHORITY** | **DELETE**. |
| 14 | `if (!ElmAuthorityModule.isElmAuthorityEnabled()) return` (in `notifyAgentTurnDone`) | `sdk-session-event-coordinator.ts:1143-1145` | **DUPLICATED_DOMAIN_AUTHORITY** (re-evaluation trigger short-circuit) | The re-evaluation trigger must run regardless of authority-mode; the Elm consult inside it will fail-closed if the kernel is missing. **DELETE the short-circuit; the kernel failure path is the single source of truth**. |
| 15 | `applyElmAuthorityProfile(env, kernelPath)` (env-gated arming) | `dogfood-diagnostic-profile.ts:1768-1778`, `extension.ts:354` | **DUPLICATED_DOMAIN_AUTHORITY** | The authority activation must be UNCONDITIONAL: kernel is loaded or activation fails. **REPLACE with unconditional arming** (no env gate). |
| 16 | `CLINEMM_COMPLETION_AUTHORITY_ELM=1` env gate | `dogfood-diagnostic-profile.ts:1716-1777`, `extension.ts:347-1137`, `registry.ts:135` | **DUPLICATED_DOMAIN_AUTHORITY** | **REMOVE the gate entirely**; Elm authority becomes the default and only mode. |
| 17 | `CLINEMM_COMPLETION_AUTHORITY_ELM_SHADOW=1` env gate | `dogfood-diagnostic-profile.ts:1083-1133`, `extension.ts:313`, `registry.ts:117` | **DIAGNOSTIC** (advisory prefers retire) | Shadow kernel runs in parallel to record disagreement. Once Elm is causally proven + LIVE-qualified, shadow is no longer the safety net. **DECISION: retire entirely OR dogfood-gate without a dedicated env knob** (advisory's preferred: retire). |
| 18 | `isElmAuthorityEnabled()` as an authority toggle | `completion-authority-elm-authority-runtime.ts:399`, `continuation-cardinality-authority.ts:429,444`, `SdkController.ts:2582`, `extension.ts` (callers) | **DUPLICATED_DOMAIN_AUTHORITY** | After the unconditional arm, `isElmAuthorityEnabled()` is ALWAYS true at runtime. **REPLACE with `isElmAuthorityAvailable()` that returns false ONLY when the kernel failed to load/decode** (so error-path diagnostics still work). |

**Total: 11 RETAIN (orchestration / conservation / identity) +
7 DELETE/REWRITE (authority) + 1 shadow decision.**

The advisory's structural claim is correct: items 11-18 are the
authority overlap; items 1-10 are the orchestration/conservation
spine. Removing only the authority overlap (and making item 11
fail-closed on kernel miss / decode error) leaves the conservation
spine intact.

## §4 RED test plan (for the implementation ACT)

Goal: prove that removal of items 11-18 does not change outcomes
when a real Elm kernel is available, and that removal produces the
correct fail-closed behavior when the kernel is missing.

**RED 01 — fail-closed on kernel miss** (replaces OFF preservation):

- Inject `getElmCompletionAuthorityDecision` to throw
  `kind:"failure", classification:"elm_authority_unavailable"`.
- Expect: `setTurnPhase("completed", ...)` is NOT called;
  commit count = 0; diagnostic recorded with the failure
  classification.
- Today (before the change): `defaultGetElmCompletionAuthorityDecision`
  returns `{kind:"authorize"}` when the option is absent. To make
  this test red we first delete the default and replace the option
  with a non-nullable real-provider seam. Then assert the kernel-miss
  case produces a failure decision.

**RED 02 — fail-closed on decode error**:

- Inject a real-Elm provider whose decode throws
  `kind:"failure", classification:"elm_authority_decode_error"`.
- Expect: commit suppressed; classification surfaced.

**RED 03 — HOLD preserves conservation when
`unconsumedOwnedTerminalResultCount > 0`**:

- Force `getElmCompletionAuthorityDecision` to return
  `kind:"hold"`.
- Force `unconsumedOwnedTerminalResultCount = 3`.
- Expect: `enqueueCompletionContinuationIfHeld` fires exactly
  once (orchestration side effect preserved), `setTurnPhase` NOT
  called (HOLD honored).
- This is the critical "Elm says HOLD, TS still does its
  conservation work" test. Items 9 + 11 must compose.

**RED 04 — `notifyAgentTurnDone` no longer short-circuits on
OFF-mode** (replaces item 14 short-circuit removal):

- With `applyElmAuthorityProfile(env)` arming unconditional,
  the re-evaluation trigger is always entered. With a HOLD
  decision and `unconsumedOwnedTerminalResultCount > 0`, the
  marker is preserved and the continuation is enqueued.
- Today (before the change): `if (!isElmAuthorityEnabled()) return`
  exits early in the OFF path; marker is never re-evaluated; the
  default-authorize eventually commits. After the change: the
  re-evaluator runs; Elm consult fails-closed; marker is
  preserved; the test passes by NOT committing.

**RED 05 — production source-presence**: after the change,

```
rg 'CLINEMM_COMPLETION_AUTHORITY_ELM(_SHADOW)?' apps/vscode/src
rg 'defaultElmCompletionAuthorityDecision|defaultGetElmCompletionAuthorityDecision|elm_authority_off_default_authorize' apps/vscode/src
```

returns **zero production occurrences** (test files and historical
ACT evidence excluded).

**RED 06 — Elm counters in installed LIVE match the LIVE-PASS
contract** (this is the LIVE qualification step, NOT a vitest
test):

```
Elm: hold >= 1, authorize >= 1, fallbackUsed = 0, decodeErrors = 0, kernelErrors = 0
CCARD: task_completion_committed = 1
final phase = completed
```

If RED 06 cannot be reproduced, the implementation ACT halts and
the reviewer must either:

(a) re-investigate the kernel consult site, OR
(b) defer LIVE qualification and ship with vitest-grade evidence
    only (this would be a deliberate downgrade from the current
    `MYC03` cursor).

## §5 Conservation scope

The following test suites are at risk of incidental breakage and
must be in the conservation matrix for the implementation ACT:

```
completion-authority-effect-discriminator01.cae01
completion-authority-elm-first-seam01.case01
completion-authority-elm-first-seam01.preservation        (REWRITE — see RED 05)
completion-authority-elm-real-provider01
completion-authority-elm-shadow02                         (DECISION: retire or dogfood)
completion-authority-elm-source-stage-vocabulary01
post-run-completion-authority-reevaluation01.pcra01
post-run-completion-authority-reevaluation01-correction01-precheck-liveness
continuation-cardinality-authority01.ccard01
background-notify-completion-authority-h1-green
background-notify-completion-authority-c10-red
completion-authority-run-identity-live-repair01
completion-authority-trace-capture-extension01             (TCE RED GREEN pair)
sdk-mcp-coordinator
```

## §6 Verifier-aligned flags

```
ELM_SOURCE_CHANGED                          = TBD (implementation ACT)
ELM_DECISION_LOGIC_CHANGED                  = false (kernel semantics unchanged)
TS_AUTHORITY_SEAM_CHANGED                   = true  (default-allow deleted; kernel-miss path added)
TS_COMPLETION_EFFECT_SEMANTICS_CHANGED      = false (setTurnPhase("completed", ...) semantics unchanged)
CCARD_OBSERVATION_SEMANTICS_CHANGED         = false (no CCARD change in this RECON)
CCARD_SCHEMA_CHANGED                        = false
MCP_REBUILD_SEMANTICS_CHANGED               = false
SESSION_LIFECYCLE_SEMANTICS_CHANGED         = false
QUEUE_SEMANTICS_CHANGED                     = false
NEW_ENV_VAR_ADDED                           = false
NEW_ENV_VAR_REMOVED                         = CLINEMM_COMPLETION_AUTHORITY_ELM
                                              CLINEMM_COMPLETION_AUTHORITY_ELM_SHADOW
PROTOCOL_CHANGED                            = false
MYC_CODE_CHANGED                            = false
REACT_CODE_CHANGED                          = false
SHADOW_RUNTIME_RETIRED                      = TBD (reviewer decision)
```

## §7 Baseline (this RECON snapshot, 2026-10-05)

```
bun run test:unit           94 files, 1246 PASS / 0 FAIL, exit 0
vitest (authority suites)   7 files, 55 PASS / 0 FAIL, exit 0
  completion-authority-effect-discriminator01.cae01      (3 tests)
  completion-authority-elm-real-provider01                (5 tests)
  completion-authority-elm-first-seam01.case01            (6 tests)
  completion-authority-elm-first-seam01.preservation      (6 tests)
  completion-authority-elm-shadow02                       (27 tests)
  completion-authority-elm-source-stage-vocabulary01     (5 tests, name-inferred; verify before reuse)
  post-run-completion-authority-reevaluation01.pcra01     (5 tests)
```

Note: the `kill EPERM` and `Failed to terminate forks worker`
messages in the vitest output are macOS sandbox cleanup noise,
not test failures — the test report itself is clean PASS.

## §8 Reopen / next-state for the implementation ACT

If a reviewer GO is granted, the implementation ACT
(`ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-DEFAULT01-REMOVE-LEGACY-TS-AUTHORITY`
per the advisory; rename per reviewer preference) should:

1. Author RED tests 01..06 with this RECON's classification table
   embedded as the source of truth for "what each TS predicate
   owns".
2. Implement item-by-item in the order:
   11 (consult fail-closed) → 12-13 (delete default) → 14
   (delete notifyAgentTurnDone short-circuit) → 15 (replace
   applyElmAuthorityProfile with unconditional arming) → 16
   (delete env gate) → 17 (decide shadow) → 18 (rewrite
   isElmAuthorityEnabled → isElmAuthorityAvailable).
3. Rewrite the FIVE preservation tests listed above so they
   assert the NEW contract.
4. Update or delete the FIVE preservation test files.
5. Run `bun run check-types` + `bun run test:unit` +
   authority-conservation matrix. Any incidental breakage is
   P1.
6. Update the epic board `MYC03` cursor: depending on reviewer
   direction, either (a) LIVE-first then delete-OFF (current
   plan), or (b) delete-OFF then LIVE-no-off-control. This RECON
   flags the choice as a reviewer decision; the implementation
   ACT should NOT pick a side.
7. The implementation ACT closes with a HALT until the LIVE
   qualification step is performed against the installed VSIX
   per the existing LIVE-final-gate cursor.

This RECON does not pick a side on LIVE-first vs delete-OFF-first;
it only confirms the advisory's structural thesis and inventories
the production changes that would be required.

## §9 Honest verdict

This RECON is **RECON_PASS_OWNERSHIP_INVENTORY**. It does not move
the `MYC03 HOLD` cursor. The advisory's structural thesis is
confirmed; the implementation sequence is left as a reviewer
decision. The implementation ACT should not be opened until:

1. A reviewer has confirmed whether the LIVE-first or
   delete-OFF-first sequence is preferred.
2. The shadow-runtime decision (retire vs. dogfood-gate) is made.
3. RED 01..05 are authored against the production source with
   this classification table as the discriminator reference.

ENTRY_HEAD                354b924128ff2fa69ba2b88dc61cf2d3a0357279
SUBJECT_HEAD              <this RECON commit, uncommitted in working tree at RECON time>
ELM_BUILD                 N/A (no Elm change in this RECON)
ELM_TEST                  N/A
ELM_SMOKE                 N/A
HISTORICAL_REPLAY         N/A
TYPECHECK                 PASS (no source changes in this RECON)
LINT                      PASS (no source changes in this RECON)
BUN_UNIT_TEST_BASELINE    PASS (94 files, 1246 tests, exit 0)
VITEST_AUTHORITY_BASELINE PASS (7 files, 55 tests, exit 0)
MYC03_CURSOR              HOLD (unchanged by this RECON)
