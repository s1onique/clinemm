/**
 * ACT-CLINEMM-COMPACTION-INCREMENTAL-KNOWLEDGE-LOSS-DISCRIMINATOR-01
 *
 * C3 — the SEMANTIC ASSERTION TESTS.
 *
 * ============================================================================
 * WHY THE MATCH IS SEMANTIC AND NOT KEYWORD-BASED
 * ============================================================================
 *
 * Each oracle item has a set of independently-true SEMANTIC ASSERTIONS. An
 * item is recoverable from a context only when its assertions are satisfied
 * by that context's text. A single keyword match never scores an item as
 * preserved: the MATERIAL QUALIFICATIONS are separate assertions, so an item
 * whose proposition survives without its qualifications scores as
 * `PARTIALLY_PRESERVED`.
 *
 * The patterns match the SEMANTIC content of a proposition in several
 * equivalent surface forms, because a context may express the same fact
 * with different words. They are NEVER placed into a model prompt: the
 * matcher only ever runs over an INSPECTED CONTEXT.
 */

export interface OracleAssertionTest {
	readonly id: string;
	/**
	 * `true` when the assertion is a MATERIAL QUALIFICATION: its absence
	 * downgrades the score from `PRESERVED` to `PARTIALLY_PRESERVED`.
	 */
	readonly isMaterialQualification: boolean;
	readonly pattern: RegExp;
}

export const ORACLE_ASSERTIONS: Readonly<
	Record<string, readonly OracleAssertionTest[]>
