import { defineConfig } from "vitest/config";

/**
 * ACT-CLINEMM-PCK-PHYSICAL-REQUEST-CARDINALITY-REPAIR-01 — the dedicated
 * RED config.
 *
 * The RED witness asserts that the REAL production transport issues MORE
 * THAN ONE physical provider request for a checkpoint request that carries
 * no physical-request policy. It FAILS against the predecessor behaviour —
 * which is exactly the receipt of the observed defect — and it is excluded
 * from the default suite (`vitest.config.ts`) so it never blocks the normal
 * gate.
 *
 * It is runnable ON DEMAND through this dedicated config:
 *
 *   bun run test:red:pck-physical-request-cardinality
 *
 * A FAILURE of `R1.1` is the EXPECTED, CORRECT outcome. It must NOT be
 * flipped to GREEN by weakening the assertion: the receipt records what the
 * boundary did WITHOUT the request-scoped policy.
 *
 * The PASSING companion for the same mechanism, and for the causal ablation
 * and the conservation controls, is
 * `src/extensions/context/precompaction-knowledge-checkpoint/pck-physical-request-cardinality.test.ts`.
 *
 * The RED witness's retry budget is generous because it deliberately lets
 * the transport exhaust its retry backoff — that backoff IS part of the
 * observed defect.
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
			"src/extensions/context/precompaction-knowledge-checkpoint/pck-physical-request-cardinality.red01.test.ts",
		],
		testTimeout: 180_000,
		hookTimeout: 180_000,
		pool: "forks",
	},
});
