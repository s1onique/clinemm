# 05 — Bounded reproduction or missing-evidence acquisition

## 5.1 — Why a RED reproduction is NOT the right instrument here

C4 identified the boundary: the **Elm completion-authority decision at
2026-11-16T15:04:29.118Z**. The ACT's RED policy requires "a RED reproduction against the
**actual production seam**". The actual production seam here is the **Elm kernel's
`computeHoldReasons`**, evaluated over the Elm model's state at the moment of the deferred
release.

**A synthetic RED cannot discriminate.** The Elm model's state at 18:04:29.118Z is a product
of the incident's own history — which Elm `RunRef` was `activeRun`, which `PromptRef` was
still `PendingPrompt`/`ScheduledContinuation`, whether the `agent_turn_done` ref matched. A
hand-built Elm state that reproduces "hold" proves only that the kernel *can* hold; it says
nothing about whether the kernel *should* have held in this incident.

**⇒ A synthetic RED would be theatre. The evidence gap is a HISTORICAL FACT, not a
behavioural assertion.** The correct instrument is the **capture** of that historical fact.

**The incident was NOT re-created.** The ACT's own rules forbid it: "Do not recreate the
incident by running its original shell commands", "Do not reopen the completed task merely to
obtain matching screenshots", "The running incident task must not be used to investigate
itself". No live reproduction was attempted.

---

## 5.2 — The missing observation and its existing capture point

**Missing observation (exactly one):**

> The Elm completion-authority decision for session `1794840293250_5ugld` at
> 2026-11-16T15:04:29.118Z — `decision.kind` and (for a hold) the `holdReasons` list.

**The capture point ALREADY EXISTS in production.** `checkElmCompletionAuthority` emits it
through the BCB causal flight recorder at the exact decision boundary
(`apps/vscode/src/sdk/sdk-session-event-coordinator.ts`):

| Line | `decision.kind` | `captureIncident` stage/outcome | `predicates` |
|---|---|---|---|
| 1915 | `authorize` | `completion_authority` / `authorized` | `{"elmDecision":"authorize"}` |
| 1955 | `hold` | `completion_authority` / `withheld` | `{"elmDecision":"hold","elmReason":decision.reason}` |
| 1996 | `failure` | `completion_authority` / `failed` | `{"elmDecision":"failure","elmClassification":…}` |
| 2946 | (commit reached) | `completion_authority` / `committed` | `{"phase":"completed"}` |

**This is the exact record shape** already proven to work in a prior incident bundle
(`…/globalStorage/s1onique.clinemm/completion-incident-2026-11-05T18-16-35-773Z/completion-authority.jsonl`):

```json
{"stage":"completion_authority","outcome":"withheld",
 "predicates":{"elmDecision":"hold","elmReason":"active_run"},
 "phaseWriter":"session-event-turn-complete-completed"}
```

**⇒ The mechanism is proven; the incident's instance of it was simply never serialised.**

### Why it was never serialised (the precise capture gap)

The BCB flight recorder keeps capsules **in memory** and serialises them only at:

1. a **task switch** (`checkpointCompletionIncidentCapsules` in `SdkController.ts`), or
2. **extension-host shutdown** (`completion-incident-checkpoint-runtime.ts`).

The on-disk checkpoint `completion-incident-checkpoint.json` has
`savedAt = 2026-11-16T12:37:50.009Z` — **2 hours before the incident** — and
`capsuleDroppedRecords: 4416`. PID 98318 is **still alive**, so no shutdown checkpoint has
been written since. The incident's capsule therefore still exists **only in the extension
host's memory**, and has never reached disk.

Additionally, the `completion_authority` stage is emitted **only** through `captureIncident`
(the flight recorder) and **never** through `captureAutomaticIncident` (the automatic incident
store) — so the automatic incident store's epoch-3/epoch-4 records **cannot** contain it, and
their silence is not evidence either way. This is a **recorder-routing asymmetry**, not a
missing capture.

---

## 5.3 — The read-only capture path that exists TODAY

**Two already-wired, read-only export paths — no code change, no new instrumentation, no
protocol field, no env gate, no observability framework:**

### Path 1 — the incident-bundle dump command (preferred)

`Cline Debug: Dump Completion Incident Bundle`
(`registry.ts:96` → `extension.ts:1548` → `dumpCompletionIncidentBundle`,
`completion-incident-bundle-runtime.ts:523`).

It serialises the **in-memory** capsules of the current extension host — including
`completion-authority.jsonl` — into a timestamped bundle directory. The Nov-5 bundle in the
same store proves the output shape.

