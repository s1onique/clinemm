# FWL02 — Recovered current execution frontier

> Recovered from the committed ClineMM engineering documentation by
> `ACT-CLINEMM-FWL02-B-HISTORICAL-RECONCILIATION-01`. The legacy board
> (`.factory/epic-board.md`) remains authoritative until explicit cutover
> approval. This document is a migration artifact, not a new authority.

## Reading rules

- An entry below is an **engineering obligation** recovered from source, not an ACT execution attempt.
- `original_status` is the source's own status token, verbatim. `lifecycle` is the normalized view. `qualification` is a **historical source assertion**, never a newly verified acceptance.
- A blocked entry names its blocker explicitly. A deferred obligation is NOT on this frontier.
- Where source records disagree, the conflict is retained and referenced by its reconciliation record rather than silently resolved.

## Current obligations

### EPIC-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY/FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01

- **Title.** File-tool workspace-escape authority recon
- **Workstream.** file-tool-workspace-realpath-authority
- **Lifecycle.** ACTIVE
- **Priority.** P0
- **Original status (verbatim).** OPEN (RECON lane)
- **Historical qualification.** UNQUALIFIED
- **Current ACT.** ACT-CLINEMM-FILE-TOOL-WORKSPACE-REALPATH-AUTHORITY-RECON01
- **Note.** The board's Current frontier table records this lane as taking priority over the post-Q5-GREEN Waiting qualification (`FRESH_POST_REPAIR_LIVE = PENDING / NON-BLOCKING` does NOT gate this ACT). The lane is `OPEN (RECON lane)` with reviewer verdict `C1: GO_FILE_TOOL_SECURITY_RECON` on commit `217e7f53c`. The live-failure bind is still pending (`NO_LIVE_FAIL_BIND_YET`): the observed `/Projects/Runtime/...` mutation is a containment-boundary candidate, not yet bound to a creator.
- **Source.** `.factory/epic-board.md`, `.factory/epics/file-tool-workspace-realpath-authority.md`

### EPIC-CLINEMM-APPROVAL-MCP-AUTHORITY/MCP-AUTOAPPROVE-OFF-AUTHORITY-RECON01

- **Title.** MCP auto-approval-off authority recon
- **Workstream.** approval-mcp-authority
- **Lifecycle.** OPEN
- **Priority.** P0-if-reproduced
- **Original status (verbatim).** OPEN
- **Historical qualification.** UNQUALIFIED
- **Current ACT.** ACT-CLINEMM-MCP-AUTOAPPROVE-OFF-AUTHORITY-RECON01
- **Note.** Deterministic security boundary: the upstream defect says execution proceeds without approval, which is a fail-closed-against-the-user violation. Priority is `P0-if-reproduced` — the priority is conditional on recon, and is NOT asserted as a current confirmed P0. Read-only recon; no production change until the live-vs-structural question resolves.
- **Source.** `.factory/epic-board.md`, `.factory/epics/approval-mcp-authority.md`

### EPIC-CLINEMM-APPROVAL-PROTECTION/EDITOR-TOOL-APPROVAL-FRICTION-RECON01

- **Title.** Editor/tool YOLO confirmation-UI recon
- **Workstream.** approval-protection
- **Lifecycle.** ACTIVE
- **Priority.** HIGH
- **Original status (verbatim).** NEXT / HIGH
- **Historical qualification.** UNKNOWN
- **Current ACT.** ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01
- **Blocker.** Operator-driven live editor/non-command specimen plus host/Aqua availability are the remaining gates; the completion-authority prerequisite is SATISFIED.
- **Note.** CONFLICTED FRONTIER STATE. The two epic files record the lane as NEXT (approval-protection.md Open work; runtime-task-progression.md Open work states "Now restored to NEXT with the prior IMPLEMENTATION01 blocker removed"), while the board's Current frontier table records the SAME lane as `HOLD`. Both claims are preserved; see the SOURCE_CONFLICT reconciliation record. The ACT is authorized to proceed in its recon phases but the live specimen gate is outstanding — readiness is not execution authorization.
- **Source.** `.factory/epics/approval-protection.md`, `.factory/epics/runtime-task-progression.md`

