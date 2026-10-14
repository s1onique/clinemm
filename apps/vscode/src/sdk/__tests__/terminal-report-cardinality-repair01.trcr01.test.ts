// ============================================================================
// ACT-CLINEMM-TERMINAL-REPORT-CARDINALITY-REPAIR01 — TRCR01
//
// Real-seam RED/GREEN test for the bounded restoration-path repair. Asserts
// the post-repair invariants on the production seam
// (sdkMessagesToClineMessages → finalizePersistedToolUse → agentEventToMessages
// content_end) that the new product contract requires.
//
//   1. A submit_and_exit followed by a runtime-control
//      completion_continuation_control user message in the persisted
//      transcript is a HELD submission: its restoration emit must NOT
//      carry isAuthoritativelyCompletedResult:true.
//
//   2. A submit_and_exit NOT followed by such a runtime-control message
//      is a COMMITTED submission (or a legitimate independent episode):
//      its restoration emit MUST carry isAuthoritativelyCompletedResult:true.
//
//   3. Single-shot, no-runtime-control, single-completion → exactly one
//      authoritative row (unchanged from today).
//
//   4. Two independent completions with NO runtime-control in between
//      → both rows authoritative (legitimate multi-episode per ACT §1.5).
//
//   5. Multiple held attempts followed by one committed → only the LAST
//      row is authoritative (no fabrication of authority from ordering).
//
//   6. Legacy transcript with no metadata on the runtime-control user
//      message → conservative: keep BOTH rows authoritative (preserve
//      pre-repair chat surface for legacy / unknown data).
//
// All assertions drive the REAL production function
// (sdkMessagesToClineMessages imported from ../message-translator), not a
// re-implementation.
//
// RED at b24b954db: production stamps isAuthoritativelyCompletedResult:true
// on EVERY submit_and_exit content_end (message-translator.ts:1781) with no
// held-vs-committed distinction. RED assertions fail at b24b954db.
//
// FROZEN at b24b954db (ACT-CLINEMM-BCB-OBSERVABILITY-REPAIR01).
// ============================================================================
import type { MessageWithMetadata } from "@cline/shared"
import { describe, expect, it } from "vitest"
import { sdkMessagesToClineMessages } from "../message-translator"
import type { ClineMessage } from "@shared/ExtensionMessage"
import { resolveTerminalReportFraming } from "../../../webview-ui/src/components/chat/terminalReportFraming"

const SUMMARY_A = "First-submit summary (length 3895) — see live transcript"
const SUMMARY_B = "Second-submit summary (length 2398) — see live transcript"
const SUMMARY_C = "Third-submit summary — independent legitimate second completion episode"
const SUMMARY_D = "Fourth-submit summary — Fixture G second-episode committed"
const TEXT_BEFORE_FIRST = "The verdict is clear and consistent. Let me submit the final report."
const TEXT_AFTER_HELD = "The held job cmd_mv6mq5t8qhepcxxm has been observed."
const TEXT_INDEPENDENT = "First legitimate completion done; now starting an independent second task."
const TEXT_FOLLOWUP_BEFORE_LATER_HELD = "Now follow-up before the next completion."
const TEXT_FOLLOWUP_BETWEEN_EPISODES = "User follow-up between Fixture G episodes."

const RESTORE_OPTS = { finalTurnCompleted: true as const, cwd: "/repo" }

type AnyMsg = MessageWithMetadata & { metadata?: Record<string, unknown> }

function buildHeldThenCommittedFixture(): AnyMsg[] {
	return [
		{ role: "user", content: [{ type: "text", text: "<user_input mode=\"act\"># ACT task</user_input>" }] },
		{
			role: "assistant",
			id: "msg_held",
			ts: 1791893907206,
			content: [
				{ type: "text", text: TEXT_BEFORE_FIRST },
				{ type: "tool_use", id: "call_function_xxakngsgiq8s_1", name: "submit_and_exit", input: { summary: SUMMARY_A } },
			],
		},
		{
			role: "user",
			id: "msg_tool_result_held",
			ts: 1791893907220,
			content: [{ type: "tool_result", tool_use_id: "call_function_xxakngsgiq8s_1", name: "submit_and_exit", content: "submitted (verified=true)" }],
		},
		{
			role: "user",
			id: "runtime-control-1791893907292",
			ts: 1791893907292,
			metadata: { runtimeAuthority: "host_runtime_control", kind: "completion_continuation_control" },
			content: [{ type: "text", text: "<user_input mode=\"act\">A deferred completion is requesting observation of unconsumed terminal results.</user_input>" }],
		},
		{
			role: "assistant",
			id: "msg_committed",
			ts: 1791893920497,
			content: [
				{ type: "text", text: TEXT_AFTER_HELD },
				{ type: "tool_use", id: "call_function_jyd622908p3h_1", name: "submit_and_exit", input: { summary: SUMMARY_B } },
			],
		},
		{
			role: "user",
			id: "msg_tool_result_committed",
			ts: 1791893920510,
			content: [{ type: "tool_result", tool_use_id: "call_function_jyd622908p3h_1", name: "submit_and_exit", content: "submitted (verified=true)" }],
		},
	]
}

