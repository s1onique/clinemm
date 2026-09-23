/**
 * Companion vitest config for the session-listing causal-diagnostic
 * test suite (ACT-CLINEMM-EXTENSION-HOST-SESSION-LISTING-ALLOCATION-CAUSALITY01).
 *
 * The base config aliases `@cline/core` to a stub file that does not
 * expose the session-listing sink surface. To exercise the REAL
 * sink (`session-listing-diagnostic-sink.ts`) without bumping the
 * stub, this config adds dedicated `@cline-internal/core/session/...`
 * aliases that point at the live SDK source — same strategy as
 * `vitest.config.c2-4-c-bridge.ts` for the load-bearing composition
 * tests.
 *
 * The base config is modified only to exclude this test from
 * its alias-incompatible test stream; the dedicated slac01
 * configuration owns execution of this test. The slac01 test
 * runs via `vitest --config vitest.config.slac01.ts`.
 */
import path from "node:path"
import { defineConfig } from "vitest/config"

const repoRoot = path.resolve(__dirname, "../..")
const sdkCoreRoot = path.resolve(repoRoot, "sdk/packages/core/src")
const sdkCoreSink = path.resolve(sdkCoreRoot, "session/services/session-listing-diagnostic-sink")
const appsVscodeRoot = path.resolve(__dirname)

export default defineConfig({
	test: {
		environment: "node",
		// Only the slac01 test file. The base config continues to
		// run all other vitest-native tests; the slac01 config
		// owns this one.
		include: ["src/sdk/__tests__/session-listing-allocation-causality01.slac01.test.ts"],
		resolve: {
			alias: {
				// ACT-CLINEMM-EXTENSION-HOST-SESSION-LISTING-ALLOCATION-CAUSALITY01:
				// Redirect every `@cline/core` import to the live SDK source
				// so the SLAC01 suite can drive the real production sink
				// interface (which the @cline/core stub does NOT expose).
				// The c2-4-c-bridge config follows the same pattern.
				"@cline/core": path.resolve(appsVscodeRoot, "../../sdk/packages/core/src/index.ts"),
				"@cline-internal/core/session/services/session-listing-diagnostic-sink": path.resolve(
					repoRoot,
					"sdk/packages/core/src/session/services/session-listing-diagnostic-sink.ts",
				),
				"@cline/llms": path.resolve(appsVscodeRoot, "node_modules/@cline/llms/dist/index.js"),
				"@cline/shared": path.resolve(appsVscodeRoot, "node_modules/@cline/shared/dist/index.js"),
				"@shared": path.resolve(appsVscodeRoot, "src/shared"),
				"@": path.resolve(appsVscodeRoot, "src"),
			},
		},
	},
})
