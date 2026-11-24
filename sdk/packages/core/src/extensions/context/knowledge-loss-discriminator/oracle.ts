/**
 * ACT-CLINEMM-COMPACTION-INCREMENTAL-KNOWLEDGE-LOSS-DISCRIMINATOR-01
 *
 * C2 — the INDEPENDENT SEMANTIC KNOWLEDGE ORACLE.
 *
 * ============================================================================
 * WHAT THIS IS
 * ============================================================================
 *
 * A small, high-value inventory of the knowledge an investigation ACQUIRED
 * before the compaction boundary.
 *
 * ============================================================================
 * WHY IT IS NOT DERIVED FROM THE PCK VOCABULARY
 * ============================================================================
 *
 * The predecessor ACT's oracle inventoried the PCK's own six observation
 * atoms. This oracle is built from the SOURCE EVIDENCE of the investigation:
 * each item names the command whose OUTPUT establishes it, and each item's
 * proposition is a SEMANTIC claim about the investigation's subject, not a
 * runtime classification.
 *
 * ============================================================================
 * WHY IT IS NOT DERIVED FROM ANY CANDIDATE'S SUMMARY
 * ============================================================================
 *
 * The oracle was frozen from the source prefix BEFORE any summary was
 * generated, regenerated or inspected for scoring purposes. The historical
 * summary was inspected for the S1 inventory (arm H) only AFTER the oracle
 * was frozen, and its digest is recorded in the evidence.
 *
 * ============================================================================
 * WHY INITIAL OBLIGATIONS ARE NOT COUNTED
 * ============================================================================
 *
 * `alreadyPresentInInitialTask` distinguishes an item the initial task
 * already stated from an item the investigation established. Only the latter
 * count towards "acquired knowledge".
 */

export type KnowledgeCategory =
	| "INITIAL_CONSTRAINT"
	| "INITIAL_HYPOTHESIS"
	| "ACQUIRED_OBSERVATION"
	| "FALSIFIED_HYPOTHESIS"
	| "CONDITIONAL_CONCLUSION"
	| "CONTRADICTORY_EVIDENCE"
	| "SUPERSEDED_EVIDENCE"
	| "REVISED_CONFIDENCE"
	| "ESTABLISHED_DECISION"
	| "UNRESOLVED_QUESTION"
	| "REMAINING_OBLIGATION";

export type SourceAuthority =
	| "tool_observed"
	| "runtime_verified"
	| "model_reported"
	| "unverified";

export type Relevance = "critical" | "important" | "optional";

export interface KnowledgeOracleItem {
	readonly id: string;
	readonly category: KnowledgeCategory;
	/**
	 * The SEMANTIC proposition. Written so that it can be checked against a
	 * context by an independent adjudicator WITHOUT the oracle being in the
	 * context itself.
	 */
	readonly proposition: string;
	/**
	 * The SOURCE-PREFIX message indexes whose tool output establishes the
	 * proposition. These are indexes into the CANONICAL message array, all
	 * STRICTLY BELOW the compaction boundary.
	 */
	readonly evidenceReferences: readonly number[];
	/**
	 * The MATERIAL QUALIFICATIONS. A context that carries the proposition
	 * WITHOUT one of these is PARTIALLY_PRESERVED, not PRESERVED.
	 */
	readonly requiredQualifications: readonly string[];
	readonly sourceAuthority: SourceAuthority;
	readonly relevance: Relevance;
	/**
	 * `true` when the INITIAL TASK already stated the proposition. Such an
	 * item is NOT acquired knowledge.
	 */
	readonly alreadyPresentInInitialTask: boolean;
	/**
	 * The DISCRIMINATOR probe for this item, used at S3. It must NOT contain
	 * the proposition's answer.
	 */
	readonly probe: string;
	/**
	 * The ADJUDICATION rubric: what a CORRECT answer must assert. Used to
	 * score an S3 answer, not to prompt it.
	 */
	readonly correctAnswerCriteria: readonly string[];
}