function buildTwoHeldThenCommittedFixture(): AnyMsg[] {
	return [
		{ role: "user", content: [{ type: "text", text: "<user_input mode=\"act\"># task</user_input>" }] },
		{
			role: "assistant",
			id: "msg_held1",
			ts: 100,
			content: [
				{ type: "text", text: "First try" },
				{ type: "tool_use", id: "call_function_h1_1", name: "submit_and_exit", input: { summary: SUMMARY_A } },
			],
		},
		{
			role: "user",
			id: "msg_tr_h1",
			ts: 110,
			content: [{ type: "tool_result", tool_use_id: "call_function_h1_1", name: "submit_and_exit", content: "submitted (verified=true)" }],
		},
		{
			role: "user",
			id: "runtime-control-1",
			ts: 120,
			metadata: { runtimeAuthority: "host_runtime_control", kind: "completion_continuation_control" },
			content: [{ type: "text", text: "<user_input mode=\"act\">observe</user_input>" }],
		},
		{
			role: "assistant",
			id: "msg_held2",
			ts: 200,
			content: [
				{ type: "text", text: "Second try" },
				{ type: "tool_use", id: "call_function_h2_1", name: "submit_and_exit", input: { summary: SUMMARY_B } },
			],
		},
		{
			role: "user",
			id: "msg_tr_h2",
			ts: 210,
			content: [{ type: "tool_result", tool_use_id: "call_function_h2_1", name: "submit_and_exit", content: "submitted (verified=true)" }],
		},
		{
			role: "user",
			id: "runtime-control-2",
			ts: 220,
			metadata: { runtimeAuthority: "host_runtime_control", kind: "completion_continuation_control" },
			content: [{ type: "text", text: "<user_input mode=\"act\">observe again</user_input>" }],
		},
		{
			role: "assistant",
			id: "msg_committed",
			ts: 300,
			content: [
				{ type: "text", text: "Third try committed" },
				{ type: "tool_use", id: "call_function_c_1", name: "submit_and_exit", input: { summary: SUMMARY_C } },
			],
		},
		{
			role: "user",
			id: "msg_tr_c",
			ts: 310,
			content: [{ type: "tool_result", tool_use_id: "call_function_c_1", name: "submit_and_exit", content: "submitted (verified=true)" }],
		},
	]
}

function buildSingleCommitFixture(): AnyMsg[] {
	return [
		{ role: "user", content: [{ type: "text", text: "<user_input mode=\"act\"># task</user_input>" }] },
		{
			role: "assistant",
			id: "msg_single",
			ts: 100,
			content: [
				{ type: "text", text: "Wrapping up." },
				{ type: "tool_use", id: "call_function_single_1", name: "submit_and_exit", input: { summary: SUMMARY_A } },
			],
		},
		{
			role: "user",
			id: "msg_tool_result_single",
			ts: 110,
			content: [{ type: "tool_result", tool_use_id: "call_function_single_1", name: "submit_and_exit", content: "submitted (verified=true)" }],
		},
	]
}

