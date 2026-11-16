# 07 — Closure and next action

## 7.1 — The seven questions, answered

### Q1. Did the incident actually have authoritative completion?

**NO.** The completion authority withheld terminal commitment and **never committed** a
`completed` turn phase.

- The automatic incident store holds **no** `completion_committed` observation for the task
  (epoch-3 and epoch-4 records both say `completionCommitted: false`).
- The runtime-diag publication trace contains **zero** `turnPhase == "completed"` rows for
  `taskId = 1794840293250_5ugld` (540 rows for the task; 1178 in total).
- The model's `submit_and_exit` (18:00:43 and 18:04:29) is a **completion *intent***, correctly
  recognised by the host — not a completion.

**The persisted `status: "completed"` in the session JSON (18:09:34) is the session-PROCESS
exit status, not the task-phase commit.** The two diverged in this incident; the phase
authority is the authoritative one.

### Q2. Was background-job containment/reconciliation still outstanding?

**NO — at the moment of the completion decision, everything was discharged.**

All 7 `c10_reevaluated` records (6 in epoch 3 + 1 in epoch 4, the last at 18:04:29.118) show
`remainingBlockingJobCount: 0`, `unconsumedTerminalCount: 0`, `ownerStillRunning: false`,
`heldObligation: false`, `outstandingAutonomousWork: false`. Both held jobs
(`cmd_mwjdtjh6hmr62k75`, `cmd_mwje567ijng81j18`) reached `state=exited`, `exitCode=0`, and the
model observed both terminal results.

**Earlier in the incident (18:00:43 and 18:03:30) the answer WAS yes** — that is exactly why
the BCB held, correctly.

**Process-group-absence proof: `UNAVAILABLE_FROM_TRACE`** (the incident store's `coverage`
array is empty; no PID was probed, per the ACT).

### Q3. Did C9/C10/BCB permit or withhold terminal commitment?

**They withheld it — TWICE, for two different and both defensible reasons:**

| # | When | Which gate | Why |
|---|---|---|---|
| 1 | 18:00:43.541 | **BCB hold** (`held_obligation`) | The terminal result of `cmd_mwjdtjh6hmr62k75` had not been observed by the model. **Correct.** Published the truthful `resumable` ("Paused"). |
| 2 | 18:04:29.118 | **Elm completion authority** (`checkElmCompletionAuthority`, `sdk-session-event-coordinator.ts:2883`) | The conservation half of the gate was fully clear; the **authority** half (the Elm kernel) did not authorise. **The specific Elm decision and hold reason are `UNAVAILABLE_FROM_TRACE`.** |

### Q4. What did the host commit as the turn phase?

**`streaming`** — the last committed phase for the task, epoch 4, written by the
continuation-entry reseed (`session-event-pending-prompt-submitted`,
`sdk-session-event-coordinator.ts:4365`).

The complete committed-phase history for the task (runtime-diag publications):

```
epoch 2:  idle → streaming → streaming(shadow) → awaiting_followup(aborted)
epoch 3:  streaming → awaiting_followup
epoch 4:  streaming → streaming → … → streaming   (19 publications, pubId 1898…1957)
```

**No `completed` and no `resumable` was ever *published*.** The BCB-hold's `resumable` WAS
written into the tracker (the incident store proves it: `observedPhase: "resumable"`) but was
superseded by the continuation-entry reseed before any publication carried it.

### Q5. What did the webview/Elm render?

**"Working" with a Cancel affordance** — the exact projection of `streaming`:
`stateLabel("streaming")` → `{ label: "Working", glyph: "●", live: true }`
(`taskHeaderTelemetryHelpers.ts:157`). The canonical shadow was `UNBOUND`, so the projection
fell back to the legacy `turnState.phase` (`taskHeaderSource: "legacy"`).

**The UI was faithful.** It rendered the phase it was given.

### Q6. Why did MCP report `running: false`?

**Because `running` is `ActiveSession.isRunning` — "a turn is in flight" — not the committed
task phase.** `readControlSeamRunIdentity` (`control-seam-authority.ts:78–99`) reports three
independent facts: `running` (the host's turn mirror), `runtimeStatus` and `runId` (both from
`AgentRuntime.snapshot()`).

At 18:09:04/18:09:09 the last turn had settled (`setRunning(false)` at
`sdk-session-lifecycle.ts:315–326`), so `running: false`. `runtimeStatus` and `runId` were
**omitted** because the runtime had no live `AgentRuntime` instance for that session — the
seam deliberately omits undefined optional fields rather than serialising `null`.

**`running: false` is fully consistent with "the task never reached a terminal phase".** It
carries no completion semantics whatsoever.

### Q7. Was there a proven bug, and at which exact boundary?

**No bug is proven.** What IS proven, exactly:

- The completion authority **withheld** terminal commitment (twice, §Q3).
- The webview **faithfully** rendered the last committed phase.
- The MCP bridge **correctly** reported turn-settled-ness.
- The conservation / hold / release / publication machinery is **intact** — 367 executed
  assertions over the real production seams all PASS (§06).

**The single open boundary** is the Elm completion-authority decision at 18:04:29.118Z. Until
that one record is captured, the incident cannot be classified as either a legitimate hold
(class B) or a completion-authority defect (class C).

