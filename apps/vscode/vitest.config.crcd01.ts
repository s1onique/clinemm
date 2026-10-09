/**
 * ACT-CLINEMM-P0-COMPLETION-REEVALUATION-CAPABILITY-DISCRIMINATOR01 / CRCD01
 * — bridge config.
 *
 * Dedicated vitest config for the reevaluation capability discriminator
 * probe. Mirrors the TWQC01 bridge pattern at `vitest.config.twqc01.ts`:
 *
 *  - imports REAL `LocalRuntimeHost` and REAL `PendingPromptsController`
 *    from `sdk/packages/core/src/...` via `@cline-internal/core/...`
 *    aliases (NOT the `@cline/core` stub alias from the base config)
 *  - includes ONLY the discriminator test file
 *  - excludes the base-config test stream
 *
 * The base `vitest.config.ts` excludes this test (per the SDK transport
 * integration test pattern at `.clinerules/sdk-transport-integration.md`).
 * This config owns the probe.
 *
 * Run via:
 *
 *   bun x vitest run --config vitest.config.crcd01.ts
 *
 * `setupFiles` is intentionally omitted. The base
 * `src/test/vitest-setup.ts` calls `resetModelsFileState`, which depends on
 * the model-catalog stub aliases; the probe uses the real
 * `LocalRuntimeHost` and does not need those stubs.
 */
import path from "node:path"
import { defineConfig } from "vitest/config"

const repoRoot = path.resolve(__dirname, "../..")
const sdkCoreRoot = path.resolve(repoRoot, "sdk/packages/core/src")
const sdkCoreHost = path.resolve(sdkCoreRoot, "runtime/host/local-runtime-host")
const sdkCoreTurnQueue = path.resolve(sdkCoreRoot, "runtime/turn-queue/pending-prompt-service")
const sdkCoreTypesEvents = path.resolve(sdkCoreRoot, "types/events")
const sdkCoreAgentMessageCodec = path.resolve(sdkCoreRoot, "runtime/config/agent-message-codec")
const appsVscodeRoot = path.resolve(__dirname)

export default defineConfig({
	test: {
		environment: "node",
		// Only the discriminator test file. The base config does not include
		// these (and the bridge config does not include the base tests), so
		// the two streams are isolated.
		include: ["src/sdk/__tests__/completion-reevaluation-capability-discriminator01.crcd01.test.ts"],
		testTimeout: 30_000,
	},
	optimizeDeps: {
		// Pre-bundle zod so Vite's module runner correctly resolves
		// the named `import { z } from "zod"` for SDK source files
		// pulled in via the `@cline-internal/core/...` aliases.
		include: ["zod"],
		force: true,
	},
	ssr: {
		// Vite/Vitest test runs go through the SSR runtime; tell
		// SSR to externalize zod so the resolved path is the
		// package.json `import` ESM entry (not the `main` CJS).
		noExternal: ["zod"],
	},
	resolve: {
		alias: {
			// Real production classes (bypass the @cline/core stub).
			"@cline-internal/core/runtime/host/local-runtime-host": sdkCoreHost,
			"@cline-internal/core/runtime/turn-queue/pending-prompt-service": sdkCoreTurnQueue,
			"@cline-internal/core/types/events": sdkCoreTypesEvents,
			"@cline-internal/core/runtime/config/agent-message-codec": sdkCoreAgentMessageCodec,
			// Apps/vscode alias surface.
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
