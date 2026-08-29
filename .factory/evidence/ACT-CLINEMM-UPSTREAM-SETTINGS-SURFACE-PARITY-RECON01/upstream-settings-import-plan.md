# Upstream Settings Import Plan

> Recon-frozen plan for how the Settings implementation ACT
> should interact with the pending upstream catch-up
> (~176 commits). Recon-only. Authored under
> `ACT-CLINEMM-UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01` §9.

## Decision

```text
UPSTREAM_SYNC_REQUIRED_BEFORE_IMPLEMENTATION = NO

Implement ClineMM Settings surface FIRST against the current
local structure (HEAD f6b6697e5). Catch up to upstream in
separate bounded slices AFTER the Settings surface lands.
```

Rationale:

```text
- The Settings surface touches the same files upstream Settings
  changes touch (state.proto, updateSettings.ts, SettingsView.tsx,
  feature toggles). A merge-first order would create massive
  conflicts because the implementation lands NEW fields and a
  NEW tab while upstream may rewrite the same regions.

- Implementing first means the merge encounters:
    * the ClineMM-added state.proto fields (additive, conflict-free)
    * the ClineMM-added SettingsView.tsx tab (additive, conflict-free)
    * the ClineMM-added section file (additive, conflict-free)
    * the ClineMM-added projection fields in getStateToPostToWebview
      (additive, conflict-free)
  All four classes are well-behaved merges against upstream
  (no upstream-side conflict).

- A merge-first order would require the implementation ACT to
  rewrite the Settings surface against whatever upstream has
  reshaped, with no guarantee that the ClineMM-added sections
  survive.

- The frozen runtime contract (seatbelt on/off, network on/off,
  SSH agent on/off) is substrate-level; it does not depend on
  Settings UI shape. The implementation ACT therefore does not
  need upstream parity to be correct.
```

## Thematic clustering

Per the recon §9 closed-class:

```text
SETTINGS_NAVIGATION
  - upstream Settings tab registry
  - import strategy: PORT_THEMATIC_SERIES (merge at the
    navigation level; let conflicts resolve through the
    merge evidence protocol)

SETTINGS_STATE_PROTO
  - upstream changes to UpdateSettingsRequest / Settings
  - import strategy: MERGE_UPSTREAM_SLICE (the field list
    is the load-bearing piece; ClineMM-side additions are
    additive)

FEATURES_PAGE
  - upstream changes to FeatureSettingsSection / agentFeatures
    / editorFeatures / advancedFeatures arrays
  - import strategy: MERGE_UPSTREAM_SLICE (additive in ClineMM;
    conflict only if upstream renames or removes a row ClineMM
    preserves — rare)

TERMINAL_PAGE
  - upstream changes to TerminalSettingsSection
  - import strategy: MERGE_UPSTREAM_SLICE

GENERAL_PAGE
  - upstream changes to GeneralSettingsSection
  - import strategy: MERGE_UPSTREAM_SLICE

SANDBOX_CONFIG
  - upstream does not have a sandbox UI today; no import needed
  - import strategy: DO_NOT_IMPORT

OTHER
  - upstream debug/about/remote-config changes
  - import strategy: MERGE_UPSTREAM_SLICE
```

## Forbidden

```text
- rebase onto upstream        (PROHIBITED — see docs/factory/upstream-sync.md)
- alternative-history rewrite (PROHIBITED — same)
- mass cherry-pick sequence   (PROHIBITED — single slices only)
- wholesale upstream copy of Settings into the ClineMM fork
                               (PROHIBITED — GUARD_NO_WHOLESALE_UPSTREAM_COPY)
- re-introducing yolo_mode_toggled
                               (PROHIBITED — upstream-reserved slot)
- exposing PTAD as a top-level tab
                               (PROHIBITED — GUARD_NO_PTAD_TAB)
```

## Sequence

```text
1. THIS RECON ACT           : closes with PASS_SETTINGS_SURFACE_RECON
2. Implementation ACT        : ACT-CLINEMM-SETTINGS-SANDBOX-CAPABILITIES-IMPLEMENTATION01
                              bounded: UI surface + state/proto/persistence
                              wiring + tests; DOES NOT redesign Seatbelt
                              profile generation, network policy semantics,
                              or SSH-agent socket semantics.
3. Upstream catch-up ACT(s)  : bounded slices per the cluster table above;
                              merge-only; conflict evidence under
                              docs/factory/sync/<YYYY-MM-DD>/
4. Settings-implementation cross-check ACT :
                              after the upstream catch-up, verify that the
                              new upstream Settings shape does not break
                              the ClineMM-added tab or projection fields.
```

## Operator triggers

This recon freezes the sequence. The next ACT (implementation)
is authorised at recon closure. The upstream catch-up is NOT
authorised by this recon; it requires its own ACT.
