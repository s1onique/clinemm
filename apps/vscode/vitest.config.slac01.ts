/**
 * Companion vitest config for the session-listing causal-diagnostic
 * test suite (ACT-CLINEMM-EXTENSION-HOST-SESSION-LISTING-ALLOCATION-CAUSALITY01).
 *
 * The base config aliases `@cline/core` to a stub file that does not
 * expose the session-listing sink surface. To exercise the REAL
 * sink (`session-listing-diagnostic-sink.ts`) without bumping the
 * stub, this config adds dedicated aliases that point at the live
 * SDK source — same strategy as `vitest.config.c2-4-c-bridge.ts`
 * for the load-bearing composition tests.
 *
 * Single-source-of-truth (per HALT_SLAC_DIAGNOSTIC_AUTHORITY_FALSE_GREEN P0-2):
 * Any reference — direct relative (`./session-listing-diagnostic-sink`)
 * or via the barrel (`@cline/core` → `index.ts` → re-export) — must
 * resolve to the SAME Vite module instance so the AsyncLocalStorage
 * singleton is shared between the extension-host runtime and the
 * SDK production wrappers. Without this, vitest+ESM gives each
 * absolute path a fresh module graph and the consumer reads
 * UNKNOWN inside `withListSessionsCaller` even after the producer
 * wrote the correct class.
 */
import path from "node:path"
import { defineConfig } from "vitest/config"

const repoRoot = path.resolve(__dirname, "..", "..")
const appsVscodeRoot = path.resolve(__dirname)
const sinkFilePath = path.resolve(repoRoot, "sdk/packages/core/src/session/services/session-listing-diagnostic-sink.ts")

export default defineConfig({
	test: {
		environment: "node",
		// Only the slac01 test file. The base config continues to
		// run all other vitest-native tests; the slac01 config
		// owns this one.
		include: ["src/sdk/__tests__/session-listing-allocation-causality01.slac01.test.ts"],
		resolve: {
			dedupe: [sinkFilePath],
			alias: [
				{
					find: /^@cline\/core$/,
					replacement: path.resolve(appsVscodeRoot, "../../sdk/packages/core/src/index.ts"),
				},
				{
					find: /^@cline-internal\/core\/session\/services\/session-listing-diagnostic-sink$/,
					replacement: sinkFilePath,
				},
				// Map any relative-path import of the sink module to
				// the SAME absolute path. This is the load-bearing
				// alias that prevents two module instances under
				// vitest+ESM. Match anywhere in the import string.
				{
					find: /session-listing-diagnostic-sink(?:['"]|\.ts)?$/,
					replacement: sinkFilePath,
				},
				{
					find: /^@cline\/llms$/,
					replacement: path.resolve(appsVscodeRoot, "node_modules/@cline/llms/dist/index.js"),
				},
				{
					find: /^@cline\/shared$/,
					replacement: path.resolve(appsVscodeRoot, "node_modules/@cline/shared/dist/index.js"),
				},
				{
					find: /^@shared$/,
					replacement: path.resolve(appsVscodeRoot, "src/shared"),
				},
				{
					find: /^@$/,
					replacement: path.resolve(appsVscodeRoot, "src"),
				},
			],
		},
	},
})
