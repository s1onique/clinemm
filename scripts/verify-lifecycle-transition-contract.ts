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
 *
 * ACT-CLINEMM-LIFECYCLE-EXECUTABLE-PRESENTATION-CONTRACT01: the SAME script
 * now ALSO validates the full Chart 04 document — the Mermaid block that is
 * EMBEDDED in `04-completion-presentation.md` — against the Chart 04 claim
 * taxonomy and the marker-stamping reconciliation. The existing strict
 * verifier covers the SEPARATE `c9-c10-traceability.mmd` file; this addition
 * closes the gap where the embedded Chart 04 diagram had no guard.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	CHART_04_NON_TRANSITION_CLAIM_IDS,
	CHART_04_TRANSITION_CLAIM_IDS,
	verifyChart04CompletionPresentation,
	verifyLifecycleTransitionContract,
} from "../apps/vscode/src/sdk/lifecycle-transition-contract-verifier";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = resolve(
	root,
	"docs/acts/ACT-CLINEMM-LIFECYCLE-TRACEABILITY-01/transition-contract.tsv",
);
const diagramPath = resolve(
	root,
	"docs/acts/ACT-CLINEMM-LIFECYCLE-TRACEABILITY-01/c9-c10-traceability.mmd",
);
const ledgerPath = resolve(
	root,
	"docs/architecture/task-lifecycle/transitions.tsv",
);
const chart04Path = resolve(
	root,
	"docs/architecture/task-lifecycle/04-completion-presentation.md",
);

const contractText = readFileSync(contractPath, "utf8");
const ledgerTransitionIds = new Set(
	readFileSync(ledgerPath, "utf8")
		.trim()
		.split("\n")
		.slice(1)
		.map((line) => line.split("\t")[0]),
);
const diagramText = readFileSync(diagramPath, "utf8");

const { errors, transitionIds } = verifyLifecycleTransitionContract({
	contractText,
	diagramText,
	ledgerTransitionIds,
});
if (errors.length > 0) {
	console.error(errors.join("\n"));
	process.exit(1);
}
console.log(
	`PASS lifecycle transition contract: ${transitionIds.length} transitions, Mermaid synchronized`,
);

// --- ACT-CLINEMM-LIFECYCLE-EXECUTABLE-PRESENTATION-CONTRACT01 -------------
// The embedded Chart 04 Mermaid block, checked against the claim taxonomy.
const chart04Markdown = readFileSync(chart04Path, "utf8");
const chart04 = verifyChart04CompletionPresentation({
	markdown: chart04Markdown,
	transitionClaimIds: CHART_04_TRANSITION_CLAIM_IDS,
	nonTransitionClaimIds: CHART_04_NON_TRANSITION_CLAIM_IDS,
});
if (chart04.errors.length > 0) {
	console.error(chart04.errors.join("\n"));
	process.exit(1);
}
console.log(
	`PASS Chart 04 completion-presentation projection: ${chart04.mermaidBlockCount} embedded block(s), ${CHART_04_TRANSITION_CLAIM_IDS.length} transition claims labeled, ${CHART_04_NON_TRANSITION_CLAIM_IDS.length} projection/invariant claims correctly edge-free`,
);
