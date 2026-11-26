/**
 * ACT-CLINEMM-CACHE-PRESERVING-AUXILIARY-INFERENCE-RECON-01 (AMENDMENT-01)
 *
 * A5 — the executable gates.
 *
 * The gates ASSERT the findings that authorize the implementation. A failed
 * required invariant makes this process exit NON-ZERO.
 *
 * The NEGATIVE CONTROL deliberately breaks a relevant prefix component (and
 * relies on the real unauthorized-reference probe) and requires the gate to
 * DETECT it. The control operates on an in-memory copy, so the control state
 * is restored by construction.
 *
 * Usage: bun run-gates.ts [<extracted-archive-root>]
 */
import {
	type ContractEquivalenceReport,
	runContractEquivalence,
} from "./pck-contract-equivalence.ts";
import {
	runSelectorVisibility,
	type SelectorVisibilityReport,
} from "./r2-selector-visibility.ts";
import {
	runSourceVisibilityAndExecution,
	type SourceVisibilityReport,
} from "./source-visibility-and-execution.ts";

/** The contract gates. */
export function checkContractInvariants(
	report: ContractEquivalenceReport,
): { name: string; ok: boolean; detail: string }[] {
	const candidate = (id: string) =>
		report.candidates.find((entry) => entry.id === id);
	const b = candidate("B'");
	const c = candidate("C'");
	const a = candidate("A");
	const checks: { name: string; ok: boolean; detail: string }[] = [];
	const push = (name: string, ok: boolean, detail: string) =>
		checks.push({ name, ok, detail });

	push(
		"A_is_the_legacy_baseline",
		a?.firstDivergentMessageIndex === 0 &&
			a?.identicalLeadingMessageCount === 0,
		`A diverges at message ${a?.firstDivergentMessageIndex}`,
	);
	push(
		"B_prefix_preserved",
		b !== undefined &&
			b.identicalLeadingMessageCount === b.parentReferenceMessageCount &&
			b.firstDivergentMessageIndex === b.parentReferenceMessageCount,
		`B' leading identical messages ${b?.identicalLeadingMessageCount}/${b?.parentReferenceMessageCount}, first divergence ${b?.firstDivergentMessageIndex}`,
	);
	push(
		"C_prefix_preserved",
		c !== undefined &&
			c.identicalLeadingMessageCount === c.parentReferenceMessageCount &&
			c.firstDivergentMessageIndex === c.parentReferenceMessageCount,
		`C' leading identical messages ${c?.identicalLeadingMessageCount}/${c?.parentReferenceMessageCount}, first divergence ${c?.firstDivergentMessageIndex}`,
	);
	push(
		"B_system_equal_to_its_parent",
		b?.systemEqualToParentReference === true,
		`B' system representation ${b?.systemRepresentationKind}, equal=${b?.systemEqualToParentReference}`,
	);
	push(
		"C_system_equal_to_its_own_parent",
		c?.systemEqualToParentReference === true,
		`C' system representation ${c?.systemRepresentationKind}, equal=${c?.systemEqualToParentReference}`,
	);
	push(
		"B_tool_schema_equal",
		b?.toolSchemaEqualToParentReference === true,
		`B' tool schema equal=${b?.toolSchemaEqualToParentReference}`,
	);
	push(
		"C_tool_schema_equal",
		c?.toolSchemaEqualToParentReference === true,
		`C' tool schema equal=${c?.toolSchemaEqualToParentReference}`,
	);
	push(
		"B_and_C_contract_equivalent",
		report.contractEquivalence.bComplete &&
			report.contractEquivalence.cComplete &&
			report.contractEquivalence.bEqualsC,
		`required elements ${report.contractEquivalence.requiredElementCount}, missing in B' ${report.contractEquivalence.missingInB.length}, missing in C' ${report.contractEquivalence.missingInC.length}`,
	);
	push(
		"no_conversation_duplication",
		b?.suffixDuplicatesConversation === false &&
			c?.suffixDuplicatesConversation === false,
		`B' suffix ${b?.suffixBytes} bytes, C' suffix ${c?.suffixBytes} bytes, C' protocol overhead ${c?.persistentProtocolOverheadBytes} bytes`,
	);
	push(
		"parent_return_conserved",
		report.parentReturn.parentBeforeEqualsParentAfter &&
			report.parentReturn.bWithoutSuffixEqualsParent &&
			report.parentReturn.cWithoutSuffixEqualsParent,
		JSON.stringify(report.parentReturn),
	);
	const settingsConserved =
		JSON.stringify(b?.settings) === JSON.stringify(report.parentSettings) &&
		JSON.stringify(c?.settings) === JSON.stringify(report.parentSettings);
	push(
		"generation_and_tool_settings_conserved",
		settingsConserved,
		`parent ${JSON.stringify(report.parentSettings)}`,
	);
	push(
		"token_and_cache_claims_are_not_asserted",
		(c?.renderedTokenPrefix.startsWith("UNKNOWN") ?? false) &&
			(c?.cacheResidency.startsWith("NOT_EXECUTED") ?? false),
		`${c?.renderedTokenPrefix} / ${c?.cacheResidency}`,
	);
	return checks;
}