**⇒ This is precisely the ACT's `CAPTURE_INSUFFICIENT` terminal verdict.**

---

## 7.2 — Terminal verdict

# `CAPTURE_INSUFFICIENT`

**The existing trace cannot establish the authoritative boundary — but it has narrowed the
gap to exactly ONE observation.**

### The one missing observation

> **The Elm completion-authority decision for session `1794840293250_5ugld` at
> 2026-11-16T15:04:29.118Z — `decision.kind` (`authorize` / `hold` / `failure`) and, for a
> `hold`, the `holdReasons` list.**

### The minimum capture required

**One read-only export of the ALREADY-INSTRUMENTED BCB causal flight recorder.** No new code,
no new protocol field, no new diagnostic, no env gate.

**Preferred (Path 1):** the operator runs **`Cline Debug: Dump Completion Incident Bundle`**
in the ClineMM window whose extension host is PID 98318. This serialises the in-memory
capsules — including `completion-authority.jsonl` — for the current sessions.

**Alternative (Path 2):** PID 98318 is allowed to **shut down gracefully**, which writes the
capsules into `completion-incident-checkpoint.json`.

**Both are read-only exports.** Neither mutates production state, neither changes semantics,
and neither is a "new observability framework".

**Why the record exists but was not captured:** the `completion_authority` stage is emitted
**only** through the BCB flight recorder (`captureIncident`) and never through the automatic
incident store (`captureAutomaticIncident`); and the flight recorder serialises its capsules
**only** on a task switch or extension-host shutdown. The on-disk checkpoint predates the
incident by two hours and PID 98318 is still alive, so the incident's capsule has never
reached disk.

### Decision table for the next step

| If the captured Elm decision is… | Then the verdict becomes | Next action |
|---|---|---|
| `hold` (`pending_prompt` / `scheduled_continuation` / `active_run`) | **`PASS_EXPECTED_BEHAVIOR`** for the completion authority | Evaluate whether the *presentation* of a legitimate hold as "Working" (rather than "Paused") is the remaining defect — that would be a **separate** presentation ACT, not a completion-authority repair |
| `hold` (`unconsumed_terminal_observation` / `running_background_job`) | **`PASS_CAUSAL_BOUNDARY_IDENTIFIED`** | The Elm and TS conservation authorities diverged — one bounded repair ACT at that seam |
| `failure` (e.g. `elm_authority_unavailable`, `elm_authority_decode_error`) | **`PASS_CAUSAL_BOUNDARY_IDENTIFIED`** | One bounded repair ACT at the Elm authority seam (RED → GREEN, conservation tests, live qualification) |
| `authorize` | **`PASS_CAUSAL_BOUNDARY_IDENTIFIED`** | One bounded repair ACT at the commit/publication seam — the commit was lost after authorisation (the publication pipeline itself is proven healthy by the pub-2998 control) |

### What must NOT be done now

- ❌ Do **not** repair the model's completion message (it is not the defect).
- ❌ Do **not** treat MCP `running: false` as completion (it never was).
- ❌ Do **not** change C9/C10, BCB, Elm, React or command-job semantics — there is no executed
  RED, and the ACT's budget is ZERO.
- ❌ Do **not** widen the `clinemm_get_run` allow-list to expose the Elm decision (it is a
  closed, fail-closed protocol surface; and the ACT forbids MCP mutation-control changes).
- ❌ Do **not** re-create or reopen the incident.

---

## 7.3 — The smallest justified next action

**ONE operator action:**

> In the ClineMM window owned by extension host **PID 98318**, run
> **`Cline Debug: Dump Completion Incident Bundle`**, then read
> `completion-authority.jsonl` for `sessionId = 1794840293250_5ugld` and extract the record
> with `stage == "completion_authority"` and the latest `timestamp ≤ 2026-11-16T15:04:29.118Z`.

**Estimated cost:** one command, one file read, no code, no deployment, no restart.

**If the bundle is unavailable** (e.g. the task was switched away before the dump), use
**Path 2** — a graceful shutdown of the extension host — and then read
`completion-incident-checkpoint.json`.

**After the capture:** classify against the table in §7.2 and open at most **one** bounded
repair ACT. Nothing else.

---

## 7.4 — ACT hygiene statement

| Requirement | Status |
|---|---|
| Production change budget | **ZERO** — no production file was modified |
| Diagnostic probes added | **ZERO** — the capture point already existed |
| Tests added / modified / removed | **ZERO** |
| Deliberately failing test left in the default suite | **NO** |
| Broad test sweep | **NOT RUN** (3 focused invocations, 21 files, 367 assertions) |
| Protected stashes | **PRESERVED** (`stash@{0}` untouched) |
| Worktrees | **PRESERVED** (5 untouched) |
| Push / reset / rebase / checkout / reinstall / upgrade | **NONE** |
| Incident task / history | **READ ONLY** |
| Live jobs | **NONE cancelled, killed, or probed** |
| Credentials | **NOT read** (only a token *fingerprint*) |
| Evidence written | `.factory/evidence/ACT-CLINEMM-WORKING-AFTER-COMPLETION-DISCRIMINATOR01/` (8 files + `SHA256SUMS.txt`) |
| Secrets in committed evidence | **NONE** (only nonsecret correlation identifiers) |
