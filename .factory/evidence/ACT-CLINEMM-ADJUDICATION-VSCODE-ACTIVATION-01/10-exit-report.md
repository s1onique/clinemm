# 10 — Exit report (G12, G13)

**ACT:** ACT-CLINEMM-ADJUDICATION-VSCODE-ACTIVATION-01
**Authorization:** C1: GO

> ## ⚠️ SUPERSEDED IN PART — read this first
>
> This document describes the **pre-correction** state of
> ACT-CLINEMM-ADJUDICATION-VSCODE-ACTIVATION-01, at entry/subject HEAD
> `7490a12a5`.
>
> It is **PRESERVED AS-IS** for historical identity. It is NOT the report for
> the corrected code.
>
> The review of this ACT returned **`HALT_SESSION_AUTHORITY_LIFECYCLE`** with
> two P0s. Both were closed by
> **ACT-CLINEMM-ADJUDICATION-VSCODE-ACTIVATION-01-CORRECTION01**, whose report
> is:
>
> - **`11-correction01-session-authority-lifecycle.md`** — the correction's
>   own report (producer session-identity split, persisted session
>   vocabulary, RESTORE secret semantics, the 15 correction witnesses).
> - **`12-p1-regression-reconciliation.md`** — the P1 regression
>   reconciliation at individual test-identity granularity.
>
> ### The VSIX identity in this document is PRE-CORRECTION
>
> The `VSIX:` block below records
> `dist/clinemm-4.1.26-7490a12a5-av01.vsix`
> (sha256 `5b5fc383…`, bundle `ab9bb821…`). That artifact was built from
> `7490a12a5` **plus uncommitted changes**, i.e. it does **not** contain the
> CORRECTION01 fix. Its bundle hash identifies a **DIFFERENT artifact** from
> the corrected source.
>
> **The previously packaged VSIX must NOT be used as evidence for the
> correction.** It is superseded for CORRECTION01 purposes. The corrected
> manifest is `artifact-hashes.json` (field `correction01`), which lists the
> corrected source, the corrected tests and the corrected evidence.
>
> The `installed_bundle_sha256` (`0b0c5828…`) is the **pre-ACT known-good
> build** in the `codium-roz` profile; it was never touched by this ACT and
> remains the rollback anchor. It is unaffected by the correction and is
> likewise superseded as evidence for the corrected artifact.

## VERDICT

```
PASS_STRUCTURAL_ONLY
```

The ACT's real VS Code host path is GREEN in structural tests, the packaged
artifact is source-bound, and the artifact was installed into the real
`codium-roz` profile and shown to ACTIVATE there. The decisive installed-live
observation — an accepted, model-published candidate in a real installed
session — was **not** completed, so `PASS_LIVE_ACTIVATION_QUALIFIED` is
**not** claimed.

## The final report