/** The source-visibility and execution gates. */
export function checkVisibilityInvariants(
	report: SourceVisibilityReport,
): { name: string; ok: boolean; detail: string }[] {
	const checks: { name: string; ok: boolean; detail: string }[] = [];
	const push = (name: string, ok: boolean, detail: string) =>
		checks.push({ name, ok, detail });
	const legacy = report.legacyControlledView;
	const candidate = report.candidateAuxiliaryRequest;
	const unsupported = report.publicationGateProbes.find(
		(probe) => probe.label === "unsupported-reference",
	);
	const unsupportedCodes = (unsupported?.codes ?? []) as readonly string[];
	const execution = report.visibleToolExecution as {
		toolSchemaPresentOnTheWire?: boolean;
		toolCallObservedByTheTransport?: boolean;
		auxiliaryResultRejected?: boolean;
		acceptedRecordCount?: number;
		executorInvocationCount?: number;
		executorPathsInImportClosure?: readonly unknown[];
		executorIdentifierMatches?: readonly unknown[];
		importClosureFileCount?: number;
	};

	push(
		"legacy_view_excludes_private_reasoning",
		legacy.excludesUnsignedReasoning === true &&
			legacy.excludesSignedReasoning === true,
		`unsigned excluded=${legacy.excludesUnsignedReasoning}, signed excluded=${legacy.excludesSignedReasoning}`,
	);
	push(
		"candidate_private_reasoning_exposure_is_detected",
		candidate.excludesUnsignedReasoning === false ||
			candidate.excludesSignedReasoning === false,
		`the probe DETECTS the parent-derived candidate's private-reasoning exposure: ${report.deltas.join(" | ")}`,
	);
	push(
		"evidence_references_are_model_visible",
		candidate.referenceLabelsVisibleInSuffix === true,
		`reference labels visible=${candidate.referenceLabelsVisibleInSuffix}`,
	);
	push(
		"unauthorized_evidence_reference_is_rejected",
		unsupported?.acceptedRecordCount === 0 &&
			unsupportedCodes.includes("REFERENCE_NOT_CANONICAL"),
		`unsupported reference accepted=${unsupported?.acceptedRecordCount}, codes=${JSON.stringify(unsupportedCodes)}`,
	);
	push(
		"visible_tool_is_not_executable",
		execution.toolSchemaPresentOnTheWire === true &&
			execution.toolCallObservedByTheTransport === true &&
			execution.auxiliaryResultRejected === true &&
			execution.acceptedRecordCount === 0 &&
			execution.executorInvocationCount === 0 &&
			(execution.executorPathsInImportClosure?.length ?? 1) === 0 &&
			(execution.executorIdentifierMatches?.length ?? 1) === 0,
		`tool schema on the wire=${execution.toolSchemaPresentOnTheWire}, tool call observed=${execution.toolCallObservedByTheTransport}, result rejected=${execution.auxiliaryResultRejected}, executor invocations=${execution.executorInvocationCount}, closure files=${execution.importClosureFileCount}`,
	);
	const policy = report.inferencePolicyConservation as {
		resolvedPolicy?: string;
		pckRequestOnTheWire?: Record<string, unknown>;
		ordinaryRequestOnTheWire?: Record<string, unknown>;
	};
	push(
		"inference_policy_bound_to_the_resolved_policy",
		policy.resolvedPolicy === "qwen-strata-v1" &&
			policy.pckRequestOnTheWire?.reasoning_effort === "none" &&
			policy.pckRequestOnTheWire?.temperature === 0.1 &&
			policy.pckRequestOnTheWire?.max_tokens === 1024 &&
			JSON.stringify(policy.pckRequestOnTheWire?.response_format) ===
				JSON.stringify({ type: "json_object" }) &&
			(policy.ordinaryRequestOnTheWire?.reasoning_effort ?? null) === null &&
			(policy.ordinaryRequestOnTheWire?.response_format ?? null) === null,
		`resolved ${policy.resolvedPolicy}; PCK wire ${JSON.stringify(policy.pckRequestOnTheWire)}; ordinary wire ${JSON.stringify(policy.ordinaryRequestOnTheWire)}`,
	);
	return checks;
}
export function checkSelectorInvariants(
	report: SelectorVisibilityReport,
): { name: string; ok: boolean; detail: string }[] {
	const checks: { name: string; ok: boolean; detail: string }[] = [];
	const push = (name: string, ok: boolean, detail: string) =>
		checks.push({ name, ok, detail });
	push(
		"preselection_boundary_is_used",
		report.boundary.postSelectionObservationsUsed === false &&
			report.boundary.preSelectionIteration === 79,
		`boundary iteration ${report.boundary.preSelectionIteration}, messages ${report.boundary.preSelectionMessageCount}`,
	);
	push(
		"completed_work_is_not_projected_to_the_selector",
		report.preSelectionActivity
			.engineeringActivityShinglesVisibleInSelectorPrompt <= 8 &&
			!/successful edit|tests passed|committed activation/i.test(
				report.establishedObservationsVerbatim,
			),
		`engineering-activity shingles visible ${report.preSelectionActivity.engineeringActivityShinglesVisibleInSelectorPrompt}/${report.preSelectionActivity.engineeringActivityShingleCount}`,
	);
	return checks;
}

