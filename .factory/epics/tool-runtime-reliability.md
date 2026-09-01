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
| `ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON01` | CLOSED / NOT_REPRODUCED + STRUCTURAL_OBSERVATION | `b589f439b` | Foreground-await seam repro; A1-A4 PRODUCTION probes; verdict preserved (correction chain CLOSED). |
| `ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON01-CORRECTION01` | CLOSED / P1_BUILD_CONTRACT | `b589f439b` | Test-fixture type correction (`vscode.Terminal` typed, no `as` cast). |
| `ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON02` | CLOSED (GREEN) | `a90f36a4b` | Post-tool advance-stall recon, frozen at the `RESULT_EXISTS` entry seam. Cause-neutral; load-bearing cluster = `#10537` + `#10122`; `#13691` demoted to adjacent RADAR (no evidence the result exists); `#12079` is a heterogeneous witness. Single §2 production-seam discriminator `P1_RESULT_PUBLICATION_TO_SESSION_EVENT` at the `[1]→[3]` boundary (RESULT_EXISTS → `SdkMessageCoordinator.appendAndEmit` → session-event listener) = **GREEN**: `[1]→[3]` CONSERVED at the production seam. Disposition = `NOT_REPRODUCED_WITHIN_OWNED_BOUNDARY / HANDOFF_RUNTIME_TASK_PROGRESSION / STOP`. Production delta = ZERO. Test artifact: `apps/vscode/src/sdk/tool-runtime-reliability-recon02.production-seam.test.ts` (89 lines, bun:test + chai, PASSING). Evidence: `.factory/evidence/ACT-CLINEMM-TOOL-RUNTIME-RELIABILITY-RECON02/{source-seam-map.md,probe-result-publication-to-session-event.md,probe-p1-run-log.txt,final-report.md}`. |
| (terminal-timeout / wait lifecycle cluster — 9 issues) | RADAR / cluster-assigned | — | Upstream supporting signals; per-issue destination-contract test required for IMPORT. **RECON01 closed A1-A4** of this cluster at the foreground await surface; remaining radar (#11550 / #10931 / #12079 / #10063) carried by RECON02's OUT-OF-SCOPE list. |
| (tool-call parsing cluster — 5 issues) | RADAR / cluster-assigned | — | Same pattern |
| (MCP routing / approval / validation cluster — 3 issues) | RADAR / cluster-assigned | — | Cross-ref to `EPIC-CLINEMM-MCP-PROCESS-LIFECYCLE01` for the process-lifecycle subset |
| (shell integration cluster — 2 issues) | RADAR / cluster-assigned | — | — |
| (tool loop / retry cluster — 2 issues) | RADAR / cluster-assigned | — | — |
| (file-edit reliability cluster — 1 issue) | RADAR / cluster-assigned | — | Cross-ref to `dynamic-editing-backends.md` if the defect is backend-dependent |
| (tool-approval UX cluster — 1 issue) | RADAR / cluster-assigned | — | Cross-ref to `approval-protection.md` (YOLO + Seatbelt approval surface) |
| (post-tool advance stall — load-bearing: `#10537`, `#10122`) | PROMOTED to RECON02 (entry seam: `RESULT_EXISTS`) | — | New cluster label; recon ACT may promote further to a bounded repair ACT only if `ROOT_CAUSE_ISOLATED` at a real production seam. |
| (post-tool advance stall — adjacent RADAR: `#13691`) | RADAR / cluster-assigned (no result-exists evidence) | — | Carried for trace; not in load-bearing RECON02 cluster. |
| (post-tool advance stall — heterogeneous witness: `#12079`) | RADAR / cluster-assigned (separate internal classification; user-restart only) | — | Carried for trace; the heterogeneous internal classification across #10537/#10122/#12079 is exactly why `CAUSE = UNKNOWN` and production-seam RED discipline are appropriate. |

**Note.** The proposed foreground-waiter-bound repair was rejected before opening; it never acquired a canonical ACT identity. The durable halt is documented in this epic's prose, not in a ledger row.

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
