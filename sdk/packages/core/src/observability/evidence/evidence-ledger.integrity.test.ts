/**
 * ACT-CLINEMM-ROUND-C-HARNESS-02 — Phase 1 D1: ledger integrity.
 *
 * ## The defect
 *
 * The ledger's chain digest bound only a SUBSET of each observation:
 *
 *   observationId | sourceHash | verification | head
 *
 * Every other field was outside the digest. So an attacker (or a buggy
 * writer) could change an observation's `kind`, `findingRefs`,
 * `capturedAtIso`, `label`, `toolCallId`, `messageId`, `subject` or
 * `sourceBytes` and the chain would still verify.
 *
 * The observation id had the same gap: it was derived from
 * `(kind, sourceHash, head, findingRefs)`, so `capturedAtIso` and `label`
 * were unbound.
 *
 * The most concrete consequence: changing `findingRefs` WITHOUT
 * recomputing `observationId` passed verification, because neither the
 * id derivation nor the chain digest covered the field the change
 * touched.
 *
 * ## What this suite requires
 *
 * Every security- or correctness-relevant field is bound, and every
 * unauthorized mutation is rejected — independently, one field at a time.
 */

import { describe, expect, it } from "vitest";
import {
	computeChainDigest,
	deriveObservationId,
	digestEvidenceContent,
	EMPTY_LEDGER_DIGEST,
	type EvidenceLedger,
	EvidenceLedgerBuilder,
	type EvidenceLedgerEntry,
	type EvidenceObservation,
	sealEvidenceLedger,
	verifyEvidenceLedger,
	verifyEvidenceLedgerAgainstAnchor,
} from "./evidence-ledger";

const HEAD = "5719b487f24cadef0c648bec7430892ada848c86";
const OTHER_HEAD = "0".repeat(40);

const entryAt = (ledger: EvidenceLedger, index: number): EvidenceLedgerEntry =>
	ledger.entries[index] as EvidenceLedgerEntry;

/**
 * Build a one-entry ledger.
 */
function seedLedger(): EvidenceLedger {
	const builder = new EvidenceLedgerBuilder(HEAD);
	builder.append({
		kind: "tool_result",
		source: {
			toolCallId: "call_1",
			messageId: "msg_1",
			subject: "Dockerfile",
			sourceContent: "FROM alpine",
			sourceBytes: 11,
		},
		verification: "verified",
		findingRefs: ["F-1", "F-2"],
		capturedAtIso: "2026-11-15T00:00:00.000Z",
		label: "dockerfile-read",
	});
	return builder.build();
}

/**
 * Replace one field of the first observation, leaving everything else —
 * including the recorded chain digest — untouched.
 *
 * This is exactly the unauthorized mutation the ledger must reject.
 */
function mutate(
	ledger: EvidenceLedger,
	mutateObservation: (observation: EvidenceObservation) => EvidenceObservation,
): EvidenceLedger {
	const first = entryAt(ledger, 0);
	return {
		...ledger,
		entries: [
			{ ...first, observation: mutateObservation(first.observation) },
			...ledger.entries.slice(1),
		],
	};
}

