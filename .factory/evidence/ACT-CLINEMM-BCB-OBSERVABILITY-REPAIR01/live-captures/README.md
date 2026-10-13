# ACT-CLINEMM-BCB-OBSERVABILITY-REPAIR01 — Live qualification evidence

The exact-head VSIX is BUILT at this ACT's HEAD but is NOT YET INSTALLED
in the production environment.

## Build

| Field        | Value                                                                 |
|--------------|----------------------------------------------------------------------|
| Source HEAD  | this ACT's commit (post-repair)                                       |
| Version      | 4.1.16 (extension package version, unchanged)                         |
| Artifact     | `dist/clinemm-4.1.16-bcbobsrv01.vsix`                                  |
| Size         | 60,497,077 bytes (≈ 57.69 MB)                                        |
| SHA-256      | `f914ac837a022a74f831adabb3a734ddf0511001300f4083e810d3bd924658a0`    |

## Bundled repair verification

The bundled `extension/dist/extension.js` contains the REPAIR:
`getActiveRuntimeToolNames(e){if(!e)return;let r=this.sessions.get(e);if(r)return[...r.runtime.tools,...r.config.extraTools??[]].map(n=>n.name)}`

This is the SAME merge the production seam already uses at
`local-runtime-host.ts:834` to build the model-facing `agentConfig.tools`,
now also applied to the BCB `canObserveHeldResults` capability projection.

## Live qualification

**BLOCKED BY ENV** — same condition that blocked the prior
ACT-CLINEMM-BCB-CAPTURE01 and ACT-CLINEMM-BCB-CAPTURE-ACTIVATION01: the
`~/.vscodium-clinemm/extensions/` directory is on a read-only mount
(`touch` + `chmod` both fail with `Operation not permitted`). The
operator must perform the live qualification in a writable
environment.

## Live qualification verdict

`PASS_REPAIR_STRUCTURAL_LIVE_PENDING` — the structural repair is verified
by the 13/13 BCBOBSRV01 test gate + the 26/26 BCAPT01 preservation + the
5/5 OCRRD01 c2-4-c-bridge live `LocalRuntimeHost` test + the 24/24
BCBCAP01 dogfood profile activation test + the 3 RED / 11 PASS L2847
witness preservation + the typecheck PASS + the lint PASS.

A successful live result requires correct terminal handling AND
conservation of outstanding terminal results (per the BCB01 §0.1
second conjunct) — not simply a green header.
