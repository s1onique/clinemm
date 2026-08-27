# source-seam-map.md — ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01

```text
ACT          = ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01
HEAD         = f8dca1fda
TREE         = 6f2e01b56
WORKTREE     = CLEAN
AUTHORED_BY  = factory recon (this ACT)
STATUS       = PASS_RECON_SEAM_MAPPED
```

This evidence file is **STRUCTURAL** — derived from a live read of the
production source tree at the HEAD/TREE above. No behavioral inference;
each seam reference is paired with the line that establishes it.

---

## A. The canonical seam for the editor-tool approval path

The non-command tool approval callback is the **only ALLOW gate** for
edit tools in the current architecture. This is established by three
joint structural facts:

```text
(T1) sdk-tool-policies.ts:56..83  buildToolPolicies()
        ALL Cline-governed tools (read/edit/browser/mcp) are forced
        to { autoApprove: false }. Edit tools are listed at line 65:
            set(["editor", "replace_in_file", "write_to_file",
                 "apply_patch", "delete_file"])

        ⇒ for any edit tool, request.policy.autoApprove is ALWAYS
          false at the entry of requestToolApproval.

(T6) sdk-interaction-coordinator.ts:417  (non-command branch)
        if (request.policy.autoApprove === true
            || this.options.shouldAutoApproveTool?.(request) === true) {
            return { approved: true }
        }

        ⇒ the disjunct `request.policy.autoApprove === true` can
          NEVER be true for edit tools. The ONLY remaining ALLOW
          path is `shouldAutoApproveTool(request) === true`.

(T4) SdkController.ts:799..818  shouldAutoApproveTool
        const persisted = stateManager.getGlobalSettingsKey(
                              "autoApprovalSettings")
                           ?? DEFAULT_AUTO_APPROVAL_SETTINGS
        const sessionId = sessions.getActiveSession()?.sessionId
        const override = sessionAutoApproval.getOverride(sessionId)
        const effective = resolveEffectiveAutoApproval(persisted, override)
        return isToolAutoApproved(request.toolName, effective,
                                  this.mcpHub, override)
```

So the entire causal chain for whether an edit tool results in a
visible approval prompt reduces to whether `isToolAutoApproved(name,
effective, mcpHub, override)` returns `true` for that toolName.

## B. The policy leaf (isToolAutoApproved)

`sdk-tool-policies.ts:952..1001`:

```text
isReadTool(name)    → settings.actions.readFiles
isEditTool(name)    → settings.actions.editFiles            <-- editor path
isCommandTool(name) → settings.actions.executeSafeCommands
isBrowserTool(name) → settings.actions.useBrowser
parseMcpToolName(name) → per-tool autoApprove, plus a special-case
                          "override === all" lift at lines 985..987
```

`isEditTool` is defined at line 91:

```text
["editor", "replace_in_file", "write_to_file",
 "apply_patch", "delete_file"].includes(toolName)
```

## C. Session override composition

`sdk-tool-policies.ts:799..818` reads:

```text
override = sessionAutoApproval.getOverride(sessionId)
```

`SessionAutoApprovalStore` is defined in
`apps/vscode/src/sdk/session-auto-approval.ts`. The `getOverride`
method is non-mutating and returns the override bound at the most
recent rebuild for that session id (`"none"` if no intent was
consumed).

The composition function `resolveEffectiveAutoApproval` at
`session-auto-approval.ts:221..244`:

```text
override === "none" → return persisted (SAME object reference)
override === "all"  → return { ...persisted,
                               actions: { ...persisted.actions,
                                          readFiles: true,
                                          editFiles: true,
                                          executeAllCommands: true,
                                          useBrowser: true,
                                          useMcp: true,
                                          readFilesExternally:
                                              persisted.actions.readFilesExternally,
                                          editFilesExternally:
                                              persisted.actions.editFilesExternally,
                                          executeSafeCommands:
                                              persisted.actions.executeSafeCommands,
                               } }
```

Note: `editFilesExternally` is **NOT overwritten** by override=all —
it preserves the persisted value. This matches the
`AutoApprovalSettings.ts` shape (`editFilesExternally?: boolean`,
marked legacy compatibility).

## D. The ASK branch

When the ALLOW branch at line 417 is NOT taken, the ASK path runs
at lines 426..447:

