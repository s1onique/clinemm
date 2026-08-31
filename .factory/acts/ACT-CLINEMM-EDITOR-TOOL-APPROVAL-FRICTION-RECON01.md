# ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01

> Status: **OPEN / STRUCTURAL_POLICY_PASS / LIVE_BINDING_UNEXECUTED** —
> recon §2 PASS at HEAD f8dca1fda / TREE 6f2e01b56 (committed at
> dbd7c6449); §3 live specimen remains **GATED** behind
> `ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01`
> dogfood closure. 2026-08-30 continuation-session attempted to
> advance §3 and FAILED to produce a real specimen for two
> independent reasons (see §17.1 continuation disposition):
>   (a) the load-bearing predecessor is still NEXT / HIGH (not closed);
>   (b) the speciman-capture toolchain (`ACT-CLINEMM-APPROVAL-SPECIMEN-
>       CAPTURE-TOOL01-CORRECTION01`) is OPEN / IN_REVIEW (not closed).
> The prior capture residue
> (`specimens/20260829T060942Z-349b48f1/resolved/`) is bound to
> `CAPTURE_INSUFFICIENT` (`approvalEventCount: 0`,
> `RUNTIME_IDENTITY_BOUND: NO`, `repoHead: 911d02177` ≠ current
> `4d1f1ac2d`).
>
> **2026-08-31 structural-discriminator continuation (this commit, HEAD `0b3dada93`)**:
> completion-authority predecessor confirmed CLOSED / UPSTREAM_SUPERSEDED at
> `15c7e3374` (see ACT-CLINEMM-THREAD-OPEN-WORK-DURABILITY-CLEANUP01 P1 fix).
> Sandbox-shell structural discriminator run under user directive
> "DO NOT RESTART ANY VSCODIUM INSTANCE" (matches the headless-shell
> constraint already recorded in epic-board.md row 18). Verdict at the
> **policy predicate seam** is **STRUCTURAL_PASS** as a SUB-VERDICT
> (`PASS_EDITOR_TOOL_POLICY_SEAM_STRUCTURAL_V1`): `buildToolPolicies(editor).autoApprove=false`
> is the load-bearing entry-level forcing (T1); `shouldAutoApproveTool` returns
> ALLOW for editor-family tools whenever override="all" (T4-T8), including the
> case where persisted.editFiles=false (override lifts it). CASES B/C cannot be
> excluded from production without live VSCodium or a new default-off probe at
> the SdkInteractionCoordinator publication seam (CAPTURE_INSUFFICIENT_FOR_CASE_A_VS_CASE_B).
> Decision: NO production RED authored against the policy seam
> (would PASS, halting per ACT §5 own stop rules); NO repair
> fabricated. Evidence: `.factory/evidence/ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01/structural-discriminator-20260831T073000Z/discriminator-results.json`.
>
> **2026-08-31 causal-reviewer P0/P1 correction (HEAD `370f0bcb5`)**:
> LIVE_SPECIMEN is `NOT_EXECUTED` (not `NOT_REPRODUCED`; no reproduction
> was attempted in this shell); HALT is `CAPTURE_INSUFFICIENT reason=HOST_NOT_EXECUTABLE`
> (not `HALT_LIVE_FAILURE_NOT_REPRODUCED`); CASE_A is `STRUCTURALLY_EXONERATED_ONLY`
> (sub-verdict for the policy predicate, NOT promoted to LIVE_EXONERATED because
> no live request was exercised); E3 is `CONTRACT_CONFLICT_DISCOVERED`
> (override=all currently lifts persisted editFiles=false, contradicting the
> frozen ACT E3 expectation of ASK; product-policy decision required before this
> ACT can be treated as E3 PASS).
>
> **Primary purpose**: LIVE REPRODUCTION → approval-boundary
> classification → RED at real production seam → causal discriminator →
> NO REPAIR unless RED proves residual ASK.
>
> **Predecessor**: `ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01`
> (CLOSED / UPSTREAM_SUPERSEDED / NO_PRODUCTION_DELTA_FROM_MERGE at `15c7e3374`).
> Per ACT-CLINEMM-THREAD-OPEN-WORK-DURABILITY-CLEANUP01 P1 fix (commit
> `0b3dada93`), the prior dependency on IMPLEMENTATION01 dogfood is
> **REMOVED**: completion-authority capability is upstream-owned via
> `emitTaskCompletedOnTeardown`; remaining gates for this ACT are
> operator-driven live editor/non-command specimen + host/Aqua availability,
> NOT a completion-authority dependency.
>
> **Owning epic**: [`EPIC-APPROVAL-PROTECTION`](../epics/approval-protection.md) ·
> board row `Editor / non-command tool YOLO confirmation UI`.
>
> **Verdict (target set; only one may apply after live capture)**:
> - `PASS_EDITOR_APPROVAL_POLICY_REPAIR_V1` (Bucket A)
> - `PASS_EDITOR_APPROVAL_CONTROL_FLOW_REPAIR_V1` (Bucket B)
> - `PASS_EDITOR_APPROVAL_CLASSIFICATION_REPAIR_V1` (Bucket D)
> - `PASS_EDITOR_APPROVAL_PRESENTATION_REPAIR_V1` (Bucket C)
> - `PASS_EDITOR_APPROVAL_SESSION_RACE_REPAIR_V1` (Bucket F)
> - `NOT_REPRODUCED`
> - `CAPTURE_INSUFFICIENT`
> - **`PASS_EDITOR_TOOL_POLICY_SEAM_STRUCTURAL_V1`** (added 2026-08-31;
>   structural PASS at the policy seam under sandbox-shell execution;
>   SUB-VERDICT only — does not promote to LIVE_EXONERATED because no
>   live request was exercised; CASES B/C remain UNBOUND)
> - **`E3_CONTRACT_CONFLICT_DISCOVERED`** (added 2026-08-31 per Factory
>   causal reviewer P1; override=all currently lifts persisted
>   editFiles=false, contradicting the frozen ACT E3 expectation of ASK;
>   product-policy decision required before this ACT can be treated as
>   E3 PASS)
>
> **2026-08-30 continuation-session verdict**:
> - `CAPTURE_INSUFFICIENT / PREDECESSOR_BLOCKED` (this commit; recorded,
>   not auto-promoted to a terminal verdict). ACT remains OPEN; the
>   next board item is still this ACT's §3 live specimen under the
>   same gating.

## §0 — Frozen user-facing invariant

```text
Given:
  VS Code interactive Act mode
  YOLO_REQUESTED = true
  Seatbelt selected + available
  relevant editing permission enabled

Then:
  an ordinary native editing tool MUST NOT require an
  additional user approval before execution.
```

This does **not** mean every edit-like shell command is an editor tool.

