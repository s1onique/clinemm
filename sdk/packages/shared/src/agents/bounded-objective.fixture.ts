/**
 * ACT-CLINEMM-AUTONOMOUS-EXECUTION-RECOVERY-R2-01
 *
 * FROZEN FAILURE WITNESS + OFFLINE DISCRIMINATOR FIXTURE for session
 * `1795612311440_l9mhl`.
 *
 * ============================================================================
 * THIS IS NOT A PRODUCTION API. It is a TEST-LOCAL frozen witness module.
 * ============================================================================
 *
 * The session transcript itself is OPERATOR-LOCAL and PRIVATE and is NEVER
 * committed. This module records only the AGGREGATE, NON-CONTENT shape that
 * the ACT contract cites as accepted evidence: the SEQUENCE OF TOOL NAMES
 * per execution round, and the aggregate counts.
 *
 * Tool names are host-defined tool IDENTIFIERS. They are not file contents,
 * not command text, not findings, and not model reasoning.
 *
 * WHAT THE REPLAY DOES AND DOES NOT PROVE
 * ---------------------------------------
 * The offline replay reports WHEN R2 WOULD HAVE BECOME ELIGIBLE on the
 * frozen trajectory, and WHICH facts were available at each historical
 * decision point. It is an ELIGIBILITY REPLAY, not a behavioral claim: it
 * does NOT prove that the model would select a useful objective, nor that
 * the live failure recovers behaviorally.
 *
 * Behavioral recovery is established separately, through the real runtime,
 * by `sdk/packages/agents/src/agent-runtime.bounded-objective-recovery02.test.ts`.
 *
 * THE OFFLINE REPLAY NEVER USES A FUTURE OBSERVATION
 * ---------------------------------------------------
 * Every decision point in the replay uses ONLY the facts observed SO FAR.
 * A later round can never reclassify an earlier one. This is the property
 * that makes the eligibility boundary defensible.
 */

/** The frozen session id this witness records. */
export const FROZEN_R2_SESSION_ID = "1795612311440_l9mhl";

/**
 * The extension build that produced the frozen session.
 *
 * It embeds the accepted R1 qualification anchor, so the frozen trajectory
 * ALREADY carried R1's corrective instructions.
 */
export const FROZEN_R2_EXTENSION_VERSION = "4.1.26-b5bf8d34f";

/**
 * The workload the frozen session was executing.
 */
export const FROZEN_R2_WORKLOAD = "ACT-INFRA-BASALT-LIFECYCLE-CORR02";

/**
 * The model configuration of the frozen session.
 *
 * The effective per-response generation allowance was the built-in 8192
 * default, and the effort was Low.
 */
export const FROZEN_R2_MODEL = {
	provider: "minimax",
	modelId: "MiniMax-M3.1-Flash",
	reasoningEffort: "low",
	maxOutputTokens: 8192,
} as const;

/**
 * The per-round tool-name sequence of the frozen stall, in order.
 *
 * This is the load-bearing witness: it shows the trajectory's OBSERVABLE
 * shape. Every round used only inspection tools and never once produced a
 * native edit.
 *
 * The sequence is recorded from the ACCEPTED EVIDENCE of the frozen
 * session: the workload performed legitimate preparatory work (including
 * installing the Linux amd64 Nim compiler) but never transitioned into
 * implementation.
 */
export const FROZEN_R2_ROUND_TOOL_NAMES: readonly (readonly string[])[] = [
	["run_commands"],
	["read_files"],
	["run_commands"],
	["read_files"],
	["run_commands"],
	["read_files"],
	["read_files"],
	["run_commands"],
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
	["run_commands"],
	["read_files"],
	["read_files"],
	["read_files"],
	["read_files"],
	["run_commands"],
	["run_commands"],
	["run_commands"],
	["read_files"],
	["read_files"],
	["read_files"],
	["run_commands"],
	["run_commands"],
	["read_files"],
	["read_files"],
	["run_commands"],
	["read_files"],
];

/**
 * The aggregate metrics of the frozen stall.
 *
 * `nativeEditCalls` is the load-bearing ZERO: the phase produced tool calls
 * and never once edited a file.
 */
export const FROZEN_R2_METRICS = {
	sessionId: FROZEN_R2_SESSION_ID,
	extensionVersion: FROZEN_R2_EXTENSION_VERSION,
	workload: FROZEN_R2_WORKLOAD,
	/** Model responses (execution rounds) observed in the phase. */
	modelResponses: 36,
	/** Tool calls observed in the phase. */
	toolCalls: 36,
	/** Native edit (file-edit) tool calls. ZERO — the failure. */
	nativeEditCalls: 0,
	/** Distinct tool names used in the phase. */
	distinctToolNames: ["read_files", "run_commands"],
	/**
	 * The number of SDK captures that specify `maxOutputTokens = 8192`.
	 *
	 * All of them: the effective per-response generation allowance was
	 * uniform across the whole trajectory.
	 */
	capturesWithMaxOutputTokens8192: 36,
	/** Total captures observed. */
	totalCaptures: 36,
	/** Verified reasoning occurrences, all retaining exact text and signatures. */
	verifiedReasoningOccurrences: 307,
	/** The effort that was conserved across compaction. */
	conservedReasoningEffort: "low",
	/** Whether the native editor was available throughout. */
	nativeEditorAvailableThroughout: true,
	/** How many R1 corrective instructions reached the actual SDK prompts. */
	r1InstructionsDelivered: 2,
	/** Whether both R1 instructions remained present in later requests. */
	r1InstructionsConservedInLaterRequests: true,
	/** Whether the recovery allowance was conserved across compaction. */
	recoveryAllowanceConservedAcrossCompaction: true,
	/** The approximate wall-clock duration of the phase, in milliseconds. */
	elapsedMsApprox: 522_000,
	/** The approximate cumulative reported input tokens. */
	cumulativeReportedInputTokensApprox: 1_310_000,
	/** The recorded reasoning characters. */
	recordedReasoningCharacters: 162_338,
	/** Whether the phase produced any net repository change. */
	netRepositoryChanges: false,
	/** Whether the Linux amd64 Nim compiler was successfully installed. */
	linuxAmd64NimCompilerInstalled: true,
	/** Whether a Nim lifecycle implementation was started. */
	nimLifecycleImplementationStarted: false,
} as const;
