# C6 — Verdict and Evidence Closure

**ACT:** `ACT-CLINEMM-POSTMERGE-VSCODE-REACHABILITY-SECURITY-QUAL01`
**Branch:** `main`
**Source HEAD:** `08d8969e161f94e76c22165a0be1e1e36892d975`
**Source tree:** `c0730c252b50cafd2d33393be021f8e668fcb9e6`
**Upstream merge:** `167f5ca8d639cc83c21ddf8e0d96369cfc319d0a`
**Pre-integration fork:** `265044bf37429cb3c48918eb7473e46cc3933964`
**Promoted anchor:** `251779fdf80a9782e00ddf12996813433c7a7bbb`

---

## C6.1 Verdict

# `PASS_WITH_NONBLOCKING_RESIDUE`

> **This verdict is NOT a claim that all imported upstream code is secure.** It is
> bounded to the question this ACT was chartered to answer: *what new upstream code
> can execute in our actual VS Code extension, what authority does it have, and did
> the integration introduce any demonstrable unsafe capability?*

### The charter question, answered

**What new upstream code can execute in our actual VS Code extension?**

The upstream merge added **1,182 paths** across `apps/vscode/` and `sdk/`. After
tracing the actual message and authority flow — not import names — the *reachable*
set is small and bounded:

| Class | What it is |
|---|---|
| **REACHABLE_ACTIVE** | Session lifecycle/start/control (strengthened), the tool-approval gate (unchanged), the editor effective-destination authority (unchanged), the MCP hub client (stdio spawn unchanged; `readResource` added, MCP-server-scoped), the remote-config/telemetry egress (existing), the ClineRules/skills/hook readers (existing) |
| **REACHABLE_GATED** | Cline Cloud sessions (feature flag **and** user opt-in, plus a server-side entitlement check), the 8 new cloud gRPC RPCs (UI-gated; read-only + browser URL-open + one state write), MCP OAuth on remote MCP servers (user-configured), MCP Apps (dormant — never enabled in VS Code, no renderer), the agent-plugin MCP path (requires an installed plugin) |
| **CLI_DESKTOP_ONLY** | The entire Hub subtree (daemon, WebSocket server, runtime host, remote host), the plugin loader / plugin runtime / plugin tools, the Host Bridge token machinery, the local cloud dev server, cloud-handoff, session-import, team/multi-agent, worker-sandbox, remote environments |

The decisive structural evidence is the **shipped bundle**:

```
grep -c 'HubRuntimeHost'                     apps/vscode/dist/extension.js → 0
grep -c 'hub-websocket-server|browser-websocket' apps/vscode/dist/extension.js → 0
grep -c 'cline-hostbridge-token'              apps/vscode/dist/extension.js → 0
unzip -l <vsix> | grep 'extension/standalone'  → (absent)
unzip -l <vsix> | grep 'extension/node_modules' → 0 entries
```

plus the single explicit pin `backendMode: "local"` at
`apps/vscode/src/sdk/vscode-session-host.ts:475` — the **only** `backendMode`
occurrence in `apps/vscode/src`.

**What authority does it have?**

The reachable additions are: (a) **session-ownership fences** (strictly narrowing),
(b) a **cloud control-plane client** that is server-authorized by the user's Bearer
token and executes every tool inside a **remote sandbox** (no local executors), and
(c) an **MCP client** whose stdio-spawn authority is byte-identical to the pre-merge
implementation.

**Did the integration introduce any demonstrable unsafe capability?**

**No.** Zero P0, zero P1. Fifteen P2 items, every one of them either pre-existing
and unchanged, upstream-favourable, structurally unreachable, test-surface-only, or
gated and server-authorized.

---

## C6.2 Why this is not `PASS_REACHABILITY_SECURITY`

The distinction is deliberate. `PASS_REACHABILITY_SECURITY` would assert that the
targeted checks passed **and** that there is nothing left to qualify. Three
reachable behaviours remain **unqualified** and are handed to successor ACTs:

1. **R-02** — the cloud start path (`newTask.ts:73`) branches on
   `request.executionTarget === "cloud"` **without** a local feature-flag check. The
   operation is server-authorized and remotely sandboxed, so it is not an unsafe
   capability — but the *local* gate is genuinely open and should be closed.
2. **R-03** — the SDK file-read executor performs **no** workspace containment, and
   the VS Code override rewrites only relative paths. This is a pre-existing fork
   condition; it is reachable in ordinary operation and has no read-side approval
   equivalent to the editor path.
3. **R-06** — `@modelcontextprotocol/sdk@1.30.0` is below the fix floor for five
   advisories. The version is **identical pre- and post-merge** (so it is not
   merge-induced), but the reachable client-side sub-cases are only *gated*, not
   closed.

In addition, the following gates were **not executable** on this host and are
recorded as such rather than silently omitted.

---

## C6.3 Evidence closure

### Identity

| Item | Value |
|---|---|
| Source HEAD | `08d8969e161f94e76c22165a0be1e1e36892d975` |
| Source tree | `c0730c252b50cafd2d33393be021f8e668fcb9e6` |
| Upstream merge identity | `167f5ca8d639cc83c21ddf8e0d96369cfc319d0a` (parents `265044bf…`, `a6507a6…`) |
| Branch | `main` |
| Working tree at close | clean except this ACT's evidence + the board update |
| Installed VSIX / bundle hash inspected | `dist/clinemm-4.1.16-281b379d0.vsix` → `2a7bcd8ed02c85490a1515e93233085f2330b44bc77b41b703cd9932becfd518`; `apps/vscode/dist/extension.js` → `5fbef53e8063508d099d3ecd445c89cb731ffeffc7404ee7334f3e40a653a078` |

### Exact test commands, exit codes, and failure identities

| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `cd sdk/packages/core && bun x vitest run src/extensions/tools/executors/editor.realpath-authority.test.ts` | **1** | 3 failed (C/D/E) \| 4 passed (A/B/F/H) — **historical baseline reproduced exactly** |
| 2 | `cd apps/vscode && bun x vitest run --config vitest.config.ts src/sdk/__tests__/editor-effective-destination-approval.r0-green.test.ts …r3-composed-movepath.qual.test.ts …r4-necessity-ablation.qual.test.ts` | **0** | **10/10 PASS** |
| 3 | `cd apps/vscode && bun x vitest run --config vitest.config.ts src/sdk/__tests__/approval-rejection-correlation-fail-closed-recon01.test.ts src/sdk/__tests__/task-control-liveness.tcl-parent.test.ts src/sdk/__tests__/task-control-liveness.tcl-parent.adversarial.test.ts` | **0** | **15/15 PASS** |
| 4 | `cd sdk/packages/core && bun x vitest run src/runtime/command-policy/path-authority.realpath.test.ts src/runtime/command-policy/command-risk-corpus.path-authority.test.ts` | **0** | **49/49 PASS** |
| 5 | `cd sdk/packages/core && bun x vitest run src/extensions/mcp/__qual01_oauth_origin_bound_probe.test.ts` (disposable probe, real production function, in-memory fetch) | **0** | **1/1 PASS** |
| 6 | `cd sdk/packages/core && bun x vitest run src/extensions/mcp/client.test.ts -t 'stops a server that closes stdin'` | **1** | 2 failed — **identical at the merge commit** (`MERGE_BASELINE_EXIT=1`) |
| 7 | `cd /tmp/qual01/merge-wt/sdk/packages/core && bun x vitest run src/extensions/mcp/client.test.ts -t 'stops a server that closes stdin'` (merge commit `167f5ca8`) | **1** | **2 failed — identical** (baseline comparator) |
| 8 | `cd apps/vscode && bun test src/core/storage/StateManager.test.ts` | **1** | 1 failed — **reproduces identically at the merge commit** |
| 9 | `cd /tmp/qual01/merge-wt2/apps/vscode && bun test src/core/storage/StateManager.test.ts` (merge commit `167f5ca8`) | **1** | **1 failed — identical** (baseline comparator) |
| 10 | `cd apps/vscode && bun test src/services/mcp/__tests__/sessionIdEcho.isolation.test.ts` (default PATH) | **1** | 3 failed — `Executable not found in $PATH: "node"` |
| 11 | `cd apps/vscode && PATH="$HOME/.bun/bin:/opt/homebrew/bin:$PATH" bun test src/services/mcp/__tests__/sessionIdEcho.isolation.test.ts` | **0** | **6/6 PASS** — proves the host PATH gap |
| 12 | `cd apps/vscode && bun run test:unit` (default PATH) | 1 | 112/112 files; **canonical (post-retry): 4 files / 5 assertions** fail (29 provisional; 5 files flaky-under-load pass on the runner's serial retry) |
| 13 | `cd apps/vscode && PATH="$HOME/.bun/bin:/opt/homebrew/bin:$PATH" bun run test:unit` | 1 | 112/112 files; **canonical (post-retry): 5 files / 8 assertions** fail (37 provisional; 6 files flaky-under-load pass on serial retry) |
| 13b | `cd apps/vscode && PATH="$HOME/.bun/bin:/opt/homebrew/bin:$PATH" bun test src/core/hooks/__tests__/taskcomplete.test.ts` | **0** | **14/14 PASS** — proves the last hook file's retry failure is a parallel-load 5 s timeout, not a defect |
| 14 | `cd sdk/packages/core && bun /tmp/qual01/epipe-discriminator.mjs` | 0 | `EPIPE_ERROR_EVENT_SEEN: false code: null` |
| 15 | `cd sdk/packages/core && bun /tmp/qual01/epipe-discriminator2.mjs` (exact upstream fixture geometry) | 0 | `EPIPE_ERROR_EVENT_SEEN: false code: null` |
| 16 | `bun audit --prod --json` (repo root) | 1 (advisories found) | **Audit EXECUTED**; 42 advisory-bearing packages |

### Canonical-vs-provisional counting note

The unit runner (`apps/vscode/scripts/run-bun-unit-tests.ts`) **retries each failing
file serially** before declaring it failed. The **canonical** result is the
post-retry outcome. The pre-retry per-file counters are provisional and double-count
the same files, so they must not be read as the failure count. Both numbers are
recorded above so the raw receipts remain auditable.

### Failure identities

| Identity | Where | Merge-induced? |
|---|---|---|
| `editor.realpath-authority.test.ts` cases **C**, **D**, **E** | `sdk/packages/core` | **No** — pre-existing fork RED; identical baseline |
| `client.test.ts` "stops a server that closes stdin but stays alive" (honors/ignores SIGTERM) | `sdk/packages/core` | **No** — identical at the merge commit; macOS emits no EPIPE |
| `StateManager.test.ts` "loads and persists state without reading or watching legacy agent configs" | `apps/vscode` | **No** — identical at the merge commit (upstream's own test defect) |
| `McpHub.callTool.test.ts` observer-payload exact-equality (×2) | `apps/vscode` | **No** — pre-merge fork commit `5705e305b` |
| `host-bridge-auth.test.ts`, `host-bridge-client-auth.test.ts` | `apps/vscode` | **No** — stale `node_modules`; and **structurally unreachable in VS Code** |
| hook-process suites (3 assertions, `taskcomplete` only, post-retry) | `apps/vscode` | **No** — 5 s per-test timeout under parallel load; **14/14 PASS in isolation** |
| hook-process suites (8 provisional assertions across 6 files) | `apps/vscode` | **No** — flaky-under-load; **passed on the runner's serial retry** |

### Advisory sources and audit scope

| Item | Value |
|---|---|
| Audit command | `bun audit --prod --json` |
| Audit tool | Bun `1.3.13` |
| Audit status | **EXECUTED** (exit 1 = advisories found, not an execution failure) |
| Audit scope | **Production dependencies** (`--prod`) of the whole workspace lockfile |
| Advisory-bearing packages | 42 |
| **Changed by the upstream merge** | **1** (`@ai-sdk/provider-utils` 5.0.27 → 5.0.72) — **outside its advisory range in both versions** |
| **Unchanged by the merge** | **41** |
| New vulnerable versions introduced by the merge | **0** |
| Cline Hub / Kanban WebSocket advisories | **None applicable** — the Hub WebSocket server is tree-shaken out of the VS Code bundle |
| `bun audit fix` / `bun install` / automatic upgrades | **NOT RUN** (forbidden by the ACT) |

### Unexecuted / live-unobservable gates

| Gate | Status | Reason |
|---|---|---|
| Installed-extension live verification | `LIVE_UNOBSERVABLE` | No VS Code installation on this host; all four extension directories are empty |
| `build-provenance.json` verification | `UNOBSERVED` | The artifact is absent from `apps/vscode/dist/` |
| Live provider-wire qualification | `NOT_EXECUTED` | Out of scope; accepted prior limitation; no credentials used |
| Live CLI cross-client qualification | `NOT_EXECUTED` | CLI is separately qualified; out of scope |
| New local-listener probe (P4 candidate) | `NOT_APPLICABLE` | No newly reachable listener exists in the VS Code extension |
| `@cline/core` typecheck baseline | `NOT_EXECUTED` | Known test-only baseline diagnostics; not a reachability gate |
| Real-macOS-Node live extension run | `NOT_EXECUTED` | No VS Code host available |

### Reproduction artifacts for any P0

**None — there is no P0.** No reproduction artifacts are retained for P0 because no P0
was demonstrated. All disposable probe material lives under `/tmp/qual01/` (outside the
repository) and was not committed; the disposable git worktrees at
`/tmp/qual01/merge-wt` and `/tmp/qual01/merge-wt2` were removed with
`git worktree remove --force`, leaving `git worktree list` showing only the four
pre-existing entries.

---

## C6.4 Final risk disposition

| Severity | Count | Disposition summary |
|---|---|---|
| **P0** | **0** | — |
| **P1** | **0** | — |
| **P2** | **15** | R-01…R-15 — 5 actionable successors (R-01, R-02, R-03, R-06, plus the test-surface cleanup R-11/R-12/R-13); the rest are Accept |

**No production change was made or is expected from this ACT.** The five actionable
items are handed to focused successor ACTs; none of them meets the bar for a
"substantial production repair" inside a qualification ACT, and none is a P0.

### Explicit non-claims

- **No live exploitation is claimed anywhere in this ACT.** Every reachable-behaviour
  statement rests on structural source/bundle analysis, a synthetic probe against a
  real production function, or an existing production test seam.
- **A passing audit does not establish safety.** The audit is reported with its
  scope, its unchanged/changed split, and the reachability of each advisory.
- **A failing test is not automatically a regression.** Each failure was attributed
  by comparing against the exact merge commit in a disposable worktree, and by
  isolating host-environment causes.
- **The historical three-case realpath RED was not reinterpreted.** It was
  reproduced exactly, attributed to the pre-existing fork (the test file predates the
  merge), and shown to remain compensated by a fail-closed approval seam the merge
  did not weaken.

---

## C6.5 Successor

Proceed to **`ACT-CLINEMM-EMBEDDED-MCP-CONTROL-SEAM-RECON01`**, using the confirmed
security boundaries as input:

1. **The MCP control seam is the right next subject** — it is the one place where a
   reachable upstream surface (MCP client + OAuth) meets an advisory that the merge
   *partially* mitigated (origin-bound fetch in the SDK path, **not** in the VS Code
   `McpHub` path). C4 P3b established that gap structurally.
2. **Confirmed boundary to build on:** MCP stdio spawn authority is **unchanged** by
   the merge (0 diff lines) — the seam's pre-merge baseline is stable.
3. **Confirmed boundary to build on:** the MCP client stdio child containment is
   intact (SIGTERM→SIGKILL escalation at `client.ts:310-359`); the only delta is
   fail-fast **latency** on macOS because the platform emits no EPIPE error event.
   That latency characteristic should be part of the recon's baseline.
4. **Carry forward as explicit inputs:** R-06 (SDK version + origin-binding gap),
   R-07 (stdio spawn authority unchanged), R-08 (Hub is CLI-only — do not audit it as
   a VS Code surface), and R-02/R-03 (the two local-gate successors).
