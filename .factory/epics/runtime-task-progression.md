# EPIC-CLINEMM-RUNTIME-TASK-PROGRESSION01

> Runtime task progression: the family of "task makes progress, then execution abruptly stops, no truthful terminal framing, user must type `Continue` (or Resume / Cancel / restart)" symptoms. Distinct from `task-control-liveness.md` (closed family — that proved particular generation/queue invariants, not this broader symptom) and from `task-presentation.md` (presentation vs runtime state). See `.factory/epic-board.md` for the active index.

## Current status

- Status: OPEN — fresh epic opened at FUTURE-BACKLOG-CENSUS01-CORRECTION01 (this commit). One canonical ACT `ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01` was launched at HEAD `cf40c2b8b` (the launch commit itself; this correction commit fixes a HEAD binding bug in this durable claim); the other working labels remain until the recon evidence lands.
- Priority: **HIGH** (direct autonomy defect during supposedly autonomous YOLO runs; upstream evidence says the family remains active in current Cline-- releases)
- Current frontier: `ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01` — bounded RED-first recon + exact live RED. First action: do **not** pre-classify cause. Same ACT also covers Cancel-affordance authority against the same ownership seam (per the reviewer's recommendation).
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
| `ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01` | OPEN / HIGH | `cf40c2b8b` (LAUNCH_HEAD; the launch commit, not the subsequent docs-only correction commit) | Bounded RECON + exact live RED across the symptom family; characterize the failure modes without claiming a single root cause. INCORPORATES the Cancel-affordance authority probe as its secondary purpose (same ownership seam) — see `.factory/acts/ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01.md` and `.factory/evidence/ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01/`. |
| `CANCEL-AFFORDANCE-AUTHORITY-RECON` (working label — superseded for now; secondary purpose folded into the recon above per the launch) | SUPERSEDED (folded into `ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01`) | `cf40c2b8b` | Recon of the cancellable-ownership projection across the runtime/UI seam. Independent re-promotion is permitted if the recon findings show Cancel-authority defects that are causally distinct from runtime progression. |
| `ACT-CLINEMM-COMPLETION-PTAD-EXTEND01` | **CLOSED** | plan: `55135df7d`; impl: `9c10ae273`; P1: `081ae974a` (T1); P1 r2: `e55240372` (T2); docs: `1e0de5549`, `11c521259` | Add DEFAULT_OFF causal discriminator via existing PTAD substrate. T1-EXT01-A/B/C temporal-capture test set proves snapshot sampled before reset and immutable across reset. T2-EXT01-A/B/C production-lifecycle test set proves production code calls setTerminalResponseCommittedThisTurn before postStateToWebview AND clearTurnOutcome before postStateToWebview. Live specimen capture remains on LIVENESS02. See plan doc. |
| `ACT-CLINEMM-COMPLETION-PROTOCOL-CAPTURE-SURFACE-QUALIFICATION01` | CLOSED | `841bad562` | Bounded existing-harness qualification. Verdict: `CAPTURE_SURFACE_EXISTING_HARNESS_INSUFFICIENT` (cause: `listen EPERM on 127.0.0.1` — environmental sandbox). Unlocks the bounded PTAD-extension path. |
| `ACT-CLINEMM-COMPLETION-PROTOCOL-CAPTURE-SURFACE-RECON01` | CLOSED | `1175bb4db` | Inventory of the existing capture surface; recommended `COMPLETION-PTAD-EXTEND01` as the smallest bounded next ACT. Pure docs. |
| `ACT-CLINEMM-COMPLETION-PROTOCOL-LIVENESS02` | OPEN / ACTIVE_RECON → §10b.5 Branch A STRONG_SUPPORT (ready to close) | launch: `35f27e4d7`; reclassification: `(this ACT; §10b)`; prior: `aac6c6986` (Phase-0 capture) + `f9186dfcd` (P0 specimen-binding correction) | Reopened against the new bound specimen `1787832864738_ik2zh` captured under `CLINEMM_PTAD=1` opt-in (post `ACT-CLINEMM-PTAD-ENV-OPTIN01` at `02a35fabf`). 64 extension-push + 64 webview-push records across sv=7933..8300; terminal transition at sv=8299 (`runtimeStatus: running → completed`, `legacyPhase: streaming → awaiting_followup`); `attemptCompletionSeen=false` and `terminalResponseCommittedThisTurn=false` across all 64 captures. Specimen evidence at `.factory/evidence/ACT-CLINEMM-COMPLETION-PROTOCOL-LIVENESS02/ptad-{extension,webview}.jsonl` (SHA-256-bound). **§10b.5 verdict — reclassified by reviewer bound-specimen challenge**: (1) `BOUND_SPECIMEN_RUNTIME_CONFIG = PASS` — `mode="act"` read directly from `~/.cline/data/globalState.json` and `autoApprovalSettings.actions.*=true` (Seatbelt-YOLO) read from the same source; (2) `COMPLETION_TOOL_REGISTRY_CLASSIFIED = STRONG_SUPPORT` — `finalTools ⊅ {submit_and_exit}` because `ToolPresets.act.enableSubmitAndExit = false` (`presets.ts:34`) AND `apps/vscode/src/sdk/` never wires `toolExecutors.submit`; (3) `USER_FACING_YOLO_VS_CORE_PRESET = DECOUPLED` — VS Code UI YOLO toggle (Seatbelt host authorization) does NOT flow into `config.mode` (`SdkController.ts:1440-1443` returns only `"plan" | "act"`); (4) `PROMPT_VS_RUNTIME_MISMATCH = SURFACED` — `system.ts:65-66` says "you must call submit_and_exit" but the VS Code adapter never registers the tool; (5) `NECESSITY_ABLATION = STATIC_PASS / RUNTIME_NOT_EXECUTED` — the static ablation at §10b.4 reveals `mode="yolo"` alone would NOT register the tool without the executor; vitest EPERM-blocked the runtime flip. The ablation + binding narrow the causal gap to two missing wiring decisions in `apps/vscode/src/sdk/`: (a) UI YOLO toggle → `config.mode`, (b) `toolExecutors.submit` wiring. Either repair, by itself, would expose `submit_and_exit` and resolve the prompt/runtime tension. RED-A authorship remains DEFER to the downstream `ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-CONTRACT01` (§10b.6) which decides whether the gap is a defect. Phase-0 `NOT_PROVEN` verdict against `1787562381026_jao7c` is **not retracted** — superseded by the present specimen only. |
| (RUNTIME_THINKING_STALL cluster — RADAR evidence, not canonical proof) | RADAR (per `.factory/upstream/cline-upstream-triage.md` Correction-04) | — | Upstream supporting signals: #9546, #10015, #10031, #10208, #10537. Newer upstream reports (#12073, #12079, #12827) are recorded as **RADAR / reference only**, not canonical proof — they reinforce the family but do not by themselves establish a ClineMM defect |

## Open work

- **`RUNTIME-TASK-PROGRESSION-RECON01`** (HIGH). First ACT: bounded RECON + exact live RED. The deliverable is a markdown document that (a) characterizes the failure modes observed in our local recurrence, (b) maps each observed mode to one or more upstream signals (RADAR), (c) proposes a bounded RED-family test seam (not implementation), (d) does NOT pre-classify cause. Do not implement any production change in this ACT.
- **`CANCEL-AFFORDANCE-AUTHORITY-RECON`** (HIGH). Recon of the cancellable-ownership projection across the runtime/UI seam; verifies the "Cancel iff cancellable owner exists" invariant in both directions. First deliverable: a regression that fails when the invariant is violated in either direction (idle+Cancel visible, or active+Cancel absent). Do not invent a third authority; the invariant above is already durable.
- **`COMPLETION-PROTOCOL-LIVENESS02`** (HIGH → §10b.5 Branch A STRONG_SUPPORT → ready to close). Bound specimen at `1787832864738_ik2zh` (launched `35f27e4d7`). The §3b discriminator is now anchored at §10b.1 — `mode="act"` and `autoApprovalSettings.actions.*=true` (Seatbelt-YOLO) are read directly from durable state, not inferred. The §10b.4 ablation reveals a sharper finding than the original single-variable chain: even flipping `mode="yolo"` would NOT register `submit_and_exit` because `apps/vscode/src/sdk/` never wires `toolExecutors.submit`. Two distinct missing wirings: (a) UI YOLO toggle → `config.mode`, (b) `toolExecutors.submit`. RED-A authorship deferred per §10b.6 — the architectural decision (does Seatbelt-YOLO demand completion authority?) belongs to `ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-CONTRACT01`. **Closure path**: LIVENESS02 closes with `PASS_BRANCH_A_STRONG_SUPPORT_CAUSAL_CANDIDATE_IDENTIFIED_ABORTED_FOR_PRODUCT_CONTRACT` (§13 exit shape); the Seatbelt-YOLO contract ACT opens on the precise yes/no question in §10b.6. Once LIVENESS02 closes, `EDITOR-TOOL-APPROVAL-FRICTION-RECON01` resumes `NEXT` status (one-ACT preemption rule). Per the reviewer's one-ACT preemption, this preempted `EDITOR-TOOL-APPROVAL-FRICTION-RECON01` for exactly one bounded cycle.

Reopen / new-work conditions:

- A new user-visible non-progressing-task symptom is reproduced at the local canonical seam (→ reopen `RUNTIME-TASK-PROGRESSION-RECON01` or open a per-symptom ACT).
- A `RUNTIME_THINKING_STALL` upstream issue graduates from RADAR to IMPORT against this epic (requires a strict destination-contract test against the recon evidence).
- A Cancel-affordance authority defect is reproduced at the local canonical seam (→ unblock `CANCEL-AFFORDANCE-AUTHORITY-RECON`).

## Deferred work

None.

## Historical detail

Epic opened by `ACT-CLINEMM-FACTORY-FUTURE-BACKLOG-CENSUS01-CORRECTION01` (this commit). The symptom family is now durable in the canonical task index, not only in chat archaeology or in the upstream-triage RADAR clusters. The prior upstream-triage correction-04 explicitly *proposed* this epic ("for a future ACT that proposes a runtime-task-progression epic"), but did not create it; the prior census (`ACT-CLINEMM-FACTORY-FUTURE-BACKLOG-CENSUS01`) also did not promote it. This correction ACT authorizes the creation.