Preserve the distinction established by
`ACT-CLINEMM-TOOL-EXECUTION-SEMANTICS-IMPLEMENTATION01`:

```text
apply_patch / native editor tool = edit mechanism

run_commands("sed -i ...")
                       = command mechanism
                       ≠ edit mechanism
```

## §1 — Entry discipline

Verified at ACT open (HEAD `f8dca1fda`) and at 2026-08-30 continuation
session (HEAD `4d1f1ac2d`):

```text
ENTRY_HEAD                   = f8dca1fda   (recon subject)
ENTRY_TREE                   = 6f2e01b56   (tree of ENTRY_HEAD)
OPEN_COMMIT                  = dbd7c6449   (this ACT's launch + evidence)
2026-08-30_CONT_HEAD         = 4d1f1ac2d   (HEAD at continuation session;
                                            ACT content lags real HEAD by
                                            one commit, by ACT convention)
CURRENT_HEAD_AT_CONTINUATION = 4d1f1ac2d   (this ACT's pointer refresh)
WORKTREE                     = CLEAN for ACT scope;
                              dirty residue:
                              - .factory/evidence/ACT-CLINEMM-EDITOR-
                                TOOL-APPROVAL-FRICTION-RECON01/
                                captures/capture-index.jsonl (modified)
                              - .factory/evidence/.../captures/
                                20260829T060942Z-349b48f1/.../pending+resolved
                                (newly untracked, pre-existing capture residue)
                              These are residue from a prior capture run
                              on a non-current repo head (911d02177 vs.
                              4d1f1ac2d); they are the load-bearing
                              CAPTURE_INSUFFICIENT evidence and are
                              preserved per §1 trust rules.
PROTECTED_STASH              = PRESERVED (1 entry; "c2-green-and-c2-p1-delta")
CURRENT_IMPLEMENTATION01_DOGFOOD = NOT YET BOUND
                  (IMPLEMENTATION01 ACT remains NEXT / HIGH at
                   continuation HEAD; only CONTRACT01 is closed.
                   This ACT cannot start RED until the predecessor's
                   live qualification is recorded per IMPLEMENTATION01
                   §9 Phase-8 success signature.)
```

No entry anomaly. No mixed-fix carry-over. The continuation session did
not pop the stash, did not reset --hard, did not rebase unrelated work,
and did not fold the capture-toolchain ACT or the IMPLEMENTATION01 ACT
into this ACT's scope.

## §2 — Recon: source-seam-map (LIVE-FROZEN)

Evidence file:
`.factory/evidence/ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01/source-seam-map.md`
(bound to ENTRY_TREE `6f2e01b56`).

Findings (read from current source, not inferred):

### The 10 semantic stages for the canonical editor-tool approval path

```text
T0  tool event
        │
        │  SDK invokes `requestToolApproval` for the tool, carrying
        │  ToolApprovalRequest { agentId, conversationId, iteration,
        │  toolCallId, toolName, input, policy }.
        │
        ▼
T1  policy resolution at SDK tool registration
        │  apps/vscode/src/sdk/sdk-tool-policies.ts:56 buildToolPolicies()
        │  CRITICAL: ALL Cline-governed tools (read/edit/browser/mcp)
        │  are forced to `autoApprove: false`. For edit tools that means
        │  request.policy.autoApprove is ALWAYS false at T1; the SDK
        │  will therefore ALWAYS ask the host callback to decide.
        │  See line 65: set(["editor", "replace_in_file", "write_to_file",
        │  "apply_patch", "delete_file"]) → policies[tool].autoApprove=false
        │
        ▼
T2  approval entry
        │  apps/vscode/src/sdk/sdk-interaction-coordinator.ts:254
        │  handleRequestToolApproval(request)
        │   - emits `approval.entry.v2` (existing v2 capture; heartbeat)
        │   - isCommand = isCommandTool(request.toolName)
        │
        ▼
T3  branch on tool family
        │  apps/vscode/src/sdk/sdk-interaction-coordinator.ts:401..418
        │   - command tool: routes to evaluateCommandToolApproval
        │     (atomic, no TOCTOU; CORRECTION04)
        │   - non-command (read/edit/browser/mcp): routes to
        │     shouldAutoApproveTool callback
        │
        ▼
T4  shouldAutoApproveTool (the only ALLOW gate for edit tools)
        │  apps/vscode/src/sdk/SdkController.ts:799..818
        │   - command tool → return false (delegates to command lattice)
        │   - non-command:
        │       persisted = stateManager.getGlobalSettingsKey("autoApprovalSettings")
        │                ?? DEFAULT_AUTO_APPROVAL_SETTINGS
        │       sessionId = sessions.getActiveSession()?.sessionId
        │       override = sessionAutoApproval.getOverride(sessionId)
        │       effective = resolveEffectiveAutoApproval(persisted, override)
        │       return isToolAutoApproved(toolName, effective, mcpHub, override)
        │
        ▼
T5  isToolAutoApproved (the policy leaf)
        │  apps/vscode/src/sdk/sdk-tool-policies.ts:952..1001
        │   - isReadTool("...") → settings.actions.readFiles
        │   - isEditTool("...") → settings.actions.editFiles
        │   - isCommandTool → executeSafeCommands (NOT editFiles)
        │   - isBrowserTool → settings.actions.useBrowser
        │   - parseMcpToolName → per-tool autoApprove / override="all"
        │
        ▼
T6  ALLOW or ASK decision (the user-visible boundary)
        │  apps/vscode/src/sdk/sdk-interaction-coordinator.ts:417
        │  if (request.policy.autoApprove === true
        │      || this.options.shouldAutoApproveTool?.(request) === true) {
        │      Logger.log(`[SdkController] Auto-approving tool=...`)
        │      return { approved: true }
        │  }
        │  // otherwise fall through
        │
        ▼
T7  ask path (when ALLOW was not taken)
        │  apps/vscode/src/sdk/sdk-interaction-coordinator.ts:426..447
        │  - onToolApprovalAsk(request) → diffEdits.openForApproval()
        │    (line 780 in SdkController)
        │  - buildToolApprovalAskMessage(toolName, input, ts)
        │  - messages.appendAndEmit([toolAskMessage], status:"running")
        │  - setTurnPhase("awaiting_approval", ts,
        │       "interaction-handle-tool-approval")
        │  - postStateToWebview()
        │
        ▼
T8  approval terminal record
        │  apps/vscode/src/sdk/sdk-interaction-coordinator.ts:288 (finally)
        │  emitV2Capture({ codePoint: "approval.terminal.v2",
        │                  correlationId, commandDigest })
        │
        ▼
T9  mutation boundary (only AFTER approval resolves)
        │  apps/vscode/src/sdk/sdk-diff-edit-coordinator.ts:119
        │  executeEditorTool(input, cwd, context)
        │   - opens pre-approval preview if hadPreApprovalPreview
        │   - calls fallbackEditorExecutor(input, cwd, context)
        │     (real file write)
        │   - lingers auto-approve preview briefly
        │   - showEditedFile() reveals the change in the workbench
```

