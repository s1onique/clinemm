/**
 * ACT-CLINEMM-COMPACTION-SUMMARY-CHURN-01 — OFFLINE PROBE DRIVER
 *
 * DISPOSABLE. Produces the three executable receipts of this ACT:
 *
 *   live-transition-matrix.json   the live wire/runtime transition matrix
 *   production-reproduction.json  the real-production-seam reproduction
 *   ablation-matrix.json          the 2x2 causal ablation
 *
 * It reads private artifacts from operator-controlled paths supplied as
 * environment variables, and writes ONLY sanitized outputs into the
 * evidence directory. No raw prompt, tool-result body, canonical transcript,
 * sidecar body, credential or HMAC key is ever written.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { MessageWithMetadata } from "@cline/shared";
import {
	buildProviderRequest,
	classifyChange,
	commonPrefixLength,
	extractVerifiedToolOutcomes,
	fingerprintSummary,
	loadLiveArtifacts,
	loadLiveCaptures,
	prepareProviderVisible,
	projectSessionCompactionState,
	providerSummaryText,
	successfulPair,
	type ChangeClass,
	type LiveCapture,
} from "./reproduce";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, "..");

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`missing required environment variable ${name}`);
	}
	return value;
}

function writeJson(name: string, value: unknown): void {
	mkdirSync(OUT_DIR, { recursive: true });
	const path = resolve(OUT_DIR, name);
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
	console.log(`wrote ${name}`);
}

// ---------------------------------------------------------------------------
// A. The live transition matrix
// ---------------------------------------------------------------------------

/**
 * The live transition matrix.
 *
 * For each stage, the consecutive transitions are classified by whether the
 * summary carrier's fingerprint changed. The matrix is built from the
 * preserved forensics captures, which record the fingerprint of the LARGEST
 * text part of each message — i.e. the compaction-summary carrier.
 */
function buildLiveTransitionMatrix(captures: LiveCapture[]): unknown {
	const stages = ["runtime_projection", "ai_sdk_prompt", "wire_request"];
	const perStage: Record<string, unknown[]> = {};
	for (const stage of stages) {
		const rows = captures
			.filter((capture) => capture.stage === stage)
			.sort((left, right) => left.iteration - right.iteration);
		const transitions: unknown[] = [];
		for (let index = 1; index < rows.length; index += 1) {
			const before = rows[index - 1];
			const after = rows[index];
			if (before.iteration === -1 || after.iteration === -1) {
				continue;
			}
			const changed =
				before.summaryFingerprint !== after.summaryFingerprint;
			const sameLength = before.summaryBytes === after.summaryBytes;
			transitions.push({
				fromIteration: before.iteration,
				toIteration: after.iteration,
				fromMessages: before.messageCount,
				toMessages: after.messageCount,
				summaryBytesBefore: before.summaryBytes,
				summaryBytesAfter: after.summaryBytes,
				sameByteLength: sameLength,
				summaryChanged: changed,
				changeClass: changed
					? "SUMMARY_CARRIER_CHANGED"
					: "UNCHANGED",
				systemFingerprintStable:
					before.systemFingerprint === after.systemFingerprint,
				toolInventoryStable:
					before.toolFingerprints.join(",") ===
					after.toolFingerprints.join(","),
				fromSummaryFingerprint: before.summaryFingerprint,
				toSummaryFingerprint: after.summaryFingerprint,
			});
		}
		perStage[stage] = transitions;
	}
	return {
		schema: "cline.compaction-summary-churn.live-transition-matrix.v1",
		note: [
			"Built from the preserved prefix-forensics captures of the live session.",
			"The summary carrier is the message part with the LARGEST text byte count.",
			"'summaryChanged' is a keyed-fingerprint comparison inside ONE capture cohort.",
			"These fingerprints are OPAQUE identities: they establish content",
			"difference, NOT tokenizer offsets and NOT provider cache hits.",
		],
		stages: perStage,
	};
}

// ---------------------------------------------------------------------------
// B. The real-production-seam reproduction
// ---------------------------------------------------------------------------

interface PreparedOutcome {
	readonly projectedCount: number;
	readonly summaryText: string;
	readonly providerSummaryText: string;
	readonly fingerprints: ReturnType<typeof fingerprintSummary>;
}

