import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	// ACT-CLINEMM-MODEL-BEHAVIOR-TRACE01:
	// `sdk/packages/shared/src/agents/types.ts` calls `z.object(...)` at
	// module scope, and the shared package barrel re-exports it. Without an
	// explicit zod pre-bundle, Vite resolves zod's CJS entry and the
	// namespace import (`import { z } from "zod"`) yields `undefined` under
	// ESM. Pre-bundling zod and forcing it to stay external for SSR makes
	// the named ESM export resolve, exactly as `apps/vscode/vitest.config.ts`
	// already does for the same reason.
	optimizeDeps: {
		include: ["zod"],
		force: true,
	},
	ssr: {
		noExternal: ["zod"],
	},
	resolve: {
		alias: [
			// ACT-CLINEMM-PROVIDER-REASONING-CONTINUITY-P0-01-CORRECTION01:
			//
			// The published `@cline/agents` / `@cline/llms` / `@cline/shared`
			// entry points at `dist/`, which is not built in a source checkout.
			// A suite that needs the REAL runtime and the REAL gateway
			// therefore has to resolve those packages to their SOURCE entry
			// points.
			//
			// This is the SAME alias mechanism `sdk/packages/llms/vitest.config.ts`
			// already uses for `@cline/shared`.
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
		include: ["src/**/*.test.ts"],
		exclude: [
			"src/**/*.e2e.test.ts",
			// ACT-CLINEMM-COMPACTION-SUMMARY-CHURN-01: the RED witness.
			//
			// This file asserts the CACHE-PREFIX STABILITY invariant — the
			// invariant a prompt cache depends on. It FAILS against the
			// current production behaviour, because
			// `applyVerifiedEvidenceToCompactedMessages()` re-derives the
			// verified-outcome section from the evolved canonical history on
			// every provider-visible restoration and replaces it in place.
			//
			// It is deliberately EXCLUDED from the default suite and retained
			// as an isolated receipt of the observed defect. It must not be
			// flipped to GREEN by weakening the assertion; the repair is a
			// SEPARATE, later ACT
			// (ACT-CLINEMM-COMPACTION-STABLE-PREFIX-REPAIR-01).
			//
			// The PASSING witness for the same mechanism and for the causal
			// ablation is `compaction.summary-churn01.test.ts`.
			"src/extensions/context/compaction.summary-churn01.red.test.ts",
			// ACT-CLINEMM-ADJUDICATION-CONTINUITY-RED-01: the RED witness.
			//
			// This file asserts the ADJUDICATION-CONTINUITY invariant — that a
			// previously established, source-grounded, QUALIFIED adjudication
			// remains available in the provider-visible continuation after
			// compaction. It FAILS against the current production behaviour,
			// because `buildBudgetProjection()` with the `agentic_summary`
			// policy drops EVERY `thinking` block from the summarizer input
			// (see `resolveProjectionPolicy()` in
			// `budget-projection/project.ts`), so a verdict that lives only in
			// a thinking block is removed BEFORE the summarizer request is
			// built.
			//
			// It is deliberately EXCLUDED from the default suite and retained
			// as an isolated receipt of the observed defect. It must not be
			// flipped to GREEN by weakening the assertion; the repair is a
			// SEPARATE, later ACT
			// (ACT-CLINEMM-ADJUDICATION-CONTINUITY-REPAIR-01).
			//
			// The PASSING companion for the same mechanism, for the causal
			// discriminators, the necessity ablation and the security
			// negative controls, is
			// `compaction.adjudication-continuity.discriminator01.test.ts`.
			"src/extensions/context/compaction.adjudication-continuity.red01.test.ts",
			// ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01: the RED
			// witness.
			//
			// This file asserts that the REAL production compaction path does
			// NOT yet carry a closed working-knowledge section. It FAILS
			// against the production behaviour WITHOUT the checkpoint
			// enabled, and it is deliberately EXCLUDED from the default
			// suite so it never blocks the normal gate.
			//
			// It is runnable ON DEMAND through its dedicated config:
			//
			//   bun run test:red:pck-closed-publication
			//
			// The PASSING companion for the same mechanism is
			// `src/extensions/context/precompaction-knowledge-checkpoint/pck-production-seam.test.ts`.
			"src/extensions/context/precompaction-knowledge-checkpoint/pck-production-seam.red01.test.ts",
			// ACT-CLINEMM-PCK-PHYSICAL-REQUEST-CARDINALITY-REPAIR-01: the
			// RED witness.
			//
			// This file asserts that the REAL production transport issues
			// MORE THAN ONE physical provider request for a checkpoint
			// request that carries no physical-request policy. It FAILS
			// against the predecessor behaviour — which is exactly the
			// receipt of the observed defect — and it is deliberately
			// EXCLUDED from the default suite so it never blocks the
			// normal gate.
			//
			// It is runnable ON DEMAND through its dedicated config:
			//
			//   bun run test:red:pck-physical-request-cardinality
			//
			// The PASSING companion for the same mechanism, and for the
			// causal ablation and the conservation controls, is
			// `src/extensions/context/precompaction-knowledge-checkpoint/pck-physical-request-cardinality.test.ts`.
			"src/extensions/context/precompaction-knowledge-checkpoint/pck-physical-request-cardinality.red01.test.ts",
			// ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01 (ADDENDUM-01):
			// the RED witness.
			//
			// This file asserts that the AGGREGATE EXPENDITURE over a turn's
			// PHYSICAL ATTEMPTS reached the CONTEXT-OCCUPANCY authority. It
			// FAILS against the repaired production behaviour — which is
			// exactly the receipt of the observed defect — and it is
			// deliberately EXCLUDED from the default suite so it never blocks
			// the normal gate.
			//
			// It is runnable ON DEMAND through its dedicated config:
			//
			//   bun run test:red:cmp09-retry-expenditure
			//
			// The PASSING companion for the same mechanism, and for the
			// conservation controls, is
			// `compaction.retry-expenditure-vs-context-occupancy.cmp09.test.ts`.
			"src/extensions/context/compaction.retry-expenditure-vs-context-occupancy.cmp09.red01.test.ts",
			// ACT-CLINEMM-PCK-PREFIX-PRESERVING-IMPLEMENTATION-01: the RED
			// witness.
			//
			// This file asserts the B' COMPOSITION at the REAL production
			// compaction-to-PCK dispatch seam. Its R1.4 assertion FAILS
			// against the predecessor behaviour — which is exactly the
			// receipt of the observed defect — and it is deliberately
			// EXCLUDED from the default suite so it never blocks the normal
			// gate.
			//
			// It is runnable ON DEMAND through its dedicated config:
			//
			//   bun run test:red:pck-prefix-preserving
			//
			// The PASSING companion for the same mechanism, and for the
			// conservation, authority and lifecycle controls, is
			// `src/extensions/context/precompaction-knowledge-checkpoint/pck-prefix-preserving.test.ts`.
			"src/extensions/context/precompaction-knowledge-checkpoint/pck-prefix-preserving.red01.test.ts",
		],
		// Process, Git, and SQLite integration coverage shares this suite with
		// pure unit tests. Windows hosted runners regularly exceed Vitest's 5s
		// default while starting those processes, so retain a bounded but realistic
		// budget and reduce Windows CI contention.
		// windows-latest runners are 2-core and spawn forks slowly; the hub
		// suites additionally start real servers and take SQLite locks. These
		// budgets guard against hangs, they are not timing assertions, so give
		// them room rather than failing publishes on runner speed.
		testTimeout: 20_000,
		hookTimeout: 25_000,
		pool: "forks",
		...(process.env.CI && process.platform === "win32"
			? {
					// Two workers, not one: serializing the whole suite here cost ~3
					// minutes of Windows CI per run. The worker terminations that
					// motivated serializing were timing fragility in the hub suites
					// (a daemon shutdown that could exit before its HTTP response
					// flushed, plus hang guards tight enough to trip on runner speed),
					// which are fixed at the source rather than papered over here.
					maxWorkers: 2,
				}
			: {}),
	},
});
