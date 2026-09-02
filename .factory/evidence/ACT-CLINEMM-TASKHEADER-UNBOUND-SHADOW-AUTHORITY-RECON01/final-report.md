# ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01 — Final Report

## 1. ENTRY_HEAD / final HEAD

```
ENTRY_HEAD    = cb5b5223913e66688cc3f91dd4982b313878d908
RED_COMMIT    = cb6610f37 (recon + RED)
GREEN_COMMIT  = 6eaa0864 (strategy-bounded repair)
SUBJECT_HEAD  = 6eaa0864524fd60563277caa735351c90289bd52
```

## 2. Exact production selector/builder exercised

`selectTaskHeaderPresentation(input)` at
`apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts:505` (post-repair).
The pure selector is consumed by `SdkController.getStateToPostToWebview()` at
`apps/vscode/src/sdk/SdkController.ts:4104`, which is the single producer of
the wire-bound `taskHeaderPresentation` field.

The webview TaskHeader state label
(`apps/vscode/webview-ui/src/components/chat/task-header/taskHeaderTelemetryHelpers.ts:198`)
consumes this projection via
`taskHeaderStateLabel(taskHeaderPresentation, turnState)`.

The `activity.publication.v1` builder at
`apps/vscode/src/sdk/activity-publication-v1.ts:158-196` reads the same
projection as `taskHeaderPhase` / `taskHeaderSource` on the diagnostic wire.

## 3. Source-seam map

See `.factory/evidence/ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01/source-seam-map.md`
(185 lines, covers all 10 questions Q1-Q10).

| Surface                     | Producer                                                       |
|-----------------------------|----------------------------------------------------------------|
| `turnPhase`                 | `snapshot.turnState.phase` (TurnStateTracker)                  |
| `hostStatus`                | `shadow?.status` (ArbiterSnapshot)                             |
| `shadowPublicationBinding`  | `activity-publication-v1.ts:148` (literal "UNBOUND" whenever shadow !== undefined) |
| `taskHeaderSource`          | `selectTaskHeaderPresentation(input).source`                   |
| `taskHeaderPhase`           | `selectTaskHeaderPresentation(input).phase`                    |
| TaskHeader render           | `taskHeaderStateLabel(taskHeaderPresentation, turnState)`      |

UNBOUND mechanically means: `ArbiterSnapshot` carries no `stateVersion` /
`seq` field, so cross-binding to `snapshot.stateVersion` CANNOT be proven.
The selector does NOT distinguish UNBOUND shadow from fresh shadow — it
treats `canonicalShadowObservedTurnSeq === undefined` as "no observation
yet" and lets the shadow win. This is the bug.

## 4. RED

```
Command:
  bunx vitest run src/sdk/__tests__/task-header-unbound-shadow-authority.tusa01.test.ts

Failing assertion (TUSA01-RED):
  AssertionError: expected 'idle' not to be 'idle'
  ❯ src/sdk/__tests__/task-header-unbound-shadow-authority.tusa01.test.ts:112:25
  112|   expect(out.phase).not.toBe("idle")

Failing assertion (TUSA01-RED-SOURCE):
  AssertionError: expected true to be false
  128|   expect(isShadowGrantedAuthorityOverActive).toBe(false)
```

The RED inverts the LIVE contradiction:
- LIVE shows `taskHeaderPhase = "idle"`, `turnPhase = "streaming"`
- The RED asserts `out.phase !== "idle"` (the LIVE defect captured)
- HEAD FAILS the assertion (selector returns `idle`), confirming the
  production seam yields the LIVE-bug tuple.

GREEN after bounded repair: 8/8 tests PASS, 0 FAIL.

## 5. Classification

**CASE_A — SELECTOR AUTHORITY DEFECT** (proven by RED).

The production selector at `task-state-shadow-arbiter-mapper.ts:546-556`
explicitly lets an UNBOUND shadow (no `canonicalShadowObservedTurnSeq`)
override authoritative ACTIVE TurnState via rule 3 when the staleness gate
cannot fire.

Not CASE_B (shadow binding defect) because the controller wiring at
`SdkController.ts:4117-4122` is correct — it passes the
`getLocalShadowTurnSeqForPhase()` value when available. The defect is in
the selector's interpretation of `undefined`.

Not CASE_C (host status derivation defect) because `hostStatus` is a
shadow-derived field that is correctly classified as UNBOUND.

Not CASE_D (presentation-only defect) because the publication builder
correctly forwards `taskHeaderPresentation.phase` and `taskHeaderSource`
to the wire without transformation.

## 6. Bounded production delta

`apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts`:

