/**
 * ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION01 (C3 / C6 / C7)
 *
 * Reference fixture table for the TaskHeader presentation projection.
 *
 * Each fixture row is the canonical input quadruple the production
 * selector sees at its seam, paired with the expected projection. The
 * fixtures are derived directly from the four production rules in
 * `selectTaskHeaderPresentation` (see
 * `apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts:559–644`)
 * and the UNBOUND-demotion guard added by
 * ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01 +
 * ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION03-AUTHORITY.
 *
 * The Elm kernel is the SOLE production authority for
 * `taskHeaderPresentation`. The contract test
 * (`task-header-elm-orchestration-authority01.test.ts`) drives the
 * real Elm kernel against this exact table; the TS reference
 * selector is exercised only as an invariant fixture (any drift
 * between the two surfaces as a CONTRACT defect).
 *
 * These fixtures are the SAME table as the Elm-side test suite
 * `apps/vscode/elm/task-header-orchestration/tests/TaskHeaderOrchestrationTest.elm`,
 * expressed in TS shape.
 */

import type { TurnPhase } from "@shared/ExtensionMessage"

export interface TaskHeaderOrchestrationFixture {
	readonly label: string
	readonly facts: {
		readonly canonicalShadowPhase: TurnPhase | undefined
		readonly currentLegacyPhase: TurnPhase
		readonly seq: number
		readonly canonicalShadowObservedTurnSeq: number | undefined
	}
	readonly expected: {
		readonly phase: TurnPhase
		readonly source: "host" | "shadow" | "legacy"
		readonly seq: number
	}
}

/**
 * The 12 reference fixtures the production contract supports.
 */
