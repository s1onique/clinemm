#!/usr/bin/env bun
/**
 * ACT-CLINEMM-M31-CATALOG-SNAPSHOT-REFRESH01 — one-off bounded catalog refresh.
 *
 * WHY THIS EXISTS
 * ---------------
 * `bun -F @cline/llms generate:models` regenerates the WHOLE catalog from the
 * live models.dev payload. That is unbounded and destructive for this ACT: it
 * rewrites ~6,271 model entries across ~204 providers, and it DROPS the
 * MiniMax M2.x records that upstream has since marked `deprecated` even though
 * the checked-in snapshot still publishes them.
 *
 * This ACT's contract is the opposite: add EXACTLY ONE upstream-authoritative
 * model entry (`MiniMax-M3.1-Flash` for the `minimax` provider) and change
 * NOTHING else.
 *
 * HOW IT STAYS HONEST
 * -------------------
 *  1. The new entry is derived by the REAL production normalizer
 *     (`normalizeModelsDevProviderModels` in
 *     `sdk/packages/llms/src/catalog/catalog-live.ts`) — this script never
 *     re-implements the models.dev -> ModelInfo mapping.
 *  2. The normalizer is run TWICE — once on the full upstream payload and
 *     once on a payload scoped to the `minimax` provider — and the two
 *     `minimax` results must be IDENTICAL. That proves the scoping does not
 *     change the derived entry.
 *  3. The checked-in `catalog.generated.ts` providers JSON is parsed, the one
 *     model is inserted, and the result is re-serialized with the generator's
 *     own `JSON.stringify(value, null, 2)` shape. The script then PROVES that
 *     the only textual difference is the inserted block, and that the parsed
 *     before/after catalogs differ by exactly one added model id.
 *
 * The script is a one-off evidence tool. It is NOT product code and it does
 * NOT change the permanent generator.
 *
 * USAGE
 * -----
 *   bun .factory/evidence/ACT-CLINEMM-M31-CATALOG-SNAPSHOT-REFRESH01/refresh-minimax-m31-flash.ts \
 *     [--payload=/path/to/models-dev-api.json] [--apply]
 *
 * Without `--apply` it only reports the derived entry and the would-be diff.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type ModelsDevPayload,
	normalizeModelsDevProviderModels,
} from "../../../sdk/packages/llms/src/catalog/catalog-live";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
const CATALOG_PATH = join(
	REPO_ROOT,
	"sdk/packages/llms/src/catalog/catalog.generated.ts",
);
const MODELS_DEV_URL = "https://models.dev/api.json";

const PROVIDER_ID = "minimax";
const MODEL_ID = "MiniMax-M3.1-Flash";

/** The upstream values this ACT pins, used as an independent cross-check. */
const EXPECTED = {
	contextWindow: 1_000_000,
	maxInputTokens: 1_000_000,
	maxTokens: 524_288,
	pricing: { input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0 },
	releaseDate: "2026-10-19",
	family: "minimax",
	reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
	capabilities: [
		"images",
		"video",
		"tools",
		"reasoning",
		"temperature",
		"prompt-cache",
	],
	/**
	 * The normalizer drops a text-only modality declaration (the same shape as
	 * the checked-in `MiniMax-M3` entry), so the derived entry carries NO
	 * `modalities` key. `images`/`video` survive as capabilities.
	 */
	modalities: undefined,
};

function fail(message: string): never {
	throw new Error(message);
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) {
		fail(message);
	}
}

function sha256(input: string | Buffer): string {
	return createHash("sha256").update(input).digest("hex");
}

/**
 * Locate the providers JSON literal inside the generated catalog module.
 *
 * The generator emits `providers: ${JSON.stringify(sortedProviders, null, 2)}`
 * inside a template literal, so the providers object starts right after the
 * `providers: ` marker and runs to the matching close brace.
 *
 * The marker MUST include the opening brace. The module also declares a
 * TypeScript type annotation `providers: Record<string, Record<string, ModelInfo>>`
 * at the same indent, and a bare `providers: ` marker would match that
 * annotation first.
 */
function extractProvidersJson(source: string): {
	prefix: string;
	providersJson: string;
	suffix: string;
} {
	const marker = "\n  providers: {";
	const markerIndex = source.indexOf(marker);
	assert(markerIndex >= 0, "could not find the `providers: {` marker");
	const jsonStart = markerIndex + marker.length - 1;

	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let index = jsonStart; index < source.length; index += 1) {
		const char = source[index];
		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (char === "\\") {
				escaped = true;
			} else if (char === '"') {
				inString = false;
			}
			continue;
		}
		if (char === '"') {
			inString = true;
			continue;
		}
		if (char === "{") {
			depth += 1;
		} else if (char === "}") {
			depth -= 1;
			if (depth === 0) {
				return {
					prefix: source.slice(0, jsonStart),
					providersJson: source.slice(jsonStart, index + 1),
					suffix: source.slice(index + 1),
				};
			}
		}
	}
	return fail("could not find the end of the providers JSON literal");
}

