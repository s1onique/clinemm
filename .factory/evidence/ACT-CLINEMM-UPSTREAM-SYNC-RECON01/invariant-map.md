# FORK INVARIANT MAP (Frozen, irrespective of fetch outcome)
#
# These are ClineMM invariants that ANY future upstream integration MUST
# preserve. They are derived from prior ACTs and the ClineMM substrate
# contract, not from upstream. They remain binding even though this
# recon ACT cannot proceed to measurement.

F1  Factory/evidence substrate preserved
    - .factory/ tree, evidence files, ACT directories, factory board
      must remain in the working copy after any merge.
    - Prior reconciliation
      (ACT-CLINEMM-UPSTREAM-PARITY-AND-SETTINGS-BACKLOG-REFINEMENT01)
      established that Factory substrate is orthogonal to upstream.

F2  ClineMM branding / config preserved
    - package.json `displayName`, `name`, `publisher`, vsix identifier,
      settings UI labels remain fork-owned.

F3  Sandbox default-on behavior preserved where applicable
    - macOS Seatbelt default-deny remains in force for Darwin hosts
      that opt in.
    - Per capability toggle (network, ssh-agent) is ClineMM-specific.

F4  Network capability semantics preserved
    - clinemmSafeYoloAllowNetwork=false => egress denied by Seatbelt
      regardless of upstream YOLO/auto-approval posture.
    - Settings-persisted false BEATS env allow.

F5  SSH-agent authority semantics preserved
    - clinemmSafeYoloAllowSshAgent=false => no SSH agent authority,
      regardless of upstream YOLO posture.

F6  Raw credential protections preserved
    - No raw SSH key material in prompts / logs / telemetry.

F7  Safe-YOLO settings persistence preserved
    - Settings toggle round-trip must remain consistent with
      `updateSettings.ts` AND `updateSettingsCli.ts` (the
      BOTH update paths invariant).

F8  Capture diagnostics remain DEFAULT_OFF
    - CLINE_CAPTURE_BROWSER-style toggles do not leak into production
      defaults.

F9  Approval diagnostics remain semantic-zero when disabled
    - Capture/approval diagnostics must not affect user-visible
      approval behavior when their toggle is off.

F10 Protected stashes untouched
    - stash@{0} (c2-green-and-c2-p1-delta) MUST NOT be popped,
      dropped, or rewritten by any integration ACT.

F11 No historical evidence rewrite
    - Evidence OIDs under .factory/evidence/.../ are stable; merges
      must not change their content. (Conflicts in those files mean
      the integration ACT must HALT, not auto-resolve.)

F12 No silent proto-field collision
    - Any upstream `state.proto` or `common.proto` field-number
    change that collides with a ClineMM-owned field is a P0
    collision → HALT_UPSTREAM_P0_COLLISION.

ADDITIONAL (from prior ACTs):
F13 Merge, never rebase (docs/factory/upstream-sync.md doctrine)
F14 Conflict evidence under docs/factory/sync/<date>/ for every merge
F15 Historical baseline c564045d8135c0c1c330b21d47b68b74917ce614
    remains the reference point in factory/inventories/repository.json
    until a SUCCESSFUL fetch updates it.

F16 No MCP-approval simplification collision
    - Upstream PR #13498 (2b7b01328) removes `mcpHub` from
      `isToolAutoApproved` and simplifies MCP approval to the single
      `useMcp` toggle. ClineMM's `setSessionAutoApprovalOverride`
      projection must still apply on the merged result; if ClineMM
      had any per-MCP-tool approval wiring, it must either be
      consolidated under the new global toggle or remain scoped to
      session-scoped overrides only.

F17 `state.proto` field-174 restoration preserved
    - ClineMM adds back `optional bool auto_approve_all_toggled =
      174` (see comment block referencing
      `src/hosts/vscode/vscode-to-file-migration.ts:289`).
    - Upstream PR #13226 (38f8260bc) deletes it. ClineMM's restoration
      MUST be preserved during merge; downstream: a separate ACT may
      re-anchor the legacy migration at the legacy source location and
      remove the proto field, but only after proving the migration
      remains safe.

F18 `user_context_ceiling` (187) + `clear_user_context_ceiling` (188) preserved
    - Both are ClineMM-only proto additions; both are ClineMM-only
      UpdateSettingsRequest additions; both are ClineMM-only
      StateManager keys. No upstream collision.

F19 `setSessionAutoApprovalOverride` + `handoffWithContext` RPCs preserved
    - ClineMM-only additions to StateService and TaskService.
      Upstream did not add either of these (verified).

F20 ClineMM-only diagnostic substrate preserved
    - `host-ownership-capture/`, `v2-capture.ts`, `task-state-shadow-*.ts`,
      `task-operation-fence.ts`, `task-telemetry-tracker.ts`,
      `turn-state-*.ts` are ClineMM-only and have no upstream
      equivalent. Upstream did not land any competing diagnostic
      substrate. Integration must NOT drop, simplify, or rewrite
      these files.

F21 `sandbox-policy.ts` + `command-job-manager.ts` (Safe-YOLO core) preserved
    - Both files are ClineMM-only, ~96 KB total. Upstream did not
      touch them. They are the substrate for the SETTINGS_SANDBOX_CAPABILITIES
      and SEATBELT_* closed lanes. Integration must NOT drop or rewrite.

F22 Model-tool-routing semantics recorded for live specimen
    - Upstream `DEFAULT_MODEL_TOOL_ROUTING_RULES` may route `codex`/`gpt`
      (or `openai-native`) models to `apply_patch` instead of `editor`.
      Any ClineMM live editor-tool specimen MUST record the actual
      provider/model used and confirm the tool the runtime actually
      selects; `editor` cannot be assumed.

F23 Completion authority emission path converges on `emitTaskCompletedOnTeardown`
    - Upstream PR #13489 (c870116d1) introduces
      `emitTaskCompletedOnTeardown` as the single task.completed emission
      point. ClineMM's `COMPLETION_AUTHORITY` lane must adopt this
      emission point (or its local equivalent) instead of any
      hand-wired task.completed path. Failure to converge means a
      duplicate event on `releaseSessionRuntime`.

F24 Remote-config refresh: `force` option semantics
    - Upstream PR #13226 refactors `refreshRemoteConfig` to accept
      `{ force: true }` and route through `RemoteConfigRefreshCoordinator`.
      ClineMM's `updateSettings.ts` `optOutOfRemoteConfig` branch
      already migrated in this window (verified ClineMM diff).
      Integration must preserve the force semantics so an
      in-flight refresh that sampled the pre-change opt-out
      preference does not silently report success on the new value.

F25 Hook subsystem is upstream-only; do not assume parity
    - Upstream hooks (`8fe5a196c`, `9b9a067fb`) are upstream-only.
      ClineMM does not currently wire hooks. Integration must NOT
      assume ClineMM provides hook semantics that upstream tests
      rely on.

F26 SDK auto-build pre-condition
    - After merge, `bun run build:sdk` MUST succeed before any
      runtime tests run. The 4 SECURITY_CRITICAL conflict files
      touch SDK packages (`local-runtime-host.ts`, `bash.ts`,
      `sdk-tool-policies.ts`) and ClineMM has multiple SDK
      consumers.