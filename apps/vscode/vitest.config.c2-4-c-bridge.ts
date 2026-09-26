/**
 * Companion vitest config for C2.4-C-CORRECTION01 bridge tests.
 *
 * The bridge test imports the REAL `LocalRuntimeHost` and
 * `FileSessionService` from `sdk/packages/core/src/...` via
 * `@cline-internal/core/...` aliases. This avoids:
 *   - the `@cline/core` bundle minifier name-collision
 *   - the `apps/vscode/vitest.config.ts` `@cline/core` stub alias
 *
 * The base config is modified only to exclude this bridge from
 * its alias-incompatible test stream; the dedicated bridge
 * configuration owns execution of this test. The bridge runs via
 * `bun run vitest --config vitest.config.c2-4-c-bridge.ts`. The
 * base config continues to run all 18 existing C2.4-B and
 * earlier witness files.
 *
 * NOTE: `setupFiles` is intentionally omitted. The base
 * `src/test/vitest-setup.ts` calls `resetModelsFileState`, which
 * depends on the model-catalog stub aliases. The bridge test
 * does not need those stubs (it uses the real `LocalRuntimeHost`).
 */
import path from "node:path"
import { defineConfig } from "vitest/config"

const repoRoot = path.resolve(__dirname, "../..")
const sdkCoreRoot = path.resolve(repoRoot, "sdk/packages/core/src")
const sdkCoreHost = path.resolve(sdkCoreRoot, "runtime/host/local-runtime-host")
const sdkCoreSessionService = path.resolve(sdkCoreRoot, "session/services/file-session-service")
const sdkCoreTypesEvents = path.resolve(sdkCoreRoot, "types/events")
const sdkCoreAgentMessageCodec = path.resolve(sdkCoreRoot, "runtime/config/agent-message-codec")
const sdkCoreSessionRuntimeOrchestrator = path.resolve(sdkCoreRoot, "runtime/orchestration/session-runtime-orchestrator")
// ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01
// (seventy-seventh-pass, CORRECTION02 real-producer-witness):
// resolves to the REAL `createContextCompactionPrepareTurn`
// factory so the bridge test can drive the FULL COMPOSITION
// (real factory -> real CoreCompactionResult -> real
// compactSessionMessages -> explicit W estimate) without
// the `@cline/core` bundle minifier name-collision or the
// apps/vscode base-config `@cline/core` stub alias.
const sdkCoreContextCompaction = path.resolve(sdkCoreRoot, "extensions/context/compaction")
const appsVscodeRoot = path.resolve(__dirname)

