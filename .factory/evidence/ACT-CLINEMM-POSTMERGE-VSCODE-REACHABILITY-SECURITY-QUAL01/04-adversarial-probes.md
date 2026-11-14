# C4 — Bounded Adversarial Execution

**Source HEAD:** `08d8969e161f94e76c22165a0be1e1e36892d975`
**Upstream merge:** `167f5ca8d639cc83c21ddf8e0d96369cfc319d0a`
**Pre-integration fork:** `265044bf37429cb3c48918eb7473e46cc3933964`

Probe selection was driven by the C1–C3 evidence, not by the plan's examples:

| Probe | Chosen because | Production seam |
|---|---|---|
| **P1 — File authority (editor effective destination)** | The editor executor is the only local-write surface whose containment lives *outside* the executor; the merge touched the executor | `sdk/packages/core/src/extensions/tools/executors/editor.ts:createEditorExecutor` → `apps/vscode/src/sdk/editor-path-authority.ts:classifyEditTarget` → `apps/vscode/src/sdk/sdk-interaction-coordinator.ts:912` |
| **P2 — Tool approval + session ownership** | The merge rewrote all three session coordinators (+622/−337) and added a `taskViewGeneration` fence; a stale/foreign id acting on the current session is the exact C2 question | `apps/vscode/src/sdk/sdk-task-control-coordinator.ts`, `sdk-session-lifecycle.ts`, `sdk-interaction-coordinator.ts` |
| **P3 — MCP header origin-binding (upstream-introduced hardening)** | The merge added `createOriginBoundMcpHeadersFetch` — a new security control with no dedicated test. Its correctness must be proven, not assumed | `sdk/packages/core/src/extensions/mcp/oauth.ts:77` |
| **P4 — MCP stdio child containment (upstream-introduced)** | Upstream commit `5b6763198` added child-stdin EPIPE handling; the merge's `client.test.ts` additions fail on this host | `sdk/packages/core/src/extensions/mcp/client.ts:498-520` (stdin error handler) |

**P4 (network control surface) was NOT selected.** C1 established that the VS Code
extension opens **no new local listener**: every upstream listener-creating addition
inside `apps/vscode/src/` is in a test/dev file excluded from the VSIX, and the Hub
WebSocket server is tree-shaken out of the bundle
(`grep -c 'hub-websocket-server\|browser-websocket' apps/vscode/dist/extension.js` → 0).
There is therefore no newly reachable listener to probe, and no listener was exposed.

All probes used **disposable fixtures** under `os.tmpdir()` / `/tmp/qual01`. No real
credentials, no network abuse, no production filesystem writes, no provider spend.

---

## P1 — File authority (editor effective destination)

### Production seam

The real editor executor, the real realpath classifier, and the real approval
composition are exercised. The RED matrix calls the SAME production
`createEditorExecutor()`; it does not re-implement the authority primitive.

### Invariant

- Cases **A** (clean in-cwd write), **B** (relative lexical traversal `../`),
  **F** (in-root canonical variant), **H** (ordinary workspace edit) → **allowed**.
- Cases **C** (absolute outside target), **D** (existing symlink escape:
  lexical-inside, effective-outside), **E** (nonexistent descendant of an outside
  root) → **refused** (the historical RED matrix).

### Command receipt

```
$ export PATH="$HOME/.bun/bin:$PATH"
$ cd sdk/packages/core
$ bun x vitest run src/extensions/tools/executors/editor.realpath-authority.test.ts
EXIT=1
```

Exact per-case result:

```
 ✓ A. control: clean write inside cwd passes 7ms
 ✓ B. relative lexical traversal escape (../...) is refused today 4ms
 × C. ABSOLUTE OUTSIDE TARGET — RED: must be refused 9ms
 × D. EXISTING SYMLINK ESCAPE — RED: lexical-inside must still be refused (effective destination) 2ms
 × E. nonexistent descendant of an outside root — RED: must be refused 2ms
 ✓ F. control: in-root canonical variant still passes 1ms
 ✓ H. control: ordinary workspace edit still passes 2ms

 Test Files  1 failed (1)
      Tests  3 failed | 4 passed (7)
```

Failure identity (case E):

