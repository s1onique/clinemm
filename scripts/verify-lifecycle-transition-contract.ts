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
	CHART_01_TRANSITION_CLAIM_IDS,
	CHART_01_NON_TRANSITION_CLAIM_IDS,
	CHART_01_VERIFIED_EDGES,
	CHART_02_TRANSITION_CLAIM_IDS,
	CHART_02_NON_TRANSITION_CLAIM_IDS,
	CHART_02_VERIFIED_EDGES,
	CHART_04_EXPECTED_EDGES,
	CHART_04_NON_TRANSITION_CLAIM_IDS,
	CHART_04_TRANSITION_CLAIM_IDS,
	verifyChart01TurnPhase,
	verifyChart02CompletionAuthority,
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
	// ACT-CLINEMM-LIFECYCLE-EXECUTABLE-PRESENTATION-CONTRACT01-CORR01:
	// the claim id must label the CORRECT edge, not merely SOME edge.
	expectedEdges: CHART_04_EXPECTED_EDGES,
});
if (chart04.errors.length > 0) {
	console.error(chart04.errors.join("\n"));
	process.exit(1);
}
console.log(
	`PASS Chart 04 completion-presentation projection: ${chart04.mermaidBlockCount} embedded block(s), ${CHART_04_TRANSITION_CLAIM_IDS.length} transition claims labeled, ${CHART_04_NON_TRANSITION_CLAIM_IDS.length} projection/invariant claims correctly edge-free`,
);

// --- ACT-CLINEMM-LIFECYCLE-EXECUTABLE-TURN-PHASE-CONTRACT01 ---------------
// The embedded Chart 01 Mermaid block, checked against the Chart 01 claim
// taxonomy AND the verified claim-id -> edge ASSOCIATION.
//
// This REUSES the existing strict association checker (the same core the
// c9-c10 diagram and Chart 04 use) — it is NOT a second, independent,
// cardinality-only checker.
const chart01Path = resolve(root, "docs/architecture/task-lifecycle/01-task-turn-phase.md");
const chart01Markdown = readFileSync(chart01Path, "utf8");
const chart01 = verifyChart01TurnPhase({
	markdown: chart01Markdown,
	transitionClaimIds: CHART_01_TRANSITION_CLAIM_IDS,
	nonTransitionClaimIds: CHART_01_NON_TRANSITION_CLAIM_IDS,
	expectedEdges: CHART_01_VERIFIED_EDGES,
});
if (chart01.errors.length > 0) {
	console.error(chart01.errors.join("\n"));
	process.exit(1);
}
console.log(
	`PASS Chart 01 turn-phase projection: ${chart01.mermaidBlockCount} embedded block(s), ${CHART_01_TRANSITION_CLAIM_IDS.length} transition claims labeled, ${CHART_01_NON_TRANSITION_CLAIM_IDS.length} guard/projection claims correctly edge-free, 8 canonical phase states present`,
);

// --- ACT-CLINEMM-LIFECYCLE-EXECUTABLE-COMPLETION-AUTHORITY-CONTRACT01 -----
// The embedded Chart 02 Mermaid block, checked against the Chart 02 claim
// taxonomy AND the verified claim-id -> edge ASSOCIATION.
//
// Chart 02's eight claims are a MIX of transition / guard / decision /
// safety-veto / invariant / input-rule kinds. The BCB is modelled as a
// PREDICATE over INDEPENDENT obligations (not an ordered chain), and the
// final containment revalidation is VISIBLE between the Elm authorization
// and the C10 effect.
const chart02Path = resolve(root, "docs/architecture/task-lifecycle/02-c9-bcb-elm-c10-authority.md");
const chart02Markdown = readFileSync(chart02Path, "utf8");
const chart02 = verifyChart02CompletionAuthority({
	markdown: chart02Markdown,
	transitionClaimIds: CHART_02_TRANSITION_CLAIM_IDS,
	nonTransitionClaimIds: CHART_02_NON_TRANSITION_CLAIM_IDS,
	expectedEdges: CHART_02_VERIFIED_EDGES,
});
if (chart02.errors.length > 0) {
	console.error(chart02.errors.join("\n"));
	process.exit(1);
}
console.log(
	`PASS Chart 02 completion-authority projection: ${chart02.mermaidBlockCount} embedded block(s), ${CHART_02_TRANSITION_CLAIM_IDS.length} transition claims labeled, ${CHART_02_NON_TRANSITION_CLAIM_IDS.length} guard/decision/veto/invariant/input-rule claims correctly edge-free, BCB modelled as a predicate over independent obligations, containment revalidation visible`,
);
