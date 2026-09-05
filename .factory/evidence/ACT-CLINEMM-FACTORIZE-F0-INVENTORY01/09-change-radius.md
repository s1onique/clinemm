# 09 — Change Radius

**ACT:** ACT-CLINEMM-FACTORIZE-F0-INVENTORY01
**Method:** `git log --name-only upstream/main..HEAD -- <path>` for each production root; per-file commit counts and directory-level counts.
**Evidence label:** HISTORICAL_GIT

---

## Top-level change-radius distribution

| Path | Commits |
|---|---:|
| `apps/vscode/src/` | 1,035 |
| `sdk/packages/core/` | 478 |
| `apps/vscode/webview-ui/` | 203 |
| `sdk/packages/agents/` | 136 |
| `apps/cli/src/` | 40 |
| `sdk/packages/shared/` | 29 |

`apps/vscode/src/` is touched **2.2× more often** than `sdk/packages/core/`. The host is the dominant change-radius hotspot.

## Top hot directories

### Inside `apps/vscode/src/` (subdirs)

| Subdir | Commits |
|---|---:|
| `apps/vscode/src/sdk/` | **877** |
| `apps/vscode/src/shared/` | 79 |
| `apps/vscode/src/core/` | 31 |
| `apps/vscode/src/extension.ts` | 12 |
| `apps/vscode/src/test/` | 11 |
| `apps/vscode/src/dev/` | 11 |
| `apps/vscode/src/registry.ts` | 8 |

`apps/vscode/src/sdk/` alone accounts for **85%** of all host-side change activity.

### Inside `sdk/packages/core/src/`

| Subdir | Commits |
|---|---:|
| `sdk/packages/core/src/runtime/` | **332** |
| `sdk/packages/core/src/extensions/` | 46 |
| `sdk/packages/core/src/index.ts` | 17 |
| `sdk/packages/core/src/ClineCore.ts` | 6 |
| `sdk/packages/core/src/types/` | 2 |
| `sdk/packages/core/src/hub/` | 2 |

`runtime/` alone accounts for **69%** of all core-side change activity.

## Top 20 hot files (commits touching the file)

| Commits | Path |
|---:|---|
| 88 | `apps/vscode/src/sdk/SdkController.ts` |
| 23 | `apps/vscode/src/sdk/sdk-tool-policies.ts` |
| 23 | `apps/vscode/src/sdk/__tests__/task-state-shadow-correction02-c23-stateful-workloads.test.ts` |
| 22 | `apps/vscode/src/sdk/task-state-shadow-host-wiring.ts` |
| 19 | `apps/vscode/src/sdk/command-job-manager.ts` |
| 17 | `sdk/packages/core/src/index.ts` |
| 17 | `apps/vscode/src/sdk/sdk-interaction-coordinator.ts` |
| 16 | `sdk/packages/core/src/runtime/command-policy/command-safe-rules.ts` |
| 15 | `sdk/packages/core/src/runtime/command-policy/command-policy.ts` |
| 14 | `sdk/packages/core/src/runtime/command-policy/structured-command-risk.ts` |
| 14 | `apps/vscode/src/sdk/vscode-session-host.ts` |
| 13 | `sdk/packages/core/src/runtime/command-policy/command-risk.ts` |
| 13 | `apps/vscode/src/sdk/task-state-shadow.ts` |
| 12 | `apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts` |
| 12 | `apps/vscode/src/sdk/sandbox-policy.ts` |
| 11 | `sdk/packages/core/src/runtime/sandbox/macos/seatbelt-backend.ts` |
| 11 | `sdk/packages/core/src/runtime/sandbox/macos/seatbelt-backend.test.ts` |
| 11 | `sdk/packages/core/src/runtime/command-policy/command-policy-types.ts` |
| 11 | `apps/vscode/src/sdk/task-state-shadow-recorder.ts` |
| 10 | `apps/vscode/src/sdk/task-state-shadow-coordinator.ts` |

**Top 4 hot files are all in `apps/vscode/src/sdk/`.** `SdkController.ts` is in a league of its own — 4× the second-hottest file's commit count.

## Co-change clusters

The single largest commit in the fork touched **44 files**, all in the `sdk/packages/core/src/runtime/command-policy/` cluster plus the host-side `v2-capture.ts`/`v2-capture.test.ts`. That commit was almost certainly a mass-rename / shape change.

Other than that single mega-commit, most commits touch 1–3 files (per the commit-size histogram above, average is ~0.1 files per commit, but that is misleading because git's `--name-only` output treats consecutive files as a single batch).

The co-change pattern that F0 observes mechanically:

- `apps/vscode/src/sdk/SdkController.ts` co-changes with every other file in `apps/vscode/src/sdk/` (because it owns the wiring).
- `sdk/packages/core/src/runtime/command-policy/command-policy.ts` co-changes with `command-policy-types.ts`, `command-risk.ts`, `structured-command-risk.ts`, `command-safe-rules.ts`, and `path-authority.ts` (because they form one subsystem).
- `apps/vscode/src/sdk/sdk-tool-policies.ts` co-changes with the core `command-policy` cluster (because the host wrapper threads core policies through approval).

## Sectors by change-radius profile

| Sector | Top hot files | Change-radius profile |
|---|---|---|
| Task-state shadow | `SdkController.ts` + 6 shadow-cluster files | High radius, deep interconnection. Every change to the wiring touches the wiring file. |
| Command policy / path authority | `command-policy.ts`, `command-safe-rules.ts`, `structured-command-risk.ts`, `path-authority.ts` (all in core) + `sdk-tool-policies.ts` (host) | High radius on the core side; medium on the host side. Sub-cluster within core. |
| Session autonomy / auto-approval | `SdkController.ts`, `session-auto-approval.ts`, `sdk-tool-policies.ts` | Medium radius; concentrated on SdkController. |
| Process supervision | `command-job-manager.ts`, `sandbox-policy.ts` | Lower radius (19 + 12) but high single-file weight. |
| Working-context capture | `SdkController.ts` + `working-context-host-capture.ts` | Low single-file weight; changes flow through SdkController. |

## What this means for factorization

1. **`SdkController.ts` is the central bottleneck.** Every architectural change to the host adapter requires editing this file. Splitting it would not reduce the *number* of touches — it would just redistribute them across smaller files.
2. **The command-policy cluster has high internal cohesion.** The 4 hottest core files (`command-policy.ts`, `command-safe-rules.ts`, `structured-command-risk.ts`, `path-authority.ts`) form a unit. Any factorization that touches one almost certainly touches all four.
3. **The task-state shadow cluster is high-radius and dispersed.** `SdkController.ts` (88), `task-state-shadow-host-wiring.ts` (22), `task-state-shadow.ts` (13), `task-state-shadow-arbiter-mapper.ts` (12), `task-state-shadow-recorder.ts` (11), `task-state-shadow-coordinator.ts` (10) — six files, all co-evolving.
4. **`sdk-tool-policies.ts` is the bridge** between core command-policy and host approval flow. 23 commits.

