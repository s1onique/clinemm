# ACT-CLINEMM-MCP-EVENT-SESSION-ISOLATION01 — VERDICT

**Verdict: `PASS_STRUCTURAL_ONLY` — the leak REPRODUCES, the defect is
corrected in the PRODUCTION code, and each correction is proven
load-bearing by a necessity ablation.**

The live pilot against an installed extension remains **PENDING operator
action**. No LIVE claim is made.

```text
ACT_ID: ACT-CLINEMM-MCP-EVENT-SESSION-ISOLATION01
TYPE: bounded production correction of the control layer + executable qualification
EPIC: EPIC-CLINEMM-TRACE-AND-ACCEPTANCE-EVIDENCE
WORKSTREAM: W01 (successor of ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-CORR01)
ENTRY_HEAD: bd79e6dcbe183cf9375f905a40d862d32607166d
ENTRY_TREE: f32dd0dd9881d4516fa8f70598bbee7a30a6f6f3
VERDICT: PASS_STRUCTURAL_ONLY
LEAK REPRODUCED: YES
BEHAVIORAL RED: 3 failed | 1 passed (4) against the UNMODIFIED production code
BEHAVIORAL GREEN: 4 passed (4)
EXISTING CONTROL-SEAM SUITE: 145/145 PASS (10 files)
NECESSITY ABLATIONS: 3/3 - each production correction is load-bearing
TYPECHECK: bun run check-types EXIT 0 (0 diagnostics)
PROTO_CHANGES: 0   NEW_MCP_OPERATIONS: 0   PROTOCOL_VERSION: 1 (unchanged)
ACT_OWNED_DIAGNOSTICS: NONE
INSTALLED QUALIFICATION: NOT EXECUTED / PENDING. No LIVE claim is made.
EVIDENCE: .factory/evidence/ACT-CLINEMM-MCP-EVENT-SESSION-ISOLATION01/
```

---

## 1. The reopen condition, answered

The reviewer's single question was: **can the MCP event buffer expose
messages from a session other than the session authorized for
`clinemm_read_events`?**

**YES — it could, and it did.** The leak is reproduced against the
REAL production seams (the REAL `SdkMessageCoordinator` publication
boundary, the REAL `ControlSeamEventBuffer`, the REAL `ControlSeamServer`
over the REAL AF_UNIX transport, driven through the REAL
`ControlSeamClient`).

The leak was NOT hypothetical: it disclosed another task's **message
text** with the content-read grant on, and another task's **event
metadata** with it off.

---

## 2. The precise missing event-session association

The reviewer's diagnosis was exact. The corrected event-read path
verified **who may request events** but the buffer carried **no
producer-to-buffer session binding**:

| Location | Before | Why it leaked |
|---|---|---|
| `control-seam-event-buffer.ts` `ControlSeamBufferedEvent` | `cursor`, `epoch`, `type`, `kind`, `ts`, `text` — **no `sessionId`** | the ring could not answer "which session produced this event" |
| `control-seam-event-buffer.ts` `read()` | sliced the **shared** ring with no session filter | any authorized reader got every session's events |
| `SdkController.ts:3387` (pre-fix) | `onSessionEvent((messages) => …)` — the `event` argument was **discarded** | the source-backed session identity was available and was thrown away |
| `SdkController.ts:3811` | the buffer is cleared on controller **disposal** only | a task/session transition does NOT clear it |

**The missing association was the producer-to-buffer session binding at
the event-publication boundary.**

---

## 3. The correction (production code, minimal and fail-closed)

Three coordinated changes. **No new MCP operation, no protocol change,
no approval change, no event infrastructure.**

### 3.1 `apps/vscode/src/sdk/control-seam/control-seam-event-buffer.ts`

* `ControlSeamBufferedEvent` gains a required `sessionId: string` — the
  session that **PRODUCED** the event.
* `projectControlSeamBufferedEvent(message, options)` — `options.sessionId`
  is **REQUIRED**. An event with no producing-session identity is **not
  retained** (fail closed).
* `read(options)` — `options.sessionId` is **REQUIRED**. The read is
  scoped to that session:
  * an **unscoped** read returns an **empty** slice — the buffer never
    answers "give me the shared ring";
  * the session filter is applied to the retained window **BEFORE** the
    cursor is positioned, so the cursor-expiry verdict is computed
    against **this session's own** retained events. A foreign session's
    eviction can neither falsely expire nor falsely validate this
    session's cursor, and a foreign event can never occupy a position
    in the returned slice.


### 3.2 `apps/vscode/src/sdk/control-seam/control-seam-server.ts`