async function loadPayload(): Promise<{
	payload: ModelsDevPayload;
	provenance: {
		url: string;
		retrievedAt: string;
		payloadBytes: number;
		payloadSha256: string;
		source: "local-snapshot" | "live-http";
	};
}> {
	const payloadArg = process.argv.find((arg) => arg.startsWith("--payload="));
	if (payloadArg) {
		const path = payloadArg.slice("--payload=".length);
		const bytes = readFileSync(path);
		return {
			payload: JSON.parse(bytes.toString("utf8")) as ModelsDevPayload,
			provenance: {
				url: MODELS_DEV_URL,
				retrievedAt: new Date().toISOString(),
				payloadBytes: bytes.byteLength,
				payloadSha256: sha256(bytes),
				source: "local-snapshot",
			},
		};
	}

	const response = await fetch(MODELS_DEV_URL);
	assert(response.ok, `models.dev request failed: HTTP ${response.status}`);
	const bytes = Buffer.from(await response.arrayBuffer());
	return {
		payload: JSON.parse(bytes.toString("utf8")) as ModelsDevPayload,
		provenance: {
			url: MODELS_DEV_URL,
			retrievedAt: new Date().toISOString(),
			payloadBytes: bytes.byteLength,
			payloadSha256: sha256(bytes),
			source: "live-http",
		},
	};
}