/**
 * The reproduction drives the REAL production pipeline against the REAL
 * persisted sidecar and the REAL canonical transcript of the live session.
 *
 * H0 is the canonical history AS IT WAS at the compaction boundary. H1 and H2
 * are APPEND-ONLY continuations of it: a new successful tool call/result pair
 * is appended, nothing else is modified.
 *
 * The persisted sidecar is NOT modified between preparations.
 */
async function prepareOutcome(
	sidecar: Parameters<typeof projectSessionCompactionState>[0],
	history: readonly MessageWithMetadata[],
): Promise<PreparedOutcome> {
	// The REAL projector, against the UNCHANGED persisted sidecar.
	const projected = projectSessionCompactionState(sidecar, history);
	if (!projected) {
		throw new Error("projectSessionCompactionState() rejected the real sidecar");
	}
	// The production composition (contract then evidence).
	const prepared = await prepareProviderVisible(projected, history, {
		contract: true,
		evidence: true,
	});
	// The REAL provider-request preparation seam.
	const request = buildProviderRequest(prepared);
	const summaryText = providerSummaryText(prepared);
	return {
		projectedCount: projected.length,
		summaryText,
		providerSummaryText: providerSummaryText(request),
		fingerprints: fingerprintSummary(summaryText),
	};
}

function transitionRow(
	label: string,
	before: PreparedOutcome,
	after: PreparedOutcome,
): unknown {
	return {
		transition: label,
		changeClass: classifyChange(
			before.fingerprints,
			after.fingerprints,
		) as ChangeClass,
		summaryChanged:
			before.fingerprints.summaryFingerprint !==
			after.fingerprints.summaryFingerprint,
		summaryBytesBefore: before.fingerprints.summaryBytes,
		summaryBytesAfter: after.fingerprints.summaryBytes,
		sameByteLength:
			before.fingerprints.summaryBytes ===
			after.fingerprints.summaryBytes,
		contractChanged:
			before.fingerprints.contractFingerprint !==
			after.fingerprints.contractFingerprint,
		evidenceChanged:
			before.fingerprints.evidenceFingerprint !==
			after.fingerprints.evidenceFingerprint,
		proseChanged:
			before.fingerprints.proseFingerprint !==
			after.fingerprints.proseFingerprint,
		commonPrefixBytes: commonPrefixLength(
			before.providerSummaryText,
			after.providerSummaryText,
		),
		providerVisibleChanged:
			before.providerSummaryText !== after.providerSummaryText,
	};
}

// ---------------------------------------------------------------------------
// C. The 2x2 causal ablation
// ---------------------------------------------------------------------------

interface AblationVariant {
	readonly id: string;
	readonly label: string;
	readonly contract: boolean;
	readonly evidence: boolean;
}

const VARIANTS: AblationVariant[] = [
	{
		id: "A",
		label: "Original projection (contract OFF, evidence OFF)",
		contract: false,
		evidence: false,
	},
	{
		id: "B",
		label: "Contract only (contract ON, evidence OFF)",
		contract: true,
		evidence: false,
	},
	{
		id: "C",
		label: "Evidence only (contract OFF, evidence ON)",
		contract: false,
		evidence: true,
	},
	{
		id: "D",
		label: "Production composition (contract ON, evidence ON)",
		contract: true,
		evidence: true,
	},
];

/**
 * The controlled 2x2 comparison.
 *
 * Every variant uses the SAME projected state, the SAME canonical histories,
 * the SAME provider configuration and the SAME production helper functions.
 * The ONLY difference is which production carry-forward is invoked.
 */