### EPIC-CLINEMM-APPROVAL-PROTECTION/CLASSIC-PROTECTION-RECON01

- **Title.** Classic (non-Seatbelt) approval protection recon
- **Workstream.** approval-protection
- **Lifecycle.** OPEN
- **Priority.** HIGH
- **Original status (verbatim).** OPEN / HIGH
- **Historical qualification.** UNQUALIFIED
- **Current ACT.** ACT-CLINEMM-CLASSIC-PROTECTION-RECON01
- **Note.** The next-frontier after Safe-YOLO is fully closed. Unblocked by `SEATBELT-DEFAULT-ON01` closure (now satisfied) — the source states the blocker is resolved, so this is NOT blocked.
- **Source.** `.factory/epics/approval-protection.md`, `.factory/epics/safe-yolo-seatbelt.md`

### EPIC-CLINEMM-SAFE-YOLO-SEATBELT/HOST-TEST-RUNNER

- **Title.** HOST-TEST RUNNER — host-orchestrated end-to-end test runner
- **Workstream.** safe-yolo-seatbelt
- **Lifecycle.** OPEN
- **Priority.** HIGH
- **Original status (verbatim).** OPEN / HIGH
- **Historical qualification.** UNQUALIFIED
- **Current ACT.** (none — no ACT is currently executing)
- **Note.** Board row 18, `HOST_REQUIRED`. The canonical detail file is host-test-infrastructure.md; the safe-yolo and approval-protection rows are explicit cross-links to the same obligation. Must be authored as a NEW ACT — do NOT roll the runner into an existing closed ACT, which would invalidate closure evidence.
- **Source.** `.factory/epics/safe-yolo-seatbelt.md`, `.factory/epics/host-test-infrastructure.md`

### EPIC-CLINEMM-SAFE-YOLO-SEATBELT/R5-MANUAL-APPROVAL-LANE

- **Title.** R5 manual approval lane — open R5 defect trigger
- **Workstream.** safe-yolo-seatbelt
- **Lifecycle.** OPEN
- **Priority.** P0
- **Original status (verbatim).** OPEN
- **Historical qualification.** UNQUALIFIED
- **Current ACT.** (none — no ACT is currently executing)
- **Note.** Not a separate ACT — a standing trigger that reopens the R5 lane when a genuine R5 defect matches the `NEXT_R5_TRIGGER` predicate (mode=all + mandatorySeatbelt=true + all path-bearing operands inside authorized workspace roots + no explicit deny / hard floor / missing evidence, AND `finalDecision=ask` AND the approval UI published).
- **Source.** `.factory/epics/safe-yolo-seatbelt.md`

### EPIC-CLINEMM-RUNTIME-TASK-PROGRESSION/RUNTIME-TASK-PROGRESSION-RECON01

- **Title.** Runtime task progression recon
- **Workstream.** runtime-task-progression
- **Lifecycle.** OPEN
- **Priority.** HIGH
- **Original status (verbatim).** HIGH
- **Historical qualification.** UNKNOWN
- **Current ACT.** ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01
- **Note.** OWN01 RED reproduced at HEAD `f106bc63d`; OWN02-OWN03-RECON at CAPTURE_INSUFFICIENT. The producer-side successor `ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-RECON01` is CLOSED / VERDICT_AMENDED / NOT_LIVE_CAUSE. The source's operational action is `RETURN_TO_SSH_LIVE_QUALIFICATION` and it explicitly says `DO NOT open ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-REPAIR01`.
- **Source.** `.factory/epics/runtime-task-progression.md`

### EPIC-CLINEMM-RUNTIME-TASK-PROGRESSION/CANCEL-AFFORDANCE-AUTHORITY-RECON

