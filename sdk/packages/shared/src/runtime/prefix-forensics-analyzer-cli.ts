/**
 * ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-01.
 *
 * The offline analyzer CLI.
 *
 * Reads the sanitized capture records from a directory and emits the
 * request-difference matrix as JSON.
 *
 * This is an OFFLINE tool: it reads files, it never contacts a provider,
 * it never contacts an inference service, and it never writes outside the
 * path it is given.
 *
 * Usage:
 *   bun sdk/packages/shared/src/runtime/prefix-forensics-analyzer-cli.ts <dir>
 *
 * The joins are AUTHORITATIVE only where the capture records carry an
 * explicit identity. A chronological-adjacency join — "the next capture
 * after this one" — is reported as `NOT_AUTHORITATIVE`, because the ACT
 * forbids presenting such a join as authoritative.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PrefixForensicsCaptureRecord } from "./prefix-forensics";
import {
	comparePrefixForensicsRequests,
	establishConsecutiveRequestLineage,
} from "./prefix-forensics-analyzer";

interface LoadedCapture {
	readonly file: string;
	readonly record: PrefixForensicsCaptureRecord;
}

/** Load every forensic capture record from a directory. */
function loadCaptures(dir: string): LoadedCapture[] {
	const captures: LoadedCapture[] = [];
	for (const file of readdirSync(dir).sort()) {
		if (!file.endsWith(".prefix-forensics.json")) {
			continue;
		}
		try {
			const parsed = JSON.parse(
				readFileSync(join(dir, file), "utf8"),
			) as PrefixForensicsCaptureRecord;
			if (parsed && typeof parsed === "object" && parsed.representation) {
				captures.push({ file, record: parsed });
			}
		} catch {
			// A malformed capture is skipped, never guessed at.
		}
	}
	return captures;
}

/** The identity key a capture is joined on. */
function identityKey(record: PrefixForensicsCaptureRecord): string {
	return [
		record.cohortId,
		record.sessionId ?? "-",
		record.source,
		record.preparationRequestId ?? "-",
		record.providerAttemptId ?? "-",
		String(record.iteration ?? "-"),
	].join("|");
}

/**
 * ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION01.
 *
 * Is the (before → after) pair an EXACT consecutive request lineage?
 *
 * The rule lives in the shared analyzer so that it is UNIT-TESTABLE and so
 * that every caller applies the SAME gate. The rationale is documented on
 * `establishConsecutiveRequestLineage`.
 */
function establishConsecutiveLineage(
	before: PrefixForensicsCaptureRecord,
	after: PrefixForensicsCaptureRecord,
): { consecutive: boolean; reason?: string } {
	return establishConsecutiveRequestLineage(before, after);
}

/** The main entry point. */
function main(argv: string[]): number {
	const dir = argv[2];
	if (!dir) {
		process.stderr.write("usage: prefix-forensics-analyzer-cli <dir>\n");
		return 2;
	}
	const captures = loadCaptures(dir);
	const byIdentity = new Map<string, LoadedCapture>();
	for (const capture of captures) {
		byIdentity.set(identityKey(capture.record), capture);
	}

	const pairs: {
		before: string;
		after: string;
		authoritative: boolean;
		unavailableReason?: string;
		earliestDifferingStage?: string;
		commonPrefixLength?: number;
		firstDifference?: unknown;
	}[] = [];

	// The join is by EXPLICIT identity: a capture and the capture that
	// shares its session AND source AND preparation lineage, at the next
	// iteration. The iteration ordering comes from the captured identity
	// itself — not from file order.
	const ordered = [...captures].sort((a, b) => {
		const iterationDelta =
			(a.record.iteration ?? 0) - (b.record.iteration ?? 0);
		if (iterationDelta !== 0) {
			return iterationDelta;
		}
		return a.record.capturedAt.localeCompare(b.record.capturedAt);
	});

	for (let index = 0; index + 1 < ordered.length; index += 1) {
		const before = ordered[index];
		const after = ordered[index + 1];
		if (
			before.record.cohortId !== after.record.cohortId ||
			before.record.source !== after.record.source ||
			before.record.sessionId !== after.record.sessionId
		) {
			continue;
		}
		// ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION01: the
		// EXACT-LINEAGE gate.
		//
		// The pre-correction CLI paired captures by session + source +
		// file ordering and then reported the pair's `authoritative` flag
		// verbatim. The analyzer's own authoritative rule accepts a shared
		// SESSION, so a same-session chronology was labelled authoritative
		// WITHOUT establishing that the two captures are CONSECUTIVE
		// requests of the same preparation lineage.
		//
		// A pair is now joined only when the identity carries an EXACT
		// consecutive lineage: the same preparation identity with a
		// strictly increasing iteration, or — when the preparation
		// identity is absent — the same preparation identity with a
		// strictly increasing attempt ordinal. Everything else is
		// reported as `NOT_AUTHORITATIVE` with an explicit reason.
		const lineage = establishConsecutiveLineage(before.record, after.record);
		if (!lineage.consecutive) {
			pairs.push({
				before: before.file,
				after: after.file,
				authoritative: false,
				unavailableReason: lineage.reason,
			});
			continue;
		}
		const diff = comparePrefixForensicsRequests({
			before: before.record,
			after: after.record,
		});
		const stage = diff.stages.find(
			(candidate) => candidate.stage === before.record.source,
		);
		pairs.push({
			before: before.file,
			after: after.file,
			authoritative: diff.authoritative,
			...(diff.unavailableReason !== undefined
				? { unavailableReason: diff.unavailableReason }
				: {}),
			...(diff.earliestDifferingStage !== undefined
				? { earliestDifferingStage: diff.earliestDifferingStage }
				: {}),
			...(stage !== undefined
				? {
						commonPrefixLength: stage.commonPrefixLength,
						...(stage.firstDifference !== undefined
							? { firstDifference: stage.firstDifference }
							: {}),
					}
				: {}),
		});
	}

	process.stdout.write(
		`${JSON.stringify(
			{
				schema: "cline.prefix-forensics-difference-matrix.v1",
				captureCount: captures.length,
				pairCount: pairs.length,
				pairs,
			},
			null,
			2,
		)}\n`,
	);
	return 0;
}

process.exitCode = main(process.argv);
