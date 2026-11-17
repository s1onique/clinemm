/**
 * ACT-CLINEMM-ESTIMATOR-INDEPENDENT-HOLDOUT-01 — test receipt writer.
 *
 * The receipt records the ACTUALLY executed test commands and their
 * observed outcomes. It is written by the same runner that produced the
 * other artifacts so that the receipt and the artifacts share one run.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ACT, OUTPUT_DIR, writeArtifact } from "./holdout";

export interface TestCommandRecord {
	readonly command: string;
	readonly result: string;
	readonly observed: string;
}

export function writeTestReceipt(
	sourceHead: string,
	toolSha256: string,
	commands: readonly TestCommandRecord[],
	extra: Record<string, unknown> = {},
): { path: string; sha256: string; bytes: number } {
	return writeArtifact("test-receipt.json", {
		schema: `cline.${ACT}.test-receipt.v1`,
		act: ACT,
		toolVersion: "offline-independent-holdout.v1",
		sourceHead,
		toolSha256,
		commands,
		...extra,
	});
}

/**
 * Write the ONE authoritative artifact hash manifest.
 *
 * The manifest lists every committed artifact of THIS ACT except the
 * manifest itself (a file cannot contain its own hash). There is no
 * recursive or duplicated hash bookkeeping: exactly one manifest, one
 * entry per artifact.
 */
export function writeArtifactHashManifest(
	sourceHead: string,
): { path: string; sha256: string; bytes: number } {
	const names = readdirSync(OUTPUT_DIR)
		.filter((name) => name !== "artifact-hashes.json")
		.filter((name) => statSync(join(OUTPUT_DIR, name)).isFile())
		.filter((name) => name.endsWith(".json") || name.endsWith(".md"))
		.sort();

	const toolDir = join(OUTPUT_DIR, "tool");
	const toolNames = readdirSync(toolDir)
		.filter((name) => statSync(join(toolDir, name)).isFile())
		.sort();

	const hashOf = (path: string) => {
		const bytes = readFileSync(path);
		return {
			sha256: createHash("sha256").update(bytes).digest("hex"),
			bytes: bytes.byteLength,
		};
	};

	return writeArtifact("artifact-hashes.json", {
		schema: `cline.${ACT}.artifact-hashes.v1`,
		act: ACT,
		sourceHead,
		hashes: [
			...names.map((name) => {
				const path = join(OUTPUT_DIR, name);
				return { name, ...hashOf(path) };
			}),
			...toolNames.map((name) => {
				const path = join(toolDir, name);
				return { name: `tool/${name}`, ...hashOf(path) };
			}),
		],
	});
}

