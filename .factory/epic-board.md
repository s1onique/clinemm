# ClineMM Epic Board

Updated: 2026-09-02 11:30:00Z (THSICAP profile-integration ACT OPENED + STRUCTURAL_IMPLEMENTATION_SHIPPED: `ACT-CLINEMM-DOGFOOD-DIAGNOSTIC-PROFILE-TASKHEADER-CAPTURE01` folds `CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1` into the central dogfood diagnostic profile resolver (sibling to `DOGFOOD-DIAGNOSTIC-PROFILE-DIAGNOSABILITY01`); dogfood profile default ON, public default OFF, explicit env override always wins in either profile; single source of truth at `dogfood-diagnostic-profile.ts:resolveEffectiveTaskHeaderSelectorInputCapture`; the capture helper consults a module seam (set once by `applyTaskHeaderSelectorInputCaptureDiagnosticProfile` at `extension.ts:activate`, sibling to the TSWPD activation) — env-var reading happens in EXACTLY ONE place; bounded-diagnostic REMOVAL_TRIGGER preserved verbatim from the predecessor ACT; NO VIAPD UI letter (THSICAP is temporary forensic scaffolding; per Factory doctrine on temporary diagnostics, no quiet promotion to architecture); PRODUCTION_SEMANTIC_DELTA_PUBLIC = ZERO (operator opt-in on public preserved, public default OFF preserved); 5 files: new test file `dogfood-diagnostic-profile-thsicap-activation.test.ts` (T1..T6 + AC1..AC6, 22 assertions); updates to `dogfood-diagnostic-profile.ts` (+140 lines: resolver + activation helper + frozen contract block); updates to `task-header-selector-input-capture.ts` (+80 lines: module seam `captureEnabled` + `setTaskHeaderSelectorInputCaptureEnabled` / `isTaskHeaderSelectorInputCaptureEnabled` accessors; capture helper now consults ONLY the seam); updates to `extension.ts` (+14 lines: activation call at the EARLIEST initialization seam, sibling to `applyTurnStateWriterProvenanceDiagnosticProfile`); updates to `task-header-selector-input-capture.tusix01.test.ts` (capture-path tests now toggle the seam directly instead of mutating `process.env` — the env-var fallback path is preserved by `isTaskHeaderSelectorInputDiagnosticEnabled(env)` for tests that pin the env-var reading contract); 22+22 ad-hoc assertions verified end-to-end on the production resolver/helper; canonical vitest suite in `dogfood-diagnostic-profile-thsicap-activation.test.ts` for CI; 76/76 unit test files (1101/1101 tests) PASS in `bun run test:bun:unit`; typecheck clean (`tsc --noEmit` exits 0); biome lint clean; C1: GO after Factory review; C2: STRUCTURAL_IMPLEMENTATION_SHIPPED; C4: LIVE_QUALIFICATION remaining (per the bounded REMOVAL_TRIGGER)) + 2026-09-02 12:00:00Z (P1-fix turn per factory causal reviewer: REMOVED the legacy env-reader `isTaskHeaderSelectorInputDiagnosticEnabled` from `task-header-selector-input-capture.ts`; the initial implementation left it as dead production code with a misleading "single source of truth" docstring that contradicted the architecture (the new central resolver did NOT delegate to it, leaving two independently evolvable interpretations of the same env var); P1 fix removes the function entirely; the central resolver `resolveEffectiveTaskHeaderSelectorInputCapture` is now the SOLE parser of `CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1`; the capture module exports ONLY the module seam + capture helper + ring buffer accessors — production code in the capture module never reads `process.env`; the TUSIX GATE_OFF / GATE_ON / GATE_OTHER tests now exercise the central resolver directly (the SOLE authority); the misleading "single source of truth" docstring on the removed function was the only documentation of the duplicate-parser hazard — that hazard is now structurally impossible; absence is enforced at `tsc --noEmit` time (no runtime invariant needed); 39/39 durable assertions pass on the production resolver + activation helper + capture helper + dump roundtrip; 76/76 unit test files (1101/1101 tests) still PASS in `bun run test:bun:unit`; typecheck clean (`tsc --noEmit` exits 0); also tightened the §0 framing per reviewer P2 (PUBLIC_STARTUP_CONFIGURATION_SEMANTICS = CONSERVED; POST_ACTIVATION_ENV_MUTATION_SEMANTICS = INTENTIONALLY CHANGED — env resolved once at activation, not re-read on every capture; preferable architecture — `process.env` should not be an accidental runtime control plane); also fixed the stale predecessor header in `task-header-selector-input-capture.ts` to "when effective captureEnabled is false, no record is appended"; C1: GO after the bounded P1 fix; C2: STRUCTURAL_IMPLEMENTATION_SHIPPED (post-P1); C5: LIVE_QUALIFICATION remaining (per the bounded REMOVAL_TRIGGER)) + 2026-09-01 (P2_BOARD_READABILITY_MICROFIX + frontier correction per factory causal reviewer: add Approval/MCP and Context/compaction frontier rows; both have new ACT IDs that are NOT derivable from existing epic detail files, per reviewer directive to avoid corrupting TOOL-RUNTIME-RELIABILITY-RECON01 causal ownership) + 2026-09-02 (Context/compaction recon ACT CLOSED_WITH_RESIDUE; reviewer's P1 PASS_WITH_ONE_P1_FIX then C1: GO; downstream repair ACT COMPACTION-TOKEN-RESCALING-CONSUMER-REPAIR01 OPENED; reviewer-retitled from WIRE-CONTRACT-REPAIR01 since wire is NOT yet proven defective; first trial = option (d) consumer-side reconciliation, no protocol change) + 2026-09-02 08:00:00Z (reviewer's FOURTH-SECOND-PASS HALT_WRONG_REPAIR_ORACLE: the original repair ACT's frozen RED was at the H/W seam (upstream of repaired boundary) — INCORRECT, since Strategy D does not change H/W scales; CORRECTED to necessity/ablation matrix G1-G6 with the repair oracle at the consumer seam; PRODUCTION_DELTA corrected to ZERO at opening commit; STRATEGY_D = SELECTED_FOR_IMPLEMENTATION; REPAIR_STATUS = NOT_YET_APPLIED; review round closed for recon ACT; implementation commit opens its own review pass; C1: GO after P0 correction) + 2026-09-02 08:30:00Z (reviewer's FIFTH-SECOND-PASS HALT_WRONG_RED_CLAIM: the repair ACT at 8c01a6d3c still claimed it had authored the consumer-seam RED (false — no test files changed) and that REOPEN_CONDITION was proved by this turn's RED authoring (also false); REFINED to CONSUMER_RED = NOT_YET_AUTHORED / CONSUMER_RED_EXECUTED = NO; the next turn MUST author G2 in getApiMetrics.test.ts and confirm it REDs at current HEAD before any production modification per Factory doctrine "real/live failure → RED reproduction → repair"; maximum one pre-execution correction cycle has been consumed; C1: GO) + 2026-09-02 08:30:00Z (P2 stale-frontier fix: detail epic context-compaction-token-accounting.md now points at the repair ACT as the current frontier, not the read-only recon; the recon is CLOSED_WITH_RESIDUE and the discriminator/working-context-seam binding is established) + 2026-09-02 09:00:00Z (IMPLEMENTATION TURN: G2 authored and RED-confirmed at HEAD 9aef5245b (buggy consumer computed ceil(100_000 * 1_000 / 1_000_000) = 100, the wrong-scale synthesis); consumer-visible compatibility authority inspected — NO mechanically available discriminator exists (mode, messagesBefore/After, status do NOT witness INCOMPATIBLE_BASELINE at the consumer seam; the reviewer explicitly forbade inferring from chronology/mode and (a) tag provenance is a protocol change forbidden by option (d)'s first-trial constraint); Strategy-D smallest-truthful sub-case applied: drop the wrong-scale ratio transfer entirely in apps/vscode/src/shared/getApiMetrics.ts (both getLastApiReqTotalTokens and getLastApiReqContextInputTokens — drop the shrinkFraction accumulator and the Math.ceil(total * shrinkFraction) line); G2 → GREEN at post-repair HEAD; G3 (genuine-truth restoration), G4 (positive compatibility, no-compaction regime), G5 (presentation conservation) added; 4 pre-existing fabrication-locking tests renamed/re-asserted to truthful values (100_000/100_000/5_000/95_000); [R0-A] re-purposed as INVERTED-INVARIANT witness (assertion 7_101 → 167_100, preserving forensic continuity with recon §6 R0-A but flipping the semantic claim from "the consumer fabricates 7_101 (matches LIVE symptom)" to "the consumer no longer fabricates 7_101 (defect suppressed)"); 24/24 getApiMetrics.test.ts pass (was 20 before), 97/97 compaction + working-context-ratio tests pass (G1 stays GREEN as necessity control), 53/53 apps/vscode/src/shared/__tests__/ pass (zero collateral regressions), typecheck clean (tsc --project tsconfig.vscode-compat.json --noEmit exits 0); ACT repair CLOSED; recon ACT R0' (compaction input identity) SUBSUMED by G2 oracle; the recon ACT's CLOSED_WITH_RESIDUE residual is updated to "implementation executed; residual: protocol-level optimal UX (re-enable ratio for COMPATIBLE_BASELINE cases) is a follow-on ACT, not part of this ACT's contract"; implementation commit opens its own review pass per the recon ACT's C1 disposition; KNOWN UX-COST: context-window bar will display a stale pre-compaction value in the brief window between a compaction divider and the next API request, where previously it synthesized a smaller fabricated value — this is the deliberate trade-off; the next request supersedes the stale display via G3; the broad gitleaks allowlist remains P2/non-blocking as previously classified)