* `handleReadEvents` passes `sessionId: ownedSessionId` — the session the
  authorization fence already proved this client started — into
  `eventBuffer.read(...)`.

### 3.3 `apps/vscode/src/sdk/SdkController.ts`

* The publication-boundary subscription now takes the `CoreSessionEvent`
  and attributes each retained event to
  **`event.payload.sessionId`** — the runtime's **OWN** session identity,
  which **every** variant of `CoreSessionEvent` carries
  (`sdk/packages/core/src/types/events.ts:119-141`). An event without one
  is **dropped** (fail closed) rather than attributed to a guessed
  session.

**The identity is SOURCE-BACKED, not an approximate current-session
observation.** This matters: the controller genuinely publishes events
for sessions that are **no longer active** — e.g. the mode switch's
cancel row names the session it replaced
(`apps/vscode/src/sdk/sdk-mode-coordinator.ts:452-455`, payload
`{ sessionId: oldSessionId, status: "cancelled" }`). An approximate
"currently active session" attribution would place that other task's
transcript in the wrong session's view. The necessity ablation below
proves this correction is load-bearing.

---

## 4. Behavioural RED → GREEN

RED (unmodified production code, exit 1):

```text
× ISO-1: events published by a DIFFERENT session are NOT returned …   FAIL
× ISO-2: an event published by a LATER UI-OWNED session is not …      FAIL
× ISO-3: WITHOUT the content-read grant, a foreign session's event …  FAIL
✓ ISO-4: the owned session's own events remain readable …             PASS
```

The observed leak, verbatim from the RED run:

```json
{"v":1,"ok":true,"result":{"sessionId":"session-b","events":[
  {"cursor":"1","epoch":0,"type":"say","kind":"text","ts":1794947618771,"text":"SECRET-A-UI-TASK-TEXT"}]}}
```

and, with the content-read grant **off** (ISO-3), the foreign session's
**metadata** still leaked:

```text
[ { "cursor": "1", "epoch": 0, "kind": "text", "ts": 1794947608368, "type": "say" } ]
```

GREEN (corrected production code): **4 passed (4)**, and the whole
control-seam suite **145/145 PASS (10 files)**.

---

## 5. Necessity ablations (3/3)

| ID | Production revert | Result | Verdict |
|---|---|---|---|
| A | the buffer's session filter removed (`const scoped = this.events`) | ISO-1 FAIL, ISO-2 FAIL, ISO-3 FAIL | LOAD-BEARING |
| B | the server drops the owned-session scope from the read | ISO-2 FAIL, ISO-4 FAIL | LOAD-BEARING |
| C | the producer-side attribution replaced with an approximate current-session observation | ISO-2 FAIL | LOAD-BEARING |

Ablation C is the direct answer to the reviewer's explicit instruction —
*"Prefer source-backed session identity at the event-publication boundary;
do not assign events using an approximate current-session observation."*
The approximation reproduces the leak; the source-backed identity does
not.

---

## 6. Conservation (proven, not asserted)

* **No new MCP operation.** `CONTROL_SEAM_OPERATION_IDS` is unchanged:
  `clinemm_capabilities`, `clinemm_get_run`, `clinemm_start_act`,
  `clinemm_read_events`.
* **No protocol change.** `CONTROL_SEAM_PROTOCOL_VERSION` stays `1`. The
  wire shape of every request and response is unchanged.
* **No approval change.** No approval, cancel, feedback, shell shortcut
  or editor-tool path was touched.
* **No event infrastructure.** The buffer is still a READER of the
  EXISTING publication boundary — not a new event bus.
* **No new runtime.** No second `ClineCore` / `LocalRuntimeHost` /
  `SessionRuntime`, no second execution loop.
* **C1–C5 preserved.** The CORR01 suite's C1, C2, C4, C5 and CN cases
  all still pass; the C3 cases still pass with the session id threaded
  into their fixtures.
* **The read-only view is unchanged.** A read-only client still sees
  exactly the original two operations.

---

## 7. Decision

The single reopen condition — **event-session isolation** — is now
**SATISFIED for the bounded structural correction**: the leak reproduces
on the unmodified code, the correction is implemented in the PRODUCTION
code, and each of its three parts is proven load-bearing.

`HALT_EVENT_SESSION_ISOLATION` is cleared **structurally**. The live
Codex → ClineMM pilot may proceed once the operator performs the
exact-head rebuild / install / opt-in described in
`.factory/evidence/ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-CORR01/06-live-qualification.md`,
extended by the isolation steps in `04-live-qualification.md` of THIS
evidence directory.

**No further broad review cycle is required.**
