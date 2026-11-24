/**
 * ACT-CLINEMM-PCK-OUTPUT-TRUST-BOUNDARY-01
 *
 * TEST-LOCAL fully SYNTHETIC fixture for the publication-boundary RED.
 *
 * ============================================================================
 * THIS IS NOT A PRODUCTION API. It is a TEST-LOCAL measurement module.
 * ============================================================================
 *
 * EVERYTHING IN THIS FILE IS SYNTHETIC.
 *
 * There is no real credential, no real session, no real repository content
 * and no real provider payload in this fixture. The tool call ids, the message
 * ids, the tool-result bodies and the "secret" values are all invented for
 * the purpose of exercising the publication seam. The dummy secret carries a
 * `DO-NOT-USE` marker precisely so that no reader can mistake it for a live
 * value.
 */

import type { MessageWithMetadata } from "@cline/shared";
import {
	SYNTHETIC_DUMMY_SECRET,
	SYNTHETIC_INJECTION,
	SYNTHETIC_OPAQUE_DUMMY,
	SYNTHETIC_VALID_TOOL_CALL_ID,
} from "./publication-gate";

/**
 * The canonical message id of the synthetic tool result.
 */
export const SYNTHETIC_RESULT_MESSAGE_ID = "msg_synthetic_result";

/**
 * The canonical message id of the synthetic tool call.
 */
export const SYNTHETIC_CALL_MESSAGE_ID = "msg_synthetic_call";

/**
 * The canonical tool-call id used by the synthetic fixture.
 *
 * It EXISTS in the canonical fixture below, so the reference resolver in the
 * predecessor's `trust.ts` genuinely resolves it.
 */
export { SYNTHETIC_VALID_TOOL_CALL_ID };

/**
 * The synthetic tool-result BODY that carries the dummy secret.
 *
 * The body is ordinary command output. It contains the dummy secret once, in
 * an ordinary configuration-looking line.
 */
export const SYNTHETIC_SECRET_BODY = [
	"# deployment configuration (synthetic)",
	`DB_PASSWORD=${SYNTHETIC_DUMMY_SECRET}`,
	"service=payments-api",
].join("\n");

/**
 * Build the canonical history for the confidentiality counterexample.
 *
 * The history contains:
 *
 *   - ONE assistant message carrying a `run_commands` tool_use block with the
 *     id `call_VALID`,
 *   - ONE user message carrying the matching tool_result whose body contains
 *     the dummy secret.
 *
 * The tool call id is UNIQUE in the history, so the predecessor's reference
 * resolver resolves it to `VERIFIED_EXECUTION_STATUS` — that is, the identity
 * resolves while the semantic support does NOT.
 */
export function syntheticConfidentialityHistory(
	body: string = SYNTHETIC_SECRET_BODY,
): MessageWithMetadata[] {
	return [
		{
			role: "assistant",
			id: SYNTHETIC_CALL_MESSAGE_ID,
			content: [
				{
					type: "tool_use",
					id: SYNTHETIC_VALID_TOOL_CALL_ID,
					name: "run_commands",
					input: { command: "cat deployment.env" },
				},
			],
		} as unknown as MessageWithMetadata,
		{
			role: "user",
			id: SYNTHETIC_RESULT_MESSAGE_ID,
			content: [
				{
					type: "tool_result",
					tool_use_id: SYNTHETIC_VALID_TOOL_CALL_ID,
					content: [
						{ query: "cat deployment.env", result: body, success: true },
					],
				},
			],
		} as unknown as MessageWithMetadata,
	];
}

/**
 * Build the canonical history for the prompt-injection counterexample.
 *
 * The tool-result body is the synthetic injection text. The tool call
 * SUCCEEDED — the point of the case is that a successful command does not
 * make its output an instruction.
 */
export function syntheticInjectionHistory(): MessageWithMetadata[] {
	return syntheticConfidentialityHistory(SYNTHETIC_INJECTION);
}

/**
 * The candidate that copies the dummy secret out of the tool result into the
 * model-authored `statement`.
 *
 * It cites the VALID canonical reference, so the reference resolves, and its
 * execution status is successful, so the assurance bound yields
 * `tool_observed`. Neither fact says anything about whether the statement's
 * TEXT may be published.
 */
export const CONFIDENTIALITY_CANDIDATE = {
	id: "checkpoint-001",
	kind: "observation",
	assurance: "tool_observed",
	status: "active",
	statement: `The deployment configuration contains ${SYNTHETIC_DUMMY_SECRET}`,
	qualifications: ["Copied from a tool result; not independently verified"],
	evidenceRefs: [SYNTHETIC_VALID_TOOL_CALL_ID],
} as const;

/**
 * The candidate that copies the synthetic injection out of the tool result
 * into the model-authored `statement`.
 */
export const INJECTION_CANDIDATE = {
	id: "checkpoint-002",
	kind: "observation",
	assurance: "tool_observed",
	status: "active",
	statement: SYNTHETIC_INJECTION,
	qualifications: [],
	evidenceRefs: [SYNTHETIC_VALID_TOOL_CALL_ID],
} as const;

/**
 * The opaque dummy secret, exported for the adversarial controls.
 */
export { SYNTHETIC_OPAQUE_DUMMY, SYNTHETIC_DUMMY_SECRET, SYNTHETIC_INJECTION };
