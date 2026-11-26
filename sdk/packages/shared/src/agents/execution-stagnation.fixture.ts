/**
 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-01 (R1)
 *
 * FROZEN FAILURE WITNESS + OFFLINE REPLAY FIXTURE for session
 * `1795606095016_glc2s`.
 *
 * ============================================================================
 * THIS IS NOT A PRODUCTION API. It is a TEST-LOCAL frozen witness module.
 * ============================================================================
 *
 * The session transcript itself is OPERATOR-LOCAL and PRIVATE and is NEVER
 * committed. This module records only the AGGREGATE, NON-CONTENT shape that
 * the ACT contract cites as evidence: the SEQUENCE OF TOOL NAMES per
 * execution round, and the aggregate counts.
 *
 * Tool names are host-defined tool IDENTIFIERS. They are not file contents,
 * not command text, not findings, and not model reasoning.
 *
 * WHAT THE REPLAY DOES AND DOES NOT PROVE
 * ---------------------------------------
 * The offline replay in `execution-stagnation-replay.test.ts` reports WHEN
 * the proposed detector WOULD have intervened on the frozen trajectory. It
 * is a DETECTOR REPLAY, not a behavioral claim: it does NOT prove that the
 * injected instruction would have changed the model's behaviour. Behavioral
 * recovery is established separately, through the real runtime, by
 * `sdk/packages/agents/src/agent-runtime.execution-stagnation-recovery01.test.ts`.
 */

/** The frozen session id this witness records. */
export const FROZEN_STALL_SESSION_ID = "1795606095016_glc2s";

/**
 * The per-round tool-name sequence of the frozen stall, in order.
 *
 * This is the FIRST phase of the session: from the Act-mode task and the
 * execution-transition system prompt, up to (but excluding) the point at
 * which the operator intervened.
 *
 * The sequence is the load-bearing witness: it shows 34 consecutive
 * execution rounds in which the model only INSPECTED (read files, searched,
 * ran read-only shell commands) and never once produced a native edit.
 */
export const FROZEN_STALL_ROUND_TOOL_NAMES: readonly (readonly string[])[] = [
	["run_commands", "myc__myc_recall"],
	["myc__myc_show", "run_commands"],
	["read_files"],
	["run_commands"],
	["run_commands"],
	["read_files"],
	["run_commands"],
	["read_files"],
	["run_commands"],
	["read_files"],
	["read_files"],
	["read_files"],
	["run_commands"],
	["run_commands"],
	["run_commands"],
	["read_files"],
	["read_files"],
	["run_commands"],
	["run_commands"],
	["read_files"],
	["read_files"],
	["read_files"],
	["read_files"],
	["run_commands"],
	["run_commands"],
	["run_commands"],
	["run_commands"],
	["run_commands"],
	["read_files"],
	["read_files"],
	["read_files"],
	["run_commands"],
	["run_commands"],
	["read_files"],
];

/**
 * The aggregate metrics of the frozen stall phase.
 *
 * `nativeEditCalls` is the load-bearing ZERO: the phase produced 36 tool
 * calls and never once edited a file.
 */
export const FROZEN_STALL_METRICS = {
	sessionId: FROZEN_STALL_SESSION_ID,
	/** Model responses (execution rounds) observed before the operator intervened. */
	modelResponses: 34,
	/** Tool calls observed in the phase. */
	toolCalls: 36,
	/** Native edit (file-edit) tool calls. ZERO — the failure. */
	nativeEditCalls: 0,
	/** Distinct tool names used in the phase. */
	distinctToolNames: [
		"myc__myc_recall",
		"myc__myc_show",
		"read_files",
		"run_commands",
	],
	/**
	 * The round at which the decisive Gemini terminal-status probe ran.
	 *
	 * The probe established the defect's mechanism; the trajectory then
	 * RETURNED TO RECONNAISSANCE instead of executing the bounded repair.
	 * This is the round the ACT cites as "identified the relevant production
	 * seam, executed the decisive probe, returned to reconnaissance".
	 */
	decisiveProbeRound: 26,
} as const;
