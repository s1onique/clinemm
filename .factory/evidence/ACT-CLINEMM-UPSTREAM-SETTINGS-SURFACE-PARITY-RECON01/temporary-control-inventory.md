# Temporary ClineMM Control Inventory

> Recon inventory of every ClineMM-only environment-variable control
> related to Seatbelt / sandbox / network / SSH-agent / PTAD
> substrate. Each row carries a classification per the ACT §4
> closed-class.

## Classification key

```text
PRODUCT_SETTING_CANDIDATE — temporary env control that should become
                              a stable Settings UI toggle
INTERNAL_DIAGNOSTIC       — operator/dev-only control; never goes
                              in the user-facing Settings UI
LEGACY_COMPATIBILITY      — old API control retained for back-compat
REMOVE_AFTER_UI           — temporary control that becomes obsolete
                              once the Settings UI ships
KEEP_ENV_OVERRIDE         — temporary control retained as an advanced
                              / dev-only override (UI is canonical;
                              env takes precedence per §7 freeze)
```

## Inventory

| Env var | Read site | Classification | Notes |
|---|---|---|---|
| `CLINEMM_EXPERIMENTAL_SANDBOX` | `apps/vscode/src/sdk/sandbox-policy.ts:128` (`resolveExperimentalSandboxMode`); consumed by `apps/vscode/src/sdk/command-job-manager.ts:480` | KEEP_ENV_OVERRIDE | Substrate-mode switch (`seatbelt` / `off`). Should NOT become a user-facing setting; it is the substrate-mode selector itself. Retain as internal env-only. |
| `CLINEMM_SAFE_YOLO_NETWORK` | `apps/vscode/src/sdk/sandbox-policy.ts:~197` (`resolveSafeYoloNetworkOptIn`) | PRODUCT_SETTING_CANDIDATE | Network-egress opt-in. Maps to the new "Allow outbound network" settings toggle (per FW-05 cross-link in `EPIC-SAFE-YOLO-SEATBELT`). |
| `CLINEMM_SAFE_YOLO_SSH_AGENT` | `apps/vscode/src/sdk/sandbox-policy.ts:~240` (`resolveSafeYoloSshAgentOptIn`) | PRODUCT_SETTING_CANDIDATE | SSH-agent authority opt-in. Maps to the new "Allow SSH agent authentication" settings toggle. |
| `CLINEMM_SAFE_YOLO` (parent) | inferred from legacy Safe-YOLO substrate | KEEP_ENV_OVERRIDE | The umbrella YOLO opt-in. Substrate-level control; not a per-capability surface; should NOT become a per-capability setting. |

## Behaviour summary

```text
CLINEMM_EXPERIMENTAL_SANDBOX
  values: "seatbelt"  → substrate-ON (default on Darwin)
          "off"       → break-glass OFF (no Seatbelt)
          unset       → substrate default (Darwin: ON)
  semantics: selects which backend resolves at runtime. It is
             the substrate-mode switch itself, NOT a per-capability
             toggle. Should stay env-only because exposing it in
             UI would create a confusing "which backend?" UX.

CLINEMM_SAFE_YOLO_NETWORK
  values: "allow"     → network: allow in capability
          anything-else / unset → network: deny (default)
  semantics: per-task opt-in that flips buildExperimentalReconCapability
             network field. Maps cleanly to "Allow outbound network"
             settings toggle.

CLINEMM_SAFE_YOLO_SSH_AGENT
  values: "allow"     → sshAuthenticationAuthority.mode === "agent"
          anything-else / unset → sshAuthenticationAuthority undefined
                                    (= DEFAULT deny)
  semantics: per-task opt-in for SSH agent authority. Maps cleanly
             to "Allow SSH agent authentication" settings toggle.
             Mode-gated: requires CLINEMM_EXPERIMENTAL_SANDBOX=seatbelt
             to take effect.

CLINEMM_SAFE_YOLO
  values: "allow"     → broad YOLO override (historic)
          anything-else / unset → off
  semantics: the original substrate opt-in that all the
             CLINEMM_SAFE_YOLO_* per-capability knobs compose with.
             Should NOT become a UI surface on its own (would
             re-introduce the "one big switch" anti-pattern).
```

## Cross-references

- `EPIC-SAFE-YOLO-SEATBELT` Deferred work §
  `SEATBELT-SAFE-YOLO-USER-FACING-SETTINGS-SURFACE` (FW-05) and
  `TEMP-INTERNAL-CONTROL-CLEANUP` (FW-11).
- `ACT-CLINEMM-THREAD-FUTURE-WORK-BACKLOG-NORMALIZATION01`
  `reconciliation.md` — Track A / B / C decomposition.
- `ACT-CLINEMM-UPSTREAM-PARITY-AND-SETTINGS-BACKLOG-REFINEMENT01`
  `reconciliation.md` — EXISTING_PRESERVED classification for the
  settings-parity ACT.

## Action guidance

The implementation ACT that follows this recon must:

  - Replace `CLINEMM_SAFE_YOLO_NETWORK` with the Settings
    "Allow outbound network" toggle (per FW-05).
  - Replace `CLINEMM_SAFE_YOLO_SSH_AGENT` with the Settings
    "Allow SSH agent authentication" toggle (per FW-05).
  - Leave `CLINEMM_EXPERIMENTAL_SANDBOX` as env-only (KEEP_ENV_OVERRIDE).
  - Leave `CLINEMM_SAFE_YOLO` as env-only (KEEP_ENV_OVERRIDE).
