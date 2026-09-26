# Execution cadence (post-C1-GO, no more architecture review)

This file freezes the **staged progression** the reviewer prescribed after `C1: GO`,
so that the implementation ACT can start producing evidence immediately instead of
building all 18 A2A cases first. It is a refinement of the seven phases in `plan.md`
into the cadence Factory prefers: RED → GREEN → first child witness → isolation
edges → conservation.

Reviewer (post-C1-GO):

> One implementation discipline point: do not wait until all 18 cases exist before
> producing evidence. Start with a small executable progression.

```
PLAN_DURABLE                         = PASS
ARCHITECTURE_DECISION                = PASS
PRODUCTION_DISCOVERY_SEAM            = PASS
PRODUCTION_ACQUISITION_SEAM          = PASS
PRODUCTION_TEARDOWN_SEAM             = PASS
STATIC_COMPATIBILITY                 = PASS
CHILD_SIDE_WITNESS_DESIGN            = PASS

P2_EOF_WHITESPACE                    = NON_BLOCKING (fixed in follow-up commit; trailing blank lines stripped)
P2_GATE_SUMMARY_TOOLING              = NON_BLOCKING_AT_PLAN_STAGE

C1 = GO
NEXT = EXECUTE_PHASE_1
```

No more pre-execution architecture review unless implementation produces a **new P0**.
After `PASS_SESSION_BOUND_MCP_ENV`, go directly to real myc dogfood in
`ACT-MYC-CLINEMM02-B-LIVE-SESSION-PROPAGATION01`.

---

## Staged execution cadence

Each stage is sized so its evidence can be captured and reviewed before the next
stage starts. The full 18-row A2A matrix lives behind these stages and is reached
last, not first.

### Stage 1 — Schema RED (no runtime effect yet)

**Code:**
- `apps/vscode/src/services/mcp/schemas.ts` — export one `McpEnvEntrySchema` (XOR
  by disjoint union members); replace the four duplicated inline definitions at
  lines 36, 99, 125, 147 with the shared one.

**Evidence (commit-gated before Stage 2):**
- New `__tests__/schemas.a2a.test.ts` runs the schema union through:
  - A2A-01 legacy string `env`
  - A2A-02 `{ value: "abc" }`
  - A2A-03 `{ fromEnv: "API_KEY" }`
  - A2A-04 `{ fromSession: "sessionId" }`
  - A2A-07 `{ value: ..., fromEnv: ... }` SCHEMA REJECT
  - Round-trip: legacy flat `env = { "API_KEY": "abc" }` parses identically.
- Output: `05-schema-test-output.txt`.

**Gate:** RED tests for the four accept-cases pass (existing behavior preserved);
A2A-07 rejects the multi-source entry; flat `env` round-trips byte-for-byte.

### Stage 2 — Resolver GREEN (pure, projection-only)

**Code:**
- New `apps/vscode/src/services/mcp/envResolver.ts` — pure function
  `resolveEnv(template, rawEnv, sessionCtx) => Record<string, string>` with
  XOR semantics:
  - `{ value }` → constant
  - `{ fromEnv }` → look up in `rawEnv`, REJECT if `required && missing`
  - `{ fromSession: "sessionId" }` → look up `sessionCtx.sessionId`, REJECT if
    `required && !sessionCtx.sessionId`
  - multi-source: schema rejected upstream (Stage 1)
- **Purity invariant (A2A-11 PROJECTION PURITY):** the function MUST NOT mutate
  `rawEnv`. It returns a fresh `env` object (a copy that materializes
  `{fromSession}` entries from `sessionCtx` and `{fromEnv}` entries from
  `rawEnv`). The result may be a fresh object — **reference identity of the
  result with any other object is NOT required and NOT tested.**
  Test contract (reviewer-corrected, replaces the prior `Object.is` clause):
  ```
  before = structuredClone(rawEnv)
  result  = resolveMcpServerEnv(rawEnv, ...)
  assert deepEqual(rawEnv, before)   // rawEnv unchanged
  // result may be a fresh object — that is fine
  ```
  This matches the canonical wording in `plan.md:134-136`: "the function
  MUST NOT mutate `rawEnv`. It returns a fresh `env` object. Test asserts
  referential equality of `rawEnv` before/after."
### Stage 3 — First child witness (A2A-04)

This is the **load-bearing child-side proof**: the first end-to-end test that
spawns a real STDIO MCP server with `fromSession: "sessionId"` and verifies the
child's `process.env` carries the session id.

