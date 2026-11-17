# C5 — RED → GREEN mapping (R1–R6)

All 31 tests live in
`apps/vscode/src/sdk/control-seam/control-seam.execution-control-v1.test.ts`
and run against the **REAL** `ControlSeamServer` over the **REAL**
AF_UNIX transport, driven through the **REAL** `ControlSeamClient`.
The authority is a fixture standing in for the controller's closures —
but every SECURITY decision (credential comparison, workspace binding,
ledger, scope) is made by **production** server code.

Focused-suite receipt: `01-focused-control-seam-tests.txt`
(`Test Files 1 failed | 7 passed (8)`; `Tests 2 failed | 124 passed (126)`).
The 2 failures are the **pre-existing** COR02 ownership-exclusivity
failures — proved identical on the base commit in
`02-preexisting-failure-baseline.txt`.

## R1 — Unauthorized start

| Test | Assertion | Status |
|---|---|---|
| `R1-1` | A VALID READ credential alone cannot start a task; `mutationNotAuthorized`; **zero** start calls | GREEN |
| `R1-2` | A WRONG write credential cannot start a task; **zero** start calls | GREEN |
| `R1-3` | With mutation DISABLED the write operation is refused even with a plausible credential; **no write credential exists at all** | GREEN |
| `R1-4` | The read credential is **never equal** to the write credential; the write credential is ≥ 32 chars | GREEN |

## R2 — Authorized start

| Test | Assertion | Status |
|---|---|---|
| `R2-1` | An authorized request starts **EXACTLY ONE** task through the authority and returns `accepted` with a session id and the echoed `requestId` | GREEN |
| `R2-2` | `accepted` **ALWAYS** carries the authoritative session id (`session-real-42` / `task-real-42` as the authority reported them) | GREEN |
| `R2-3` | The authority receives the client's prompt **verbatim** | GREEN |
| `R2-4` | A lifecycle failure that cannot be proven yields `unknown_outcome`, **never** `accepted`, and carries no session id | GREEN |

**Production wiring:** `SdkController.startAct` calls the EXISTING
`this.initTask(input.prompt)` and returns the session id `initTask()`
actually produced. `initTask()` → `SdkTaskStartCoordinator.initTask()`
→ `SdkSessionLifecycle.startNewSession()` is the EXISTING production
chain; no second runtime is created.

## R3 — Duplicate request

| Test | Assertion | Status |
|---|---|---|
| `R3-1` | Same request id + same payload → the **SAME recorded outcome**, **ONE** start | GREEN |
| `R3-2` | Same request id + different payload → **REJECTED**; only the FIRST prompt started | GREEN |
| `R3-3` | A duplicate delivered **DURING an in-flight start** joins the in-flight operation (`unknown_outcome`), and **ONE** start total | GREEN |

## R4 — Competing lifecycle operations

| Test | Assertion | Status |
|---|---|---|
| `R4-1` | An EXISTING active task owner → `rejected`; no session id; **no** implicit replace / clear / cancel; **zero** start calls | GREEN |
| `R4-2` | A lifecycle operation that SUPERSEDES the start → `superseded`; **no session id** | GREEN |
| `R4-3` | A superseded start is **RECORDED**, so a replay does not start a task either | GREEN |

**Fence conservation:** the seam never clears, cancels, resumes, or
replaces a task. It REFUSES when an owner exists. The EXISTING
`TaskOperationFence` inside `SdkTaskStartCoordinator` /
`SdkSessionLifecycle` remains the sole authority for whether a start
wins; the seam only relays its outcome.

## R5 — Read events

| Test | Assertion | Status |
|---|---|---|
| `R5-1` | The REAL emitted events are returned in the REAL production order, with their real cursors and text | GREEN |
| `R5-2` | `afterCursor` pages forward; the returned `nextCursor` resumes exactly where it left off | GREEN |
| `R5-3` | The output is **BOUNDED** by `limit` | GREEN |
| `R5-4` | A cursor older than the retained window is reported **EXPLICITLY** as `cursorExpired` | GREEN |
| `R5-5` | A **FOREIGN** session id is refused (`foreignSession`) and discloses nothing about other tasks | GREEN |
| `R5-6` | WITHOUT the explicit content-read grant, **NO** message text is exposed | GREEN |

