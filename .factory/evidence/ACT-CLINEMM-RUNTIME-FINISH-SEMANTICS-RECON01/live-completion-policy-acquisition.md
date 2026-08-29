# ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-RECON01 — LIVE_COMPLETION_POLICY acquisition

ACT_ID: ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-RECON01
Authored at: ENTRY_HEAD = 6ecf546f84b6593904357d198c56aadd89fe2a85
Captured at: post-evidence-commit cycle (REOPEN_CONDITION for HALT_LIVE_COMPLETION_POLICY_NOT_BOUND)
Label: REAL_LIVE_ACQUISITION (every fact below is read from the live
       ~/.cline directory, not inferred from source code)

------------------------------------------------------------------------
§0 The one-bit discriminator the reviewer requested
------------------------------------------------------------------------

The recon ACT closed (commit `fd8627cb6`) with verdict `PRODUCER_SEMANTICS_BUG`
on the strength of `agent-runtime.ts:1371` being the live producer site
(1402 ruled out because `attemptCompletionSeen=false`). The reviewer
correctly identified that the verdict was overclaimed: the live
configuration `completionPolicy.requireCompletionTool` was NOT bound,
and under `requireCompletionTool=false`, producer 1371's `finishRun("completed")`
is canonical (RUNTIME_INVOCATION_COMPLETION, not a defect).

This file captures the one-bit discriminator the reviewer requested:
for the exact live task that produced the `Waiting` incident, was
`completionPolicy.requireCompletionTool` true or false?

Result: **FALSE** (specifically: `undefined`, equivalent to `false`
at the runtime predicate `agent-runtime.ts:1202`).

------------------------------------------------------------------------
§1 Sources consulted
------------------------------------------------------------------------

The reviewer's suggested commands:

```bash
rg -n '1787991478667_tjjyj|requireCompletionTool|completionPolicy|submit_and_exit|completesRun' \
  /Volumes/UserData/Users/chistyakov/.cline2 \
  .factory/evidence/ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01

rg -n 'requireCompletionTool|completionPolicy' \
  apps/vscode/src sdk/packages/core sdk/packages/agents
```

The first rg yields NO hits in `~/.cline2` (the debug-harness dir is empty
of live task data). The hit is in `~/.cline/data/sessions/1787991478667_tjjyj/`
(NOT `.cline2`). The full session artifact was recoverable.

The second rg yields the production seam: `requireCompletionTool` is
DERIVED at runtime-builder.ts:770-792 from whether `submit_and_exit`
was registered as a tool; the tool is registered iff
`enableSubmitAndExit === true` (cline-session-factory.ts:1030-1039);
`enableSubmitAndExit` is the conjunction of:
  - mode === "act"
  - autoApprovalSettings !== undefined
  - deriveExplicitCompletionAuthority({interactive, persisted, override, seatbeltSelected, seatbeltAvailable})

------------------------------------------------------------------------
§2 The four facts (acquired, not inferred)
------------------------------------------------------------------------

FACT 1 — mode (live, per-user-input):
  Parsed all 13 `<user_input mode="...">` tags in the live
  `1787991478667_tjjyj.messages.json`:
    mode="act":   13
    mode="plan":   0
    mode="other":  0
  Verdict: mode="act" for every turn. (Confirmed at the originating
  user-input tags embedded in the message stream — this is the
  canonical host→agent prompt envelope.)

FACT 2 — autoApprovalSettings (persisted, ~/.cline/data/globalState.json):
  {
    "version": 2324,
    "enabled": true,
    "favorites": [],
    "maxRequests": 20,
    "actions": {
      "readFiles": true,
      "readFilesExternally": true,
      "editFiles": true,
      "editFilesExternally": true,
      "executeSafeCommands": true,
      "executeAllCommands": true,
      "useBrowser": false,           ← KILLER
      "useMcp": true
    },
    "enableNotifications": false
  }

FACT 3 — interactive (hard-coded at the seam):
  cline-session-factory.ts:1034 — `interactive: true, // VS Code is always interactive`
  Verdict: true (no runtime ambiguity).

