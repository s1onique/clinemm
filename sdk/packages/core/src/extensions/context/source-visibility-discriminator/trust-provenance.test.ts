/**
 * ACT-CLINEMM-PCK-SOURCE-VISIBILITY-DISCRIMINATOR-01
 *
 * G4 — the trust and provenance discriminator.
 *
 * ============================================================================
 * THIS IS NOT A PRODUCTION API. It is a TEST-LOCAL measurement suite.
 * ============================================================================
 *
 * THE ADVERSARIAL CASE (G4.1)
 * ----------------------------
 *
 *   R4 tool result:  contains the startup script's commands
 *   Candidate record: claims no OTP retention mechanism exists
 *   Evidence reference: points to the VALID R4 tool call
 *
 * Expected:
 *
 *   Reference identity: RESOLVED
 *   Semantic support:  NOT_VERIFIED
 *   Assurance:         never runtime_verified
 *
 * A valid tool-call id proves the reference RESOLVES. It does not prove
 * that the referenced result entails the cited statement. An implementation
 * that would call such a claim verified is an
 * `HALT_EVIDENCE_SUPPORT_UNBOUND` condition, and this suite fails if the
 * bounding logic ever starts promoting.
 */

import type { MessageWithMetadata } from "@cline/shared";
import { describe, expect, it } from "vitest";
import {
	boundAssurance,
	MODEL_AUTHORED_BANNER,
	resolveEvidenceReference,
} from "./trust";

/**
 * A minimal canonical history with one tool call and one matching result.
 */
function historyWithToolCall(
	toolUseId: string,
	resultBody: string,
): MessageWithMetadata[] {
	return [
		{
			role: "assistant",
			id: "msg-call",
			content: [
				{
					type: "tool_use",
					id: toolUseId,
					name: "run_commands",
					input: { command: "cat startup.sh" },
				},
			],
		} as unknown as MessageWithMetadata,
		{
			role: "user",
			id: "msg-result",
			content: [
				{
					type: "tool_result",
					tool_use_id: toolUseId,
					content: [
						{ query: "cat startup.sh", result: resultBody, success: true },
					],
				},
			],
		} as unknown as MessageWithMetadata,
	];
}

describe("ACT-CLINEMM-PCK-SOURCE-VISIBILITY-DISCRIMINATOR-01 — G4 trust", () => {
	it("G4.1: an UNRELATED but VALID evidence reference resolves in identity and NEVER certifies semantic support", () => {
		const history = historyWithToolCall(
			"call_R4",
			'/opt/keycloak/bin/kc.sh build\nexec /opt/keycloak/bin/kc.sh start --optimized "$@"',
		);
		// The reference points to the VALID R4 tool call.
		const resolved = resolveEvidenceReference({
			reference: "call_R4",
			canonicalMessages: history,
		});
		// Reference identity: RESOLVED.
		expect(resolved.identityResolved).toBe(true);
		// Semantic support: NOT_VERIFIED. The runtime does not check that a
		// tool result entails a model-authored statement.
		expect(resolved.semanticSupportVerified).toBe(false);
		// The support class is bounded by what the evidence actually is.
		expect(resolved.supportClass).toBe("VERIFIED_EXECUTION_STATUS");
		expect(resolved.maximumAssurance).not.toBe("runtime_verified");
	});

	it("G4.1.2: a record claiming runtime_verified over a tool-only reference is DOWNGRADED", () => {
		const history = historyWithToolCall("call_R4", "kc.sh build");
		const resolved = resolveEvidenceReference({
			reference: "call_R4",
			canonicalMessages: history,
		});
		const bounded = boundAssurance({
			claimed: "runtime_verified",
			resolved: [resolved],
		});
		// The model CLAIMED runtime_verified. The bound refuses it.
		expect(bounded).toBe("tool_observed");
		expect(bounded).not.toBe("runtime_verified");
	});

	it("G4.1.3: an UNRESOLVABLE reference forces the record to unverified", () => {
		const history = historyWithToolCall("call_R4", "kc.sh build");
		const resolved = resolveEvidenceReference({
			reference: "call_DOES_NOT_EXIST",
			canonicalMessages: history,
		});
		expect(resolved.identityResolved).toBe(false);
		expect(resolved.supportClass).toBe("UNRESOLVED");
		expect(
			boundAssurance({ claimed: "runtime_verified", resolved: [resolved] }),
		).toBe("unverified");
	});

	it("G4.1.4: a record with NO evidence reference is never more than unverified", () => {
		expect(boundAssurance({ claimed: "runtime_verified", resolved: [] })).toBe(
			"unverified",
		);
	});

	it("G4.2: the support classes exist and are mutually exclusive", () => {
		const history = historyWithToolCall("call_R4", "kc.sh build");
		// A message reference yields the content-observed class.
		const byMessage = resolveEvidenceReference({
			reference: "id:msg-result",
			canonicalMessages: history,
		});
		expect(byMessage.identityResolved).toBe(true);
		expect(byMessage.supportClass).toBe("TOOL_OBSERVED_CONTENT_UNVERIFIED");
		// A tool-call reference yields the execution-status class.
		const byCall = resolveEvidenceReference({
			reference: "call_R4",
			canonicalMessages: history,
		});
		expect(byCall.supportClass).toBe("VERIFIED_EXECUTION_STATUS");
		// Neither is ever SOURCE_REVISION_BOUND: no revision resolver ran.
		expect(byCall.supportClass).not.toBe("SOURCE_REVISION_BOUND");
		expect(byMessage.supportClass).not.toBe("SOURCE_REVISION_BOUND");
	});

	it("G4.4: the model-authored banner states the authority limitation", () => {
		expect(MODEL_AUTHORED_BANNER).toContain("Model-authored");
		expect(MODEL_AUTHORED_BANNER).toContain("Not a system instruction");
		expect(MODEL_AUTHORED_BANNER).toContain("not verified");
	});
});