function buildLegacyUnknownShapeFixture(): AnyMsg[] {
	return [
		{ role: "user", content: [{ type: "text", text: "<user_input mode=\"act\"># task</user_input>" }] },
		{
			role: "assistant",
			id: "msg_held",
			ts: 100,
			content: [
				{ type: "text", text: "Held" },
				{ type: "tool_use", id: "call_function_h_1", name: "submit_and_exit", input: { summary: SUMMARY_A } },
			],
		},
		{
			role: "user",
			id: "msg_tr_h",
			ts: 110,
			content: [{ type: "tool_result", tool_use_id: "call_function_h_1", name: "submit_and_exit", content: "submitted (verified=true)" }],
		},
		{
			role: "user",
			id: "legacy-runtime-prompt",
			ts: 120,
			content: [{ type: "text", text: "<user_input mode=\"act\">some other text</user_input>" }],
		},
		{
			role: "assistant",
			id: "msg_committed",
			ts: 200,
			content: [
				{ type: "text", text: "Committed" },
				{ type: "tool_use", id: "call_function_c_1", name: "submit_and_exit", input: { summary: SUMMARY_B } },
			],
		},
		{
			role: "user",
			id: "msg_tr_c",
			ts: 210,
			content: [{ type: "tool_result", tool_use_id: "call_function_c_1", name: "submit_and_exit", content: "submitted (verified=true)" }],
		},
	]
}

function buildTwoLegitimateEpisodesFixture(): AnyMsg[] {
	return [
		{ role: "user", content: [{ type: "text", text: "<user_input mode=\"act\"># task</user_input>" }] },
		{
			role: "assistant",
			id: "msg_first",
			ts: 100,
			content: [
				{ type: "text", text: "Done with episode 1." },
				{ type: "tool_use", id: "call_function_first_1", name: "submit_and_exit", input: { summary: SUMMARY_A } },
			],
		},
		{
			role: "user",
			id: "msg_tool_result_first",
			ts: 110,
			content: [{ type: "tool_result", tool_use_id: "call_function_first_1", name: "submit_and_exit", content: "submitted (verified=true)" }],
		},
		{
			role: "user",
			id: "msg_new_task",
			ts: 120,
			content: [{ type: "text", text: "Now please also do the second thing." }],
		},
		{
			role: "assistant",
			id: "msg_second",
			ts: 200,
			content: [
				{ type: "text", text: TEXT_INDEPENDENT },
				{ type: "tool_use", id: "call_function_second_1", name: "submit_and_exit", input: { summary: SUMMARY_C } },
			],
		},
		{
			role: "user",
			id: "msg_tool_result_second",
			ts: 210,
			content: [{ type: "tool_result", tool_use_id: "call_function_second_1", name: "submit_and_exit", content: "submitted (verified=true)" }],
		},
	]
}

// ============================================================================
// ACT-CLINEMM-TERMINAL-REPORT-CARDINALITY-REPAIR01-CORR01 — Fixtures F + G
//
// RED discriminator: a completion is HELD iff a runtime-control
// completion_continuation_control user message exists in the
// source-transcript interval (trIdx, nextCompletionToolUseIdx). This is
// the nearest-eligible-prior-correlation test — the runtime-control
// is the host's "observe before re-issuing" prompt, and the completion
// that immediately precedes it in the transcript is the one the
// control defers. Every later completion in that interval
// is COMMITTED (or, for the new attempt, a fresh episode).
//
// Fixture F (mixed episode: committed → later held → committed):
//
//   submit A → committed
//   user follow-up
//   submit B → held
//   runtime-control → observe
//   submit C → committed
//
// Expected authoritative markers:
//   A = true      (committed: no runtime-control between A's tool_result
//                  and the next completion B's tool_use)
//   B = absent    (held: runtime-control between B's tool_result and
//                  the next completion C's tool_use)
//   C = true      (committed: no runtime-control after C's tool_result)
//
// Fixture G (multiple independent episodes with holds):
//
//   submit A → held
//   runtime-control A
//   submit B → committed
//   (user follow-up between episodes)
//   submit C → held
//   runtime-control C
//   submit D → committed
//
// Expected authoritative markers:
//   A = absent    (held: runtime-control A in (trIdx_A, trIdx_B))
//   B = true      (committed: no runtime-control in (trIdx_B, trIdx_C))
//   C = absent    (held: runtime-control C in (trIdx_C, trIdx_D))
//   D = true      (committed: no runtime-control after trIdx_D)
//
// Both fixtures RED the pre-fix implementation: a naive
// "is there ANY later runtime-control?" test wrongly marks A in F and
// B in G as held (and consequently fails the multi-episode
// contract).
// ============================================================================