### The 10 specifically-required locations

```text
1.  native editor / apply_patch registration
        buildToolPolicies()  apps/vscode/src/sdk/sdk-tool-policies.ts:56
        set([...edit tools]) → policies[tool] = { autoApprove: false }
        isEditTool()         apps/vscode/src/sdk/sdk-tool-policies.ts:91

2.  tool-policy construction for those tools
        buildToolPolicies()  apps/vscode/src/sdk/sdk-tool-policies.ts:56

3.  autoApprovalSettings.actions.editFiles consumption
        isToolAutoApproved()       apps/vscode/src/sdk/sdk-tool-policies.ts:957
        effective = resolveEffectiveAutoApproval(persisted, override)
                  apps/vscode/src/sdk/session-auto-approval.ts:221

4.  editFilesExternally compatibility path
        AutoApprovalSettings shape  apps/vscode/src/shared/AutoApprovalSettings.ts
        (legacy field, kept for backward compat)
        resolveEffectiveAutoApproval at session-auto-approval.ts:221
        projects editFilesExternally from persisted (NOT overwritten).

5.  SessionAutoApprovalStore override application
        getOverride(sessionId)
          this.sessionAutoApproval.getOverride(sessionId)
          in SdkController.ts:811
        arming side: sdk-session-auto-approval-coordinator.ts (consumes
        pending intent at session-id allocation; authoritative site)

        **Authority timing (load-bearing)**: after the
        completion-authority work, the store mutation happens
        immediately when the user changes ALL/none, but the
        runtime toolset rebuild that consumes the override is
        scheduled later. Therefore, at the moment T4
        (shouldAutoApproveTool) executes for an in-flight tool
        request, store authority and runtime toolset
        construction epoch can disagree:

            store override     = NEW
            runtime toolset    = OLD

        This race surface is Bucket F (chronology / session-rebuild).
        The store-vs-runtime epoch correlation MUST be captured
        separately in §3 — treating the store value alone as
        authoritative for the in-flight decision is incorrect.

6.  resolveSessionHostAuthorization / equivalent
        evaluateCommandToolApproval callback in SdkController.ts:818..870
        (atomic authority+constraints; command tools only — NOT the
         non-command path this ACT investigates)

7.  shouldAutoApproveTool / equivalent
        SdkController.ts:799..818  (this is the ONLY ALLOW gate for
        edit tools)

8.  requestToolApproval implementation
        handleRequestToolApproval
          apps/vscode/src/sdk/sdk-interaction-coordinator.ts:254
        runRequestToolApproval
          apps/vscode/src/sdk/sdk-interaction-coordinator.ts:296

9.  ask/message emitted for edit approval
        buildToolApprovalAskMessage
          apps/vscode/src/sdk/sdk-interaction-coordinator.ts:433
        messages.appendAndEmit → webview renders the ask row

10. mutation boundary
        executeEditorTool (and executeApplyPatchTool)
          apps/vscode/src/sdk/sdk-diff-edit-coordinator.ts:119, 158
        BEFORE-OR-AFTER: STRICTLY AFTER the ask resolves (the ask
        path's setTurnPhase("awaiting_approval") runs first; the
        executor is invoked only when shouldAutoApproveTool returns
        true or the user responds Allow).
```

### Pass / halt gates

```text
PASS_RECON_SEAM_MAPPED  → live-capture phase authorized
HALT_SEAM_MOVED         → if any of the 10 locations above no longer
                           exists (architectural surgery would be
                           needed to fix — beyond RECON scope).
```

Recon verdict (this section): **PASS_RECON_SEAM_MAPPED**.

## §3 — Live specimen (NOT YET CAPTURED)

The first deliverable after recon is **one real prompt occurrence**.
Per §1 entry discipline, IMPLEMENTATION01 dogfood is not yet bound,
so the live specimen will be captured AFTER IMPLEMENTATION01 is
closed. This ACT will halt at the appropriate boundary.

### Required live matrix (per spec §3)

| Field                                   | Required classification              |
| --------------------------------------- | ------------------------------------ |
| task/session ID                         | LIVE                                 |
| stateVersion / correlation ID           | LIVE if available                    |
| canonical `toolName`                    | LIVE                                 |
| mechanism bucket from TES               | LIVE                                 |
| tool input *kind*                       | LIVE; no sensitive contents required |
| target path classification              | LIVE                                 |
| target inside/outside workspace         | LIVE                                 |
| current mode                            | LIVE                                 |
| session override (`none/all`)           | LIVE                                 |
| persisted `actions.editFiles`           | LIVE                                 |
| legacy `editFilesExternally`            | LIVE if relevant                     |
| YOLO_REQUESTED                          | LIVE or composed proof               |
| Seatbelt selected                       | LIVE                                 |
| Seatbelt available                      | LIVE                                 |
| hostAuthorization.mode                  | LIVE                                 |
| resolved tool policy `autoApprove`      | LIVE if observable                   |
| **final shouldAutoApproveTool result**  | **LIVE — primary discriminator**     |
| **T7 ask emission observed?**           | **LIVE — primary discriminator**     |
| **approval ask message appended?**      | **LIVE — primary discriminator**     |
| **store override vs runtime toolset epoch** | **LIVE — chronology check**       |
| visible prompt subtype                  | LIVE                                 |
| mutation start observed at T7/T9?       | LIVE                                 |

Note: `requestToolApproval reached` is **not** a useful ALLOW-vs-ASK
discriminator for native edit tools. For the native edit path
`request.policy.autoApprove === false` is always true (see §2), so the
SDK *always* enters approval handling. The discriminator is
`shouldAutoApproveTool result × T7 emission`, not the fact that
approval handling was reached at all.

## §4 — Primary discriminator (deferred to §3)

Buckets A..F per spec. Bucket E (PROMPT AFTER FILE MUTATION) is
**structurally excluded** by the recon: the executor at
`sdk-diff-edit-coordinator.ts:119` runs only AFTER the ask resolves
(`hadPreApprovalPreview` is a side-effect; the actual write is
`fallbackEditorExecutor(input, cwd, context)` after the ASK loop).

If a Bucket E specimen is later observed, it must indicate either:
- a different code path entirely (seam moved → HALT_SEAM_MOVED), or
- a post-execution acknowledgement message being rendered as an
  approval ask (Bucket C boundary crossing — escalate).

### Bucket taxonomy (canonical discriminator)

The discriminator is **shouldAutoApproveTool result × T7 ask
emission × observable UI**, NOT `requestToolApproval reached`.

