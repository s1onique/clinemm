import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = dirname(fileURLToPath(import.meta.url));

/**
 * ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01 (ADDENDUM-01) — the
 * dedicated RED config.
 *
 * The RED witness asserts that the AGGREGATE EXPENDITURE over a turn's
 * PHYSICAL ATTEMPTS reached the CONTEXT-OCCUPANCY authority — the defect
 * the addendum reproduced through the REAL gateway, the REAL retry
 * middleware, the REAL `AgentRuntime` and the REAL compaction seam.
 *
 * It FAILS against the repaired production behaviour — which is exactly the
 * receipt of the observed defect — and it is excluded from the default suite
 * (`vitest.config.ts`) so it never blocks the normal gate.
 *
 * It is runnable ON DEMAND through this dedicated config:
 *
 *   bun run test:red:cmp09-retry-expenditure
 *
 * A FAILURE of `R1.1` is the EXPECTED, CORRECT outcome. It must NOT be
 * flipped to GREEN by weakening the assertion: the receipt records what the
 * boundary did WITHOUT the repair.
 *
 * The PASSING companion for the same mechanism, and for the conservation
 * controls, is
 * `src/extensions/context/compaction.retry-expenditure-vs-context-occupancy.cmp09.test.ts`.
 */
export default defineConfig({
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
				find: /^@cline\/agents\/(.+)$/,
				replacement: resolve(rootDir, "../agents/src/$1"),
			},
			{
				find: /^@cline\/agents$/,
				replacement: resolve(rootDir, "../agents/src/index.ts"),
			},
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
		include: [
			"src/extensions/context/compaction.retry-expenditure-vs-context-occupancy.cmp09.red01.test.ts",
		],
		testTimeout: 60_000,
		hookTimeout: 60_000,
		pool: "forks",
	},
});
