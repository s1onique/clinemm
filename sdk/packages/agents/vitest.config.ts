import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	// ACT-CLINEMM-FLINT-128K-BUDGET-AUTHORITY-REPAIR01:
	// `sdk/packages/shared/src/agents/types.ts` calls `z.object(...)` at
	// module scope, and the shared package barrel re-exports it. Without an
	// explicit zod pre-bundle, Vite resolves zod's CJS entry and the
	// namespace import (`import { z } from "zod"`) yields `undefined` under
	// ESM, so any suite that loads the shared barrel at runtime fails with
	// `TypeError: undefined is not an object (evaluating 'z.object')`.
	//
	// This is the SAME fix `sdk/packages/core/vitest.config.ts` and
	// `apps/vscode/vitest.config.ts` already carry for the same reason. It
	// is applied here so the agents suites that load the shared barrel at
	// runtime can execute.
	optimizeDeps: {
		include: ["zod"],
		force: true,
	},
	ssr: {
		noExternal: ["zod"],
	},
	resolve: {
		alias: [
			// ACT-CLINEMM-PROVIDER-REASONING-CONTINUITY-P0-01-CORRECTION01:
			//
			// The published `@cline/llms` entry points at `dist/`, which is
			// not built in a source checkout. A suite that needs the REAL
			// gateway (rather than a stub) therefore has to resolve the
			// package to its SOURCE entry point.
			//
			// This is the SAME alias mechanism `sdk/packages/llms/vitest.config.ts`
			// already uses for `@cline/shared`, and it keeps the real
			// provider transport reachable without a build step.
			{
				find: /^@cline\/llms\/(.+)$/,
				replacement: resolve(rootDir, "../llms/src/$1"),
			},
			{
				find: /^@cline\/llms$/,
				replacement: resolve(rootDir, "../llms/src/index.ts"),
			},
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
		exclude: ["src/example.test.ts"],
		passWithNoTests: true,
	},
});