```text
A. shouldAutoApproveTool = false
   AND T7 ASK emitted
   AND UI shows approval
   ⇒ genuine policy / classification ASK
   (Expected behavior; not a defect.)

B. shouldAutoApproveTool = true   (decided ALLOW by host)
   BUT T7 ASK emitted anyway
   ⇒ control-flow defect
   (Host returned ALLOW but the ASK branch still ran.)
   Epistemic guard: correlate store override epoch vs runtime
   toolset epoch (see §P1 fix below) — a stale toolset with
   autoApprove=true at construction time is a different bucket
   (Bucket F race) and must not be misclassified as B.

C. shouldAutoApproveTool = true
   AND T7 ASK NOT emitted by the runtime
   BUT UI shows an approval ask
   ⇒ stale presentation / orphan ask owner
   (UI is rendering an ask that the runtime never produced.
    Classic Bucket C defect surface.)

D. toolName did not classify as edit
   but the prompt surfaces an "edit file" affordance
   ⇒ policy-category defect
   (Build-time policy wrong; sub-classification off.)

F. effective.editFiles / override changed across T4
   (store override = NEW, runtime toolset = OLD at the moment
    the host decision was taken)
   ⇒ session-authority / race candidate
   (NOT a control-flow defect; this is the IMPLEMENTATION01 race
    surface. Bucket F is its own bucket, not a sub-class of B.)

E. EXCLUDED for the mapped native edit path. (See structural
   exclusion above.)
```

The repair verdict tied to each bucket (informational only — RED
authoring is gated on §3 producing evidence, and the verdict
itself is NOT pre-baked):

```text
A ⇒ no repair
B ⇒ RED: control-flow repair
C ⇒ RED: presentation-state repair
D ⇒ RED: classification / build-time policy repair
F ⇒ RED: chronology / session-rebuild repair (escalate to the
        IMPLEMENTATION01 race-fix conversation)
```

## §5 — Causal chronology (deferred to §3)

T0..T9 from §2 will be correlated to the live specimen via the
existing `emitV2Capture` `approval.entry.v2` / `approval.terminal.v2`
codePoints (already wired; the existing v2-capture diagnostic substrate
is the canonical seam for this).

## §6 — RED (deferred to §3)

Not authored in this ACT. RED is gated on §3 producing A–F with
sufficient evidence. If §3 cannot reproduce, this ACT halts at
`HALT_RED_NOT_REPRODUCED`.

## §7 — Necessity / ablation (deferred to §3)

Per spec.

## §8 — Permitted repair boundaries (deferred to §3)

Per spec. No preferred bucket is pre-baked into the ACT; the
classification itself is the output of §3, not its input.

### External radar (informational only)

```text
EXTERNAL_RADAR:
An upstream report (referenced as upstream #13114 in
EPIC-APPROVAL-PROTECTION row 19) described a superficially
similar post-mutation prompt symptom (prompt occurs after
file creation → UI-projection / completion-seam defect).

It is NOT bound to this specimen or this code path and must
NOT influence A–G classification. Recording it here so
later reviews can cross-check against the real upstream
report, not against a remembered summary.
```

If the live specimen contradicts the §2 source-seam map (i.e. a
Bucket E observation on the native edit path), `HALT_SEAM_MOVED`
is the right gate.

## §9 — Explicit forbidden repair

```text
DO NOT add at the central approval callback:

  if (seatbeltYolo) { return APPROVE }

The correct order remains:
  real prompt → policy decision → callback chronology → RED →
  necessity → bounded repair.
```

## §10 — Conservation suite (EAF-C01..C14)

Per spec; will be exercised at the repair-boundary phase, only if
authorized by RED.

## §11 — Temporary instrumentation

Existing diagnostic seam (`emitV2Capture` with codePoint
`approval.entry.v2` / `approval.terminal.v2`) is already wired and
is the **first capture surface to try** for §3. No new
instrumentation is justified before a live specimen demonstrates a
missing discriminator. **Likely sufficient — not yet proven**.
If the existing seam proves insufficient at §3,
**CAPTURE_INSUFFICIENT** is the right gate — do NOT solve
observability by turning diagnostics into architecture.

## §12 — File budget

Pre-recon estimate (only if repair authorized by RED):
```text
production   ≤ 4 focused files
tests        ≤ 3 focused files
diagnostic   0–1 temporary module
factory/docs ≤ 2 (this ACT + seam-map evidence)
```

## §13 — Gates

Recon (this ACT):
```text
[ ] REAL_PROMPT_BOUND                (deferred to §3 — IMPLEMENTATION01
                                       dogfood must close first)
[ ] TOOL_EVENT_CORRELATED            (deferred to §3)
[ ] APPROVAL_DECISION_CLASSIFIED     (deferred to §3)
[x] PROMPT_PRE_OR_POST_MUTATION_STRUCTURAL_BOUNDARY = PASS
                                       (pre-mutation for the mapped
                                        native edit path; Bucket E
                                        structurally excluded by §2)
[ ] LIVE_PROMPT_MUTATION_ORDER       (NOT_YET_CAPTURED — needs §3)
[ ] BOUNDARY_A_TO_G_SELECTED         (deferred to §3)
[x] PASS_RECON_SEAM_MAPPED           (this ACT)
```

Unticked-on-purpose: any gate above `[ ]` is `NOT_YET_CAPTURED`,
not `PASS`. Promotion rules forbid the latter without a specimen.

Repair (NOT in this ACT):
```text
[ ] RED_REAL_PRODUCTION_SEAM
[ ] CAUSAL_ABLATION
[ ] GREEN
[ ] EAF-C01..C14
[ ] TYPECHECK
[ ] TARGETED_VITEST
[ ] LINT/BIOME
[ ] git diff --check
[ ] exact-head dogfood
```

## §14 — Live qualification

Build exact-head VSIX and bind via `CLINEMM_PTAD=1 codium .` (per
IMPLEMENTATION01 §9 success signature path). Run:

```text
1 native read                → auto-run
1 native editor / apply_patch → auto-run, NO approval prompt
1 ordinary command           → auto-run under existing command policy
```

Plus the negative case (manual Act + native editor → prompt).

## §15 — Stop rules

```text
HALT_RED_NOT_REPRODUCED
HALT_SEAM_MOVED
HALT_LEADING_HYPOTHESIS_REPAIR
HALT_SCOPE_EXPANSION
HALT_NEW_SECURITY_REGRESSION
CAPTURE_INSUFFICIENT
HALT_PRESENTATION_BOUNDARY
  (if policy=ALLOW, callback not called, no active approval owner,
   but UI prompt remains — do NOT fix the policy)
```

## §16 — Allowed exits