```
ACT: ACT-CLINEMM-ADJUDICATION-VSCODE-ACTIVATION-01
ENTRY_HEAD: 7490a12a58fbec73800f97c4b2346bde6b394725
SUBJECT_HEAD: 7490a12a58fbec73800f97c4b2346bde6b394725 (unchanged — see below)
FINAL_HEAD: 7490a12a58fbec73800f97c4b2346bde6b394725
BRANCH: main
WORKTREE: /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm
PRODUCTION_DELTA:
  - apps/vscode/src/sdk/adjudication-task-contract.ts          (NEW)
  - apps/vscode/src/sdk/adjudication-source-revision-resolver.ts (NEW)
  - apps/vscode/src/sdk/adjudication-session-secret.ts          (NEW)
  - apps/vscode/src/sdk/cline-session-factory.ts               (MODIFIED: the producer wiring)
  - apps/vscode/src/sdk/sdk-task-start-coordinator.ts           (MODIFIED: the consumption point)
  - apps/vscode/src/shared/storage/state-keys.ts                (MODIFIED: one secret key)
  - apps/vscode/src/sdk/__tests__/adjudication-vscode-activation01.test.ts                  (NEW)
  - apps/vscode/src/sdk/__tests__/adjudication-vscode-activation01.runtime-chain.c24-c-bridge.test.ts (NEW)
  - apps/vscode/vitest.config.ts        (MODIFIED: base exclusion)
  - apps/vscode/vitest.config.c2-4-c-bridge.ts (MODIFIED: bridge include + 2 aliases)
  - apps/vscode/tsconfig.json           (MODIFIED: base exclusion)
  - apps/vscode/tsconfig.c2-4-c-bridge.json (MODIFIED: bridge include + 2 path aliases)
  NO change to the SDK core, the proto surface, the webview UI, the
  provider request construction, submit_and_exit, or any Settings field
  other than the one secret-storage key.

VS_CODE:
  editor: VSCodium (codium-roz profile)
  extension_identifier: s1onique.clinemm
  installed_version: 4.1.26-613295a95 (the pre-ACT build, untouched)
  runtime_config_producer: apps/vscode/src/sdk/cline-session-factory.ts :: buildSessionConfig() (line 1097)
  runtime_config_consumer: sdk/packages/core/src/runtime/host/local-runtime-host.ts :: LocalRuntimeHost.startSession()/startResolvedSession()
  installed_bundle_identity:
    original  0b0c5828b44a12928bc9e78c1f250c50c7166bc4e7415825cd0bd7f9bd9dcea5 (sourceHead 613295a95)
    ACT build ab9bb821cf16a09c31b07447a72e4839719763bf75639a0c0b3e79dc5217c96d (sourceHead 7490a12a5 + delta)

ACTIVATION:
  default_off: PROVEN at the real producer (RED-1 passed against the ENTRY_HEAD producer AND after)
  explicit_opt_in: PROVEN (RED-2; the ablation reproduces the RED)
  task_vocabulary_authority: PROVEN — the host-owned armed-intent store (the existing SessionAutoApprovalStore pattern); no global vocabulary, no new protocol
  enabled_reaches_runtime: PROVEN (config.adjudication.enabled === true; the producer wiring is present in the installed bundle)
  no_op_provider_delta: PROVEN — the whole feature is behind one conditional spread; with no contract the produced CoreSessionConfig is byte-identical to the pre-ACT one

SOURCE_EVIDENCE:
  supported_tool_names: ["read_files"]
  actual_tool_used: read_files (in the synthetic fixture)
  acquisition_record: PROVEN (real git repo fixture; record rides on the canonical tool-result block)
  source_revision_bound: PROVEN (revision, content identity, repository identity, workspace-root identity, clean)
  observed_content_identity: PROVEN (a digest of the tool-returned bytes)
  handle_resolvable: PROVEN (registry.handleFor(toolUseId) resolves; forged and cross-session handles do not)

SECRET_PROVIDER:
  trusted_storage: StateManager's file-backed secrets.json (mode 0o600), key adjudicationSessionSecrets
  session_scoped: PROVEN (different session => different secret and different handle)
  restart_restorable: PROVEN structurally (same session + same persisted secret => same handle; ledger rebuilds from the canonical history)
  secret_disclosed: NO (no value was read, logged, or written into the evidence package)

RED:
  reproduced: YES
  production_seam: apps/vscode/src/sdk/cline-session-factory.ts :: buildSessionConfig()
  failing_assertion: expect(config.adjudication).toBeDefined()   [RED-2, at ENTRY_HEAD]

GREEN:
  assertions: RED-1 default-off (2), RED-2 activation + boundaries (3), RED-3 acquisition (4), RED-4 acceptance + negatives (5), RED-5 compaction continuity (3), RED-6 restoration (2)
  test_count: 18 ACT-owned witnesses, all PASS

C1:
  schema_valid: PROVEN
  nonempty_refs: PROVEN
  canonical_refs_resolved: PROVEN
  source_revision_bound: PROVEN
  candidate_accepted: PROVEN

C2:
  summarizer_omission: PROVEN — the section is carried even when the summarizer omits the candidate entirely
  persisted_sidecar: PROVEN (the section is installed into the continuation and rebuilds identically on a second compaction)
  provider_visible_continuation: PROVEN (the REAL MessageBuilder.buildForApi projection contains exactly one section)
  second_compaction: PROVEN (no duplicate section; byte-identical summary)
  restart: PROVEN structurally; NOT observed as an extension-host process restart

CONSERVATION: PROVEN — the base suite's failing-test identities are IDENTICAL to the ENTRY_HEAD baseline except for the ACT's own tests, which went from FAIL to PASS. ZERO regressions. The suite also REPAIRED one pre-existing RBE01 invariant failure.

SECURITY_NEGATIVE_CONTROLS: 19 of 19 PROVEN (see 06-security-and-conservation.md)

TYPECHECK:
  apps/vscode tsc --noEmit: 0 diagnostics
  apps/vscode tsconfig.c2-4-c-bridge.json: 5 diagnostics, identical to the ENTRY_HEAD baseline (0 ACT-owned)
  sdk/packages/core typecheck: 44 diagnostics, identical before and after (0 ACT-owned)

ACT_OWNED_DIAGNOSTICS: 0

BUILD_GATES:
  focused VS Code activation tests: 5/5 PASS
  runtime-chain tests: 13/13 PASS
  core adjudication/provenance tests: 78/78 PASS
  existing compaction context tests: PASS (covered by the above)
  the historical five-test RED: STILL 5 failed / 5 — INTACT and UNCHANGED
  biome lint (9 changed files): PASS
  biome format: PASS

VSIX:
  source_head: 7490a12a58fbec73800f97c4b2346bde6b394725
  version: 4.1.26
  path: dist/clinemm-4.1.26-7490a12a5-av01.vsix
  bytes: 65046373
  sha256: 5b5fc383649a067968cabf986ff5fa89af4d8dd990822b32ce9687efe8a96d1a
  bundled_extension_sha256: ab9bb821cf16a09c31b07447a72e4839719763bf75639a0c0b3e79dc5217c96d
  installed_bundle_sha256: 0b0c5828b44a12928bc9e78c1f250c50c7166bc4e7415825cd0bd7f9bd9dcea5 (the pre-ACT build; UNTOUCHED)

LIVE:
  executed: YES (partial)
  execution_class: LIVE
  session_id: NOT OBSERVED (no model turn was executed)
  capture_run: the ACT's VSIX installed into a COPY of the codium-roz profile; the extension activated; the webview resolved
  actual_model: NOT EXECUTED
  accepted_candidates: 0 (none observed)
  compaction_boundary: NOT EXECUTED live
  post_compaction_visibility: NOT EXECUTED live
  extension_host_restart: NOT EXECUTED live

ROUND_C:
  eligible_read_files: 0 of the 97 canonical tool calls
  unsupported_run_commands: 6 of the 6 candidate reads (all of them)
  authorized_vocabulary: NONE (no authorized R1-R10 vocabulary exists)
  applicability: UNSUPPORTED_EVIDENCE_CLASS + ROUND_C_CONTRACT_UNAVAILABLE
  behavioral_improvement: NOT PROVEN (out of scope by G10.3)

ARTIFACTS: .factory/evidence/ACT-CLINEMM-ADJUDICATION-VSCODE-ACTIVATION-01/

VERDICT: PASS_STRUCTURAL_ONLY
NEXT_ACTION: close the G9 gap by exercising the AUTHORIZATION call site inside the extension host (see below), then re-run G9.3/G9.4/G9.5 with the real model.
REOPEN_CONDITION: any change to apps/vscode/src/sdk/cline-session-factory.ts's adjudication block, to the adjudication-task-contract store's arm/consume discipline, or to the SDK's adjudication-continuity.ts / compaction.ts.
```

