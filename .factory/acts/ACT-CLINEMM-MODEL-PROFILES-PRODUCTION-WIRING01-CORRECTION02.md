# ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01-CORRECTION02

## Verdict source

Sixteenth reviewer (`HALT_MODEL_PROFILE_TRIGGER_AND_RESUME_AUTHORITY`):
the previous correction closed the source-check witnesses for the
chat parent reachability + factory integration + identity
collapse, but introduced two new load-bearing defects:

  - The trigger seam was wrong: the picker was mounted as a
    SIBLING of the existing `<ModelDisplayButton>`, so clicking
    the visible current-model label still routed to Settings.
    The product contract — click the existing model name, get
    the picker — was not satisfied.

  - The factory integration silently falls back to the legacy
    `ApiConfiguration` whenever a bound profile's instance is
    missing/corrupt. This splits task-metadata authority
    ("Profile A is bound") from runtime authority ("unrelated
    legacy config") — exactly the split-brain the Foundation
    eliminated.

## P0s closed

| P0 | Class | Repair |
|----|-------|--------|
| P0-1 | `HALT_MODEL_PROFILE_TRIGGER_SEAM_WRONG` | Refactor `ModelProfileQuickSwitch` to expose `useModelProfileQuickSwitch()` returning `{ triggerProps, popover, isOpen }`. The EXISTING `<ModelDisplayButton>` in `ChatTextArea` becomes the picker trigger (no sibling button). Dead `handleModelButtonClick` removed. |
| P0-2 | `HALT_BOUND_PROFILE_MISSING_INSTANCE_FAILS_OPEN` | Discriminated `ResolveActiveInstanceResult = RESOLVED \| NONE_BOUND \| BOUND_BUT_BROKEN`. `SdkTaskStartCoordinator` aborts with explicit error when bound profile's instance is missing — no legacy fallback. |

## P1 closed

| P1 | Class | Repair |
|----|-------|--------|
| P1 | C4 evidence label overclaim | `factory-resume-effective-connection.mpwc01.test.ts` docstring now explicitly states the test drives the REAL `SdkTaskStartCoordinator.initTask` against a TEST DOUBLE for `sessionConfigBuilder`. Typed projector + real builder are NOT exercised in C4. A future bounded correction can add a composed real-builder assertion if stronger evidence is needed. |

## P2 closed

| P2 | Class | Repair |
|----|-------|--------|
| P2 | Subject vs closure HEAD wording | Distinguish `PRODUCTION_SUBJECT_HEAD` (the commit hash owning the production source) from `CLOSURE_HEAD` (the repository HEAD, which may carry later evidence-only commits). |

## RED → GREEN witnesses

| ID | Test | Discriminator |
|----|------|---------------|
| C1 SUPERSEDED | `chat-parent-reachability.mpwc01.test.tsx` (3 tests, re-aligned) | Chat parent source contains `useModelProfileQuickSwitchHost` import + `triggerProps` spread on `<ModelDisplayButton>` + NO `<ModelProfileQuickSwitchContainer>` sibling. |
| C5 NEW | `chat-existing-model-label-trigger.mpwc02.test.tsx` (8 tests) | Render real chat parent surface (with `useModelProfileQuickSwitch`); click existing current-model label → popover appears. aria-expanded reflects state. Select option fires `onSelectProfile` on the trigger surface. Manage Profiles routes to parent callback. Source-check assertions for the corrected wiring. |
| C6 NEW | `bound-profile-missing-instance.mpwc02.test.ts` (5 tests) | Discriminated resolver returns the right kind for each case. RESUME path also returns `BOUND_BUT_BROKEN`. `initTask` does NOT call `sessionConfigBuilder.build` when bound; emits `emitClineAuthError`. `reinitExistingTaskFromId` does NOT call build when bound. `NONE_BOUND` falls back to legacy (build IS called). |

## Test results

```
Backend (bridge config): 68/68 GREEN
  Was 63 (57 + 6 new C3/C4), +5 new C6 = 68.

Webview: 41/41 GREEN
  Was 32 (28 + 4 new C1/C2), +9 new = +8 C5 + 1 re-aligned C1.

TYPECHECK: 0 new errors.
  Pre-existing errors (unchanged):
    - provider-instance-identity-r{1a-red,2-strategy-b}.piif01.test.ts
      (TS2307 — pre-existing from earlier foundation cycle)
    - cline-session-factory.test.ts
      (TS2353 / TS2345 ollamaApiOptionsCtxNum — pre-existing)

git diff --check: clean.
```

## Files changed

**Modified**:
- `apps/vscode/src/sdk/profile-store/owner.ts` (discriminated `ResolveActiveInstanceResult`, `resolveActiveInstanceTypedDiscriminated`, owner callback type update).
- `apps/vscode/src/sdk/sdk-task-start-coordinator.ts` (option returns discriminated result; BOUND_BUT_BROKEN aborts in both `initTask` and `reinitExistingTaskFromId`).
- `apps/vscode/src/sdk/SdkController.ts` (callback returns NONE_BOUND when no owner).
- `apps/vscode/webview-ui/src/components/chat/ModelProfileQuickSwitch.tsx` (refactored to use hook; exposes `useModelProfileQuickSwitch`).
- `apps/vscode/webview-ui/src/components/chat/ModelProfileQuickSwitchContainer.tsx` (exposes `useModelProfileQuickSwitchHost`).
- `apps/vscode/webview-ui/src/components/chat/ChatTextArea.tsx` (existing `<ModelDisplayButton>` IS the picker trigger; popover sibling inside `ModelContainer`).
- `apps/vscode/src/sdk/__tests__/factory-resume-effective-connection.mpwc01.test.ts` (honest evidence label + discriminated helper tests).
- `apps/vscode/webview-ui/src/components/chat/chat-parent-reachability.mpwc01.test.tsx` (re-aligned to corrected trigger seam).
- `apps/vscode/vitest.config.c2-4-c-bridge.ts` (added C6 entry).

**Created**:
- `apps/vscode/src/sdk/__tests__/bound-profile-missing-instance.mpwc02.test.ts` (5 tests).
- `apps/vscode/webview-ui/src/components/chat/chat-existing-model-label-trigger.mpwc02.test.tsx` (8 tests).
- `.factory/evidence/ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01-CORRECTION02/15-exact-head-binding.txt`.
- `.factory/acts/ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01-CORRECTION02.md` (this file).

## Verdict

```
DOMAIN_IMPLEMENTATION                  = PASS
TYPED_RUNTIME_COMPOSITION              = PASS
RPC_PRODUCTION_REACHABILITY            = PASS
CHAT_UI_PRODUCTION_REACHABILITY        = PASS
   (trigger IS the existing model label — verified by C5)
SETTINGS_PRODUCTION_REACHABILITY       = PASS
SESSION_BINDING_FACTORY_INTEGRATION    = PASS
   (factory aborts on broken binding — verified by C6)
SESSION_BINDING_HELPER                 = PASS
CURRENT_INSTANCE_IDENTITY_CAPTURE      = PASS
EXACT_PRODUCTION_SUBJECT               = STABLE
HEAD_WORDING                           = CLEAR (PRODUCTION_SUBJECT vs CLOSURE)
C4_EVIDENCE_LABEL                      = HONEST (test double acknowledged)
UNRELATED_TRACKED_DIRT                 = ABSENT

P0  HALT_MODEL_PROFILE_TRIGGER_SEAM_WRONG            = CLOSED
P0  HALT_BOUND_PROFILE_MISSING_INSTANCE_FAILS_OPEN    = CLOSED
P1  C4_EVIDENCE_LABEL_OVERCLAIM                      = CLOSED
P2  SUBJECT_VS_CLOSURE_HEAD_WORDING                  = CLOSED
```

The earlier MPW01 + MPWC01 corrections are PRESERVED:
- C1 (CHAT_PARENT_REACHABILITY) — re-aligned to the corrected seam.
- C2 (SETTINGS_PARENT_REACHABILITY) — unchanged.
- C3 (SAVE_CURRENT_IDENTITY_INVERSION) — unchanged.
- C4 (FACTORY_RESUME_EFFECTIVE_CONNECTION) — preserved at the
  functional level; the test now honestly labels itself as
  exercising a TEST DOUBLE for `sessionConfigBuilder`.

## Follow-on note (per reviewer)

After this correction, the planned exact-head VSIX dogfood may
proceed without further architecture review unless C5 or C6
exposes another P0.