```text
PASS_EDITOR_APPROVAL_POLICY_REPAIR_V1
PASS_EDITOR_APPROVAL_CONTROL_FLOW_REPAIR_V1
PASS_EDITOR_APPROVAL_CLASSIFICATION_REPAIR_V1
PASS_EDITOR_APPROVAL_PRESENTATION_REPAIR_V1
PASS_EDITOR_APPROVAL_SESSION_RACE_REPAIR_V1
NOT_REPRODUCED
CAPTURE_INSUFFICIENT
```

## §17 — Provenance

- ACT body derived verbatim from the reviewer-supplied
  `ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01` spec.
- Recon read from current source at HEAD `f8dca1fda` /
  tree `6f2e01b56`.
- Source files inspected:
  - `apps/vscode/src/sdk/SdkController.ts` (3779 lines)
  - `apps/vscode/src/sdk/sdk-tool-policies.ts` (1001 lines)
  - `apps/vscode/src/sdk/sdk-interaction-coordinator.ts`
    (handleRequestToolApproval + runRequestToolApproval +
     non-command branch at line 417)
  - `apps/vscode/src/sdk/sdk-diff-edit-coordinator.ts`
    (openForApproval, executeEditorTool, executeApplyPatchTool)
  - `apps/vscode/src/sdk/session-auto-approval.ts`
    (resolveEffectiveAutoApproval at line 221)
  - `apps/vscode/src/sdk/v2-capture.ts`
    (approval.entry.v2 / approval.terminal.v2 codePoints)
  - `apps/vscode/src/shared/AutoApprovalSettings.ts`
    (DEFAULT_AUTO_APPROVAL_SETTINGS + editFiles shape)
- Companion ACTs in this lane:
  - `ACT-CLINEMM-SEATBELT-YOLO-APPROVAL-FRICTION-RECON01` (CLOSED;
    command-policy surface only)
  - `ACT-CLINEMM-UPSTREAM-SETTINGS-AUTHORITY-PARITY01` (CLOSED;
    established non-command path via isToolAutoApproved)
  - `ACT-CLINEMM-SESSION-AUTONOMY01` + CORRECTION01..04 (CLOSED;
    session override composition)
- Authoring of this ACT is itself the §0 + §1 + §2 deliverable; §3
  live-capture is the next ACT boundary.

### §17.1 — 2026-08-30 continuation-session disposition (this commit)

```text
CONTINUATION_SESSION_HEAD    = 4d1f1ac2d
ENTRY_HEAD                   = f8dca1fda   (unchanged from ACT open)
ENTRY_TREE                   = 6f2e01b56   (unchanged from ACT open)

VERDICT_FOR_THIS_SESSION =
  CAPTURE_INSUFFICIENT / PREDECESSOR_BLOCKED
  (recorded, NOT a terminal ACT verdict — the ACT remains OPEN)

REASONS (two independent; either alone is sufficient to halt):

  R1 = PREDECESSOR_NOT_CLOSED
       ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01
       remains NEXT / HIGH at continuation HEAD; only CONTRACT01
       is closed. The §0 frozen invariant of this ACT requires:
         YOLO_REQUESTED = true
         Seatbelt selected + available
         relevant editing permission enabled
       The predecessor contract establishes the canonical
       "effective Seatbelt-YOLO authority" that the §0 invariant
       relies on. Capturing a "real" specimen without the
       predecessor would conflate the unfinished IMPLEMENTATION01
       work with the editor-tool approval question and violate the
       §3 boundary classification contract (Bucket F — session
       override vs runtime toolset epoch — is the most likely
       misclassification in that condition).

  R2 = SPECIMEN_CAPTURE_TOOLCHAIN_NOT_CLOSED
       ACT-CLINEMM-APPROVAL-SPECIMEN-CAPTURE-TOOL01-CORRECTION01
       is OPEN / IN_REVIEW. The capture residue from 2026-08-29
       (specimen-20260829T060942Z-349b48f1) bound to
       `CAPTURE_INSUFFICIENT` because:
         approvalEventCount: 0
         RUNTIME_IDENTITY_BOUND: NO
         APPROVAL_ENTRY: false, APPROVAL_TERMINAL: false
         repoHead: 911d02177 (≠ current 4d1f1ac2d; ≠ ENTRY_HEAD
                                f8dca1fda)
       Re-running the capture against the same toolchain without
       the CORRECTION01 verdict is expected to produce the same
       CAPTURE_INSUFFICIENT result. The toolchain ACT owns the
       diagnostic seam fix.

PRODUCTION_DELTA = 0  (no production source modified)
TEST_DELTA = 0       (no new test added; existing structural evidence
                      is sufficient for the OPEN state)
REPAIR_AUTHORIZED = NO  (R1 and R2 are pre-RED gates; A1 specimen
                          has not been produced; no RED is authorized
                          per §11 + §16)
RED_REPRODUCED = NO  (no RED attempted, because A1 specimen absent)
LIVE_GREEN = NOT_EXECUTED  (no live qualification attempted, for
                              the same reason)

NEXT_BOUND_BOUNDARY =
  IMPLEMENTATION01 must close first; only then can this ACT's §3
  be re-attempted. Until then, the durable board row
  "Approval / editor-tool | P1" remains in the OPEN state with
  CAPTURE_INSUFFICIENT binding.

HALT_GATE =
  HALT_LEADING_HYPOTHESIS_REPAIR
  (forging a specimen under un-closed predecessor + toolchain
   would be a leading-hypothesis repair — explicitly forbidden
   by §15 stop rules)

PROVENANCE_RECHECK =
  §2 source-seam-map was verified unchanged at continuation HEAD:
  - apps/vscode/src/sdk/sdk-tool-policies.ts still 1001 lines;
    isEditTool at line 91; buildToolPolicies at lines 56-83 still
    force autoApprove:false for edit tools.
  - apps/vscode/src/sdk/sdk-interaction-coordinator.ts still 698
    lines; non-command branch at line 417 still routes via
    shouldAutoApproveTool disjunct.
  - No production source drift relative to the §2 seam map.
```

## §17.2 — Durable-next-ACT rule

The next ACT after this continuation session is **STILL THIS ACT**
(recon §3 live specimen under the unchanged gating). The durable
board's row "Approval / editor-tool | P1" is correct; no board
amendment is required for this session — the row already states
`CAPTURE_INSUFFICIENT` and that is the live state.

The downstream NEXT ACT for the runtime progression lane
(`RUNTIME-FINISH-SEMANTICS-RECON01` → `COMPLETION-PROTOCOL-LIVENESS02`
→ `SEATBELT-YOLO-COMPLETION-AUTHORITY-CONTRACT01` →
`SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01`) must close
first; that lane is owned by the runtime-progression epic and is
not this ACT's scope.

