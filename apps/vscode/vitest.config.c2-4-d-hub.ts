/**
 * Companion vitest config for C2.4-D-HUB fallaback-composition
 * tests.
 *
 * The D2 test imports the REAL `HubRuntimeHost` from
 * `sdk/packages/core/src/hub/runtime-host/hub-runtime-host.ts` via
 * the `@cline-internal/core/hub/runtime-host/hub-runtime-host`
 * alias. This avoids:
 *   - the `@cline/core` bundle minifier name-collision
 *   - the `apps/vscode/vitest.config.ts` `@cline/core` stub alias
 *
 * The base config is modified only to exclude this D2 test from
 * its alias-incompatible test stream; the dedicated config
 * owns execution of this test. The D2 test runs via
 * `bun run vitest --config vitest.config.c2-4-d-hub.ts`. The
 * base config continues to run all existing C2.4-B and earlier
 * witness files.
 *
 * NOTE: `setupFiles` is intentionally omitted (mirrors the
 *   C2.4-C bridge config). The base `src/test/vitest-setup.ts`
 *   calls `resetModelsFileState`, which depends on the
 *   model-catalog stub aliases. The D2 test does not need those
 *   stubs (it uses the real `HubRuntimeHost`).
 */
import path from "node:path"
import { defineConfig } from "vitest/config"

const repoRoot = path.resolve(__dirname, "../..")
const sdkCoreRoot = path.resolve(repoRoot, "sdk/packages/core/src")
const sdkCoreHubRuntimeHost = path.resolve(sdkCoreRoot, "hub/runtime-host/hub-runtime-host.ts")

export default defineConfig({
	test: {
		environment: "node",
		// Only the D2 test file. The base config does not include
		// this (and the dedicated config does not include the base
		// tests), so the two streams are isolated.
		include: ["src/sdk/__tests__/hub-runtime-host.fallback-composition.c24-d.test.ts"],
		testTimeout: 30_000,
	},
	resolve: {
		alias: {
			"@cline-internal/core/hub/runtime-host/hub-runtime-host": sdkCoreHubRuntimeHost,
			// Workspace package bundles. The base apps/vscode config
			// aliases these for the standard test runs, but the
			// dedicated D2 config stands alone and must repeat them.
			"@cline/agents": path.resolve(__dirname, "node_modules/@cline/agents/dist/index.js"),
			"@cline/shared": path.resolve(__dirname, "node_modules/@cline/shared/dist/index.js"),
			// The wiring imports `CoreSessionEvent` from
			// `@cline/core`. The base apps/vscode config aliases
			// `@cline/core` to a stub; the dedicated D2 config
			// repeats that alias so the wiring's type imports
			// resolve.
			"@cline/core": path.resolve(__dirname, "src/test/cline-core-vitest-stub.ts"),
		},
	},
	server: {
		fs: {
			allow: [path.resolve(__dirname), repoRoot, sdkCoreRoot],
		},
	},
})
