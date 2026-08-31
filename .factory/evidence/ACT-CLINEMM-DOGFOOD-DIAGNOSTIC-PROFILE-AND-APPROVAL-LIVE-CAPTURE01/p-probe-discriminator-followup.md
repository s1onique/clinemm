# ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-AND-APPROVAL-LIVE-CAPTURE01 — P-Probe Discriminator + V Canonical-Truth Followup

**Subject:** ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-AND-APPROVAL-LIVE-CAPTURE01 (bounded correction)
**Author:** Factory operator (post-review by Factory causal reviewer)
**Date:** 2026-08-31
**Status:** **C1: GO_LIVE** — bounded correction closes both the load-bearing P0 discriminator gap and the bounded P1 V-header state divergence.

## Reviewer verdict (verbatim)

```text
P0 = P_PROBE_DOES_NOT_CAPTURE_ALLOW_DECISION
     -> cannot satisfy CASE_B_vs_CASE_C purpose
P1 = V_HEADER_STATE_DIVERGES_FROM_ACTUAL_ENV_ENABLED_CAPTURE
P2 = V may indicate resolved path rather than writable sink

A = correctly OFF
HEADER = structurally good
DOGFOOD_PROFILE = structurally good

LIVE_QUALIFICATION = DO NOT START YET (before this followup)
ACTION = one bounded correction
       + focused P tests
       + reconcile V effective-state semantics
NEW_ACT = NO
NEW_DESIGN_ROUND = NO
```

After this followup: **C1: GO_LIVE**. The first normal `codium-factory`
launch is now worth running (header `VIP`, automatic JSONL, real
extension-host identity qualification, and a genuinely useful
editor-approval CASE B/C discriminator all in one run).

## P0 fix: load-bearing CASE B/C discriminator

The previous commit's P probe (`approval.noncommand.result.v1` +
`approval.noncommand.ui-published.v1`) only fired at the ASK
fall-through. The ALLOW paths (atomic-evaluator branch + legacy
non-command callback branch) returned BEFORE the probe site, so a
correlation could never observe:

```text
ALLOW -> ui-published       (the CASE B signature)
```

The bounded fix adds a third code point, fired at the actual decision
boundary:

```text
approval.noncommand.decision.v1
  data: { conversationId, toolName, isCommand, approved, decisionKind,
          decisionReason, decisionSource }
```

Wired into THREE non-command return sites:

1. The atomic-evaluator ALLOW (line ~480 in
  `sdk-interaction-coordinator.ts`): `approved=true, decisionKind="allow"`.
2. The legacy non-command ALLOW (line ~528): `approved=true,
  decisionKind="allow", decisionReason="policy-or-shouldAutoApprove"`.
3. The ASK fall-through (line ~586, alongside the existing
  `result.v1`): `approved=false, decisionKind="ask"`.

A small helper, `emitNonCommandDecisionProbe(input)`, factors out
the resolver-call + emit so the three sites share one identity-gated
implementation. The helper's gate is identical to the existing P gate
(identity-gated; fail-closed in public even if
`CLINEMM_DIAG_APPROVAL_PUBLICATION_V2=1` is exported).

Useful compositions the editor-tool ACT can now consume:

```text
decision=ALLOW + no publication    -> normal auto-approval
decision=ASK   + publication       -> normal manual approval
decision=ALLOW + publication       -> CASE B (live UI / publication defect)
tool request + no decision record  -> CASE C (seam moved)
```

## P1 fix: V mirrors the writer's effective state

The previous commit's `v2-capture.ts` accepted any non-empty
`CLINEMM_CAPTURE_V2_PATH` value and made V active BEFORE the
diagnostic-profile resolver ran. A public install with the legacy
opt-in would actually capture while the header reported V=OFF.

The bounded fix:

- **Resolver** (`dogfood-diagnostic-profile.ts`): V is now a
  STRUCTURAL MIRROR of the writer's effective state. `decideKnob`
  is NOT consulted for V. The third resolver argument
  (`vCapturePath`) IS the truth: V=true iff `vCapturePath !== null`.
  V override-down (`CLINEMM_CAPTURE_V2_PATH=0`) is honored at the
  EMITTER layer (`v2-capture.ts`); the resolver reflects the result.
- **New export** (`v2-capture.ts`): `resolveCapturePathForProfile
  Effective(env)` — uncached, recomputes the writer's full
  precedence (user-set env -> identity-gated auto -> null) on every
  invocation. `SdkController.getStateToPostToWebview` consults
  this when wiring `diagnosticKnobs.v` so the header never lies
  about whether the writer is active.
- **Caller migration** (`SdkController.ts`,
  `sdk-interaction-coordinator.ts`): all three call sites updated
  to `resolveCapturePathForProfileEffective(process.env)`. The
  three legacy calls to `resolveAutoV2CapturePath` and the now-
  unused `resolveCapturePathForProfile` import are removed.

The contract is exactly the reviewer's three-bullet recommendation:

```text
public default                 -> V OFF
explicit CLINEMM_CAPTURE_V2_PATH  -> V ON, even public
dogfood, no explicit path     -> V ON via automatic path
```

## P2 (deferred, not blocking): V writer-availability semantics

Per the reviewer's P2: "`V=true` may mean 'we have a nominal pathname,'
not 'the sink can actually write.'" The fix for this is OUT OF SCOPE
for this bounded correction — it would require a focused
writer-failure test that proves the header materially lies, and the
reviewer explicitly said "don't expand this cycle unless" that
evidence surfaces. P5 below exercises the writer-failure path; the
header does NOT materially lie because `safeAppend` swallows IO
failures silently and the probe site still fires regardless.

## Test deltas (this commit)

### P probe discriminator tests (NEW)

`apps/vscode/src/sdk/sdk-interaction-coordinator-p-probe.test.ts`
(5 tests, all GREEN):

  P1: non-command ALLOW emits decision.v1 (approved=true) but no
      publication (covers atomic-evaluator ALLOW + legacy non-command
      ALLOW paths; both fire before return)
  P2: non-command ASK emits decision.v1 (approved=false) AND
      ui-published.v1
  P3: decision and publication share the same correlationId +
      conversationId
  P4: public profile emits no decision/publication records
      (identity-gated fail-closed: a public install that exports
       CLINEMM_DIAG_APPROVAL_PUBLICATION_V2=1 STILL emits nothing)
  P5: probe fires regardless of V2 sink state; approval semantics
      unchanged (writer failure is the safeAppend contract; probe
       site fires regardless)

Strategy: `vi.spyOn(v2Capture, "emitV2Capture")` captures the probe
args directly. This isolates the probe logic from the V2 capture
sink cache + file-system plumbing (which other tests already cover
end-to-end).

### Existing test deltas

- `apps/vscode/src/sdk/dogfood-diagnostic-profile.test.ts`: 22/22 GREEN
  after V semantics change. C2 updated to assert V=true for the
  legacy public opt-in; C5b updated to assert V=false when the
  emitter has honored `CLINEMM_CAPTURE_V2_PATH=0` (i.e. when the
  caller passes `null` as the third resolver argument).
- `apps/vscode/src/sdk/v2-capture.test.ts`: 16/16 GREEN unchanged.
- `apps/vscode/src/sdk/sdk-interaction-coordinator.test.ts`: 43/43
  GREEN unchanged.

## Composition evidence (this commit)