async function main(): Promise<void> {
	const apply = process.argv.includes("--apply");
	const { payload, provenance } = await loadPayload();

	// 1. Derive the entry with the REAL production normalizer, twice.
	const fullNormalized = normalizeModelsDevProviderModels(payload);
	const scopedPayload: ModelsDevPayload = {
		[PROVIDER_ID]: payload[PROVIDER_ID],
	};
	const scopedNormalized = normalizeModelsDevProviderModels(scopedPayload);

	assert(
		fullNormalized[PROVIDER_ID],
		`the upstream payload has no normalized \`${PROVIDER_ID}\` provider`,
	);
	assert(
		JSON.stringify(fullNormalized[PROVIDER_ID]) ===
			JSON.stringify(scopedNormalized[PROVIDER_ID]),
		"scoping the payload changed the normalized provider — refusing to continue",
	);

	const derived = fullNormalized[PROVIDER_ID][MODEL_ID];
	assert(
		derived,
		`the upstream payload has no normalized \`${PROVIDER_ID}\`/\`${MODEL_ID}\` model`,
	);

	// 2. Cross-check the derived entry against the pinned upstream values.
	assert(
		derived.contextWindow === EXPECTED.contextWindow,
		`contextWindow is ${derived.contextWindow}, expected ${EXPECTED.contextWindow}`,
	);
	assert(
		derived.maxInputTokens === EXPECTED.maxInputTokens,
		`maxInputTokens is ${derived.maxInputTokens}, expected ${EXPECTED.maxInputTokens}`,
	);
	assert(
		derived.maxTokens === EXPECTED.maxTokens,
		`maxTokens is ${derived.maxTokens}, expected ${EXPECTED.maxTokens}`,
	);
	assert(
		derived.releaseDate === EXPECTED.releaseDate,
		`releaseDate is ${derived.releaseDate}, expected ${EXPECTED.releaseDate}`,
	);
	assert(
		derived.family === EXPECTED.family,
		`family is ${derived.family}, expected ${EXPECTED.family}`,
	);
	assert(
		JSON.stringify(derived.pricing) === JSON.stringify(EXPECTED.pricing),
		`pricing is ${JSON.stringify(derived.pricing)}, expected ${JSON.stringify(EXPECTED.pricing)}`,
	);
	assert(
		JSON.stringify(derived.reasoningOptions) ===
			JSON.stringify([{ type: "effort", values: EXPECTED.reasoningEfforts }]),
		`reasoningOptions is ${JSON.stringify(derived.reasoningOptions)}, expected the pinned effort ladder`,
	);
	assert(
		JSON.stringify(derived.capabilities) ===
			JSON.stringify(EXPECTED.capabilities),
		`capabilities are ${JSON.stringify(derived.capabilities)}, expected ${JSON.stringify(EXPECTED.capabilities)}`,
	);
	assert(
		JSON.stringify(derived.modalities) === JSON.stringify(EXPECTED.modalities),
		`modalities are ${JSON.stringify(derived.modalities)}, expected ${JSON.stringify(EXPECTED.modalities)}`,
	);
	assert(
		!("modalities" in derived),
		"the derived entry unexpectedly carries a `modalities` key",
	);

	// 3. Insert into the checked-in snapshot and prove the delta is exactly one model.
	const source = readFileSync(CATALOG_PATH, "utf8");
	const { prefix, providersJson, suffix } = extractProvidersJson(source);
	const providers = JSON.parse(providersJson) as Record<
		string,
		Record<string, unknown>
	>;

	// The generator's own serialization shape must round-trip byte-for-byte.
	assert(
		JSON.stringify(providers, null, 2) === providersJson,
		"the checked-in providers JSON does not round-trip through the generator's serialization shape",
	);

	const beforeModels = Object.values(providers).reduce(
		(count, models) => count + Object.keys(models).length,
		0,
	);
	const providerModels = providers[PROVIDER_ID];
	assert(providerModels, `the snapshot has no \`${PROVIDER_ID}\` provider`);

	if (MODEL_ID in providerModels) {
		// The refresh is idempotent: re-running it on an already-refreshed
		// snapshot is a verified NO-OP, not a double insert.
		const existing = providerModels[MODEL_ID];
		assert(
			JSON.stringify(existing) === JSON.stringify(derived),
			`the snapshot already contains \`${PROVIDER_ID}\`/\`${MODEL_ID}\` with DIFFERENT metadata — refusing to continue`,
		);
		console.log(
			JSON.stringify(
				{
					act: "ACT-CLINEMM-M31-CATALOG-SNAPSHOT-REFRESH01",
					sourceHead: process.env.SOURCE_HEAD ?? null,
					upstream: provenance,
					providerId: PROVIDER_ID,
					modelId: MODEL_ID,
					result: "already-present-identical",
					derivedEntry: derived,
					providersCount: Object.keys(providers).length,
					modelsCount: beforeModels,
					catalogSha256: sha256(source),
				},
				null,
				2,
			),
		);
		console.log(
			"\nNO-OP — the snapshot already contains this exact entry. Nothing written.",
		);
		return;
	}

	// The snapshot lists models newest-release-first, so the new model leads.
	const nextProviderModels = { [MODEL_ID]: derived, ...providerModels };
	const nextProviders = { ...providers, [PROVIDER_ID]: nextProviderModels };
	const nextProvidersJson = JSON.stringify(nextProviders, null, 2);

	// 4. Prove the ONLY semantic difference is one added model id.
	const beforeModelIds = new Set<string>();
	for (const models of Object.values(providers)) {
		for (const modelId of Object.keys(models)) {
			beforeModelIds.add(modelId);
		}
	}
	const afterModelIds = new Set<string>();
	for (const models of Object.values(nextProviders)) {
		for (const modelId of Object.keys(models)) {
			afterModelIds.add(modelId);
		}
	}
	const addedModelIds = [...afterModelIds].filter(
		(id) => !beforeModelIds.has(id),
	);
	const removedModelIds = [...beforeModelIds].filter(
		(id) => !afterModelIds.has(id),
	);
	assert(
		removedModelIds.length === 0,
		`the refresh would remove model ids: ${JSON.stringify(removedModelIds)}`,
	);
	assert(
		JSON.stringify(addedModelIds) === JSON.stringify([MODEL_ID]),
		`the refresh adds model ids ${JSON.stringify(addedModelIds)}, expected exactly ["${MODEL_ID}"]`,
	);

	// 5. Prove every OTHER model is byte-identical.
	for (const [providerId, models] of Object.entries(providers)) {
		for (const [modelId, model] of Object.entries(models)) {
			assert(
				JSON.stringify(nextProviders[providerId][modelId]) ===
					JSON.stringify(model),
				`the refresh would change ${providerId}/${modelId}`,
			);
		}
	}

	const afterModels = Object.values(nextProviders).reduce(
		(count, models) => count + Object.keys(models).length,
		0,
	);

	const report = {
		act: "ACT-CLINEMM-M31-CATALOG-SNAPSHOT-REFRESH01",
		sourceHead: process.env.SOURCE_HEAD ?? null,
		upstream: provenance,
		providerId: PROVIDER_ID,
		modelId: MODEL_ID,
		derivedEntry: derived,
		modelsBefore: beforeModels,
		modelsAfter: afterModels,
		addedModelIds,
		removedModelIds,
		providersCount: Object.keys(providers).length,
		catalogSha256Before: sha256(source),
		catalogSha256After: sha256(`${prefix}${nextProvidersJson}${suffix}`),
	};
	console.log(JSON.stringify(report, null, 2));

	if (!apply) {
		console.log(
			"\nDRY RUN — no file written. Re-run with --apply to write the bounded refresh.",
		);
		return;
	}

	// 6. Write the refreshed snapshot. The only non-providers change is the
	//    generation timestamp, which the generator always advances.
	const versionMatch = prefix.match(/\n {2}version: (\d+),\n/);
	assert(versionMatch, "could not find the catalog version marker");
	const nextVersion = Date.now();
	const nextPrefix = prefix.replace(
		/\n {2}version: \d+,\n/,
		`\n  version: ${nextVersion},\n`,
	);
	const nextSource = `${nextPrefix}${nextProvidersJson}${suffix}`;
	writeFileSync(CATALOG_PATH, nextSource, "utf8");
	console.log(
		`\nWROTE ${CATALOG_PATH} (version ${versionMatch[1]} -> ${nextVersion}, +1 model).`,
	);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
