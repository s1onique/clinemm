# 03 — Fork Delta vs Upstream

**ACT:** ACT-CLINEMM-FACTORIZE-F0-INVENTORY01
**Method:** `git diff --numstat upstream/main...HEAD` (per-file LOC delta)
**Evidence label:** HISTORICAL_GIT

---

## Merge-base discovery

```
$ git rev-parse upstream/main
48d63852745460ff0fa3dfcc0457bbe2493841de

$ git merge-base HEAD upstream/main
48d63852745460ff0fa3dfcc0457bbe2493841de
```

The merge base **is** `upstream/main`. There is **no separate Cline-- lineage merge-base** — the fork was branched off upstream HEAD and has been developed linearly.

| Metric | Value |
|---|---:|
| Upstream HEAD | `48d63852745460ff0fa3dfcc0457bbe2493841de` |
| Merge base | `48d63852745460ff0fa3dfcc0457bbe2493841de` (same as upstream HEAD) |
| Fork commits ahead | **1,112** |
| Fork commits behind | 0 |
| Files changed vs upstream | **1,327** (1,182 added + 145 modified; **0 deleted**) |
| Production-only delta | +185,923 / -923 LOC across 583 files |

## Top-level file distribution

| Top dir | Files |
|---|---:|
| `.factory/` | 522 (evidence — excluded from production delta) |
| `apps/` | 385 |
| `sdk/` | 197 |
| `docs/` | 142 |
| `factory/` | 41 |
| `tools/` | 16 |
| `scripts/` | 11 |

## Production delta by host

| Path | Files | +LOC | −LOC |
|---|---:|---:|---:|
| `apps/vscode/` | 376 | +118,841 | −717 |
| `sdk/packages/` | 197 | +64,701 | −192 |
| `apps/cli/` | 10 | +2,381 | −14 |
| `apps/cline-hub/` | 0 | 0 | 0 |
| `apps/vscode-rollout/` | 0 | 0 | 0 |
| **Total production** | **583** | **+185,923** | **−923** |

## Fork-added structure (host)

`apps/vscode/` subdirectories touched (top 10):

| Path | Files |
|---|---:|
| `apps/vscode/src/sdk/` | **250** |
| `apps/vscode/src/shared/` | 14 |
| `apps/vscode/src/core/` | 13 |
| `apps/vscode/src/test/` | 2 |
| `apps/vscode/src/hosts/` | 2 |
| `apps/vscode/src/standalone/` | 1 |
| `apps/vscode/src/services/` | 1 |
| `apps/vscode/src/dev/` | 1 |
| `apps/vscode/src/registry.ts` | 1 |
| `apps/vscode/src/extension.ts` | 1 |

**The fork's center of gravity is `apps/vscode/src/sdk/`** — the SDK adapter layer between the host and the `@cline/*` SDK packages. 250 of 376 host-side fork-changed files live there.

## Top fork-only files (host SDK adapter)

| +LOC | Path |
|---:|---|
| 6,669 | `apps/vscode/src/sdk/__tests__/task-state-shadow-correction02-c23-stateful-workloads.test.ts` |
| 2,333 | `apps/vscode/src/sdk/SdkController.ts` (+42 against upstream) |
| 1,554 | `apps/vscode/src/sdk/__tests__/queued-prompt-stop-resume-integrity.q24-c-bridge.test.ts` |
| 1,482 | `apps/vscode/src/sdk/command-job-manager.ts` |
| 1,199 | `apps/vscode/src/sdk/__tests__/seatbelt-all-r5-authority-implementation01.go-parser-result-red.test.ts` |
| 1,061 | `apps/vscode/src/sdk/__tests__/hub-runtime-host.provenance-epoch.c24-d3.test.ts` |
| 1,055 | `apps/vscode/src/sdk/sdk-tool-policies.ts` (+27) |
| 1,047 | `apps/vscode/src/sdk/__tests__/task-header-projection-coherence-repair01.tcr01.test.ts` |
| 1,015 | `apps/vscode/src/sdk/__tests__/task-state-shadow-correction02-witnesses.test.ts` |
| 1,002 | `apps/vscode/src/sdk/sandbox-policy.ts` |
| 971 | `apps/vscode/src/sdk/sdk-interaction-coordinator.test.ts` (+35) |
| 935 | `apps/vscode/src/sdk/__tests__/runtime-followup-resume-subscription-parity.frsp01-correction01.test.ts` |
| 878 | `apps/vscode/src/sdk/sdk-interaction-coordinator.ts` (+44) |
| 861 | `apps/vscode/src/sdk/__tests__/hub-runtime-host.fallback-composition.c24-d.test.ts` |
| 856 | `apps/vscode/src/sdk/__tests__/execution-authority-per-command-binding01.c2-green.test.ts` |
| 837 | `apps/vscode/src/sdk/task-state-shadow-host-wiring.ts` |
| 837 | `apps/vscode/src/sdk/__tests__/async-command-ownership-discriminator.aco01-correction03.c24-c-bridge.test.ts` |
| 828 | `apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts` |
| 790 | `apps/vscode/src/sdk/__tests__/darwin-seatbelt-yolo-approval-friction-recon01.c1-inventory.test.ts` |
| 759 | `apps/vscode/src/sdk/command-job-manager.sandbox-integration.test.ts` |