**Code:**
- `apps/vscode/src/services/mcp/__fixtures__/session-id-echo/whoami.mjs` — real
  MCP server using `@modelcontextprotocol/sdk` (Node ESM), exposes one tool
  `whoami` that returns `{ pid, session, session_keys }` from `process.env`. Run
  via `node whoami.mjs`; real `StdioClientTransport`, real child `process.env`.
- `apps/vscode/src/services/mcp/McpHub.ts` — minimal slice:
  - Add `sessionConnections: Map<string, Map<string, McpConnection>>` (keyed by
    `sessionId` then `serverName`).
  - Add `disconnectSession(sessionId)` public method.
  - Add internal helper `ensureSessionConnection(name, sessionContext)` that
    resolves the template through the new resolver, projects via `rawEnv` +
    `sessionContext`, and (re)uses the session-scoped map entry.
  - Keep all 8 internal `connectToServer` callsites session-agnostic.

**Evidence (this stage is the smallest possible RED→GREEN flip):**
- New `__tests__/session-bound-mcp-env01.a2a.test.ts` (or extension) with ONE
  case first:
  - **A2A-04**: configure `whoami` with
    `env: { SESSION_ID: { fromSession: "sessionId" } }`,
    set `sessionContext = { sessionId: "session-A" }`,
    call `ensureSessionConnection("whoami", { sessionId: "session-A" })`,
    call `client.callTool({ name: "whoami" })`,
    assert `result.session === "session-A"` AND
    `result.pid === child.process.pid` AND
    `result.session_keys` is exactly the union of `rawEnv` keys + `SESSION_ID`.
- Output: `06-mcphub-test-output.txt` (first slice — A2A-04 only at this point).
- Output: `04-child-process-evidence.jsonl` capturing child PID, parent PID,
  `process.env` snapshot, session_id echo.

**Gate:** the child proves it received the session id **via `process.env`**, not
via a parent-side helper-computed value. This is the foundation every later row
depends on.

### Stage 4 — A/B isolation edges

Built on Stage 3's working `sessionConnections` map. Each row isolated so RED
appears immediately if a regression lands.

- **A2A-08** A+B concurrent: two configs sharing the `whoami` server, two
  sessionContexts (`session-A`, `session-B`); assert distinct PIDs, distinct
  `session` echoes.
- **A2A-09** reconnect A: end A, re-start A under same id; assert new PID,
  `session === "session-A"`, B untouched.
- **A2A-10** genericity: configure two env names (`SESSION_ID`,
  `CLINE_SESSION_ID`) both `fromSession: "sessionId"` on same server; assert
  both materialize the same identity in the child's `process.env`.
- **A2A-12** static + session-bound coexist: `legacy-flat-server` (static,
  `env = { "API_KEY": "abc" }`) coexists with `whoami` (session-bound); assert
  legacy is in `staticConnections`, A/B each appear in `sessionConnections`,
  PIDs and connections are disjoint.
- **A2A-13** lifecycle isolation: `disconnectSession("A")` kills only A's child,
  B survives (PID unchanged), `whoami` for B still succeeds.
- **A2A-14** startup defer: settings load with `fromSession` entries and no
  active session → `sessionConnections.size === 0`, NO child process spawned,
  `connections.size === 0` for session-bound; static entries still eagerly
  spawned.
### Stage 5 — Production seams

Now thread the three production edges that the recon identified. Each row drives
the **real production seam**, not a direct call.

**Code:**
- **3b acquire** (`vscode-runtime-builder.ts:47`):
  `McpHubToolProvider.callTool(request)` forwards
  `request.context?.sessionId` to `McpHub.callTool(name, args, { sessionId })`.
  `McpHub.callTool` finds the connection under
  `sessionConnections.get(sessionId)?.get(name) ?? staticConnections.get(name)`,
  falling back to static for legacy configs.
- **3c release** (`sdk-session-lifecycle.ts:591-611`):
  `trackSessionStop(sdkHost, sessionId, reason)` runs
  `Promise.all([sdkHost.stop(sessionId), mcpHub.disconnectSession(sessionId)])`.
  Compaction-coordinator temp-host path (`sdk-compaction-coordinator.ts:341-343`)
  folds through the same `tearDownSession(sdkHost, sessionId, reason)` helper.
- **3d discover** (`vscode-session-host.ts:359`):
  `prepareStartSessionInput(input)` reads `input.config.sessionId`,
  passes it to `createVscodeExtraTools(mcpHub, { sessionId })`
  (`vscode-runtime-builder.ts:124`). `McpHubToolProvider` ctor takes
  `(mcpHub, sessionId?)`; `listTools(name)` calls
  `ensureSessionConnection(name, { sessionId })` when `sessionId !== undefined`.

