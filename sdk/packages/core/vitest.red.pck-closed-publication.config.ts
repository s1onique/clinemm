import { defineConfig } from "vitest/config";

/**
 * ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01 — the dedicated RED config.
 *
 * The RED witness asserts that the REAL production compaction path does NOT
 * yet carry a closed working-knowledge section. It FAILS against the
 * unchanged production behaviour, and it is excluded from the default suite
 * (`vitest.config.ts`) so it never blocks the normal gate.
 *
 * It is runnable ON DEMAND through this dedicated config:
 *
 *   bun run test:red:pck-closed-publication
 *
 * A FAILURE of this suite is the EXPECTED, CORRECT outcome until
 * ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01 lands.
 *
 * The PASSING companion for the same mechanism is
 * `src/extensions/context/precompaction-knowledge-checkpoint/pck-production-seam.test.ts`.
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
			"src/extensions/context/precompaction-knowledge-checkpoint/pck-production-seam.red01.test.ts",
		],
		testTimeout: 20_000,
		hookTimeout: 25_000,
		pool: "forks",
	},
});
