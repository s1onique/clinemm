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
import type { PrefixForensicsCaptureRecord } from "./prefix-forensics.ts";
import {
	comparePrefixForensicsBundles,
	establishRequestLineage,
	groupCapturesIntoRequestBundles,
} from "./prefix-forensics-analyzer.ts";

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

/**
 * ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION02: the within-request
 * grouping key of a capture record.
 *
 * It is the SAME key the analyzer groups bundles by, so a bundle's files can
 * be named in the output.
 */
function bundleKey(record: PrefixForensicsCaptureRecord): string {
	return [
		record.cohortId ?? "-",
		record.sessionId ?? "-",
		String(record.iteration ?? "-"),
		record.preparationRequestId ?? "-",
		record.providerAttemptId ?? "-",
	].join("|");
}

/** The within-request grouping key of a bundle. */
function bundleKeyOf(bundle: {
	sessionId?: string;
	preparationRequestId?: string;
	providerAttemptId?: string;
	iteration?: number;
	cohortId?: string;
}): string {
	return [
		bundle.cohortId ?? "-",
		bundle.sessionId ?? "-",
		String(bundle.iteration ?? "-"),
		bundle.preparationRequestId ?? "-",
		bundle.providerAttemptId ?? "-",
	].join("|");
}

/**
 * ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION02: a REPRESENTATIVE
 * record of a bundle, used only to carry the bundle's identity into the
 * lineage gate.
 *
 * The gate reads the session, the iteration, the preparation identity and the
 * attempt identity — all of which are the bundle's identity, identical across
 * the bundle's stages. The representative is the bundle's first stage.
 */
function representativeRecord(bundle: {
	stages: ReadonlyMap<string, PrefixForensicsCaptureRecord>;
}): PrefixForensicsCaptureRecord {
	const first = bundle.stages.values().next();
	if (first.done) {
		throw new Error("a request bundle must carry at least one stage");
	}
	return first.value;
}

/** The main entry point. */
function main(argv: string[]): number {
	const dir = argv[2];
	if (!dir) {
		process.stderr.write("usage: prefix-forensics-analyzer-cli <dir>\n");
		return 2;
	}
	const captures = loadCaptures(dir);

	const pairs: {
		before: string;
		after: string;
		authoritative: boolean;
		unavailableReason?: string;
		earliestDifferingStage?: string;
		/**
		 * ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION03: EVERY
		 * change category detected across the compared stages — messages,
		 * tools, system and body.
		 *
		 * The CORRECTION02 report exposed only the MESSAGE difference, so a
		 * tool-only, system-only or body-only change was invisible to a
		 * reader of the report even though the analyzer had detected it.
		 */
		differingCategories?: string[];
		commonPrefixLength?: number;
		firstDifference?: unknown;
		unavailableStages?: string[];
		allStagesEqual?: boolean;
	}[] = [];

	// ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION02: the unit of
	// comparison is a REQUEST BUNDLE, not a capture record.
	//
	// The CORRECTION01 CLI sorted every capture together and examined
	// adjacent entries. That was wrong twice over:
	//
	//   1. the three representation stages of ONE request could be
	//      interleaved with another request's stages, so an "adjacent pair"
	//      could be two stages of the SAME request; and
	//   2. it compared ONE record per side, so it could never express a
	//      comparison of two COMPLETE requests across all three stages.
	//
	// The bundles are grouped by the within-request identity and then
	// ordered by their ITERATION — the identity itself, never a timestamp.
	const bundles = groupCapturesIntoRequestBundles(
		captures.map((capture) => capture.record),
	);
	const ordered = [...bundles].sort((a, b) => {
		const iterationDelta = (a.iteration ?? 0) - (b.iteration ?? 0);
		if (iterationDelta !== 0) {
			return iterationDelta;
		}
		return (a.preparationRequestId ?? "").localeCompare(
			b.preparationRequestId ?? "",
		);
	});
	// The FILE each bundle's stages came from, so a pair can name the
	// evidence that produced it.
	const filesByBundleKey = new Map<string, string[]>();
	for (const capture of captures) {
		const key = bundleKey(capture.record);
		const existing = filesByBundleKey.get(key);
		if (existing) {
			existing.push(capture.file);
		} else {
			filesByBundleKey.set(key, [capture.file]);
		}
	}

	for (let index = 0; index + 1 < ordered.length; index += 1) {
		const before = ordered[index];
		const after = ordered[index + 1];
		if (
			before.cohortId !== undefined &&
			after.cohortId !== undefined &&
			before.cohortId !== after.cohortId
		) {
			continue;
		}
		// ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION02: the
		// EXACT-LINEAGE gate, now modelled on the runtime's real identities:
		// same session, PROVEN ADJACENT iterations, distinct preparations.
		const lineage = establishRequestLineage(
			representativeRecord(before),
			representativeRecord(after),
		);
		const beforeFiles = filesByBundleKey.get(bundleKeyOf(before)) ?? [];
		const afterFiles = filesByBundleKey.get(bundleKeyOf(after)) ?? [];
		if (!lineage.consecutive) {
			pairs.push({
				before: beforeFiles.join(","),
				after: afterFiles.join(","),
				authoritative: false,
				unavailableReason: lineage.reason,
			});
			continue;
		}
		const diff = comparePrefixForensicsBundles({
			before,
			after,
		});
		// ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION03: the
		// stage is selected by `differs`, NOT by `differences.length > 0`.
		//
		// The CORRECTION02 CLI read only the MESSAGE list, so a TOOL-ONLY,
		// a SYSTEM-ONLY or a BODY-ONLY change was correctly detected by
		// the analyzer and then OMITTED from the CLI's reported first
		// difference. `differs` covers every change category.
		const stage = diff.earliestDifferingStage
			? diff.stages.find(
					(candidate) =>
						candidate.stage === diff.earliestDifferingStage &&
						candidate.available,
				)
			: undefined;
		const differingCategories = diff.stages
			.filter((candidate) => candidate.available && candidate.differs)
			.flatMap((candidate) => [...candidate.differingCategories]);
		pairs.push({
			before: beforeFiles.join(","),
			after: afterFiles.join(","),
			authoritative: diff.authoritative,
			...(diff.unavailableReason !== undefined
				? { unavailableReason: diff.unavailableReason }
				: {}),
			...(diff.earliestDifferingStage !== undefined
				? { earliestDifferingStage: diff.earliestDifferingStage }
				: {}),
			...(differingCategories.length > 0
				? { differingCategories: [...new Set(differingCategories)] }
				: {}),
			...(stage !== undefined
				? {
						commonPrefixLength: stage.commonPrefixLength,
						...(stage.firstDifference !== undefined
							? { firstDifference: stage.firstDifference }
							: {}),
					}
				: {}),
			...(diff.unavailableStages.length > 0
				? { unavailableStages: [...diff.unavailableStages] }
				: {}),
			allStagesEqual: diff.allStagesEqual,
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