describe("D1 — ledger integrity", () => {
	it("binds the kind: changing it without recomputing the id is rejected", () => {
		const ledger = seedLedger();
		const tampered = mutate(ledger, (o) => ({ ...o, kind: "file_read" }));
		expect(verifyEvidenceLedger(tampered).intact).toBe(false);
	});

	it("binds the verification state: changing it is rejected", () => {
		const ledger = seedLedger();
		const tampered = mutate(ledger, (o) => ({
			...o,
			verification: "refuted",
		}));
		expect(verifyEvidenceLedger(tampered).intact).toBe(false);
	});

	it("binds the finding references: changing them without recomputing the id is rejected", () => {
		const ledger = seedLedger();
		const tampered = mutate(ledger, (o) => ({
			...o,
			findingRefs: ["F-3", "F-4"],
		}));
		expect(verifyEvidenceLedger(tampered).intact).toBe(false);
	});

	it("binds the capture timestamp: changing it is rejected", () => {
		const ledger = seedLedger();
		const tampered = mutate(ledger, (o) => ({
			...o,
			capturedAtIso: "2020-01-01T00:00:00.000Z",
		}));
		expect(verifyEvidenceLedger(tampered).intact).toBe(false);
	});

	it("binds the label: changing it is rejected", () => {
		const ledger = seedLedger();
		const tampered = mutate(ledger, (o) => ({
			...o,
			label: "something-else",
		}));
		expect(verifyEvidenceLedger(tampered).intact).toBe(false);
	});

	it("binds the source identity: changing the tool call id is rejected", () => {
		const ledger = seedLedger();
		const tampered = mutate(ledger, (o) => ({
			...o,
			source: { ...o.source, toolCallId: "call_999" },
		}));
		expect(verifyEvidenceLedger(tampered).intact).toBe(false);
	});

	it("binds the source identity: changing the message id is rejected", () => {
		const ledger = seedLedger();
		const tampered = mutate(ledger, (o) => ({
			...o,
			source: { ...o.source, messageId: "msg_999" },
		}));
		expect(verifyEvidenceLedger(tampered).intact).toBe(false);
	});

	it("binds the source identity: changing the subject is rejected", () => {
		const ledger = seedLedger();
		const tampered = mutate(ledger, (o) => ({
			...o,
			source: { ...o.source, subject: "secrets.json" },
		}));
		expect(verifyEvidenceLedger(tampered).intact).toBe(false);
	});

	it("binds the source byte count: changing it is rejected", () => {
		const ledger = seedLedger();
		const tampered = mutate(ledger, (o) => ({
			...o,
			source: { ...o.source, sourceBytes: 9999 },
		}));
		expect(verifyEvidenceLedger(tampered).intact).toBe(false);
	});

	it("binds the source hash: changing it is rejected", () => {
		const ledger = seedLedger();
		const tampered = mutate(ledger, (o) => ({
			...o,
			source: { ...o.source, sourceHash: digestEvidenceContent("other") },
		}));
		expect(verifyEvidenceLedger(tampered).intact).toBe(false);
	});

	it("binds the observation identity: changing the id is rejected", () => {
		const ledger = seedLedger();
		const tampered = mutate(ledger, (o) => ({
			...o,
			observationId: "obs_forged",
		}));
		expect(verifyEvidenceLedger(tampered).intact).toBe(false);
	});

	it("binds the HEAD: changing it is rejected", () => {
		const ledger = seedLedger();
		const tampered = mutate(ledger, (o) => ({ ...o, head: OTHER_HEAD }));
		expect(verifyEvidenceLedger(tampered).intact).toBe(false);
	});

	it("recomputes the observation id from every bound field", () => {
		const ledger = seedLedger();
		const observation = entryAt(ledger, 0).observation;
		// The id must be RECOMPUTABLE from the observation's fields, so a
		// verifier can re-derive it and detect a mismatch.
		expect(
			deriveObservationId({
				kind: observation.kind,
				sourceHash: observation.source.sourceHash,
				head: observation.head,
				findingRefs: observation.findingRefs,
				capturedAtIso: observation.capturedAtIso,
				verification: observation.verification,
				toolCallId: observation.source.toolCallId,
				messageId: observation.source.messageId,
			}),
		).toBe(observation.observationId);
	});

	it("documents that a fully re-forged ledger needs the ANCHOR to be detected", () => {
		// The strongest forgery: the attacker replaces the observation,
		// recomputes the observation id to match, and recomputes the chain
		// digest. The CHAIN is then internally consistent and the chain
		// verification passes.
		//
		// This is NOT a defect — it is the trust model, stated honestly.
		// Hash chaining establishes CONSISTENCY against a trusted anchor;
		// it does not provide AUTHENTICATION. An attacker who can replace
		// the anchor too can produce a self-consistent forgery, and the
		// only defence is holding the anchor somewhere they cannot reach.
		//
		// The anchor is what detects this forgery.
		const ledger = seedLedger();
		const anchor = sealEvidenceLedger(ledger);
		const first = entryAt(ledger, 0);
		const forgedObservation: EvidenceObservation = {
			...first.observation,
			findingRefs: ["F-3"],
		};
		const forgedId = deriveObservationId({
			kind: forgedObservation.kind,
			sourceHash: forgedObservation.source.sourceHash,
			head: forgedObservation.head,
			findingRefs: forgedObservation.findingRefs,
			capturedAtIso: forgedObservation.capturedAtIso,
			verification: forgedObservation.verification,
			toolCallId: forgedObservation.source.toolCallId,
			messageId: forgedObservation.source.messageId,
		});
		const withForgedId = { ...forgedObservation, observationId: forgedId };
		const forged: EvidenceLedger = {
			...ledger,
			entries: [
				{
					observation: withForgedId,
					chainDigest: computeChainDigest(EMPTY_LEDGER_DIGEST, withForgedId),
				},
			],
			digest: computeChainDigest(EMPTY_LEDGER_DIGEST, withForgedId),
		};

		// The chain alone does NOT detect this — it is self-consistent.
		expect(verifyEvidenceLedger(forged).intact).toBe(true);
		// The ANCHOR does.
		const result = verifyEvidenceLedgerAgainstAnchor(forged, anchor);
		expect(result.intact).toBe(false);
		expect(result.reason).toBe("digest-mismatch");
	});

	it("rejects an observation whose id does not re-derive from its content", () => {
		// The id is not decorative: an entry whose recorded id does not
		// match its own content is rejected even when the chain digest was
		// recomputed to match.
		const ledger = seedLedger();
		const first = entryAt(ledger, 0);
		const observation: EvidenceObservation = {
			...first.observation,
			observationId: "obs_0000000000000000000000000000",
		};
		const tampered: EvidenceLedger = {
			...ledger,
			entries: [
				{
					observation,
					chainDigest: computeChainDigest(EMPTY_LEDGER_DIGEST, observation),
				},
			],
			digest: computeChainDigest(EMPTY_LEDGER_DIGEST, observation),
		};
		const result = verifyEvidenceLedger(tampered);
		expect(result.intact).toBe(false);
		expect(result.reason).toBe("observation-id-mismatch");
	});

	it("gives a different id when the finding references change", () => {
		const base = {
			kind: "tool_result" as const,
			sourceHash: "abc",
			head: HEAD,
		};
		expect(deriveObservationId({ ...base, findingRefs: ["F-1"] })).not.toBe(
			deriveObservationId({ ...base, findingRefs: ["F-2"] }),
		);
	});

	it("keeps the external-anchor requirement for tail truncation", () => {
		const builder = new EvidenceLedgerBuilder(HEAD);
		for (const content of ["one", "two"]) {
			builder.append({
				kind: "tool_result",
				source: { sourceContent: content },
				verification: "verified",
				capturedAtIso: "2026-11-15T00:00:00.000Z",
			});
		}
		const ledger = builder.build();
		const anchor = sealEvidenceLedger(ledger);
		expect(verifyEvidenceLedgerAgainstAnchor(ledger, anchor).intact).toBe(true);

		// Drop the tail entry, re-stating the new last entry's digest so
		// the CHAIN alone still verifies.
		const truncated: EvidenceLedger = {
			...ledger,
			entries: ledger.entries.slice(0, 1),
			digest: entryAt(ledger, 0).chainDigest,
		};
		// The chain cannot detect this on its own — that is the documented
		// limitation.
		expect(verifyEvidenceLedger(truncated).intact).toBe(true);
		// The ANCHOR detects it.
		const result = verifyEvidenceLedgerAgainstAnchor(truncated, anchor);
		expect(result.intact).toBe(false);
		expect(result.reason).toBe("entry-count-mismatch");
	});

	it("does not let a caller forge the chain digest", () => {
		const ledger = seedLedger();
		const observation = entryAt(ledger, 0).observation;
		expect(entryAt(ledger, 0).chainDigest).toBe(
			computeChainDigest(EMPTY_LEDGER_DIGEST, observation),
		);
	});
});