- **Title.** Cancel-affordance authority recon
- **Workstream.** runtime-task-progression
- **Lifecycle.** OPEN
- **Priority.** HIGH
- **Original status (verbatim).** HIGH — partial
- **Historical qualification.** INSUFFICIENT
- **Current ACT.** (none — no ACT is currently executing)
- **Blocker.** The LIVE four-value capture half is outstanding; the static source-seam map half is already bound.
- **Note.** The static source-seam map half is bound by `ACT-CLINEMM-TASK-CANCEL-UI-RECON01` (CLOSED / RECON_ONLY / CAPTURE_INSUFFICIENT). The LIVE capture half requires an operator-driven four-value capture to discriminate `UI_RENDER_DEFECT` from `TURN_STATE_PROJECTION_DEFECT` from benign non-streaming phases.
- **Source.** `.factory/epics/runtime-task-progression.md`

### EPIC-CLINEMM-CONTEXT-COMPACTION-TOKEN-ACCOUNTING/COMPACTION-HEADER-BAR-FRESHNESS-RECON01

- **Title.** Post-compaction header-bar freshness recon
- **Workstream.** context-compaction-token-accounting
- **Lifecycle.** ACTIVE
- **Priority.** P1
- **Original status (verbatim).** OPEN 2026-09-02; RECON_ONLY
- **Historical qualification.** PARTIAL
- **Current ACT.** ACT-CLINEMM-COMPACTION-HEADER-BAR-FRESHNESS-RECON01
- **Blocker.** The recon MUST author the real RED only after the C1/C2/C3 semantic contract is frozen.
- **Note.** Defect A (cross-scale arithmetic) and Defect B (post-restore publication) are CLOSED at HEAD. Defect C (post-compaction header-bar staleness) is a LIVE consumer-level witness, but FULL_UI_PRODUCTION_SEAM_REPRODUCTION = NOT YET: the committed 2/2 test exercises the shared metrics consumer, NOT the actual ChatView → ContextWindow/TaskHeader render chain. WIRE_KIND_CHANGE = NOT_AUTHORIZED_YET.
- **Source.** `.factory/epic-board.md`, `.factory/epics/context-compaction-token-accounting.md`

### EPIC-CLINEMM-QUALITY-SUBSTRATE/CODE-COVERAGE-BASELINE01

- **Title.** Code-coverage baseline
- **Workstream.** quality-substrate
- **Lifecycle.** OPEN
- **Priority.** HIGH
- **Original status (verbatim).** OPEN / HIGH
- **Historical qualification.** UNQUALIFIED
- **Current ACT.** ACT-CLINEMM-CODE-COVERAGE-BASELINE01
- **Note.** The ratchet ACT (`CODE-COVERAGE-RATCHET01`) is closed and ready to enforce non-regression once the baseline is set; the baseline itself is not yet fixed.
- **Source.** `.factory/epics/quality-substrate.md`, `.factory/epic-board.md`

### EPIC-CLINEMM-QUALITY-SUBSTRATE/TYPECHECK-ZERO-BASELINE01

- **Title.** Typecheck zero-diagnostic baseline — CI parity leg
- **Workstream.** quality-substrate
- **Lifecycle.** BLOCKED
- **Priority.** P1
- **Original status (verbatim).** CLOSED at local canonical seam; OPEN at CI parity
- **Historical qualification.** PARTIAL
- **Current ACT.** (none — no ACT is currently executing)
- **Depends on.** EPIC-CLINEMM-DISTRIBUTION-CI/GITHUB-ACTIONS01
- **Blocker.** The CI-parity leg is tracked under `EPIC-CLINEMM-GITHUB-ACTIONS01`; the workflow does not currently gate the canonical tsc command.
- **Note.** CLOSED at the local canonical seam; OPEN at CI parity. This is an explicitly source-stated DEPENDS_ON, not an inferred dependency.
- **Source.** `.factory/epics/quality-substrate.md`, `.factory/epic-board.md`