async function buildAblationMatrix(): Promise<unknown> {
	const sidecarPath = requireEnv("ACT_CHURN_SIDECAR");
	const canonicalPath = requireEnv("ACT_CHURN_CANONICAL");
	const { sidecar, canonical } = loadLiveArtifacts(
		sidecarPath,
		canonicalPath,
	);

	const h0 = canonical.slice(0, sidecar.source_message_count);
	const h1 = [
		...canonical,
		...successfulPair("act_churn_probe_call_h1", "echo act-churn-h1"),
	];
	const h2 = [
		...h1,
		...successfulPair("act_churn_probe_call_h2", "echo act-churn-h2"),
	];

	const sidecarBefore = JSON.stringify(sidecar);
	const variantRows: unknown[] = [];

	for (const variant of VARIANTS) {
		const projected = projectSessionCompactionState(sidecar, h0);
		if (!projected) {
			throw new Error("projectSessionCompactionState() rejected the sidecar");
		}
		const prepareFor = async (
			history: readonly MessageWithMetadata[],
		): Promise<PreparedOutcome> => {
			const prepared = await prepareProviderVisible(
				projected,
				history,
				{ contract: variant.contract, evidence: variant.evidence },
			);
			const request = buildProviderRequest(prepared);
			const summaryText = providerSummaryText(prepared);
			return {
				projectedCount: projected.length,
				summaryText,
				providerSummaryText: providerSummaryText(request),
				fingerprints: fingerprintSummary(summaryText),
			};
		};

		const o0 = await prepareFor(h0);
		const o1 = await prepareFor(h1);
		const o2 = await prepareFor(h2);

		variantRows.push({
			variant: variant.id,
			label: variant.label,
			switches: { contract: variant.contract, evidence: variant.evidence },
			outcomes: {
				h0: {
					summaryBytes: o0.fingerprints.summaryBytes,
					summaryFingerprint: o0.fingerprints.summaryFingerprint,
					contractPresent: o0.fingerprints.contractPresent,
					evidencePresent: o0.fingerprints.evidencePresent,
				},
				h1: {
					summaryBytes: o1.fingerprints.summaryBytes,
					summaryFingerprint: o1.fingerprints.summaryFingerprint,
					contractPresent: o1.fingerprints.contractPresent,
					evidencePresent: o1.fingerprints.evidencePresent,
				},
				h2: {
					summaryBytes: o2.fingerprints.summaryBytes,
					summaryFingerprint: o2.fingerprints.summaryFingerprint,
					contractPresent: o2.fingerprints.contractPresent,
					evidencePresent: o2.fingerprints.evidencePresent,
				},
			},
			transitions: [
				transitionRow("H0->H1", o0, o1),
				transitionRow("H1->H2", o1, o2),
			],
			summaryRewrittenOnEachContinuation:
				o0.fingerprints.summaryFingerprint !==
					o1.fingerprints.summaryFingerprint ||
				o1.fingerprints.summaryFingerprint !==
					o2.fingerprints.summaryFingerprint,
			firstChangedMessageOrPart:
				o0.fingerprints.summaryFingerprint !==
				o1.fingerprints.summaryFingerprint
					? "compaction_summary text part"
					: "none",
			providerVisibleCommonPrefixH0H1: commonPrefixLength(
				o0.providerSummaryText,
				o1.providerSummaryText,
			),
			providerVisibleCommonPrefixH1H2: commonPrefixLength(
				o1.providerSummaryText,
				o2.providerSummaryText,
			),
		});
	}

	const sidecarAfter = JSON.stringify(sidecar);
	return {
		schema: "cline.compaction-summary-churn.ablation-matrix.v1",
		method: [
			"Controlled 2x2: task-contract restoration ON/OFF x verified-evidence",
			"restoration ON/OFF. The switches exist ONLY in this disposable offline",
			"experiment; they are NOT production flags and NOT public APIs.",
			"Every variant uses the SAME projected state, the SAME canonical",
			"histories and the SAME production helper functions.",
		],
		sidecarUnmodified: sidecarBefore === sidecarAfter,
		variants: variantRows,
	};
}