Source-of-truth: `.factory/epics/*.md` (19 files) — the per-epic detail files. **This board is a navigation index, not an archive.**
Contract: [`.factory/epics/_index-contract.md`](./epics/_index-contract.md) (frozen maintenance law)
Conservation anchor: `5e96cfd3a` (immutable; see §5 of the contract for the `OLD_ACT_IDS - CURRENT_REPOSITORY_ACT_IDS = ∅` invariant)

This file is intentionally short. Every detailed row links to one epic file. Per the contract’s §6, `epic-board.md < 400 lines` (hard cap) with a target of 150–220.

---

## Current frontier

One `NEXT` per lane. Closed items are not `NEXT`. See [`.factory/epics/_index-contract.md`](./epics/_index-contract.md) §4 for the frontier-rule rationale.

| Lane | Pri | State | NEXT | Detail |
|---|--:|---|---|---|
| Approval / editor-tool | P1 | HOLD | `EDITOR-TOOL-APPROVAL-FRICTION-RECON01` | [`approval-protection.md`](./epics/approval-protection.md) |
| Approval / classic | P1 | `OPEN` | `CLASSIC-PROTECTION-RECON01` | [`approval-protection.md`](./epics/approval-protection.md) |
| Approval / Seatbelt-ALL LIVE failure | P1 | `OPEN` | `SEATBELT-ALL-WORKSPACE-REALPATH-*` | [`approval-protection.md`](./epics/approval-protection.md) |
| Approval / outside-read under ALL+Seatbelt | P1 | `OPEN` | `SEATBELT-ALL-OUTSIDE-READ-POLICY-*` | [`approval-protection.md`](./epics/approval-protection.md) |
| Approval / dogfood diagnostic profile | P1 | HOLD | (operator restart + V header truth) | [`approval-protection.md`](./epics/approval-protection.md) |
| Approval / runtime identity | P1 | `CLOSED_STRUCTURAL` | (none — `RUNTIME-IDENTITY-RECON01` lands) | [`approval-protection.md`](./epics/approval-protection.md) |
| Approval / Seatbelt SSH credential authority | P1 | `OPEN` | `SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01` | [`safe-yolo-seatbelt.md`](./epics/safe-yolo-seatbelt.md) |
| Cost provenance | P1 | `HOLD` | `TASK-COST-TRUTH-RECON01` (TWO-LAYER recon) | [`task-presentation.md`](./epics/task-presentation.md) |
| Settings surface parity | P2 | `CLOSED_V2` | (none) | [`product-config-branding.md`](./epics/product-config-branding.md) |
| Runtime progression | P1 | HOLD | `FRESH_POST_REPAIR_LIVE` (post-REPAIR01) | [`runtime-task-progression.md`](./epics/runtime-task-progression.md) |
| Task-start coordinator pre-existing REDs | P1 | `CLOSED` | (none) | [`runtime-task-progression.md`](./epics/runtime-task-progression.md) |
| Runtime finish semantics | P1 | `CLOSED` | (none) | [`runtime-task-progression.md`](./epics/runtime-task-progression.md) |
| Seatbelt network egress | P0 | `CLOSED` | (none) | [`safe-yolo-seatbelt.md`](./epics/safe-yolo-seatbelt.md) |
| TaskHeader projection | P1 | `CLOSED` | (none) | [`task-presentation.md`](./epics/task-presentation.md) |
| TaskHeader selector-input capture profile | P2 | ACTIVE (recon `CLOSED_WITH_OPERATOR_DUMP_LANDED_C1_GO`; profile integration `STRUCTURAL_IMPLEMENTATION_SHIPPED + P1_FIX_SHIPPED` 2026-09-02; reviewer P1-fix complete: legacy env-reader REMOVED, central resolver is SOLE parser) | `DOGFOOD-DIAGNOSTIC-PROFILE-TASKHEADER-CAPTURE01` (folds `CLINEMM_DIAG_TASKHEADER_SELECTOR_INPUT_V1` into the central dogfood diagnostic profile; dogfood profile default ON, public default OFF, explicit env override always wins in either profile; ONE source of truth at the resolver — legacy `isTaskHeaderSelectorInputDiagnosticEnabled` REMOVED from capture module in P1-fix turn; capture helper consults module seam only; bounded-diagnostic REMOVAL_TRIGGER preserved; no VIAPD UI letter; PUBLIC_STARTUP_CONFIGURATION_SEMANTICS = CONSERVED (public install sees the same start-up semantics as before); POST_ACTIVATION_ENV_MUTATION_SEMANTICS = INTENTIONALLY CHANGED (env is resolved once at activation; preferable architecture — `process.env` should not be an accidental runtime control plane); 39 durable assertions verified end-to-end on the production resolver/helper/capture path/dump roundtrip; canonical vitest suite in `dogfood-diagnostic-profile-thsicap-activation.test.ts` for CI; LIVE_QUALIFICATION remaining per the bounded REMOVAL_TRIGGER) | [`task-presentation.md`](./epics/task-presentation.md) |
| Host substrate (host-test runner) | P0 | OPEN | `HOST-TEST RUNNER` (`HOST_REQUIRED`) | [`host-test-infrastructure.md`](./epics/host-test-infrastructure.md) |
| Build substrate / dogfood | P0 | `CLOSED` | (none) | [`factory-infrastructure.md`](./epics/factory-infrastructure.md) |
| Approval / MCP | P0 | OPEN | `MCP-AUTOAPPROVE-OFF-AUTHORITY-RECON01` (upstream #10499) | [`approval-mcp-authority.md`](./epics/approval-mcp-authority.md) |
| Context / compaction | P1 | ACTIVE (recon `CLOSED_WITH_RESIDUE`; repair `OPEN`, P0-corrected 2026-09-02 08:00:00Z — oracle at consumer seam, necessity control stays GREEN) | `COMPACTION-TOKEN-ACCOUNTING-TRUTH-RECON01` (CLOSED_WITH_RESIDUE 2026-09-02) + `COMPACTION-TOKEN-RESCALING-CONSUMER-REPAIR01` (OPEN 2026-09-02; STRATEGY_D = SELECTED_FOR_IMPLEMENTATION; PRODUCTION_DELTA = ZERO at opening; APPLIED at implementation commit) | [`context-compaction-token-accounting.md`](./epics/context-compaction-token-accounting.md) |

---

## Active epics

Every epic with `ACTIVE` family-level state (per contract §2 status vocabulary). Priority is orthogonal to status (contract §3). Detail files own the narrative.

| Epic | Pri | State | Frontier | Detail |
|---|--:|---|---|---|
| Safe-YOLO + Darwin Seatbelt | P0 | ACTIVE | `CLASSIC-PROTECTION-RECON01` + `HOST-TEST RUNNER` | [`safe-yolo-seatbelt.md`](./epics/safe-yolo-seatbelt.md) |
| Approval protection | P1 | ACTIVE | `EDITOR-TOOL-APPROVAL-FRICTION-RECON01` + `CLASSIC-PROTECTION-RECON01` | [`approval-protection.md`](./epics/approval-protection.md) |
| Command-risk classification | P1 | CLOSED | (none — fresh ACT to authorize expansion) | [`command-risk-classification.md`](./epics/command-risk-classification.md) |
| Quality substrate | P1 | ACTIVE | `CODE-COVERAGE-BASELINE01` + typecheck CI parity | [`quality-substrate.md`](./epics/quality-substrate.md) |
| Task-presentation | P1 | ACTIVE | (none — substrate closed; awaiting fresh work) | [`task-presentation.md`](./epics/task-presentation.md) |
| Task-control liveness | P1 | CLOSED | (post-sharding review only) | [`task-control-liveness.md`](./epics/task-control-liveness.md) |
| Upstream intake | P2 | CLOSED | (triage cycle closed) | [`upstream-intake.md`](./epics/upstream-intake.md) |
| Distribution / CI | P2 | ACTIVE | `GITHUB-ACTIONS01` + `GITHUB-DISTRIBUTION01` | [`distribution-ci.md`](./epics/distribution-ci.md) |
| Extension publishing | P1 | OPEN | `VSCODE-MARKETPLACE-PUBLISH-RECON01` + `OPENVSX-PUBLISH-RECON01` | [`distribution-ci.md`](./epics/distribution-ci.md) |
| Product config / branding | P2 | ACTIVE | (see file for 2 open product frontings) | [`product-config-branding.md`](./epics/product-config-branding.md) |
| Dynamic editing backends / Dirac | P1 | OPEN | `DIRAC-EDITING-RECON01` first | [`dynamic-editing-backends.md`](./epics/dynamic-editing-backends.md) |
| Host test infrastructure | P1 | OPEN | `HOST-TEST RUNNER` recon first | [`host-test-infrastructure.md`](./epics/host-test-infrastructure.md) |
| Tool runtime reliability | P1 | OPEN | `TOOL-RUNTIME-RELIABILITY-RECON01` | [`tool-runtime-reliability.md`](./epics/tool-runtime-reliability.md) |
| Architecture | P2 | ACTIVE | `ELMIZATION02` (gated on E9) | [`architecture.md`](./epics/architecture.md) |
| Factory infrastructure | P0 | ACTIVE | `GIT-SAFETY-LOCAL-FORCE-PUSH-GUARD01` (P2) | [`factory-infrastructure.md`](./epics/factory-infrastructure.md) |
| Upstream sync (structural merge) | P1 | CLOSED | (none) | (`.factory/acts/ACT-CLINEMM-UPSTREAM-SYNC-INTEGRATION01.md`) |

---

## Open supporting work

Cross-cutting / substrate work that does not fit a single epic lane. Every row links to the owning epic.

| Work | Pri | State | Dependency | Detail |
|---|--:|---|---|---|
| Typecheck CI parity | P1 | OPEN | `GITHUB-ACTIONS01` | [`quality-substrate.md`](./epics/quality-substrate.md) |
| Code-coverage baseline | P1 | OPEN | n/a | [`quality-substrate.md`](./epics/quality-substrate.md) |
| Branding activity-bar icon | P2 | OPEN | n/a | [`product-config-branding.md`](./epics/product-config-branding.md) |
| Tool-execution semantics | P2 | OPEN | n/a | [`product-config-branding.md`](./epics/product-config-branding.md) |
| Terminal-report completion framing | P2 | CLOSED | n/a | [`task-presentation.md`](./epics/task-presentation.md) |
| `EPIC-CLINEMM-CHECKPOINT-RELIABILITY01` | P1 | OPEN | n/a | [`upstream-intake.md`](./epics/upstream-intake.md) |
| `EPIC-CLINEMM-MCP-PROCESS-LIFECYCLE01` | P1 | OPEN | n/a | [`upstream-intake.md`](./epics/upstream-intake.md) |
| `EPIC-CLINEMM-CLINEIGNORE-FILTERING01` | P2 | OPEN | n/a | [`upstream-intake.md`](./epics/upstream-intake.md) |
| `EPIC-CLINEMM-PROVIDER-MODEL-DISCOVERY01` | P2 | OPEN | n/a | [`upstream-intake.md`](./epics/upstream-intake.md) |

---

## Deferred / hold

Consciously postponed or awaiting named prerequisites. Detail files carry the WHY.

| Item | State | NEXT | Detail |
|---|---|---|---|
| `BYPASS01` (temporary YOLO bypass) | DEFER | (only if `EDITOR-TOOL-APPROVAL-FRICTION-RECON01` rediscovers it) | [`approval-protection.md`](./epics/approval-protection.md) |
| E8 — legacy writer retirement | HOLD | after E7 evidence + dependencies justify it | [`architecture.md`](./epics/architecture.md) |
| E9 — effect interpreter | HOLD | after E8 | [`architecture.md`](./epics/architecture.md) |
| Runtime-task-progression `CLOSED_LIVE` upgrade | DEFER | (only after a fresh live ClineMM recurrence) | [`runtime-task-progression.md`](./epics/runtime-task-progression.md) |
| Network-policy hardening / allowlisting | DEFER | (post-V1; see file) | [`safe-yolo-seatbelt.md`](./epics/safe-yolo-seatbelt.md) |
| Authenticated-dev credential capabilities | DEFER | (see file) | [`authenticated-dev-capabilities.md`](./epics/authenticated-dev-capabilities.md) |
| Single-R0 Seatbelt execution-obligation propagation | DEFER | (see file) | [`safe-yolo-seatbelt.md`](./epics/safe-yolo-seatbelt.md) |
| R3/R4 task-control adversarial schedules | DEFER | (lane-hunting R3 / R4) | [`task-control-liveness.md`](./epics/task-control-liveness.md) |
| Temporary approval diagnostics removal cleanup | DEFER | (see file) | [`approval-protection.md`](./epics/approval-protection.md) |

---

## Historical task census

**Purpose: conservation only.** Every `ACT-CLINEMM-*` ID present in the immutable pre-sharding anchor `5e96cfd3a:.factory/epic-board.md` is listed here, grouped by family, so the contract's §5 invariant (`OLD_ACT_IDS - CURRENT_REPOSITORY_ACT_IDS = ∅`) holds. **This is an audit trail, not a status report** — state, priority, and evidence for each ACT live in the owning epic detail file (when sharded) or in `docs/closure-plans/*.json` (when externalized). The 19 detail files (alphabetical: `_index-contract`, `approval-protection`, `architecture`, `authenticated-dev-capabilities`, `closed-foundation`, `command-risk-classification`, `distribution-ci`, `dynamic-editing-backends`, `factory-infrastructure`, `host-test-infrastructure`, `product-config-branding`, `quality-substrate`, `runtime-task-progression`, `safe-yolo-seatbelt`, `task-control-liveness`, `task-presentation`, `tool-runtime-reliability`, `upstream-intake`, `webview-seam-aop`) are the canonical current state for the families they own.

The families below are mostly historical (pre-reduction). They are preserved here as ACT IDs only — no closure narrative, no embedded evidence.

```text
ACT-CLINEMM-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01
ACT-CLINEMM-ASK-RESPONSE-EPOCH-TURNSTATE-COHERENCE01
ACT-CLINEMM-ASYNC-COMMAND-OWNERSHIP-DISCRIMINATOR01
ACT-CLINEMM-ASYNC-COMMAND-OWNERSHIP-DISCRIMINATOR01-CORRECTION01
ACT-CLINEMM-ASYNC-COMMAND-OWNERSHIP-DISCRIMINATOR01-CORRECTION03
ACT-CLINEMM-ASYNC-COMMAND-OWNERSHIP-DISCRIMINATOR01-CORRECTION04
ACT-CLINEMM-ASYNC-COMMAND-TURN-LIVENESS01
ACT-CLINEMM-BACKGROUND-COMMAND-TURNSTATE-LIVENESS-RECON01
ACT-CLINEMM-BACKGROUND-HANDOFF-TURNSTATE-DISCRIMINATOR01
ACT-CLINEMM-CANONICAL-TASK-ACTIVITY-OWNERSHIP01
ACT-CLINEMM-CODE-COVERAGE-BASELINE01
ACT-CLINEMM-CODE-COVERAGE-REPORTER-KEY-CORRECTION01
ACT-CLINEMM-COMPACTION-STATE-RESTORE-REGRESSION01
ACT-CLINEMM-COMPLETION-PROTOCOL-LIVENESS01
ACT-CLINEMM-COMPLETION-PROTOCOL-LIVENESS01-CORRECTION01
ACT-CLINEMM-COMPLETION-RESPONSE-AUTHORITY-LIVE-RECON01
ACT-CLINEMM-COMPLETION-RESPONSE-AUTHORITY01-CORRECTION01
ACT-CLINEMM-CONTEXT-ACCOUNTING-TRUTH01-CORRECTION01
ACT-CLINEMM-FACTORIZE-F0-INVENTORY01
ACT-CLINEMM-FACTORIZE-F0B-BASELINE-RATCHET01
ACT-CLINEMM-FACTORIZE-F1-PACKAGE-DIRECTION01
ACT-CLINEMM-FACTORIZE-F2-COORDINATOR-TAXONOMY01
ACT-CLINEMM-FACTORIZE-F3-SHADOW-RETIREMENT01
ACT-CLINEMM-FACTORIZE-F4-SDKCONTROLLER-AUTHORITY01
ACT-CLINEMM-FACTORIZE-F5-FORK-DELTA01
ACT-CLINEMM-FACTORIZE-TOOLING01
ACT-CLINEMM-FACTORY-EPIC-BOARD-MARKDOWN-REPAIR01
ACT-CLINEMM-FACTORY-GLOBAL-TASK-CENSUS01
ACT-CLINEMM-FOLLOWUP-RESUME-SUBSCRIPTION-PARITY01
ACT-CLINEMM-FOLLOWUP-RESUME-SUBSCRIPTION-PARITY01-CORRECTION01
ACT-CLINEMM-FOLLOWUP-RESUME-SUBSCRIPTION-PARITY01-CORRECTION02
ACT-CLINEMM-FOLLOWUP-RESUME-SUBSCRIPTION-PARITY01-CORRECTION03
ACT-CLINEMM-GITHUB-ACTIONS01
ACT-CLINEMM-IN-PHASE-PUBLICATION-FAILURE-MASK-01
ACT-CLINEMM-INVALID-TOOL-INPUT-PREAPPROVAL01
ACT-CLINEMM-INVALID-TOOL-INPUT-PREAPPROVAL01-CORRECTION01
ACT-CLINEMM-INVALID-TOOL-INPUT-PREAPPROVAL01-CORRECTION02
ACT-CLINEMM-LIVE-EPOCH-REPAIR-QUALIFICATION01
ACT-CLINEMM-LIVE-NEWTASK-DISTILLATION01
ACT-CLINEMM-NEWTASK-COMPACT-ROUTING-COHERENCE01
ACT-CLINEMM-NEWTASK-DISTILLATION-HANDOFF-ARCHITECTURE01
ACT-CLINEMM-PUBLISH-CURRENT-MAIN01
ACT-CLINEMM-RATCHET-BRIDGE-EXCLUSION-FIXUP01
ACT-CLINEMM-REJECTED-COMMAND-PRESENTATION-TRUTH01
ACT-CLINEMM-RESUME-SUBSCRIPTION-PARITY01
ACT-CLINEMM-RUNTIME-TASK-PROGRESSION01
ACT-CLINEMM-SINGLE-WORKTREE-TRANSITION01
ACT-CLINEMM-TASK-COMPLETION-CONTINUATION-COHERENCE01
ACT-CLINEMM-TASK-COMPLETION-CONTINUATION-COHERENCE01-CLOSURE-FIX01
ACT-CLINEMM-TASK-COMPLETION-CONTINUATION-COHERENCE01-LIVE-QUALIFICATION01
ACT-CLINEMM-TASK-INTERACTION-OWNERSHIP-PROJECTION01
ACT-CLINEMM-TASK-INTERACTION-OWNERSHIP-PROJECTION01-RUNTIME-SHADOW-REACTIVATION01
ACT-CLINEMM-TASKHEADER-CANONICAL-PROJECTION-MIGRATION01
ACT-CLINEMM-TASKHEADER-CANONICAL-PROJECTION01
ACT-CLINEMM-TASKHEADER-LIVE-ACTIVITY-COHERENCE01
ACT-CLINEMM-TASKHEADER-LIVE-TIMER-ZERO-RESET01
ACT-CLINEMM-TASKHEADER-OWNER-AWARE-TIMING01
ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01
ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01-CORRECTION01
ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01-CORRECTION01-FIX01
ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS01
ACT-CLINEMM-UPSTREAM-ISSUE-INTAKE-SUBSTRATE01
ACT-CLINEMM-USER-CONTEXT-CEILING01-CORRECTION01
```

Validator interpretation: the audit-trail block above is the canonical "where do the unsharded ACT IDs live" answer. If an ACT is listed both here and in an epic detail file, the detail file wins for current-state claims; the audit-trail block is the authoritative conservation record.


---

## Recently closed transitions

Short transition notes for closures that materially change the live state. Detailed closure claims live in `docs/closure-plans/*.json` and `.factory/evidence/<ACT>/`.

| Date | Lane | Verdict | Detail |
|---|---|---|---|
| 2026-09-02 | Task presentation | CLOSED_WITH_OPERATOR_DUMP_LANDED_C1_GO | [`task-presentation.md`](./epics/task-presentation.md) (predecessor ACT `6eaa0864`: ROOT_CAUSE_ISOLATED_FOR_GENERIC_SUBCASE / REPAIR_VERIFIED_FOR_EXERCISED_CONTRACT — UNBOUND-shadow demotion guard at `selectTaskHeaderPresentation`; LIVE specimen taskId 1788292664979_9qbpd epoch 16 NOT YET closed; reviewer dispositions 2026-09-02 HALT_LIVE_BINDING_NOT_PROVEN (CORRECTION01) + HALT_CAPTURE_NOT_EXPORTABLE (FIX01) both honored; CORRECTION01 (`84dbaaade`) landed bounded in-memory diagnostic capture; FIX01 (`762b7cdb3`) closed the operator-export gap by adding `cline.debug.dumpTaskHeaderSelectorInputDiagnostic` + `cline.debug.clearTaskHeaderSelectorInputDiagnostic` mirroring the TSWPD runtime exactly; TUSIX01-OPERATOR_DUMP_ROUNDTRIP proves record → dump → exact selector fields survive; operator runbook now mechanically executable end-to-end (env var + reproduce + command palette + JSONL inspection); REMOVAL_TRIGGER documented per Factory doctrine; helper coverage pinned mechanically against the TurnPhase union (4+2+2=8 literals); PRODUCTION_DIAGNOSTIC_DELTA = YES (5 files), PRODUCTION_SEMANTIC_DELTA = ZERO WHEN DISABLED, SELECTOR_REPAIR_DELTA = ZERO; CASE_A selector authority defect; 234/234 task-header-related tests PASS across 18 files; typecheck clean; C1: GO to dogfood) |
| 2026-09-01 | Approval / classic | CLOSED | [`approval-protection.md`](./epics/approval-protection.md) (correlation ACT `0bbf3c1d7`: CORRELATION_HYPOTHESIS_ELIMINATED at the correlation layer; product-level #10783 immunity NOT YET PROVEN) |
| 2026-09-01 | Runtime progression | CLOSED | [`runtime-task-progression.md`](./epics/runtime-task-progression.md) |
| 2026-08-31 | Approval / dogfood | CLOSED | [`approval-protection.md`](./epics/approval-protection.md) |
| 2026-08-31 | Seatbelt outside-read | CLOSED | [`safe-yolo-seatbelt.md`](./epics/safe-yolo-seatbelt.md) |
| 2026-08-31 | Upstream sync integration | CLOSED | (`.factory/acts/ACT-CLINEMM-UPSTREAM-SYNC-INTEGRATION01.md`) |
| 2026-08-31 | Settings sandbox capabilities | CLOSED | [`product-config-branding.md`](./epics/product-config-branding.md) |
| 2026-08-31 | Approval specimen capture | CLOSED | [`approval-protection.md`](./epics/approval-protection.md) |
| 2026-08-31 | Upstream sync recon | CLOSED | (`.factory/acts/ACT-CLINEMM-UPSTREAM-SYNC-RECON01.md`) |
| 2026-08-31 | Seatbelt SSH credential authority | CLOSED | [`safe-yolo-seatbelt.md`](./epics/safe-yolo-seatbelt.md) |
| 2026-08-31 | Cost display truth | CLOSED | [`task-presentation.md`](./epics/task-presentation.md) |
| 2026-08-29 | Settings surface parity | CLOSED | [`product-config-branding.md`](./epics/product-config-branding.md) |
| earlier | Main consolidation | CLOSED | [`product-config-branding.md`](./epics/product-config-branding.md) |
| earlier | Safe-YOLO core safety substrate | CLOSED | [`safe-yolo-seatbelt.md`](./epics/safe-yolo-seatbelt.md) |
| earlier | YOLO approval-friction recon | CLOSED | [`approval-protection.md`](./epics/approval-protection.md) |
| earlier | Upstream-intake triage cycle | CLOSED | [`upstream-intake.md`](./epics/upstream-intake.md) |
| earlier | Webview-seam AOP | CLOSED | [`webview-seam-aop.md`](./epics/webview-seam-aop.md) |
| earlier | Closed foundation | CLOSED | [`closed-foundation.md`](./epics/closed-foundation.md) |

---

## Maintenance contract

### Index ownership (per [`_index-contract.md`](./epics/_index-contract.md) §1)

```text
epic-board.md     → current navigation / state only
epics/*.md        → durable current conclusions + ACT ledgers + bounded historical context
closure-plans +
  evidence        → exact ACT contract + executable evidence
```

A summary may **narrow** evidence; it must **never strengthen** evidence. When evidence contradicts a row, evidence wins.

### Repository topology (compact)

```text
canonical repository:        ClineMM (this repo)
canonical branch:            main
development topology:        one Git worktree (linked worktrees forbidden by default)
protected evidence:          preserve explicitly named stashes / artifacts
historical architecture:     act/elm-architecture01-e0-e4 (merged, retained temporarily; P2 cleanup)
```

### Remote push safety (compact; full form in [`factory-infrastructure.md`](./epics/factory-infrastructure.md))

```text
NORMAL PUSH:    fast-forward only; requires explicit user / ACT authority; origin/main must be ancestor of local main
FORCE PUSH:     categorically FORBIDDEN — applies to main, feature/release branches, tags, humans, agents, CI
CORRECTION:     create new commits · revert · merge / rebase locally before publication · new branch / ref if needed
                — DO NOT rewrite already-published remote history
```

Enforcement epic: `EPIC-CLINEMM-GIT-SAFETY-NO-FORCE-PUSH01` (ruleset `cline-- protect published history`, id=21037630).

### Board maintenance rule

Update **only rows affected by a meaningful ACT**. Do not rewrite the whole board. Each row should preferably contain: `ID`, `STATUS`, `PRIORITY`, `PURPOSE / SYMPTOM`, `DEPENDENCIES`, `NEXT ACT`, `EVIDENCE / COMMIT`. Avoid giant prose. If an item is closed, preserve enough identity to avoid re-litigation. If evidence contradicts a row, evidence wins; the row becomes P2 stale metadata.

### Task census rule

Every actionable task discussed for ClineMM has one canonical row in this board (or, since the 2026-08-27 reduction, in the per-epic detail files). Future planning authority is this board + per-epic detail files + source/Git/evidence. Routine project-thread archaeology is no longer required. When a new task is discussed, add the row at the next meaningful ACT boundary.

### Status vocabulary

Closed-class per [`_index-contract.md`](./epics/_index-contract.md) §2: `NEXT`, `OPEN`, `BLOCKED`, `HOLD`, `DEFER`, `CLOSED` (+ qualifiers), `SUPERSEDED`, `NEEDS_CLASSIFICATION`, `HOST_REQUIRED` (modifier), `ACTIVE` (family-level). See the contract for the exact meanings; the validator that follows this reduction will enforce the closed-class check.

### Size invariant

```text
epic-board.md  hard cap: < 400 lines     target: 150–220 lines
```

---
