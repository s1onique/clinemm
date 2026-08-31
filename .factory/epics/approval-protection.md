# EPIC-APPROVAL-PROTECTION

> Approval-protection surface across **command** (V1/V2 risk classification) + **editor / non-command tool** (YOLO confirmation UI, MCP tool auto-approval) + **classic** (non-Seatbelt path-authority when Seatbelt is OFF) approval decisions. This file is the human-readable owner of:
>
> ```text
> command approval
> editor / tool approval
> classic protection
> temporary bypass decisions
> ```
>
> See `.factory/epic-board.md` for the active index and links to in-flight epics.

## Current status

- Status: ACTIVE — **command-policy recon CLOSED** + **YOLO approval-bypass DEFER (de-queued)** + **editor/tool approval-friction recon NEXT** + **classic-protection recon OPEN** + **`HOST-TEST RUNNER` OPEN** as the host-only-behaviour dependency for both classic-protection and editor/tool recon qualifications.
- Priority: P1 (substrate for the Safe-YOLO + seatbelt-confined approval surface)
- Current frontier: 2 OPEN items (`HOST-TEST RUNNER` row 18, `ACT-CLINEMM-CLASSIC-PROTECTION-RECON01` row 22) + 1 NEXT (`ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01` row 19). See "Open work" below.
- Blocked by: n/a for command-policy / YOLO-residual surface (CLOSED). Classic-protection recon was unblocked by `SEATBELT-DEFAULT-ON01` closure (now satisfied per `.factory/epics/safe-yolo-seatbelt.md`).

## Contract / durable conclusions