```
AssertionError: promise resolved "'File created successfully at: /private/var/…/outside/deep/sub/e.txt'"
instead of rejecting
```

### Causal discriminator

| Question | Answer |
|---|---|
| Was this RED present **before** the merge? | **Yes.** `git cat-file -e 265044bf…:sdk/packages/core/src/extensions/tools/executors/editor.realpath-authority.test.ts` → `EXISTS` (the file predates the merge) |
| Did the merge change the executor's path resolution? | **No.** The merge diff for `editor.ts` is one error-message hunk only |
| Did the merge change the containment classifier? | **No.** `apps/vscode/src/sdk/editor-path-authority.ts` and `editor-auto-approval-policy.ts` are **not** in the merge diff |
| Did the merge change the approval composition? | **No.** `sdk-interaction-coordinator.ts` is not in the merge diff |
| Is the compensating control intact? | **Yes** — see P1b |

**Verdict: `NOT_REPRODUCED_AS_A_MERGE_REGRESSION`.** The three RED cases reproduce
**exactly** as the accepted historical baseline. This is a **pre-existing fork
defect**, and the merge neither introduced it nor made it newly reachable.

### P1b — Compensating-control probe (the authority that actually gates the write)

The write is gated one layer up, at approval time. The production approval seam was
exercised directly:

```
$ cd apps/vscode
$ bun x vitest run --config vitest.config.ts \
    src/sdk/__tests__/editor-effective-destination-approval.r0-green.test.ts \
    src/sdk/__tests__/editor-effective-destination-approval.r3-composed-movepath.qual.test.ts \
    src/sdk/__tests__/editor-effective-destination-approval.r4-necessity-ablation.qual.test.ts
EXIT=0

 ✓ src/sdk/__tests__/editor-effective-destination-approval.r0-green.test.ts (4 tests) 120ms
 ✓ src/sdk/__tests__/editor-effective-destination-approval.r3-composed-movepath.qual.test.ts (3 tests) 119ms
 ✓ src/sdk/__tests__/editor-effective-destination-approval.r4-necessity-ablation.qual.test.ts (3 tests) 9ms
 Test Files  3 passed (3)
      Tests  10 passed (10)
```

Structural confirmation of the fail-closed policy:

- `editor-path-authority.ts:104` `classifyEditTarget` realpath-canonicalizes **both**
  the target and the workspace root; any error → `unavailable` (fail closed).
- `editor-path-authority.ts:262` `aggregateClassifications` →
  `UNAVAILABLE > OUTSIDE > INSIDE`, order-independent.
- `sdk-interaction-coordinator.ts` → `evaluation.decision.kind === "allow"` is
  reached only for `inside`; `OUTSIDE`/`UNAVAILABLE` fall through to the **ASK**
  publication, so the executor is not invoked without a user decision.
- `vscode-session-host.ts:477` shows the `requestToolApproval` capability wiring is
  **not** in the merge diff.

**Exact negative + conservation assertions:** all 10 PASS.

---

## P2 — Tool approval denial and session/control ownership

### Production seam

`apps/vscode/src/sdk/sdk-interaction-coordinator.ts` (approval), plus the three
session coordinators the merge rewrote.

### Invariant

1. A **denied** approval must not invoke the executor.
2. A **stale or foreign** task id must not take ownership of, or trigger execution on,
   the current session.

### Command receipt

```
$ cd apps/vscode
$ bun x vitest run --config vitest.config.ts \
    src/sdk/__tests__/approval-rejection-correlation-fail-closed-recon01.test.ts \
    src/sdk/__tests__/task-control-liveness.tcl-parent.test.ts \
    src/sdk/__tests__/task-control-liveness.tcl-parent.adversarial.test.ts
EXIT=0

 ✓ src/sdk/__tests__/task-control-liveness.tcl-parent.test.ts (3 tests) 60ms
 ✓ src/sdk/__tests__/task-control-liveness.tcl-parent.adversarial.test.ts (6 tests) 130ms
 ✓ src/sdk/__tests__/approval-rejection-correlation-fail-closed-recon01.test.ts (6 tests) 682ms

 Test Files  3 passed (3)
      Tests  15 passed (15)
```

