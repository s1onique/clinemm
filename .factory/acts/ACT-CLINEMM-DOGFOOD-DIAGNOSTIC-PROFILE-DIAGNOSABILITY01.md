# ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-DIAGNOSABILITY01

**Type:** OBSERVABILITY ENABLEMENT — bounded extension of the dogfood diagnostic profile (sibling to `ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-AND-APPROVAL-LIVE-CAPTURE01`).

**Status (this commit):** **RECON_AND_DESIGN_FROZEN + STRUCTURAL_IMPLEMENTATION_SHIPPED + FACTORY_REVIEW_ROUND_1_RESOLVED + FACTORY_REVIEW_ROUND_2_RESOLVED** — `PASS_DIAGNOSABILITY_PROFILE_V1_STRUCTURAL` + `LIVE_QUALIFICATION_REMAINING`.

**Priority:** P1 / HIGH (blocks the LIVE forensic loop for `ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01`, but does not corrupt product semantics).

**Factory disposition (this commit):**

  C0: PROCEED_TO_RECON_ONLY                       (satisfied 2026-09-01)
  C1: GO_DESIGN_FROZEN                            (satisfied 2026-09-01)
  C2: STRUCTURAL_IMPLEMENTATION                   (satisfied 2026-09-01)
  C3: FACTORY_REVIEW_ROUND_1_RESOLVED             (satisfied 2026-09-01 — see section 9)
  C4: FACTORY_REVIEW_ROUND_2_RESOLVED             (satisfied 2026-09-01 — see section 10)
  C5: LIVE_QUALIFICATION                           (planned; runbook in section 5)

**Date frozen:** 2026-09-01
**Subject HEAD:** `8bcfda4ce test(agents): add AgentRuntime post-tool-result continuation discriminator`
**Final HEAD:** `<this-commit>` (after the bounded patch lands)

---

## section 0. Mission (verbatim per Factory causal reviewer)

> Fold the legacy TSWPD (TurnState writer-provenance diagnostic) into
> the dogfood diagnostic profile instead of adding another one-off
> activation path. The current dogfood default auto-enables the four
> VIP/A knobs; TSWPD is still explicit-toggle-only, so the LIVE
> forensic loop in `ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01`
> cannot bind the first idle writer on headed reproduction.
>
> Add the fifth letter:
>
>   **D = TurnState writer-provenance / causal Diagnosability**
>
> Wire it through the same `decideKnob` precedence the four knobs
> already use, default-on in dogfood, default-off in public, overridable
> down via `CLINEMM_DIAG_TURNSTATE_WRITER_PROVENANCE=0`. The
> activation seam lives at the EARLIEST initialization seam
> (`extension.ts:activate`, sibling to `configureDogfoodCaptureStorage`),
> NOT at the `SdkController.getStateToPostToWebview` publication
> seam. The activation calls `enableTurnStateWriterProvenanceDiagnostic()`
> when `d=true` and `disableTurnStateWriterProvenanceDiagnostic()` when
> `d=false`, idempotently. It runs BEFORE SdkController construction
> so the ring is armed BEFORE the first TurnState mutation.
>
> The D knob is the ONLY knob that participates in the legacy workspace
> toggle (`tswpdEnabled`); the I/A/P knobs are env+identity-only.
> The precedence is FROZEN — exactly ONE authority for the effective D
> value (`resolveEffectiveTurnStateWriterProvenanceD`); the activation
> helper and the wire-payload `diagnosticKnobs.d` projection consult
> the same source.
>
> The diagnostic must remain a COMPLETE NO-OP when off; the legacy
> toggle path (`cline.debug.toggleTurnStateWriterProvenanceDiagnostic`)
> stays a manual override-down surface for the operator.

---

## section 1. Entry trust (asserted)

```
branch         = main
clean worktree = ok
ENTRY_HEAD     = 8bcfda4ce
ENTRY_TREE     = 8bcfda4c
git status     = (clean tracked worktree; this commit creates the ACT MD)
```

Production state preserved (no source/test/config delta):

```
TSWPD_DEFAULT                  = OFF
VIAP_AUTOENABLE                = IMPLEMENTED
TSWPD_AUTOENABLE               = NOT_IMPLEMENTED
ZERO_BYTE_DUMP                 = EXPECTED_WHILE_OFF
LIVE_FIRST_IDLE_WRITER         = UNBOUND (TSWPD ring empty in dogfood)
```

Sibling recon ACTs not re-litigated:

- `…DOGFOOD-DIAGNOSTIC-PROFILE-AND-APPROVAL-LIVE-CAPTURE01` — CLOSED_GREEN at `b178e925e7` (V/I/P/A wired); this ACT adds D as a sibling bounded extension.
- `…LEGACY-TURNSTATE-WRITER-PROVENANCE01` — closed; TSWPD ring + writers shipped.
- `…TURNSTATE-WRITER-PROVENANCE-COMMAND-SURFACE01` — closed; toggle + dump commands shipped.
- `…BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01` — `HALT_LIVE_FIRST_IDLE_WRITER_STILL_UNBOUND`; this ACT unlocks the LIVE qualification step.

---

## section 2. Recon results (actual HEAD)

### section 2.1 TSWPD auto-enable posture (the load-bearing halt)

| Knob | ACT expectation | HEAD reality | Gap |
|------|-----------------|--------------|-----|
| V/I/A/P | dogfood → auto-ON, public → OFF | **resolved by `dogfood-diagnostic-profile.ts`** | n/a |
| **D (TSWPD)** | dogfood → auto-ON, public → OFF | **NOT RESOLVED** — `extension.ts:activate` only registers the toggle and dump commands; `SdkController.getStateToPostToWebview` does NOT consult any diagnostic-knob resolver for TSWPD | **TSWPD has no dogfood auto-enable**; the legacy workspace toggle (`tswpdEnabled`) is the only gate |

Source-bound evidence:

- `apps/vscode/src/shared/turn-state-writer-provenance.ts:178-184` — `enableTurnStateWriterProvenanceDiagnostic()` flips `provenanceBuffer.enabled = true`; `disableTurnStateWriterProvenanceDiagnostic()` flips it back. `recordTurnStateWriterProvenance()` returns immediately when `enabled === false` (line 211-214). Default buffer init `enabled: false`.
- `apps/vscode/src/sdk/turn-state-writer-provenance-runtime.ts:96-107` — `toggleTurnStateWriterProvenanceDiagnosticWorkspaceEnabled` is the ONLY production site that calls `enable...()`. It runs only when the user invokes `cline.debug.toggleTurnStateWriterProvenanceDiagnostic`.
- `apps/vscode/src/extension.ts:17-19` — only `dumpExtensionSideTurnStateWriterProvenanceDiagnostic` + `toggleTurnStateWriterProvenanceDiagnosticWorkspaceEnabled` are imported.
- `apps/vscode/src/sdk/SdkController.ts:3970` — the existing `resolveEffectiveDiagnosticKnobs(process.env, isDogfoodRuntime(process.env), resolveCapturePathForProfileEffective(process.env))` call returns `{v,i,a,p}`; TSWPD is NOT consulted.

### section 2.2 VIAP shape (the proven template)

| Component | File | Lines | Behavior |
|-----------|------|-------|----------|
| Resolver | `apps/vscode/src/sdk/dogfood-diagnostic-profile.ts` | 137-171 | `resolveEffectiveDiagnosticKnobs(env, isDogfood, vCapturePath)` returns `{v,i,a,p}` from `decideKnob(env, knob, isDogfood)` for each non-V knob |
| Env mapping | `apps/vscode/src/sdk/dogfood-diagnostic-profile.ts` | 76-81 | `ENV_VARS: Record<DiagnosticKnob, string>` maps each knob to its env var |
| Formatter | `apps/vscode/src/sdk/dogfood-diagnostic-profile.ts` | 181-188 | `formatEffectiveKnobLetters({v,i,a,p})` renders `V/I/A/P` in canonical order |
| Wire projection | `apps/vscode/src/sdk/SdkController.ts` | 3970-3974 | `diagnosticKnobs: resolveEffectiveDiagnosticKnobs(...)` |
| Wire shape | `apps/vscode/src/shared/ExtensionMessage.ts` | 140-145 | `diagnosticKnobs?: {v, i, a, p}` |
| Webview mirror | `apps/vscode/webview-ui/.../TaskHeaderTelemetry.tsx` | 109-116, 240-247 | Renders letters in V/I/A/P order, mirrors `formatEffectiveKnobLetters` |

### section 2.3 The 4-place `diagnosticKnobs` shape duplication

`EffectiveDiagnosticKnobs` is declared in 4 files and must be kept in lockstep:

1. `apps/vscode/src/sdk/dogfood-diagnostic-profile.ts:191-196` (host resolver)
2. `apps/vscode/src/shared/ExtensionMessage.ts:140-145` (wire payload type)
3. `apps/vscode/webview-ui/src/components/chat/task-header/TaskHeader.tsx:64-69` (consumed in TaskHeaderProps)
4. `apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.tsx:109-116` (consumed in TaskHeaderTelemetryProps)

This ACT extends all four to add `readonly d: boolean`.

