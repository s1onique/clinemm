# Settings Parity Matrix — ClineMM vs Upstream

> Recon parity matrix comparing current ClineMM `main` HEAD
> `f6b6697e5` to upstream Cline (`cline/cline` `main`,
> historical baseline `c564045d8135c0c1c330b21d47b68b74917ce614`
> + RADAR from upstream `.clinerules/general.md`). Recon-only.
> Evidence labels: **REAL_PRODUCTION_SEAM** (verified on disk),
> **RADAR** (upstream contributor doc), **HISTORICAL_BASELINE**
> (frozen snapshot), **INFERRED** (derived), **STRUCTURAL**
> (visible in code but not exercised).

## Classification key

```text
PRESENT_IN_BOTH       — both forks have this surface
MISSING_ACCIDENTALLY  — upstream has it; ClineMM does NOT; no
                         intentional ClineMM override; candidate
                         for restore
REMOVED_INTENTIONALLY — upstream has it; ClineMM does NOT;
                         ClineMM-specific override documented;
                         do NOT port
SUPERSEDED_BY_CLINEMM — upstream has it; ClineMM has a DIFFERENT
                         shape that supersedes it (e.g. capability
                         toggles vs YOLO master toggle)
UPSTREAM_NOT_APPLICABLE — upstream has it; ClineMM fork is on a
                           different substrate (e.g. Seatbelt on
                           Darwin only)
CLINEMM_SPECIFIC       — ClineMM-only surface (no upstream equivalent)
SAFE_TO_PORT           — can be brought back without product-policy
                          renegotiation
REQUIRES_REDESIGN      — restoring would force a fork-side redesign
DO_NOT_PORT            — explicit ClineMM override; do not port
```

## Parity rows

| Surface | LOCAL_PRESENT | UPSTREAM_PRESENT | LOCAL_VARIANT | UPSTREAM_VARIANT | LOCAL_OLDER | Classification | Action |
|---|---|---|---|---|---|---|---|
| API Configuration | yes | yes | per-provider pickers | per-provider pickers | no | PRESENT_IN_BOTH | n/a |
| Features tab | yes | yes | 3 sub-groups (Agent/Editor/Advanced); 1 advanced row today | upstream-equivalent shape (RADAR) | no | PRESENT_IN_BOTH | n/a |
| Terminal | yes | yes | `terminalSettingsSection.tsx` (201L) | upstream-equivalent | no | PRESENT_IN_BOTH | n/a |
| General | yes | yes | telemetry + preferred-language only | broader General upstream | maybe | PRESENT_IN_BOTH | scope check at impl |
| About | yes | yes | version | version | no | PRESENT_IN_BOTH | n/a |
| Remote Config | yes | yes | org-pushed fields | org-pushed fields | no | PRESENT_IN_BOTH | n/a |
| Debug | yes (hidden unless IS_DEV / internal) | upstream equivalent | dev tools | dev tools | no | PRESENT_IN_BOTH | n/a |
| Auto Compact | yes | yes | Switch | Switch | no | PRESENT_IN_BOTH | n/a |
| Auto Compact Strategy | yes | yes | Select (`basic` / `agentic`) | Select | no | PRESENT_IN_BOTH | n/a |
| Context ceiling | yes | n/a (ClineMM-specific; see USER-CONTEXT-CEILING01) | text | n/a | n/a | CLINEMM_SPECIFIC | n/a |
| Web Search | yes | yes | Switch | Switch | no | PRESENT_IN_BOTH | n/a |
| Feature Tips | yes | yes | Switch | Switch | no | PRESENT_IN_BOTH | n/a |
| Background Edit | yes | yes | Switch | Switch | no | PRESENT_IN_BOTH | n/a |
| Checkpoints | yes | yes | Switch | Switch | no | PRESENT_IN_BOTH | n/a |
| YOLO (master toggle) | no | yes (per RADAR 3.30/3.31) | auto_approval_settings plumbing; no UI | Settings toggle | unknown | SUPERSEDED_BY_CLINEMM | per-capability toggles in dedicated section |
| Double-Check Completion | no | no (removed upstream; reserved in proto) | — | removed | no | DO_NOT_PORT | n/a |
| Hooks | yes | yes | Switch | Switch | no | PRESENT_IN_BOTH | n/a |
| MCP display mode | yes | yes | Select (`plain`/`rich`/`markdown`) | Select | no | PRESENT_IN_BOTH | n/a |
| Custom prompt | no | no (removed upstream; reserved in proto) | — | removed | no | DO_NOT_PORT | n/a |
| Native tool calling | no | no (removed upstream) | — | removed | no | DO_NOT_PORT | n/a |
| Cline web tools | no | no (removed upstream) | — | removed | no | DO_NOT_PORT | n/a |
| Enable parallel tool calling | no | no (removed upstream) | — | removed | no | DO_NOT_PORT | n/a |
| Sandbox / Seatbelt on-off | no | n/a (Darwin-only substrate) | env-only | n/a | n/a | CLINEMM_SPECIFIC | required for ACT §5/§6 |
| Network egress | no | yes (candidate, per RADAR) | env-only | "Allow outbound network" toggle | no | SUPERSEDED_BY_CLINEMM | required for ACT §5/§6 |
| SSH agent authority | no | n/a | env-only | n/a | n/a | CLINEMM_SPECIFIC | required for ACT §5/§6 |
| PTAD / diagnostics | no (dev-only) | n/a | env-only | n/a | n/a | CLINEMM_SPECIFIC | stay internal; GUARD_NO_PTAD_TAB |
| Subagents | yes | yes | Switch (via worktrees/subagents) | Switch | no | PRESENT_IN_BOTH | n/a |
| Worktrees | yes | yes | Switch | Switch | no | PRESENT_IN_BOTH | n/a |

## Action summary

```text
PRESENT_IN_BOTH           = n (already aligned)
CLINEMM_SPECIFIC          = 3 (Seatbelt, SSH agent, Context ceiling)
SUPERSEDED_BY_CLINEMM     = 2 (YOLO master → capability toggles;
                                  Network → Allow outbound network)
UPSTREAM_NOT_APPLICABLE   = 0
DO_NOT_PORT               = 5 (upstream-removals)
SAFE_TO_PORT              = 0
REQUIRES_REDESIGN         = 0
```

## Notes on RESTORE candidates

There is **no MISSING_ACCIDENTALLY** row. Every missing local
surface is either:

  - upstream-removed (DO_NOT_PORT), or
  - ClineMM-specific substrate (CLINEMM_SPECIFIC), or
  - ClineMM-superseded (SUPERSEDED_BY_CLINEMM).

Therefore the candidate-restore list from this recon is empty;
the implementation ACT that follows must *create* the ClineMM
section rather than *restore* an upstream section. This matches
the §11 decision tree in the existing recon ACT (per the prior
backlog-refinement reconciliation): ≥3 entries spanning
categories → `EPIC-CLINEMM-SETTINGS-SUBSTRATE01` (NEW EPIC).