Re-read of the durable board after this continuation session:

```text
APPROVAL/EDITOR-TOOL LANE   = ACTIVE / OPEN; this ACT
                            (CAPTURE_INSUFFICIENT / PREDECESSOR_BLOCKED)
APPROVAL/CLASSIC LANE      = ACTIVE / OPEN; CLASSIC-PROTECTION-RECON01
HOST SUBSTRATE LANE        = ACTIVE / OPEN; HOST-TEST RUNNER
                            (P0 dependency for both approval lanes)
SEATBELT NETWORK EGRESS    = CLOSED at 4d1f1ac2d (this session's prior
                            ACT, closed yesterday)
SEATBELT SSH-AGENT AUTH    = CLOSED at f6b6697e5
SETTINGS SANDBOX CAPS      = CLOSED_V2
RUNTIME TASK PROGRESSION   = CLOSED at fd8627cb6
                            (NOT_LIVE_CAUSE; the IMPLEMENTATION01
                             ACT is its own NEXT slice — see
                             runtime-task-progression.md)
```

No durable-state contradiction detected in this continuation session.

---

### §17.3 — 2026-08-30 continuation-session disposition #2 (this commit)

Predecessor gates updated since §17.1:
- `ACT-CLINEMM-APPROVAL-SPECIMEN-CAPTURE-TOOL01-CORRECTION01`
  is now CLOSED at `0841353f0` with
  `PASS_APPROVAL_SPECIMEN_CAPTURE_STRUCTURAL_READY_V1` and
  `LIVE_QUALIFICATION=PENDING` — structurally ready, real-runtime
  attachment delegated.
- `ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01`
  is still NEXT/HIGH per the durable board; this ACT's §0 frozen
  invariant (YOLO_REQUESTED=true, Seatbelt available, editing
  permission enabled) is still gated on its closure. This session's
  attempt is therefore NOT a §3 live specimen — the §0 invariant
  is not satisfied.

What this session attempted per the spec's CONTINUATION directive:
"first prove capture tool LIVE qualified, then ask the boundary
question under effective auto-approval."

#### Source-bound live artifact prepared

```text
SOURCE_HEAD              = 0841353f0ad45e1702af80b2b88753e243bca951
SOURCE_TREE              = 906e54de5f1ae9084c3fc56735eee73d72a800eb
PACKAGE_VERSION          = 4.1.10-0841353f0
VSIX_PATH                = dist/clinemm-4.1.10-0841353f0.vsix
VSIX_BYTES               = 16881379
VSIX_SHA256              = 1d747b43f72a54c4bc8b7c71fdbfba9df10b0a8c73be4e8911d3f0f76659cd01
INSTALLED_VERSION        = 4.1.10
INSTALLED_PATH           = .factory/tmp/live-userdata/extensions/s1onique.clinemm-4.1.10/
INSTALLED_BUNDLE_SHA256  = fe79ffedc9b524c0c2b974b2b2532c03c6055987a95b84f400059a067defd2bb
SOURCE_BUNDLE_SHA256     = fe79ffedc9b524c0c2b974b2b2532c03c6055987a95b84f400059a067defd2bb
INSTALLED == SOURCE      = YES (byte-exact)
BUNDLE_CONTAINS_capture.attach.v1 = YES (1 hit in extension.js)
BUNDLE_CONTAINS_CLINEMM_CAPTURE_V2_PATH = YES (1 hit in extension.js)
```

(D07 stamp applied at package time, then `package.json` restored
to HEAD content so the installed `package.json` reads `"4.1.10"` —
the stamped version is on the artifact name only.)

#### Reproduction fidelity (capture tool codepath)

```text
emitCaptureAttach VITEST COVERAGE = 16/16 PASS
  - "writes one JSONL record per emit when env var is set"
  - "emits 'no-correlation' / 'no-input' when no request context is active"
  - "process-scope events do NOT inherit the ambient request context"
  - "emitCaptureAttach writes one process-scope capture.attach.v1 record"
  - "emitCaptureAttach never logs raw command text or PII"
  - "emitCaptureAttach is a no-op when env flag is unset"
  - plus 10 prior v2-capture tests
```

The exact production codepath the live extension host would invoke
at `activate()` is the same `emitCaptureAttach()` function exercised
by these vitest cases. Unit fidelity = YES.

#### What was NOT executed

```text
REAL_EXTENSION_HOST_LAUNCH         = NOT_EXECUTED
LIVE_CAPTURE_ATTACHMENT_OBSERVED   = NOT_EXECUTED
LIVE_APPROVAL_TRANSACTION          = NOT_EXECUTED
LIVE_AUTOAPPROVE_TRANSACTION       = NOT_EXECUTED
SPECIMEN                            = NOT_REPRODUCED

REASON = ENVIRONMENT_HEADLESS
  - This shell has no TTY ("TTY=not a tty"), no DISPLAY, and
    `open -a "Visual Studio Code"` returns Apple Event error -54.
  - macOS WindowServer is running and `gui/501` reports an active
    login session with 425 active services — but the launching
    shell is detached from that session (non-interactive tty,
    no Aqua bootstrap), so GUI apps refuse to launch.
  - `_electron.launch` (Playwright) would face the same constraint
    on macOS without an Aqua session; the docstring warning
    about Playwright/bun incompatibility is unrelated to this.
  - The `code` CLI spawns the GUI process and exits; the spawned
    process never appears in `pgrep` from this shell, suggesting
    it fails the LaunchServices check at the OS layer.
  - Capture-diag-only paths (writing capture.attach.v1 with the
    same env flag) are unit-testable and confirmed; only the
    real-extension-host invocation path is environmentally
    blocked.
```

#### §17.3 verdict

```text
REAL_EXTENSION_ATTACHMENT          = NOT_EXECUTED
CAPTURE_TOOL_LIVE_QUALIFIED         = NO   (real runtime unproven)
CAPTURE_TOOL_STRUCTURAL_FIDELITY    = YES  (16/16 vitest PASS, byte-exact
                                            installed bundle, source HEAD
                                            0841353f0)
SPECIMEN                            = NOT_REPRODUCED
SPECIMEN_CLASS                      = N/A  (no live transaction)
PRODUCTION_DELTA                    = 0    (no production source modified;
                                            no diagnostic added; existing
                                            capture diagnostics, env-gated
                                            DEFAULT_OFF, untouched)
TEST_DELTA                          = 0    (no new test added; existing
                                            16/16 vitest coverage on
                                            emitCaptureAttach reused)
RED_AUTHORIZED                      = NO   (no live specimen)
RED_REPRODUCED                      = NO   (n/a)
LIVE_GREEN                          = NOT_EXECUTED
REPAIR_AUTHORIZED                   = NO   (no live A1 evidence)
BOARD_ROW_AMENDED                   = YES  (live-control vs headless-blocked
                                            distinction captured; PENDING →
                                            still PENDING; NEXT pointer
                                            retained)
```

