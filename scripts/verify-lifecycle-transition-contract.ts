/**
 * ACT-CLINEMM-LIFECYCLE-TRACEABILITY-01
 *
 * Small deterministic validator for the bounded C9/C10 transition contract
 * and its Mermaid projection. It intentionally uses only Node/Bun built-ins.
 */
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const contractPath = resolve(root, "docs/acts/ACT-CLINEMM-LIFECYCLE-TRACEABILITY-01/transition-contract.tsv")
const diagramPath = resolve(root, "docs/acts/ACT-CLINEMM-LIFECYCLE-TRACEABILITY-01/c9-c10-traceability.mmd")
const ledgerPath = resolve(root, "docs/architecture/task-lifecycle/transitions.tsv")

const contract = readFileSync(contractPath, "utf8").trim().split("\n").slice(1).map((line) => line.split("\t"))
const ledger = new Set(readFileSync(ledgerPath, "utf8").trim().split("\n").slice(1).map((line) => line.split("\t")[0]))
const diagram = readFileSync(diagramPath, "utf8")
const errors: string[] = []
const ids = new Set<string>()

for (const row of contract) {
	const id = row[0]
	if (!id) continue
	if (ids.has(id)) errors.push(`duplicate transition id: ${id}`)
	ids.add(id)
	if (!ledger.has(id)) errors.push(`transition ${id} is absent from transitions.tsv`)
	const test = row[9]
	if (!test?.includes("__tests__/")) errors.push(`transition ${id} has no executable test reference`)
	const seam = row[8]
	if (!seam?.includes(".ts#")) errors.push(`transition ${id} has no source path and symbol reference`)
	if (!diagram.includes(id)) errors.push(`transition ${id} is absent from Mermaid projection`)
}

const requiredStatePairs: Record<string, [string, string]> = {
	"A-03": ["ElmConsulted", "ElmAuthorized"],
	"A-04": ["ElmAuthorized", "PhaseCommitted"],
	"A-05": ["ElmConsulted", "C10Withheld"],
	"P-06": ["PhaseCommitted", "MarkerPromoted"],
}
for (const [id, [source, target]] of Object.entries(requiredStatePairs)) {
	const edge = `${source} --> ${target}`
	if (!diagram.includes(edge)) errors.push(`${id}: Mermaid edge is not ${edge}`)
}

if (!diagram.includes("stateDiagram-v2")) errors.push("Mermaid projection is not stateDiagram-v2")
if (errors.length > 0) {
	console.error(errors.join("\n"))
	process.exit(1)
}
console.log(`PASS lifecycle transition contract: ${ids.size} transitions, Mermaid synchronized`)