### EPIC-CLINEMM-PRODUCT-CONFIG-BRANDING/TASK-COST-TRUTH-RECON01

- **Title.** Two-layer cost-provenance recon
- **Workstream.** product-config-branding
- **Lifecycle.** BLOCKED
- **Priority.** P1
- **Original status (verbatim).** OPEN / HOLD_FOR_EXECUTION
- **Historical qualification.** UNKNOWN
- **Current ACT.** ACT-CLINEMM-TASK-COST-TRUTH-RECON01
- **Blocker.** Held until the operational frontier (`EDITOR-TOOL-APPROVAL-FRICTION-RECON01`, `OPEN / WAITING_FOR_LIVE_SPECIMEN`) is bound; sequenced next after that.
- **Note.** Recon-only. The closing condition is `(Layer-1, Layer-2)`. Until §3 produces a specimen, `CORRECTNESS = UNKNOWN` and the dollar amount is NEVER the stop rule.
- **Source.** `.factory/epics/product-config-branding.md`

### EPIC-CLINEMM-PRODUCT-CONFIG-BRANDING/UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01

- **Title.** Upstream settings-surface parity recon
- **Workstream.** product-config-branding
- **Lifecycle.** BLOCKED
- **Priority.** P2
- **Original status (verbatim).** OPEN / HOLD_FOR_EXECUTION
- **Historical qualification.** PARTIAL
- **Current ACT.** ACT-CLINEMM-UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01
- **Blocker.** Held until the operational frontier is bound; sequenced after `TASK-COST-TRUTH-RECON01`.
- **Note.** CONFLICTED FRONTIER STATE — see the SOURCE_CONFLICT and OPERATOR_JUDGEMENT reconciliation records. The epic file places the ACT here as `OPEN / HOLD_FOR_EXECUTION` with a TENTATIVE placement pending the ACT's §11 owning-epic decision tree; the board's Current frontier table records the same lane as `CLOSED_V2` with no NEXT. The migration does not assert either as a closure.
- **Source.** `.factory/epics/product-config-branding.md`, `.factory/epic-board.md`

### EPIC-CLINEMM-ARCHITECTURE/ELMIZATION02

- **Title.** ELMIZATION02 — authority-domain migration
- **Workstream.** architecture
- **Lifecycle.** BLOCKED
- **Priority.** P2
- **Original status (verbatim).** OPEN
- **Historical qualification.** UNKNOWN
- **Current ACT.** (none — no ACT is currently executing)
- **Depends on.** EPIC-CLINEMM-ARCHITECTURE/E9
- **Blocker.** E9 (effect interpreter) must complete before ELMIZATION02's authority-domain recon starts.
- **Note.** Target direction: Elm → deterministic state transitions / policy / projections; TypeScript → VS Code APIs + effects; React → rendering / DOM/event adaptation. Forbidden goal: "Rewrite everything in Elm".
- **Source.** `.factory/epics/architecture.md`

### EPIC-CLINEMM-FACTORY-INFRASTRUCTURE/GIT-SAFETY-LOCAL-FORCE-PUSH-GUARD01

- **Title.** Local pre-push force-push guard
- **Workstream.** factory-infrastructure
- **Lifecycle.** OPEN
- **Priority.** P2
- **Original status (verbatim).** OPEN (P2, non-blocking)
- **Historical qualification.** UNQUALIFIED
- **Current ACT.** ACT-CLINEMM-GIT-SAFETY-LOCAL-FORCE-PUSH-GUARD01
- **Note.** Defense-in-depth second line behind the GitHub ruleset `cline-- protect published history` (`id=21037630`).
- **Source.** `.factory/epics/factory-infrastructure.md`, `.factory/epic-board.md`

### EPIC-CLINEMM-DISTRIBUTION-CI/GITHUB-ACTIONS01