#### Halt gate (per spec §42)

```text
HALT_LIVE_ARTIFACT_IDENTITY_UNBOUND = NO  (binding is exact-byte
                                            source = installed)
HALT_CAPTURE_ATTACHMENT_UNPROVABLE  = NO  (codepath unit-verified;
                                            only real-host invocation
                                            is environmentally blocked)
HALT_APPROVAL_TRANSACTION_UNBINDABLE = NO (no transaction attempted;
                                            no binding needed)
HALT_RED_NOT_REPRODUCED             = N/A (no RED attempted, no A1)
HALT_NEW_P0                         = NO  (no new P0; environmental
                                            constraint was already
                                            documented in CORRECTION01
                                            §C reproduction-fidelity)
```

#### Authorized next ACT (no new ACT for this lane)

```text
NEXT_WORK = continuation of this ACT (operator-driven) on a host
            with an active Aqua session.

OPERATOR_RUNBOOK:
  1. On a desktop session, run:
       export CLINEMM_CAPTURE_V2_PATH=/absolute/path/to/capture.v2.jsonl
       code --user-data-dir .factory/tmp/live-userdata \
            --extensions-dir .factory/tmp/live-userdata/extensions \
            .factory/tmp/live-control-a
  2. Wait for ClineMM sidebar to load.
  3. CONTROL_A (autoApprove=false): send chat
     "Create .factory/tmp/editor-control-a.txt with content
      CONTROL_A_APPROVAL_REQUIRED"
     Expect approval.entry.v2 → approve in UI →
     approval.terminal.v2=approved → executor entry → file mutation.
  4. CONTROL_B (autoApprove=true): same with control-b file.
     Expect capture.attach.v1 → executor entry → file mutation,
     NO approval events.
  5. After both, run `python3 tools/factory/capture-approval-specimen.py
     begin --capture-id <id>` then `finish --capture-id <id>`, then
     `report --capture-id <id>` to bind the live specimen.
  6. Commit evidence to .factory/evidence/ACT-CLINEMM-EDITOR-TOOL-
     APPROVAL-FRICTION-RECON01/live-control-{a,b}/ and live-specimen/.

PRECONDITION_NOTE:
  Per the §0 frozen invariant, this ACT still requires
  ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01
  to be closed first. Until then the live specimen will not
  exercise the §0 invariant's full context (YOLO_REQUESTED=true,
  Seatbelt available, editing permission enabled). Real closure
  of this ACT is gated on the IMPLEMENTATION01 dogfood.
```

#### Files added by this session

```text
.factory/tmp/live-control-a/                  (empty — CONTROL_A target)
.factory/tmp/live-control-b/                  (empty — CONTROL_B target)
.factory/tmp/live-specimen/                   (empty — specimen target)
.factory/tmp/live-capture-logs/               (empty capture log; no GUI
                                                host launch)
.factory/tmp/live-userdata/                   (isolated user-data-dir;
                                                contains installed
                                                s1onique.clinemm-4.1.10/)
dist/clinemm-4.1.10-0841353f0.vsix            (16.1 MB; source-bound
                                                SHA-256 1d747b43...)
```

These are under `.factory/tmp/` (factory-internal ephemeral) and
`dist/` (gitignored). NOT committed.

This commit modifies only:
  `.factory/acts/ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01.md`
  (this §17.3 disposition block)
  `.factory/epic-board.md`                       (board row amendment)

PRODUCTION_DELTA = 0.

