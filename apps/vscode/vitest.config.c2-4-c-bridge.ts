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
		],
		testTimeout: 30_000,
	},
	resolve: {
		alias: {
			"@cline-internal/core/runtime/host/local-runtime-host": sdkCoreHost,
			"@cline-internal/core/session/services/file-session-service": sdkCoreSessionService,
			"@cline-internal/core/types/events": sdkCoreTypesEvents,
			"@cline-internal/core/runtime/config/agent-message-codec": sdkCoreAgentMessageCodec,
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