- **Title.** GitHub Actions recon
- **Workstream.** distribution-ci
- **Lifecycle.** OPEN
- **Priority.** P2
- **Original status (verbatim).** OPEN
- **Historical qualification.** UNQUALIFIED
- **Current ACT.** ACT-CLINEMM-GITHUB-ACTIONS-RECON01
- **Note.** Recon first, repair never — the first ACT is a recon, not a repair. This is the dependency target for the quality-substrate typecheck CI-parity leg.
- **Source.** `.factory/epics/distribution-ci.md`, `.factory/epic-board.md`

### EPIC-CLINEMM-TOOL-RUNTIME-RELIABILITY/TOOL-RUNTIME-RELIABILITY-RECON01

- **Title.** Tool/command runtime-correctness recon
- **Workstream.** tool-runtime-reliability
- **Lifecycle.** OPEN
- **Priority.** HIGH
- **Original status (verbatim).** HIGH
- **Historical qualification.** UNKNOWN
- **Current ACT.** (none — no ACT is currently executing)
- **Note.** No ACT authored yet; this is a working label. The deliverable characterizes each of the 7 clusters, promotes only those passing the strict destination-contract test, and does NOT pre-classify cause. The 23 upstream issues remain RADAR / cluster-assigned.
- **Source.** `.factory/epics/tool-runtime-reliability.md`

### EPIC-CLINEMM-DYNAMIC-EDITING-BACKENDS/DIRAC-EDITING-RECON01

- **Title.** Dirac-style editing-backend recon
- **Workstream.** dynamic-editing-backends
- **Lifecycle.** OPEN
- **Priority.** P1
- **Original status (verbatim).** OPEN
- **Historical qualification.** UNQUALIFIED
- **Current ACT.** (none — no ACT is currently executing)
- **Note.** No ACT authored yet; this is a working label. Conservative-first ordering: recon first, abstraction second, backend integration third, qualification fourth.
- **Source.** `.factory/epics/dynamic-editing-backends.md`

### EPIC-CLINEMM-PRODUCT-CONFIG-BRANDING/BRANDING01

- **Title.** Visible branding umbrella
- **Workstream.** product-config-branding
- **Lifecycle.** OPEN
- **Priority.** P2
- **Original status (verbatim).** OPEN
- **Historical qualification.** UNQUALIFIED
- **Current ACT.** ACT-CLINEMM-BRANDING-ACTIVITYBAR-ICON01
- **Note.** First bounded slice `ACT-CLINEMM-BRANDING-ACTIVITYBAR-ICON01` (board row 24, `NEXT / MED`). Icon: `‖ → --`.
- **Source.** `.factory/epics/product-config-branding.md`

## Deferred obligations (not on the frontier)

Deferred work is explicitly postponed by the source. It is represented in the epic records with `lifecycle: DEFERRED` and is NOT part of the current execution frontier. Unknown source status is never represented as DEFERRED — it is represented as UNRESOLVED.

