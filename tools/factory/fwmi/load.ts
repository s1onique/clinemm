/**
 * tools/factory/fwmi/load.ts
 *
 * Loads an FWMI v1 interchange package from disk into a typed structure.
 *
 * Loading is deliberately SHALLOW: it parses JSON, checks that the required
 * artifacts exist, and checks `schema_version`. It does NOT validate
 * semantics — `validate.ts` owns that. Keeping the two apart means a
 * malformed package produces a precise diagnostic (missing artifact, bad
 * JSON, wrong schema version) rather than a cascade of derived complaints.
 *
 * The loader NEVER touches the ClineMM repository. It reads only the
 * interchange package directory the operator supplies.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	FWMI_SCHEMA_VERSION,
	type FwmiEpic,
	type FwmiHistoricalIndex,
	type FwmiPackage,
	type FwmiReconciliation,
	type FwmiSourceManifest,
	type FwmiValidationReceipt,
} from "./contract.ts";

export const MANIFEST_FILE = "source-manifest.json";
export const EPICS_DIR = "epics";
export const HISTORICAL_INDEX_FILE = "historical-index.json";
export const RECONCILIATION_FILE = "reconciliation.json";
export const FRONTIER_FILE = "frontier.md";
export const RECEIPT_FILE = "validation-receipt.json";

/** A problem found while loading the package. */
export interface FwmiLoadProblem {
	readonly code: string;
	readonly path: string;
	readonly message: string;
}

/** Result of a load attempt: either a package, or the reasons it failed. */
export type FwmiLoadResult =
	| { readonly ok: true; readonly package: FwmiPackage }
	| { readonly ok: false; readonly problems: readonly FwmiLoadProblem[] };