**Caveat:** this is an **operator action in the ClineMM UI**. It is not reachable from an
automated, non-interactive read, and the ACT did not perform it (it would require driving the
live UI of the very extension host under investigation, and the ACT restricts this ACT to
read-only evidence collection).

### Path 2 — the flight-recorder checkpoint on graceful shutdown

If PID 98318 is allowed to shut down gracefully, the shutdown handler writes
`completion-incident-checkpoint.json` including the incident's capsule. This is a
**lifecycle** action, not a code action. **This ACT did not perform it** — killing or
shutting down the operator's live extension host is outside the authorised scope and would
destroy the in-memory evidence that Path 1 would also capture.

### Paths that were considered and REJECTED

| Rejected path | Why rejected |
|---|---|
| Add the Elm decision to the `clinemm_get_run` payload | The control seam has a **closed allow-list** (`ALLOWED_RUN_IDENTITY_KEYS`, `control-seam-protocol.ts:208`) and a codec that **fails closed** on any other key. Widening it is precisely the "MCP mutation-control extension" the ACT forbids, and it would change a public protocol surface. |
| Add a temporary probe to the coordinator | Forbidden by the ACT unless "existing evidence is insufficient AND the missing boundary is precisely identified". The boundary IS precisely identified — but the capture **already exists**, so a new probe would be a duplicate of an existing facility, which the ACT forbids ("Do not create another observability framework"). |
| Drive the debug harness (`src/dev/debug-harness/server.ts`) | The harness launches a **NEW** extension host instance. The incident's flight-recorder capsule lives in **PID 98318's** memory. A different instance cannot see it. The harness would produce a *different* host's evidence, not the incident's. |
| Re-run the incident's shell commands / reopen the task | Explicitly forbidden by the ACT. |

---

## 5.4 — What was actually executed for C5

**The bounded, deterministic controls that ARE available and ARE meaningful.** The ACT
requires "the control case that distinguishes the proposed cause from ordinary continuation or
BCB hold". Two controls were executed against the real production seams (full receipts in §06):

| Control | Invariant asserted | Result |
|---|---|---|
| **BCB hold must NOT falsely complete** | A settled turn with a legitimate outstanding background obligation must not falsely complete | **PASS** (`bcb01`, `bcb01-c{,2,3,4}` — 38 assertions) |
| **All obligations discharged must NOT remain indefinitely non-terminal** | The BCB release path commits `completed` exactly once when every conservation predicate clears | **PASS** (`bcb01` BCB-25 real-integration case, `bcb01-c4` BCB-31) |
| **A committed terminal phase must not be overwritten by a stale streaming publication** | The deferred commit's `postStateToWebview()` publishes the terminal phase | **PASS** (`c9c10cdap01`, `ctca01`) |
| **A BCB hold must publish a truthful non-running phase, not `Working`** | The BCB-hold path commits `resumable` ("Paused") | **PASS** (`ptwcr01c01` R1) |

**These controls PASS, which is a genuine and important negative result:** *the production
behaviour that the incident's evidence exercises is behaving as specified.* The BCB hold
publishes `resumable`; the release commits `completed`; a stale streaming publication cannot
overwrite a committed terminal phase.

**⇒ The incident is NOT reproducible as a defect against the current source.** The
conservation/hold/release/publication machinery is intact and proven. Whatever withheld the
commit at 18:04:29.118Z is the **Elm authority's** decision, and that decision is a
**historical datum** that only the capture can yield.

---

## 5.5 — C5 outcome

| Item | Status |
|---|---|
| RED reproduction attempted? | **NO — and deliberately not.** A synthetic Elm-state RED cannot discriminate the historical decision; the evidence gap is a historical fact, not a behavioural assertion. |
| `HALT_RED_NOT_REPRODUCED`? | **NOT APPLICABLE** — no defect is claimed, so no RED was required. The ACT's RED policy is conditional on "If a defect is claimed". |
| Passing counterexample preserved | **YES** — the four controls in §5.4 are the preserved `NOT_REPRODUCED` evidence that the identified boundary is *not* a conservation/hold/release/publication defect. |
| Deliberately failing test left in the suite? | **NO.** No test was added, modified or removed. The worktree is pristine at `b1ad2a0de`. |
| Temporary probe added? | **NO.** The capture point already exists; a probe would duplicate it. |
| Production change | **ZERO.** |

**⇒ C5 closes as: the missing evidence is one already-instrumented historical record. The
capture is a single operator action (Path 1) or a graceful extension-host shutdown (Path 2),
both read-only. Until that one record is captured, the incident cannot be classified beyond
`CAPTURE_INSUFFICIENT`, and **no repair is justified.**
