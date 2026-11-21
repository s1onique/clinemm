import { defineConfig } from "vitest/config";

/**
 * ACT-CLINEMM-COMPACTION-SUMMARY-CHURN-01 — the dedicated RED config.
 *
 * The RED witness asserts the CACHE-PREFIX STABILITY invariant and FAILS
 * against the current production behaviour. It is excluded from the default
 * suite (`vitest.config.ts`) so it never blocks the normal gate, and it is
 * runnable ON DEMAND through this dedicated config:
 *
 *   bun run test:red:summary-churn01
 *
 * A FAILURE of this suite is the EXPECTED, CORRECT outcome until
 * ACT-CLINEMM-COMPACTION-STABLE-PREFIX-REPAIR-01 lands.
 *
 * The PASSING witness for the same mechanism and for the causal ablation is
 * `src/extensions/context/compaction.summary-churn01.test.ts`.
 */
export default defineConfig({
	optimizeDeps: {
		include: ["zod"],
		force: true,
	},
	ssr: {
		noExternal: ["zod"],
	},
	test: {
		environment: "node",
		include: [
			"src/extensions/context/compaction.summary-churn01.red.test.ts",
		],
		testTimeout: 20_000,
		hookTimeout: 25_000,
		pool: "forks",
	},
});