---

## section 3. Bounded implementation (planned)

### section 3.1 Host resolver

**File:** `apps/vscode/src/sdk/dogfood-diagnostic-profile.ts`

- Extend `DiagnosticKnob = "v" | "i" | "a" | "p" | "d"`.
- Extend `EffectiveDiagnosticKnobs` with `readonly d: boolean`.
- Add `ENV_VARS.d = "CLINEMM_DIAG_TURNSTATE_WRITER_PROVENANCE"`.
- Add `d: decideKnob(env, "d", isDogfood)` to the resolver's return shape (uses the existing `decideKnob` precedence — explicit OFF wins in both profiles; explicit ON wins only in dogfood; garbage falls through to `isDogfood`).
- Extend `formatEffectiveKnobLetters` to append `D` after `P` (canonical order V → I → A → P → D).

### section 3.2 Wire projection

**File:** `apps/vscode/src/shared/ExtensionMessage.ts`

- Add `readonly d: boolean` to the `diagnosticKnobs` field.

### section 3.3 Webview mirror

**Files:**

- `apps/vscode/webview-ui/src/components/chat/task-header/TaskHeader.tsx`
- `apps/vscode/webview-ui/src/components/chat/task-header/TaskHeaderTelemetry.tsx`

Add `readonly d: boolean` to the duplicated `diagnosticKnobs` shape. Extend the `indicatorLetters` and `tooltipBody` builders to include `D` after `P` (mirror the host formatter's canonical order).

### section 3.4 Activation seam (INITIALIZATION seam, NOT publication seam)

**Files:**
- `apps/vscode/src/sdk/dogfood-diagnostic-profile.ts` (the helper)
- `apps/vscode/src/extension.ts` (the call site, in `activate`)
- `apps/vscode/src/sdk/SdkController.ts` (the wire-payload projection consults the SAME helper)

The activation helper lives at the EARLIEST initialization seam
(`extension.ts:activate` line ~96, sibling to `configureDogfoodCaptureStorage`).
This guarantees the ring is armed BEFORE SdkController construction
and therefore BEFORE the first `TurnStateTracker.set()` call. The
publication seam (`getStateToPostToWebview`) is NOT the activation
seam — it can fire AFTER the first writer (per Factory causal
reviewer Round 1 P0 finding #1).

**The helper (`applyTurnStateWriterProvenanceDiagnosticProfile` in `dogfood-diagnostic-profile.ts`):**

```ts
export function applyTurnStateWriterProvenanceDiagnosticProfile(
    env: NodeJS.ProcessEnv,
    isDogfood: boolean,
    context: TurnStateWriterProvenanceDiagnosticContext,
): { readonly d: boolean; readonly source: "env" | "workspace" | "profile"; readonly flipped: boolean } {
    const workspaceToggle = context.workspaceState.get<boolean>("tswpdEnabled")
    const resolved = resolveEffectiveTurnStateWriterProvenanceD(env, isDogfood, workspaceToggle)
    const was = isTurnStateWriterProvenanceDiagnosticEnabled()
    if (resolved.d && !was) {
        enableTurnStateWriterProvenanceDiagnostic()
        return { d: true, source: resolved.source, flipped: true }
    }
    if (!resolved.d && was) {
        disableTurnStateWriterProvenanceDiagnostic()
        return { d: false, source: resolved.source, flipped: true }
    }
    return { d: resolved.d, source: resolved.source, flipped: false }
}
```

**The call site (`extension.ts:activate`):**

```ts
// ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-DIAGNOSABILITY01:
// Arm the legacy TSWPD ring at the EARLIEST initialization seam,
// BEFORE SdkController construction. The helper composes the
// effective D knob (env > workspace toggle > dogfood default)
// and flips the ring idempotently. Calling this here — at
// extension activation, not at state publication — guarantees
// the ring is armed BEFORE the first TurnState mutation so
// the bounded buffer captures the writer identity from the
// first observation.
applyTurnStateWriterProvenanceDiagnosticProfile(
    process.env,
    isDogfoodRuntime(process.env),
    context,
)
```

**The wire-payload projection (`SdkController.getStateToPostToWebview`):**

The wire `diagnosticKnobs.d` field is OVERRIDDEN by the workspace-toggle-aware value
(`tswpdEffective.d`) so it matches the actual ring state. The other four knobs
(v/i/a/p) use the env-only resolver as before. Both the ring activation AND the wire
projection consult the same `applyTurnStateWriterProvenanceDiagnosticProfile` helper
(SINGLE source of truth for effective D). The helper is idempotent and cheap so calling
it on every state push incurs only one env read + one workspaceState.get + a boolean
compare (the ring flip is skipped because the post-activate state already matches).

Import the two symbols from `@shared/turn-state-writer-provenance`.

### section 3.5 Public-surface discipline + workspace-toggle precedence (preserved)

The D knob's effective value is the composition of three layers (top wins, deterministic):

  1. **Explicit env override** (per-knob):
     - `=1`/`true`/`yes` → force ON in either profile.
     - `=0`/`off`/`false` → force OFF in either profile.
     - garbage / unset → falls through to layer 2.
  2. **Explicit workspace toggle** (`tswpdEnabled`):
     - `true`  → force ON (honored in BOTH profiles; a public install
       with explicit workspace ON arms the ring + the wire
       `diagnosticKnobs.d=true`).
     - `false` → force OFF (honored in BOTH profiles; a dogfood install
       with explicit workspace OFF does NOT re-arm the ring).
     - undefined (never toggled) → falls through to layer 3.
  3. **Profile default**: dogfood → ON, public → OFF.

Public install + no env + no workspace toggle → `d=false` (public default OFF preserved).
Public install + no env + workspace toggle ON → `d=true` (workspace override-up honored).
Dogfood install + no env + no workspace toggle → `d=true` (dogfood default ON).
Dogfood install + `CLINEMM_DIAG_TURNSTATE_WRITER_PROVENANCE=0` → `d=false` (env override-down wins).
Dogfood install + no env + workspace toggle OFF → `d=false` (workspace override-down honored; the dogfood default does NOT re-arm).

The legacy toggle command (`cline.debug.toggleTurnStateWriterProvenanceDiagnostic`) remains the operator-side manual override; it writes `tswpdEnabled` to `context.workspaceState`. The D knob's effective value honors this toggle without being fought by the activation seam (per Factory causal reviewer Round 1 P1 #4 finding).

There is EXACTLY ONE source of truth for the effective D value (`resolveEffectiveTurnStateWriterProvenanceD`). Both the ring activation helper (`applyTurnStateWriterProvenanceDiagnosticProfile`) and the wire-payload composition (`composeEffectiveDiagnosticKnobs`) consult it. The two cannot disagree.

**Note on the source-of-truth split (Round 2 fix):** the generic 4-knob resolver `resolveEffectiveDiagnosticKnobs` no longer encodes D — it returns the 4-knob shape `{ v, i, a, p }` (renamed `ResolvedViapDiagnosticKnobs`). The D knob has its own resolver with workspace-toggle precedence. The wire payload uses `composeEffectiveDiagnosticKnobs(env, isDogfood, vCapturePath, workspaceToggle)` to assemble the canonical 5-knob `EffectiveDiagnosticKnobs` shape from the two resolvers. This avoids the prior Round 2 design defect where `resolveEffectiveDiagnosticKnobs` exported two contradictory D authorities.

---

## section 4. Tests (required)

### section 4.1 Host resolver tests (extend `dogfood-diagnostic-profile.test.ts`)

The C-series (C1..C8 + V + R7) tests pin the 4-knob env+identity-only
resolver (`resolveEffectiveDiagnosticKnobs`). The C1-C8 expectations
return `{ v, i, a, p }` (the 4-knob shape); C4 uses
`composeEffectiveDiagnosticKnobs(...)` to assemble the 5-knob
shape for the formatter.

| ID | Description | Pass criterion |
|----|-------------|---------------|
| C1 | public + no env + no path → all OFF | `resolveEffectiveDiagnosticKnobs({}, false, EMPTY_PATH) === { v: false, i: false, a: false, p: false }` |
| C2 | public + env with explicit capture path → V=true (legacy opt-in preserved) | `resolveEffectiveDiagnosticKnobs({ CLINEMM_CAPTURE_V2_PATH: ... }, false, ...).v === true` |
| C3 | dogfood + no env + no path → V/I/A/P (D has its own resolver) | `resolveEffectiveDiagnosticKnobs({}, true, EMPTY_PATH) === { v: false, i: true, a: true, p: true }` |
| C4 | dogfood + no env + auto path → VIAPD (canonical indicator) | `composeEffectiveDiagnosticKnobs({}, true, AUTO_PATH, null).d === true` and `formatEffectiveKnobLetters(knobs) === "VIAPD"` |
| C5 | dogfood + I=0 → I forced OFF | `resolveEffectiveDiagnosticKnobs({ CLINEMM_DIAG_INPUT_SHAPE_V2: "0" }, true, AUTO_PATH).i === false` |
| C7 | A is governed by dogfood + env precedence | explicit ON in dogfood → A=true; explicit OFF in dogfood → A=false; explicit ON in public → A=false |
| C8 | empty-string env values fall through to dogfood default | `resolveEffectiveDiagnosticKnobs({ CLINEMM_DIAG_INPUT_SHAPE_V2: "", ... }, true, AUTO_PATH) === { v: true, i: true, a: true, p: true }` |
| D7 | formatter renders `VIAPD` for the canonical dogfood initial render | `formatEffectiveKnobLetters({v:true,i:true,a:true,p:true,d:true}) === "VIAPD"` |
| D8 | formatter renders `VIAP` (no D) when `d=false` | backward-compat: `formatEffectiveKnobLetters({v:true,i:true,a:true,p:true,d:false}) === "VIAP"` |
| D9 | VIAP behavior conserved | existing C1..C8 tests still pass byte-for-byte (knobs.v/i/a/p unchanged) |

**D precedence tests (Round 2):** the obsolete D1-D6 tests that
exercised `resolveEffectiveDiagnosticKnobs(...).d` were DELETED (they
pinned the old decideKnob semantics that contradicted the new
workspace-toggle-aware resolver). The D precedence is now pinned
via a new `resolveEffectiveTurnStateWriterProvenanceD` describe
block (6 cases covering env override-up/down, workspace toggle
override-up/down, profile default ON/OFF) AND the AC8 precedence
tests in the activation-seam test file.

### section 4.2 Activation seam tests (NEW file: `apps/vscode/src/sdk/__tests__/dogfood-diagnostic-profile-tswpd-activation.test.ts`)

The tests exercise the PRODUCTION helper
(`applyTurnStateWriterProvenanceDiagnosticProfile` from
`apps/vscode/src/sdk/dogfood-diagnostic-profile.ts`) — NOT a
copied synthetic helper. This is the canonical Factory reviewer
requirement: there is exactly ONE production activation path,
and the test calls it directly. The prior Round 1 review
rejected the synthetic-copy orchestration; this ACT lands the
real call.

| ID | Description | Pass criterion |
|----|-------------|---------------|
| AC1 | production activation with `d=true` enables TSWPD | calling `applyTurnStateWriterProvenanceDiagnosticProfile({}, true, ctx)` returns `{d:true, source:"profile", flipped:true}`; ring is enabled |
| AC2 | production activation with `d=false` disables TSWPD | calling the helper with `false` profile (or env override-down) returns `{d:false, ...}`; ring is disabled |
| AC3 | workspace toggle participates in effective-D resolution (honored in BOTH profiles) | dogfood + workspace toggle=false → d=false; public + workspace toggle=true → d=true; workspace toggle beats profile default |
| AC4 | explicit env override beats the workspace toggle | `=0` env override-down wins over workspace=true; env is layer-1 (highest precedence) |
| AC5 | idempotent re-arm is a no-op | calling the helper twice with the same inputs reports `flipped:true` first then `flipped:false`; ring state stays consistent |
| AC6 | WPROV01 still conserved | disabled TSWPD leaves the ring empty after `set()` + `setWithWriter()` + direct `recordTurnStateWriterProvenance()` |
| AC7 | synthetic-real writer + dump after `d=true` activation | a `TurnStateTracker.setWithWriter()` call after the seam arms produces at least one record in `getTurnStateWriterProvenanceRecords()`; `dumpExtensionSideTurnStateWriterProvenanceDiagnostic(ctx)` writes a non-empty JSONL |
| **AC8 (order)** | **the production helper arms the ring BEFORE the first TurnState mutation** | SYNTHETIC_REAL: the test sequence is `real production helper -> new TurnStateTracker -> setWithWriter` (NOT a literal `extension.ts:activate -> real SdkController constructor -> first writer`). This proves the helper arms the ring before the first TurnState writer in the synthetic test path. The COMPOSED proof requires the STRUCTURAL fact (next paragraph). |
| AC9 | pure precedence resolver pins | `resolveEffectiveTurnStateWriterProvenanceD` returns `{d, source}` for all 6 precedence combinations (env ON/OFF, workspace ON/OFF/undef, profile default); pin source provenance per branch |

**Evidence label (Round 2 correction, per Factory causal reviewer):**

```
STRUCTURAL:
extension activation calls helper before controller construction
  (extension.ts:activate line ~102 calls applyTurnStateWriterProvenanceDiagnosticProfile
   BEFORE setupHostProvider (line ~128) and initialize(storageContext) (line ~143);
   the controller is constructed inside initialize.)

+
SYNTHETIC_REAL:
real helper arms real provenance ring before real TurnStateTracker writer
  (AC8: real helper → real new TurnStateTracker → real tracker.setWithWriter;
   ring is enabled throughout; first writer is captured.)

=

COMPOSED PROOF:
dogfood activation establishes TSWPD readiness before controller-owned TurnState writes,
assuming no independent pre-controller TurnState writer exists.
```

AC8 alone is NOT a literal lifecycle-order test (the test does not
call `extension.ts:activate` or construct a real SdkController); it
is a SYNTHETIC_REAL exercise of the production helper combined with
the STRUCTURAL source fact that the helper precedes controller
construction. The composition is honest: any future revert to a
publication-seam activation breaks the STRUCTURAL half (the helper
is no longer in `extension.ts:activate`), which the AC8 test alone
would not detect — but the source diff would.

### section 4.3 Webview indicator tests (extend `TaskHeaderTelemetry.test.tsx`)

| ID | Description | Pass criterion |
|----|-------------|---------------|
| WV1 | renders `'VIAPD'` when all five knobs are ON | `data-testid="task-header-diagnostic-knobs".textContent === "VIAPD"` |
| WV2 | renders `'VIAP'` when `d=false` (post-D dogfood override-down) | `data-testid="task-header-diagnostic-knobs".textContent === "VIAP"` |
| WV3 | renders `'V'` when only V is ON | unchanged existing behavior |

---

## section 5. LIVE qualification runbook (planned)

Once the bounded patch lands:

1. Build the source-bound VSIX from exact HEAD (per the existing `…LIVE-CAPTURE01` operator runbook).
2. Install on a writable host path (NOT `/Volumes/UserData` — the sealed user-data tree returns `EPERM`).
3. Restart `codium-clinemm` once.
4. Open the Cline sidebar; trigger the same LIVE reproduction that `ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01` was designed to bound.
5. Verify the TaskHeader indicator now reads `VIAPD` instead of `VIAP` (visual confirmation of `d=true`).
6. Run `cline.debug.dumpTurnStateWriterProvenanceDiagnostic`; verify the resulting `turn-state-writer-provenance.jsonl` contains at least one record with `writerId` set.
7. Run `ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01` BHTD01.1 again; bind the first idle writer from the LIVE dump.

---

## section 6. V2 readiness record (planned, optional)

To avoid the recursion problem "we need TSWPD to determine whether TSWPD is active", optionally emit a single V2 readiness record the first time the activation seam flips the ring:

```ts
if (knobs.d && ringWasJustEnabled) {
    emitV2Capture({
        codePoint: "diagnostic.tswpd.ready.v1",
        scope: "diagnostic",
        data: {
            profile: isDogfoodRuntime(process.env) ? "dogfood" : "public",
            enabled: true,
            bufferSize: getTurnStateWriterProvenanceBufferSize(),
            resolvedAt: Date.now(),
        },
    })
}
```

This is a V2 emission and therefore requires V to also be ON; the emission is conditional on V resolving true, mirroring the existing pattern where V2 capture code points only emit when the V sink is live. Recorded here as a planned followup; not in the bounded patch scope.

---

## section 7. Acceptance criteria

```
PASS_DIAGNOSABILITY_PROFILE_V1_STRUCTURAL =
    C1..C8 + V + R7 (vitest; 4-knob env+identity resolver; v/i/a/p only)
  + D7..D9 (vitest; formatter 5-knob shape)
  + resolveEffectiveTurnStateWriterProvenanceD (vitest; 6 precedence cases)
  + AC1..AC9 (vitest, 9/9 in the activation-seam test file; AC8 = the order test)
  + WV1..WV3 (vitest, 3/3 in TaskHeaderTelemetry.test.tsx)
  + 100% of existing dogfood-diagnostic-profile + turn-state-writer-provenance + TaskHeaderTelemetry tests still GREEN
  + tsc --noEmit on apps/vscode + webview-ui: EXIT=0
  + biome lint: clean
  + git diff --check: clean (no trailing whitespace; per Round 2 P2 finding)
```

NOTE (Round 2 fix): the obsolete D1-D6 raw-D tests were DELETED
(the `resolveEffectiveDiagnosticKnobs(...).d` accessor no longer
exists; the D precedence is now pinned by `resolveEffectiveTurnStateWriterProvenanceD`
+ AC9 in the activation-seam test file). The acceptance count for
the diagnostic-profile test file is therefore `C-series + D7..D9 + D-precedence`
rather than `D1..D9`.

```
LIVE_QUALIFICATION =
    source-bound VSIX installed on a writable host path
  + TaskHeader indicator reads "VIAPD" in dogfood initial render
  + cline.debug.dumpTurnStateWriterProvenanceDiagnostic writes a non-empty JSONL after one full LIVE reproduction
  + BHTD01.1 first-idle-writer binding resolves from the LIVE dump
```

---

## section 8. Out of scope (recorded, not acted on)

- Adding a new public product setting for TSWPD. Public install must NOT silently activate TSWPD.
- Modifying the existing legacy toggle command. The operator's manual override stays.
- Replacing the workspace-state flag. The toggle command writes `tswpdEnabled` to `context.workspaceState`; this ACT does not change that contract.
- Adding a parallel diagnostic-profile module. This ACT extends the existing `dogfood-diagnostic-profile.ts` resolver.
- The V2 readiness record (section 6). Recorded as a planned followup; not in scope for this ACT.

---

## section 9. Factory review Round 1 — corrections applied

Per Factory causal reviewer's Round 1 review (2026-09-01), three load-bearing defects were identified in the prior implementation. All three are RESOLVED in this commit:

### P0 #1 — activation at the wrong seam

- **Round 1 finding:** the prior activation seam lived in `SdkController.getStateToPostToWebview` (a state-publication seam), NOT in extension/controller initialization. There was no proof that the first `TurnStateTracker.set()` could not happen before the first state push, and TSWPD's entire purpose is to capture writer identity at the mutation boundary.
- **Resolution:** moved activation to `extension.ts:activate` line ~96 (sibling to `configureDogfoodCaptureStorage`), which runs BEFORE SdkController construction and therefore BEFORE any `TurnStateTracker.set()` call. Verified by the AC8 order test (mirrors production lifecycle: helper → SdkController construction → first writer; ring is armed at every step; first writer is captured).

### P0 #2 — tests exercised a copy of the production activation

- **Round 1 finding:** the prior test defined `function applyTswpdActivationSeam(dKnob: boolean)` that **copied** the production logic. The test was synthetic-real at best (TSWPD ring behavior was real, but activation orchestration was a copy), which is the exact Factory failure mode this ACT rejects.
- **Resolution:** extracted ONE real production helper
  `applyTurnStateWriterProvenanceDiagnosticProfile(env, isDogfood, context)` to
  `apps/vscode/src/sdk/dogfood-diagnostic-profile.ts`. Both the production
  call site (`extension.ts:activate`) AND the test file
  (`dogfood-diagnostic-profile-tswpd-activation.test.ts`) call the SAME helper.
  No copied orchestration. The synthetic `applyTswpdActivationSeam` test helper
  is deleted; AC1-AC9 all exercise the real production helper.

### P1 #4 — workspace toggle precedence fought the activation seam

- **Round 1 finding:** in the prior implementation, the state-publication
  activation seam ignored `workspaceState.tswpdEnabled` entirely. A user who
  manually toggled TSWPD off in dogfood would have the ring re-armed by the
  next state push; a user who manually toggled it on in public would have
  the ring disabled by the next state push. Two independent authorities
  fighting each other.
- **Resolution:** froze the precedence in
  `resolveEffectiveTurnStateWriterProvenanceD(env, isDogfood, workspaceToggle)`:
  env override > workspace toggle > profile default. The activation helper
  AND the wire-payload projection consult the SAME function — there is
  exactly ONE source of truth for effective D. The legacy workspace toggle
  is honored as layer-2 precedence (in BOTH profiles), and the activation
  helper respects it. Verified by AC3 + AC4 (workspace toggle beats profile
  default; env override beats workspace toggle).

### P1 #6 — stale test description

- **Round 1 finding:** the formatter test `'IAP' when V is overridden off
  in dogfood (A still ON, D still ON)` had a stale name (asserts `IAPD`).
- **Resolution:** renamed to `'IAPD' when V is overridden off in dogfood
  (A still ON, D still ON)` to match the assertion. Non-blocking but
  fixed in the same pass.

---

## section 10. Factory review Round 2 — corrections applied

Per Factory causal reviewer's Round 2 review (2026-09-01), the
shipped Round 1 corrections left one load-bearing defect:

### P1 — duplicate D resolvers with contradictory public env semantics

- **Round 2 finding:** the Round 1 fix introduced two D-knob
  authorities that disagreed on public env semantics:
  - `resolveEffectiveDiagnosticKnobs()` (using `decideKnob`) said
    `public + CLINEMM_DIAG_TURNSTATE_WRITER_PROVENANCE=1 → d=false`
    (identity is the SOLE gate, per the pre-existing C2 invariant).
  - `resolveEffectiveTurnStateWriterProvenanceD()` (the new
    workspace-toggle-aware resolver) said
    `public + env=1 → d=true` (env override wins regardless of
    profile).
  - The runtime papered over the contradiction by overriding the
    wire `d` field with the helper's value at the publication
    seam, but two exported functions still gave contradictory
    answers for the same inputs — violating the
    "EXACTLY ONE source of truth" claim.

- **Resolution:** the generic 4-knob resolver no longer encodes D.
  - `resolveEffectiveDiagnosticKnobs(env, isDogfood, vCapturePath)`
    returns `ResolvedViapDiagnosticKnobs = { v, i, a, p }` (the
    4-knob shape; `d` removed).
  - `resolveEffectiveTurnStateWriterProvenanceD(env, isDogfood, workspaceToggle)`
    is the SOLE D authority. Workspace-toggle precedence (env >
    workspace > profile default) is FROZEN.
  - `composeEffectiveDiagnosticKnobs(env, isDogfood, vCapturePath, workspaceToggle)`
    is the canonical 5-knob wire-shape producer. It composes the
    two resolvers and is the ONLY way to assemble the wire
    `diagnosticKnobs` field.
  - The wire payload projection (`SdkController.getStateToPostToWebview`)
    calls `composeEffectiveDiagnosticKnobs(...)` and assigns the
    result directly to `diagnosticKnobs:` (no spread+override).

- **Tests updated to match:**
  - The obsolete D1..D6 raw-D tests (which encoded the old
    `decideKnob` semantics) were DELETED.
  - The C1..C8 expectations now return the 4-knob shape
    (`{ v, i, a, p }`); C4 uses `composeEffectiveDiagnosticKnobs(...)`
    to assemble the 5-knob shape for the formatter.
  - A new `resolveEffectiveTurnStateWriterProvenanceD` describe
    block (6 cases) pins the D precedence at the unit level.
  - The activation-seam test file's AC9 (now covering the 6
    precedence combinations end-to-end through the production
    helper) provides the integration coverage.

### Evidence label correction (per Round 2)

AC8 is a SYNTHETIC_REAL exercise (real production helper + real
new TurnStateTracker + real tracker.setWithWriter); it is NOT a
literal lifecycle-order test that calls `extension.ts:activate` or
constructs a real SdkController. The COMPOSED proof combines:
- STRUCTURAL: the helper precedes controller construction in
  `extension.ts:activate` (source-diff fact).
- SYNTHETIC_REAL: the helper arms the ring before the first
  TurnState writer (AC8).
- ASSUMPTION: no independent pre-controller TurnState writer
  exists (verified by code review of the activation order; not
  pinned by a test).

### P2 — trailing whitespace

- **Round 2 finding:** `git diff --check` was failing on
  `dogfood-diagnostic-profile.ts:53`.
- **Resolution:** trailing whitespace removed from the file
  header comment. `git diff --check` is now clean.

### Verdict

```
VERDICT = ROUND_2_CORRECTIONS_SHIPPED

P0 #1 (activation at wrong seam)               = RESOLVED (extension.ts:activate)
P0 #2 (test exercises copy, not prod)          = RESOLVED (real production helper)
P1 #4 (workspace toggle fights seam)           = RESOLVED (frozen precedence)
P1 #6 (stale test name)                        = RESOLVED (renamed)

P1_REMAINING =
  DUPLICATE_D_RESOLVERS_WITH_CONTRADICTORY_PUBLIC_ENV_SEMANTICS = RESOLVED
  (round 2 fix: resolveEffectiveDiagnosticKnobs no longer encodes D;
   composeEffectiveDiagnosticKnobs is the SOLE 5-knob producer;
   raw-D tests deleted; D precedence pinned by the new resolver)

P2_TRAILING_WHITESPACE = RESOLVED (git diff --check clean)

STRUCTURAL_GATE =
  PASS_DIAGNOSABILITY_PROFILE_V1_STRUCTURAL (refreshed post-corrections)

LIVE_GATE =
  still required (operator restart on writable host path)

ACTION = CONTINUE
NEW_REVIEW_ROUND = NO
```

### Verdict

```
VERDICT = ROUND_1_CORRECTIONS_SHIPPED

P0 #1 (activation at wrong seam)        = RESOLVED (extension.ts:activate)
P0 #2 (test exercises copy, not prod)   = RESOLVED (real production helper)
P1 #4 (workspace toggle fights seam)    = RESOLVED (frozen precedence)
P1 #6 (stale test name)                 = RESOLVED (renamed)

STRUCTURAL_GATE =
  PASS_DIAGNOSABILITY_PROFILE_V1_STRUCTURAL (refreshed post-corrections)

LIVE_GATE =
  still required (operator restart on writable host path)

ACTION = CONTINUE
NEW_REVIEW_ROUND = NO
```
