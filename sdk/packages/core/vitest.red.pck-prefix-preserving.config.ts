import { defineConfig } from "vitest/config";

/**
 * ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 — the dedicated RED
 * config.
 *
 * The RED witness drives the REAL production compaction-to-PCK dispatch seam
 * and asserts the B' COMPOSITION. It FAILS against the predecessor behaviour
 * — which is exactly the receipt of the observed defect — and it is excluded
 * from the default suite (`vitest.config.ts`) so it never blocks the normal
 * gate.
 *
 * It is runnable ON DEMAND through this dedicated config:
 *
 *   bun run test:red:pck-prefix-preserving
 *
 * The PASSING companion for the same mechanism, and for the conservation
 * controls, is
 * `src/extensions/context/precompaction-knowledge-checkpoint/pck-prefix-preserving.test.ts`.
 *
 * The RED witness's assertions must NOT be flipped to GREEN by weakening
 * them: the receipt records what the boundary did WITHOUT the B'
 * composition.
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
			"src/extensions/context/precompaction-knowledge-checkpoint/pck-prefix-preserving.red01.test.ts",
		],
		testTimeout: 60_000,
		hookTimeout: 60_000,
		pool: "forks",
	},
});
