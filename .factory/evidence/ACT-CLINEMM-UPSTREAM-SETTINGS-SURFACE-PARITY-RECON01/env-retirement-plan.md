# Environment-Variable Retirement Plan

> Recon-frozen plan for retiring (or retaining) the temporary
> ClineMM env controls once the Settings surface lands. Recon-only.
> Authored under `ACT-CLINEMM-UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01`
> §8.

## Choice between A / B / C per env

| Env var | Future state | Rationale |
|---|---|---|
| `CLINEMM_SAFE_YOLO_NETWORK` | **A — KEEP_AS_OVERRIDE** (deprecation-warning logged on read; settings UI is authoritative product surface; env retained as advanced/internal compatibility control) | Operators and CI rely on the env. The UI toggle is canonical, but the env is the operator-override path. |
| `CLINEMM_SAFE_YOLO_SSH_AGENT` | **A — KEEP_AS_OVERRIDE** | Same reasoning. The agent capability is mode-gated on Seatbelt being on; the env is the simplest break-glass for emergency agent auth. |
| `CLINEMM_EXPERIMENTAL_SANDBOX` | **C — INTERNAL_ONLY** | Substrate-mode switch. Not user-facing. Already internal-only. |
| `CLINEMM_SAFE_YOLO` | **C — INTERNAL_ONLY** | Umbrella YOLO opt-in. Already internal-only. |

## Precedence rule (the freeze)

```text
persisted product setting
        ↓
optional env override (advanced/internal compatibility control)
        ↓
effective runtime capability
```

Concretely:

```text
effective = resolveFromStateOrEnv(settingKey)
  if (setting persisted and present)
       use persisted value
  else
       use env var (if set)
       else
         use default
```

The persisted value is **authoritative**: it always wins over
the env. The env is the fallback for users who have not yet
migrated, plus operator/CI overrides.

Env reads should log a one-shot deprecation notice on first
read in a session (e.g. `console.warn('[ClineMM] CLINEMM_SAFE_YOLO_NETWORK is deprecated; configure via Settings → Sandbox & Capabilities.')`).

## No silent conversion

The recon explicitly forbids silently converting the temporary
env controls into permanent public API. The env controls
remain. The settings surface supersedes them only when the
settings surface can fully cover the same capability.

For the three product-surface toggles (Seatbelt, network,
SSH-agent), the settings surface CAN fully cover; therefore
the env controls are **A — KEEP_AS_OVERRIDE** (legacy
compatibility).

For the substrate-mode switch (`CLINEMM_EXPERIMENTAL_SANDBOX`),
the settings surface does NOT cover (it is the substrate-mode
selector itself); therefore the env control remains
**C — INTERNAL_ONLY**.

## Migration timeline

```text
V1 (this recon → implementation ACT) :
  - Settings surface ships with default values.
  - Env controls remain functional with the precedence rule above.
  - Deprecation warning on env read.

V2 (deferred ACT, post-V1) :
  - After ≥ 1 release cycle of UI availability, decide whether
    to drop the deprecation warning.
  - Track adoption metrics (env-read vs persisted-read).

V3 (deferred ACT, much later) :
  - Drop the env controls entirely if the precedence rule has
    not surfaced production breakage. Document the drop in
    a release-notes ACT.
```

The recon does NOT pre-bake V2/V3 actions. Each requires its
own ACT.

## Stale paths

```text
CLINEMM_EXPERIMENTAL_SANDBOX
  - still in active use; no stale path.
CLINEMM_SAFE_YOLO_NETWORK
  - still in active use; no stale path.
CLINEMM_SAFE_YOLO_SSH_AGENT
  - still in active use; no stale path.
```

There are no other `CLINEMM_EXPERIMENTAL_*` paths in the codebase
(verified via `rg 'CLINEMM_EXPERIMENTAL_' apps sdk`; only the
above three are present).