function buildCommittedThenHeldThenCommittedFixture(): AnyMsg[] {
	return [
		{ role: "user", content: [{ type: "text", text: "<user_input mode=\"act\"># ACT task F</user_input>" }] },
		{
			role: "assistant",
			id: "msg_F_A",
			ts: 100,
			content: [
				{ type: "text", text: TEXT_BEFORE_FIRST },
				{ type: "tool_use", id: "call_function_F_A_1", name: "submit_and_exit", input: { summary: SUMMARY_A } },
			],
		},
		{
			role: "user",
			id: "msg_F_tr_A",
			ts: 110,
			content: [
				{ type: "tool_result", tool_use_id: "call_function_F_A_1", name: "submit_and_exit", content: "submitted (verified=true)" },
			],
		},
		// User follow-up between A and B.
		{
			role: "user",
			id: "msg_F_followup",
			ts: 150,
			content: [{ type: "text", text: TEXT_FOLLOWUP_BEFORE_LATER_HELD }],
		},
		// B is HELD.
		{
			role: "assistant",
			id: "msg_F_B",
			ts: 200,
			content: [
				{ type: "text", text: "Submit B" },
				{ type: "tool_use", id: "call_function_F_B_1", name: "submit_and_exit", input: { summary: SUMMARY_B } },
			],
		},
		{
			role: "user",
			id: "msg_F_tr_B",
			ts: 210,
			content: [
				{ type: "tool_result", tool_use_id: "call_function_F_B_1", name: "submit_and_exit", content: "submitted (verified=true)" },
			],
		},
		// Host runtime-control observes B (the immediately-prior completion).
		{
			role: "user",
			id: "runtime-control-F",
			ts: 220,
			metadata: { runtimeAuthority: "host_runtime_control", kind: "completion_continuation_control" },
			content: [{ type: "text", text: "<user_input mode=\"act\">observe B</user_input>" }],
		},
		// Agent re-issues completion C (COMMITTED).
		{
			role: "assistant",
			id: "msg_F_C",
			ts: 300,
			content: [
				{ type: "text", text: "Submit C (re-issued after observation)" },
				{ type: "tool_use", id: "call_function_F_C_1", name: "submit_and_exit", input: { summary: SUMMARY_C } },
			],
		},
		{
			role: "user",
			id: "msg_F_tr_C",
			ts: 310,
			content: [
				{ type: "tool_result", tool_use_id: "call_function_F_C_1", name: "submit_and_exit", content: "submitted (verified=true)" },
			],
		},
	]
}

function buildMultipleEpisodesWithHoldsFixture(): AnyMsg[] {
	return [
		{ role: "user", content: [{ type: "text", text: "<user_input mode=\"act\"># ACT task G</user_input>" }] },
		// Episode 1: A is HELD, B is COMMITTED.
		{
			role: "assistant",
			id: "msg_G_A",
			ts: 100,
			content: [
				{ type: "text", text: "Episode 1 first try" },
				{ type: "tool_use", id: "call_function_G_A_1", name: "submit_and_exit", input: { summary: SUMMARY_A } },
			],
		},
		{
			role: "user",
			id: "msg_G_tr_A",
			ts: 110,
			content: [
				{ type: "tool_result", tool_use_id: "call_function_G_A_1", name: "submit_and_exit", content: "submitted (verified=true)" },
			],
		},
		{
			role: "user",
			id: "runtime-control-G1",
			ts: 120,
			metadata: { runtimeAuthority: "host_runtime_control", kind: "completion_continuation_control" },
			content: [{ type: "text", text: "<user_input mode=\"act\">observe A</user_input>" }],
		},
		{
			role: "assistant",
			id: "msg_G_B",
			ts: 200,
			content: [
				{ type: "text", text: "Episode 1 second try (re-issued)" },
				{ type: "tool_use", id: "call_function_G_B_1", name: "submit_and_exit", input: { summary: SUMMARY_B } },
			],
		},
		{
			role: "user",
			id: "msg_G_tr_B",
			ts: 210,
			content: [
				{ type: "tool_result", tool_use_id: "call_function_G_B_1", name: "submit_and_exit", content: "submitted (verified=true)" },
			],
		},
		// User follow-up between episodes.
		{
			role: "user",
			id: "msg_G_followup",
			ts: 250,
			content: [{ type: "text", text: TEXT_FOLLOWUP_BETWEEN_EPISODES }],
		},
		// Episode 2: C is HELD, D is COMMITTED.
		{
			role: "assistant",
			id: "msg_G_C",
			ts: 300,
			content: [
				{ type: "text", text: "Episode 2 first try" },
				{ type: "tool_use", id: "call_function_G_C_1", name: "submit_and_exit", input: { summary: SUMMARY_C } },
			],
		},
		{
			role: "user",
			id: "msg_G_tr_C",
			ts: 310,
			content: [
				{ type: "tool_result", tool_use_id: "call_function_G_C_1", name: "submit_and_exit", content: "submitted (verified=true)" },
			],
		},
		{
			role: "user",
			id: "runtime-control-G2",
			ts: 320,
			metadata: { runtimeAuthority: "host_runtime_control", kind: "completion_continuation_control" },
			content: [{ type: "text", text: "<user_input mode=\"act\">observe C</user_input>" }],
		},
		{
			role: "assistant",
			id: "msg_G_D",
			ts: 400,
			content: [
				{ type: "text", text: "Episode 2 second try (re-issued)" },
				{ type: "tool_use", id: "call_function_G_D_1", name: "submit_and_exit", input: { summary: SUMMARY_D } },
			],
		},
		{
			role: "user",
			id: "msg_G_tr_D",
			ts: 410,
			content: [
				{ type: "tool_result", tool_use_id: "call_function_G_D_1", name: "submit_and_exit", content: "submitted (verified=true)" },
			],
		},
	]
}