> = {
	O1: [
		{
			id: "render-failed",
			isMaterialQualification: false,
			pattern:
				/render[^\n]{0,80}fail|helm template[^\n]{0,60}error|template[^\n]{0,40}error|error calling tpl|exit=1|exit code 1|go-template type|wrong type for value/i,
		},
		{
			id: "type-error-not-missing-dependency",
			isMaterialQualification: true,
			pattern: /wrong type for value|type error|expected string|got interface/i,
		},
		{
			id: "second-render-needed-override",
			isMaterialQualification: true,
			pattern:
				/global\.env=prod|--set global\.env|explicit[^\n]{0,40}override|environment override/i,
		},
	],
	O2: [
		{
			id: "stock-image-rendered",
			isMaterialQualification: false,
			pattern:
				/quay\.io\/keycloak\/keycloak|stock image|upstream[^\n]{0,30}image|vanilla[^\n]{0,20}image/i,
		},
		{
			id: "not-custom-image",
			isMaterialQualification: true,
			pattern:
				/not[^\n]{0,40}(custom|own|organisation|organization)[^\n]{0,20}image|stock|upstream/i,
		},
		{
			id: "distinguishes-dev-override",
			isMaterialQualification: true,
			pattern:
				/--set[^\n]{0,60}image|ci[^\n]{0,30}(override|--set)|development[^\n]{0,30}(overlay|config)|development[\s_-]*overlay/i,
		},
	],
	O3: [
		{
			id: "digest-pinned-ci",
			isMaterialQualification: false,
			pattern:
				/digest[^\n]{0,40}pin|pinned[^\n]{0,20}digest|image-digest|image\.digest/i,
		},
		{
			id: "guard-on-ci-only",
			isMaterialQualification: true,
			pattern:
				/manual[^\n]{0,60}(upgrade|path|not|does)|manual[^\n]{0,30}helm/i,
		},
	],
	O4: [
		{
			id: "multiple-counts",
			isMaterialQualification: false,
			pattern:
				/\b(73|47)\b[^\n]{0,40}\b(73|47)\b|counting definition|different[^\n]{0,30}count/i,
		},
		{
			id: "smallest-count-is-conventional-suffix",
			isMaterialQualification: true,
			pattern:
				/\b47\b[^\n]{0,60}(\*Test|conventional|suffix)|(\*Test|conventional|suffix)[^\n]{0,60}\b47\b/i,
		},
	],
	O5: [
		{
			id: "skip-tests-flag",
			isMaterialQualification: false,
			pattern: /skipTests|skip[- ]tests/i,
		},
		{
			id: "absence-not-proof",
			isMaterialQualification: true,
			pattern:
				/not[^\n]{0,50}establish|no[^\n]{0,40}(test|evidence)[^\n]{0,30}(found|identified)|was not identified|absence of evidence/i,
		},
	],
	O6: [
		{
			id: "breaker-found",
			isMaterialQualification: false,
			pattern: /circuit\s*breaker/i,
		},
		{
			id: "notification-service-scoped",
			isMaterialQualification: true,
			pattern:
				/notification[- ]service[^\n]{0,80}circuit|circuit[^\n]{0,80}notification[- ]service|notification[- ]service sender/i,
		},
		{
			id: "not-generalised",
			isMaterialQualification: true,
			pattern:
				/not[^\n]{0,40}(all|every|each)[^\n]{0,20}sender|other sender|different provider|carrier sender/i,
		},
	],
	O7: [
		{
			id: "timeouts-read",
			isMaterialQualification: false,
			pattern:
				/\b(500|1000)\b[^\n]{0,40}\b(ms|milliseconds)?|connect[^\n]{0,30}timeout[^\n]{0,30}\b(500|1000)\b|socket[^\n]{0,30}timeout[^\n]{0,30}\b(500|1000)\b/i,
		},
		{
			id: "belongs-to-notification-service",
			isMaterialQualification: true,
			pattern:
				/notification[- ]service[^\n]{0,80}(500|1000|timeout)|(500|1000)[^\n]{0,80}notification[- ]service/i,
		},
		{
			id: "defaults-not-effective",
			isMaterialQualification: true,
			pattern:
				/default[^\n]{0,50}(not proven|overridable|environment)|not proven[^\n]{0,40}effective|effective[^\n]{0,30}not established|overridable/i,
		},
	],
	O8: [
		{
			id: "pool-and-replicas",
			isMaterialQualification: false,
			pattern: /\b80\b[^\n]{0,30}\b3\b|\b240\b|\b400\b/,
		},
		{
			id: "within-budget",
			isMaterialQualification: true,
			pattern:
				/within[^\n]{0,30}budget|not violated|does not reproduce|240[^\n]{0,30}400|400[^\n]{0,30}240/i,
		},
		{
			id: "peak-was-non-production",
			isMaterialQualification: true,
			pattern:
				/11[^\n]{0,50}(dev|pp|non-production|not production)|peak[^\n]{0,60}(dev|pp|non-production)/i,
		},
	],
	O9: [
		{
			id: "hook-weight-found",
			isMaterialQualification: false,
			pattern: /helm\.sh\/hook-weight|hook-weight/i,
		},
		{
			id: "hook-annotation-absent",
			isMaterialQualification: true,
			pattern:
				/no[^\n]{0,40}helm\.sh\/hook\b|lacks?[^\n]{0,30}hook annotation|without[^\n]{0,30}hook annotation|only[^\n]{0,40}hook-weight/i,
		},
	],
	O10: [
		{
			id: "bootstrap-credential-found",
			isMaterialQualification: false,
			pattern:
				/bootstrap[^\n]{0,60}(password|credential|admin)|admin[^\n]{0,40}(password|credential)[^\n]{0,40}plaintext|plaintext[^\n]{0,40}(bootstrap|admin)/i,
		},
		{
			id: "both-values-files",
			isMaterialQualification: true,
			pattern:
				/both[^\n]{0,40}(environment|values|env)[^\n]{0,20}files|two[^\n]{0,30}values files|both[^\n]{0,20}environments/i,
		},
		{
			id: "not-tested",
			isMaterialQualification: true,
			pattern:
				/not[^\n]{0,40}(tested|verified live)|prohibit[^\n]{0,30}credential|no credential[^\n]{0,30}test|not tested/i,
		},
	],
	O11: [
		{
			id: "unresolved",
			isMaterialQualification: false,
			pattern:
				/not[^\n]{0,30}(resolved|established|determined)|unresolved|still missing|live[^\n]{0,30}(not|never)[^\n]{0,20}(inspected|accessed)/i,
		},
		{
			id: "missing-live-state",
			isMaterialQualification: true,
			pattern:
				/live[^\n]{0,30}(cluster|deployment|state)|actual live|running image/i,
		},
	],
	O12: [
		{
			id: "verdict-matrix",
			isMaterialQualification: false,
			pattern:
				/verdict[^\n]{0,20}matrix|matrix[^\n]{0,30}(R1|verdict)|R1[^\n]{0,20}R10|ten[^\n]{0,20}findings/i,
		},
		{
			id: "citations-required",
			isMaterialQualification: true,
			pattern:
				/citation|cite[^\n]{0,30}(path|line)|line[^\n]{0,20}number|supporting[^\n]{0,30}counter|counter-?evidence/i,
		},
	],
};