Observations:
- **6 of the top 7 non-test files are in `apps/vscode/src/sdk/`** — confirming the SDK adapter is where the fork lives.
- `SdkController.ts` (+2,333 / -42) is **modified**, not just added, meaning the fork has rewritten substantial portions of the upstream file in-place. This is a structural merge-friction hotspot.
- Many tests at the top are *regression-witness* tests (`.correction02.test.ts`, `.correction01.test.ts`, `.c24-c-bridge.test.ts`). These are mechanical evidence but also strong indicators of where semantic authority has been uncertain.

## Fork-added structure (SDK)

`sdk/packages/` subdirectories touched:

| Path | Files |
|---|---:|
| `packages/core/` | **138** |
| `packages/agents/` | 51 |
| `packages/shared/` | 7 |
| `packages/llms/` | 1 |

The fork touched **`@cline/core` heavily** (138 files) and `@cline/agents` second (51). `@cline/shared` and `@cline/llms` are nearly untouched (8 files total).

## Top fork-only files (SDK core)

| +LOC | Path |
|---:|---|
| 2,045 | `sdk/packages/core/src/runtime/command-policy/structured-command-risk.ts` |
| 1,596 | `sdk/packages/core/src/runtime/command-policy/structured-command-risk.pipeline-leaf-composition.test.ts` |
| 1,444 | `sdk/packages/core/src/runtime/sandbox/macos/seatbelt-backend.test.ts` |
| 1,180 | `sdk/packages/core/src/runtime/command-policy/command-safe-rules.test.ts` |
| 995 | `sdk/packages/core/src/runtime/command-policy/command-risk.ts` |
| 960 | `sdk/packages/core/src/runtime/command-policy/command-policy.ts` |
| 954 | `sdk/packages/core/src/runtime/command-policy/command-safe-rules.ts` |
| 949 | `sdk/packages/core/src/runtime/command-policy/command-risk-corpus.ts` |
| 860 | `sdk/packages/core/src/runtime/command-policy/structured-command-risk.reader-path-authority.test.ts` |
| 708 | `sdk/packages/core/src/runtime/command-policy/path-authority.ts` |
| 703 | `sdk/packages/core/src/hub/runtime-host/hub-runtime-host.reachability.c24-d.test.ts` |
| 662 | `sdk/packages/core/src/runtime/sandbox/macos/seatbelt-backend.ts` |
| 617 | `sdk/packages/core/src/runtime/command-policy/command-policy-types.ts` |
| 611 | `sdk/packages/core/src/runtime/orchestration/session-runtime.subscribe-runtime-events.e2f-f1.test.ts` |
| 590 | `sdk/packages/core/src/runtime/sandbox/macos/seatbelt-ssh-agent-authority.test.ts` |

Observations:
- **`runtime/command-policy/` is the largest single fork-added subsystem.** 12 of the top 15 entries live there. This is the structured command risk / path authority / command policy / safe rules machinery — entirely fork-invented.
- **`runtime/sandbox/macos/`** (seatbelt-backend, ssh-agent) is the second hot area — fork-invented macOS sandboxing.
- These two subsystems dominate the *new* Cline-- surface. They have **no analogue in upstream** because upstream has no ClineMM-specific security model.

## Files modified in upstream (not just added) — top by churn

| +/− | Path |
|---|---|
| +2,333 / -42 | `apps/vscode/src/sdk/SdkController.ts` |
| +1,055 / -27 | `apps/vscode/src/sdk/sdk-tool-policies.ts` |
| +971 / -35 | `apps/vscode/src/sdk/sdk-interaction-coordinator.test.ts` |
| +878 / -44 | `apps/vscode/src/sdk/sdk-interaction-coordinator.ts` |
| +723 / -11 | `apps/vscode/src/sdk/sdk-session-event-coordinator.test.ts` |
| +565 / -7 | `sdk/packages/core/src/extensions/context/compaction.working-context-ratio.test.ts` |

All large upstream-modified files are in `apps/vscode/src/sdk/` — these are the **merge-friction surface** (see §12).

## What the fork does NOT change

- `sdk/packages/llms/src/` — only 1 file touched. Provider logic is upstream-as-is.
- `sdk/packages/shared/` — only 7 files. Mostly new tests, low churn.
- `apps/cline-hub/` — 0 files. Hub is upstream-as-is.

## Net assessment

The fork's architectural identity is concentrated in two areas:

1. **Host SDK adapter** (`apps/vscode/src/sdk/`) — 250 files, including a heavily-rewritten `SdkController.ts` and the entire coordinator family.
2. **`@cline/core` runtime/command-policy + sandbox** — 12 large new files in `command-policy/`, plus `seatbelt-backend.ts`, `path-authority.ts`, `sandbox-policy.ts` etc.

Everything else is upstream-as-is. The "fork delta" is not a general overlay — it is a **focused architectural extension** in two places.
