/**
 * ACT-CLINEMM-LIFECYCLE-TRACEABILITY-01
 *
 * Small deterministic validator for the bounded C9/C10 transition contract
 * and its Mermaid projection. It intentionally uses only Node/Bun built-ins.
 *
 * ACT-CLINEMM-LIFECYCLE-TRACEABILITY-01-CORRECTION01: the validation logic
 * lives in `apps/vscode/src/sdk/lifecycle-transition-contract-verifier.ts` as
 * PURE, importable functions so the mutation tests can exercise the real
 * contract-to-diagram association check without triggering `process.exit`.
 */
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { verifyLifecycleTransitionContract } from "../apps/vscode/src/sdk/lifecycle-transition-contract-verifier"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const contractPath = resolve(root, "docs/acts/ACT-CLINEMM-LIFECYCLE-TRACEABILITY-01/transition-contract.tsv")
const diagramPath = resolve(root, "docs/acts/ACT-CLINEMM-LIFECYCLE-TRACEABILITY-01/c9-c10-traceability.mmd")
const ledgerPath = resolve(root, "docs/architecture/task-lifecycle/transitions.tsv")

const contractText = readFileSync(contractPath, "utf8")
const ledgerTransitionIds = new Set(
	readFileSync(ledgerPath, "utf8")
		.trim()
		.split("\n")
		.slice(1)
		.map((line) => line.split("\t")[0]),
)
const diagramText = readFileSync(diagramPath, "utf8")

const { errors, transitionIds } = verifyLifecycleTransitionContract({
	contractText,
	diagramText,
	ledgerTransitionIds,
})
if (errors.length > 0) {
	console.error(errors.join("\n"))
	process.exit(1)
}
console.log(`PASS lifecycle transition contract: ${transitionIds.length} transitions, Mermaid synchronized`)