/**
 * The W1 oracle.
 *
 * Every item is anchored to a source-prefix message index that the ACT's own
 * acquisition verified to be inside the 244-message boundary
 * (`source_prefix_hash` = `sha256:00720111f28d…`).
 *
 * The subject matter is deliberately abstracted: the propositions talk about
 * "the rendered production manifest", "the Java test-file inventory", "the
 * carrier sender timeout configuration" and so on, so that the oracle can be
 * committed without reproducing private repository content.
 */
export const W1_KNOWLEDGE_ORACLE: readonly KnowledgeOracleItem[] = [
	{
		id: "O1",
		category: "ACQUIRED_OBSERVATION",
		proposition:
			"Rendering the production Helm manifest from the values files alone FAILS with a Go-template type error (a non-string environment value reaching a template that requires a string). Rendering the SAME chart with an explicit environment override succeeds.",
		evidenceReferences: [145, 147],
		requiredQualifications: [
			"the failure is a template TYPE error about the environment value, not a missing chart dependency",
			"the successful render required an explicit environment override that the plain render did not supply",
		],
		sourceAuthority: "tool_observed",
		relevance: "critical",
		alreadyPresentInInitialTask: false,
		probe:
			"Before compaction, two attempts were made to render the production Helm manifest for this repository. Describe what each attempt produced, including the exit status of the first one and the additional input the second one needed.",
		correctAnswerCriteria: [
			"states that the first render failed with a template type error (non-string environment value)",
			"states that the first render's exit status was non-zero",
			"states that the second render succeeded only after an explicit environment override was supplied",
		],
	},
	{
		id: "O2",
		category: "ACQUIRED_OBSERVATION",
		proposition:
			"The production manifest that DOES render uses the STOCK upstream container image with the upstream default tag, not the organisation's own image and not a digest-pinned reference.",
		evidenceReferences: [23, 113, 147, 149],
		requiredQualifications: [
			"the rendered image is the upstream vendor registry image at its default application version",
			"the organisation's own image is supplied only through the CI pipeline's explicit override flags",
		],
		sourceAuthority: "tool_observed",
		relevance: "critical",
		alreadyPresentInInitialTask: false,
		probe:
			"Using only the evidence that was gathered before compaction, does the production deployment demonstrably run the organisation's own container image? Answer yes, no, or not established, and say exactly what the rendered manifest showed.",
		correctAnswerCriteria: [
			"does NOT answer 'yes' on the basis of the development configuration alone",
			"states that the rendered production manifest showed the stock upstream image",
			"distinguishes the development/pipeline override from the rendered production manifest",
		],
	},
	{
		id: "O3",
		category: "CONDITIONAL_CONCLUSION",
		proposition:
			"The risk that a manual upgrade reverts to the stock image depends on the CI override being OMITTED; the pipeline itself pins the image by digest and refuses to deploy without the digest artifact.",
		evidenceReferences: [11, 111],
		requiredQualifications: [
			"the pipeline's own deploy job is guarded against a missing digest artifact",
			"the manual-upgrade path is a DIFFERENT path from the CI deploy path and is not guarded by that check",
		],
		sourceAuthority: "tool_observed",
		relevance: "important",
		alreadyPresentInInitialTask: false,
		probe:
			"What was established about the difference between the automated deployment path and a manual upgrade with respect to the image reference? State the guard that exists on one path and what it does not cover.",
		correctAnswerCriteria: [
			"states that the automated path is digest-pinned and guarded by a fatal check for a missing digest artifact",
			"states that the manual path is not covered by that guard",
		],
	},
	{
		id: "O4",
		category: "ACQUIRED_OBSERVATION",
		proposition:
			"The Java test-file inventory has MORE THAN ONE VALID COUNT because the counting definition differs: a broad pattern that matches any tracked Java path containing the word 'test' yields a larger number than the pattern that matches only files whose basename ends in the conventional test-suffix, and a third pattern that matches any tracked file with the test suffix in its name yields yet another number.",
		evidenceReferences: [7, 65, 67],
		requiredQualifications: [
			"the counts belong to DIFFERENT counting definitions and are not contradictory",
			"the conventional-suffix count is the smallest of the observed counts",
		],
		sourceAuthority: "tool_observed",
		relevance: "critical",
		alreadyPresentInInitialTask: false,
		probe:
			"Before compaction, several counts of the Java test-file inventory were taken. State which observed count belongs to the counting definition that matches only files whose name ends with the conventional test suffix, and explain why the other observed numbers are not in conflict with it.",
		correctAnswerCriteria: [
			"gives the conventional-suffix count as the smallest of the observed counts",
			"does NOT present more than one number as 'the' authoritative count",
			"attributes the difference to the counting definition rather than to a contradiction in the evidence",
		],
	},
	{
		id: "O5",
		category: "ACQUIRED_OBSERVATION",
		proposition:
			"The container build invocations in the Dockerfiles all pass the skip-tests flag, and no separate test-execution step was identified in the continuous-integration pipeline.",
		evidenceReferences: [67],
		requiredQualifications: [
			"the skip flag is present on the build invocations",
			"the absence of an identified test-execution step is an absence of evidence, not a proof that tests never run",
		],
		sourceAuthority: "tool_observed",
		relevance: "important",
		alreadyPresentInInitialTask: false,
		probe:
			"What was established about whether the Java tests are executed in the build and deployment pipeline? Separate what was observed from what was not established.",
		correctAnswerCriteria: [
			"states that the build invocations pass the skip-tests flag",
			"does not claim that tests are definitely never executed",
		],
	},
	{
		id: "O6",
		category: "FALSIFIED_HYPOTHESIS",
		proposition:
			"The hypothesis that the OTP sender implementations lack a circuit breaker is FALSIFIED for the notification-service sender: that sender contains a minimal consecutive-failure circuit breaker living in a singleton factory, so its state survives per-request provider instances.",
		evidenceReferences: [181, 183],
		requiredQualifications: [
			"the breaker belongs to the notification-service sender, not to every sender",
			"a separate admission-control breaker was also found in the b-call path",
			"the breaker is a consecutive-failure breaker, and its thresholds were not established as the ones in force for the active production carrier",
		],
		sourceAuthority: "tool_observed",
		relevance: "critical",
		alreadyPresentInInitialTask: false,
		probe:
			"One of the inherited production risks asserted that the OTP sender implementations have no circuit breaker. What did the investigation establish about that assertion? Answer for the notification-service sender specifically, and say what was NOT established.",
		correctAnswerCriteria: [
			"states that the notification-service sender DOES contain a circuit breaker",
			"states that the breaker is a consecutive-failure breaker held in a singleton",
			"does not generalise the breaker to every sender",
			"does not claim the assertion is falsified for the production carrier sender without qualification",
		],
	},
	{
		id: "O7",
		category: "ACQUIRED_OBSERVATION",
		proposition:
			"The active production SMS sender is a different carrier sender from the one whose default timeout constants were read; the notification-service sender's default connect and socket timeouts are 500 ms and 1000 ms respectively, and those constants are overridable by environment variables.",
		evidenceReferences: [187, 189],
		requiredQualifications: [
			"the read constants belong to the notification-service provider, not to the carrier sender",
			"the production default service selection names the carrier sender for the default environment",
			"the constants are defaults and are environment-overridable, so they are not proven to be the effective production values",
		],
		sourceAuthority: "tool_observed",
		relevance: "critical",
		alreadyPresentInInitialTask: false,
		probe:
			"What timeout configuration was actually read, whose defaults were they, and which sender is selected as the production default? State explicitly whether the read defaults are proven to be the effective production timeouts.",
		correctAnswerCriteria: [
			"gives the two default constants of the notification-service provider",
			"states that the production default service is the carrier sender, a different provider",
			"states that the read constants are defaults and are not proven to be the effective production values",
		],
	},
	{
		id: "O8",
		category: "CONTRADICTORY_EVIDENCE",
		proposition:
			"The production database connection budget is NOT violated at the current scale: the per-pod pool maximum is 80 and the replica count is 3, giving 240 of the documented 400 budget, and the values file carries a comment instructing that the pool be recomputed whenever the replica count changes.",
		evidenceReferences: [137],
		requiredQualifications: [
			"the multiplication uses the CURRENT replica count, not the historical peak",
			"the historical peak of 11 replicas belonged to a non-production environment",
			"the inherited risk's 11-replica figure is not the current production configuration",
		],
		sourceAuthority: "tool_observed",
		relevance: "critical",
		alreadyPresentInInitialTask: false,
		probe:
			"Does the inherited database connection capacity risk reproduce against the current production configuration? Give the per-pod pool maximum, the replica count used, the resulting product, and the documented budget, and say which environment the historical peak figure came from.",
		correctAnswerCriteria: [
			"gives the per-pod pool maximum, the replica count and the product",
			"states that the product is within the documented budget",
			"states that the inherited 11-replica figure belongs to a non-production environment",
			"concludes that the risk does not reproduce as stated",
		],
	},
	{
		id: "O9",
		category: "ACQUIRED_OBSERVATION",
		proposition:
			"The Helm templates carry only the hook-WEIGHT annotation and no hook annotation itself, so the annotated resources are ordinary chart resources that are ordered, not hook resources that are executed by the hook machinery.",
		evidenceReferences: [27, 31, 139],
		requiredQualifications: [
			"the distinction is between the weight annotation and the hook annotation",
			"the rendered output was inspected, so the absence is observed for the rendered manifest",
		],
		sourceAuthority: "tool_observed",
		relevance: "important",
		alreadyPresentInInitialTask: false,
		probe:
			"What was established about the Helm hook semantics of the external-secrets resources? Distinguish the annotation that was found from the annotation that was not found.",
		correctAnswerCriteria: [
			"states that the weight annotation was found",
			"states that the hook annotation itself was not found",
			"does not claim that the resources are hook resources",
		],
	},
	{
		id: "O10",
		category: "ACQUIRED_OBSERVATION",
		proposition:
			"Administrator bootstrap credentials are committed in plaintext in BOTH environment values files under the same key and the same value.",
		evidenceReferences: [215, 217],
		requiredQualifications: [
			"the exposure is a committed-in-plaintext exposure, in both environment values files",
			"the presence of the value in the repository does not establish that the credential is still valid at the live system",
			"no credential-testing was performed, because the task prohibited it",
		],
		sourceAuthority: "tool_observed",
		relevance: "critical",
		alreadyPresentInInitialTask: false,
		probe:
			"What was established about the administrator bootstrap credential? Separate the committed exposure from the question of whether the credential still works, and say whether it was tested.",
		correctAnswerCriteria: [
			"states that the credential is committed in plaintext in both environment values files",
			"states that the present validity of the credential was NOT established",
			"states that the credential was not tested",
		],
	},
	{
		id: "O11",
		category: "UNRESOLVED_QUESTION",
		proposition:
			"Whether the production deployment actually runs the organisation's own image was NOT resolved: the pipeline override, the development overlay pin and the rendered production manifest disagree, and no live-cluster inspection was performed.",
		evidenceReferences: [23, 111, 113, 147, 149],
		requiredQualifications: [
			"the question was left open because live deployment state was not observed",
			"the investigation had no authority to access the live cluster or the production database",
		],
		sourceAuthority: "tool_observed",
		relevance: "critical",
		alreadyPresentInInitialTask: false,
		probe:
			"Is the question of which image production actually runs resolved by the evidence that was gathered before compaction? Answer and name what is still missing.",
		correctAnswerCriteria: [
			"answers that the question is NOT resolved",
			"names the missing evidence as the live deployment state",
		],
	},
	{
		id: "O12",
		category: "REMAINING_OBLIGATION",
		proposition:
			"At the compaction boundary the investigation still owed a verdict matrix over the ten inherited findings, with a file path and line citation for the supporting and the counter-evidence of each finding, and a severity adjustment where the evidence required it.",
		evidenceReferences: [0, 82, 90],
		requiredQualifications: [
			"the verdict set is the fixed set of five verdict labels",
			"each verdict requires a citation of both supporting and counter-evidence",
		],
		sourceAuthority: "tool_observed",
		relevance: "important",
		alreadyPresentInInitialTask: false,
		probe:
			"What work was still outstanding for the investigation at the point compaction happened? Name the artifact, its shape and its per-item requirements.",
		correctAnswerCriteria: [
			"names a verdict matrix over the ten inherited findings",
			"states that each verdict needs citations to the supporting and the counter-evidence",
			"mentions the fixed set of five verdict labels",
		],
	},
];