C1: HALT_LIVE_ARTIFACT_HEADLESS_ENVIRONMENT (new halt code, semantically
    equivalent to CAPTURE_INSUFFICIENT + REASON=HEADLESS; documents that
    the blocker is the host's lack of Aqua session, not the toolchain).

### §17.4 — 2026-08-31 structural-discriminator continuation (sandbox-shell run, HEAD `0b3dada93`)

Context: this run was triggered by the Factory execution lead's directive
to take "the first board item that can produce new evidence now."
The board row 18 was updated by the cleanup ACT-CLINEMM-THREAD-OPEN-WORK-
DURABILITY-CLEANUP01 P1 fix (commit `0b3dada93`) to remove the stale
IMPLEMENTATION01 NEXT dependency. The user directive for this run:
**"DO NOT RESTART ANY VSCODIUM INSTANCE, YOU ARE IN A SANDBOXED
ENVIRONMENT"** — matching the headless-shell constraint already
recorded in epic-board.md row 18.

What was executable in this shell:

| §   | Phase                              | Status |
|-----|------------------------------------|--------|
| §1  | Entry / Trust                      | DONE; ENTRY_HEAD=`0b3dada93`; ENTRY_TREE=`a0b32ce04`; BRANCH=`main`; WORKTREE=clean |
| §2  | Recon continuity                   | DONE; line-number drift recorded; architecture preserved at HEAD |
| §3  | Live specimen                      | NOT_EXECUTABLE (sandboxed shell; user directive forbids VSCodium restart) |
| §3A | Capture check                      | DONE; existing v2 capture can detect CASE C but NOT distinguish CASE A from CASE B |
| §4  | Three-way boundary classification | CAPTURE_INSUFFICIENT_FOR_CASE_A_VS_CASE_B |
| §5  | RED                                | NOT_AUTHORIZED |
| §6  | Necessity / ablation               | N/A (no RED) |
| §7  | Bounded repair                     | NOT_AUTHORIZED |
| §8  | Conservation matrix                | PARTIAL (E1, E2, E6 PROVEN at policy seam; E3 CONTRACT_CONFLICT_DISCOVERED, NOT PASS) |
| §9  | Executable gates                   | DONE (bun test sdk-tool-policies.test.ts -> 36/37 PASS; 1 BASELINE_ONLY) |
| §10 | Live dogfood qualification         | NOT_EXECUTABLE |
| §11 | Temporary diagnostics              | NOT_TOUCHED |
| §12 | Durability / closure               | DONE |
| §13 | Halt                               | `CAPTURE_INSUFFICIENT reason=HOST_NOT_EXECUTABLE` (NOT `HALT_LIVE_FAILURE_NOT_REPRODUCED`; no reproduction was attempted) |
| §14 | Final report                       | DONE below |

#### §17.4 structural discriminator results (PASS at policy seam)

```text
T1 buildToolPolicies(editor).autoApprove        = false (load-bearing: editor entry ALWAYS asks)
T1 buildToolPolicies(replace_in_file).autoApprove = false
T1 buildToolPolicies(apply_patch).autoApprove   = false

T2a persisted.editFiles=true  + override=none -> isToolAutoApproved = true  (ALLOW)
T2b persisted.editFiles=false + override=none -> isToolAutoApproved = false (ASK)
T2c persisted.editFiles=true  + override=all  -> isToolAutoApproved = true  (ALLOW)
T2d persisted.editFiles=false + override=all  -> isToolAutoApproved = true  (ALLOW via override lift)

T3 SessionAutoApprovalStore pure-read confirmed:
    setOverride(sess-A, all) -> getOverride(sess-A) [1st] = all
                              getOverride(sess-A) [2nd] = all (PURE)
    getOverride(sess-X unknown) = none
    getOverride(undefined)      = none

T4-T8 editor-family under override=all + persistedOff:
    editor, replace_in_file, write_to_file, apply_patch, delete_file
    -> isToolAutoApproved = true (ALLOW) for ALL

T9-T10 isYoloSessionRequested:
    persistedOff + override=all  -> true
    persistedOff + override=none -> false
```

#### §17.4 verdict

```text
ENTRY_HEAD                  = 0b3dada93
SUBJECT_HEAD                = 0b3dada93
FINAL_HEAD                  = 0b3dada93 (this commit only amends ACT + adds evidence; no production delta)
WORKTREE                    = clean (no production/test/config delta)

LIVE_SPECIMEN               = NOT_EXECUTED (live binding cannot be attempted in sandbox-shell; user directive forbids VSCodium restart; NO reproduction was attempted)
LIVE_CAUSE                  = UNBOUND
BOUNDARY                    = POLICY_PREDICATE_STRUCTURALLY_PASS / LIVE_BOUNDARY_UNEXECUTED
RED                         = not authored (no live binding; authoring a RED at the policy seam would PASS, halting per ACT §5 own stop rules)
NECESSITY                   = not applicable
PRODUCTION_DELTA            = 0
CONSERVATION                = E1 PROVEN at policy seam; E2 PROVEN at policy seam; E3 CONTRACT_CONFLICT_DISCOVERED (not PASS); E6 PROVEN at policy seam
TESTS                       = bun test sdk-tool-policies.test.ts -> 36/37 PASS; 1 BASELINE_ONLY failure (owned by ACT-CLINEMM-COMMAND-RISK-V2-MKTEMP-EXPLICIT-PATH-EVIDENCE01)
DOGFOOD                     = NOT_EXECUTABLE (no Aqua session; user directive)
P0                          = NONE
P1                          = NONE (the prior P1 IMPLEMENTATION01 dependency is REMOVED; remaining gates are operator-driven)
P2                          = board row 18 already updated by ACT-CLINEMM-THREAD-OPEN-WORK-DURABILITY-CLEANUP01 P1 fix
NEXT                        = continuation of this ACT (operator-driven) on a host with an active Aqua session, per the existing §17.3 operator runbook
```

#### §17.4 HALT gates (per spec §13)

```text
HALT_LIVE_FAILURE_NOT_REPRODUCED    = NOT_APPLICABLE (no reproduction was attempted; correct halt code is CAPTURE_INSUFFICIENT reason=HOST_NOT_EXECUTABLE)
HALT_RED_NOT_REPRODUCED              = NOT_REACHED (RED not authored; would halt if authored)
HALT_SEAM_MOVED                      = NO (seam architecture preserved at HEAD; only line-number drift)
HALT_CAPTURE_INSUFFICIENT            = YES reason=HOST_NOT_EXECUTABLE (live binding impossible in this shell; CASE_A_VS_CASE_B also remains unbound - existing capture cannot distinguish them without a new probe at SdkInteractionCoordinator publication seam)
HALT_COMMAND_POLICY_DELTA            = NO (this ACT does not modify command policy)
HALT_MCP_POLICY_REGRESSION           = NO (sdk-tool-policies.test.ts CORRECTION03 cases pass at HEAD)
HALT_MANUAL_ACT_REGRESSION           = NO (T2b persistedOff+override=none => ASK proves manual approval path preserved)
HALT_PLAN_MODE_REGRESSION            = NOT_EXERCISED (Plan mode out of this ACT scope)
HALT_DUPLICATE_APPROVAL_AUTHORITY    = NO (no new probe introduced; no repair fabricated)
HALT_ACT_OWNED_REGRESSION            = NO (production_delta=0; no test file touched)
HALT_NEW_P0                          = NO (no new P0; environmental constraint was already documented in epic-board.md row 18)
```

#### §17.4 durable record

```text
This ACT remains OPEN. The 2026-08-31 sandbox-shell structural discriminator produced a sub-verdict:
  PASS_EDITOR_TOOL_POLICY_SEAM_STRUCTURAL_V1 (structural PASS for the policy predicate only).

Strict classification (per Factory causal reviewer P0+P1 correction):
  STATUS                  = OPEN / STRUCTURAL_POLICY_PASS / LIVE_BINDING_UNEXECUTED
  LIVE_SPECIMEN           = NOT_EXECUTED (no reproduction was attempted)
  LIVE_CAUSE              = UNBOUND
  CASE_A                  = STRUCTURALLY_EXONERATED_ONLY (sub-verdict; NOT promoted to LIVE_EXONERATED)
  CASE_B                  = UNBOUND
  CASE_C                  = UNBOUND
  E3                      = CONTRACT_CONFLICT_DISCOVERED (NOT a conservation PASS)
  HALT                    = CAPTURE_INSUFFICIENT reason=HOST_NOT_EXECUTABLE
  PRODUCTION_REPAIR       = NOT_AUTHORIZED

The remaining live-binding gate (CASE B / CASE C classifier + E3 product-policy decision) requires:
  (a) a headed VSCodium runbook per ACT §17.3 operator-runbook (ACTIVE Aqua session, code restart, CONTROL_A + CONTROL_B + live specimen), OR
  (b) a separately-authorized new default-off probe at the SdkInteractionCoordinator publication seam (sdk-interaction-coordinator.ts:417 ASK branch) that captures the final requestToolApproval decision outcome for non-command tools, OR
  (c) a product-policy decision on E3 recorded in .factory/epics/approval-protection.md row 19 SCOPE_BOUNDARY before this ACT can be treated as E3 PASS.

Neither (a), (b), nor (c) is in this ACT scope to authorize from a sandboxed shell.

Evidence files (durably persisted):
  .factory/evidence/ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01/structural-discriminator-20260831T073000Z/discriminator-results.json
  .factory/evidence/ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01/source-seam-map.md (re-verified at HEAD; architecture preserved)

Factory rule: STOP. The load-bearing claim (policy predicate structural PASS) is proven and qualified as a sub-verdict. Do not recursively review the review. The next chat should resume this ACT only when (a) a headed VSCodium becomes available, (b) the probe-authorization question is settled by a separate ACT, or (c) the E3 product-policy decision is recorded.
```