```text
await this.options.onToolApprovalAsk?.(request)        // opens diff preview
const toolAskMessage: ClineMessage =
    buildToolApprovalAskMessage(request.toolName,
                                request.input,
                                this.nextMessageTs())
this.options.messages.appendAndEmit([toolAskMessage], ...)
this.options.setTurnPhase?.("awaiting_approval",
                             toolAskMessage.ts,
                             "interaction-handle-tool-approval")
await this.options.postStateToWebview()
```

The `onToolApprovalAsk` callback is wired at `SdkController.ts:780`:

```text
onToolApprovalAsk: (request) =>
    this.diffEdits.openForApproval(request.toolCallId,
                                   request.toolName,
                                   request.input)
```

`openForApproval` at `sdk-diff-edit-coordinator.ts:97..111` opens a
pre-approval preview for `editor` or `apply_patch` tool calls — NOT a
mutation, just a side-by-side diff so the user decides with the actual
change visible.

## E. The mutation boundary (post-approval only)

The actual file write happens at
`sdk-diff-edit-coordinator.ts:119..146` (`executeEditorTool`) and
`:158..191` (`executeApplyPatchTool`). Both call
`fallbackEditorExecutor(input, cwd, context)` (or
`fallbackApplyPatchExecutor`) — that is the real file write.

**Critical structural finding**: the mutation boundary is reached
**only AFTER** the approval callback returns. The `hadPreApprovalPreview`
flag at line 121 is the marker that distinguishes pre-approved
edits (preview opened during ASK) from auto-approved edits (no
preview was opened). The mutation itself is the same in both cases.

This **structurally excludes Bucket E** (PROMPT AFTER FILE MUTATION)
as the discriminator for this code path: the prompt cannot come after
the mutation in this architecture, because the mutation is downstream
of the ASK emission.

## F. Existing diagnostic seam (CAPTURE_INSUFFICIENT check)

`sdk-interaction-coordinator.ts:265..272` already wires
`approval.entry.v2` and `approval.terminal.v2` via `emitV2Capture`:

```text
emitV2Capture({
    codePoint: "approval.entry.v2",
    correlationId,
    commandDigest,
    data: { toolName: request.toolName, isCommand }
})
```

This is the **canonical first seam to try** for the §3 live capture.
The `correlationId` and `commandDigest` are propagated via
AsyncLocalStorage so downstream emitters (T6..T9) can carry the
same trace.

**Likely sufficient — not yet proven**. The existing capture surface
emits `toolName`, `isCommand`, and correlation pair. Whether the
**full A–G discriminator** (policy ASK vs. callback ASK vs.
callback ALLOW + stale UI) is reconstructible from these fields
plus per-callback emits is an open question that a live specimen
must settle. If §3 proves the seam insufficient,
**CAPTURE_INSUFFICIENT** is the right gate — do NOT solve
observability by turning diagnostics into architecture.

## G. Recon verdict

```text
PASS_RECON_SEAM_MAPPED

The 10 semantic stages are mapped:
T0..T9 correspond exactly to:
  T0  SDK invokes requestToolApproval(ToolApprovalRequest)
  T1  buildToolPolicies forces autoApprove:false (sdk-tool-policies.ts:56)
  T2  handleRequestToolApproval emits approval.entry.v2 (line 254)
  T3  branch on isCommandTool (line 296+)
  T4  shouldAutoApproveTool callback (SdkController.ts:799)
  T5  isToolAutoApproved leaf (sdk-tool-policies.ts:952)
  T6  ALLOW/ASK conjunct at line 417
  T7  onToolApprovalAsk + buildToolApprovalAskMessage (lines 426..447)
  T8  approval.terminal.v2 (line 288)
  T9  mutation at executeEditorTool / executeApplyPatchTool
        (sdk-diff-edit-coordinator.ts:119 / 158)

The 10 required locations all exist at the cited lines:
1..10. all verified live in current source at HEAD/TREE.

HALT conditions:
- HALT_SEAM_MOVED:        NOT triggered (every cited symbol exists
                                    at the cited line)
- HALT_PRESENTATION_BOUNDARY: NOT triggered (no Bucket C-shaped
                                    evidence yet; live capture in §3
                                    will either confirm or trigger)

Bucket E (PROMPT AFTER FILE MUTATION) is **structurally excluded**
by the source-seam map. If a Bucket E specimen is later observed,
HALT_SEAM_MOVED is the right gate (it would mean a different code
path is being exercised that the recon has not yet located).
```

