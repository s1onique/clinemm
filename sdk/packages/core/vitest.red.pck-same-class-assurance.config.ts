import { defineConfig } from "vitest/config";

/**
 * ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01-CORRECTION02 — the
 * dedicated P0-2 discriminator config.
 *
 * The P0-2 witness asserts that a same-class canonical tool event does NOT
 * raise the assurance of the observation atom that cites it, unless the
 * event's own runtime-owned command classification establishes the COMPLETE
 * rendered proposition (the atom's label joined with the argument's label).
 *
 * Against the CORRECTED implementation it PASSES. Against the CORRECTION01
 * implementation it FAILS, and that failure IS the RED that established the
 * finding.
 *
 * It is runnable ON DEMAND through this dedicated config:
 *
 *   bun run test:red:pck-same-class-assurance
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
			"src/extensions/context/precompaction-knowledge-checkpoint/pck-same-class-assurance.red02.test.ts",
		],
		testTimeout: 20_000,
		hookTimeout: 25_000,
		pool: "forks",
	},
});