```diff
+function isTerminalShadowPhase(phase: TurnPhase): boolean {
+    return phase === "idle" || phase === "completed" || phase === "error" || phase === "resumable"
+}
+
+function isActiveLegacyPhase(phase: TurnPhase): boolean {
+    return phase === "streaming" || phase === "awaiting_approval"
+}
+
 if (input.canonicalShadowPhase !== undefined) {
     const isShadowStale =
         input.canonicalShadowObservedTurnSeq !== undefined && input.seq > input.canonicalShadowObservedTurnSeq
+    const isUnboundDemotingActiveToTerminal =
+        input.canonicalShadowObservedTurnSeq === undefined &&
+        isTerminalShadowPhase(input.canonicalShadowPhase) &&
+        isActiveLegacyPhase(input.currentLegacyPhase)
-    if (!isShadowStale) {
+    if (!isShadowStale && !isUnboundDemotingActiveToTerminal) {
         return { phase: input.canonicalShadowPhase, source: "shadow", seq: input.seq }
     }
 }
```

Plus JSDoc updates documenting the new guard (no behavioral change).

Total: 78 insertions, 10 deletions across 3 files. No protocol/wire change.
No new public API. No removal of shadow support. No "always prefer TurnState"
blanket rule. No UI-only masking. REPAIR01-CORRECTION02's explicit-
staleness path is preserved unchanged.

## 7. GREEN + conservation results

### G1: Original LIVE-shaped RED becomes GREEN

```
TUSA01-RED:          PASS  (post-repair)
TUSA01-RED-SOURCE:   PASS  (post-repair)
```

### G2: idle/idle conservation remains GREEN

```
TUSA01-CTL_A:  PASS  (legacy=idle + UNBOUND shadow=idle -> phase=idle)
```

### G3: legitimate BOUND-shadow behavior remains GREEN

```
TUSA01-REG_FRESH_SHADOW_WINS:       PASS  (shadow with seq=obs wins)
TUSA01-REG_HOST_COMPACTING:         PASS  (host compaction override)
TUSA01-REG_HOST_AWAITING_FOLLOWUP:  PASS  (TCCC01-B1 host override)
TUSA01-REG_T9:                      PASS  (REPAIR01-CORRECTION02 T9 stale)
```

### G4: previous ACT tests remain GREEN

- 18/18 THCP01 PASS (THCP04, THCP08, SHADOW_NECESSITY reclassified to
  BOUND-shadow inputs)
- 27/27 TCR01 PASS (T14 inverted-to-fixed as the LIVE specimen shape)
- 4/4 CTA01 PASS
- 6/6 THCP11 PASS
- 12/12 RUNTIME-EPOCH-TRANSITION-ACTIVE-TURNSTATE-REPAIR01 PASS
- 8/8 TUSA01 PASS

**Total: 148/148 task-header-related tests PASS across 13 files.**

### G5: typecheck

```
apps/vscode check-types: 0 diagnostics.
```

### G6: git diff --check

```
git diff --check: PASS.
```

## 8. Evidence labels

| Label                  | Surface                                                       |
|------------------------|---------------------------------------------------------------|
| LIVE                   | LIVE TSWPD (epoch 16, streaming -> streaming) + LIVE activity publication (27546+: idle/streaming/idle/shadow/UNBOUND) |
| REAL_PRODUCTION_SEAM   | `selectTaskHeaderPresentation` at `task-state-shadow-arbiter-mapper.ts:505` exercised directly via the test file imports |
| SYNTHETIC_REAL         | LIVE-shape input token constructed from the captured publication tuple |
| STRUCTURAL             | n/a — the discriminator runs through real selector code, no source extraction |
| BOUND_SHADOW           | the helper-classifier cases (THCP04/THCP08/SHADOW_NECESSITY with explicit `canonicalShadowObservedTurnSeq`) |

## 9. Production delta count

- 78 insertions, 10 deletions across 3 files
- 1 production source file (task-state-shadow-arbiter-mapper.ts): +78/-2
- 2 test files (task-header-projection-coherence-repair01.tcr01.test.ts,
  task-state-shadow-task-header-presentation.thcp01.test.ts): +37/-8
- 1 new test file (task-header-unbound-shadow-authority.tusa01.test.ts):
  +226 (committed in RED commit, not changed in repair commit)

## 10. Working-tree state

```
$ git status --short
(empty)
```

## 11. Verdict

```
ROOT_CAUSE_ISOLATED    = YES
REPAIR_VERIFIED        = YES
REPAIR_STATUS          = APPLIED (Strategy-B bounded, ONE-AND-DONE)
STRATEGY               = UNBOUND-shadow demotion guard at rule 3
PRODUCTION_DELTA       = +78/-10 lines (3 files; 1 production source)
                        (RED commit + repair commit)
CLASSIFICATION         = CASE_A (selector authority defect)
REPAIR_AUTHORIZED      = YES (RED reproduced at production seam,
                             bounded semantic delta, all GREEN)
```
