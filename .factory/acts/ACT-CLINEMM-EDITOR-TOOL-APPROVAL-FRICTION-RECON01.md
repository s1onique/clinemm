# ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01

> Status: **OPEN / WAITING_FOR_LIVE_SPECIMEN** — recon §2 PASS at
> HEAD f8dca1fda / TREE 6f2e01b56 (committed at dbd7c6449); §3
> live specimen gated behind
> `ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01`
> dogfood closure.
>
> **Primary purpose**: LIVE REPRODUCTION → approval-boundary
> classification → RED at real production seam → causal discriminator →
> NO REPAIR unless RED proves residual ASK.
>
> **Predecessor**: `ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01`
> (NEXT; binding to this ACT is queued behind IMPLEMENTATION01 dogfood
> per the completion-authority contract).
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

Verified at ACT open:

```text
ENTRY_HEAD      = f8dca1fda
ENTRY_TREE      = 6f2e01b56
WORKTREE        = CLEAN (no uncommitted tracked changes)
PROTECTED_STASH = PRESERVED (1 entry; "c2-green-and-c2-p1-delta")
CURRENT_IMPLEMENTATION01_DOGFOOD = NOT YET BOUND
                  (IMPLEMENTATION01 dogfood is the predecessor; this
                   ACT does not start RED until the predecessor's
                   live qualification is recorded per IMPLEMENTATION01
                   §9 Phase-8 success signature.)
```

No entry anomaly. No mixed-fix carry-over.

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
