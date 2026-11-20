import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	// ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-01.
	//
	// The SAME fix `sdk/packages/shared/vitest.config.ts`,
	// `sdk/packages/core/vitest.config.ts` and
	// `sdk/packages/agents/vitest.config.ts` already carry for the same
	// reason: `sdk/packages/shared/src/agents/types.ts` calls
	// `z.object(...)` at module scope, and the shared barrel re-exports it.
	// Without an explicit zod pre-bundle, Vite resolves zod's CJS entry and
	// the namespace import (`import { z } from "zod"`) yields `undefined`
	// under ESM, so any suite that loads the shared barrel at runtime fails
	// with `TypeError: undefined is not an object (evaluating 'z.enum')`.
	optimizeDeps: {
		include: ["zod"],
		force: true,
	},
	ssr: {
		noExternal: ["zod"],
	},
	resolve: {
		alias: [
			{
				find: /^@cline\/shared\/(.+)$/,
				replacement: resolve(rootDir, "../shared/src/$1"),
			},
			{
				find: /^@cline\/shared$/,
				replacement: resolve(rootDir, "../shared/src/index.ts"),
			},
		],
	},
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
	},
});