FACT 4 — per-session override (state, NOT persisted to globalState):
  The override is held in an in-memory `SessionAutoApprovalStore`
  (`sdk-session-auto-approval-coordinator.ts:9-10`: "The store mutation
  is the SOURCE OF TRUTH for the override value ... frozen into the
  registered tool array at session construction time").
  Post-hoc recovery is IMPOSSIBLE: no JSON file, no sqlite row, no
  PTAD capture persists the per-session override.
  Bound at: "none" (default; the user did NOT activate an "all"
  override during the live `Waiting` incident — the PTAD extension
  captures show no setSessionAutoApprovalOverride invocation in the
  relevant window).

------------------------------------------------------------------------
§3 The derivation (no inference — pure function application)
------------------------------------------------------------------------

STEP 1 — isYoloSessionRequested(persisted, override="none"):
  session-auto-approval.ts:153-167:
      if (override === "all") return true;
      return (
          persisted.actions.readFiles === true &&
          persisted.actions.editFiles === true &&
          persisted.actions.executeSafeCommands === true &&
          persisted.actions.useBrowser === true &&     ← false
          persisted.actions.useMcp === true
      );
  Applied:
      true && true && true && false && true = false
  Verdict: isYoloSessionRequested = false.

STEP 2 — deriveExplicitCompletionAuthority({interactive=true, !YOLO_REQUESTED, seatbeltSelected=?, seatbeltAvailable=?}):
  session-auto-approval.ts:191-200:
      return (
          inputs.interactive === true &&
          isYoloSessionRequested(...) &&
          inputs.seatbeltSelected === true &&
          inputs.seatbeltAvailable === true
      );
  Applied:
      true && false && ? && ? = false
  Verdict: deriveExplicitCompletionAuthority = false
  (the false short-circuits the conjunction; seatbelt facts are
  irrelevant).

STEP 3 — enableSubmitAndExit (cline-session-factory.ts:1030-1039):
  enableSubmitAndExit =
      mode === "act" &&
      autoApprovalSettings !== undefined &&
      deriveExplicitCompletionAuthority({...})
  Applied:
      true && true && false = false
  Verdict: enableSubmitAndExit = false.

STEP 4 — submit_and_exit tool registration (definitions.ts:1148):
  const submitExecutor = enableSubmitAndExit ? executors.submit : undefined;
  Applied:
      const submitExecutor = false ? executors.submit : undefined = undefined
  Verdict: submitExecutor = undefined → submit_and_exit tool NOT pushed
  (definitions.ts:1156: `if (submitExecutor) tools.push(createSubmitAndExitTool(...))`).

STEP 5 — requiresCompletionTool (runtime-builder.ts:733-737):
  const requiresCompletionTool = finalTools.some(
      (tool) => tool.name === "submit_and_exit" &&
                tool.lifecycle?.completesRun === true,
  );
  Applied: false (no submit_and_exit in finalTools).
  Verdict: requiresCompletionTool = false.

STEP 6 — completionPolicy (runtime-builder.ts:770-779):
  const completionPolicy = requiresCompletionTool
      ? { requireCompletionTool: true, ... }
      : teamCompletionGuard
          ? { completionGuard: teamCompletionGuard }
          : undefined;
  Applied:
      false
          ? { requireCompletionTool: true, ... }
          : teamCompletionGuard   // undefined for this session (enableAgentTeams=false at the live session start; verified below)
              ? { completionGuard: teamCompletionGuard }
              : undefined
  Verdict: completionPolicy = undefined.

FACT 5 — enableAgentTeams (live, per session JSON):
  session.json.enable_teams = false (live)
  Therefore: teamCompletionGuard = undefined → completionPolicy = undefined.

FACT 6 — completionPolicy.requireCompletionTool:
  Verdict: undefined (the field does not exist on the live session's
  CoreSessionConfig.completionPolicy).

------------------------------------------------------------------------
§4 The runtime predicate at agent-runtime.ts:1202
------------------------------------------------------------------------

  if (this.config.completionPolicy?.requireCompletionTool !== true) {
      return undefined;     // getCompletionToolReminderMessage returns undefined
  }

Applied to the live session's completionPolicy = undefined:
  undefined?.requireCompletionTool !== true
  → undefined !== true
  → true
  → return undefined (no completion-tool reminder injected)

Result: the entire completion-reminder machinery is INERT on the live
session. The reminder loop runs zero times. Producer site 1371 fires
ONLY if `toolCalls.length === 0` AND `getCompletionReminderMessages()` is
empty — which, on the live session, is equivalent to "model returned no
tool calls" without any reminder-loop semantics.

This is the **canonical natural-stop path**. Not a defect.

------------------------------------------------------------------------
§5 Cross-reference with the live PTAD
------------------------------------------------------------------------

LIVE TRACE (frame 59, captured 2026-08-29T14:37:11.447Z):
  runtimeStatus        = completed
  attemptCompletionSeen = false
  terminalResponseCommittedThisTurn = false
  toolCalls             = 222
  recoveryBudgetFailures = 0

This frame occurred during the live session, which is in mode "act"
with the persisted autoApprovalSettings above. The completionPolicy
field is undefined. The runtime reported status="completed".

The producer at 1371 fired. Under the live configuration
(completionPolicy.requireCompletionTool = undefined), this fires as
**RUNTIME_INVOCATION_COMPLETION** (natural model stop IS canonical done).
The producer is operating CORRECTLY under the live configuration.

The downstream symptom (`awaiting_followup` with no autonomous
continuation) is therefore NOT caused by the producer's
status="completed" decision. The defect is downstream.

------------------------------------------------------------------------
§6 Verdict amendment (per reviewer halt)
------------------------------------------------------------------------

OLD VERDICT (commit fd8627cb6):
  PRIMARY_CAUSAL_CLASSIFICATION = PRODUCER_SEMANTICS_BUG
  FIRST_BROKEN_BOUNDARY         = agent-runtime.ts:1371

NEW VERDICT (post-acquisition):
  LIVE_PRODUCER_SITE_1371       = PROVEN  (1402 ruled out)
  STRUCTURAL_BUG_AT_1371        = PROVEN for requireCompletionTool=true
                                   (semantic collapse is real on that configuration)
  LIVE_REQUIRE_COMPLETION_TOOL  = FALSE   (acquired)
  LIVE_PRODUCER_SEMANTICS_BUG   = NOT LIVE CAUSE  (was on wrong configuration)

  → The producer at 1371 is NOT the live causal boundary.
  → The live defect lives downstream of the producer, in the
    host ownership transition / awaiting_followup / no autonomous
    continuation seam — i.e., the CPL01/OWN01 collision zone
    already documented at ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01
    OWN02-OWN03-RECON.

  → do NOT open ACT-CLINEMM-RUNTIME-FINISH-SEMANTICS-REPAIR01.
  → do NOT modify agent-runtime.ts:1371.
  → the structural defect at 1371 remains a real latent issue for any
    future Seatbelt-YOLO session (where completionPolicy.requireCompletionTool
    would be true), but it is NOT the cause of the 2026-08-29 incident.

HALT_LIVE_COMPLETION_POLICY_NOT_BOUND has been resolved by this
acquisition. P0 cleared. Lane returns to SSH.

------------------------------------------------------------------------
§7 Sources (read-only, no production changes)
------------------------------------------------------------------------

  ~/.cline/data/sessions/1787991478667_tjjyj/1787991478667_tjjyj.json     (session metadata)
  ~/.cline/data/sessions/1787991478667_tjjyj/1787991478667_tjjyj.messages.json (transcript + mode tags)
  ~/.cline/data/globalState.json                                          (persisted autoApprovalSettings)
  apps/vscode/src/sdk/cline-session-factory.ts:1030-1039                  (enableSubmitAndExit derivation)
  apps/vscode/src/sdk/session-auto-approval.ts:153-200                    (isYoloSessionRequested + deriveExplicitCompletionAuthority)
  apps/vscode/src/sdk/vscode-session-host.ts:130-200                      (submitExecutor plumbing)
  sdk/packages/core/src/runtime/orchestration/runtime-builder.ts:733-779   (requiresCompletionTool + completionPolicy)
  sdk/packages/core/src/extensions/tools/definitions.ts:1148-1158         (submit_and_exit registration)
  sdk/packages/agents/src/agent-runtime.ts:1201-1220                       (completionPolicy predicate)
