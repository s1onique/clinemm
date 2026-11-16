# 04 — Causal classification

The classification is derived from the evidence assembled in §00–§03, not from chronology,
screenshots, or the model's final prose.

---

## 4.1 — The discriminating question

> "Did the incident actually have authoritative completion?"

**NO.** The completion authority **withheld** terminal commitment and **never committed** a
`completed` turn phase. The authoritative evidence:

| Evidence | Finding |
|---|---|
| Automatic incident store, epoch 4 (`incident-mwje9ozi-2-3xq4qi/incident.json`) | `c10_reevaluated` present; `completion_committed` **absent**; `observedPhase: "UNOBSERVED"` |
| Automatic incident store, epoch 3 (`incident-mwje4uxh-1-qgkl66/incident.json`) | `held_phase_published` present with `phaseWriter: session-event-bcb-hold-resumable`, `phase: resumable`; `completionCommitted: false` |
| Runtime-diag publication trace (all 1178 rows, 540 for the incident task) | **ZERO** `turnPhase == "completed"` rows for the incident task; last publication = `publicationId 1957`, `turnPhase = streaming` |
| Control: the next session in the same trace | `publicationId 2998` → `turnPhase = completed` — the publication pipeline is healthy |
| CCARD `task_completion_committed` | **no record for this session** (the jsonl is stale, Nov 3) — corroborating but not decisive |

**The persisted `status: "completed"` in the session JSON is NOT authoritative completion.**
It is the *session-process* exit status written at 15:09:34.312Z. The turn-phase authority
never committed a terminal phase for that task. **A synthetic `completion_result` message was
not treated as persisted completion.**

---

## 4.2 — The six classes, adjudicated one by one

### Class A — Legitimate continuation → **EXCLUDED**

*Requires: a later live run or pending user/agent action is established.*

**Partially present but insufficient.** There *was* a genuine continuation: the BCB queued the
`completion_continuation_control` prompt at 18:00:43.574 and 18:03:30.993, and the model
polled `command_status` and re-issued `submit_and_exit` at 18:04:29. **But that continuation
ENDED at 18:04:29.118** — the `c10_reevaluated` record at that instant shows
`ownerStillRunning: false`, `heldObligation: false`, `outstandingAutonomousWork: false`,
`remainingBlockingJobCount: 0`. No further turn, run or pending action exists for this task;
the session's last activity was the 18:04:29 submit.

**⇒ Class A does not explain the 18:06 observation.** A legitimate continuation would have a
live turn; at 18:06 there was none (`running: false` at 18:09:04/18:09:09).

### Class B — Legitimate BCB hold → **EXCLUDED as the 18:06 cause; CONFIRMED as the 18:00:43 cause**

*Requires: the exact unresolved, session-owned obligation plus a documented completion hold.*

**At 18:00:43 this was exactly right.** The BCB held the completion with
`holdReason: "held_obligation"` over the session-owned job `cmd_mwjdtjh6hmr62k75`, whose
terminal result the model had not yet observed. The hold was **correct** and it published the
truthful `resumable` ("Paused").

**But by 18:04:29 the obligation was fully discharged.** All 7 `c10_reevaluated` records show:

```json
{"remainingBlockingJobCount": 0, "unconsumedTerminalCount": 0, "ownerStillRunning": false,
 "heldObligation": false, "outstandingAutonomousWork": false}
```

and both held jobs (`cmd_mwjdtjh6hmr62k75`, `cmd_mwje567ijng81j18`) reached `state=exited`
with `exitCode=0` and were observed by the model (the transcript shows both `command_status`
calls returning their terminal results).

**⇒ At 18:06 there was NO outstanding obligation.** "Working" was **not** justified by a BCB
hold. Class B is excluded as the explanation of the observed state.

### Class C — Completion authority defect → **NOT ESTABLISHED (and positively disfavoured)**

*Requires: obligations settled; completion required; commit absent or incorrectly rejected.*

- "Obligations settled" — **PROVEN** (7× all-clear `c10_reevaluated`).
- "Completion required" — **NOT PROVEN.** The completion *intent* was present and correctly
  recognised, but the **authority** is a two-part gate: conservation (cleared) **and** Elm
  authority. The Elm decision is `UNAVAILABLE_FROM_TRACE` (the BCB flight recorder for this
  session was never checkpointed, and the `completion_authority` stage is emitted only through
  `captureIncident`, never through the automatic incident store).
- "Commit absent or incorrectly rejected" — the commit is **absent** (proven), but whether the
  rejection was **incorrect** cannot be established without the Elm decision.

**The Elm HOLD is not automatically a defect.** `computeHoldReasons` has five legitimate hold
reasons (`ActiveRun`, `PendingPrompt`, `ScheduledContinuation`, `UnconsumedTerminalObservation`,
`RunningBackgroundJob`).