## H. Causal hypotheses for the live specimen (per spec §4)

These are **STRUCTURAL** hypotheses — derived from the source
map above. They MUST be validated against the live specimen in §3,
not promoted to LIVE without that validation.

```text
A. POLICY SAYS ASK
   editFiles=false in persisted settings
   → isToolAutoApproved returns false at T5
   → fall through to T7 ASK path
   ⇒ test: persist editFiles=false; verify prompt appears
   ⇒ discriminator: read stateManager.getGlobalSettingsKey at T4

B. POLICY SAYS ALLOW, CALLBACK STILL REACHED
   editFiles=true but shouldAutoApproveTool returns false
   ⇒ impossible structurally (T4 returns isToolAutoApproved result
     verbatim); would require a wrapped/transformed return value.
   ⇒ test: read T4 return value at the boundary, not just the
     settings input.

C. POLICY SAYS ALLOW, CALLBACK NOT REACHED, UI STILL SHOWS PROMPT
   ⇒ T4 shouldAutoApproveTool never invoked (request.policy.autoApprove
     somehow true at T6), then a stale ask remains in messages
   ⇒ would require a separate code path that emits a tool_approval
     ask message WITHOUT going through T6.

D. POLICY SAYS ASK BECAUSE TOOL CLASSIFIED DIFFERENTLY
   editFiles=true but toolName not in isEditTool set
   ⇒ would require a renamed / wrapped toolName between T0 and T4
   ⇒ test: read request.toolName at T2 and T4 — must be byte-equal.

E. PROMPT AFTER FILE MUTATION
   ⇒ structurally excluded by §E above; if observed, HALT_SEAM_MOVED.

F. SESSION AUTHORITY CHANGED AROUND TOOL CALL
   ⇒ getOverride(sessionId) returns "none" at the moment of T4
     even though "all" was armed
   ⇒ test: read sessionAutoApproval.peekArmed() + getOverride()
     before and after the ask; correlate to sessionId.

G. CALLBACK/TOOL EVENT CANNOT BE CORRELATED
   ⇒ CAPTURE_INSUFFICIENT (cannot classify without correlation).
```

## I. Why this ACT stops at recon (per spec §1 entry discipline)

Per spec §1, RED is **not** written until §3 produces a live
specimen. The IMPLEMENTATION01 dogfood (the predecessor ACT) is not
yet bound per the §1 entry check. Mixing IMPLEMENTATION01 closure
evidence into this ACT would be the §1 forbidden
`HALT_UNEXPECTED_TRACKED_DIRT` failure mode.

So:

```text
[x] §0 frozen invariant              ✓ captured
[x] §1 entry discipline              ✓ verified
[x] §2 source-seam map               ✓ captured (this file)
[ ] §3 live specimen                 ⏸ deferred to next ACT boundary
[ ] §4 discriminator                 ⏸ requires §3
[ ] §5 chronology                    ⏸ requires §3
[ ] §6 RED                           ⏸ requires §4
[ ] §7 ablation                      ⏸ requires §6
[ ] §8 bounded repair                ⏸ requires §7
[ ] §9 forbidden repair              ✓ doctrine captured (not exercised)
[ ] §10 conservation suite           ⏸ requires §6/§8
[ ] §11 instrumentation rules        ✓ doctrine captured (reusing v2)
[ ] §12 file budget                  ✓ captured
[ ] §13 gates                        ✓ recon-side marked
[ ] §14 live qualification           ⏸ requires §6/§8
[ ] §15 stop rules                   ✓ doctrine captured
[ ] §16 allowed exits                ✓ doctrine captured
[ ] §17 provenance                   ✓ this file
```

## J. Cross-references

- Companion evidence file:
  - `.factory/evidence/ACT-CLINEMM-SEATBELT-YOLO-APPROVAL-FRICTION-RECON01/`
    (CLOSED command-policy recon evidence — distinct surface)
- ACT file:
  `.factory/acts/ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01.md`
- Epic ledger row owner:
  `.factory/epics/approval-protection.md` row 19
- Board row owner:
  `.factory/epic-board.md` row `Approval / editor-tool`
- Predecessor ACT (NOT YET BOUND):
  `.factory/acts/ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01.md`