## Why `SUBJECT_HEAD` equals `ENTRY_HEAD`

The ACT's production delta is present in the WORKING TREE and is fully
qualified by executable evidence, but the ACT was stopped before a commit
was created. `FINAL_HEAD` therefore equals `ENTRY_HEAD`. The qualified
artifact is the VSIX built from that working tree, and its bundle SHA-256
(`ab9bb821…`) is the authoritative identity of the qualified code.

## NEXT_ACTION — the precise remaining step

The G9 gap is narrow and exactly located. The installed-live run needs the
task-scoped contract to be ARMED inside the extension host before the task
starts. The arming call site is the host-authority seam:

```ts
getAdjudicationTaskContractStore().arm({ vocabulary: <authorized vocabulary> })
```

A follow-up ACT should:

1. expose that arming call to the harness (a debug-only, `DEFAULT_OFF`,
   `EXPLICIT_OPT_IN`, `REMOVABLE` hook at the host seam — the same shape as
   the existing `installRoundcLatencyTraceSink` seam), OR ship the user-facing
   authorization surface;
2. re-run G9.3 with the real provider to observe an accepted candidate;
3. re-run G9.4 with a live compaction;
4. re-run G9.5 with a real extension-host restart.

Nothing about the MECHANISM needs to change: the installed bundle already
carries the producer wiring, the resolver, the secret provider and the
consumption point.

## What this ACT does NOT claim

- It does NOT claim that the feature is installed in the live `codium-roz`
  profile. It is NOT: the profile still carries the pre-ACT build, and the
  live verification was done on a COPY so the known-good install and its
  rollback path stay intact.
- It does NOT claim a live accepted candidate, a live compaction boundary,
  or a live extension-host restart.
- It does NOT claim any behavioural improvement for Round C.
- It does NOT claim that Round C can use the feature as it stands today: its
  source observations were `run_commands`, and there is no authorized R1-R10
  vocabulary.