**But the incident's Elm HOLD is NARROWED by the production source.** At the installed
revision `1d9a37bcd` the `notifyAgentTurnDone` trigger has **no** env/authority gate — the
production comment at `sdk-session-event-coordinator.ts:3138–3144` says verbatim:

> *"The legacy P1 guard `if (!isElmAuthorityEnabled()) return` is REMOVED. There is no OFF mode.
> The Elm authority is the sole completion authority; the trigger always fires; the consult site
> (`checkElmCompletionAuthority`) fail-closes on kernel miss / decode error."*

**So the post-run liveness re-evaluation DID run** after the final `agent_turn_done`. Under
that trigger, `handleAgentTurnDone` (`Authority.elm:185–198`) clears `activeRun` **only when the
closing run ref matches** `model.activeRun`, and consumes the matching prompt. Therefore the
surviving hold reason at the last consult is one of:

- **`PendingPrompt` / `ScheduledContinuation`** — a prompt that the `agent_turn_done` did NOT
  consume because its `RunRef` did not match the model's `activeRun`. This is the **designed**
  protection against committing while a host-owned continuation prompt is still queued.
- **`UnconsumedTerminalObservation` / `RunningBackgroundJob`** — the Elm model still tracking a
  job the TS conservation chain had already cleared (a divergence between the two authorities).
- **`ActiveRun`** — the closing ref did not match (a run-ref mismatch).
- a **`failure`** classification (`elm_authority_unavailable` / `elm_authority_decode_error`) —
  the fail-closed path.

Each of these is either **designed** (B) or a **real defect** (C). The captured record
distinguishes them.

**⇒ Class C cannot be established from the available evidence.**

### Class D — UI reconciliation defect → **EXCLUDED**

*Requires: the authoritative terminal phase committed; matching UI remains Working after
publication/commit.*

**The authoritative terminal phase was NEVER COMMITTED** (proven by three independent
artifacts, §4.1). There is therefore no committed terminal phase for the UI to have failed to
display. The webview received `streaming` and rendered `stateLabel("streaming")` = **"Working"**
— the correct projection of the correct committed phase.

**⇒ Class D is excluded.** The UI was faithful.

### Class E — Foreign-instance mismatch → **EXCLUDED**

*Requires: MCP and UI resolve to different controller instances.*

| Correlation | Value |
|---|---|
| MCP control-seam owner | `instanceId 98318-49800609bcd187dae92f554228d093ea`, `pid 98318` |
| Runtime-diag trace instance | `clinemm-v2-900dc427-mwjddpq6.jsonl` |
| Incident record `extensionHostInstanceId` | `extension-host-98318-mwjddpq6` |
| Session metadata `pid` | `98318` |

**All four resolve to the SAME extension host (PID 98318).** The external Codex Desktop MCP
client is a separate *process*, but it is a **read-only proxy** over the control-seam unix
socket owned by PID 98318 (`control-seam/owner.json` + `control-seam/control.sock`), so its
answers are PID 98318's answers.

**⇒ Class E is excluded.**

### Class F — Insufficient capture → **PARTIALLY APPLICABLE**

*Requires: missing identity, authority or commit evidence.*

- **Identity evidence: COMPLETE.** Session id, task id, extension-host id, epoch, coordinator
  instance id, barrier id, publication ids — all present and mutually consistent.
- **Commit evidence: COMPLETE.** The commit is **proven absent** (zero `completed` publications;
  no `completion_committed` observation; no CCARD record).
- **Authority evidence: MISSING.** The **specific Elm decision** at 18:04:29.118Z
  (`authorize` / `hold` / `failure`, and the hold reason) is `UNAVAILABLE_FROM_TRACE`.

**⇒ Class F applies to exactly ONE fact: the Elm authority's decision and reason.**

---

## 4.3 — What the evidence DOES establish

**The exact causal boundary of the divergence is identified, and it is NOT a UI divergence.**

```
model output (submit_and_exit)                    18:00:43.531  INTENT ✓ recognised
   ↓
BCB hold (legitimate)                              18:00:43.541  WITHHELD ✓ correct
   ↓  phase write: resumable ("Paused")  ← truthful, but never published
continuation entry reseed → streaming              18:00:4x      pubId 1607 ✓ designed
   ↓
turn settlement → awaiting_followup                18:00:46      pubId 1893
   ↓
BCB continuation #2                                18:03:30.993
   ↓
conservation predicates ALL CLEAR (×7)             18:00:46 – 18:04:29 ✓
   ↓
ELM AUTHORITY GATE                                  18:04:29.118  WITHHELD  ← *** THE BOUNDARY ***
   ↓                                              sdk-session-event-coordinator.ts:2883
host phase commit "completed"                      NEVER          ✗
   ↓
webview state publication                          NEVER          ✗ (last: pub 1957 = streaming)
   ↓
Elm projection → "Working" + Cancel                18:06 screenshot
```

