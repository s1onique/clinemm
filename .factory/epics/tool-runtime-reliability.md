# EPIC-CLINEMM-TOOL-RUNTIME-RELIABILITY01

> Tool / command execution correctness at the runtime layer: did the individual tool execute, return, time out, parse, route, retry, terminate correctly? Distinct from `product-config-branding.md` `TOOL-EXECUTION-SEMANTICS01` (which is **telemetry classification** — observing/projection truth, not runtime correctness) and from `runtime-task-progression.md` (which is what happens **after** a tool event — did the agent/task make the correct state transition). See `.factory/epic-board.md` for the active index.

## Current status

- Status: OPEN — fresh epic opened at FUTURE-BACKLOG-CENSUS01-CORRECTION01 (this commit). No ACT authored yet; the items below are working labels (canonical ACT IDs are assigned per FACT-001 in `.factory/epics/factory-infrastructure.md`).
- Priority: **HIGH** (multiple user-visible bugs at this boundary; the dominant cluster in the upstream triage is *terminal timeout / wait lifecycle* with 9 issues)
- Current frontier: `TOOL-RUNTIME-RELIABILITY-RECON01` (working label) — bounded RED-first recon; first action must NOT pre-classify cause.
- Blocked by: n/a.

## Contract / durable conclusions

- **Scope.**

  ```text
  tool-runtime-reliability
    = "did an individual tool/command execute, return,
       time out, parse, route, retry, terminate correctly?"

  runtime-task-progression
    = "after that event, did the overall agent/task make
       the correct state transition and continue?"

  tool-execution-semantics
    = "telemetry classification of what the tool was
       (mechanism / outcome / duration / effect-class / purpose)"
  ```

  These three questions are **separately answerable** and must NOT be merged into a single epic. Per `.factory/upstream/cline-upstream-triage.md` Correction-03, the original over-broad mapping to `TOOL-EXECUTION-SEMANTICS01` (which conflated runtime correctness with telemetry classification) was rejected; this correction ACT re-establishes that boundary by creating a dedicated epic for runtime correctness.

- **Ground in the Correction-03 cluster.**

  ```text
  terminal-timeout / wait lifecycle      9
  tool-call parsing                      5
  MCP routing / approval / validation    3
  shell integration                      2
  tool loop / retry                      2
  file-edit reliability                  1
  tool-approval UX                       1
  total                                 23
  ```

  These 23 upstream issues are recorded as **RADAR / cluster-assigned** in `.factory/upstream/cline-upstream-triage.md` Correction-03; none has graduated to IMPORT yet. The recon ACT may promote a subset to IMPORT only after the strict destination-contract test is satisfied for this epic.

- **Per-cluster ACTs are the right shape.** Each cluster is its own bounded ACT surface; do not bundle terminal-timeout work with tool-call-parsing work. The umbrella epic owns the cross-cluster inventory; per-cluster ACTs own the bounded repair / observation.

- **Do NOT pre-classify cause.** Per FACT-001, every working label remains a working label until the recon evidence lands. No speculative single-cause fix.

- **MCP process-lifecycle and tool-approval UX are already imported upstream epics.** `EPIC-CLINEMM-MCP-PROCESS-LIFECYCLE01` (upstream #7413) and the tool-approval UX piece (`approval-protection.md`) are durable siblings; this epic cross-references them but does not subsume them.

## ACT ledger

| ACT / ID | Verdict | Head | Purpose |
|---|---|---|---|
| `TOOL-RUNTIME-RELIABILITY-RECON01` (working label) | OPEN / HIGH | — | Bounded RECON + exact live RED across the 23-cluster inventory; do **not** pre-classify cause |
| (terminal-timeout / wait lifecycle cluster — 9 issues) | RADAR / cluster-assigned | — | Upstream supporting signals; per-issue destination-contract test required for IMPORT |
| (tool-call parsing cluster — 5 issues) | RADAR / cluster-assigned | — | Same pattern |
| (MCP routing / approval / validation cluster — 3 issues) | RADAR / cluster-assigned | — | Cross-ref to `EPIC-CLINEMM-MCP-PROCESS-LIFECYCLE01` for the process-lifecycle subset |
| (shell integration cluster — 2 issues) | RADAR / cluster-assigned | — | — |
| (tool loop / retry cluster — 2 issues) | RADAR / cluster-assigned | — | — |
| (file-edit reliability cluster — 1 issue) | RADAR / cluster-assigned | — | Cross-ref to `dynamic-editing-backends.md` if the defect is backend-dependent |
| (tool-approval UX cluster — 1 issue) | RADAR / cluster-assigned | — | Cross-ref to `approval-protection.md` (YOLO + Seatbelt approval surface) |

## Open work

- **`TOOL-RUNTIME-RELIABILITY-RECON01`** (HIGH). First ACT: bounded RECON + exact live RED. The deliverable is a markdown document that (a) characterizes each of the 7 clusters against local ClineMM evidence, (b) promotes only the clusters that pass the strict destination-contract test against this epic, (c) leaves the rest as RADAR with a clear re-promotion path, (d) does NOT pre-classify cause. No production change in this ACT.

Reopen / new-work conditions:

- A cluster reproduces at the local canonical seam (→ the cluster ACT gets unblocked and authored as a bounded repair ACT).
- An upstream `RELATED_TOOL_RUNTIME` issue graduates from RADAR to IMPORT against this epic.
- A new cluster is observed locally that does not fit the 7-cluster taxonomy (→ the umbrella taxonomy is amended in a separate ACT; this ACT does not grow it).

## Deferred work

None. The per-cluster ACTs are RADAR today and will become OPEN only when the recon ACT promotes them.

## Historical detail

Epic opened by `ACT-CLINEMM-FACTORY-FUTURE-BACKLOG-CENSUS01-CORRECTION01` (this commit). The 23-issue cluster inventory is preserved verbatim in `.factory/upstream/cline-upstream-triage.md` Correction-03, so the durable artifact is unchanged. The previous upstream-intake explicitly *proposed* this epic; the previous census (`ACT-CLINEMM-FACTORY-FUTURE-BACKLOG-CENSUS01`) also did not create it. This correction ACT authorizes the creation, with `TOOL-RUNTIME-RELIABILITY01` as the canonical umbrella epic ID.
