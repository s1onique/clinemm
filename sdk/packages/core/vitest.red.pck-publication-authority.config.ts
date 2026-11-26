import { defineConfig } from "vitest/config";

/**
 * ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01 (AMENDMENT-01) — the
 * dedicated P0 RED config.
 *
 * The RED witness drives the REAL production B' attempt and publication path
 * and asserts that a proposal citing a reference the B' source authority
 * EXCLUDES is NOT admitted and NOT installed.
 *
 * It FAILS against the unrepaired behaviour — which is exactly the receipt
 * of the observed defect — and it is excluded from the default suite
 * (`vitest.config.ts`) so it never blocks the normal gate.
 *
 * It is runnable ON DEMAND through this dedicated config:
 *
 *   bun run test:red:pck-publication-authority
 *
 * The PASSING companion for the same mechanism is
 * `src/extensions/context/precompaction-knowledge-checkpoint/pck-publication-authority.test.ts`.
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
			"src/extensions/context/precompaction-knowledge-checkpoint/pck-publication-authority.red01.test.ts",
		],
		testTimeout: 60_000,
		hookTimeout: 60_000,
		pool: "forks",
	},
});
