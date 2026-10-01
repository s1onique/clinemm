/**
 * ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-COMMIT-WHILE-RUN-ACTIVE-REPAIR01 §12/§13
 *
 * One-off replay of the predecessor REAL projection through the
 * repaired Elm kernel. Outputs JSON evidence for offline analysis.
 *
 * NOT a test. This is a deterministic replay run whose results are
 * captured into .factory/evidence. Run with:
 *
 *     bun apps/vscode/src/sdk/__tests__/replay-projection-once.mts \
 *         <trace.jsonl> <out.json>
 */

import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadKernel, replayTrace } from "../completion-authority-elm-replay"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, "../../../../../")
const KERNEL_PATH = path.resolve(REPO_ROOT, "apps/vscode/elm/completion-authority/vendor/completion-authority.js")

function sha256File(p: string): string {
	const text = fs.readFileSync(p, "utf8")
	return createHash("sha256").update(text).digest("hex")
}

async function main() {
	const tracePath = process.argv[2]
	const outPath = process.argv[3]
	if (!tracePath || !outPath) {
		console.error("usage: replay-projection-once.mts <trace.jsonl> <out.json>")
		process.exit(2)
	}
	const absTrace = path.resolve(tracePath)
	const sourceSha = sha256File(absTrace)
	const kernel = loadKernel(KERNEL_PATH)
	const r = await replayTrace({ kernel, tracePath: absTrace })
	const out = {
		sourceTracePath: absTrace,
		sourceTraceSha256: sourceSha,
		kernelPath: KERNEL_PATH,
		kernelSha256: sha256File(KERNEL_PATH),
		replay: r,
	}
	fs.mkdirSync(path.dirname(outPath), { recursive: true })
	fs.writeFileSync(outPath, JSON.stringify(out, null, 2))
	console.log("OK", outPath)
	console.log("eventsTotal:", r.eventsTotal)
	console.log("firstDivergenceKind:", r.firstDivergenceKind, "stage:", r.firstDivergenceStage, "seq:", r.firstDivergenceSeq)
	console.log("manufacturedIdentityCount:", r.manufacturedIdentityCount)
	console.log("originRewriteCount:", r.originRewriteCount)
	console.log("finalModel:", JSON.stringify(r.finalModel, null, 2))
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