- **Command policy itself does NOT justify a YOLO bypass.** Per board row 17 (PASS_WITH_NONBLOCKING_RESIDUE C1: GO, `ACT-CLINEMM-SEATBELT-YOLO-APPROVAL-FRICTION-RECON01` + CORRECTION02 applied): the production-equivalent composition (real `buildPathAuthorityEvidence` + real `realpathSync(workspace)`) collapses the load-bearing-quadrant ASK count from **15 → 3**. The 3 environment-specific `.factory` realpath failures (`realpath-failed-enoent` under the IDE sandboxed authoring shell; not exercised on an unsandboxed normal host) are **environment-specific, not a general command-policy defect**. This is what de-queued `BYPASS01` (row 20): defer-not-bypass.
- **Production-equivalent-path evidence collapses the synthetic ASK set.** The recon's production-equivalent composition is the canonical test surface for any future "command policy is too noisy" claim. A fresh ACT must prove the substrate is insufficient against this composition, not just propose a workaround. Synthetic-ASK or pure-test-environment compositions are insufficient evidence.
- **Actual observed friction moved to the non-command / editor-tool surface.** Per row 19 (NEXT): the live YOLO confirmation UI for non-command tools is the natural next ACT. The recon must capture **TOOL_NAME / TOOL_INPUT_KIND / YOLO_EFFECTIVE / SEATBELT_EFFECTIVE / UI_PROMPT_TYPE / PROMPT_OCCURS_BEFORE_OR_AFTER_TOOL_EXECUTION** (the last is critical — upstream #13114 says the prompt occurs AFTER file creation, which is a UI-projection / completion-seam defect, not an approval-ordering defect).
- **Classic (non-Seatbelt) approval protection recon is the next-frontier after Safe-YOLO is fully closed.** Per row 22 (OPEN): `ACT-CLINEMM-CLASSIC-PROTECTION-RECON01`. Unblocked now that `SEATBELT-DEFAULT-ON01` has closed (see `.factory/epics/safe-yolo-seatbelt.md`). Likely shape: observe whether the Seatbelt-confined `$HOME` / network / secret boundaries are also enforced when Seatbelt is OFF, where the host's path-authority / command-policy surface takes over.
- **Editor/tool approval friction recon is gated on `HOST-TEST RUNNER`.** Per row 18 (OPEN): the Safe-YOLO substrate probes proved RED-on-kernel, GREEN-on-kernel, byte-equality across canonical / override=all via `describe.skipIf(!HAS_SUBSTRATE)(...)` (Vitest runtime skip). The editor/tool recon needs a similar real-prompt-capture capability to characterize `PROMPT_OCCURS_BEFORE_OR_AFTER_TOOL_EXECUTION` reliably on a live prompt — `HOST-TEST RUNNER` is the natural dependency. Per `.factory/epics/_index-contract.md` status vocabulary, any ACT that asserts a real-prompt / real-kernel approval property must include a `host_test_runner` artifact or explicitly mark `HOST_REQUIRED`.

## ACT ledger

| ACT / Source ID | Verdict | Board row | Canonical evidence | Purpose |
|---|---|---|---|---|
| Command-risk classification family (V1 bounded + V2 parser-assisted + V2-READONLY-AND-COMPOSITION01) — see [`command-risk-classification.md`](./command-risk-classification.md) | CLOSED (V1 GREEN, V2 framework HALT_SHIPPING, V2-READONLY STRUCTURAL) | (umbrella ACTs) | [`.factory/evidence/ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION01/`, `ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION01-CORRECTION01/`, `ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-ASSISTED01/`, `ACT-CLINEMM-COMMAND-RISK-V2-READONLY-AND-COMPOSITION01/`](../evidence/) | Command-risk classification framework (the substrate for the command approval surface) |
| `ACT-CLINEMM-SEATBELT-YOLO-APPROVAL-FRICTION-RECON01` (+ CORRECTION01, + CORRECTION02) | CLOSED (PASS_WITH_NONBLOCKING_RESIDUE C1: GO) | row 17, ~L6346 | [`docs/closure-plans/ACT-CLINEMM-SEATBELT-YOLO-APPROVAL-FRICTION-RECON01.json`](../../docs/closure-plans/ACT-CLINEMM-SEATBELT-YOLO-APPROVAL-FRICTION-RECON01.json), [`.factory/evidence/act-seatbelt-yolo-approval-friction-recon01/`](../evidence/act-seatbelt-yolo-approval-friction-recon01/) | YOLO approval friction recon — collapsed load-bearing-quadrant ASKs 15 → 3 via production-equivalent composition |
| `BYPASS01` (de-queued) | DEFER | row 20 | (de-queued per row 17 CORRECTION02) | Temporary YOLO bypass; no longer indicated (residual is environment-specific) |
| `ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01` | **NEXT / HIGH** (recon §2 complete; live specimen §3 deferred behind IMPLEMENTATION01 dogfood) | row 19 | [`.factory/evidence/ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01/source-seam-map.md`](../evidence/ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01/source-seam-map.md) (Phase 1/2 frozen at HEAD `f8dca1fda` / TREE `6f2e01b56`; verdict `PASS_RECON_SEAM_MAPPED`); the two 2026-08-27 capture attempts are preserved under `.factory/evidence/ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01/captures/{20260827T211256Z-9171c6f6,20260827T211338Z-435b5360}/` and their relationship is recorded in `specimen-20260827-command-approval01.json` with classification `CAPTURE_INSUFFICIENT` (different capture IDs; no runtime identity bound) | Editor / non-command tool approval friction recon — §2 source-seam map captured (T0..T9 traced; `buildToolPolicies` forces `autoApprove:false` for edit tools → `shouldAutoApproveTool` is the only ALLOW gate → `isToolAutoApproved` reads `effective.actions.editFiles`); live-prompt capture (§3), discriminator (§4), RED (§6), ablation (§7), and bounded repair (§8) deferred behind predecessor `ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01` dogfood |
| `ACT-CLINEMM-APPROVAL-SPECIMEN-CAPTURE-TOOL01-CORRECTION01` | **OPEN / IN_REVIEW** (correction ACT — hardens `tools/factory/capture-approval-specimen.py`; bounded: P0.1/P0.2/P0.3/P1 defects closed; smoke run §3 fires all four invariants; awaiting `PASS_CAPTURE_TOOL_HARDENED` reviewer verdict) | (board row 19-adjacent; tracked under this epic's ACT ledger; no new lane row) | [.factory/evidence/ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01/captures/specimen-20260827-command-approval01.json](../evidence/ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01/captures/specimen-20260827-command-approval01.json) (binding record; sha256 = 95f9e81e…); the two pre-correction captures are preserved verbatim | Evidence-acquisition toolchain correction — `snapshot --phase {pending,resolved}` split into `begin`/`finish`/`report` subcommands with hard lifecycle (P0.1); event fingerprints frozen at `begin`, delta computed at `finish` (P0.2); `artifactStatus` separated from `specimenBinding` so `SESSION_CANDIDATES=0` is no longer indistinguishable from a successful capture (P0.3); shape-based session scan replaces the filename allowlist (P1). Does NOT supersede `ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01`; does NOT modify any production code; preserves the two pre-correction captures verbatim. Once GREEN, the editor-tool recon ACT's next specimen attempt is expected to be a single durable causal specimen. |
| `HOST-TEST RUNNER` | **OPEN / HIGH** (host-only-behaviour dependency for the editor/tool recon and for classic-protection host qualification) | row 18 | (none yet — to be authored; see `.factory/epics/safe-yolo-seatbelt.md`) | Host-orchestrated end-to-end approval dogfood; the natural next layer above the substrate probes |
| `ACT-CLINEMM-CLASSIC-PROTECTION-RECON01` | **OPEN / HIGH** (next-frontier after Safe-YOLO is fully closed) | row 22 | (none yet — to be authored) | Classic (non-Seatbelt) approval protection recon — observe whether Seatbelt-confined boundaries are also enforced when Seatbelt is OFF |
| (deferred) progressive approval classification | **OPEN / P1→P2** | — | (none — this row is the durable backlog entry; per-family classification ACTs are to be authored) | Progressively classify every residual approval family so any broad escape hatch (`BYPASS01`-style) becomes unnecessary. Per the SEATBELT-YOLO-APPROVAL-FRICTION-RECON01 CORRECTION02 verdict, the residual is environment-specific, not a general command-policy defect — but the *family-by-family* classification work continues so a future reader does not have to re-litigate why each family is on the path-authority / command-policy surface. |

## Open work

Two OPEN items + one NEXT:

- **`HOST-TEST RUNNER`** (row 18, OPEN / HIGH). Status: host-only-behaviour dependency for the editor/tool recon (`ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01` Phase 0 / 1 / 2) and for classic-protection host qualification. Author as a new ACT (the row 18 working label `HOST-TEST RUNNER` is the working name; the ACT ID is assigned at ACT creation per FACT-001 naming doctrine in `.factory/epics/factory-infrastructure.md`); do NOT roll the runner into an existing closed ACT (would invalidate closure evidence). See `.factory/epics/safe-yolo-seatbelt.md` for the full open-work description.
- **`ACT-CLINEMM-CLASSIC-PROTECTION-RECON01`** (row 22, OPEN / HIGH). Status: classic (non-Seatbelt) approval protection recon — the next-frontier after Safe-YOLO is fully closed. Unblocked by `SEATBELT-DEFAULT-ON01` closure (now satisfied). Likely first deliverable: characterize the path-authority / command-policy / network-read surfaces that take over when Seatbelt is OFF, and compare them to the Seatbelt-confined boundaries to identify any drift. See `.factory/epics/safe-yolo-seatbelt.md` for the related NEXT pointer.
- **`ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01`** (row 19, NEXT / HIGH). Status: replaces the de-queued `BYPASS01` slot. Phase 0 captures one live YOLO confirmation UI and freezes `TOOL_NAME / TOOL_INPUT_KIND / YOLO_EFFECTIVE / SEATBELT_EFFECTIVE / UI_PROMPT_TYPE / PROMPT_OCCURS_BEFORE_OR_AFTER_TOOL_EXECUTION`. Phase 1 traces the `SdkController` non-command tool approval callback at `SdkController.ts:799..818` (`shouldAutoApproveTool` reads `autoApprovalSettings.actions.editFiles` / `.editFilesExternally` / MCP per-tool flags + session override) and freezes `TOOL_POLICY_SOURCE / SESSION_OVERRIDE_SOURCE / AUTO_APPROVAL_SETTINGS_SOURCE / REQUEST_TOOL_APPROVAL_CALLBACK / FINAL_UI_PROMPT_SEAM`. Phase 2: exact RED with YOLO+Seatbelt on the live-prompt tool; possible outcomes — `callback=ASK` → policy defect, `callback=ALLOW` + UI still prompts → completion/UI seam defect (most likely per upstream #13114), callback never reached → seam moved. Per upstream SDK docs: tool auto-approval is a **separate** surface from command policy. **SCOPE_BOUNDARY**: this ACT is the non-command / editor-tool YOLO confirmation UI surface (frozen §0 invariant: `VS Code interactive Act mode + YOLO_REQUESTED + Seatbelt selected+available + relevant editing permission enabled ⇒ an ordinary native editing tool MUST NOT require an additional user approval before execution`). It is **NOT a generic approval-friction catchall**: command-policy friction is owned by `safe-yolo-seatbelt.md` (R5 + workspace-realpath family), and live command-policy ASK is owned by `ACT-CLINEMM-SEATBELT-ALL-WORKSPACE-REALPATH-AUTHORITY-CORRECTION02`. Sibling — not superseded-by — the command-policy lanes.
- **`ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-CONTRACT01`** (row 23, CLOSED / PHASE_0_PASS / HIGH). Status: proposed **product-policy change** (not a defect repair) that would make task-level `ALL` literal within a verified Seatbelt capability envelope while retaining R5 ASK whenever that envelope is absent. Phase 0 architectural preflight complete at HEAD `4d1f1ac2d` — see `.factory/evidence/ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-CONTRACT01/01-architectural-preflight.md`. **PHASE_0_VERDICT = PASS** (reviewer disposition 2026-08-30). **LIVE_R5_CLASSIFICATION = REAL / LIVE / BOUND** (corr=G8R987V68S, artifact=4.1.16-a29a08dc8; `finalDecision=ask`, `finalSource=risk_hard_floor` at the production seam) — a synthetic re-classification under the production-equivalent composition is **not** the load-bearing gap. **DEFER_NOT_BYPASS_CONSERVATION = RESOLVED** by `ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01` (CORRECTION02 lands on top of `b53108654`; **8/8 production-seam cases pass** including Witness A producer (5 cases for `applySeatbeltAuthorityEnvelope`) and Witness B runtime bridge (2 cases driving the real `AgentRuntime` through `prepareToolExecution` → `executePreparedTool` → `tool.execute` to capture `context.mandatorySeatbeltExecution` at the executor DI seam) on top of the C1 RED matrix (6/6: T1 R5 composer, T1 WithPlan, T2 ablation, T2b deny, T3 NO-FALLBACK with mocked supervisor, T4 frozen-literal byte-equal capability). **Regression sweep**: 70/70 in apps/vscode vitest (C1 + C2 producer + sdk-tool-policies 54/54 + sandbox-policy-production-composition 5/5); 396/396 in sdk/packages/agents vitest (full suite + the new C2 runtime-bridge 2/2); 2 environmental darwin Seatbelt-substrate failures pre-date this ACT and are not regressions). **Frozen product contract**: ALL is literal ALL within the effective Seatbelt authority envelope; R5 + ALL + MANDATORY_SEATBELT_EXECUTION → no human ASK; R5 + ALL + !MANDATORY_SEATBELT_EXECUTION → ASK; explicit DENY → DENY regardless of ALL or Seatbelt; Seatbelt prepare/invocation failure → no unsandboxed fallback. **Architecture = B (refined)**: conditional authority result `host_mode_all_seatbelt_required` with `executionConstraint: "seatbelt-required"`, executor identity-bound at start time. **Architecture A = DEFER**. **Production producer (CORRECTION02)**: new pure helper `applySeatbeltAuthorityEnvelope(auth, sandboxMode)` in `apps/vscode/src/sdk/sdk-tool-policies.ts`; `SdkController.resolveHostAuthorization` is the ONLY production call site — it derives `mandatorySeatbelt` from `resolveExperimentalSandboxMode() === "seatbelt-experimental"` after the session-override "all" projection. **Runtime bridge (CORRECTION02)**: `agent-runtime.prepareToolExecution` captures `approval.mandatorySeatbeltExecution` (NEVER from `toolCall.metadata`); `executePreparedTool` stamps it into `AgentToolContext.mandatorySeatbeltExecution` at the construction site; the executor reads the value and refuses host-shell fallback. Witness B captures the context at the executor DI seam. **Files modified (production delta, CORRECTION01 + CORRECTION02 thread-through)**: `sdk/packages/core/src/runtime/command-policy/command-policy-types.ts` (new `host_mode_all_seatbelt_required` source + `mandatorySeatbelt` field on `CommandHostAuthorization`); `sdk/packages/core/src/runtime/command-policy/command-policy.ts` (mode-based switch + multi-command aggregate); `sdk/packages/core/src/runtime/command-policy/command-risk.ts` (R5 hard floor suppressed when `hostAuthorization.mandatorySeatbelt === true` AND canonical emitted `host_mode_all_seatbelt_required`); `sdk/packages/shared/src/agent.ts` (typed `mandatorySeatbeltExecution?: boolean` slot on `AgentToolContext`, closed-runtime provenance); `sdk/packages/shared/src/llms/tools.ts` (`ToolApprovalResult.mandatorySeatbeltExecution?: boolean`); `sdk/packages/agents/src/agent-runtime.ts` (capture in `prepareToolExecution` from `ToolApprovalResult`, stamp into `AgentToolContext` at `executePreparedTool`); `apps/vscode/src/sdk/sdk-tool-policies.ts` (helper `applySeatbeltAuthorityEnvelope`; both `evaluateCommandToolApproval` and `evaluateCommandToolApprovalWithPlan` return the flag; DENY / execution_plan_invalid / R5-downgraded ASK return `false`); `apps/vscode/src/sdk/sdk-interaction-coordinator.ts` (callback signature + `handleRequestToolApproval` return types extended with the flag); `apps/vscode/src/sdk/SdkController.ts` (the ONLY production producer site — `resolveHostAuthorization` calls `applySeatbeltAuthorityEnvelope` after the session override); `apps/vscode/src/sdk/command-job-manager.ts` (executor-side enforcement gate at top of `start()`: if `context.mandatorySeatbeltExecution === true` AND `resolveExperimentalSandboxMode() === undefined`, fail-closed via existing `buildSandboxUnavailableResult`). **Files added**: `apps/vscode/src/sdk/__tests__/seatbelt-all-r5-authority-implementation01.c1-green.test.ts` (6-case RED matrix, 159 lines); `apps/vscode/src/sdk/__tests__/seatbelt-all-r5-authority-implementation01.c2-runtime-bridge.test.ts` (5-case Witness A producer matrix); `sdk/packages/agents/src/seatbelt-all-r5-authority-implementation01.c2-runtime-bridge.test.ts` (2-case Witness B runtime bridge, drives the real `AgentRuntime`); `.factory/acts/ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01.md` (700+ lines, includes §9 CORRECTION01 + §11 CORRECTION02). **Capability-confinement proof**: T4 is a **byte-equality snapshot of the constructed capability object** — i.e. `CAPABILITY_OBJECT_DELTA = 0`, a *conservation* proof that construction was not widened. It is **NOT** a kernel-confinement proof. The four confinement/conservation properties (workspace-writable deletion succeeds; outside writable roots the kernel denies; network disabled ⇒ R5 bypass adds no network authority; SSH-agent disabled ⇒ R5 bypass adds no AF_UNIX/agent authority) are the **Q1–Q4 real-kernel gates**, added qualification-only (no production delta) in `apps/vscode/src/sdk/__tests__/seatbelt-all-r5-authority-implementation01.q-real-kernel-confinement.test.ts`. **Status at HEAD `<CORRECTION03>` (after CORRECTION03 harness fix)**: Q0/Q0-ABL PASS (substrate-independent); **Q1 REAL FILESYSTEM POSITIVE PASS, Q2 REAL FILESYSTEM CONFINEMENT PASS** on the real kernel; Q3/Q4 CONTROL legs produced `CAPTURE_INSUFFICIENT` — **NOT a capability leak** but a test-fixture defect (`spawnSync()` starved the in-process control servers' event loop). CORRECTION03 replaces the two CONTROL `spawnSync()` calls with `await runChildAsync(...)` (production untouched). **Q3/Q4 remain `PENDING_HARNESS_FIX_VERIFIED` until the same rerun on a non-sandboxed substrate shows `SUBSTRATE_ELIGIBLE=true` and 7/7 passing / 0 skipped.** See §13.5–§13.6 of `.factory/acts/ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01.md`. Abstraction: ALL expands approval authority, never sandbox capability authority. **P2 / non-blocking residue**: test-comment precision in the already-committed diagnostic test (CONTRACT01 disposition §P2) — batched later, not addressed in this ACT.

Reopen / new-work conditions:

- A new command-risk classifier ACT lands (V1.x or V2.x correction) — append to `command-risk-classification.md` ledger row; defer here.
- A new approval-friction recon lands (a future editor/tool ACT, or a future classic-protection ACT) — append to this file's ACT ledger row.
- A new temporary YOLO bypass proposal is raised — first check the **`defer-not-bypass`** rule: any new ACT must prove the substrate is insufficient against the production-equivalent composition (row 17 CORRECTION02), not just propose a workaround. The production-equivalent composition already collapses the load-bearing-quadrant ASKs from 15 → 3; most "approval friction" is environment-specific, not a general command-policy defect.
- A new classic (non-Seatbelt) approval protection recon ACT lands — append to this file's ACT ledger row.
- A new host-only-behaviour dependency (e.g. a new `HOST-TEST RUNNER` artifact, or a future ACT that depends on it) lands — append to this file's ACT ledger row.

## Deferred work

### DESTRUCTIVE-SCOPE-REFINEMENT-RECON

```text
Proposed ID: ACT-CLINEMM-DESTRUCTIVE-SCOPE-REFINEMENT-RECON01
Priority:    HIGH
State:       FUTURE / UNIMPLEMENTED

Mission:
Introduce a future REFINE_SCOPE decision between ALLOW/ASK/DENY for
broad or selector-based destructive mutations.

Core doctrine:
  BROAD_MUTATION != AUTHORIZED_MUTATION

  broad/selector-based action
    → deterministically estimate/expand impact where safely possible
    → force an additional model intent-refinement turn
    → require exact bounded target set + intended postcondition
    → re-evaluate normal policy from scratch
    → execute only the precise replacement request

The refinement model is NOT an independent reviewer.
The host remains authority.

Initial exemplar:
  rm *.tmp
  rm -rf generated/
  find ... -delete
  git clean -fdx

Future generalization (NOT in V1):
  mass edits, git force ops, K8s label-selector deletes,
  Terraform/cloud destroy sets, broad SQL DELETE/UPDATE,
  recursive chmod/chown, wildcard package removal,
  broad secret/config access, broad firewall/network-policy mutation.

Anti-patterns:
  NO "Are you sure?" self-review
  NO free-form "explain why this is safe" as sufficient proof
  NO rm-specific regex-only architecture
  NO automatic execution merely because the second model turn agrees

Potential escalation ladder (NOT frozen in this backlog ACT):
  L0 NORMAL
  L1 REFINE_SCOPE
  L2 JUSTIFY_SCOPE
  L3 PLAN_ONLY
  L4 HUMAN_APPROVAL

Doctrine anchors (carried into any future ACT):
  - Upstream Cline approvals allow an agent to reformulate after a
    denied tool call (see upstream SDK permission-handling.mdx and
    approval-handlers.ts); the typed REFINE_SCOPE response plugs
    into this existing behavioral substrate, not a new control loop.
  - A syntactic-only rm/find classifier is demonstrably brittle in
    other coding agents (see Codex exec_policy.rs and the reported
    rm-variant fall-through). Future doctrine MUST be semantic
    scope refinement, not more regex.

Constraints (carried into any future ACT):
  - Recon first; do not pre-classify cause.
  - Do not freeze numeric thresholds in this backlog ACT.
  - Recon ACT should observe on the production seam (live
    broad-mutation specimen) before any RED is written.

Reopen / activation triggers:
  - A live broad-mutation specimen is captured and the current
    command-policy surface admits it without a refinement turn.
  - The command-risk V3 family (progressive classification, see
    ACT ledger row) explicitly needs a typed REFINE_SCOPE family.
  - Upstream Cline ships an analogous REFINE_SCOPE primitive
    that warrants a parity recon.

Full inventory & rationale:
  .factory/evidence/ACT-CLINEMM-THREAD-FUTURE-WORK-BACKLOG-NORMALIZATION01/reconciliation.md
  (FW-01, recorded 2026-08-29 by the thread-future-work
  normalization ACT)
```

### APPROVAL-TRANSACTION-RECORDER-FUTURE-WORK

```text
State:       FUTURE / UNIMPLEMENTED — already carried by the
             existing ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01
             "Reopen / new-work conditions" block; recorded here
             so a future reviewer can find it from this epic's
             deferred section as well.
Priority:    HIGH (after current SSH live qualification)

Cross-references:
  - .factory/evidence/ACT-CLINEMM-THREAD-FUTURE-WORK-BACKLOG-NORMALIZATION01/reconciliation.md
    (FW-02, recorded 2026-08-29)
  - .factory/evidence/ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01/
    captures/specimen-20260827-command-approval01.json (current
    live state: CAPTURE_INSUFFICIENT; approval events before = 0
    and after = 0 in the 2026-08-29 capture)

Future seam (carried into the existing recon ACT, NOT a new ACT):
  - Smallest DEFAULT_OFF persistent approval transaction recorder
    at the real approval entry/terminal seam.
  - Required future fields: schema version, timestamp, session
    identity, task identity if available, canonical approval /
    correlation identity, tool name, policy auto-approve state,
    shouldAutoApproveTool result, ENTRY | TERMINAL,
    approved/rejected/cancelled outcome.
  - Constraints: no policy change; no diagnostic side effect inside
    semantic state updaters; no heuristic toolName + timestamp
    identity; no "latest pending approval" correlation;
    bounded / removable / default-off; reuse canonical approval
    identity if current runtime supplies one.
  - Existing tools/factory/capture-approval-specimen.py remains
    the consumer; do not redesign it in this backlog ACT.
```
