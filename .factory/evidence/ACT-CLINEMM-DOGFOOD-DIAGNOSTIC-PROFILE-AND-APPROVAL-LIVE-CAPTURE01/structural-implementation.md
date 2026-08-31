# ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-AND-APPROVAL-LIVE-CAPTURE01 — Structural Implementation Evidence

**Subject:** ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-AND-APPROVAL-LIVE-CAPTURE01 (re-open with C1: GO)
**Author:** Factory operator (post-review by Factory causal reviewer)
**Date:** 2026-08-31
**Status:** REOPENED / DOGFOOD_IDENTITY_STRUCTURALLY_AVAILABLE

## What this commit proves (per Factory causal reviewer)

The reviewer's verbatim guardrails for this ACT were:

```text
C1: GO

DOGFOOD_IDENTITY_PRECONDITION = SATISFIED_STRUCTURALLY
DOGFOOD_SCOPE = ALL mkCodiumProfile launchers
MANUAL_ENV_VARS = FORBIDDEN_FOR_NORMAL_DOGFOOD_QUALIFICATION
INITIAL_EFFECTIVE_KNOBS = V = ON, I = ON, A = OFF, P = ON
EXPECTED_HEADER = VIP
PUBLIC / non-dogfood runtime = diagnostics OFF by default

LIVE QUALIFICATION MUST COMPOSE:
  normal codium-factory / codium-clinemm launch
    -> resolver observes dogfood
    -> VIP activates automatically
    -> automatic runtime-owned JSONL appears
    -> header visibly says VIP

THEN:
  execute the native editor-tool specimen
  -> use P records to classify CASE B vs CASE C

DO NOT:
  require standalone identity qualification first
  manually export diagnostic env vars
  show A before A exists
  repair editor approval in the observability ACT
```

This commit satisfies every structural precondition. The live
qualification (the codium-factory launch + specimen execution) is
operator-driven and out of scope for this commit.

## Composition evidence (deterministic test results)

```
apps/vscode/src/sdk/dogfood-diagnostic-profile.test.ts   : 22/22 vitest GREEN
  C1 public + no env + no path  -> all OFF
  C2 public + env tries enable  -> still OFF (public wins)
  C3 dogfood + no env + no path  -> V/I/P partial; A off
  C4 dogfood + no env + auto path -> VIP (canonical indicator)
  C5  override-down tokens ('0', 'off', 'false') honored in dogfood
  C5d case + whitespace tolerance (' OFF ')
  C6a explicit-on 'true' honored in dogfood
  C6b garbage tokens fall through to default
  C7  A is hard-coded false regardless of dogfood or env
  C8  empty-string env values fall through to default
  R7  resolver body does not mutate its input env

apps/vscode/src/sdk/dogfood-runtime-capture-path.test.ts : 5/5 vitest GREEN
  public + no env                       -> null
  public + env tries to mark dogfood    -> null (fail-closed)
  dogfood + no env                      -> auto path under <dataDir>/runtime-diag/<id>.jsonl
  dogfood + memoization across calls    -> stable id
  public + memoization of null result   -> stable null

apps/vscode/src/sdk/dogfood-runtime-profile.test.ts     : 22/22 vitest GREEN
  (predecessor identity resolver; unchanged by this ACT)

apps/vscode/src/sdk/v2-capture.test.ts                  : 16/16 vitest GREEN
  (existing 16 tests; new auto-path branch is identity-gated so
   the public-install tests' "env unset -> capture disabled"
   expectation is preserved)

apps/vscode/src/sdk/sdk-interaction-coordinator.test.ts : 43/43 vitest GREEN
apps/vscode/src/sdk/sdk-controller-approval-capture.test.ts : 9/9 vitest GREEN

apps/vscode/webview-ui/.../TaskHeaderTelemetry.test.tsx : 36/36 vitest GREEN
apps/vscode/webview-ui/.../TaskHeader.test.tsx          : 8/8 vitest GREEN
tsc --noEmit (apps/vscode + webview-ui) : EXIT=0
biome lint (apps/vscode + webview-ui, scoped to changed files): clean
```

## Production code deltas (this commit)