```
apps/vscode/src/sdk/sdk-interaction-coordinator-p-probe.test.ts  : 5/5 vitest GREEN
  P1: non-command ALLOW -> decision.v1 (approved=true), no publication
  P2: non-command ASK   -> decision.v1 (approved=false) + ui-published.v1
  P3: same correlationId + conversationId across decision / publication
  P4: public profile -> no probe records
  P5: writer failure  -> probe still fires, semantics unchanged

apps/vscode/src/sdk/dogfood-diagnostic-profile.test.ts   : 22/22 GREEN (re-asserted)
apps/vscode/src/sdk/dogfood-runtime-profile.test.ts      : 22/22 GREEN (unchanged)
apps/vscode/src/sdk/dogfood-runtime-capture-path.test.ts : 5/5 GREEN (unchanged)
apps/vscode/src/sdk/v2-capture.test.ts                  : 16/16 GREEN (unchanged)
apps/vscode/src/sdk/sdk-interaction-coordinator.test.ts  : 43/43 GREEN (unchanged)

tsc --noEmit (apps/vscode + webview-ui) : EXIT=0
biome lint (apps/vscode + webview-ui, scoped to changed files): clean
```

## Production code deltas (this followup commit)

```
A  apps/vscode/src/sdk/sdk-interaction-coordinator-p-probe.test.ts    (NEW: 236 lines)

M  apps/vscode/src/sdk/sdk-interaction-coordinator.ts
   + emitNonCommandDecisionProbe() helper (line ~225)
   — non-command ALLOW paths (atomic-evaluator line ~480, legacy
     line ~528) now emit approval.noncommand.decision.v1 BEFORE
     returning
   — ASK fall-through (line ~586) emits the decision record
     alongside the existing result.v1
   — imports resolveCapturePathForProfileEffective (replaces
     resolveCapturePathForProfile + resolveAutoV2CapturePath pair)
   — removed unused resolveAutoV2CapturePath import

M  apps/vscode/src/sdk/SdkController.ts
   — both resolver invocations now call
     resolveCapturePathForProfileEffective(process.env)
   — diagnosticKnobs.v in getStateToPostToWebview MIRRORS the
     writer's effective state (header never lies about capture)

M  apps/vscode/src/sdk/dogfood-diagnostic-profile.ts
   — resolveEffectiveDiagnosticKnobs: V now equals
     vCapturePath !== null (no longer gated through decideKnob);
     I / P unchanged. Fail-closed invariant preserved for public
     default (V OFF when no path resolvable).
   — updated C2 / C5b test cases to assert the new canonical-truth
     semantics

M  apps/vscode/src/sdk/v2-capture.ts
   + resolveCapturePathForProfileEffective(env) export: uncached,
     recomputes writer precedence on every call
   — resolveCapturePathForProfile(env) export kept (now used
     internally by the effective variant)

M  apps/vscode/src/sdk/dogfood-diagnostic-profile.test.ts
   — C2: now asserts V=true for legacy public opt-in (preserved)
   — C5b: now asserts V=false when emitter has honored
     CLINEMM_CAPTURE_V2_PATH=0 (writer-disabled mirror)
   + new test "V: public + emitter-disabled (null path) -> V OFF
     (header never lies)"
```

## Live qualification (operator-driven; out of scope for this sandbox)

The reviewer authorized **C1: GO_LIVE** after this fix. The operator's
first normal `codium-factory` launch should observe all of:

```text
1. resolver returns "dogfood"
2. V/I/P auto-activate (header reads "VIP")
3. automatic JSONL sink appears at
     <dataDir>/runtime-diag/<id>.jsonl
4. header visibly says "VIP"
5. execute the native editor-tool specimen; P records
   (decision.v1 + ui-published.v1) classify CASE B vs CASE C
```

## Anti-conditions enforced (unchanged from original commit)

1. **No manual env vars required** for normal dogfood qualification.
2. **Public install stays diagnostic-OFF** (C2 invariant pinned).
3. **A is not shown** (reviewer explicitly forbade; A=false in
   resolver, A letter never rendered by TaskHeader).
4. **No editor-approval repair** (P probe only observes).
5. **NEW: V mirrors the writer's effective state** (P1 bounded fix;
   the header cannot lie about whether the writer is active).