- `EPIC-CLINEMM-APPROVAL-PROTECTION/BYPASS01` — BYPASS01 — temporary YOLO bypass (de-queued) (DEFER).
- `EPIC-CLINEMM-APPROVAL-PROTECTION/DESTRUCTIVE-SCOPE-REFINEMENT-RECON` — ACT-CLINEMM-DESTRUCTIVE-SCOPE-REFINEMENT-RECON01 — destructive scope refinement (FUTURE / UNIMPLEMENTED).
- `EPIC-CLINEMM-APPROVAL-PROTECTION/APPROVAL-TRANSACTION-RECORDER-FUTURE-WORK` — Approval transaction recorder — future work (FUTURE / UNIMPLEMENTED).
- `EPIC-CLINEMM-ARCHITECTURE/E8` — E8 — legacy writer retirement (HOLD).
- `EPIC-CLINEMM-ARCHITECTURE/E9` — E9 — effect interpreter (HOLD).
- `EPIC-CLINEMM-AUTHENTICATED-DEV-CAPABILITIES/AUTH-DEV-CAP-DESIGN01` — AUTH-DEV-CAP-DESIGN01 — per-family credential-capability design (DEFER).
- `EPIC-CLINEMM-FACTORY-INFRASTRUCTURE/HUSKY-TOOLCHAIN-PATH-PORTABILITY01` — HUSKY-TOOLCHAIN-PATH-PORTABILITY01 — repository hook tool discovery portability (FUTURE / DEFER).
- `EPIC-CLINEMM-FACTORY-INFRASTRUCTURE/UPSTREAM-CATCHUP-RECON01` — ACT-CLINEMM-UPSTREAM-CATCHUP-RECON01 — upstream fork-distance catch-up (FUTURE / UNIMPLEMENTED).
- `EPIC-CLINEMM-PRODUCT-CONFIG-BRANDING/TEMP-INTERNAL-CONTROL-CLEANUP` — TEMP-INTERNAL-CONTROL-CLEANUP — cross-cutting child of settings-parity (FUTURE / DEFER).
- `EPIC-CLINEMM-PRODUCT-CONFIG-BRANDING/BRANDING-DEMO-JAN1-ICON` — ACT-CLINEMM-BRANDING-DEMO-JAN1-ICON01 — January 1 demo icon decoration (FUTURE / UNIMPLEMENTED).
- `EPIC-CLINEMM-RUNTIME-TASK-PROGRESSION/CLOSED-LIVE-UPGRADE` — RUNTIME-TASK-PROGRESSION `CLOSED_LIVE` upgrade (DEFER).
- `EPIC-CLINEMM-SAFE-YOLO-SEATBELT/TEMP-INTERNAL-CONTROL-CLEANUP` — TEMP-INTERNAL-CONTROL-CLEANUP — temporary / internal control inventory and classification (FUTURE / DEFER).
- `EPIC-CLINEMM-SAFE-YOLO-SEATBELT/SINGLE-R0-EXECUTION-OBLIGATION-PROPAGATION` — ACT-CLINEMM-SEATBELT-ALL-R0-EXECUTION-OBLIGATION-RECON01 — R0 execution-obligation propagation (DEFER / NOT_STARTED / RECON_REQUIRED).
- `EPIC-CLINEMM-SAFE-YOLO-SEATBELT/NETWORK-POLICY-HARDENING` — Network-policy hardening / allowlisting (post-V1) (DEFER).
- `EPIC-CLINEMM-TASK-CONTROL-LIVENESS/R3-R4-ADVERSARIAL-SCHEDULES` — R3/R4 task-control adversarial schedules (DEFER).

## Unresolved engineering interpretation

Records whose migration information is insufficient or conflicting. These are NOT deferred and NOT terminal — they are explicitly unresolved and require operator reconciliation.

- **OPERATOR_JUDGEMENT** — ACT-CLINEMM-UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01.
- **MISSING_INFORMATION** — EPIC-CLINEMM-IECR.
- **MISSING_INFORMATION** — EPIC-CLINEMM-ARCHITECTURE/E7.
- **MISSING_INFORMATION** — EPIC-CLINEMM-SAFE-YOLO-SEATBELT/SEATBELT-ALL-R0-EXECUTION-OBLIGATION-PROPAGATION.

## IECR disposition

`IECR_CONSOLIDATED_BOARD_NOT_PRESENT_IN_SOURCE`

The committed source contains no `EPIC-CLINEMM-IECR` epic document, no `.factory/epics/` file for it, and no board row naming it. The consolidated IECR epic board was never formally delegated to codium-clinemm; the operator will supply it separately for explicit new-epic registration rather than fabricated historical migration. This is not a repository migration defect.

## Qualification boundary

Actual Leamas import qualification is **NOT_EXECUTED** in this ACT. The mechanical extraction, the semantic reconciliation and the source-integrity verification recorded in `validation-receipt.json` are producer-side checks only. `SOURCE_RECONCILIATION_READY` authorizes operator-executed shadow qualification; it is not authoritative cutover approval.
