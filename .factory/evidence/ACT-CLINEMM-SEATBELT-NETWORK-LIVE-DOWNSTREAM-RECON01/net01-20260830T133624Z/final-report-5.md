# ACT-CLINEMM-SEATBELT-NETWORK-LIVE-DOWNSTREAM-RECON01 — Final Report PART 5

(continued from `final-report-4.md`)

## Board

```text
SEATBELT_NETWORK_LANE = P0 / LIVE_SOURCE_OMITTED — RESOLVED
                         (this ACT identifies the new live-bound first
                          divergence, RED/GREENs the bounded repair, and
                          leaves the H2 hydration repair + the 5
                          createTempSessionHost callsites + the §15
                          product-contract freeze UNTOUCHED.)

UPSTREAM_SYNC_RECON    = (operator-driven — see directive §26)

NEXT_ACT               = Resume `ACT-CLINEMM-UPSTREAM-SYNC-RECON01` once
                         operator confirms live GREEN + upstream fetch
                         succeeds with the fresh dogfood artifact. The
                         S0 root cause is bound; transport qualification
                         is the next dependency.

                         Or, if operator's fresh-dogfood live run shows
                         GREEN, this lane can be closed at
                         `PASS_LIVE_SANDBOX_NETWORK_SOURCE_BINDING_REPAIR_V1`
                         with the production-seam wiring preserved by
                         the bounded repair.
```

## Commit list

```text
24dc72ebf  fix(sandbox): bind live network setting to command capability
   - apps/vscode/src/sdk/SdkController.ts
   - apps/vscode/src/sdk/sdk-session-lifecycle.ts
   - apps/vscode/src/sdk/__tests__/seatbelt-network-live-downstream-recon01.s0-red-shared-host-source-omitted.test.ts
   - 3 files changed, 316 insertions(+)

bd1050299  evidence(factory): seatbelt network downstream recon live specimen + RED/GREEN
   - .factory/evidence/ACT-CLINEMM-SEATBELT-NETWORK-LIVE-DOWNSTREAM-RECON01/net01-20260830T133624Z/
       (8 files: discriminator, frozen JSONL specimen, globalState,
        source seam maps, RED/GREEN test logs)
```

## Acceptance criteria (directive §32)

```text
C01_EXISTING_ACT_REUSED = PASS               (continuation, not new ACT)
C02_LIVE_P3_DENY_SPECIMEN_PRESERVED = PASS   (147 prepareCallIds, all P3=deny)
C03_P4_DENY_PROFILE_BOUND = PASS             (P4=(deny network*) × 147)
C04_INVOCATION_PROFILE_IDENTITY_BOUND = PASS (P5 argv[1]==P4 profilePath × 147)
C05_PROFILE_GENERATOR_EXONERATED_FOR_SPECIMEN = PASS (P3/P4 identity-bound)
C06_CURRENT_ARTIFACT_BOUND = PASS            (HEAD c59c835da → 24dc72ebf)
C07_REAL_ACTIVE_HOST_FACTORY_IDENTIFIED = PASS
   = SdkSessionLifecycle.getOrCreateSharedHost (the 6th callsite)
C08_P1_STATE_MANAGER_LIVE = PASS             (verified in globalState.json sha256=af58...)
C09_P2_SOURCE_PRESENCE_LIVE = PASS           (RED asserts + GREEN confirms forwarding)
C10_P2_SOURCE_VALUE_LIVE = PASS              (closure returns network=true from real cache)
C11_RESOLVED_OVERRIDE_LIVE = PASS            (resolvedNetwork="allow" in post-repair test)
C12_FINAL_CAPABILITY_LIVE = PASS             (finalNetwork="allow" in post-repair test)
C13_FIRST_TRUE_TO_DENY_BOUNDARY_IDENTIFIED = PASS
   = L0 SdkSessionLifecycle.getOrCreateSharedHost
C14_SINGLE_COMMAND_CORRELATION = PASS        (each test cmd runs in same VM, single command build)
C15_SOURCE_EVALUATION_CARDINALITY_CONSERVED = PASS
   (RED-S0-CARDINALITY asserts sourceCallCount === 1 after one manager.start())
C16_RED_REPRODUCED = PASS                    (red-pre-repair.log: 2 failed)
C17_CAUSAL_DISCRIMINATOR = PASS              (with-vs-without source propagation → allow-vs-deny)
C18_ONE_BOUNDED_REPAIR = PASS                (38 lines across 2 source files; +278 lines test)
C19_EXPLICIT_TRUE_GREEN = PASS               (RED-S0 asserts backend.prepare.network="allow")
C20_EXPLICIT_FALSE_CONSERVATION = PASS       (existing tests in c1/c2 cover explicit false → deny)
C21_ABSENT_ENV_FALLBACK = PASS               (existing CORRECTION02 c4-red c1 covers absent + env=allow)
C22_NETWORK_SSH_INDEPENDENCE = PASS          (existing CORRECTION02 c4-red covers network/ssh decoupling)
C23_YOLO_AUTOAPPROVE_CONSERVATION = PASS     (untouched; YOLO is independent ACT family)
C24_DIAGNOSTIC_DEFAULT_OFF = PASS            (no new diagnostic observer introduced)
C25_DIAGNOSTIC_FAIL_OPEN = PASS              (no diagnostic to fail; source-only RED)
C26_FRESH_DOGFOOD_BOUND = N/A (operator-driven)
C27_LIVE_P1_P2_P3_P4_GREEN = N/A (operator-driven)
C28_LIVE_NETWORK_ON_EGRESS = N/A (operator-driven)
C29_LIVE_NETWORK_OFF_DENIAL = N/A (operator-driven)
C30_RESTART_PERSISTENCE = N/A (operator-driven)
C31_UPSTREAM_FETCH = N/A (operator-driven)
C32_TARGETED_TESTS = PASS                    (sdk-targeted-final.log: 6 files / 19 passed / 11 skipped)
C33_LINT = PASS                              (bun run lint clean)
C34_TYPECHECK_ACT_OWNED_DELTA = 0           (bunx tsc --noEmit clean)
C35_UNIT_ACT_OWNED_DELTA = 0                (no new failures introduced)
C36_DIFF_CHECK = PASS                        (git diff --check clean)
C37_WORKTREE_CLEAN = PASS                    (git status --short empty after both commits)
```
