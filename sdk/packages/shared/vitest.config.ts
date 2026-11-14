import { defineConfig } from "vitest/config";

export default defineConfig({
	// ACT-CLINEMM-FLINT-128K-BUDGET-AUTHORITY-REPAIR01:
	// `sdk/packages/shared/src/agents/types.ts` calls `z.object(...)` at
	// module scope, and this package's barrel re-exports it. Without an
	// explicit zod pre-bundle, Vite resolves zod's CJS entry and the
	// namespace import (`import { z } from "zod"`) yields `undefined` under
	// ESM, so any suite that loads the barrel at runtime fails with
	// `TypeError: undefined is not an object (evaluating 'z.object')`.
	//
	// This is the SAME fix `sdk/packages/core/vitest.config.ts`,
	// `sdk/packages/agents/vitest.config.ts` and
	// `apps/vscode/vitest.config.ts` already carry for the same reason.
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
		// SQLite-backed tests routinely exceed vitest's 5s default on the
		// 2-core windows-latest runner. A hang guard, not a timing assertion.
		testTimeout: 15_000,
		hookTimeout: 15_000,
		exclude: ["src/**/*.e2e.test.ts"],
	},
});
