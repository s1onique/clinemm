# Proposed ClineMM Settings Contract

> Recon-frozen contract for the Settings surface that exposes
> ClineMM sandbox controls. Recon-only. Authored under
> `ACT-CLINEMM-UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01` §5.

## 1. Placement

Two plausible placements were evaluated:

```text
A. Put sandbox controls under the existing Features / Advanced
   sub-group (advancedFeatures[] array in
   FeatureSettingsSection.tsx).

B. Create a dedicated top-level tab:
      id = "sandbox"  (or "security", "capabilities")
      icon = ShieldCheck or similar
      headerText = "Sandbox & Capabilities"
      section component = SandboxCapabilitiesSection.tsx
```

**Decision (recon-frozen)**: **B. dedicated top-level tab**.

Rationale:

```text
- Discoverability.  A dedicated tab is more discoverable than a
  single row in Features/Advanced. Users who need to know "is
  network enabled?" or "is SSH agent enabled?" must be able to
  find the answer without scrolling through unrelated rows.

- Danger communication.  These controls carry concrete filesystem
  / network / credential authority. A dedicated tab allows
  per-control danger styling and a clear "Advanced / risky"
  header treatment.

- Upstream merge conflict surface.  A dedicated tab adds a single
  `SettingsTabID` member + one `TAB_CONTENT_MAP` entry + one
  section file. None of those lines are likely to be touched by
  upstream Settings changes (upstream Settings lives behind
  `api-config`, `features`, `terminal`, `general`, `about`,
  `debug`, `remote-config`). Conflicts are minimized.

- ClineMM-specific ownership.  The seatbelt capability is
  ClineMM-only (per the parity matrix, all three rows are
  CLINEMM_SPECIFIC or SUPERSEDED_BY_CLINEMM). Folding them into
  Features/Advanced would obscure the boundary.

- Ability to grow.  Future capabilities (e.g. AWS / Kube /
  Docker per the deferred `Authenticated-dev-capabilities` row
  in `epic-board.md`) need the same discoverable home.

- Persistence clarity.  All three controls share a single
  state-key family; a dedicated section file can declare and
  validate them as one bundle.
```

## 2. Tab registration

Append to `SETTINGS_TABS` in
`apps/vscode/webview-ui/src/components/settings/SettingsView.tsx`:

```text
{
  id: "sandbox",
  name: "Sandbox",
  tooltipText: "Sandbox & Capabilities",
  headerText: "Sandbox & Capabilities",
  icon: ShieldCheck,
}
```

`SettingsTabID` union extends to:

```text
type SettingsTabID = "api-config" | "features" | "terminal" |
                     "general"   | "about"   | "debug"  |
                     "remote-config" | "sandbox"
```

## 3. Proposed controls

| Toggle | Default | Type | Mapping (current env) | Setting proto field |
|---|---|---|---|---|
| Disable Seatbelt | OFF (Seatbelt ON) | Switch; visually marked DANGEROUS | `CLINEMM_EXPERIMENTAL_SANDBOX=off` (NOT a per-cap toggle; preserves substrate mode) | `disableSeatbelt: bool` |
| Allow outbound network | OFF | Switch | `CLINEMM_SAFE_YOLO_NETWORK=allow` | `allowOutboundNetwork: bool` |
| Allow SSH agent authentication | OFF | Switch | `CLINEMM_SAFE_YOLO_SSH_AGENT=allow` | `allowSshAgent: bool` |

All three controls:

- Have a danger / safety description under the toggle.
- Are reversible (each toggle is independent).
- Round-trip through `UpdateSettingsRequest`, `StateManager`,
  `getStateToPostToWebview()`, `ExtensionState`, `useExtensionState()`.
- Are persisted across extension restart.
- Are NOT mutated by the upstream YOLO/auto-approval matrix
  (`YOLO_COUPLING = NONE` — orthogonal).

Explicit non-controls (NOT exposed in V1):

```text
- Raw ~/.ssh key-read capability     ; RECON01 §15 OUT OF SCOPE for V1
- Per-host SSH socket path           ; canonicalised at capability build
- PTAD diagnostic toggles            ; GUARD_NO_PTAD_TAB held
- CLINEMM_EXPERIMENTAL_SANDBOX       ; KEEP_ENV_OVERRIDE (substrate-mode)
- CLINEMM_SAFE_YOLO                  ; KEEP_ENV_OVERRIDE (umbrella)
```

## 4. Invariants

```text
SSH_AGENT_SETTING != SSH_PRIVATE_KEY_ACCESS
  the SSH-agent setting grants SSH_AUTH_SOCK; it does NOT
  permit raw-key reads. Raw-key reads remain EPERM in V1
  (REC01/IMPL01 invariants).

SEATBELT_DISABLE != NETWORK_GRANT
SEATBELT_DISABLE != SSH_AGENT_GRANT
  disabling Seatbelt does NOT implicitly grant network or
  SSH-agent authority. Authority remains per-toggle.

YOLO_TOGGLE does NOT mutate any of the three sandbox toggles.
```

## 5. Wire-through

For each new field, the implementation ACT must touch:

```text
1. apps/vscode/proto/cline/state.proto
     - add fields to UpdateSettingsRequest
     - add fields to Settings message
     - (regenerate via `bun run protos`)
2. apps/vscode/src/shared/storage/state-keys.ts
     - add typed defaults / transforms
3. apps/vscode/src/core/controller/state/getStateToPostToWebview.ts
     - project the new fields
4. apps/vscode/src/core/controller/state/updateSettings.ts
     - accept the new fields; persist via StateManager
5. apps/vscode/src/core/controller/state/updateSettingsCli.ts
     - accept the new fields (CLI / ACP parity)
6. apps/vscode/src/shared/ExtensionMessage.ts
     - add to ExtensionState (webview type)
7. apps/vscode/webview-ui/src/context/ExtensionStateContext.tsx
     - include defaults
8. apps/vscode/webview-ui/src/components/settings/SettingsView.tsx
     - register the new tab
9. apps/vscode/webview-ui/src/components/settings/sections/
       SandboxCapabilitiesSection.tsx
     - the section component (new file)
10. apps/vscode/src/sdk/sandbox-policy.ts
     - replace env reads with StateManager reads in
       buildExperimentalReconCapability (or accept an
       injected capability-source argument for testability)
```

## 6. Acceptance tests (future implementation ACT)

The recon §10 contract (SET-01..SET-12) is reproduced in this file:

```text
SET-01  absent persisted keys → Seatbelt enabled, network denied,
                                 SSH agent denied
SET-02  network setting ON   → capability.network = allow,
                                 SSH agent unchanged
SET-03  SSH agent ON          → sshAuthenticationAuthority.mode=agent,
                                 network unchanged
SET-04  Seatbelt disabled     → explicit no-sandbox path,
                                 dangerous state visible in UI
SET-05  YOLO toggle does NOT  → three sandbox settings unchanged
        mutate sandbox
SET-06  full round-trip       → webview → UpdateSettingsRequest →
        StateManager → controller projection → ExtensionState →
        rendered toggle
SET-07  restart preserves     → extension restart keeps values
SET-08  migration             → missing historical fields migrate
                                 to safe defaults
SET-09  raw-key denied        → regardless of SSH-agent UI setting
SET-10  env precedence        → behaves exactly as §7 freezes
SET-11  parity additions      → upstream parity additions remain
SET-12  visual truth          → toggles cannot visually claim ON
                                 when backend value remains OFF
```

These are recon-frozen test IDs; the implementation ACT
authoring them is a downstream concern.
