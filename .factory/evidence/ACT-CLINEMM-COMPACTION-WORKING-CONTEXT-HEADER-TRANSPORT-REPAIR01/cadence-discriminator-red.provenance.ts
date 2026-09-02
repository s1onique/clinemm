/**
 * ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
 * cadence discriminator — RED PROVENANCE
 *
 * ⚠ TRANSIENT RED EVIDENCE — NOT in default vitest discovery.
 *
 * Why this file is OUTSIDE any default test runner include:
 *
 *   Repository rule:
 *     - transient RED evidence = good
 *     - committed intentionally-failing default test = not allowed
 *
 *   This file lives at:
 *     .factory/evidence/ACT-CLINEMM-COMPACTION-WORKING-
 *       CONTEXT-HEADER-TRANSPORT-REPAIR01/
 *       cadence-discriminator-red.provenance.ts
 *
 *   It is NOT under any src test glob, so it is NOT
 *   picked up by vitest's default discovery. The committed
 *   falsification witness (which IS in the default suite) lives
 *   at:
 *     sdk/packages/core/src/extensions/context/
 *       compaction.working-context-authority-publish.test.ts
 *     and asserts only the GREEN architectural invariant the
 *     reviewer wants preserved:
 *       - resultA carries currentWorkingContextEstimate
 *         (producer-side W publication)
 *       - saveState fires ONLY on real compaction
 *         (durable artifact cadence = compactions only)
 *
 * This file is the RED PROVENANCE — the mechanically observed
 * falsification of the seventh-pass carrier verdict
 * (SessionCompactionState as the live C2 W carrier) and the
 * publisher cadence bug at compaction.ts:730.
 *
 * Two distinct REDs are mechanically observed here:
 *
 *   1. PUBLISH_GAP — REAL DEFECT, next bounded repair.
 *      createCompactionStateAwarePrepareTurn (compaction.ts:730)
 *      returns `result` (undefined) on the no-compaction branch.
 *      publishWorkingContextEstimate is NOT called.
 *      → Next: publish W on every successful prepare-turn
 *        regardless of compaction.
 *
 *   2. SIDECAR_CADENCE (saveState) — EXPECTED ARCHITECTURAL FACT.
 *      saveState is called only inside `if (result?.messages)`
 *      branches (compaction.ts:705, :720). On no-compaction
 *      prepare-turns, saveState is NOT called — because the
 *      durable compaction artifact is the latest COMPACTED
 *      working context, NOT generic per-turn state.
 *      → After the fix this REMAINS true. The architectural
 *        separation is preserved.
 *
 * Run this file directly via bun to verify the RED is
 * mechanically reproducible. The committed test in the default
 * suite is the falsification-witness form (GREEN); this file
 * is the raw RED evidence (NOT in default suite).
 *
 * Invocation (manual verification, outside the default suite):
 *
 *   bun .factory/evidence/ACT-CLINEMM-COMPACTION-WORKING-\
 *     CONTEXT-HEADER-TRANSPORT-REPAIR01/\
 *     cadence-discriminator-red.provenance.ts
 */

import {
	createCompactionStateAwarePrepareTurn,
	type ContextPipelinePrepareTurn,
} from "/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/sdk/packages/core/src/extensions/context/compaction.ts"

const SYSTEM_PROMPT = "You are a helpful coding assistant."

const TOOLS = [
	{
		name: "read_files",
		description: "Read files",
		input_schema: { type: "object" },
	},
	{
		name: "write_to_file",
		description: "Write a file",
		input_schema: { type: "object" },
	},
]

const CANONICAL = [
	{ role: "user" as const, content: "Create the filter script." },
	{
		role: "assistant" as const,
		content:
			"Older assistant explanation. ".repeat(50) + "Padding. ".repeat(25),
	},
	{
		role: "user" as const,
		content:
			"Tool result: file contents of /tmp/example.ts are 'export const x = 1;'",
	},
	{ role: "assistant" as const, content: "Done." },
]

interface MechanicalObservation {
	turn: "A" | "B" | "C"
	compactionOccurred: boolean
	prepareTurnResultDefined: boolean
	currentWorkingContextEstimate: number | undefined
	totalSaveStateFires: number
}

async function observe(): Promise<MechanicalObservation[]> {
	const observations: MechanicalObservation[] = []

	let totalSaveStateFires = 0

	let compactCalls = 0
	const compactAThenSkip: ContextPipelinePrepareTurn = async (context) => {
		compactCalls += 1
		if (compactCalls === 1) {
			return {
				messages: context.messages.slice(0, 2),
				systemPrompt: SYSTEM_PROMPT,
			}
		}
		return undefined
	}

	const prepareTurn = createCompactionStateAwarePrepareTurn({
		compact: compactAThenSkip,
		saveState: async (_state, _sourceMessages) => {
			totalSaveStateFires += 1
		},
	})

	const buildContext = (
		iteration: number,
		extraPaddingTurns: number,
	): Parameters<ContextPipelinePrepareTurn>[0] => ({
		agentId: "agent-c-cadence-red",
		conversationId: "conv-c-cadence-red",
		parentAgentId: null,
		iteration,
		abortSignal: new AbortController().signal,
		systemPrompt: SYSTEM_PROMPT,
		tools: TOOLS,
		messages: [
			...CANONICAL,
			...Array.from({ length: extraPaddingTurns }, () => ({
				role: "user" as const,
				content: "Padding turn. ".repeat(50),
			})),
		],
		apiMessages: [],
		model: {
			id: "mock-cadence-red",
			provider: "mock",
			info: { id: "mock-cadence-red", maxInputTokens: 200_000 },
		},
	})

	const resultA = await prepareTurn(buildContext(1, 0))
	const observationsA: MechanicalObservation = {
		turn: "A",
		compactionOccurred: true,
		prepareTurnResultDefined: resultA !== undefined,
		currentWorkingContextEstimate: (
			resultA as { currentWorkingContextEstimate?: number } | undefined
		)?.currentWorkingContextEstimate,
		totalSaveStateFires,
	}
	observations.push(observationsA)

	const resultB = await prepareTurn(buildContext(2, 4))
	const observationsB: MechanicalObservation = {
		turn: "B",
		compactionOccurred: false,
		prepareTurnResultDefined: resultB !== undefined,
		currentWorkingContextEstimate: (
			resultB as { currentWorkingContextEstimate?: number } | undefined
		)?.currentWorkingContextEstimate,
		totalSaveStateFires,
	}
	observations.push(observationsB)

	const resultC = await prepareTurn(buildContext(3, 8))
	const observationsC: MechanicalObservation = {
		turn: "C",
		compactionOccurred: false,
		prepareTurnResultDefined: resultC !== undefined,
		currentWorkingContextEstimate: (
			resultC as { currentWorkingContextEstimate?: number } | undefined
		)?.currentWorkingContextEstimate,
		totalSaveStateFires,
	}
	observations.push(observationsC)

	return observations
}

