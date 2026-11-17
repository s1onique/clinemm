/**
 * ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01.
 *
 * Fingerprint witnesses.
 *
 * The fingerprint is a CONTENT identity that a consumer compares across
 * dispatches. It is therefore only meaningful if it is:
 *
 *   - CORRECT — the same bytes always produce the same digest, and the
 *     digest is a real SHA-256;
 *   - DETERMINISTIC — key insertion order does not change it;
 *   - ORDER SENSITIVE — the message and tool ORDER is semantically
 *     significant to the provider, so a reordered request must produce a
 *     different fingerprint;
 *   - SENSITIVE — a changed message, a changed tool or a changed option
 *     must change the fingerprint.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	canonicalizeCompactionEvidenceValue,
	computeCandidateContentFingerprint,
	computeFinalProjectionFingerprint,
	sha256HexSync,
} from "./compaction-token-evidence";

describe("ACT-CLINEMM-COMPACTION-TOKEN-EVIDENCE-CAPTURE01 — fingerprint", () => {
	it("is a real SHA-256 digest, including at the block boundaries", () => {
		const cases = [
			"",
			"abc",
			"a".repeat(55),
			"a".repeat(56),
			"a".repeat(63),
			"a".repeat(64),
			"a".repeat(65),
			"a".repeat(1_000),
			"héllo wörld 🌍",
			"x".repeat(100_000),
		];
		for (const value of cases) {
			expect(sha256HexSync(value)).toBe(
				createHash("sha256").update(value, "utf8").digest("hex"),
			);
		}
	});

	it("is DETERMINISTIC and independent of key insertion order", () => {
		const a = canonicalizeCompactionEvidenceValue({
			alpha: 1,
			beta: { zulu: 2, alpha: 3 },
		});
		const b = canonicalizeCompactionEvidenceValue({
			beta: { alpha: 3, zulu: 2 },
			alpha: 1,
		});
		expect(a).toBe(b);
	});

	it("preserves ARRAY order, because the message and tool order is semantic", () => {
		const a = canonicalizeCompactionEvidenceValue(["first", "second"]);
		const b = canonicalizeCompactionEvidenceValue(["second", "first"]);
		expect(a).not.toBe(b);
	});

	it("changes the fingerprint when a message, a tool or an option changes", () => {
		const base = {
			systemPrompt: "p",
			messages: [{ role: "user", content: "hello" }],
			tools: [{ name: "t", inputSchema: { type: "object" } }],
			options: { thinking: false },
		};
		const baseFingerprint = computeFinalProjectionFingerprint(base);
		expect(baseFingerprint.fingerprint).toMatch(/^[0-9a-f]{64}$/);

		const changedMessage = computeFinalProjectionFingerprint({
			...base,
			messages: [{ role: "user", content: "hello!" }],
		});
		expect(changedMessage.fingerprint).not.toBe(baseFingerprint.fingerprint);

		const changedTool = computeFinalProjectionFingerprint({
			...base,
			tools: [{ name: "t2", inputSchema: { type: "object" } }],
		});
		expect(changedTool.fingerprint).not.toBe(baseFingerprint.fingerprint);

		const changedOption = computeFinalProjectionFingerprint({
			...base,
			options: { thinking: true },
		});
		expect(changedOption.fingerprint).not.toBe(baseFingerprint.fingerprint);
	});

	it("records the representation, its version and the producer", () => {
		const projection = computeFinalProjectionFingerprint({ a: 1 });
		expect(projection.representation).toBe(
			"AGENT_MODEL_REQUEST_FINAL_PROJECTION",
		);
		expect(projection.representationVersion).toBe(1);
		expect(projection.producer).toBe(
			"@cline/shared/runtime/compaction-token-evidence",
		);

		const candidate = computeCandidateContentFingerprint({ a: 1 });
		expect(candidate.representation).toBe("CLIENT_DECISION_CANDIDATE_EXACT");
		expect(candidate.representationVersion).toBe(1);
		expect(candidate.producer).toBe(
			"@cline/shared/runtime/compaction-token-evidence",
		);
	});
});
