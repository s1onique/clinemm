import { describe, expect, it } from "vitest";
import {
	computeChainDigest,
	deriveObservationId,
	digestEvidenceContent,
	EMPTY_LEDGER_DIGEST,
	type EvidenceLedger,
	EvidenceLedgerBuilder,
	type EvidenceLedgerEntry,
	sealEvidenceLedger,
	verifyEvidenceLedger,
	verifyEvidenceLedgerAgainstAnchor,
} from "./evidence-ledger";

const HEAD = "691cf26fff4e8f1ebde81be1d413c725c2306b3e";

const entryAt = (ledger: EvidenceLedger, index: number): EvidenceLedgerEntry =>
	ledger.entries[index] as EvidenceLedgerEntry;

describe("evidence ledger — Round C Phase 4 contract", () => {
	it("derives a stable observation id from the observation's identity", () => {
		const first = deriveObservationId({
			kind: "tool_result",
			sourceHash: "abc",
			head: HEAD,
			findingRefs: ["F-1", "F-2"],
		});
		const second = deriveObservationId({
			kind: "tool_result",
			sourceHash: "abc",
			head: HEAD,
			findingRefs: ["F-2", "F-1"],
		});
		expect(first).toBe(second);
		expect(first.startsWith("obs_")).toBe(true);
	});

	it("gives a different id for a different source, kind or HEAD", () => {
		const base = {
			kind: "tool_result" as const,
			sourceHash: "abc",
			head: HEAD,
			findingRefs: [] as string[],
		};
		expect(deriveObservationId(base)).not.toBe(
			deriveObservationId({ ...base, sourceHash: "def" }),
		);
		expect(deriveObservationId(base)).not.toBe(
			deriveObservationId({ ...base, kind: "file_read" }),
		);
		expect(deriveObservationId(base)).not.toBe(
			deriveObservationId({ ...base, head: "deadbeef" }),
		);
	});

	it("binds every observation to the HEAD it was captured at", () => {
		const builder = new EvidenceLedgerBuilder(HEAD);
		const observation = builder.append({
			kind: "tool_result",
			source: { toolCallId: "call_1", sourceContent: "result" },
			verification: "verified",
			findingRefs: ["F-1"],
			capturedAtIso: "2026-11-15T00:00:00.000Z",
		});
		expect(observation.head).toBe(HEAD);
		expect(builder.build().head).toBe(HEAD);
	});

	it("never stores the source content — only its digest and byte count", () => {
		const builder = new EvidenceLedgerBuilder(HEAD);
		const secretish = "the command output was: hunter2";
		const observation = builder.append({
			kind: "command_output",
			source: {
				toolCallId: "call_9",
				sourceContent: secretish,
				sourceBytes: Buffer.byteLength(secretish, "utf8"),
			},
			verification: "verified",
			capturedAtIso: "2026-11-15T00:00:00.000Z",
		});
		expect(observation.source.sourceHash).toBe(
			digestEvidenceContent(secretish),
		);
		expect(observation.source.sourceBytes).toBe(secretish.length);
		const serialised = JSON.stringify(builder.build());
		expect(serialised).not.toContain("hunter2");
		expect(serialised).not.toContain(secretish);
	});

	it("chains entries so an edited earlier entry breaks every later digest", () => {
		const builder = new EvidenceLedgerBuilder(HEAD);
		builder.append({
			kind: "tool_result",
			source: { sourceContent: "one" },
			verification: "verified",
			capturedAtIso: "2026-11-15T00:00:00.000Z",
		});
		builder.append({
			kind: "tool_result",
			source: { sourceContent: "two" },
			verification: "verified",
			capturedAtIso: "2026-11-15T00:00:01.000Z",
		});
		const ledger = builder.build();
		expect(verifyEvidenceLedger(ledger)).toEqual({ intact: true });

		// Tamper with the FIRST entry's verification state.
		const first = entryAt(ledger, 0);
		const tampered: EvidenceLedger = {
			...ledger,
			entries: [
				{
					...first,
					observation: { ...first.observation, verification: "refuted" },
				},
				entryAt(ledger, 1),
			],
		};
		const result = verifyEvidenceLedger(tampered);
		expect(result.intact).toBe(false);
		expect(result.brokenAtIndex).toBe(0);
	});

	it("detects a removed entry from the MIDDLE of the chain", () => {
		const builder = new EvidenceLedgerBuilder(HEAD);
		for (const content of ["one", "two", "three"]) {
			builder.append({
				kind: "tool_result",
				source: { sourceContent: content },
				verification: "verified",
				capturedAtIso: "2026-11-15T00:00:00.000Z",
			});
		}
		const ledger = builder.build();
		// Remove the middle entry, keeping the last entry (and therefore the
		// ledger digest) intact. The chain recomputation must detect it.
		const truncated: EvidenceLedger = {
			...ledger,
			entries: [entryAt(ledger, 0), entryAt(ledger, 2)],
		};
		const result = verifyEvidenceLedger(truncated);
		expect(result.intact).toBe(false);
		expect(result.brokenAtIndex).toBe(1);
	});

	it("does NOT claim to detect truncation of the tail alone", () => {
		// A hash chain commits forward, not backward: dropping the LAST
		// entry and re-stating the new last entry's digest is
		// indistinguishable from a ledger that was simply shorter. The
		// ledger therefore publishes its own digest as the external
		// anchor; truncation of the tail is detected by comparing against
		// that anchor, not by the chain alone.
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
		const truncated: EvidenceLedger = {
			...ledger,
			entries: ledger.entries.slice(0, 1),
			digest: entryAt(ledger, 0).chainDigest,
		};
		// The chain itself is self-consistent — this is the documented
		// limitation, not a claim of tamper-evidence for tail truncation.
		expect(verifyEvidenceLedger(truncated).intact).toBe(true);
		// But the published anchor differs, so an external holder of the
		// original digest detects it.
		expect(truncated.digest).not.toBe(ledger.digest);
	});

	it("produces the same digest for the same sequence of observations", () => {
		const build = () => {
			const builder = new EvidenceLedgerBuilder(HEAD);
			builder.append({
				kind: "tool_result",
				source: { toolCallId: "call_1", sourceContent: "a" },
				verification: "verified",
				findingRefs: ["F-1"],
				capturedAtIso: "2026-11-15T00:00:00.000Z",
			});
			builder.append({
				kind: "file_read",
				source: { subject: "Dockerfile", sourceContent: "b" },
				verification: "pending",
				capturedAtIso: "2026-11-15T00:00:01.000Z",
			});
			return builder.build();
		};
		expect(build().digest).toBe(build().digest);
	});

	it("records the Round C compaction loss as a verifiable observation", () => {
		// The measured Round C fact: 202 of 208 tool results were dropped,
		// while 206 of the 208 in the prefix carried NON-EMPTY content.
		const builder = new EvidenceLedgerBuilder(HEAD);
		const observation = builder.append({
			kind: "compaction",
			source: {
				subject: "roundc-compaction-sidecar",
				sourceContent: "397 messages -> 13; 202 of 208 tool results dropped",
			},
			verification: "verified",
			findingRefs: ["ROUNDC-COMPACTION-LOSS", "ROUNDC-BLANK-RESULTS"],
			capturedAtIso: "2026-11-15T00:00:00.000Z",
			label: "compaction-loss",
		});
		expect(observation.kind).toBe("compaction");
		expect(observation.verification).toBe("verified");
		expect(observation.findingRefs).toContain("ROUNDC-BLANK-RESULTS");
		expect(observation.source.subject).toBe("roundc-compaction-sidecar");
	});

	it("starts from a well-defined empty digest", () => {
		const ledger = new EvidenceLedgerBuilder(HEAD).build();
		expect(ledger.digest).toBe(EMPTY_LEDGER_DIGEST);
		expect(ledger.entries).toHaveLength(0);
		expect(verifyEvidenceLedger(ledger).intact).toBe(true);
	});

	it("detects tail truncation when checked against a sealed anchor", () => {
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

		const truncated: EvidenceLedger = {
			...ledger,
			entries: ledger.entries.slice(0, 1),
			digest: entryAt(ledger, 0).chainDigest,
		};
		const result = verifyEvidenceLedgerAgainstAnchor(truncated, anchor);
		expect(result.intact).toBe(false);
		expect(result.reason).toBe("entry-count-mismatch");
	});

	it("detects a HEAD change against the anchor", () => {
		const builder = new EvidenceLedgerBuilder(HEAD);
		builder.append({
			kind: "tool_result",
			source: { sourceContent: "x" },
			verification: "verified",
			capturedAtIso: "2026-11-15T00:00:00.000Z",
		});
		const ledger = builder.build();
		const anchor = sealEvidenceLedger(ledger);
		const moved: EvidenceLedger = { ...ledger, head: "0".repeat(40) };
		const result = verifyEvidenceLedgerAgainstAnchor(moved, anchor);
		expect(result.intact).toBe(false);
		expect(result.reason).toBe("head-mismatch");
	});

	it("lets a caller not forge the chain digest", () => {
		const builder = new EvidenceLedgerBuilder(HEAD);
		const observation = builder.append({
			kind: "tool_result",
			source: { sourceContent: "x" },
			verification: "verified",
			capturedAtIso: "2026-11-15T00:00:00.000Z",
		});
		const ledger = builder.build();
		expect(entryAt(ledger, 0).chainDigest).toBe(
			computeChainDigest(EMPTY_LEDGER_DIGEST, observation),
		);
	});
});