// ---------------------------------------------------------------------------
// D. Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const captureDir = requireEnv("ACT_CHURN_CAPTURES");
	const captures = loadLiveCaptures(captureDir);
	writeJson("live-transition-matrix.json", buildLiveTransitionMatrix(captures));

	const sidecarPath = requireEnv("ACT_CHURN_SIDECAR");
	const canonicalPath = requireEnv("ACT_CHURN_CANONICAL");
	const { sidecar, canonical } = loadLiveArtifacts(
		sidecarPath,
		canonicalPath,
	);

	const h0 = canonical.slice(0, sidecar.source_message_count);
	const h1 = [
		...canonical,
		...successfulPair("act_churn_probe_call_h1", "echo act-churn-h1"),
	];
	const h2 = [
		...h1,
		...successfulPair("act_churn_probe_call_h2", "echo act-churn-h2"),
	];
	const sidecarBefore = JSON.stringify(sidecar);
	const o0 = await prepareOutcome(sidecar, h0);
	const o1 = await prepareOutcome(sidecar, h1);
	const o2 = await prepareOutcome(sidecar, h2);
	const sidecarAfter = JSON.stringify(sidecar);

	const ledger0 = extractVerifiedToolOutcomes(h0);
	const ledger1 = extractVerifiedToolOutcomes(h1);
	const ledger2 = extractVerifiedToolOutcomes(h2);

	writeJson("production-reproduction.json", {
		schema: "cline.compaction-summary-churn.production-reproduction.v1",
		productionFunctionsExercised: [
			"projectSessionCompactionState()",
			"applyTaskContractToCompactedMessages()",
			"applyVerifiedEvidenceToCompactedMessages()",
			"MessageBuilder.buildForApi()",
		],
		artifactIdentities: {
			sidecarSourceMessageCount: sidecar.source_message_count,
			sidecarMessageCount: sidecar.messages.length,
			sidecarSourcePrefixHashPresent:
				typeof sidecar.source_prefix_hash === "string",
			canonicalMessageCount: canonical.length,
			canonicalTailBeyondBoundary:
				canonical.length - sidecar.source_message_count,
		},
		appendOnlyInvariants: {
			h0IsCanonicalPrefix:
				JSON.stringify(h0) === JSON.stringify(canonical.slice(0, h0.length)),
			canonicalIsPrefixOfH1:
				JSON.stringify(canonical) ===
				JSON.stringify(h1.slice(0, canonical.length)),
			h1IsPrefixOfH2:
				JSON.stringify(h1) === JSON.stringify(h2.slice(0, h1.length)),
			h0MessageCount: h0.length,
			canonicalMessageCount: canonical.length,
			h1MessageCount: h1.length,
			h2MessageCount: h2.length,
			sidecarUnmodified: sidecarBefore === sidecarAfter,
		},
		verifiedOutcomeLedger: {
			h0: {
				outcomes: ledger0.outcomes.length,
				rejected: ledger0.rejected.length,
			},
			h1: {
				outcomes: ledger1.outcomes.length,
				rejected: ledger1.rejected.length,
			},
			h2: {
				outcomes: ledger2.outcomes.length,
				rejected: ledger2.rejected.length,
			},
		},
		outcomes: {
			h0: {
				projectedCount: o0.projectedCount,
				summaryBytes: o0.fingerprints.summaryBytes,
				summaryFingerprint: o0.fingerprints.summaryFingerprint,
				contractPresent: o0.fingerprints.contractPresent,
				contractFingerprint: o0.fingerprints.contractFingerprint,
				evidencePresent: o0.fingerprints.evidencePresent,
				evidenceFingerprint: o0.fingerprints.evidenceFingerprint,
				proseBytes: o0.fingerprints.proseBytes,
				proseFingerprint: o0.fingerprints.proseFingerprint,
			},
			h1: {
				projectedCount: o1.projectedCount,
				summaryBytes: o1.fingerprints.summaryBytes,
				summaryFingerprint: o1.fingerprints.summaryFingerprint,
				contractPresent: o1.fingerprints.contractPresent,
				contractFingerprint: o1.fingerprints.contractFingerprint,
				evidencePresent: o1.fingerprints.evidencePresent,
				evidenceFingerprint: o1.fingerprints.evidenceFingerprint,
				proseBytes: o1.fingerprints.proseBytes,
				proseFingerprint: o1.fingerprints.proseFingerprint,
			},
			h2: {
				projectedCount: o2.projectedCount,
				summaryBytes: o2.fingerprints.summaryBytes,
				summaryFingerprint: o2.fingerprints.summaryFingerprint,
				contractPresent: o2.fingerprints.contractPresent,
				contractFingerprint: o2.fingerprints.contractFingerprint,
				evidencePresent: o2.fingerprints.evidencePresent,
				evidenceFingerprint: o2.fingerprints.evidenceFingerprint,
				proseBytes: o2.fingerprints.proseBytes,
				proseFingerprint: o2.fingerprints.proseFingerprint,
			},
		},
		transitions: [
			transitionRow("H0->H1", o0, o1),
			transitionRow("H1->H2", o1, o2),
		],
	});

	writeJson("ablation-matrix.json", await buildAblationMatrix());
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
