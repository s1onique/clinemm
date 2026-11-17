# ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-CORR01 — Bounded correction of the MCP execution-control concurrency contract

**Type:** bounded production correction of the `ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01` control layer
**Epic:** `EPIC-CLINEMM-TRACE-AND-ACCEPTANCE-EVIDENCE`
**Workstream:** W01 (successor of `ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01`)
**Predecessor consumed:** `ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01` (implementation at `9c9506f0c6fd`) — **consumed, not re-done**.

## Decision inherited

`HALT_MUTATION_CONCURRENCY_CONTRACT` — the mutation grant is **not** enabled in the
regular `codium-clinemm` profile until this correction lands and the bundle is
rebuilt from the exact final implementation HEAD.

## The five bounded defects

| ID | Severity | Defect | Production site |
|---|---|---|---|
| C1 | P0 | Request replay returned the WRONG outcome: the active-owner check ran BEFORE the idempotency ledger, so a replay of an accepted request returned `rejected(active-task-owner-exists)` instead of the recorded `accepted` outcome. | `control-seam-server.ts` `handleStartAct` |
| C2 | P0 | Two DIFFERENT request ids could both pass the no-active-session check while neither start had finished; both reached `authority.startAct()`. No global in-flight start reservation existed. | `control-seam-server.ts` `handleStartAct` |
| C3 | P0 | `clinemm_read_events` compared the requested session against the CURRENTLY ACTIVE session, not against a session the mutation client started. A valid write credential could read an independently UI-started task. | `control-seam-server.ts` `handleReadEvents` |
| C4 | P1 | The 64-entry idempotency ledger evicted the OLDEST entry unconditionally, including an IN-FLIGHT one. A later duplicate could then be treated as NEW. | `control-seam-operation-ledger.ts` `evictIfNeeded` |
| C5 | P1 | Async responses could arrive OUT OF ORDER on one socket, while the client matches replies through a FIFO pending queue. | `control-seam-server.ts` `handleConnection` |

## The correction (bounded)

1. **C1** — the ledger lookup moves AHEAD of the active-owner check. A recorded
   outcome is the authority for a replay.
2. **C2** — a SINGLE-SLOT in-flight start reservation is taken synchronously
   (before any `await`) and released in a `finally`. A second start with a
   different request id is refused `rejected(start-already-in-flight)` and never
   reaches the lifecycle.
3. **C3** — the event-read fence is the session THIS mutation client started
   (`ownedSessionId`), recorded when its own `clinemm_start_act` was accepted.
   `undefined` means every event read is refused.
4. **C4** — an IN-FLIGHT (`pending`) ledger entry is NEVER evicted. The bound
   applies to the COMPLETED entries; the server's single-slot reservation keeps
   the pending count at one, so the ledger is bounded by `maxEntries + 1`.
   `complete()` now carries the payload fingerprint so a re-inserted entry stays
   bound to its payload.
5. **C5** — each request line on a socket gets a monotonic sequence number; a
   settled response is buffered and flushed in REQUEST order.

## Conservation (explicit)

- The controller lifecycle is **UNCHANGED** — the start still routes through the
  EXISTING `SdkController.initTask()` → `SdkTaskStartCoordinator.initTask()` →
  `SdkSessionLifecycle.startNewSession()` chain.
- The authorization model is **UNCHANGED** — the separate, instance-bound,
  workspace-bound, constant-time-compared write credential, DEFAULT OFF, with
  the content-read sub-grant still separate.
- The two new MCP operations are **UNCHANGED** — `clinemm_start_act` and
  `clinemm_read_events` keep their exact identities, request shapes and
  response shapes.
- The read-only view is **UNCHANGED** — a client with no valid write credential
  sees EXACTLY the original two operations and `readOnly: true`.
- No approval bypass, no cancel, no feedback, no shell shortcut, no editor-tool
  bypass, no hidden approval, no settings modification.
- No new runtime, no second `ClineCore` / `LocalRuntimeHost` / `SessionRuntime`,
  no second execution loop, no new event bus.

## Required behavioral RED → GREEN

| Witness | Requirement |
|---|---|
| C1-1 | An accepted-request replay AFTER the active session becomes visible returns the SAME recorded outcome. |
| C2-1 | TWO simultaneous different-key starts while session creation is blocked — exactly ONE reaches the lifecycle. |
| C3-1 | Cross-task event-read denial: a write credential that did not start the session cannot read it. |
| C4-1 | An IN-FLIGHT ledger entry is never evicted. |
| C5-1 | Same-socket response ordering: replies arrive in REQUEST order. |

Plus conservation witnesses: a valid READ credential alone still cannot mutate;
the read-only operation view is unchanged; the mutation-authorized view still
shows exactly the two write operations.

## Exit rules

- Behavioral RED reproduced against the UNMODIFIED production code, then GREEN.
- One necessity ablation per production fix.
- The existing V1 suite (31 tests) still passes.
- The control-seam suite shows no new failure against the pristine baseline.
- Typecheck EXIT 0; lint EXIT 0; the extension bundle builds.
- The artifact identity is bound to the exact final implementation HEAD.
- The live pilot stays PENDING until the operator rebuilds and installs.

## Verdict

`PASS_STRUCTURAL_ONLY` — the bounded correction is implemented and the
executable gates pass. The **live** pilot remains PENDING operator action: the
bundle must be rebuilt from the exact final implementation HEAD and installed
before the mutation grant is enabled in the regular `codium-clinemm` profile.