export default defineConfig({
	test: {
		environment: "node",
		// Only the bridge test files. The base config does not
		// include these (and the bridge config does not include
		// the base tests), so the two streams are isolated.
		include: [
			"src/sdk/__tests__/real-local-to-shadow-bridge.c24-c-correction01.test.ts",
			"src/sdk/__tests__/acl02-runtime-seam.c24-c-bridge.test.ts",
			"src/sdk/__tests__/async-command-ownership-discriminator.aco01.c24-c-bridge.test.ts",
			"src/sdk/__tests__/async-command-ownership-discriminator.aco01-correction03.c24-c-bridge.test.ts",
			"src/sdk/__tests__/application-ownership-projection-coherence.aopc01.c24-c-bridge.test.ts",
			"src/sdk/__tests__/application-ownership-projection-coherence.aopc02.c24-c-bridge.test.ts",
			"src/sdk/__tests__/application-ownership-projection-coherence.aopc02-phase-a-correction01.c24-c-bridge.test.ts",
			"src/sdk/__tests__/application-ownership-projection-coherence.aopc02-phase-a-correction02.c24-c-bridge.test.ts",
			"src/sdk/__tests__/application-ownership-projection-coherence.aopc02-phase-a-correction03.c24-c-bridge.test.ts",
			// ACT-CLINEMM-APPLICATION-OWNERSHIP-CONTROL-COHERENCE01 / AOC02
			// §3: REAL SdkController producer-object discriminator. Uses
			// the same harness shape as AOPC02 PHASE-A-CORRECTION02 but
			// with FOUR captures (initial/active/waiting/post-clear) and
			// real canonical waiting -> idle via controller.clearTask().
			"src/sdk/__tests__/application-ownership-control-coherence.aoc02.c24-c-bridge.test.ts",
			// ACT-CLINEMM-SKIPPED-COMMAND-HOST-RECOVERY01-RESUME01 / SCHR01:
			// the host-layer causal discriminator drives the REAL
			// `LocalRuntimeHost` (production class via the
			// `@cline-internal/core/runtime/host/local-runtime-host`
			// alias) with a stub agent whose chronology mirrors the
			// SCTR01 GREEN AgentRuntime rejection outcome. It runs under
			// `vitest.config.c2-4-c-bridge.ts`.
			"src/sdk/__tests__/skipped-command-host-recovery.schr01.test.ts",
			// ACT-CLINEMM-SKIPPED-COMMAND-HOST-RECOVERY01-COMPOSITION01 / SHRC01:
			// the real composition discriminator: REAL LocalRuntimeHost
			// + REAL SessionRuntime + REAL AgentRuntime. The only seams
			// are the scripted model, the simulated user approval, and
			// the tool's `execute` mock. Closes the load-bearing P1 gap
			// from the SCHR01 review: that ACT proved the host's generic
			// post-completed-`AgentResult` finalization, but did NOT
			// exercise the real AgentRuntime inside the host.
			"src/sdk/__tests__/skipped-command-host-recovery.shrc01.test.ts",
			// ACT-CLINEMM-SW-CM04-CONTINUATION-PATHOLOGICAL-CORPUS01 BOUNDED CORRECTION:
			// real LocalRuntimeHost + real PendingPromptsController +
			// real drain + real runTurn re-entry. The companion
			// file (`continuation-pathological-corpus01.swcm04.test.ts`)
			// drives the completion-barrier boundary with a simulated
			// queue; this bridge file drives the queue-mechanics
			// scenarios (P3, P5, P6, A, B) against the real
			// production classes per HALT_PRODUCTION_SEAM_NOT_EXERCISED.
			"src/sdk/__tests__/continuation-pathological-corpus01.swcm04.c24-c-bridge.test.ts",
			// ACT-CLINEMM-QUEUED-PROMPT-STOP-RESUME-INTEGRITY01 / QPSR01:
			// real LocalRuntimeHost + real PendingPromptsController +
			// real FileSessionService + real SessionVersioningService;
			// synthetic stub agent (counter-backed run/continue/abort).
			// Discriminator for upstream `cline/cline#12975` —
			// Stop/Resume must not replay already-completed work.
			"src/sdk/__tests__/queued-prompt-stop-resume-integrity.qpsr01.c24-c-bridge.test.ts",
			// ACT-CLINEMM-BACKGROUND-COMMAND-NOTIFY-ON-TERMINAL01 / BCNT01:
			// Real production wire proof — drives the full
			// chain `coordinator.enqueueTerminalWake
			// -> sdkHost.send({ delivery: "queue" })
			// -> LocalRuntimeHost.runTurn
			// -> PendingPromptsController.enqueue`
			// and verifies the wake appears in
			// `host.pendingPrompts.list({sessionId})`.
			"src/sdk/__tests__/background-command-notify-on-terminal01.bcnt01-wire.c24-c-bridge.test.ts",
			// ACT-CLINEMM-BACKGROUND-COMMAND-NOTIFY-ON-TERMINAL01 / CORRECTION03:
			// real production SdkController callback factory witness.
			// Drives the actual
			// exported by  (the same factory the
			// Controller constructor calls). Closes the reviewer HALT
			// P0_REAL_SDKCONTROLLER_CALLBACK.
			"src/sdk/__tests__/background-command-notify-on-terminal01.bcnt01-wire-03-real-callback.c24-c-bridge.test.ts",
			// ACT-CLINEMM-TASK-INTERACTION-OWNERSHIP-PROJECTION01-RUNTIME-SHADOW-REACTIVATION01
			// / RSR01: production-seam RED at the canonical runtime-event ↔
			// shadow reactivation boundary. Real LocalRuntimeHost +
			// per-call fresh stub agent (resume creates a new agent) +
			// real TaskShadowHostWiring + real
			// subscribeCanonicalRuntimeEventsToShadow.
			"src/sdk/__tests__/runtime-shadow-reactivation.rsr01.test.ts",
			// ACT-CLINEMM-TASK-INTERACTION-OWNERSHIP-PROJECTION01-RUNTIME-SHADOW-REACTIVATION01-CORRECTION01
			// / RSR01-CORRECTION01: production-source RED at the reinit
			// attachment seam. Verifies the actual production body of
			// `attachCanonicalRuntimeEventSubscription` and
			// `reinitExistingTaskFromId` (extracted via brace-matching,
			// executed via `new Function(body)`) reaches the canonical
			// subscription with the correct (sdkHost, wiring, sessionId)
			// triple when the `sessionId === taskId` fence passes, and
			// skips when it fails. DOES NOT call
			// `subscribeCanonicalRuntimeEventsToShadow` on behalf of
			// production; production must earn the call.
			"src/sdk/__tests__/runtime-shadow-reactivation.rsr01-correction01.test.ts",
			// ACT-CLINEMM-FOLLOWUP-RESUME-SUBSCRIPTION-PARITY01 / FRSP01:
			// Phase 1 behavioral RED at the production follow-up resume
			// seam. Real LocalRuntimeHost + per-call fresh stub agent +
			// real SdkFollowupCoordinator + real
			// CanonicalRuntimeShadowSubscription. Drives
			// `coordinator.tryResumeSessionFromTask(task, prompt)` for
			// the SAME sessionId (not a manual re-attach); observes
			// whether the new agent's events reach the shadow. RED
			// confirms D2c_PATH_ASYMMETRY behaviorally. GREEN means
			// HALT_RED_NOT_REPRODUCED.
			"src/sdk/__tests__/runtime-followup-resume-subscription-parity.frsp01.test.ts",
			// ACT-CLINEMM-FOLLOWUP-RESUME-SUBSCRIPTION-PARITY01-CORRECTION01
			// / FRSP01-CORRECTION01: Phase 3 bounded repair +
			// Phase 4 ablation + Phase 5 conservation. Same harness as
			// FRSP01, but with the new `onCanonicalRuntimeRebind`
			// callback option injected to mimic production's
			// SdkController wiring. W1 (REPAIR GREEN), W2 (ABLATION
			// RED-shape restored), W3 (negative conservation: supersession
			// does NOT fire rebind), W4 (supersession conservation: rebind
			// resolves active session at call time), W5 (callback
			// called exactly once per successful resume).
			"src/sdk/__tests__/runtime-followup-resume-subscription-parity.frsp01-correction01.test.ts",
			// ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01
			// (seventy-seventh-pass, CORRECTION02 real-producer-witness):
			// full-composition witness — REAL factory + REAL
			// `compactSessionMessages` + REAL W estimator. The
			// base config cannot host this test because the
			// `@cline/core` alias points at the stub.
			"src/sdk/__tests__/sdk-compaction-w-publish-red01-real-producer.test.ts",
			// ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01-R1A-RED01
			// / PIIF01: real-production-seam DIAGNOSTIC current-seam
			// witness (reclassified ninety-sixth pass per eighth
			// reviewer). Drives the REAL LocalRuntimeHost.startSession
			// and the REAL SdkProviderChangeCoordinator
			// .handleApiConfigurationChanged; asserts that the
			// running session retains A's connection fields after a
			// same-provider coordinator mutation (because the
			// coordinator early-returns at line 48-50). This is a
			// diagnostic witness, NOT the GREEN contract. The base
			// config cannot host this test because the `@cline/core`
			// alias points at the stub (no LocalRuntimeHost).
			"src/sdk/__tests__/provider-instance-identity-r1a-red.piif01.test.ts",
			// ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01-R2-STRATEGY-B
			// / PIIF01 (ninety-sixth pass, R2 GREEN contract): drives
			// the new SdkProviderChangeCoordinator
			// .applyProviderConfigurationInstance (the explicit
			// instance-apply seam added in this pass) and asserts
			// the Strategy B contract: explicit A→B apply ⇒
			// full reconstruction ⇒ resulting connection == B.
			// Same bridge alias requirement as the R1a witness.
			"src/sdk/__tests__/provider-instance-identity-r2-strategy-b.piif01.test.ts",
			// ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-FOUNDATION01-R2P / PIIF01
			// (ninety-eighth pass, R2p real-projector characterization):
			// drives the REAL SdkSessionConfigBuilder.build +
			// REAL applyProviderConfigurationInstanceToConfig chain
			// against controlled baselines. Closes the tenth
			// reviewer's HALT_R2_REAL_PROJECTION_NOT_PROVEN. Stubs
			// only the underlying buildSessionConfig (returns
			// baseline A) and buildAgentHooks (no-op). Imports from
			// `@cline/core`, `@shared/api`, `@shared/storage/types`,
			// and `../sdk-session-config-builder` — all already
			// aliased by the bridge config.
			"src/sdk/__tests__/provider-instance-identity-r2p-real-projector.piif01.test.ts",
			// ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-IMPLEMENTATION01 / R3-R5
			// (persistence phase): instance-store contract + typed
			// projector. Placed in the bridge config because the
			// base config's @cline/core stub alias strips zod (a
			// pre-existing infra issue surfaced by the eleventh
			// reviewer); the bridge config has the aliases needed
			// to exercise the REAL typed projector end-to-end.
			"src/sdk/instance-store/instances-store.test.ts",
			"src/sdk/instance-store/typed-projector.test.ts",
			// ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-IMPLEMENTATION01 / R5
			// (thirteenth-reviewer halt witness,
			// HALT_MISSING_INSTANCE_SECRET_FAILS_OPEN):
			// drives the REAL SdkSessionConfigBuilder.build() with
			// providerConfigurationInstanceTyped. Asserts that
			// getInstanceSecret returning undefined => builder
			// REJECTS with MissingProviderInstanceCredentialError,
			// NOT silently projects cfg.apiKey=null. Closes the
			// P0 halt the thirteenth reviewer raised on
			// fa61ff5be (the previous R5-06 test froze the
			// wrong invariant).
			"src/sdk/__tests__/provider-instance-identity-r5-missing-credential-fails-closed.piif01.test.ts",
			// ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-IMPLEMENTATION01 / R4
			// (instance-secret namespace): placed in the bridge
			// config alongside R3 / R5 for consistency with the
			// recon-phase pre-existing infra quirk.
			"src/shared/storage/__tests__/instance-secret.test.ts",
			// ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-IMPLEMENTATION01 / R4
			// (durable): real StateManager.setInstanceSecret /
			// getInstanceSecret / flushPendingState roundtrip on
			// disk. Twelfth reviewer
			// HALT_TYPED_INSTANCE_CREDENTIAL_NOT_RESOLVED, follow-on
			// P1: the prior R4 suite exercised the schema but not
			// the durable layer.
			"src/core/storage/__tests__/state-manager-instance-secret-durable.test.ts",
			// ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-IMPLEMENTATION01 / R-REPLACE
			// (fourteenth-reviewer C1 "GO TO R-REPLACE"): drives the
			// REAL SdkSessionConfigBuilder.build() + REAL
			// SdkSessionLifecycle.replaceActiveSession composition.
			// 4 witnesses:
			//   R_REPLACE_POSITIVE — composed A → B through the
			//     real lifecycle installs B and tears down A;
			//     COMPLETE_V1_CONNECTION_AT_HOST_START — the full
			//     B tuple (apiKey, baseUrl, headers, providerId,
			//     modelId) crosses the lifecycle boundary into
			//     sdkHost.start, asserting the second mock call
			//     arguments (this pass's predecessor reviewer
			//     flagged the prior positive witness only
			//     asserted { providerId, modelId } at the
			//     lifecycle layer).
			//   R_REPLACE_NEGATIVE_MISSING_CREDENTIAL — the builder
			//     throws MissingProviderInstanceCredentialError
			//     BEFORE replaceActiveSession; the lifecycle's
			//     active session is the SAME object reference as
			//     before the attempt (extends the R5 builder-level
			//     witness to the lifecycle seam — closes the
			//     reviewer-required "active session remains
			//     unchanged" invariant).
			//   R_REPLACE_RUNNING_SESSION_REFUSAL — replaceActiveSession
			//     returns undefined while isRunning=true; no
			//     replacement attempt reaches host.start.
			//   R_REPLACE_CONSERVATION_MODEL_ONLY — same-instance
			//     model swap (A.modelId A1 → A2) goes through
			//     updateActiveSessionModel (no host.start, no
			//     replacement) — pins the fast-lane conservation.
			"src/sdk/__tests__/provider-instance-identity-r-replace-real-lifecycle.piif01.test.ts",
			// ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-IMPLEMENTATION01 / R4-RR
			// (fifteenth reviewer, C1 "GO TO FOUNDATION FINAL
			// QUALIFICATION", this pass): persisted instance-secret
			// RELOAD witness. Closes R4_RELOAD_READ that has been
			// carried as P1 for several passes. Tests the lowest
			// production reload seam BENEATH the StateManager
			// singleton: a fresh `ClineFileStorage` constructed
			// from the same secrets.json disk path that
			// createStorageContext() would use on restart, sweeping
			// `keys()` exactly the way StateManager.populateCache()
			// does. 4 witnesses:
			//   R4-RR-01 — on-disk secrets.json contains the
			//     entry under the namespaced key matching
			//     INSTANCE_SECRET_NAME_PATTERN.
			//   R4-RR-02 — fresh ClineFileStorage from the same
			//     path returns the physical secret via .get(name).
			//   R4-RR-03 — the full credential-resolution chain
			//     survives a restart: opaque reference name still
			//     resolves to the physical secret value.
			//   R4-RR-04 — deletion survives reload:
			//     setInstanceSecret(name, undefined) -> flush ->
			//     reloaded store no longer has the key.
			"src/sdk/__tests__/provider-instance-identity-r4-reload-read.piif01.test.ts",
			// ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01 / Phase A
			// (Profile domain/store): real ProfilesStore + real
			// parseProfilesFile + real parseModelProfile. No SDK
			// collaboration — pure local-fs tests. Lives here for
			// consistency with the PIIF01 R3 / R4 / R5 tests, which
			// also import `@/shared/storage/instance-secret` and
			// cannot be reached under the base config's
			// `@cline/core` stub alias.
			"src/sdk/__tests__/model-profiles-store.mpqs01.test.ts",
			// ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01 / Phase B
			// (session/default binding): pure binding-logic tests
			// over the canonical HistoryItem.activeProfileId seam
			// + global default key. Lives in the bridge config for
			// the same reason as Phase A (the test transitively
			// pulls in @/shared/storage/instance-secret through
			// future callers; keeping it here avoids config drift).
			"src/sdk/__tests__/model-profile-session-binding.mpqs01.test.ts",
			// ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01 / Phase C
			// (application coordinator): drives REAL applyModelProfile
			// + REAL ProfilesStore; collaborators (sessions,
			// providerChange, writeTaskHistoryItem) are synthetic.
			"src/sdk/__tests__/model-profile-application.mpqs01.test.ts",
			// ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01 / Phase D
			// (webview summary projection): real projection +
			// sentinel scan; synthetic readInstance.
			"src/sdk/__tests__/model-profile-webview-summary.mpqs01.test.ts",
			// ACT-CLINEMM-MODEL-PROFILES-QUICK-SWITCH-IMPLEMENTATION01 / MP-C1
			// (typed-foundation composition witness): drives the REAL
			// applyModelProfile → REAL SdkProviderChangeCoordinator.
			// applyTypedProviderConfigurationInstance → REAL builder
			// with `providerConfigurationInstanceTyped` → REAL typed
			// projector → REAL SdkSessionLifecycle.replaceActiveSession.
			// Closes the sixteenth reviewer's halt
			// `HALT_TYPED_INSTANCE_FOUNDATION_BYPASSED_BY_PRODUCT_APPLY`.
			"src/sdk/__tests__/model-profile-composition.mpqs01.test.ts",
			// ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01:
			// Production reachability witnesses. The RPC-seam test
			// exercises the generated protobus handlers against a
			// fake Controller; the lifecycle-composition test
			// exercises the precedence-algebraic helpers that the
			// `cline-session-factory` will consume.
			"src/sdk/__tests__/model-profile-rpc-seam.mpw01.test.ts",
			"src/sdk/__tests__/model-profile-lifecycle-composition.mpw01.test.ts",
			// ACT-CLINEMM-MODEL-PROFILES-PRODUCTION-WIRING01-CORRECTION01:
			// Real factory integration witnesses (P0-3 closes here).
			// C4 drives the REAL SdkSessionConfigBuilder with
			// `providerConfigurationInstanceTyped` and asserts the
			// effective tuple matches the resolved profile.
			"src/sdk/__tests__/save-current-identity-inversion.mpwc01.test.ts",
			"src/sdk/__tests__/factory-resume-effective-connection.mpwc01.test.ts",
			"src/sdk/__tests__/bound-profile-missing-instance.mpwc02.test.ts",
			// ACT-CLINEMM-CONTINUATION-CARDINALITY-CORRELATION-LOSS01 /
			// CCCL01: bounded RED discriminator for the live
			// qualification P4 failure. Drives the REAL
			// `BackgroundNotifyCoordinator.consumeTerminal` ->
			// REAL `buildSdkControllerEnqueueTerminalWake` ->
			// REAL `sdkHost.send` chain with a unique sentinel
			// jobId. PRE-FIX this assertion FAILS because the
			// enqueueTerminalWake callback contract at
			// `background-notify-coordinator.ts:281` does NOT
			// carry jobId.
			"src/sdk/__tests__/continuation-cardinality-correlation-loss01.cccl01.c24-c-bridge.test.ts",
			// ACT-CLINEMM-CONTINUATION-CARDINALITY-CORRELATION-LOSS01 /
			// CCCL01-E2E: end-to-end REAL-host sentinel witness
			// closing the FACTORY reviewer gap on
			// HALT_CORRELATION_END_TO_END_NOT_PROVEN. Drives the
			// REAL LocalRuntimeHost with real capture hooks and
			// asserts the same SENTINEL jobId is observed at
			// C4 (onEnqueue), C5 (onBeforeDrain), C6
			// (onBeforeDispatch), C7 (onRunTurnStarted), C8
			// (onAgentTurnDone) -- i.e. from
			// PendingPromptsController.enqueue all the way
			// through drain and the agent_turn_done capture
			// fires -- with no manufactured cardinality growth
			// and an empty queue at settle.
			"src/sdk/__tests__/continuation-cardinality-correlation-loss01.cccl01-e2e-real-host.c24-c-bridge.test.ts",
		],
		testTimeout: 30_000,
	},
	resolve: {
		alias: {
			"@cline-internal/core/runtime/host/local-runtime-host": sdkCoreHost,
			"@cline-internal/core/session/services/file-session-service": sdkCoreSessionService,
			"@cline-internal/core/types/events": sdkCoreTypesEvents,
			"@cline-internal/core/runtime/config/agent-message-codec": sdkCoreAgentMessageCodec,
			// ACT-CLINEMM-SKIPPED-COMMAND-HOST-RECOVERY01-COMPOSITION01 / SHRC01:
			// resolves to the REAL SessionRuntime orchestrator class
			// (sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts).
			"@cline-internal/core/runtime/orchestration/session-runtime-orchestrator": sdkCoreSessionRuntimeOrchestrator,
			// ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01
			// (seventy-seventh-pass, CORRECTION02 real-producer-witness):
			// real `createContextCompactionPrepareTurn` factory,
			// bypassing the `@cline/core` stub alias and the
			// minifier name-collision in the bundled dist.
			"@cline-internal/core/extensions/context/compaction": sdkCoreContextCompaction,
			// Apps/vscode alias surface needed by AOPC02 PHASE-A-CORRECTION01
			// to construct a real Controller via vi.mock on the heavy deps.
			// Same path resolution as the base apps/vscode/vitest.config.ts.
			vscode: path.resolve(appsVscodeRoot, "src/test/vscode-vitest-stub.ts"),
			"@": path.resolve(appsVscodeRoot, "src"),
			"@api": path.resolve(appsVscodeRoot, "src/core/api"),
			"@core": path.resolve(appsVscodeRoot, "src/core"),
			"@generated": path.resolve(appsVscodeRoot, "src/generated"),
			"@hosts": path.resolve(appsVscodeRoot, "src/hosts"),
			"@integrations": path.resolve(appsVscodeRoot, "src/integrations"),
			"@services": path.resolve(appsVscodeRoot, "src/services"),
			"@shared/proto/cline/common": path.resolve(appsVscodeRoot, "src/shared/proto/cline/common.ts"),
			"@shared/proto/cline/models": path.resolve(appsVscodeRoot, "src/shared/proto/cline/models.ts"),
			"@shared/proto": path.resolve(appsVscodeRoot, "src/shared/proto"),
			"@shared": path.resolve(appsVscodeRoot, "src/shared"),
			"@utils": path.resolve(appsVscodeRoot, "src/utils"),
			"@packages": path.resolve(appsVscodeRoot, "src/packages"),
		},
	},
	server: {
		fs: {
			allow: [path.resolve(__dirname), repoRoot, sdkCoreRoot],
		},
	},
})
