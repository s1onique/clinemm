# Upstream Settings Inventory

> Recon snapshot of upstream Cline (`cline/cline` `main`) Settings
> webview surface, captured against the **historical baseline**
> `c564045d8135c0c1c330b21d47b68b74917ce614` (per
> `factory/inventories/repository.json`) plus the **live RADAR**
> captured from the upstream `.clinerules/general.md` Settings
> round-trip warning, the upstream CLI reference, and the
> `factory/inventories/repository.json` placeholders. Recon-only.
> Evidence labels: **RADAR** (current upstream contributor doc),
> **HISTORICAL_BASELINE** (frozen baseline snapshot), **INFERRED**
> (derived).

## 0. Fetch posture

This clone has only `origin` configured (verified via
`git remote` at `main` HEAD `f6b6697e5`; the canonical upstream URL
`https://github.com/cline/cline.git` is NOT configured in this
clone, per `docs/factory/upstream-sync.md` and the prior
`ACT-CLINEMM-UPSTREAM-PARITY-AND-SETTINGS-BACKLOG-REFINEMENT01`
reconciliation). The recon therefore uses the
historical baseline snapshot recorded in
`factory/inventories/repository.json` plus the live RADAR read
from the canonical upstream `.clinerules/general.md` and
`docs/cli/cli-reference.mdx` documents. No `git fetch upstream`
was attempted; per doctrine this requires operator action.

## 1. Historical baseline (frozen)

```text
upstream.commit_oid              = c564045d8135c0c1c330b21d47b68b74917ce614
upstream.tree_oid                = 2a1d9c0e4cef65151afc286343d92ca0f6b68039
upstream.merge_base_with_upstream = c564045d8135c0c1c330b21d47b68b74917ce614
working_copy.ahead               = 17    (HISTORICAL — not current)
working_copy.behind              = 0     (HISTORICAL — not current)
```

Per the prior backlog-refinement reconciliation:
"176 upstream commits" pending in current state — these have NOT
been fetched. The exact current `behind` count requires an
operator-initiated `git fetch upstream`. **HISTORICAL_BASELINE**
+ **INFERRED**.

## 2. Upstream Settings surface (RADAR + inferred from baseline)

Per the upstream contributor document (`.clinerules/general.md`)
captured as RADAR:

```text
- Upstream Settings uses a tabbed webview surface with navigation
  through a settings registry.
- The Settings round-trip for a single toggle requires:
    UpdateSettingsRequest  (proto request)
    → StateManager.setGlobalState  (persistence)
    → controller.getStateToPostToWebview()  (projection)
    → ExtensionState  (webview type)
    → useExtensionState()  (webview read)
    → rendered toggle
  Missing any side makes the toggle appear stuck or revert.
- Upstream removed `yolo_mode_toggled` and migrated it into
  `auto_approval_settings`. The current fork's `state.proto`
  records `reserved 22; // was yolo_mode_toggled (removed;
  migrated into auto_approval_settings)` — this is consistent
  with the upstream migration.
- Upstream has a candidate "Allow outbound network" toggle in the
  3.16.0 Advanced settings migration. The exact current upstream
  label/name cannot be reproduced without a fetch.
- Upstream removed `double_check_completion_enabled`,
  `native_tool_call_enabled`, `cline_web_tools_enabled`,
  `enable_parallel_tool_calling`, `custom_prompt` (proto reserved
  fields).
```

The exact current upstream Settings tab registry cannot be
reproduced without a fetch. **RADAR** + **INFERRED**.

## 3. YOLO / auto-approval posture (RADAR)

```text
- Upstream 3.30/3.31 introduced a settings-visible YOLO mode
  tied to `auto_approval_settings.actions`.
- Upstream contributor guidance: a Settings toggle for YOLO must
  round-trip through the full state pipeline.
- ClineMM's substrate contract is a different *capability model*
  (Seatbelt on/off, network on/off, SSH agent on/off) that is
  orthogonal to upstream's per-action auto-approval matrix. A
  wholesale "YOLO = on/off" UI is not the right shape for ClineMM;
  the right shape is per-capability toggles in a dedicated
  ClineMM-specific section. (See §5 of the recon ACT.)
```

**RADAR** (Settings round-trip warning + 3.30/3.31 upstream note).

## 4. Sandbox / network / SSH-agent posture (RADAR)

Upstream Cline does NOT have a Seatbelt sandbox UI (Seatbelt is
ClineMM-specific Darwin-only substrate). Upstream may have an
"Allow outbound network" toggle candidate; exact current shape
requires a fetch.

ClineMM's SSH-agent authority is a ClineMM-specific capability
(not present upstream). The RECON01 contract frozen at
`ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-RECON01 §15` is
invariant across any settings surface.

## 5. CLI / ACP settings surface (RADAR)

Per `docs/cli/cli-reference.mdx` upstream contributor guidance,
the CLI has its own sandbox/config surfaces. The settings surface
in webview must round-trip cleanly through
`updateSettingsCli` (`UpdateSettingsRequestCli`) as well as
`updateSettings`. This is the load-bearing reason the recon ACT
already records the **BOTH update paths** invariant.
