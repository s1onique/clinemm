import { defineConfig } from "vitest/config";

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
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
		exclude: ["src/example.test.ts"],
		passWithNoTests: true,
	},
});