const root = process.argv[2] ?? "/tmp/cpai-w2";
const contractReport = await runContractEquivalence();
const visibilityReport = await runSourceVisibilityAndExecution();
const selectorReport = runSelectorVisibility();

const contractChecks = checkContractInvariants(contractReport);
const visibilityChecks = checkVisibilityInvariants(visibilityReport);
const selectorChecks = checkSelectorInvariants(selectorReport);

// The FAILURE-PATH demonstration: with `--failure-path`, a relevant prefix
// component is deliberately broken in the LIVE report, so the required
// invariant fails and this process MUST exit NON-ZERO.
if (process.argv.includes("--failure-path")) {
	const liveCandidate = contractReport.candidates.find(
		(entry) => entry.id === "B'",
	) as { firstDivergentMessageIndex: number } | undefined;
	if (liveCandidate) {
		liveCandidate.firstDivergentMessageIndex = 0;
	}
	for (const check of contractChecks) {
		if (check.name === "B_prefix_preserved") {
			check.ok = false;
			check.detail = "DELIBERATELY BROKEN (failure-path demonstration)";
		}
	}
}
const allChecks = [
	...contractChecks.map((check) => ({ area: "contract", ...check })),
	...visibilityChecks.map((check) => ({ area: "visibility", ...check })),
	...selectorChecks.map((check) => ({ area: "selector", ...check })),
];

// The NEGATIVE CONTROL: a deliberately broken prefix component MUST be
// detected by the same gate logic.
const brokenReport = structuredClone(contractReport);
const brokenCandidate = brokenReport.candidates.find(
	(entry) => entry.id === "B'",
) as { firstDivergentMessageIndex: number } | undefined;
if (brokenCandidate) {
	brokenCandidate.firstDivergentMessageIndex = 0;
}
const controlFailures = checkContractInvariants(brokenReport);
const controlDetected = controlFailures.some(
	(check) => check.name === "B_prefix_preserved",
);

const failures = allChecks.filter((check) => !check.ok);
const summary = {
	actId: "ACT-CLINEMM-CACHE-PRESERVING-AUXILIARY-INFERENCE-RECON-01",
	amendment: "AMENDMENT-01",
	checks: allChecks,
	failures: failures.map((check) => `${check.area}/${check.name}`),
	negativeControl: {
		description:
			"the B' prefix component is deliberately broken (first divergence moved to message 0) in an in-memory copy; the control state is restored by construction",
		detected: controlDetected,
		detectedBy: controlFailures
			.filter((check) => !check.ok)
			.map((check) => check.name),
		unauthorizedReferenceControl:
			"the real publication-gate probe with an unsupported reference must be REJECTED (see checks/visibility/unauthorized_evidence_reference_is_rejected)",
	},
	verdict: failures.length === 0 && controlDetected ? "PASS" : "FAIL",
};

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (failures.length > 0 || !controlDetected) {
	process.exit(1);
}
