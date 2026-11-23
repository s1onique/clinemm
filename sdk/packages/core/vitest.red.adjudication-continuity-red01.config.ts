import { defineConfig } from "vitest/config";

/**
 * ACT-CLINEMM-ADJUDICATION-CONTINUITY-RED-01 — the dedicated RED config.
 *
 * The RED witness asserts the ADJUDICATION-CONTINUITY invariant — that a
 * previously established, source-grounded, QUALIFIED adjudication remains
 * available in the provider-visible continuation after compaction — and
 * FAILS against the current production behaviour.
 *
 * The loss is reproduced at the SOURCE-SELECTION boundary:
 * `buildBudgetProjection()` with the `agentic_summary` policy sets
 * `dropThinkingBlocks: true` and therefore removes EVERY `thinking` block
 * from the summarizer input, unconditionally and before any budget
 * arithmetic. A verdict that lives only in a thinking block (which is the
 * shape of all three historical witnesses R3/R7/R8) is removed BEFORE the
 * summarizer request is built.
 *
 * The RED witness is excluded from the default suite (`vitest.config.ts`)
 * so it never blocks the normal gate, and it is runnable ON DEMAND
 * through this dedicated config:
 *
 *   bun run test:red:adjudication-continuity-red01
 *
 * A FAILURE of this suite is the EXPECTED, CORRECT outcome until
 * ACT-CLINEMM-ADJUDICATION-CONTINUITY-REPAIR-01 lands.
 *
 * The PASSING companion for the same mechanism — the causal discriminators,
 * the necessity ablation, the security negative controls and the
 * conservation controls — is
 * `src/extensions/context/compaction.adjudication-continuity.discriminator01.test.ts`.
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
			"src/extensions/context/compaction.adjudication-continuity.red01.test.ts",
		],
		testTimeout: 20_000,
		hookTimeout: 25_000,
		pool: "forks",
	},
});
