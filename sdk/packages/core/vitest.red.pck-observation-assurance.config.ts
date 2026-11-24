import { defineConfig } from "vitest/config";

/**
 * ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01-CORRECTION01 — the
 * dedicated P0-1 discriminator config.
 *
 * The P0-1 witness asserts that a semantically UNRELATED canonical tool
 * event does NOT raise the assurance of the observation atom that cites it.
 *
 * Against the CORRECTED implementation it PASSES. Against the PREDECESSOR
 * implementation (the reference-membership interpreter) it FAILS, and that
 * failure IS the RED that established the finding.
 *
 * It is runnable ON DEMAND through this dedicated config:
 *
 *   bun run test:red:pck-observation-assurance
 *
 * It is excluded from the default suite (`vitest.config.ts`) so it never
 * blocks the normal gate, and it is ALSO included in the ACT-owned focused
 * suite so the correction's GREEN is continuously evidenced.
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
			"src/extensions/context/precompaction-knowledge-checkpoint/pck-observation-assurance.red01.test.ts",
		],
		testTimeout: 20_000,
		hookTimeout: 25_000,
		pool: "forks",
	},
});
