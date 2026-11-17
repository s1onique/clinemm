# C0 — Identity and source reconnaissance

**ACT:** `ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01`
**Purpose:** Bounded implementation of the first external MCP execution-control vertical slice.

## C0.1 Repository identity

| Field | Value | Command receipt |
|---|---|---|
| Repository root | `/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm` | — |
| Branch | `main` | `git rev-parse --abbrev-ref HEAD` |
| **Source HEAD (entry)** | **`ae802ca980ae116a3d4c5d35411f4e6628681ac2`** | `git rev-parse HEAD` |
| **HEAD tree (entry)** | **`452d2a27643d985a9ac2a75b74496b701f6c76ba`** | `git rev-parse HEAD^{tree}` |
| HEAD subject | `docs(clinemm): record dogfood version provenance evidence` | `git log --oneline -1` |
| Reference anchor (contract) | `c1aff630fdf6669b9b1e63ec927796e6f5423f07` | ACT contract |
| Extension version | `4.1.26` | `apps/vscode/package.json` |

## C0.2 Protected state — preserved

| Item | Receipt |
|---|---|
| Stash | `git stash list` → **empty** at entry. Temporary `wip-mcp-exec-control` / `wip2` / `wip3` stashes created by this ACT's baseline comparisons were each popped back in the same command and the final list is empty. |
| Worktrees | `/private/tmp/clinemm-stash-recovery-20261117` (protected stash recovery), `/private/tmp/worktree-bun.7ddCHQ`, `…/clinemm-m31-action-first`, `…/clinemm-m31-bounded` — **left in place, untouched** |
| No `reset` / `rebase` / `checkout` / `push` / `reset --hard` / release / VSIX installation | Confirmed |
| Existing real user tasks | **Not modified.** No task was cancelled, resumed, switched, or replaced. |
| C9 / C10, BCB, Elm task-header authority, CPR01 | **UNCHANGED** — see `05-executable-gates.md` for the conservation receipts. |

## C0.3 Toolchain

| Tool | Version | Receipt |
|---|---|---|
| Bun | `1.4.x` (`/opt/homebrew/bin/bun`) | `bun --version` |
| Node | present (`node` on the VS Code extension-host PATH) | runtime, not tooling |
| TypeScript | `tsc --noEmit` via `bunx` | `apps/vscode` |
| Vitest | `4.1.10` | `apps/vscode` |
| MCP SDK | `@modelcontextprotocol/sdk@1.30.0` | `apps/vscode/package.json` |

## C0.4 Production start-path reconnaissance (consumed, not re-derived)

The ACT contract's reconnaissance questions were answered against the
live source before any edit:

| Question | Answer (source) |
|---|---|
| Real task-start boundary | `SdkController.initTask()` → `SdkTaskStartCoordinator.initTask()` → `SdkSessionLifecycle.startNewSession()` |
| Authoritative start acknowledgement | `initTask()`'s return value — the REAL `sessionId` allocated by `startNewSession()` |
| Ownership / fencing | `TaskOperationFence` + `SdkSessionLifecycle`'s active-session state |
| Trustworthy event source | `SdkMessageCoordinator.onSessionEvent()` / `emitSessionEvents()` — the EXISTING publication boundary, using the EXISTING `ClineMessage.seq` / `.epoch` ordering |
| Latest-state projection | `PublishedTaskStateStore` — a single latest-state projection, **not** an event history |
| Predecessor acts consumed | `ACT-CLINEMM-EMBEDDED-MCP-CONTROL-SEAM-RECON01` (read-only seam), `ACT-CLINEMM-MCP-TASK-STATE-PROJECTION01` (published task-state) — both consumed, not re-done |

**No new infrastructure was introduced.** The start routes through the
EXISTING `initTask()` lifecycle and the events are read from the
EXISTING `onSessionEvent` publication point. There is no second
`ClineCore`, no second `LocalRuntimeHost`, no second `SessionRuntime`,
no second execution loop, and no new event bus or event-history
database.

## C0.5 Verdict

**PASS.** Identity is bound to an exact source HEAD; the protected
worktrees are intact; the production start path, the authoritative
acknowledgement, the ownership fence and the event source are all
EXISTING production surfaces; the reconnaissance was consumed rather
than repeated.
