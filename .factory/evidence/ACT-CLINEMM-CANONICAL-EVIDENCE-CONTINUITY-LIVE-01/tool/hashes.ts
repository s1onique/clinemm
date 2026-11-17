/**
 * ACT-CLINEMM-CANONICAL-EVIDENCE-CONTINUITY-LIVE-01
 *
 * Emits the SHA-256 / byte-size manifest for the committed evidence package.
 *
 * The manifest covers the COMMITTED artifacts only. The live source artifacts
 * (canonical transcript, compaction sidecar, session manifest, exported trace)
 * are recorded as EXTERNAL REFERENCES with their own hashes, so a reader can
 * re-verify the live evidence without any raw artifact being committed.
 *
 * Usage:
 *   bun run tool/hashes.ts --out artifact-hashes.json
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const OUT_NAME = "artifact-hashes.json";
const pkgDir = join(import.meta.dir, "..");

const args = process.argv.slice(2);
let outName = OUT_NAME;
for (let i = 0; i < args.length; i += 1) {
	if (args[i] === "--out") {
		outName = args[i + 1] ?? OUT_NAME;
		i += 1;
	}
}

const COMMITTED = [
	"identity.json",
	"canonical-continuity-audit.json",
	"source-map.md",
	"qualification-report.md",
	"tool/audit.ts",
	"tool/hashes.ts",
];

function sha256File(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const hashes = COMMITTED.map((name) => {
	const path = join(pkgDir, name);
	return {
		name,
		sha256: sha256File(path),
		bytes: readFileSync(path).byteLength,
	};
});

const manifest = {
	schema: "cline.ACT-CLINEMM-CANONICAL-EVIDENCE-CONTINUITY-LIVE-01.artifact-hashes.v1",
	act: "ACT-CLINEMM-CANONICAL-EVIDENCE-CONTINUITY-LIVE-01",
	sourceHead: "8c3351e56d949b514f60bbfde0735e756ed082ca",
	sessionId: "1794892591345_7em4g",
	hashes,
	externalSourceArtifacts: [
		{
			name: "1794892591345_7em4g.messages.json",
			role: "CANONICAL_TRANSCRIPT",
			bytes: 394572,
			sha256: "b48b0f94ebc003a3a92bbf226fca3126433ec8d986d763a73e73ef258cf4e9b4",
			committed: false,
		},
		{
			name: "1794892591345_7em4g.compaction.json",
			role: "COMPACTION_STATE",
			bytes: 73907,
			sha256: "20461b286e3adc353f6f91d5e7314ef8eac38465a165650d8f0be14b2892a7bc",
			committed: false,
		},
		{
			name: "1794892591345_7em4g.json",
			role: "SESSION_MANIFEST",
			bytes: 2345,
			sha256: "0192cfca5cdd8a2afe1e916d33fbbf045035f466e4380cba0ed1e8aa9e68be3f",
			committed: false,
		},
		{
			name: "roundc-latency-trace(8).json",
			role: "AUTHORITATIVE_TRACE",
			bytes: 350052,
			sha256: "b84ee4a83f3819b4a849e2d05f95c044443e3d3fb036818aef98f9b7fe96b5e1",
			committed: false,
		},
	],
	privacy: {
		rawCanonicalMessagesCommitted: false,
		rawCompactionSidecarCommitted: false,
		rawTraceCommitted: false,
		rawToolResultPayloadsCommitted: false,
	},
};

process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
