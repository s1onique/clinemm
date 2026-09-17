# Causal classification — ACT-CLINEMM-RUNTIME-TASK-HEADER-PROJECTION-COHERENCE-REPAIR01

## Locked: **CASE_D — INDEPENDENT AUTHORITY GENERATION SKEW**

Two production authorities are individually valid but carry
unrelated generation/sequence identifiers, and they are composed at
publication time without any coherence enforcement.

## Evidence

### Source-recon pointers (from `source-seam-trace.md`)

| Authority         | Field                              | Generator                           |
| ----------------- | ---------------------------------- | ----------------------------------- |
| `turnState`       | `phase` / `seq`                    | `TurnStateTracker.setWithWriter()`  |
| shadow projection | `canonicalShadowPhase` (string)   | `taskStateShadowWiring.getLastObservedShadowPhase()` |
| shadow seq        | (none — selector ignores it)       | `taskStateShadowWiring` internal    |

The selector at `apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts:435-474`
consumes `currentLegacyPhase` and `canonicalShadowPhase` but does
NOT consult any shadow-side seq. The projection stamped into the
publication carries the legacy `seq`, so the webview stale-push
fence can detect cross-epoch staleness but NOT cross-authority skew
on the same epoch.

### Why the other cases are excluded

- **CASE_A — STALE SHADOW INPUT**: considered first. The shadow is
  not "given stale input" — it correctly observes every event the
  canonical transport delivers. The defect is in the SELECTOR's
  treatment of the (correctly observed) shadow projection. ❌
- **CASE_B — MAPPER DEFECT**: the mapper produces the output its
  three-source precedence specifies. The defect is in the
  precedence itself (it allows the shadow to win without
  staleness checking), not in the mapper's branch logic. ❌
- **CASE_C — STALE PROJECTION SELECTION**: the snapshot builder
  does not select among multiple projections; it calls the
  selector exactly once per publication. ❌
- **CASE_D — INDEPENDENT AUTHORITY GENERATION SKEW**: fits. The
  two authorities carry unrelated generations (legacy: `seq` from
  `MessageIdMinter`; shadow: `seq` from the comparator). They are
  composed at publication time without any generation comparison.
  The shadow's "last observation" can be arbitrarily older than
  the legacy's "last transition". ✓
- **CASE_E — INVALID CONTRACT**: no contract explicitly permits
  the contradiction; no contract explicitly forbids it. The
  contract's silence on cross-authority coherence IS the bug. �

### Production code that documents the smell

`apps/vscode/src/sdk/task-state-shadow-host-wiring.ts:419-423` (in
the existing comment for `getLastObservedShadowPhase()`) explicitly
documents the prior failure mode that this ACT's repair targets:

```text
// Reading the record's `shadowPhase` produced the LIVE
// contradiction where a freshly-running task (shadow
// `streaming`) was published as `taskHeaderPresentation.phase
// = "idle"` for any state that agreed with the legacy
// mirror.
```

The repair extends this lineage by introducing a generation
comparison between the shadow's last observation seq and the
legacy tracker's last transition seq.

## Repair design (per CASE_D)

The minimal change that enforces cross-authority coherence is:

1. Add `canonicalShadowSeq?: number` to `TaskHeaderPresentationInputs`
   and `ThinkingPresentationInputs`.
2. Add a precedence gate: when
   `canonicalShadowSeq !== undefined && seq > canonicalShadowSeq`,
   the shadow is STALE → fall through to the legacy branch.
3. Expose `getLastObservedShadowSeq(): number | undefined` on the
   wiring's `TaskShadowHostWiringWithSink` interface (active and
   no-op).
4. Expose `debugObservedSeq(): number` on `TaskShadowComparator`.
5. Wire the seq at the two call sites in `SdkController.ts` via a
   new `getLocalShadowSeq()` accessor.

This is the bounded one-input-parameter-one-branch fix the ACT
body's §6 enumerates as the preferred repair surface.

## RED reproduction (per `red-report.md`)

The three RED failures in `tcr01.test.ts` reproduce the LIVE
contradiction exactly:

| Reproduction                                                  | Pre-repair actual          |
| ------------------------------------------------------------- | -------------------------- |
| shadow="idle" / legacy="streaming" / seq=5 / shadowSeq=2      | `{ phase: "idle", source: "shadow" }` (RED FAIL) |
| shadow="streaming" / legacy="completed" / seq=12 / shadowSeq=8 | `{ phase: "streaming", source: "shadow" }` (RED FAIL) |
| shadow(modelStreaming=false) / legacy="streaming" / seq=5 / shadowSeq=2 | `{ modelStreaming: false, source: "shadow" }` (RED FAIL) |

After the bounded repair (above), all three return the legacy
projection — RED goes GREEN. Conservation tests T1-T14 stay green
(no regression in any of the existing frozen contracts).
