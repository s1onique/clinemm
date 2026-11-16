import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The sidecar test configuration.
 *
 * ACT-CLINEMM-DIAGNOSTIC-EXPORT-PRIVACY01
 *
 * The `server.deps.inline` entry is REQUIRED, not cosmetic: the desktop app
 * resolves `zod@3` while `@cline/core` (and `@cline/shared`) resolve
 * `zod@4`. Without inlining the SDK packages, Vite externalizes them and the
 * SDK's ESM `import { z } from "zod"` is served through the app's zod v3
 * CommonJS interop, where the named export `z` is `undefined` and every
 * sidecar test that touches `@cline/core` fails to even load
 * (`TypeError: undefined is not an object (evaluating 'z.object')`).
 *
 * Inlining the SDK packages lets Vite process their ESM directly, so each
 * package resolves the zod version IT declares.
 */
export default defineConfig({
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./webview", import.meta.url)),
		},
	},
	test: {
		environment: "node",
		// First test in a file pays the @cline/core → llms module-graph import
		// cost, which sits near the 5s default under CI contention.
		testTimeout: 20_000,
		server: {
			deps: {
				inline: [/@cline\//, /zod/],
			},
		},
	},
});