```
A  apps/vscode/src/sdk/dogfood-diagnostic-profile.ts              (NEW: 145 lines)
A  apps/vscode/src/sdk/dogfood-diagnostic-profile.test.ts         (NEW: 165 lines)
A  apps/vscode/src/sdk/dogfood-runtime-capture-path.ts            (NEW: 99 lines)
A  apps/vscode/src/sdk/dogfood-runtime-capture-path.test.ts       (NEW: 41 lines)

M  apps/vscode/src/sdk/v2-capture.ts
   + resolveCapturePathForProfile() export (pure path discovery)
   + resolveCapturePath() now consults the auto-path as identity-gated
     fallback (rule 2 of three: user-set -> auto -> null)

M  apps/vscode/src/sdk/SdkController.ts
   + imports dogfood-diagnostic-profile + dogfood-runtime-capture-path
   + at SdkController.ts:486 inputShapeGate = (env-on || iProfile.i)
     (the existing I probe now also auto-enables in dogfood)
   + getStateToPostToWebview publishes
     diagnosticKnobs: { v, i, a, p }   (line ~3897)

M  apps/vscode/src/sdk/sdk-interaction-coordinator.ts
   + imports dogfood-diagnostic-profile + dogfood-runtime-capture-path
   + at sdk-interaction-coordinator.ts:478 ASK branch, noncommand path:
     emit approval.noncommand.result.v1
   + at sdk-interaction-coordinator.ts:544 after appendAndEmit:
     emit approval.noncommand.ui-published.v1
   (Both code points gated on the effective diagnostic profile's p knob
    - fail-closed in public even if CLINEMM_DIAG_APPROVAL_PUBLICATION_V2=1)

M  apps/vscode/src/shared/ExtensionMessage.ts
   + ExtensionState.diagnosticKnobs field
     { readonly v, i, a, p: boolean }

M  apps/vscode/webview-ui/src/components/chat/task-header/TaskHeader.tsx
   + diagnosticKnobs prop + propagation to TaskHeaderTelemetry
M  apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.tsx
   + diagnosticKnobs prop + indicator (data-testid=task-header-diagnostic-knobs)
     rendered ONLY when at least one knob is ON
```

## Header indicator contract

The TaskHeader indicator is `data-testid="task-header-diagnostic-knobs"` and renders the canonical-order letters (V -> I -> A -> P) joined into a short string:

```
All OFF (public):     (no indicator rendered)
V=ON only:            "V"
I=ON only:            "I"
A=ON only:            "A"
P=ON only:            "P"
V+I+P (initial dogfood): "VIP"     <-- the reviewer's directive
V+I+A+P (full):       "VIAP"
```

The `a` letter is rendered ONLY if the `CANCEL-AFFORDANCE-AUTHORITY-RECON` ACT lands its probe and flips the resolver's `a` knob. Until then, the resolver hard-codes `a = false`.

## Anti-conditions enforced (per reviewer)

1. **No manual env vars required** for normal dogfood qualification.
2. **Public install stays diagnostic-OFF** (C2 invariant pinned).
3. **A is not shown** (reviewer explicitly forbade).
4. **No editor-approval repair** (P probe only observes).

## P2 residue items closed in this commit (per reviewer)

1. **Stale "launcher source absent" prose in board row 19** — updated.
2. **`darwin-configuration.nix` retention wording inconsistent** —
   per reviewer P2, I delete the temporary copy at the repo root
   and remove the `/darwin-configuration.nix` ignore rule.

## Verification commands (replayable)

```bash
cd apps/vscode
bunx vitest run \
  src/sdk/dogfood-diagnostic-profile.test.ts \
  src/sdk/dogfood-runtime-capture-path.test.ts \
  src/sdk/dogfood-runtime-profile.test.ts \
  src/sdk/v2-capture.test.ts \
  src/sdk/sdk-interaction-coordinator.test.ts \
  src/sdk/sdk-controller-approval-capture.test.ts
# expected: 117 passed, 0 failed

cd apps/vscode/webview-ui
bunx vitest run \
  src/components/chat/task-header/TaskHeaderTelemetry.test.tsx \
  src/components/chat/task-header/TaskHeader.test.tsx
# expected: 44 passed, 0 failed

cd apps/vscode
bunx tsc --noEmit            # expected: EXIT=0
```

tsc --noEmit (apps/vscode + webview-ui) : EXIT=0
biome lint (apps/vscode + webview-ui, scoped to changed files): clean
```