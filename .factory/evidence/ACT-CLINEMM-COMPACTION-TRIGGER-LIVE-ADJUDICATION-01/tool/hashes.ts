/**
 * ACT-CLINEMM-COMPACTION-TRIGGER-LIVE-ADJUDICATION-01 — artifact hash manifest.
 *
 * Computes the SHA-256 and byte length of every artifact in the evidence
 * directory (excluding this manifest itself) and writes
 * `artifact-hashes.json`.
 *
 * Run:
 *   bun <this-file> --dir "<evidence dir>" --source-head "<sha>"
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ACT = "ACT-CLINEMM-COMPACTION-TRIGGER-LIVE-ADJUDICATION-01";
const MANIFEST = "artifact-hashes.json";

function parseArgs(argv: string[]): { dir: string; sourceHead: string } {
	let dir = "";
	let sourceHead = "";
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		const next = argv[i + 1];
		if (arg === "--dir" && next) {
			dir = next;
			i += 1;
		} else if (arg === "--source-head" && next) {
			sourceHead = next;
			i += 1;
		}
	}
	if (!dir || !sourceHead) {
		throw new Error("usage: hashes.ts --dir <dir> --source-head <sha>");
	}
	return { dir, sourceHead };
}

/** Every file under `dir`, recursively, EXCLUDING the manifest. */
function collectFiles(dir: string): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			found.push(...collectFiles(full));
		} else if (entry.name !== MANIFEST) {
			found.push(full);
		}
	}
	return found.sort();
}

function main(): void {
	const { dir, sourceHead } = parseArgs(process.argv.slice(2));
	const hashes = collectFiles(dir).map((full) => {
		const buffer = readFileSync(full);
		return {
			name: relative(dir, full),
			sha256: createHash("sha256").update(buffer).digest("hex"),
			bytes: statSync(full).size,
		};
	});
	const manifest = {
		schema: `cline.${ACT}.artifact-hashes.v1`,
		act: ACT,
		sourceHead,
		hashes,
	};
	writeFileSync(
		join(dir, MANIFEST),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);
	console.log(
		JSON.stringify(
			{ entries: hashes.length, sourceHead },
			null,
			2,
		),
	);
}

main();