**Production wiring:** `SdkController` subscribes to the EXISTING
`onSessionEvent` publication boundary and appends the projected events
to the bounded `ControlSeamEventBuffer`. The events retained are the
events the UI saw, with their existing `seq` / `epoch` identity.

## R6 — Safety / adversarial

| Test | Assertion | Status |
|---|---|---|
| `R6-1` | A foreign workspace is rejected — the client can never SELECT a workspace | GREEN |
| `R6-1b` | A **workspace change** after the grant invalidates the request | GREEN |
| `R6-2` | An invalid request id is rejected by the CODEC, before the server sees it | GREEN |
| `R6-3` | An oversized prompt is rejected before the lifecycle is called | GREEN |
| `R6-4` | A socket **DISCONNECT** cannot duplicate an accepted request | GREEN |
| `R6-5` | The write credential is **INVALIDATED on host replacement** | GREEN |
| `R6-6` | The READ-ONLY view is UNCHANGED — exactly two operations, `readOnly: true` | GREEN |
| `R6-7` | A mutation-AUTHORIZED client sees the write operations, `readOnly: false` | GREEN |
| `R6-8` | The write credential file is owner-only (0600) and is REMOVED on dispose | GREEN |
| `R6-9` | The mutation opt-in record is what enables mutation, and it is SEPARATE from the seam enablement | GREEN |
| `R6-10` | The seam exposes NO approval bypass, no cancel, no feedback, no shell shortcut | GREEN |

**Native tool approvals remain required.** The start routes through the
EXISTING `initTask()` lifecycle, which preserves the native editor and
approval authority. The seam exposes no approval-responding operation.

## Proxy-level MCP exposure

| Test | Assertion | Status |
|---|---|---|
| `PX01` | A read-only proxy exposes **EXACTLY** the two read-only tools (unchanged from RECON01) | GREEN |
| `PX01b` | A mutation-enabled proxy exposes the two write tools; `clinemm_start_act` is annotated `readOnlyHint: false`, `clinemm_read_events` `readOnlyHint: true` | GREEN |
| `PX02` / `PX03` | The proxy relays `clinemm_get_run` / `clinemm_capabilities` unchanged | GREEN |
| `PX04` | With NO installed instance the proxy FAILS CLOSED | GREEN |

## C6 — Executable gates (all in `03-`, `04-`, `05-`)

| Gate | Receipt | Result |
|---|---|---|
| MCP protocol / server / proxy | `01-` | 124 passed; 2 pre-existing COR02 failures |
| Ownership exclusivity | `01-`, `02-` | 2 failures — **identical on the base commit** |
| Session start + lifecycle fences | `03-` | 60/60 PASS |
| `SdkController` | `03-` | 44/44 PASS |
| CPR01 continuation correlation | `03-` | 7/7 PASS (dedicated bridge config) |
| C9 / C10 commit-driven publication + statechart causal repair | `04-` | 77/77 PASS |
| BCB barrier (c1..c4) | `04-` | included in the 77/77 PASS |
| C10 filter ablation / baseline | `04-`, `02-` | 5 failures — **identical on the base commit** |
| Elm task-header authority + turn-state | `03-` | 145/145 PASS |
| Typecheck | `05-` | `tsc_exit=0`, **0 diagnostics** |
| Scoped lint | `05-` | **0 errors** |
| Format | `05-` | clean |
| Extension bundle build | `05-` | build finished |

**ACT-owned diagnostics = 0.**

**Pre-existing failures preserved by diagnostic identity.** The two
COR02 failures and the five C10-filter failures were reproduced on the
base commit `ae802ca980ae116a3d4c5d35411f4e6628681ac2` via a
stash-based comparison (receipt: `02-preexisting-failure-baseline.txt`).
No repository-wide sweep was required, and no new regression was
demonstrated.