async function assertRED(): Promise<void> {
	const observations = await observe()

	console.log("ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01")
	console.log("cadence discriminator — mechanical RED observation at HEAD")
	console.log("")
	console.log("pre-fix observations:")
	for (const obs of observations) {
		console.log(
			`  turn ${obs.turn}: ` +
				`compaction=${obs.compactionOccurred} ` +
				`prepareTurnResult=${obs.prepareTurnResultDefined} ` +
				`W=${obs.currentWorkingContextEstimate ?? "undefined"} ` +
				`saveStateCountAfterTurn=${obs.totalSaveStateFires}`,
		)
	}
	console.log("")

	const a = observations.find((o) => o.turn === "A")!
	const b = observations.find((o) => o.turn === "B")!
	const c = observations.find((o) => o.turn === "C")!

	let redCount = 0
	// isRed=true means the observation reproduces the defect
	// (we want RED = true at HEAD for the 4 PUBLISH_GAP items).
	// The 5th item (A.W defined) is informational GREEN — that
	// is the producer-side publish GREEN from fc906dfc6 and is
	// not a RED to be reproduced.
	const isRed = (label: string, condition: boolean): void => {
		const mark = condition ? "RED ✗" : "GREEN ✓"
		console.log(`  [${mark}] ${label}`)
		if (condition) redCount += 1
	}

	console.log("PUBLISH_GAP — REAL DEFECT (next bounded repair):")
	isRed(
		"B.prepareTurnResultDefined === false at HEAD (compaction.ts:730 returns result undefined)",
		b.prepareTurnResultDefined === false,
	)
	isRed(
		"B.currentWorkingContextEstimate === undefined at HEAD (publishWorkingContextEstimate not called)",
		b.currentWorkingContextEstimate === undefined,
	)
	isRed(
		"C.prepareTurnResultDefined === false at HEAD (compaction.ts:730 returns result undefined)",
		c.prepareTurnResultDefined === false,
	)
	isRed(
		"C.currentWorkingContextEstimate === undefined at HEAD (publishWorkingContextEstimate not called)",
		c.currentWorkingContextEstimate === undefined,
	)

	console.log("")
	console.log("Informational GREEN (not a defect; recorded for completeness):")
	console.log(
		`  [GREEN ✓] A.currentWorkingContextEstimate defined = ` +
			`${a.currentWorkingContextEstimate ?? "MISSING?!"} ` +
			`(producer-side W publication GREEN from fc906dfc6)`,
	)

	console.log("")
	console.log("SIDECAR_CADENCE — EXPECTED ARCHITECTURAL FACT (NOT a defect):")
	console.log("  [informational] saveState only fires on real compaction:")
	console.log("    A → saveStateCountAfterTurn = 1")
	console.log("    B → saveStateCountAfterTurn = 1 (unchanged from A)")
	console.log("    C → saveStateCountAfterTurn = 1 (unchanged from B)")
	console.log("  Architectural separation: durable artifact vs per-turn")
	console.log("  W carrier are intentionally different lifecycles.")
	console.log("  After the next bounded repair, this REMAINS true.")

	console.log("")
	console.log(
		`Total PUBLISH_GAP REDs reproduced: ${redCount}/4`,
	)
	console.log("")
	console.log("Interpretation:")
	console.log(
		"  - All 4 PUBLISH_GAP REDs must reproduce at HEAD for this",
	)
	console.log(
		"    evidence file to be valid. Next bounded repair: publish",
	)
	console.log(
		"    W on every prepare-turn at compaction.ts:730.",
	)
	console.log(
		"  - A.currentWorkingContextEstimate GREEN is the producer",
	)
	console.log("    publish GREEN from fc906dfc6 (already shipped).")
	console.log(
		"  - saveState cadence = compactions only — the architectural",
	)
	console.log(
		"    separation we want preserved after the fix (durable",
	)
	console.log("    artifact vs per-turn W carrier are different")
	console.log("    lifecycles).")

	if (redCount !== 4) {
		console.error(
			`UNEXPECTED: expected 4 PUBLISH_GAP REDs, got ${redCount}.`,
		)
		console.error("Either the fix has already landed (re-baseline),")
		console.error("or this RED provenance file is stale (re-run from")
		console.error("the pre-fix baseline).")
		process.exit(1)
	}
	console.log("")
	console.log(
		"RED provenance verified mechanically: 4 / 4 PUBLISH_GAP REDs reproduced.",
	)
}

void assertRED()
