# EPIC-CLINEMM-RUNTIME-TASK-PROGRESSION01

> Runtime task progression: the family of "task makes progress, then execution abruptly stops, no truthful terminal framing, user must type `Continue` (or Resume / Cancel / restart)" symptoms. Distinct from `task-control-liveness.md` (closed family — that proved particular generation/queue invariants, not this broader symptom) and from `task-presentation.md` (presentation vs runtime state). See `.factory/epic-board.md` for the active index.

## Current status

- Status: OPEN — fresh epic opened at FUTURE-BACKLOG-CENSUS01-CORRECTION01 (this commit). No ACT authored yet; the items below are working labels.
- Priority: **HIGH** (direct autonomy defect during supposedly autonomous YOLO runs; upstream evidence says the family remains active in current Cline-- releases)
- Current frontier: `RUNTIME-TASK-PROGRESSION-RECON01` (working label) — bounded RED-first recon + exact live RED. First action: do **not** pre-classify cause.
- Blocked by: n/a.

## Contract / durable conclusions

- **Symptom family.**

  ```text
  active task stops progressing
    → no truthful terminal / user-owned transition
    → user must type "Continue", Resume, or restart the IDE
  ```

- **Distinct from the closed `task-control-liveness.md` family.** That epic proved particular generation-fence and queued-prompt-stop-resume invariants. The live qualification against a live Cline-- extension host is **not** asserted there; this epic owns the broader "task genuinely stops making progress" symptom, which is independent of message-coordinator invariants.

- **Distinct from `task-presentation.md`.** Presentation covers the rendering of state to the user. This epic owns the **runtime** cause of a non-progressing task; the presentation may accurately show "Thinking..." even when the runtime is the thing that has stalled (this distinction is what triage Correction-04 established and is the binding rule against over-broad re-mapping).

- **Distinct from `tool-runtime-reliability.md`.** Tool-runtime-reliability is the question *"did the tool execute / return / time out / parse / route / terminate correctly?"*. Runtime-task-progression is the question *"after that event, did the overall agent/task make the correct state transition and continue?"*. The two can co-occur (a tool-timeout can leave the agent stuck), and the upstream triage explicitly proposed them as **two separate families** with this boundary.

- **Do NOT pre-classify cause.** The cause may be any of:

  ```text
  model completion edge
  command / terminal lifecycle
  skipped-tool transition
  continuation scheduling
  application ownership
  publication projection
  provider state
  ```

  The recon ACT must observe before claiming. Speculative single-cause fixes are explicitly forbidden by the FACT-001 working-label doctrine (`factory-infrastructure.md`).

- **Cancel-affordance authority is part of this family, not a new family.** The "Cancel missing during genuine execution" symptom is the **inverse** of the previously-projected "Cancel visible during idle" symptom; both are `cancellable-ownership projection` defects, and the invariant below applies to both directions:

  ```text
  if a genuinely cancellable owner exists:
      Cancel must be available / enabled

  if no cancellable owner exists:
      Cancel must NOT claim otherwise
  ```

  This invariant is the durable conclusion of the application-ownership / projection-coherence work; the recon must observe against it, not invent a third authority.

## ACT ledger

| ACT / ID | Verdict | Head | Purpose |
|---|---|---|---|
| `RUNTIME-TASK-PROGRESSION-RECON01` (working label) | OPEN / HIGH | — | Bounded RECON + exact live RED across the symptom family; characterize the failure modes without claiming a single root cause |
| `CANCEL-AFFORDANCE-AUTHORITY-RECON` (working label) | OPEN / HIGH | — | Recon of the cancellable-ownership projection across the runtime/UI seam; verifies the "Cancel iff cancellable owner exists" invariant above in both directions |
| (RUNTIME_THINKING_STALL cluster — RADAR evidence, not canonical proof) | RADAR (per `.factory/upstream/cline-upstream-triage.md` Correction-04) | — | Upstream supporting signals: #9546, #10015, #10031, #10208, #10537. Newer upstream reports (#12073, #12079, #12827) are recorded as **RADAR / reference only**, not canonical proof — they reinforce the family but do not by themselves establish a ClineMM defect |

## Open work

- **`RUNTIME-TASK-PROGRESSION-RECON01`** (HIGH). First ACT: bounded RECON + exact live RED. The deliverable is a markdown document that (a) characterizes the failure modes observed in our local recurrence, (b) maps each observed mode to one or more upstream signals (RADAR), (c) proposes a bounded RED-family test seam (not implementation), (d) does NOT pre-classify cause. Do not implement any production change in this ACT.
- **`CANCEL-AFFORDANCE-AUTHORITY-RECON`** (HIGH). Recon of the cancellable-ownership projection across the runtime/UI seam; verifies the "Cancel iff cancellable owner exists" invariant in both directions. First deliverable: a regression that fails when the invariant is violated in either direction (idle+Cancel visible, or active+Cancel absent). Do not invent a third authority; the invariant above is already durable.

Reopen / new-work conditions:

- A new user-visible non-progressing-task symptom is reproduced at the local canonical seam (→ reopen `RUNTIME-TASK-PROGRESSION-RECON01` or open a per-symptom ACT).
- A `RUNTIME_THINKING_STALL` upstream issue graduates from RADAR to IMPORT against this epic (requires a strict destination-contract test against the recon evidence).
- A Cancel-affordance authority defect is reproduced at the local canonical seam (→ unblock `CANCEL-AFFORDANCE-AUTHORITY-RECON`).

## Deferred work

None.

## Historical detail

Epic opened by `ACT-CLINEMM-FACTORY-FUTURE-BACKLOG-CENSUS01-CORRECTION01` (this commit). The symptom family is now durable in the canonical task index, not only in chat archaeology or in the upstream-triage RADAR clusters. The prior upstream-triage correction-04 explicitly *proposed* this epic ("for a future ACT that proposes a runtime-task-progression epic"), but did not create it; the prior census (`ACT-CLINEMM-FACTORY-FUTURE-BACKLOG-CENSUS01`) also did not promote it. This correction ACT authorizes the creation.