function parseJson(
	path: string,
	problems: FwmiLoadProblem[],
): unknown | undefined {
	const raw = readFileSync(path, "utf8");
	try {
		return JSON.parse(raw);
	} catch (err) {
		problems.push({
			code: "INVALID_JSON",
			path,
			message: (err as Error).message,
		});
		return undefined;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Load an FWMI v1 package rooted at `root`.
 *
 * The package MUST contain all six artifacts. A missing artifact is a
 * LOAD failure, not a validation warning: the interchange is incomplete
 * without it and no import may proceed.
 */
export function loadFwmiPackage(root: string): FwmiLoadResult {
	const problems: FwmiLoadProblem[] = [];

	const required = [
		MANIFEST_FILE,
		HISTORICAL_INDEX_FILE,
		RECONCILIATION_FILE,
		FRONTIER_FILE,
		RECEIPT_FILE,
	];
	for (const name of required) {
		const p = join(root, name);
		if (!existsSync(p)) {
			problems.push({
				code: "MISSING_ARTIFACT",
				path: p,
				message: `required artifact "${name}" is absent`,
			});
		}
	}
	const epicsDir = join(root, EPICS_DIR);
	if (!existsSync(epicsDir)) {
		problems.push({
			code: "MISSING_ARTIFACT",
			path: epicsDir,
			message: `required directory "${EPICS_DIR}/" is absent`,
		});
	}
	if (problems.length > 0) return { ok: false, problems };

	// --- manifest ---
	const manifestRaw = parseJson(join(root, MANIFEST_FILE), problems);
	if (!isRecord(manifestRaw)) {
		if (manifestRaw !== undefined) {
			problems.push({
				code: "NOT_AN_OBJECT",
				path: MANIFEST_FILE,
				message: "manifest is not a JSON object",
			});
		}
		return { ok: false, problems };
	}
	if (manifestRaw.schema_version !== FWMI_SCHEMA_VERSION) {
		problems.push({
			code: "SCHEMA_VERSION_MISMATCH",
			path: MANIFEST_FILE,
			message: `schema_version must be ${FWMI_SCHEMA_VERSION}, got ${JSON.stringify(manifestRaw.schema_version)}`,
		});
	}

	// --- epics ---
	const epics: FwmiEpic[] = [];
	const epicFiles = readdirSync(epicsDir)
		.filter((f) => f.endsWith(".json"))
		.sort();
	for (const file of epicFiles) {
		const p = join(epicsDir, file);
		const raw = parseJson(p, problems);
		if (raw === undefined) continue;
		if (!isRecord(raw)) {
			problems.push({
				code: "NOT_AN_OBJECT",
				path: p,
				message: "epic artifact is not a JSON object",
			});
			continue;
		}
		if (raw.schema_version !== FWMI_SCHEMA_VERSION) {
			problems.push({
				code: "SCHEMA_VERSION_MISMATCH",
				path: p,
				message: `schema_version must be ${FWMI_SCHEMA_VERSION}, got ${JSON.stringify(raw.schema_version)}`,
			});
		}
		epics.push(raw as unknown as FwmiEpic);
	}
	if (epicFiles.length === 0) {
		problems.push({
			code: "NO_EPIC_ARTIFACTS",
			path: epicsDir,
			message: "epics/ contains no .json artifacts",
		});
	}

	// --- historical index ---
	const historicalRaw = parseJson(join(root, HISTORICAL_INDEX_FILE), problems);
	if (!isRecord(historicalRaw)) {
		if (historicalRaw !== undefined) {
			problems.push({
				code: "NOT_AN_OBJECT",
				path: HISTORICAL_INDEX_FILE,
				message: "historical index is not a JSON object",
			});
		}
		return { ok: false, problems };
	}
	if (historicalRaw.schema_version !== FWMI_SCHEMA_VERSION) {
		problems.push({
			code: "SCHEMA_VERSION_MISMATCH",
			path: HISTORICAL_INDEX_FILE,
			message: `schema_version must be ${FWMI_SCHEMA_VERSION}, got ${JSON.stringify(historicalRaw.schema_version)}`,
		});
	}

	// --- reconciliation ---
	const reconciliationRaw = parseJson(
		join(root, RECONCILIATION_FILE),
		problems,
	);
	if (!isRecord(reconciliationRaw)) {
		if (reconciliationRaw !== undefined) {
			problems.push({
				code: "NOT_AN_OBJECT",
				path: RECONCILIATION_FILE,
				message: "reconciliation is not a JSON object",
			});
		}
		return { ok: false, problems };
	}
	if (reconciliationRaw.schema_version !== FWMI_SCHEMA_VERSION) {
		problems.push({
			code: "SCHEMA_VERSION_MISMATCH",
			path: RECONCILIATION_FILE,
			message: `schema_version must be ${FWMI_SCHEMA_VERSION}, got ${JSON.stringify(reconciliationRaw.schema_version)}`,
		});
	}

	// --- receipt ---
	const receiptRaw = parseJson(join(root, RECEIPT_FILE), problems);
	if (!isRecord(receiptRaw)) {
		if (receiptRaw !== undefined) {
			problems.push({
				code: "NOT_AN_OBJECT",
				path: RECEIPT_FILE,
				message: "validation receipt is not a JSON object",
			});
		}
		return { ok: false, problems };
	}
	if (receiptRaw.schema_version !== FWMI_SCHEMA_VERSION) {
		problems.push({
			code: "SCHEMA_VERSION_MISMATCH",
			path: RECEIPT_FILE,
			message: `schema_version must be ${FWMI_SCHEMA_VERSION}, got ${JSON.stringify(receiptRaw.schema_version)}`,
		});
	}

	// --- frontier ---
	const frontierMarkdown = readFileSync(join(root, FRONTIER_FILE), "utf8");

	if (problems.length > 0) return { ok: false, problems };

	return {
		ok: true,
		package: {
			root,
			manifest: manifestRaw as unknown as FwmiSourceManifest,
			epics,
			historicalIndex: historicalRaw as unknown as FwmiHistoricalIndex,
			reconciliation: reconciliationRaw as unknown as FwmiReconciliation,
			receipt: receiptRaw as unknown as FwmiValidationReceipt,
			frontierMarkdown,
		},
	};
}