function completionRows(messages: ClineMessage[]) {
	return messages.filter((m) => m.type === "say" && m.say === "completion_result")
}
function getSummary(row: ClineMessage): string {
	return typeof row.text === "string" ? row.text : ""
}

describe("ACT-CLINEMM-TERMINAL-REPORT-CARDINALITY-REPAIR01 — TRCR01 (held-vs-committed at restoration)", () => {
	it("Fixture A: held submit_and_exit is NOT marked authoritative; committed one IS; both summary texts preserved", () => {
		const clineMessages = sdkMessagesToClineMessages(
			buildHeldThenCommittedFixture() as MessageWithMetadata[],
			undefined,
			RESTORE_OPTS,
		)
		const rows = completionRows(clineMessages)
		expect(rows).toHaveLength(2)

		// Both summary texts MUST be preserved (historical activity, ACT §1.4).
		const summaries = rows.map(getSummary).sort()
		expect(summaries).toEqual([SUMMARY_A, SUMMARY_B].sort())

		// Authority classification:
		//   - FIRST (held) submit_and_exit HAS a runtime-control
		//     completion_continuation_control user message AFTER its
		//     tool_result. Its emit MUST NOT carry the marker.
		//   - SECOND (committed) submit_and_exit is the LAST completion
		//     tool in the transcript and has no runtime-control after it.
		//     Its emit MUST carry the marker.
		const heldRow = rows.find((r) => getSummary(r) === SUMMARY_A)
		const committedRow = rows.find((r) => getSummary(r) === SUMMARY_B)
		expect(heldRow).toBeDefined()
		expect(committedRow).toBeDefined()
		expect(heldRow!.isAuthoritativelyCompletedResult).not.toBe(true)
		expect(committedRow!.isAuthoritativelyCompletedResult).toBe(true)

		// Exactly ONE authoritative row in the transcript.
		const authoritativeCount = rows.filter((r) => r.isAuthoritativelyCompletedResult === true).length
		expect(authoritativeCount).toBe(1)
	})

	it("Fixture B: single submit_and_exit with no runtime-control in transcript → exactly one authoritative row", () => {
		const clineMessages = sdkMessagesToClineMessages(
			buildSingleCommitFixture() as MessageWithMetadata[],
			undefined,
			RESTORE_OPTS,
		)
		const rows = completionRows(clineMessages)
		expect(rows).toHaveLength(1)
		expect(rows[0].isAuthoritativelyCompletedResult).toBe(true)
		expect(getSummary(rows[0])).toBe(SUMMARY_A)
	})

	it("Fixture C: two LEGITIMATE independent completion episodes with NO runtime-control → both authoritative (multi-episode contract)", () => {
		const clineMessages = sdkMessagesToClineMessages(
			buildTwoLegitimateEpisodesFixture() as MessageWithMetadata[],
			undefined,
			RESTORE_OPTS,
		)
		const rows = completionRows(clineMessages)
		expect(rows).toHaveLength(2)
		for (const row of rows) {
			expect(row.isAuthoritativelyCompletedResult).toBe(true)
		}
		const summaries = rows.map(getSummary).sort()
		expect(summaries).toEqual([SUMMARY_A, SUMMARY_C].sort())
	})

	it("Fixture D: two HELD attempts followed by one committed → only the committed row is authoritative", () => {
		const clineMessages = sdkMessagesToClineMessages(
			buildTwoHeldThenCommittedFixture() as MessageWithMetadata[],
			undefined,
			RESTORE_OPTS,
		)
		const rows = completionRows(clineMessages)
		expect(rows).toHaveLength(3)

		const authoritativeRows = rows.filter((r) => r.isAuthoritativelyCompletedResult === true)
		expect(authoritativeRows).toHaveLength(1)
		expect(getSummary(authoritativeRows[0])).toBe(SUMMARY_C)

		const nonAuthoritativeRows = rows.filter((r) => r.isAuthoritativelyCompletedResult !== true)
		expect(nonAuthoritativeRows).toHaveLength(2)
		const nonAuthoritativeSummaries = nonAuthoritativeRows.map(getSummary).sort()
		expect(nonAuthoritativeSummaries).toEqual([SUMMARY_A, SUMMARY_B].sort())
	})

	it("Fixture E: legacy / unknown runtime-control shape (no metadata.kind) → conservative: both rows stay authoritative (no fabrication of held-ness)", () => {
		const clineMessages = sdkMessagesToClineMessages(
			buildLegacyUnknownShapeFixture() as MessageWithMetadata[],
			undefined,
			RESTORE_OPTS,
		)
		const rows = completionRows(clineMessages)
		expect(rows).toHaveLength(2)
		for (const row of rows) {
			expect(row.isAuthoritativelyCompletedResult).toBe(true)
		}
	})

	// ==========================================================================
	// CORR01 RED discriminator: a completion is HELD iff the nearest-eligible
	// runtime-control completion_continuation_control user message sits in
	// the source-transcript interval (trIdx, nextCompletionToolUseIdx).
	// Earlier completions that completed BEFORE the held episode must
	// remain authoritative even though a later completion is HELD (Fixture F).
	// Later completions that completed AFTER the held episode, in a fresh
	// episode, must remain authoritative too (Fixture G).
	// ==========================================================================

	it("Fixture F (CORR01 RED): committed A is authoritative; held B is NOT; committed C IS — early committed A must NOT be revoked by the later held episode", () => {
		const clineMessages = sdkMessagesToClineMessages(
			buildCommittedThenHeldThenCommittedFixture() as MessageWithMetadata[],
			undefined,
			RESTORE_OPTS,
		)
		const rows = completionRows(clineMessages)
		expect(rows).toHaveLength(3)

		// All three summary texts preserved as historical activity.
		const summaries = rows.map(getSummary).sort()
		expect(summaries).toEqual([SUMMARY_A, SUMMARY_B, SUMMARY_C].sort())

		const rowA = rows.find((r) => getSummary(r) === SUMMARY_A)
		const rowB = rows.find((r) => getSummary(r) === SUMMARY_B)
		const rowC = rows.find((r) => getSummary(r) === SUMMARY_C)
		expect(rowA).toBeDefined()
		expect(rowB).toBeDefined()
		expect(rowC).toBeDefined()

		// A is COMMITTED — its tool_result precedes the held-episode
		// completion B (and any runtime-control for B). The pre-CORR01
		// code wrongly revoked A because the runtime-control for B sat
		// after A's tool_result too.
		expect(rowA!.isAuthoritativelyCompletedResult).toBe(true)

		// B is HELD — the runtime-control sits between B's tool_result
		// and the next completion C's tool_use. B is the immediately
		// preceding completion to the runtime-control.
		expect(rowB!.isAuthoritativelyCompletedResult).not.toBe(true)

		// C is COMMITTED — no runtime-control after C's tool_result.
		expect(rowC!.isAuthoritativelyCompletedResult).toBe(true)
	})

	it("Fixture G (CORR01 RED): multi-episode with holds — A and C are HELD; B and D are committed; second episode must NOT be tainted by first episode's runtime-control", () => {
		const clineMessages = sdkMessagesToClineMessages(
			buildMultipleEpisodesWithHoldsFixture() as MessageWithMetadata[],
			undefined,
			RESTORE_OPTS,
		)
		const rows = completionRows(clineMessages)
		expect(rows).toHaveLength(4)

		// All four summary texts preserved as historical activity.
		const summaries = rows.map(getSummary).sort()
		expect(summaries).toEqual([SUMMARY_A, SUMMARY_B, SUMMARY_C, SUMMARY_D].sort())

		const rowA = rows.find((r) => getSummary(r) === SUMMARY_A)
		const rowB = rows.find((r) => getSummary(r) === SUMMARY_B)
		const rowC = rows.find((r) => getSummary(r) === SUMMARY_C)
		const rowD = rows.find((r) => getSummary(r) === SUMMARY_D)
		expect(rowA).toBeDefined()
		expect(rowB).toBeDefined()
		expect(rowC).toBeDefined()
		expect(rowD).toBeDefined()

		// A is HELD — runtime-control A in (trIdx_A, trIdx_B).
		expect(rowA!.isAuthoritativelyCompletedResult).not.toBe(true)

		// B is COMMITTED — no runtime-control in (trIdx_B, trIdx_C).
		// The pre-CORR01 code wrongly revoked B because a LATER
		// runtime-control (for C) sat after B's tool_result.
		expect(rowB!.isAuthoritativelyCompletedResult).toBe(true)

		// C is HELD — runtime-control C in (trIdx_C, trIdx_D).
		expect(rowC!.isAuthoritativelyCompletedResult).not.toBe(true)

		// D is COMMITTED — no runtime-control after trIdx_D.
		expect(rowD!.isAuthoritativelyCompletedResult).toBe(true)
	})

	// ==========================================================================
	// CORR01 §4 framing projection: drive the REAL
	// `resolveTerminalReportFraming` (the webview's primary
	// "is this row a Completed card?" decision) over the real restored
	// messages from Fixture F, and assert the actual framing for each
	// row — not merely the marker count. The committed rows must receive
	// a `Completed` framing; the held row must NOT receive a `Completed`
	// framing. All three rows are preserved as historical activity.
	// ==========================================================================

	it("Fixture F framing: committed A and committed C receive `Completed` framing; held B does NOT — historical summaries all preserved", () => {
		const clineMessages = sdkMessagesToClineMessages(
			buildCommittedThenHeldThenCommittedFixture() as MessageWithMetadata[],
			undefined,
			RESTORE_OPTS,
		)
		const rows = completionRows(clineMessages)
		expect(rows).toHaveLength(3)

		const rowA = rows.find((r) => getSummary(r) === SUMMARY_A)
		const rowB = rows.find((r) => getSummary(r) === SUMMARY_B)
		const rowC = rows.find((r) => getSummary(r) === SUMMARY_C)
		expect(rowA).toBeDefined()
		expect(rowB).toBeDefined()
		expect(rowC).toBeDefined()

		// Historical activity: all three summary texts preserved.
		expect(getSummary(rowA!)).toBe(SUMMARY_A)
		expect(getSummary(rowB!)).toBe(SUMMARY_B)
		expect(getSummary(rowC!)).toBe(SUMMARY_C)

		// Drive the REAL `resolveTerminalReportFraming` over each row.
		// (mode = "act" → primary marker path is active; turnState is
		// "completed" so the legacy ask fallback would also be active,
		// but the test asserts the PRIMARY marker path drives the
		// outcome because the per-row marker is the canonical
		// identity.)
		const framingA = resolveTerminalReportFraming({
			message: rowA!,
			turnState: { phase: "completed", seq: 1 },
			mode: "act",
		})
		const framingB = resolveTerminalReportFraming({
			message: rowB!,
			turnState: { phase: "completed", seq: 1 },
			mode: "act",
		})
		const framingC = resolveTerminalReportFraming({
			message: rowC!,
			turnState: { phase: "completed", seq: 1 },
			mode: "act",
		})

		// Committed A receives the "Completed" framing.
		expect(framingA?.kind).toBe("completed")
		expect(framingA?.label).toBe("Completed")

		// Held B does NOT receive the "Completed" framing (the held row
		// is preserved as historical activity but has no "Completed"
		// badge). The framing is undefined for the held row.
		expect(framingB).toBeUndefined()

		// Committed C receives the "Completed" framing.
		expect(framingC?.kind).toBe("completed")
		expect(framingC?.label).toBe("Completed")
	})
})