export const taskHeaderOrchestrationFixtures: readonly TaskHeaderOrchestrationFixture[] = [
	// R1: HOST COMPACTION OVERRIDE
	{
		label: "R1: compacting legacy beats canonical shadow",
		facts: {
			canonicalShadowPhase: "streaming",
			currentLegacyPhase: "compacting",
			seq: 10,
			canonicalShadowObservedTurnSeq: 10,
		},
		expected: { phase: "compacting", source: "host", seq: 10 },
	},

	// R2: HOST AWAITING_FOLLOWUP OVERRIDE
	{
		label: "R2: awaiting_followup legacy beats canonical shadow (TCCC01-B1)",
		facts: {
			canonicalShadowPhase: "idle",
			currentLegacyPhase: "awaiting_followup",
			seq: 11,
			canonicalShadowObservedTurnSeq: 11,
		},
		expected: { phase: "awaiting_followup", source: "host", seq: 11 },
	},

	// R3-1: CANONICAL SHADOW (fresh, not UNBOUND-demoting)
	{
		label: "R3: canonical shadow wins when fresh and not UNBOUND-demoting",
		facts: {
			canonicalShadowPhase: "streaming",
			currentLegacyPhase: "streaming",
			seq: 5,
			canonicalShadowObservedTurnSeq: 5,
		},
		expected: { phase: "streaming", source: "shadow", seq: 5 },
	},

	// R3-2: stale shadow falls through
	{
		label: "R3-fallthrough-stale: stale shadow falls through to legacy",
		facts: {
			canonicalShadowPhase: "idle",
			currentLegacyPhase: "streaming",
			seq: 5,
			canonicalShadowObservedTurnSeq: 2,
		},
		expected: { phase: "streaming", source: "legacy", seq: 5 },
	},

	// R3-3: UNBOUND shadow demotion (idle shadow vs streaming legacy)
	{
		label: "R3-fallthrough-unbound-demote: UNBOUND shadow cannot demote active legacy",
		facts: {
			canonicalShadowPhase: "idle",
			currentLegacyPhase: "streaming",
			seq: 27545,
			canonicalShadowObservedTurnSeq: undefined,
		},
		expected: { phase: "streaming", source: "legacy", seq: 27545 },
	},

	// R3-4: UNBOUND shadow allowed (both terminal)
	{
		label: "R3-allowed-unbound-terminal: UNBOUND terminal shadow allowed when legacy is terminal",
		facts: {
			canonicalShadowPhase: "idle",
			currentLegacyPhase: "idle",
			seq: 1,
			canonicalShadowObservedTurnSeq: undefined,
		},
		expected: { phase: "idle", source: "shadow", seq: 1 },
	},

	// R3-5: UNBOUND demote-2 (terminal shadow vs awaiting_approval legacy)
	{
		label: "R3-fallthrough-unbound-demote-2: UNBOUND terminal shadow demoting awaiting_approval legacy",
		facts: {
			canonicalShadowPhase: "completed",
			currentLegacyPhase: "awaiting_approval",
			seq: 50,
			canonicalShadowObservedTurnSeq: undefined,
		},
		expected: { phase: "awaiting_approval", source: "legacy", seq: 50 },
	},

	// R2.5-1: HOST ERROR / RESUMABLE OVERRIDE (PTBPC01).
	// When the host has authoritatively written `error` or
	// `resumable`, the Elm kernel respects the host's authority
	// over the canonical shadow. This is the bounded Elm
	// policy correction that closes the LIVE specimen's
	// `Working` SCAR without fabricating completion.
	{
		label: "R2.5: error legacy beats canonical shadow (host authority)",
		facts: {
			canonicalShadowPhase: "completed",
			currentLegacyPhase: "error",
			seq: 13,
			canonicalShadowObservedTurnSeq: 13,
		},
		expected: { phase: "error", source: "host", seq: 13 },
	},
	{
		label: "R2.5: resumable legacy beats canonical shadow (host authority)",
		facts: {
			canonicalShadowPhase: "completed",
			currentLegacyPhase: "resumable",
			seq: 14,
			canonicalShadowObservedTurnSeq: 14,
		},
		expected: { phase: "resumable", source: "host", seq: 14 },
	},

	// R4-1: ABSENCE FALLBACK (Hub/Remote) — the legacy R4
	// absence-fallback behavior for `resumable`/`error` has been
	// SUPERSEDED by R2.5 (PTBPC01). R4 still applies to the
	// non-host-authority phases when the shadow is absent.
	{
		label: "R4: shadow absent + resumable legacy -> R2.5 host authority (PTBPC01)",
		facts: {
			canonicalShadowPhase: undefined,
			currentLegacyPhase: "resumable",
			seq: 3,
			canonicalShadowObservedTurnSeq: undefined,
		},
		expected: { phase: "resumable", source: "host", seq: 3 },
	},

	// R4-2: ABSENCE FALLBACK (idle finished)
	{
		label: "R4-2: shadow absent, idle finished via legacy",
		facts: {
			canonicalShadowPhase: undefined,
			currentLegacyPhase: "completed",
			seq: 4,
			canonicalShadowObservedTurnSeq: undefined,
		},
		expected: { phase: "completed", source: "legacy", seq: 4 },
	},

	// ABSEQUAL: shadow agrees with legacy (canonical == legacy)
	{
		label: "shadow==legacy: canonical idle equals legacy idle, shadow source wins",
		facts: {
			canonicalShadowPhase: "idle",
			currentLegacyPhase: "idle",
			seq: 2,
			canonicalShadowObservedTurnSeq: 2,
		},
		expected: { phase: "idle", source: "shadow", seq: 2 },
	},

	// ABSEQUAL-2: completed == completed
	{
		label: "shadow==legacy-2: canonical completed equals legacy completed",
		facts: {
			canonicalShadowPhase: "completed",
			currentLegacyPhase: "completed",
			seq: 10,
			canonicalShadowObservedTurnSeq: 10,
		},
		expected: { phase: "completed", source: "shadow", seq: 10 },
	},

	// LIVE specimen: canonical=idle, legacy=streaming, UNBOUND
	{
		label: "LIVE-specimen: canonical=idle, legacy=streaming, UNBOUND -> legacy wins",
		facts: {
			canonicalShadowPhase: "idle",
			currentLegacyPhase: "streaming",
			seq: 27545,
			canonicalShadowObservedTurnSeq: undefined,
		},
		expected: { phase: "streaming", source: "legacy", seq: 27545 },
	},
] as const

/**
 * Helper that produces the canonical `Facts -> Presentation` mapping
 * for the production TS selector.
 */
export function fixtureFactInputs(fx: TaskHeaderOrchestrationFixture) {
	return {
		canonicalShadowPhase: fx.facts.canonicalShadowPhase,
		currentLegacyPhase: fx.facts.currentLegacyPhase,
		seq: fx.facts.seq,
		canonicalShadowObservedTurnSeq: fx.facts.canonicalShadowObservedTurnSeq,
	} as const
}
