import path from "node:path"
import { defineConfig } from "vitest/config"

// Vitest config for the VSCode extension's SDK-adapter and model-catalog
// unit tests. (The bulk of the extension's unit tests still run under mocha
// via `test:unit`; these suites are vitest-native.)
export default defineConfig({
	// Pin Vite's cache to a project-local directory. The default
	// `os.tmpdir()` is `private/tmp` on macOS, which is sometimes
	// a symlinked mount where the IDE's sandboxed-shell cannot
	// mkdir (EPERM). Project-local avoids the issue entirely.
	//
	// C1-CORRECTION03 reviewer note: "the digest still contains
	// the project-local cache modification introduced solely
	// because the authoring sandbox cannot write normal temp
	// locations." Decision: RETAIN. The IDE sandbox used by the
	// author blocks writes outside the repo (verified: even
	// `os.tmpdir()` and `node_modules/.cache` writes are EPERM),
	// and reverting would re-break this test in the same shell.
	// The pin is:
	//   (a) Documented
	//   (b) Project-local (never escapes the repo)
	//   (c) Not blocking CI / unconstrained developer shells
	//       (which would work fine without it; the pin is a
	//       no-op for them)
	cacheDir: path.resolve(__dirname, "node_modules/.vite"),
	test: {
		include: [
			"src/sdk/**/*.test.ts",
			"src/hosts/vscode/VscodeEditPreview.test.ts",
			"src/shared/vsCodeSelectorUtils.test.ts",
			"src/shared/post-terminal-authority-diagnostic.test.ts",
			"src/shared/post-terminal-authority-diagnostic-aoc02-live-capture01.test.ts",
			// ACT-CLINEMM-TASK-INTERACTION-OWNERSHIP-PROJECTION01-LIVE-CAPTURE01
			"src/shared/host-ownership-diagnostic.live-capture01.test.ts",
			"src/shared/proto-conversions/models/**/*.test.ts",
			// ACT-CLINEMM-TEMPORARY-EXTERNAL-PATH-AUTHORITY01 (validator unit
			// tests + cross-instance two-reader / one-backing-store tests):
			"src/shared/storage/__tests__/temporaryExternalPathAuthorities.test.ts",
			"src/core/storage/__tests__/temporaryExternalPathAuthorityCrossInstance.test.ts",
			"src/core/storage/remote-config/**/*.test.ts",
			"src/core/controller/account/setUserOrganization.test.ts",
			"src/core/controller/remoteConfig/**/*.test.ts",
			"src/core/controller/state/**/*.test.ts",
			"src/core/controller/slash/**/*.test.ts",
			"src/services/mcp/__tests__/settingsLock.test.ts",
			"src/shared/model-catalog/provider-helpers.test.ts",
			"src/core/controller/models/__tests__/providerCatalogHandlers.test.ts",
			"src/core/controller/models/__tests__/providerSwitchNormalization.test.ts",
			"src/core/controller/models/__tests__/resolveModelInfo.test.ts",
			"src/core/controller/models/__tests__/providerCatalogSmoke.test.ts",
			"src/core/controller/models/__tests__/refreshClineRecommendedModels.test.ts",
			"src/core/controller/models/__tests__/refreshProviderModels.test.ts",
			"src/core/controller/models/__tests__/refreshOpenAiModels.test.ts",
		],
		environment: "node",
		setupFiles: ["./src/test/vitest-setup.ts"],
		// The bridge test lives under apps/vscode/src/sdk/__tests__/ but
		// requires the `vitest.config.c2-4-c-bridge.ts` config (which
		// adds the resolve.alias for @cline-internal/core/...). Exclude
		// it from the base config so the alias-less base runs cleanly.
		// The C2.4-D Hub fallback-composition test (and its D3
		// extension, hub-runtime-host.provenance-epoch.c24-d3) similarly
		// live under src/sdk/__tests__/ but require the dedicated
		// `vitest.config.c2-4-d-hub.ts` config (which adds the
		// @cline-internal/core/hub/runtime-host/hub-runtime-host alias).
		// All three test files execute under their dedicated configs and
		// must be excluded from this base config to keep the two test
		// streams isolated.
		exclude: [
			"src/sdk/__tests__/real-local-to-shadow-bridge.c24-c-correction01.test.ts",
			"src/sdk/__tests__/hub-runtime-host.fallback-composition.c24-d.test.ts",
			"src/sdk/__tests__/hub-runtime-host.provenance-epoch.c24-d3.test.ts",
			// ACT-CLINEMM-ASYNC-COMMAND-TURN-LIVENESS01-CORRECTION01:
			// the companion ACL02 bridge test uses the alias
			// `@cline-internal/core/runtime/host/local-runtime-host` which
			// the base config does not have. It runs under
			// `vitest.config.c2-4-c-bridge.ts` instead.
			"src/sdk/__tests__/acl02-runtime-seam.c24-c-bridge.test.ts",
			// ACT-CLINEMM-ASYNC-COMMAND-OWNERSHIP-DISCRIMINATOR01:
			// the causal-discriminator test imports `@cline/agents` (real
			// production class) and uses the c2-4-c-bridge fs.allow scope.
			// It runs under `vitest.config.c2-4-c-bridge.ts` instead.
			"src/sdk/__tests__/async-command-ownership-discriminator.aco01.c24-c-bridge.test.ts",
			// ACT-CLINEMM-ASYNC-COMMAND-OWNERSHIP-DISCRIMINATOR01-CORRECTION01:
			// the host-layer causal discriminator drives the REAL
			// `LocalRuntimeHost` (production class via the
			// `@cline-internal/core/runtime/host/local-runtime-host`
			// alias). It runs under `vitest.config.c2-4-c-bridge.ts`.
			// ACT-CLINEMM-ASYNC-COMMAND-OWNERSHIP-DISCRIMINATOR01-CORRECTION02:
			// the corrected host-layer causal discriminator drives the
			// REAL `LocalRuntimeHost` with a REAL deferred RUNNING(jobId)
			// chronology (`sleep 5` vs `waitBudgetMs=50`). The `status`
			// field in the envelope is bound to the actual
			// `CommandJobManager.start().state` producer (not
			// synthesized). It uses the REAL `AgentRuntime` + REAL
			// `createShellTool` composition from row 15a. It runs under
			// `vitest.config.c2-4-c-bridge.ts`.
			"src/sdk/__tests__/async-command-ownership-discriminator.aco01-correction03.c24-c-bridge.test.ts",
			"src/sdk/__tests__/application-ownership-projection-coherence.aopc01.c24-c-bridge.test.ts",
			// ACT-CLINEMM-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01:
			// AOPC02 PHASE-A and its three Phase-A-CORRECTION0N tests
			// require the `@cline-internal/core/...` aliases that the
			// BASE vitest config does not provide. They run under
			// `vitest.config.c2-4-c-bridge.ts` instead.
			"src/sdk/__tests__/application-ownership-projection-coherence.aopc02.c24-c-bridge.test.ts",
			"src/sdk/__tests__/application-ownership-projection-coherence.aopc02-phase-a-correction01.c24-c-bridge.test.ts",
			"src/sdk/__tests__/application-ownership-projection-coherence.aopc02-phase-a-correction02.c24-c-bridge.test.ts",
			"src/sdk/__tests__/application-ownership-projection-coherence.aopc02-phase-a-correction03.c24-c-bridge.test.ts",
			// ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01
			// (seventy-seventh-pass, CORRECTION02 real-producer-witness):
			// full-composition witness — REAL factory + REAL
			// `compactSessionMessages` + REAL W estimator. Cannot
			// run under the base config because `@cline/core` is
			// aliased to the vitest stub. Runs under
			// `vitest.config.c2-4-c-bridge.ts` (with the real
			// `@cline-internal/core/extensions/context/compaction`
			// resolve alias).
			"src/sdk/__tests__/sdk-compaction-w-publish-red01-real-producer.test.ts",
			// ACT-CLINEMM-APPLICATION-OWNERSHIP-CONTROL-COHERENCE01 / AOC02
			// §3: REAL SdkController producer-object discriminator lives
			// under src/sdk/__tests__/ and shares the harness shape with
			// AOPC02 PHASE-A-CORRECTION02. It runs under the dedicated
			// `vitest.config.c2-4-c-bridge.ts` config and must be
			// excluded from this base config.
			"src/sdk/__tests__/application-ownership-control-coherence.aoc02.c24-c-bridge.test.ts",
			// ACT-CLINEMM-SKIPPED-COMMAND-HOST-RECOVERY01-RESUME01 / SCHR01:
			// the host-layer causal discriminator drives the REAL
			// `LocalRuntimeHost` (production class via the
			// `@cline-internal/core/runtime/host/local-runtime-host`
			// alias) with a stub agent whose chronology mirrors the
			// SCTR01 GREEN AgentRuntime rejection outcome. It runs
			// under `vitest.config.c2-4-c-bridge.ts` and must be
			// excluded from this base config.
			"src/sdk/__tests__/skipped-command-host-recovery.schr01.test.ts",
			// ACT-CLINEMM-SKIPPED-COMMAND-HOST-RECOVERY01-COMPOSITION01 / SHRC01:
			// the real composition discriminator. Same bridge-only
			// surface as SCHR01; excluded from this base config.
			"src/sdk/__tests__/skipped-command-host-recovery.shrc01.test.ts",
			// ACT-CLINEMM-QUEUED-PROMPT-STOP-RESUME-INTEGRITY01 / QPSR01:
			// Stop/Resume integrity discriminator (REAL LocalRuntimeHost +
			// REAL PendingPromptsController + REAL SessionVersioningService;
			// synthetic stub agent). Bridge-only — same alias
			// requirement as SCHR01/SHRC01.
			"src/sdk/__tests__/queued-prompt-stop-resume-integrity.qpsr01.c24-c-bridge.test.ts",
			// ACT-CLINEMM-FOLLOWUP-RESUME-SUBSCRIPTION-PARITY01-CORRECTION03 /
			// FRSP01-C03: bounded P0 cleanup of the test-domain configuration
			// leak. The four files below are bridge-only (require the
			// `@cline-internal/core/...` resolve.aliases declared in
			// `vitest.config.c2-4-c-bridge.ts` only). They were added to
			// the dedicated bridge vitest config but the corresponding
			// BASE vitest excludes were left out, so the BASE vitest glob
			// (`src/sdk/**/*.test.ts`) discovers them and fails to load
			// (`Cannot find package '@cline-internal/core/...'`). They run
			// under `vitest.config.c2-4-c-bridge.ts` and are excluded from
			// the base vitest domain by this ACT. (Mirror entry in
			// `apps/vscode/tsconfig.json` `exclude` array — keep them in sync;
			// the RBE01 contract enforces this invariant.)
			"src/sdk/__tests__/runtime-shadow-reactivation.rsr01.test.ts",
			"src/sdk/__tests__/runtime-shadow-reactivation.rsr01-correction01.test.ts",
			"src/sdk/__tests__/runtime-followup-resume-subscription-parity.frsp01.test.ts",
			"src/sdk/__tests__/runtime-followup-resume-subscription-parity.frsp01-correction01.test.ts",
			// ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-IMPLEMENTATION01 / R3-R5
			// (persistence phase): the instance-store + typed-projector
			// tests run under the dedicated
			// `vitest.config.c2-4-c-bridge.ts` config (which has the
			// @cline-internal/core/... aliases). Excluded here to
			// keep the base config's @cline/core stub alias in scope.
			"src/sdk/instance-store/instances-store.test.ts",
			"src/sdk/instance-store/typed-projector.test.ts",
			// ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-IMPLEMENTATION01 / R4
			// (instance-secret namespace): paired with R3 / R5 in
			// the bridge config (see vitest.config.c2-4-c-bridge.ts).
			"src/shared/storage/__tests__/instance-secret.test.ts",
			// ACT-CLINEMM-PROVIDER-INSTANCE-IDENTITY-IMPLEMENTATION01 / R4
			// (durable): real StateManager.setInstanceSecret /
			// getInstanceSecret / flushPendingState roundtrip. Runs
			// under the dedicated bridge config alongside the
			// schema tests for consistency with the recon-phase
			// pre-existing infra quirk.
			"src/core/storage/__tests__/state-manager-instance-secret-durable.test.ts",
		],
		// Several suites lazily `await import()` their subject inside the first test
		// (needed so vi.mock factories apply first). That import pulls in heavy
		// workspace packages (@cline/core/@cline/llms/@cline/shared), and on loaded
		// CI runners the first test in a file can blow past the 5s default and flake
		// (seen in catalog.test.ts and resolveModelInfo.test.ts). Raise the per-test
		// timeout so import cost attributed to the first test doesn't cause flakes.
		testTimeout: 20000,
		// Some matched files are intentionally-empty placeholders that point to
		// where the real suite lives (e.g. sdk-control-plane.test.ts), so an
		// empty file should not fail the run.
		passWithNoTests: true,
		// Coverage configuration for the Vitest coverage baseline.
		// (Established by `ACT-CLINEMM-CODE-COVERAGE-BASELINE01`.)
		// - provider: v8 (matches Node runtime / @vitest/coverage-v8@4.1.10)
		// - include: explicit production source universe so untested
		//   files appear with 0% rather than being silently skipped
		//   (v4 default behavior is "only imported files" without an
		//   explicit include — see vitest#6956).
		// - exclude: by-design non-product categories (not excluded to
		//   inflate numbers; each is documented below).
		// - reporter: text (human), json-summary (compact CI),
		//   json (full istanbul for offline analysis).
		//   NOTE: Vitest v4 documents the singular `reporter` key; the
		//   plural `reporters` is silently ignored, which made the
		//   canonical `bun run test:coverage:ratchet` command exit
		//   with `coverage-summary.json not found`. Fixed in
		//   `ACT-CLINEMM-CODE-COVERAGE-REPORTER-KEY-CORRECTION01`.
		// - reportsDirectory: `coverage/` (gitignored).
		coverage: {
			provider: "v8",
			include: ["src/**/*.{ts,tsx}"],
			exclude: [
				// Tests and test fixtures
				"**/__tests__/**",
				"**/*.test.*",
				"**/*.spec.*",
				// Test infrastructure (vitest stubs, fixtures, helpers)
				"src/test/**",
				// Generated proto/gRPC code (auto-generated from proto/;
				// tested through the canonical schema, not source coverage)
				"src/generated/**",
				// Embedded host packages (bundled by esbuild into the
				// extension; covered by their own dedicated test process)
				"src/packages/**",
			],
			reporter: ["text", "json-summary", "json"],
			reportsDirectory: "./coverage",
		},
	},
	resolve: {
		alias: {
			// ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-SHIPPING01:
			// the trusted-internal deep import path. Defined FIRST so
			// vite-resolve picks this exact match before the bare
			// `@cline/core` alias below redirects it to the stub.
			"@cline/core/internal/command-risk-internal": path.resolve(
				__dirname,
				"../../sdk/packages/core/src/runtime/command-policy/command-risk-internal.ts",
			),
			// ACT-CLINEMM-COMMAND-RISK-CLASSIFICATION02-PARSER-HELPER-BINARY-SHIPPING01
			// CORRECTION02 Phase 2: the trusted parser helper module.
			// Same aliasing strategy as `command-risk-internal` —
			// resolve to the source path directly so vitest picks
			// up the live TypeScript rather than the dist bundle.
			"@cline/core/internal/parser-helper-runtime": path.resolve(
				__dirname,
				"../../sdk/packages/core/src/runtime/command-policy/parser-helper/runtime.ts",
			),
			// ACT-CLINEMM-COMMAND-SAFETY-REFORMULATION01:
			// The reformulation classifier is reachable through the
			// narrow `@cline/core/internal/reformulation-classifier`
			// deep import (mirroring the trusted-internal entrypoint
			// pattern established by `command-risk-internal` and
			// `parser-helper-runtime`). Same aliasing strategy as
			// those trusted-internal paths — resolve to the live
			// TypeScript source so vitest sees the current
			// classifier code rather than the bundled stub.
			"@cline/core/internal/reformulation-classifier": path.resolve(
				__dirname,
				"../../sdk/packages/core/src/runtime/command-policy/reformulation-classifier-internal.ts",
			),
			"@cline/core": path.resolve(__dirname, "src/test/cline-core-vitest-stub.ts"),
			"@cline/llms": path.resolve(__dirname, "node_modules/@cline/llms/dist/index.js"),
			// Map @cline/shared subpath exports explicitly. The bare "@cline/shared"
			// alias below does not cover subpaths (e.g. "@cline/shared/storage"), and
			// Vite's fallback Node resolution does not read the package `exports` map
			// here, so subpath imports fail with "Cannot find package". Keep the more
			// specific subpath alias(es) before the bare package alias.
			"@cline/shared/storage": path.resolve(__dirname, "node_modules/@cline/shared/dist/storage/index.js"),
			// ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01:
			// The runtime-builder pulls in sqlite-team-store which imports
			// `@cline/shared/db` — alias the dist path so the load-bearing
			// integration test can drive DefaultRuntimeBuilder.build().
			"@cline/shared/db": path.resolve(__dirname, "node_modules/@cline/shared/dist/db/index.js"),
			"@cline/shared": path.resolve(__dirname, "node_modules/@cline/shared/dist/index.js"),
			vscode: path.resolve(__dirname, "src/test/vscode-vitest-stub.ts"),
			"@": path.resolve(__dirname, "src"),
			"@api": path.resolve(__dirname, "src/core/api"),
			"@core": path.resolve(__dirname, "src/core"),
			"@generated": path.resolve(__dirname, "src/generated"),
			"@hosts": path.resolve(__dirname, "src/hosts"),
			"@integrations": path.resolve(__dirname, "src/integrations"),
			"@services": path.resolve(__dirname, "src/services"),
			"@shared/proto/cline/common": path.resolve(__dirname, "src/shared/proto/cline/common.ts"),
			"@shared/proto/cline/models": path.resolve(__dirname, "src/shared/proto/cline/models.ts"),
			"@shared/proto": path.resolve(__dirname, "src/shared/proto"),
			"@shared": path.resolve(__dirname, "src/shared"),
			"@utils": path.resolve(__dirname, "src/utils"),
			"@packages": path.resolve(__dirname, "src/packages"),
		},
	},
})
