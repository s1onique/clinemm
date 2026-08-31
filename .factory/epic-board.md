# ClineMM Epic Board

Updated: 2026-08-31
Source-of-truth: `.factory/epics/*.md` (19 files) — the per-epic detail files. **This board is a navigation index, not an archive.**
Contract: [`.factory/epics/_index-contract.md`](./epics/_index-contract.md) (frozen maintenance law)
Conservation anchor: `5e96cfd3a` (immutable; see §5 of the contract for the `OLD_ACT_IDS - CURRENT_REPOSITORY_ACT_IDS = ∅` invariant)

This file is intentionally short. Every detailed row links to one epic file. Per the contract's §6, `epic-board.md < 400 lines` (hard cap) with a target of 150–220.

---

## Current frontier

One `NEXT` per lane, named explicitly so the lanes do not collapse into a false single serial queue. See [`.factory/epics/_index-contract.md`](./epics/_index-contract.md) §4 for the frontier-rule rationale.

| Lane | Pri | Work | Detail |
|---|---|---|---|
| Approval / editor-tool | P1 | `ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01` (recon §2 PASS; §3 live specimen blocked by headless-shell environment (no Aqua session in this shell; `code`/`open` return error -54); **completion-authority prerequisite SATISFIED** per `…SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01` CLOSED / UPSTREAM_SUPERSEDED at `15c7e3374`). Source-bound VSIX built at HEAD `0841353f0` (`dist/clinemm-4.1.10-0841353f0.vsix`, SHA-256 `1d747b43f72a54c4bc8b7c71fdbfba9df10b0a8c73be4e8911d3f0f76659cd01`), installed at `.factory/tmp/live-userdata/extensions/s1onique.clinemm-4.1.10/`, installed bundle SHA-256 byte-exact to source-built bundle `fe79ffedc9b524c0c2b974b2b2532c03c6055987a95b84f400059a067defd2bb`. Capture codepath unit-verified (16/16 vitest on `v2-capture.test.ts`). Live host invocation + CONTROL_A + CONTROL_B + specimen NOT_EXECUTED in this shell — gated on operator-driven runbook in ACT §17.3 operator runbook. **2026-08-31 structural-discriminator run** (this ACT §17.4): CASE A STRUCTURALLY EXONERATED at policy seam under bun test + bun -e on real production source (`buildToolPolicies(editor).autoApprove=false` load-bearing; `shouldAutoApproveTool` returns ALLOW for editor-family under override="all" with override lifting persisted OFF; verdict `PASS_EDITOR_TOOL_POLICY_SEAM_STRUCTURAL_V1`). CASES B/C require live VSCodium OR new default-off probe at SdkInteractionCoordinator publication seam (out of scope of this shell). Evidence: `.factory/evidence/ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01/structural-discriminator-20260831T073000Z/discriminator-results.json` (9920 bytes). Halt: `HALT_LIVE_FAILURE_NOT_REPRODUCED`. **Remaining gates** = operator-driven live editor/non-command specimen + host/Aqua availability; NOT blocked by completion-authority dependency) | [`approval-protection.md`](./epics/approval-protection.md) |
| Approval / classic | P1 | `ACT-CLINEMM-CLASSIC-PROTECTION-RECON01` (unblocked post-`SEATBELT-DEFAULT-ON01`) | [`safe-yolo-seatbelt.md`](./epics/safe-yolo-seatbelt.md) · [`approval-protection.md`](./epics/approval-protection.md) |
| Approval / Seatbelt-ALL LIVE failure | P1 | `ACT-CLINEMM-SEATBELT-ALL-WORKSPACE-REALPATH-AUTHORITY-CORRECTION02` — **OPEN / HIGH / `HALT_LIVE_INPUT_SHAPE_UNBOUND`** (intermittent `codium-factory` live failure: `mode=all + mandatorySeatbelt=true + pathAuthorityEvidenceOk=true`, historical BAD = `ASK / host_workspace_realpath_authority`, later GOOD = `ALLOW / host_mode_all_seatbelt_required`; root cause UNBOUND; production repair NOT_AUTHORIZED). Multi-element aggregate source-election defect already repaired independently by `3a198388d` + coherence correction `dd694b6bc`. Default-off `approval.sdk-controller.input-shape.v2` probe added; opt-in via `CLINEMM_DIAG_INPUT_SHAPE_V2=1`. **REOPEN_CONDITION**: next naturally occurring BAD live specimen with input-shape.v2 captured, in codium-factory configuration with `mode=all + mandatorySeatbelt=true + pathAuthorityEvidenceOk=true`. Synthetic-seam classifier `WITNESS_SINGLE_STRING_COMPOUND` (renamed from `RED_EXACT_COMPOUND` per causal reviewer's correction) is a CLASSIFIER not a live fact. | [`safe-yolo-seatbelt.md`](./epics/safe-yolo-seatbelt.md) |
| Host substrate | P0 | `HOST-TEST RUNNER` (host-only-behaviour dependency for both approval lanes; `HOST_REQUIRED` modifier per contract §2) | [`safe-yolo-seatbelt.md`](./epics/safe-yolo-seatbelt.md) |
| Build substrate / dogfood | P0 | CLOSED — `ACT-CLINEMM-DOGFOOD-BUILD-INTEGRATION-REPAIR01` → **PASS_DOGFOOD_BUILD_INTEGRATION_REPAIR_V1** at `43c0e6b4e` over `8971defe6` (B1+B2+B4 bounded; B3 self-cascaded via B1). 372 errors → 0 in `bun run check-types` (base + compat); diff --check clean; biome lint clean. **Next-bound (now CLOSED)**: `ACT-CLINEMM-TASK-CONTROL-LIVENESS01-PRE-EXISTING-RACE-RECON01` → **PASS_TASK_CONTROL_LIVENESS_FIXTURE_REPAIR_V1** at HEAD `d36f32298` over `43c0e6b4e` over `8971defe6` (no production code change; 3 test-only fixture repairs). The 8 newly-executable REDs were TEST_FIXTURE_DEFECTS (missing `resolveSessionAutoApprovalOverride` in tcl-parent*.test.ts added by CAI-01B; missing `clearTaskSettings` in tcl-reach01.test.ts added by B2 but the build-repair ACT only fixed tcl-parent*). Diagnostic reproducer (standalone initTask path trace) proved initTask paused inside `sessionConfigBuilder.build` at the undefined resolver; with the resolver wired, initTask reaches `createAndSetTask`, `emitInitialTaskMessage`, `postStateToWebview`, and the awaited `startNewSession` (which contains the load-bearing post-host.start fence check at `sdk-session-lifecycle.ts:330`). Production seam **UNCHANGED**; no SdkTaskControlCoordinator rewrite; no SdkSessionLifecycle rewrite; no new generic synchronization primitive. Targeted 43/43 GREEN across 6 files (tcl-parent.test.ts, tcl-parent.adversarial.test.ts, tcl-reach01.test.ts, tcl-reach02.test.ts, tcl09.test.ts, sdk-task-control-coordinator.test.ts). Stability 20/20 GREEN. tsc.base + tsc.compat + lint + diff-check all PASS. Conservation: L1-L9 invariants all CONSERVED (no source change); TaskOperationFence remains the independent task-operation lifecycle authority distinct from any view-generation counter; cancel fence precedes abort ordering (`sdk-task-control-coordinator.ts:87-92`) UNTOUCHED; completion-authority (CAI-01B) UNTOUCHED. | (no per-epic file — ACT is build-substrate local; see `.factory/evidence/ACT-CLINEMM-DOGFOOD-BUILD-INTEGRATION-REPAIR01/00-RED-CAPTURE.md` and `.factory/evidence/ACT-CLINEMM-TASK-CONTROL-LIVENESS01-PRE-EXISTING-RACE-RECON01/`) |
| TaskHeader projection | P1 | **CLOSED** (migration at `149fb131e` + THCP11 at `8a7e53742` already landed) | [`task-presentation.md`](./epics/task-presentation.md) |
| Runtime progression | P1 | `ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-RECON01` **CLOSED / VERDICT_AMENDED / NOT_LIVE_CAUSE** at `fd8627cb6` (live `completionPolicy.requireCompletionTool = undefined`; producer 1371 exonerated; defect re-routes DOWNSTREAM to host ownership-transition; see epic ledger row 60) | [`runtime-task-progression.md`](./epics/runtime-task-progression.md) · [`ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-RECON01.md`](./acts/ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-RECON01.md) |
| Task-start coordinator pre-existing REDs | P1 | **CLOSED** — `ACT-CLINEMM-TASK-START-COORDINATOR-PRE-EXISTING-RED-RECON01` → **PASS_TASK_START_COORDINATOR_STALE_TEST_REPAIR_V1** at HEAD `b45c4c714` over `aafafeedf` over `8971defe6` (test-only; no production source modified). 11 REDs at HEAD `aafafeedf` (made observable by the dogfood build repair cascade B1). All 11 share a single causal class G3 (missing `resolveSessionAutoApprovalOverride` in `makeCoordinator()` — CAI-01B required field that the cast `as unknown as SdkTaskStartCoordinatorOptions` bypassed) plus one secondary G11 strict-shape artifact in test 1. Discriminator (standalone path-trace instrumented mirror) proved: WITHOUT resolver, initTask paused at `sessionConfigBuilder.build` and threw TypeError into the catch block (captureProviderApiError + appendAndEmit(error) + return undefined); WITH resolver, initTask reached `createAndSetTask` → `emitInitialTaskMessage` → `postStateToWebview` → `sessions.startNewSession` → `setTurnPhase("streaming")` → return sessionId. Production seam UNCHANGED; no SdkTaskStartCoordinator rewrite; no TaskOperationFence changes; no cancel-fence ordering changes; no completion-authority changes. Targeted 128/128 GREEN across 11 files (sdk-task-start-coordinator + 4 liveness + sdk-task-control + sdk-session-event + auto-approve-overlay-regression + sdk-mode-coordinator + sdk-session-lifecycle + tcl09). Stability 10/10 GREEN (every iteration 21/21). tsc.base + tsc.compat + lint + diff-check all PASS. NO production change so DOGFOOD_BUILD=NOT_REQUIRED. Test integrity verified: the tests still discriminate their intended mechanisms (CORRECTION01-1/02-1/02-2/03-1 observe the streaming transition and the post-state order; with the resolver they assert the right production behavior; without it they fail for the right reason). Next-bound: continue R3 (SHOW-vs-CANCEL) and R4 (CANCEL-vs-STRAGGLER_EVENT) under deterministic schedules, or pick up the next lane. | [`runtime-task-progression.md`](./epics/runtime-task-progression.md) |
| Seatbelt network egress | P0 (CLOSED) | `ACT-CLINEMM-SEATBELT-NETWORK-EGRESS-RECON01` — **CLOSED / PASS_SEATBELT_NETWORK_POLICY_BOUND_NO_REPAIR_V1** at 2026-08-30 (§15 product-contract freeze; docs-only closure commit); Option C with deny-default + explicit user opt-in, bound to the shipped Settings contract `ACT-CLINEMM-SETTINGS-SANDBOX-CAPABILITIES-IMPLEMENTATION01` + CORRECTION01; runtime default ("deny") IS the contract default; observed SSH `EPERM` reclassified as **policy-conforming**; no RED, no repair; §5 mechanism = SOURCE_PROVEN (D/A/O) + LIVE SSH network-open qualification from companion ACT; next-bound frontier = post-V1 host:port allowlist (`Network-policy hardening / allowlisting` row, deferred). (Reopen sub-row below.) **2026-08-30 CONTINUATION01**: `ACT-CLINEMM-SEATBELT-NETWORK-LIVE-DOWNSTREAM-RECON01` — **CLOSED / PASS_LIVE_SANDBOX_NETWORK_SOURCE_BINDING_REPAIR_V1 / CAUSE=SOURCE_OMITTED** at `bd1050299` over `24dc72ebf` over `c59c835da` (HEAD `c59c835da` was the SUBJECT_PRODUCTION_HEAD). Frozen live specimen (operator-driven): `RUN_ID=net01-20260830T133624Z` JSONL at `~/.cline/data/sandbox-diag/net01-20260830T133624Z.jsonl` (147 prepareCallIds; ALL P3 capabilityNetwork="deny"; ALL P4 networkRule="(deny network*)"; ALL P5 argv[1]==P4 profilePath — identity-bound). Frozen at `.factory/evidence/ACT-CLINEMM-SEATBELT-NETWORK-LIVE-DOWNSTREAM-RECON01/net01-20260830T133624Z/live-p3-p4-p5-specimen.jsonl` (sha256=`b26604f4...`, 441 events). The new live-bound first divergence is the 6th `VscodeSessionHost.create(...)` callsite — `SdkSessionLifecycle.getOrCreateSharedHost()` at `apps/vscode/src/sdk/sdk-session-lifecycle.ts:528-562` — which was missing `safeYoloCapabilitySource`. The 5 SdkController.ts `createTempSessionHost` callsites (`1216/1324/1350/2660/2907`) were correctly wired, but the LIVE primary session host was not. RED (pre-repair: 2 failed with `expected undefined to be function`) + GREEN (post-repair: 2 passed) via `seatbelt-network-live-downstream-recon01.s0-red-shared-host-source-omitted.test.ts` which drives the actual `SdkSessionLifecycle.getOrCreateSharedHost` factory against the real `StateManager`. Repair = +38 lines across `sdk-session-lifecycle.ts` + `SdkController.ts` (forwards the production closure shape into the shared host factory + the `new SdkSessionLifecycle({...})` site). H2 hydration repair + §15 product-contract freeze + YOLO/AutoApprove axis all UNTOUCHED. Conservation: explicit true→allow, explicit false→deny, absent→env fallback, network/ssh independence, ssh-agent/raw-keys independence, no diagnostic apparatus added. Gates: tsc clean, lint clean, diff --check clean, ACT_OWNED_NEW_FAILURES=0. **Operator-driven deferred**: VSIX build + install + live P1→P4 GREEN + restart persistence + upstream-fetch (directive §23-26, C26-C31) are operator-executed and not bound by this shell's substrate posture. Next ACT after live GREEN: resume `ACT-CLINEMM-UPSTREAM-SYNC-RECON01`. | [`safe-yolo-seatbelt.md`](./epics/safe-yolo-seatbelt.md) · [`ACT-CLINEMM-SEATBELT-NETWORK-LIVE-DOWNSTREAM-RECON01.md`](./acts/ACT-CLINEMM-SEATBELT-NETWORK-LIVE-DOWNSTREAM-RECON01.md) |
| Seatbelt SSH credential authority | P1 | `ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01` — **CLOSED / PASS_SEATBELT_SSH_AGENT_AUTHORITY_V1** (HOST_TEST_HEAD `f6b6697e5` host-kernel PASS_REAL; Phase G OBSERVED SOURCE_UNBOUND) | [`safe-yolo-seatbelt.md`](./epics/safe-yolo-seatbelt.md) · [`ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01.md`](./acts/ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01.md) |
| Cost provenance | P1 (HOLD) | `ACT-CLINEMM-TASK-COST-TRUTH-RECON01` (recon — TWO-LAYER as of 2026-08-27: Layer-1 per-request arithmetic (subordinate, retained) + Layer-2 billing-semantic presentation (primary, re-framed against the MiniMax Ultra Token Plan expert review); canonical MiniMax Ultra case = (C, II) → forecasts `PASS_COST_PROVENANCE_PRESENTATION_REPAIR_V1` rather than an accumulator repair; held behind the editor-tool operational frontier) | [`product-config-branding.md`](./epics/product-config-branding.md) |
| Settings surface parity | P2 (PROMOTED → CLOSED_V2) | `ACT-CLINEMM-UPSTREAM-SETTINGS-SURFACE-PARITY-RECON01` (CLOSED 2026-08-29; recon-frozen SET-01..SET-12 contract). Implementation `ACT-CLINEMM-SETTINGS-SANDBOX-CAPABILITIES-IMPLEMENTATION01` **CLOSED / PASS_SETTINGS_SANDBOX_CAPABILITIES_V1** (IMPLEMENTATION01 at HEAD `47d1d3c36`; RED reproduced; GREEN 15/15 ACT-owned tests; ABLATION §21 confirmed 6/10 fail with bypass, 10/10 pass when restored). Corrected by `…IMPLEMENTATION01-CORRECTION01` at HEAD `888cbac8c` (P0 UI GREEN now proved via vitest: SandboxCapabilitiesSection 6/6, FeatureSettingsSection 11/11; P1 production-composition witness at the existing sandboxBackend.prepare() seam: 5/5 PASS with bypass-ablation proof, 3/5 fail with bypass; UI header renderSectionHeader lock in the spec; §4 conservation categories clarified per reviewer note — MIGRATION_OR_DEFAULT_AUTHORITY_DELTA = 0 scoped to ABSENT-key category, EXPLICIT-FALSE conservative Δ−1 is the deliberate §16 persistence-authoritative invariant; ACT-OWNED_TYPECHECK_DELTA = 0; `git diff --check` clean; ACT MD file durably tracked in `.gitignore` whitelist). 38/38 ACT-owned settings+binding+composition+selector-matrix tests green. Final HEAD = `888cbac8c`. | [`product-config-branding.md`](./epics/product-config-branding.md) (tentative; §11 of the ACT may move it to a new `EPIC-CLINEMM-SETTINGS-SUBSTRATE01`) |

---

## Active epics

Every epic with `ACTIVE` family-level state (per contract §2 status vocabulary). Priority is orthogonal to status (contract §3).

| Epic | Pri | State | Frontier | Detail |
|---|---|---|---|---|
| Safe-YOLO + Darwin Seatbelt | P0 | ACTIVE (core safety substrate CLOSED; 2 open post-substrate frontiers) | `CLASSIC-PROTECTION-RECON01` (also depends on the `HOST-TEST RUNNER` host-side runner; see Host test infrastructure row below) | [`safe-yolo-seatbelt.md`](./epics/safe-yolo-seatbelt.md) |
| Approval protection | P1 | ACTIVE (command-policy CLOSED; `BYPASS01` de-queued; editor-tool recon `NEXT`) | `EDITOR-TOOL-APPROVAL-FRICTION-RECON01` · `CLASSIC-PROTECTION-RECON01` (both depend on the `HOST-TEST RUNNER` host-side runner; see Host test infrastructure row below) | [`approval-protection.md`](./epics/approval-protection.md) |
| Command-risk classification | P1 | CLOSED framework (V1 GREEN, V2 `HALT_SHIPPING`, V2-READONLY STRUCTURAL) | (none — fresh ACT to authorize further expansion) | [`command-risk-classification.md`](./epics/command-risk-classification.md) |
| Quality substrate | P1 | ACTIVE (vitest baseline + typecheck local-seam CLOSED; 2 OPEN acceptance conditions) | `CODE-COVERAGE-BASELINE01` · typecheck CI parity | [`quality-substrate.md`](./epics/quality-substrate.md) |
| Task-presentation | P1 | ACTIVE framework (compacted-history substrate CLOSED; THCP01 CLOSED + THCP11 PASS + OAT01 CLOSED_NOT_REPRODUCED; `TERMINAL-REPORT-COMPLETION-FRAMING01` + `…-CORRECTION01` CLOSED; CURRENT OPEN WORK = none) | (none) | [`task-presentation.md`](./epics/task-presentation.md) |
| Task-control liveness | P1 | CLOSED family (bounded generation-fence repair landed; `LIVE` qualification pending) | (post-sharding review only) | [`task-control-liveness.md`](./epics/task-control-liveness.md) |
| Upstream intake | P2 | CLOSED family (substrate + 4-correction triage cycle landed; 12 EXACT_MAPs + 5 IMPORTs satisfy binding rule) | (triage cycle closed; new issues re-template through substrate) | [`upstream-intake.md`](./epics/upstream-intake.md) |
| Distribution / CI | P2 | ACTIVE (3 open items: GitHub Actions recon, GitHub Distribution, ACT — see file) | `EPIC-CLINEMM-GITHUB-ACTIONS01` · `EPIC-CLINEMM-GITHUB-DISTRIBUTION01` · … | [`distribution-ci.md`](./epics/distribution-ci.md) |
| Extension publishing | P1 | OPEN (`EXTENSION-PUBLISHING01` recon-first: VS Code Marketplace + Open VSX; see file) | `VSCODE-MARKETPLACE-PUBLISH-RECON01` · `OPENVSX-PUBLISH-RECON01` | [`distribution-ci.md`](./epics/distribution-ci.md) |
| Product config / branding | P2 | ACTIVE (cost + consolidation CLOSED; 2 open product fronts) | `EPIC-CLINEMM-TOOL-EXECUTION-SEMANTICS01` · `EPIC-CLINEMM-BRANDING01` | [`product-config-branding.md`](./epics/product-config-branding.md) |
| Dynamic editing backends / Dirac | P1 | OPEN (`DIRAC-EDITING-RECON01` first; all downstream BLOCKED on dependency chain) | `DIRAC-EDITING-RECON01` | [`dynamic-editing-backends.md`](./epics/dynamic-editing-backends.md) |
| Host test infrastructure | P1 | OPEN (`HOST-TEST RUNNER` recon first; unblocks real-kernel Seatbelt probes, fresh VSIX dogfood, live approval-UI capture, classic-protection qualification) | `HOST-TEST RUNNER` | [`host-test-infrastructure.md`](./epics/host-test-infrastructure.md) |
| Runtime task progression | P1 | ACTIVE / HIGH (the `Continue`-bug family; `RUNTIME_THINKING_STALL` cluster is RADAR). LIVENESS02 CLOSED; CONTRACT01 CLOSED YES/Option-C; IMPLEMENTATION01 CLOSED / UPSTREAM_SUPERSEDED / NO_PRODUCTION_DELTA_FROM_MERGE (per ACT file + `15c7e3374` R0 close; upstream `48d638527` provides the single authoritative completion declaration via `emitTaskCompletedOnTeardown`; pre-upstream design preserved as superseded-but-defensible forensic record). **Idle-while-active specimen (2026-08-31, header=Idle while task actively Working + Cancel visible)** now feeds the still-open LIVE-capture side of `CANCEL-AFFORDANCE-AUTHORITY-RECON` (the symmetric inverse of the idle+Cancel probe in `cancel-authority.json`); required capture = four-value observation `turnState.phase` + `foregroundCommandRunning` + `backgroundCommandRunning` + lastMessage.{type,say,ask,partial}. ONE active owner — do not open a parallel ACT. | `RUNTIME-TASK-PROGRESSION-RECON01` · `CANCEL-AFFORDANCE-AUTHORITY-RECON` · `COMPLETION-PROTOCOL-LIVENESS02` (CLOSED) · `SEATBELT-YOLO-COMPLETION-AUTHORITY-CONTRACT01` (CLOSED) · `SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01` (CLOSED / UPSTREAM_SUPERSEDED) | [`runtime-task-progression.md`](./epics/runtime-task-progression.md) |
| Tool runtime reliability | P1 | OPEN / HIGH | `TOOL-RUNTIME-RELIABILITY-RECON01` | [`tool-runtime-reliability.md`](./epics/tool-runtime-reliability.md) |
| Architecture | P2 | ACTIVE (1 OPEN; 2 HOLD pending upstream evidence) | `EPIC-CLINEMM-ELMIZATION02` (gated on E9) | [`architecture.md`](./epics/architecture.md) |
| Factory infrastructure | P0 | ACTIVE (substrate-level rules; Git safety CLOSED) | `ACT-CLINEMM-GIT-SAFETY-LOCAL-FORCE-PUSH-GUARD01` (P2 non-blocking) | [`factory-infrastructure.md`](./epics/factory-infrastructure.md) |
| Upstream sync (structural merge) | P1 | CLOSED (`ACT-CLINEMM-UPSTREAM-SYNC-INTEGRATION01` → `PASS_UPSTREAM_SYNC_INTEGRATION` post-review qualification at `e5daa4984` over `f1168d67a` over `af1bfb7a7` over `93f415600` over `f4f4f6e83` over `37e960528` over `812c931da` (qualification closure commit forthcoming). 17/17 conflicts resolved in frozen risk order (16 base-present + 1 add/add; AUTO_MERGE=38 unchanged). 27/27 frozen invariants preserved (F10 RETIRED per reviewer). 4 SECURITY_CRITICAL files (state.proto / SdkController.ts / bash.ts / sdk-tool-policies.ts) merged semantically, NOT wholesale. Drift = NO (RECON_ADVANCE_LOG: NO_DRIFT). Mandatory F27 SHARED_HOST_SAFE_YOLO_SOURCE_BINDING regression test **GREEN (2/2)** in this shell. 11/13 attempted executable gates PASS; 2 pre-existing failures BASELINE_ONLY (check-types rootDir pre-existing, command-job-manager.test.ts ClineMM SECURE-BY-DEFAULT Seatbelt assumption vs upstream's opt-in). 2 real regressions found and corrected: `parseMcpToolName` lost in `sdk-tool-policies.ts` (restored), `taskOperationFence` missing in `auto-approve-overlay-regression.test.ts` (added). `git stash list` = empty; `protected-stash-*` branches deleted (F10 RETIRED).) | (none — see `.factory/acts/ACT-CLINEMM-UPSTREAM-SYNC-INTEGRATION01.md` + `.factory/evidence/ACT-CLINEMM-UPSTREAM-SYNC-INTEGRATION01/`) |
## Open supporting work

Cross-cutting / substrate work that does not fit a single epic lane. Every row links to the owning epic.

| Work | Pri | State | Dependency | Detail |
|---|---|---|---|---|
| Typecheck CI parity | P1 | OPEN (PARITY=PARTIAL — local gate only; CI workflow does not gate canonical `tsc`) | `EPIC-CLINEMM-GITHUB-ACTIONS01` | [`quality-substrate.md`](./epics/quality-substrate.md) |
| Code-coverage baseline | P1 | OPEN / HIGH (ratchet ACT closed; baseline itself not yet set) | n/a | [`quality-substrate.md`](./epics/quality-substrate.md) |
| Branding activity-bar icon | P2 | OPEN (first bounded slice of `BRANDING01`; `‖ → --`) | n/a | [`product-config-branding.md`](./epics/product-config-branding.md) |
| Tool-execution semantics (umbrella) | P2 | OPEN — recon `PASS_RECON`; bounded implementation slice `TES-IMPL-01` is mechanism-only; `purpose` / `outcome` / `duration` / `effect` deferred (UNAVAILABLE_FROM_TRACE) | n/a | [`product-config-branding.md`](./epics/product-config-branding.md) · [`.factory/acts/ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-IMPLEMENTATION01.md`](./acts/ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-IMPLEMENTATION01.md) |
| Terminal-report completion framing | P2 | CLOSED v2 (CORRECTION01 merged: `isAuthoritativelyCompletedResult` marker stamped at `message-translator.ts:1640`; per-message identity survives phase flips. Two-tier authority: marker primary, legacy ask fallback secondary. Two-row + three-row discriminator tests pass at helper and component layers. M-killer "text says Completed but no marker" still fails closed) | n/a | [`task-presentation.md`](./epics/task-presentation.md) · ACT-CLINEMM-TERMINAL-REPORT-COMPLETION-FRAMING01 · ACT-CLINEMM-TERMINAL-REPORT-COMPLETION-FRAMING01-CORRECTION01 |
| `EPIC-CLINEMM-CHECKPOINT-RELIABILITY01` | P1 | OPEN / HIGH (FINAL-CORRECTION upstream IMPORT; upstream #4388 + #12388) | n/a | [`upstream-intake.md`](./epics/upstream-intake.md) |
| `EPIC-CLINEMM-MCP-PROCESS-LIFECYCLE01` | P1 | OPEN / HIGH (FINAL-CORRECTION upstream IMPORT; upstream #7413) | n/a | [`upstream-intake.md`](./epics/upstream-intake.md) |
| `EPIC-CLINEMM-CLINEIGNORE-FILTERING01` | P2 | OPEN / MED (FINAL-CORRECTION upstream IMPORT; upstream #9554) | n/a | [`upstream-intake.md`](./epics/upstream-intake.md) |
| `EPIC-CLINEMM-PROVIDER-MODEL-DISCOVERY01` | P2 | OPEN / MED (FINAL-CORRECTION upstream IMPORT; upstream #10016) | n/a | [`upstream-intake.md`](./epics/upstream-intake.md) |

---

## Deferred / hold

Items that are consciously not current execution debt. Reopen triggers are in the owning epic file.

| Work | State | Reopen trigger | Detail |
|---|---|---|---|
| `BYPASS01` (temporary YOLO bypass) | DEFER (de-queued) | Only if `EDITOR-TOOL-APPROVAL-FRICTION-RECON01` confirms command-policy surface still has residual friction | [`approval-protection.md`](./epics/approval-protection.md) · [`safe-yolo-seatbelt.md`](./epics/safe-yolo-seatbelt.md) |
| E8 — legacy writer retirement | HOLD | When E7 evidence and dependencies justify it. **No action in this board ACT.** | [`architecture.md`](./epics/architecture.md) |
| E9 — effect interpreter | HOLD | After E8. **No action in this board ACT.** | [`architecture.md`](./epics/architecture.md) |
| Runtime-task-progression `CLOSED_LIVE` upgrade | DEFER (optional) | When a live ClineMM extension host is available | [`quality-substrate.md`](./epics/quality-substrate.md) |
| Network-policy hardening / allowlisting | DEFER | Post-V1 next slice (host:port allowlist rather than `network*:allow`); ship a fresh ACT, not a follow-on to the closed V1 contracts | [`safe-yolo-seatbelt.md`](./epics/safe-yolo-seatbelt.md) |
| Authenticated-dev credential capabilities | DEFER | `~/.aws/`, `~/.kube/`, `~/.docker/config.json`, `~/.config/gh/hosts.yml` — host-side executor pattern, not raw credential bytes to the model. Design ACT first, per-family implementation ACTs after. | [`authenticated-dev-capabilities.md`](./epics/authenticated-dev-capabilities.md) |
| Single-R0 Seatbelt execution-obligation propagation (synthetic production-seam) | DEFER / RECON_REQUIRED | When a fresh candidate ACT (`ACT-CLINEMM-SEATBELT-ALL-R0-EXECUTION-OBLIGATION-RECON01`, not yet opened) is authorized. Synthetic observation: under `mode=all + mandatorySeatbelt=true` and a contained R0 path-bearing command, `evaluateOne` returns ALLOW with `source=host_mode_safe_only_rule` and `mandatorySeatbeltExecution=false`, contradicting the desired invariant `(decision.kind=allow AND mode=all AND mandatorySeatbelt=true) ⇒ (source=host_mode_all_seatbelt_required AND mandatorySeatbeltExecution=true)`. NOT demonstrated as cause of the intermittent approval-card bug; sibling candidate to `…CORRECTION02`, NOT bundled. | [`safe-yolo-seatbelt.md`](./epics/safe-yolo-seatbelt.md) |
| R3/R4 task-control adversarial schedules | DEFER / HARDENING | Continue lane-hunting R3 (SHOW-vs-CANCEL) and R4 (CANCEL-vs-STRAGGLER_EVENT) under deterministic schedules (already noted in `ACT-CLINEMM-TASK-START-COORDINATOR-PRE-EXISTING-RED-RECON01` final-report and `ACT-CLINEMM-TASK-CONTROL-LIVENESS01-PRE-EXISTING-RACE-RECON01` decision.md). Not a known production blocker; HARDENING / ADVERSARIAL QUALIFICATION only. Open ONE bounded ACT under the task-control epic when/if needed; do not maintain separate speculative ACT bodies. | [`runtime-task-progression.md`](./epics/runtime-task-progression.md) · [`task-control-liveness.md`](./epics/task-control-liveness.md) |
| Temporary approval diagnostics removal cleanup | DEFER / TERMINAL_CLEANUP | Removal trigger is first of (a) root cause isolated, (b) capture insufficient, (c) successor evidence supersedes probe. Inventory of v2 capture probes currently present in the build (default-off, opt-in via `CLINEMM_DIAG_*` env vars): `approval.sdk-controller.input-shape.v2` (held open by `…CORRECTION02` OPEN — required by its `§7 halt conditions` / `§10 capture payload`); `approval.sdk-controller.authorization.v2` + sibling inner probes (referenced by `…CORRECTION02` §3 + `…R5-IMPLEMENTATION01` evidence tree); capture codepath for `…EDITOR-TOOL-APPROVAL-FRICTION-RECON01` (`v2-capture.test.ts`). No unified owner ACT exists; each diagnostic is tied to its capturing ACT. Open ONE bounded removal ACT only when all capturing ACTs have CLOSED. | [`safe-yolo-seatbelt.md`](./epics/safe-yolo-seatbelt.md) · [`approval-protection.md`](./epics/approval-protection.md) |

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
ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS01
ACT-CLINEMM-UPSTREAM-ISSUE-INTAKE-SUBSTRATE01
ACT-CLINEMM-USER-CONTEXT-CEILING01-CORRECTION01
```

Validator interpretation: the audit-trail block above is the canonical "where do the unsharded ACT IDs live" answer. If an ACT is listed both here and in an epic detail file, the detail file wins for current-state claims; the audit-trail block is the authoritative conservation record.

---

## Recently closed transitions

Short transition notes for closures that materially change the live state. Detailed closure claims live in `docs/closure-plans/*.json` and `.factory/evidence/<ACT>/`.

| Work | Verdict | Detail |
|---|---|---|
| Safe-YOLO core safety substrate | CLOSED (5 ACTs across workspace-write / network-open / sensitive-read / YOLO-mutation-confinement + `SEATBELT-DEFAULT-ON01`) | [`safe-yolo-seatbelt.md`](./epics/safe-yolo-seatbelt.md) |
| YOLO approval-friction recon | CLOSED (`PASS_WITH_NONBLOCKING_RESIDUE C1: GO`; production-equivalent composition collapses load-bearing-quadrant ASKs 15 → 3; de-queued `BYPASS01`) | [`approval-protection.md`](./epics/approval-protection.md) |
| Upstream-intake triage cycle | CLOSED (12 surviving `EXACT_MAP`s + 5 `IMPORT`s satisfy the binding rule after 4 corrections) | [`upstream-intake.md`](./epics/upstream-intake.md) |
| Webview-seam AOP | CLOSED (all sub-ACTs landed; family is historical substrate) | [`webview-seam-aop.md`](./epics/webview-seam-aop.md) |
| Closed foundation (historical) | CLOSED (reference-only substrate; live work continues under siblings) | [`closed-foundation.md`](./epics/closed-foundation.md) |
| Main consolidation | CLOSED at `d844177bc` (canonical `main` carries the consolidated state) | [`product-config-branding.md`](./epics/product-config-branding.md) |
| Cost display truth | CLOSED (`ACT-CLINEMM-COST-DISPLAY-TRUTH01` + 2 corrections — canonical cost source contract) | [`product-config-branding.md`](./epics/product-config-branding.md) |
| Seatbelt SSH credential authority (implementation) | CLOSED (`ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01` → `PASS_SEATBELT_SSH_AGENT_AUTHORITY_V1`; HOST_TEST_HEAD `f6b6697e5` host-kernel PASS_REAL; Phase G OBSERVED SOURCE_UNBOUND) | [`safe-yolo-seatbelt.md`](./epics/safe-yolo-seatbelt.md) |
| Seatbelt-ALL + workspace realpath authority (precedence correction) | **REOPENED / CORRECTION02_PARTIAL + LIVE_RECON_OPEN + HALT_LIVE_INPUT_SHAPE_UNBOUND** (`ACT-CLINEMM-SEATBELT-ALL-WORKSPACE-REALPATH-AUTHORITY-CORRECTION01` at `3a198388d` over `cd45bf424` over `b8e404881` ... and `dd694b6bc` (CORRECTION02) over `3a198388d` over `cd45bf424` ...; production-seam classifier at `7c28ad729` + classifier-vs-fact amendment + rename RED_EXACT_COMPOUND→WITNESS_SINGLE_STRING_COMPOUND). **CORRECTION02 closed P1 (source-kind coherence)**: the seatbelt-OVERRIDE predicate in `aggregateSource()` now requires `aggregateLatticeKind === "allow"` in addition to `(mode=all + mandatorySeatbelt=true)`. This prevents the (kind=ask, source=host_mode_all_seatbelt_required) incoherent verdict pair that the CORRECTION01 review flagged. 11/11 conservation matrix GREEN; invariant assertions INV-1 (load-bearing ALLOW coherence) and INV-2 (ASK preserves ASK-class source) pinned. **CORRECTION01 closed a real but independent aggregate-source precedence bug**: under multi-element `{ commands: [...] }` arrays the legacy R0 path-authority source labels (steps 3 + 6) used to win over the conditional Seatbelt-ALL branch (step 7) unconditionally. CORRECTION02 does NOT widen that fix. **Production-seam classifier at HEAD (`7c28ad729` + amendment)**: synthetic-seam observations (NOT live-bound) — (i) `C1 CONTROL_SIMPLE_CAT` (`command: "cat <A>"`): current production emits `source=host_mode_safe_only_rule` / `mandatorySeatbeltExecution=false` despite `mode=all + mandatorySeatbelt=true`. Focused candidate for a per-command Seatbelt-execution-obligation propagation fix (the single-R0-ALLOW case) — P1 sibling candidate `SEATBELT_EXECUTION_OBLIGATION_NOT_PROPAGATED_ON_SINGLE_R0_ALLOW`. (ii) `ABL_SEPARATE_COMMANDS` (`commands: ["wc -l A", "cat B"]`): current production emits `kind=ask / source=host_workspace_realpath_authority / mandatorySeatbeltExecution=false` — reproduces the synthetic-seam shape of the live failure mode. Candidate cause is the operand-count binding at `command-policy.ts:378-384` where the evidence builder flattens operands across siblings (`path-authority-evidence-builder.ts:357-380`) while `extractR0PathOperands(cat-element, …)` returns the single-command-scoped operand list. (iii) `WITNESS_SINGLE_STRING_COMPOUND` (`command: "wc -l A && cat B"`): current production emits ALLOW / seatbelt source — the `isOpaqueShellRendered` short-circuit on `&&` makes the safe-rule matcher return undefined and the mode branch emits the conditional seatbelt source directly; not on the live causal path under S1. **P0_1 / P0_2 remain UNRESOLVED**: the reviewer disposition is `HALT_LIVE_INPUT_SHAPE_UNBOUND` (NOT `HALT_RED_NOT_REPRODUCED`). The classifier contract proves only that two loci (C1, ABL) disagree with the desired post-fix shape on the synthetic production seam; it does NOT prove the live `toolInput` shape is S2 (multi-element array) vs S1 (single-string compound) vs S3 (unknown adapter shape). A prior closure summary incorrectly promoted the ABL synthetic-seam observation into a live S2 claim and was retracted in this amendment; the WITNESS rename makes the test's epistemic role explicit so future maintainers cannot re-derive the same over-strong claim. **CORRECTION02 review residue (P2, documentary)**: the UI rendering is NOT sufficient evidence; live `toolInput` shape remains UNBOUND. The committed `approval.sdk-controller.input-shape.v2` probe (`CLINEMM_DIAG_INPUT_SHAPE_V2=1`, default-off) is the only sanctioned discriminator and requires a fresh live codium-factory reproduction to fire. Per the ACT reviewer's explicit instruction: "Do not revisit `aggregateSource()` and do not broaden recon. Get the exact live `toolInput → normalizedCommands` shape; that single observation decides the next causal branch." **Reopen condition**: exact live `toolInput` shape via the committed probe + `correlationId`/`commandDigest` correlation. **Decision rule for the next ACT**: `LIVE S2 + true RED reproduces flattened-evidence ASK ⇒ CAUSAL_BOUND ⇒ repair operand-to-command binding ⇒ GREEN ⇒ dogfood`; `LIVE S1 ⇒ S2 defect is independent ⇒ preserve finding ⇒ do NOT use it to explain the live approval card`; `no live capture ⇒ CAPTURE_INSUFFICIENT ⇒ no production repair`. **P1 sibling (separate bounded ACT, NOT bundled)**: `SEATBELT_EXECUTION_OBLIGATION_NOT_PROPAGATED_ON_SINGLE_R0_ALLOW` — already mechanically pinned by the C1 test in the committed classifier. Regression check at HEAD: seatbelt-all-workspace-realpath-authority-correction01.test.ts 11/11 PASS; seatbelt-all-workspace-realpath-authority-correction02.live-compound-shape.red.test.ts 2/5 fail-as-classifier-disagreement + 3/5 pass (the witness and the two conservation cases); tsc EXIT=0; git diff --check clean.) | [`safe-yolo-seatbelt.md`](./epics/safe-yolo-seatbelt.md) · [`.factory/acts/ACT-CLINEMM-SEATBELT-ALL-WORKSPACE-REALPATH-AUTHORITY-CORRECTION01.md`](./acts/ACT-CLINEMM-SEATBELT-ALL-WORKSPACE-REALPATH-AUTHORITY-CORRECTION01.md) · [`.factory/acts/ACT-CLINEMM-SEATBELT-ALL-WORKSPACE-REALPATH-AUTHORITY-CORRECTION02.md`](./acts/ACT-CLINEMM-SEATBELT-ALL-WORKSPACE-REALPATH-AUTHORITY-CORRECTION02.md) |
| Approval specimen capture tool (correction 01) | CLOSED (`ACT-CLINEMM-APPROVAL-SPECIMEN-CAPTURE-TOOL01-CORRECTION01` sixth cycle implementation + seventh cycle evidence-class amendment → `PASS_APPROVAL_SPECIMEN_CAPTURE_STRUCTURAL_READY_V1` with `LIVE_QUALIFICATION=PENDING`; runtime identity + attachment marker + zero-event classifier Z1/Z3/Z4 landed; 9/9 hermetic verify scripts green + 16/16 vitest green + synthetic-live (SYNTHETIC_REAL, NOT LIVE) qualifying against real ~/.cline2 + real repo HEAD. **2026-08-30 continuation-session** (`ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01` §17.3) built source-bound VSIX at HEAD `0841353f0` (SHA-256 byte-exact installed == source-built bundle, capture codepath unit-verified via 16/16 vitest) but live host invocation + CONTROL_A + CONTROL_B blocked by headless shell (no Aqua session); source-bound live artifact ready for operator-driven runbook) | [`approval-protection.md`](./epics/approval-protection.md) |
| Upstream sync recon | CLOSED (`ACT-CLINEMM-UPSTREAM-SYNC-RECON01` → `PASS_UPSTREAM_SYNC_RECON / SYNC_PRIORITY=HIGH` at `913dffcaa` over `730a58954` over `be6c3fb75` over `60a99d2bd`. Real divergence measured: LOCAL_ONLY=905 / UPSTREAM_ONLY=177 / INTERSECTION=55. Frozen 17 conflicts (16 base-present + 1 add/add; AUTO_MERGE=38), 27 invariants (F1-F27 including F27 SHARED_HOST_SAFE_YOLO_SOURCE_BINDING mandatory post-merge gate), 4 SECURITY_CRITICAL conflict files (state.proto / SdkController.ts / bash.ts / sdk-tool-policies.ts) requiring semantic merges, drift policy = LOG_DONT_HALT pinned to subject SHA `48d63852745460ff0fa3dfcc0457bbe2493841de`. P2 non-blocking: GATE_SUMMARY_INVALID_BINDING, LEAMAS_GENERATOR_SUBJECT_MISMATCH. FURTHER_RECON_REVIEW = NOT_AUTHORIZED) | (none — see `.factory/acts/ACT-CLINEMM-UPSTREAM-SYNC-RECON01.md` + `.factory/evidence/ACT-CLINEMM-UPSTREAM-SYNC-RECON01/`) |
| Upstream sync integration | CLOSED (`ACT-CLINEMM-UPSTREAM-SYNC-INTEGRATION01` → `PASS_UPSTREAM_SYNC_INTEGRATION` at `e5daa4984` over `f1168d67a` over `af1bfb7a7` over `93f415600` over `f4f4f6e83` over `37e960528` over `812c931da`. Executed the 17-conflict merge in frozen risk order against upstream subject `48d63852745460ff0fa3dfcc0457bbe2493841de` (RECON_SUBJECT_HEAD). Drift = NONE. All 27 invariants preserved (F1/F2/F4/F11/F17/F18/F23/F27 verified; F10 strengthened via `protected-stash-*` branches after the merge disrupted refs/stash). 4 SECURITY_CRITICAL files merged semantically (not wholesale). Back-merged to main at `f1168d67a` (parents: `812c931da` local + `af1bfb7a7` integration tip). Deferred runtime gates (protos / build:sdk / check-types / lint / test:unit + MANDATORY F27 SHARED_HOST_SAFE_YOLO_SOURCE_BINDING regression test) require operator-execution in a fully-installed bun/node toolchain. P2 non-blocking: deferred-gate execution required before any downstream live ACT binds to this merge) | (none — see `.factory/acts/ACT-CLINEMM-UPSTREAM-SYNC-INTEGRATION01.md` + `.factory/evidence/ACT-CLINEMM-UPSTREAM-SYNC-INTEGRATION01/`) |
| Cancel-affordance UI recon | CLOSED / RECON_ONLY / `CAPTURE_INSUFFICIENT` (`ACT-CLINEMM-TASK-CANCEL-UI-RECON01` at `162dfb137` over `15c7e3374`. Source-tree recon PASS: Cancel implementation + handler + backend abort intact (`SdkTaskControlCoordinator.cancelTask` → `sdkHost.abort(sessionId)` healthy); predicate = `turnState.phase === "streaming"` + `foregroundCommandRunning` subpredicate; Cancel button structure byte-identical upstream `48d638527` vs ClineMM HEAD; 33+ production-seam tests pinning the predicate (AOC02 §2 9/9, AOC01 4/4, SDK task-control 20/20, all PASS). LIVE cause UNBOUND because the user DID provide a live screenshot (task Working, active tool activity, Cancel absent) which the prior intermediate framing dismissed — that screenshot is consistent with `TURN_STATE_PROJECTION_DEFECT` and is not explained by source-tree analysis alone. Two narrow candidates remain: `UI_RENDER_DEFECT` (phase = streaming but Cancel absent, would contradict AOC02 §2) and `TURN_STATE_PROJECTION_DEFECT` (phase ≠ streaming while work genuinely active, producer-side candidate). Discrimination requires operator-driven four-value LIVE capture: `turnState.phase`, `foregroundCommandRunning`, `backgroundCommandRunning`, lastMessage.{type, say, ask, partial}. No production repair authorized. This supersedes the prior intermediate verdict `PASS_TASK_CANCEL_UI_RECON_NO_DEFECT_FROM_SOURCE_V1` per the reviewer's reopen. See `.factory/acts/ACT-CLINEMM-TASK-CANCEL-UI-RECON01.md` + `.factory/evidence/ACT-CLINEMM-TASK-CANCEL-UI-RECON01/source-seam-map.md`) | [`runtime-task-progression.md`](./epics/runtime-task-progression.md) |
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

See [`_index-contract.md`](./epics/_index-contract.md) for the full maintenance law.