**Evidence:**
- **A2A-15 PRODUCTION ACQUISITION**: drive `vscode-runtime-builder.ts:47`
  end-to-end through the real production call site; assert `whoami.session`
  echoes the same id produced by `SdkController.initTask`.
- **A2A-16 PRODUCTION TEARDOWN**: drive `sdk-session-lifecycle.ts:591-611`
  end-to-end through `trackSessionStop`; assert A's child is reaped,
  `sessionConnections.get("A")` is gone, B's PID unchanged, B's `whoami`
  still succeeds.
- **A2A-17 PRODUCTION DISCOVERY**: drive `vscode-session-host.ts:359
  prepareStartSessionInput` end-to-end through the real discovery seam;
  assert the `whoami` schema appears in `createMcpTools`'s `AgentTool[]`
  BEFORE any `callTool`, and a subsequent production `callTool` hits the
  SAME child with `session === input.config.sessionId`.
- **A2A-18 DISCOVERY ISOLATION**: drive production discovery twice with
  sessionId A and B; assert distinct PIDs land in
  `sessionConnections.get("A")` and `sessionConnections.get("B")`, same
  `whoami` schema appears in both tool lists, A's discovery does NOT
  reuse B's child.

`03-adversarial-matrix.jsonl` updated to mark all 18 rows.

### Stage 6 — Conservation gates (per `plan.md` Phase 6)

- SW-CM01..04 unchanged (`git diff --stat <previous-entry>..HEAD` scoped to
  non-factory surfaces; no new lint/typecheck violations).
- `git diff --stat ab71b439f..HEAD -- apps/myc` empty (no MYC production
  touched).
- `apps/vscode` `tsc --noEmit` exit 0.
- `apps/vscode` `bun run biome check --write` exit 0 (or unchanged baseline).
- SW-MM01..03 (proto, webview, gRPC) — only triggered if Stages 1–5 modified
  relevant surfaces; expected no-op.

### Stage 7 — Closure

`02-fixture-server-source.txt`, `03-adversarial-matrix.jsonl`,
`04-child-process-evidence.jsonl`, `05-schema-test-output.txt`,
`06-mcphub-test-output.txt`, `07-typecheck-and-biome.txt`,
`08-focused-gates.txt`, `result.json`.

**Result string:** `PASS_SESSION_BOUND_MCP_ENV`.

Then open `ACT-MYC-CLINEMM02-B-LIVE-SESSION-PROPAGATION01` for real myc dogfood.

---

## Why this cadence

- The reviewer explicitly said "do not wait until all 18 cases exist before
  producing evidence." Stage 3 alone proves the load-bearing child-side
  invariant (the entire feature's reason for existing) before any production
  wiring is touched. If Stage 3 fails, Stages 4–5 are moot — we would have
  found the bug in the cheapest possible place.
- Stages 4 and 5 are independently green/red, so a regression in any single
  row is visible in isolation rather than buried in a 500-line test file.
- Stages 1–2 are pure, no `McpHub` plumbing; Stages 3–4 are pure hub plumbing;
  Stage 5 is the only stage that touches production seams. This separates
  "the schema and resolver are correct" from "the production wiring calls
  them correctly" — exactly the separation the reviewer's halt taxonomy
  implicitly assumed.
- The conservation gate (Stage 6) is one mechanical check rather than 18
  separate CI runs, so a FAIL there is unambiguous (scope creep, not a
  test bug).


**Evidence:** extended `__tests__/session-bound-mcp-env01.a2a.test.ts`.
`03-adversarial-matrix.jsonl` records all rows with PASS/FAIL + child PID per row.



**Evidence:**
- Extend `__tests__/schemas.a2a.test.ts` (or new `__tests__/envResolver.a2a.test.ts`)
  with resolver cases:
  - A2A-01..A2A-03 GREEN
  - A2A-05 missing `fromEnv` + `required` REJECT
  - A2A-06 missing `sessionCtx.sessionId` + `required` REJECT
  - A2A-11 PROJECTION PURITY: `rawEnv` deep-equals `structuredClone(rawEnv)`
    taken before the call; result may be a fresh object, that is fine.
- Output: `05-schema-test-output.txt` (resolver tests folded in).

**Gate:** A2A-01..03, A2A-05, A2A-06, A2A-11 pass against the pure resolver.
No `McpHub` change yet — still uses flat `env`.