**Exact negative + conservation assertions:** all 15 PASS.

### Causal discriminator — did the merge widen this boundary?

| Question | Answer |
|---|---|
| Did the merge change `requestToolApproval` wiring? | **No** — absent from the merge diff of `vscode-session-host.ts` |
| Did the merge *narrow* it? | **Yes.** The merge **added** `taskViewGeneration` / `claimTaskViewGeneration()` (a supersession fence) in `sdk-task-control-coordinator.ts`, plus `turnGeneration`, `pendingStarts`, `waitForTurnSend`, and a caller-supplied `shouldContinue: () => boolean` predicate in `sdk-session-lifecycle.ts` |
| Does a foreign/stale id act on the current session? | **No** — the adversarial suite is GREEN |

**Verdict: PASS — the merge strengthened this boundary.** No RED; the hypothesis
"the merge expanded approval or session-ownership authority" is **NOT_REPRODUCED**.

---

## P3 — MCP header origin-binding (upstream-introduced hardening)

### Production seam

`sdk/packages/core/src/extensions/mcp/oauth.ts:77`
`createOriginBoundMcpHeadersFetch` — the function the upstream merge **added**, wired
at `sdk/packages/core/src/runtime/orchestration/runtime-builder.ts:253`
(`restrictConfiguredHeadersToOrigin: true`).

### Invariant

On a **cross-origin** redirect, the configured headers and the sensitive headers
(`authorization`, `cookie`, `proxy-authorization`) must be **stripped**; on a
same-origin request they must be **preserved**.

### Method

A **disposable** probe was authored against the **real exported production
function**, using an **in-memory fake `fetch`** — no network, no credentials, no real
MCP server, no listener. The probe file was copied into the package only for the run
and **removed immediately afterwards** (`rm -f
./src/extensions/mcp/__qual01_oauth_origin_bound_probe.test.ts`); `git status
--porcelain` was verified clean afterwards.

```ts
const originBoundFetch = createOriginBoundMcpHeadersFetch({
  endpointUrl: "https://mcp.example.com/mcp",
  configuredHeaders: { authorization: "Bearer SECRET-TOKEN", "x-custom": "CUSTOM-VALUE" },
  baseFetch: fakeFetch,          // in-memory; 302 → https://evil.example.net/steal
})
// hop 1: https://mcp.example.com/mcp   (same origin)
// hop 2: https://evil.example.net/steal (cross-origin)
```

### Command receipt

```
$ cd sdk/packages/core
$ bun x vitest run src/extensions/mcp/__qual01_oauth_origin_bound_probe.test.ts
EXIT=0

 ✓ src/extensions/mcp/__qual01_oauth_origin_bound_probe.test.ts (1 test) 6ms
 Test Files  1 passed (1)
      Tests  1 passed (1)
```

### Exact assertions (all passed)

| Assertion | Result |
|---|---|
| Final response status is 200 | PASS |
| Exactly 2 hops observed | PASS |
| Hop 1 (same origin) carries `authorization: Bearer SECRET-TOKEN` | PASS |
| Hop 2 (cross-origin) has `authorization` **stripped** (`null`) | PASS |
| Hop 2 (cross-origin) has `cookie` **stripped** (`null`) | PASS |
| Hop 2 URL is `https://evil.example.net/steal` | PASS |

### Causal discriminator

The mitigation is **upstream-introduced** (absent from `265044bf…`, present at
`167f5ca8…` in `sdk/packages/core/src/extensions/mcp/oauth.ts`), so the probe proves
that a **new** security control behaves as intended.

**Verdict: PASS.** The upstream merge added a working mitigation for GHSA-6prh
(cross-origin redirect header re-send) on the SDK MCP path.

### P3b — Coverage gap this probe exposed (C2 R-08)

The same search shows the VS Code `McpHub` path does **not** use the mitigation:

```
$ grep -n 'createOriginBoundMcpHeadersFetch\|restrictConfiguredHeadersToOrigin' \
    apps/vscode/src/services/mcp/McpHub.ts apps/vscode/src/services/mcp/McpOAuthManager.ts
(no hits)
```

And the VS Code custom HTTP fetch is **byte-identical to the pre-merge version**:

```
$ git show 265044bf…:apps/vscode/src/services/mcp/McpHub.ts | grep -A 12 'const streamableHttpFetch'
1089:  const streamableHttpFetch = (async (url, init) => {
1090-      const response = await fetch(url, init)          ← default fetch: follows redirects, re-sends headers
1091-      if (init?.method === "GET" && response.status === 404) { … }
```

**Disposition:** pre-existing (not merge-induced); the merge *improved* the SDK path
but did not cover the VS Code `McpHub` path. Logged as a **P2 successor** in C5
(R-06). No live exploitation is claimed — this is a **structural** finding supported
by source and by a **synthetic** probe of the SDK-side control.

---

## P4 — MCP stdio child containment (upstream-introduced)

### Why this probe was selected

Upstream commit `5b6763198` ("fix: child-stdin EPIPE and the SAP SDK's winston
handler no longer kill the host process", PR #13762) added child-stdin EPIPE handling
plus **two new tests**. Both fail on this host:

```
$ cd sdk/packages/core
$ bun x vitest run src/extensions/mcp/client.test.ts -t 'stops a server that closes stdin'
EXIT=1
 × fails the request at once and stops a server that closes stdin but stays alive (honors SIGTERM) 20426ms
 × fails the request at once and stops a server that closes stdin but stays alive (ignores SIGTERM) 23060ms
 Tests  2 failed | 19 skipped (21)

AssertionError: expected [Function] to throw error matching
  /MCP server "fake-server" stopped reading its input .*\(write EPIPE\) and did not exit/
but got 'MCP request to "fake-server" (tools/call) timed out after 20s. …'
```

### Invariant

A stdio MCP server that closes its stdin while a request is being written must cause
the pending request to fail **fast** (asserted: < 5 s), and the child must be
escalated SIGTERM → SIGKILL and reaped.

### Causal discriminator — is this a merge-induced defect?

**Step 1 — did the merge change the implementation?** No.

```
$ git diff 167f5ca8… HEAD -- sdk/packages/core/src/extensions/mcp/client.ts
(empty)
```

The implementation is **identical** to the merge commit.

**Step 2 — does it fail at the merge commit too?** **Yes — identically.**

A disposable worktree was created at the exact merge commit:

```
$ git worktree add /tmp/qual01/merge-wt 167f5ca8d639cc83c21ddf8e0d96369cfc319d0a
$ (symlink node_modules) ; cd /tmp/qual01/merge-wt/sdk/packages/core
$ bun x vitest run src/extensions/mcp/client.test.ts -t 'stops a server that closes stdin'
MERGE_BASELINE_EXIT=1
 × fails the request at once and stops a server that closes stdin but stays alive (honors SIGTERM) 20336ms
 × fails the request at once and stops a server that closes stdin but stays alive (ignores SIGTERM) 22284ms
 Tests  2 failed | 19 skipped (21)
+ Received:
"MCP request to \"fake-server\" (tools/call) timed out after 20s. …"
```

**Identical failure, identical error, identical timing at the merge commit.**

**Step 3 — is the *cause* platform-specific?** **Yes.** Two disposable
discriminators were run that replicate the fixture geometry against a child that
closes its stdin:

```
$ bun /tmp/qual01/epipe-discriminator.mjs
EPIPE_ERROR_EVENT_SEEN: false code: null
write callback err: null

$ bun /tmp/qual01/epipe-discriminator2.mjs     # exact upstream fixture geometry
EPIPE_ERROR_EVENT_SEEN: false code: null
```

On **macOS**, writing to a child whose stdin has been closed produces **no `error`
event** and a **null** write callback. The upstream implementation
(`client.ts:498-520`) detects the failure via `child.stdin.on("error", …)`, which
therefore **never fires** on this platform, so the request falls through to the
timeout path instead of the fail-fast path.

The upstream test skips only `process.platform === "win32"`
(`client.test.ts:739`, `:780`) — it does **not** skip `darwin`.

**Step 4 — is the security *property* lost?** **No.** The containment escalation is
intact and unchanged (`client.ts:310-359`):

```
child.kill()                       → SIGTERM
await settlesWithin(processClose, STDIO_MCP_FORCED_SHUTDOWN_TIMEOUT_MS)
child.kill("SIGKILL")              → escalation
```

The observable difference is **latency** (fail-fast at ~0 s vs. the configured
request timeout), not the loss of the termination guarantee.

**Verdict: `NOT_REPRODUCED` as a merge-induced defect — pre-existing macOS
platform test limitation, identical at the merge commit.**

The temporary worktree was removed (`git worktree remove --force`); `git worktree
list` afterwards shows only the four pre-existing entries and `git status --porcelain`
is empty.

---

## P5 — Broad regression signal (VS Code unit suite)

```
$ cd apps/vscode
$ bun run test:unit
```

112 files. Two runs were performed:

The runner (`scripts/run-bun-unit-tests.ts`) **retries each failing file serially**
before declaring it failed. The **canonical** result is therefore the **post-retry**
outcome; the pre-retry per-file counters are provisional and double-count the same
files. Both are recorded below so the raw receipts stay auditable.

**Run A — default PATH (`bun` only).**
Provisional (pre-retry): 29 failing assertions across 9 files.
**Canonical (post-retry): 4 files / 5 assertions still fail** — 5 flaky files
(`taskstart`, `user-prompt-submit`, `myc-prime-automation.lifecycle02`,
`sessionIdEcho.isolation`, `sessionIdEcho.mcpHub`) **passed on serial retry**.

**Run B — PATH including `node` (`$HOME/.bun/bin:/opt/homebrew/bin`).**
Provisional (pre-retry): 37 failing assertions across 10 files.
**Canonical (post-retry): 5 files / 8 assertions still fail** — 6 flaky files
(`hook-factory`, `taskcancel`, `taskresume`, `taskstart`, `user-prompt-submit`, plus
the Run-A flaky set) **passed on serial retry**.

> **Run-completion receipt.** The Run-B wrapper reported `deadline_exceeded` /
> `SIGTERM` (the outer `timeout 1800` fired), but the run itself had already
> completed: the output file contains **all 112 per-file counter lines**
> (indices `1/112` … `112/112`, the last being
> `[112/112] ok 6 pass / 0 fail src/utils/__tests__/git.test.ts`) **and** the
> complete 10-entry retry ledger. The SIGTERM terminated the wrapper after the
> suite had written its final output, not the suite itself.
>
> Run A (job `cmd_mwgxase0xb1i14zn`) exited **0** with the same 112/112 coverage and
> its own 9-entry retry ledger.

The runner's own retry ledger:

```
[retry] ok (flaky) 14 pass / 0 fail  src/core/hooks/__tests__/taskstart.test.ts
[retry] ok (flaky) 14 pass / 0 fail  src/core/hooks/__tests__/user-prompt-submit.test.ts
[retry] FAIL       0 pass / 1 fail  src/core/storage/StateManager.test.ts
[retry] FAIL       0 pass / 1 fail  src/hosts/external/__tests__/host-bridge-auth.test.ts
[retry] FAIL       0 pass / 1 fail  src/hosts/external/__tests__/host-bridge-client-auth.test.ts
[retry] ok (flaky) 4 pass / 0 fail  src/sdk/__tests__/myc-prime-automation.lifecycle02.test.ts
[retry] FAIL       33 pass / 2 fail  src/services/mcp/__tests__/McpHub.callTool.test.ts
[retry] ok (flaky) 6 pass / 0 fail  src/services/mcp/__tests__/sessionIdEcho.isolation.test.ts
[retry] ok (flaky) 11 pass / 0 fail  src/services/mcp/__tests__/sessionIdEcho.mcpHub.test.ts
```

With `node` on PATH the hook-process suites pass on serial retry; their provisional
failures are the fixed 5 s per-test timeout under parallel load (hook spawns take
5.1–5.6 s here). `taskcomplete.test.ts` is the one hook file that still fails on
retry in Run B, and it **passes 14/14 in isolation** (`bun test …/taskcomplete.test.ts`
-> `EXIT=0`, all ✓) — it is the same parallel-load timeout, not a defect.

### Failure classification (Run A)

| File | Tests | Root cause | Merge-induced? |
|---|---|---|---|
| `src/hosts/external/__tests__/host-bridge-auth.test.ts` | 1 | `ENOENT reading …/nice-grpc@2.1.17/node_modules/@grpc/grpc-js` — **stale local `node_modules`** (the symlink points at `@grpc+grpc-js@1.14.5`; the lockfile pins `1.14.4`) | **No** — and **not reachable in VS Code** (see below) |
| `src/hosts/external/__tests__/host-bridge-client-auth.test.ts` | 1 | same | **No** |
| `src/core/storage/StateManager.test.ts` | 1 | `expect(readDirectory).not.toHaveBeenCalled()` — `fs.readdir` called once | **No** — **reproduces identically at the merge commit** (verified via a second disposable worktree: `MERGE_BASELINE_EXIT=1`, same assertion) |
| `src/core/hooks/__tests__/taskstart.test.ts` | 1 | `this test timed out after 5000ms` (hook spawn: 4.3–5.4 s per test) | **No** — passes individually with `node` on PATH |
| `src/core/hooks/__tests__/hook-factory.test.ts` | 6 | `this test timed out after 5000ms` (hook spawn: 5.1–5.6 s per test) | **No** — host-load timeout; the same tests time out in Run A for the same reason |
| `src/core/hooks/__tests__/user-prompt-submit.test.ts` | 1 | `this test timed out after 5000ms` | **No** — same |
| `src/services/mcp/__tests__/sessionIdEcho.isolation.test.ts` | 1 | `ENOENT` / `Executable not found in $PATH: "node"` | **No** — **6/6 PASS** once `node` is on PATH |
| `src/services/mcp/__tests__/sessionIdEcho.mcpHub.test.ts` | 1 | same | **No** — same |
| `src/sdk/__tests__/myc-prime-automation.lifecycle02.test.ts` | 1 | cardinality/timing | **No** |
| `src/services/mcp/__tests__/McpHub.callTool.test.ts` | 2 | exact-equality assertion: the observer payload gained `callId`, `durationMs`, `resultCount`, `outputBytes` | **No** — introduced by **fork** commit `5705e305b` (verified pre-merge via `git merge-base --is-ancestor 5705e305b 265044bf…` → true); the merge did **not** touch this test file or `McpHub.ts` |

### Host-environment gap (root cause of most failures)

```
$ which node
node not found                       (exit 1)
$ ls /opt/homebrew/bin/node
/opt/homebrew/bin/node               (node v26.0.0 — present but NOT on PATH)
```

Every affected test spawns `node` as a child process (`spawn node …
__fixtures__/session-id-echo/whoami.mjs`). With
`export PATH="$HOME/.bun/bin:/opt/homebrew/bin:$PATH"` the `sessionIdEcho.isolation`
file goes from **3 failures → 6/6 PASS** (verified in isolation), confirming the
failures are a **host PATH gap**, not a source defect.

### The host-bridge failures are structurally unreachable in VS Code

| Check | Result |
|---|---|
| Importers of `hosts/external/host-bridge-auth` | `apps/vscode/src/generated/hosts/standalone/host-bridge-clients.ts`, `apps/vscode/src/standalone/{hostbridge-client,cline-core,core-connection-stream}.ts` — **all `standalone/`** |
| `extension.ts` / `SdkController.ts` / `core/controller/index.ts` import `hosts/external`? | **No hits** |
| `extension/standalone/**` present in the VSIX? | **No** (`unzip -l` grep → absent) |
| Bundle references to `cline-hostbridge-token` / `captureHostBridgeTokenFromEnvironment`? | **0** |

### Final canonical failure inventory (post-retry — the authoritative result)

| File | Tests | Root cause | Merge-induced? |
|---|---|---|---|
| `src/core/storage/StateManager.test.ts` | 1 | `fs.readdir` called once | **No** — reproduces identically at the merge commit |
| `src/hosts/external/__tests__/host-bridge-auth.test.ts` | 1 | stale `node_modules` (`@grpc/grpc-js` symlink → `1.14.5`, lockfile pins `1.14.4`) | **No** — and unreachable in VS Code |
| `src/hosts/external/__tests__/host-bridge-client-auth.test.ts` | 1 | same | **No** — unreachable in VS Code |
| `src/services/mcp/__tests__/McpHub.callTool.test.ts` | 2 | exact-equality assertion drift (pre-merge fork `5705e305b`) | **No** |
| `src/core/hooks/__tests__/taskcomplete.test.ts` (Run B only) | 3 | 5 s per-test timeout under parallel load; **passes 14/14 in isolation** (`EXIT=0`) | **No** — host-load |

**Total, canonical: 5 files / 8 failing assertions, of which 5 are in Run A
(4 files) and 8 in Run B (5 files).** All 11 other provisional failures were
flaky-under-load files that **passed on serial retry**.

Additional confirmation for the one hook file that still fails on retry: the merge
**changed** `apps/vscode/src/core/hooks/HookProcess.ts` (+30/−2), but the change is a
**defensive improvement** — it registers `childProcess.stdin.on("error", …)` so a hook
that stops reading its stdin no longer crashes the host process (the same class of
fix as upstream `5b6763198` for the MCP client). It adds **no** authority and did not
touch `taskcomplete.test.ts` (`git diff` → empty).

### Verdict

**PASS_WITH_NONBLOCKING_RESIDUE.** No failure in the broad sweep is attributable to
the upstream merge:
- 2 failures are a **stale local `node_modules`** (source/lockfile are correct);
- 3 (Run B only) are **host-load 5 s timeouts** on hook-process spawns — the file
  passes 14/14 in isolation;
- 1 reproduces **identically at the merge commit** (upstream's own test defect);
- 2 are an exact-equality assertion drift introduced by a **pre-merge fork** commit.

The remaining 11 provisional failures were **flaky-under-load files that passed on
the runner's serial retry**, so they are not defects at all.

**Canonical totals: Run A = 4 files / 5 assertions; Run B = 5 files / 8 assertions.**

None of the 9 failing files exercises an authority boundary that the merge changed.

---

## C4.6 Probe summary

| Probe | Seam | Invariant | Result | Verdict |
|---|---|---|---|---|
| P1 | editor executor + realpath classifier | A/B/F/H allowed; C/D/E refused | 3 failed / 4 passed — **identical to historical baseline**; classifier and approval composition **untouched by the merge** | `NOT_REPRODUCED` as merge regression (pre-existing fork defect) |
| P1b | editor approval composition seam | OUTSIDE/UNAVAILABLE → ASK | **10/10 PASS** | PASS |
| P2 | approval denial + task-control ownership | denied approval ⇒ no executor; stale id ⇒ no ownership | **15/15 PASS** | PASS (merge **strengthened**) |
| P3 | upstream origin-bound MCP fetch | cross-origin ⇒ headers stripped | **1/1 PASS** (synthetic, real function, in-memory fetch) | PASS |
| P3b | VS Code `McpHub` HTTP fetch | origin-binding coverage | no mitigation present; **byte-identical to pre-merge** | structural gap → P2 successor |
| P4 | MCP stdio child containment | fail-fast EPIPE + SIGTERM→SIGKILL | 2 failed at HEAD **and identically at the merge commit**; macOS emits no EPIPE (`EPIPE_ERROR_EVENT_SEEN: false`) | `NOT_REPRODUCED` (platform limitation) |
| P5 | VS Code unit suite (112 files) | broad regression signal | 29 failures, **0 attributable to the merge** | PASS_WITH_NONBLOCKING_RESIDUE |

### Unobserved / unobservable gates

| Gate | Status | Reason |
|---|---|---|
| Installed-extension live verification | `LIVE_UNOBSERVABLE` | No VS Code installation on this host (C0.4) |
| Live provider-wire qualification | `NOT_EXECUTED` | Out of scope for this ACT (accepted prior limitation; no credentials used) |
| Live CLI cross-client qualification | `NOT_EXECUTED` | CLI is separately qualified; out of scope |
| New local listener probe | `NOT_APPLICABLE` | No newly reachable listener exists in the VS Code extension (C1 R-09) |
| `@cline/core` typecheck baseline | `NOT_EXECUTED` | Known test-only baseline diagnostics (accepted prior limitation); not a reachability gate |