**The completion authority and the visible task phase did NOT diverge.** Both said the same
thing: *not completed*. The header said "Working" because the last **committed** phase was
`streaming`, and `streaming` is defined to render as "Working" with a Cancel affordance.

**The observable defect is narrower and different from the reported symptom:** after all
conservation obligations were discharged, the completion remained **non-terminal** with a
**live-looking** phase (`streaming` + Cancel), and the **Elm authority's** decision is the only
missing link that would tell us whether that non-terminal outcome was **by design** (a
legitimate Elm HOLD on a stale `activeRun`/`PendingPrompt`) or **a defect** (a wrongly
withheld commit).

---

## 4.4 — Classification

> **The observation "Working after a completion-style message, with MCP `running: false`" is
> fully explained and does NOT establish a defect.**
>
> - The completion-style message is **not** authoritative completion (the model's prose).
> - MCP `running: false` is **not** task completion (`ActiveSession.isRunning`).
> - The header's `Working` is **not** wrong: it is the truthful projection of the truthful
>   last committed phase (`streaming`), because the completion authority **withheld** the
>   terminal commit.
>
> **The ONE genuinely open question is the Elm authority's decision at 18:04:29.118Z.**

**Classification: `CAPTURE_INSUFFICIENT` — narrowed to a single missing observation.**

### The smallest missing discriminator

> **The Elm completion-authority decision for session `1794840293250_5ugld` at
> 2026-11-16T15:04:29.118Z — specifically `decision.kind` (`authorize` / `hold` / `failure`)
> and, for a `hold`, the `holdReasons` list.**

### The minimum capture required

**One observation, from an EXISTING diagnostic facility — no new instrumentation needed.**

The BCB causal flight recorder (`captureIncident`) **already emits** this at the exact
boundary (`sdk-session-event-coordinator.ts:1915/1955/1996`):

```json
{"stage":"completion_authority","outcome":"withheld"|"failed"|"authorized",
 "predicates":{"elmDecision":"hold","elmReason":"<reason>"},
 "phaseWriter":"session-event-turn-complete-completed"}
```

The capture exists; it was simply **never checkpointed** for this session, because
`completion-incident-checkpoint.json` is written only on a **task switch** or **extension-host
shutdown**, and PID 98318 is still alive with the task never switched away until after the
incident.

**Minimum capture:** the flight-recorder capsule for task `1794840293250_5ugld`, obtained by
one of the already-wired, read-only paths:
1. the **`Cline Debug: Dump Completion Incident Bundle`** command (the `completion-incident-bundle`
   runtime, `completion-incident-bundle-runtime.ts`), which serialises the in-memory capsules —
   including `completion-authority.jsonl` — for the current sessions; or
2. the BCB flight-recorder checkpoint, if the extension host is allowed to shut down
   gracefully (which writes `completion-incident-checkpoint.json`).

**Both are read-only exports. Neither mutates production state.**

### What the two outcomes would mean

| If the Elm decision was… | Then | Class |
|---|---|---|
| `hold` with `pending_prompt` / `scheduled_continuation` (a host-owned continuation prompt the `agent_turn_done` did not consume) | The gate behaved as designed; the non-terminal outcome is a **legitimate hold**, and the *presentation* of that hold as "Working" (rather than "Paused") is the only remaining candidate defect | **B** (with a presentation sub-finding) |
| `hold` with `active_run` (a run-ref mismatch) | The gate behaved as designed (the ref-match rule in `Authority.elm:185–198`); a **presentation** sub-finding remains | **B** (with a presentation sub-finding) |
| `hold` with `unconsumed_terminal_observation` / `running_background_job` (the Elm model still tracking a job the TS chain had cleared) | The Elm and TS conservation authorities **diverged** — a real defect in one of them | **C** — completion authority defect |
| `failure` (e.g. `elm_authority_unavailable` / `elm_authority_decode_error`) | The fail-closed Elm gate blocked a completion that was otherwise fully cleared | **C** — completion authority defect |
| `authorize` | Then the commit should have happened, and the absence of a `completed` publication would be a **publication/commit-loss defect** — a different and more serious boundary (the control already published `completed` for the next session, so the pipeline is healthy) | **C** — commit-loss defect |

**⇒ The next action is ONE bounded read-only export of the existing flight recorder, then a
classification against the table above.** No repair is justified until that single fact is
obtained.
