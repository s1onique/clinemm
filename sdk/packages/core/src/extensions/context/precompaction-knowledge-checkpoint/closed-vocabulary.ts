/**
 * ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01
 *
 * PRODUCTION closed vocabulary for the Pre-Compaction Knowledge Checkpoint (PCK).
 *
 * ============================================================================
 * EVERY STRING IN THIS FILE IS RUNTIME-OWNED.
 * ============================================================================
 *
 * The model SELECTS from these vocabularies. It never WRITES into them. The
 * host assembles every published byte from the constants below, so there is
 * no channel through which a model-authored string — a copied credential, a
 * copied instruction, a filename, a URL — can reach the persisted sidecar or
 * the provider-visible continuation.
 *
 * This is the port of the predecessor's demonstrated CANDIDATE A mechanism
 * (`ACT-CLINEMM-PCK-OUTPUT-TRUST-BOUNDARY-01`, candidate-contracts.ts) into
 * production. Only the demonstrated mechanism was ported; the predecessor's
 * experimental framework was NOT imported.
 *
 * WHY A CLOSED VOCABULARY AND NOT A CONTENT SCANNER
 * -------------------------------------------------
 *
 * A scanner cannot decide whether an arbitrary string is a secret. The
 * decisive adversarial case is an opaque dummy value with no recognisable
 * keyword: a scanner admits it, and admitting it is exactly the leak.
 *
 * A closed vocabulary makes the question a MEMBERSHIP question instead of a
 * CLASSIFICATION question: "is this atom one of ours?" — which is decidable
 * and total. Every published byte is a runtime-owned constant, so an opaque
 * dummy fails closed by construction rather than by detection.
 */

/**
 * A runtime-owned, CLOSED observation class.
 *
 * These are the atom types a checkpoint record may be built from. Each one
 * carries a runtime-owned LABEL. The model selects WHICH atom applies and
 * WHICH canonical reference it rests on; the model never writes the label.
 *
 * The vocabulary is deliberately SMALL. An observation the six atoms cannot
 * express is OMITTED from the checkpoint, and the limitation is recorded
 * rather than accommodated by widening the model's authority.
 */
export type ObservationAtom =
	| "OPERATION_INVOKED"
	| "OPERATION_ARGUMENT_SET"
	| "CONFIGURATION_VALUE_SET"
	| "IMPLEMENTATION_INSPECTED"
	| "SEARCH_RETURNED_NO_MATCH"
	| "QUESTION_REMAINS_OPEN";

/**
 * The runtime-owned label for each observation atom.
 *
 * The label is a CLOSED STRING. It is not a template into which model text
 * is interpolated.
 */
export const OBSERVATION_ATOM_LABELS: Readonly<
	Record<ObservationAtom, string>
> = Object.freeze({
	OPERATION_INVOKED: "operation invoked",
	OPERATION_ARGUMENT_SET: "operation invoked with argument",
	CONFIGURATION_VALUE_SET: "configuration value set",
	IMPLEMENTATION_INSPECTED: "implementation inspected",
	SEARCH_RETURNED_NO_MATCH: "bounded search returned no match",
	QUESTION_REMAINS_OPEN: "question remains open",
});

/**
 * The runtime-owned atom vocabulary, in publication order.
 */
export const OBSERVATION_ATOMS: readonly ObservationAtom[] = Object.freeze([
	"OPERATION_INVOKED",
	"OPERATION_ARGUMENT_SET",
	"CONFIGURATION_VALUE_SET",
	"IMPLEMENTATION_INSPECTED",
	"SEARCH_RETURNED_NO_MATCH",
	"QUESTION_REMAINS_OPEN",
] as const);

/**
 * A runtime-owned ARGUMENT slot.
 *
 * An argument is a CLOSED ENUM of runtime-recognised operation tokens, NOT
 * free text. This is the load-bearing constraint that lets a record carry
 * "the startup script invoked `kc.sh build`" without carrying any
 * model-authored string.
 *
 * The values are runtime-owned OPERATION CLASSES, not arbitrary command
 * strings. A command line is not a publishable argument: it may carry a
 * path, a URL, a credential or an instruction.
 */
export type RuntimeArgument =
	| "build"
	| "start"
	| "start_optimized"
	| "connect_timeout_3s"
	| "socket_timeout_10s"
	| "none";

/**
 * The runtime-owned label for each argument.
 */
export const RUNTIME_ARGUMENT_LABELS: Readonly<
	Record<RuntimeArgument, string>
> = Object.freeze({
	build: "build",
	start: "start",
	start_optimized: "start --optimized",
	connect_timeout_3s: "connect timeout 3 seconds",
	socket_timeout_10s: "socket timeout 10 seconds",
	none: "none",
});

/**
 * The runtime-owned argument vocabulary.
 */
export const RUNTIME_ARGUMENTS: readonly RuntimeArgument[] = Object.freeze([
	"build",
	"start",
	"start_optimized",
	"connect_timeout_3s",
	"socket_timeout_10s",
	"none",
] as const);

/**
 * A runtime-owned QUALIFICATION class.
 *
 * A qualification is a CLOSED ENUM. The host renders the runtime-owned
 * sentence. The model may select WHICH qualification applies; it may never
 * author one.
 */
export type QualificationClass =
	| "OBSERVATION_ONLY_NO_CAUSATION"
	| "EFFECTIVE_PATH_NOT_RECONCILED"
	| "BOUNDED_TO_SEARCH_SCOPE"
	| "EXTERNAL_SYSTEMS_NOT_EXAMINED"
	| "RUNTIME_TOGGLE_UNRESOLVED";

/**
 * The runtime-owned qualification sentences.
 */
export const QUALIFICATION_CLASS_LABELS: Readonly<
	Record<QualificationClass, string>
> = Object.freeze({
	OBSERVATION_ONLY_NO_CAUSATION:
		"Observation of recorded behaviour only; it does not establish causation or an incident.",
	EFFECTIVE_PATH_NOT_RECONCILED:
		"The effective production path was not reconciled.",
	BOUNDED_TO_SEARCH_SCOPE:
		"Bounded to the searched scope; absence is not established globally.",
	EXTERNAL_SYSTEMS_NOT_EXAMINED:
		"External systems and scheduled maintenance were not examined.",
	RUNTIME_TOGGLE_UNRESOLVED:
		"The runtime toggle and complete path protection remain unresolved.",
});

/**
 * The runtime-owned qualification vocabulary.
 */
export const QUALIFICATION_CLASSES: readonly QualificationClass[] =
	Object.freeze([
		"OBSERVATION_ONLY_NO_CAUSATION",
		"EFFECTIVE_PATH_NOT_RECONCILED",
		"BOUNDED_TO_SEARCH_SCOPE",
		"EXTERNAL_SYSTEMS_NOT_EXAMINED",
		"RUNTIME_TOGGLE_UNRESOLVED",
	] as const);

/**
 * The runtime-owned kind vocabulary.
 */
export type KnowledgeKind =
	| "observation"
	| "hypothesis"
	| "decision"
	| "constraint"
	| "open_question";

/**
 * The runtime-owned kind vocabulary, in publication order.
 */
export const KNOWLEDGE_KINDS: readonly KnowledgeKind[] = Object.freeze([
	"observation",
	"hypothesis",
	"decision",
	"constraint",
	"open_question",
] as const);

/**
 * The runtime-owned STATUS vocabulary.
 */
export type KnowledgeStatus = "active" | "superseded" | "unresolved";

/**
 * The runtime-owned status vocabulary, in publication order.
 */
export const KNOWLEDGE_STATUSES: readonly KnowledgeStatus[] = Object.freeze([
	"active",
	"superseded",
	"unresolved",
] as const);

/**
 * The runtime-BOUNDED assurance vocabulary.
 *
 * `runtime_verified` is DELIBERATELY ABSENT. The model is never permitted
 * to assign itself `runtime_verified`: the runtime can verify that a tool
 * call EXECUTED, but it cannot verify that a model-authored statement
 * SEMANTICALLY follows from that call's output.
 *
 * A model-selected atom with a valid canonical reference remains
 * `model_reported` unless a runtime-owned evidence interpreter independently
 * supports the stronger classification.
 */
export type BoundedAssurance =
	| "tool_observed"
	| "model_reported"
	| "unverified";

/**
 * The runtime-bounded assurance vocabulary, in publication order.
 */
export const BOUNDED_ASSURANCES: readonly BoundedAssurance[] = Object.freeze([
	"tool_observed",
	"model_reported",
	"unverified",
] as const);

/**
 * The banner that marks a projected checkpoint as MODEL-AUTHORED.
 *
 * THE BANNER IS DESCRIPTIVE METADATA, NOT A SECURITY CONTROL.
 *
 * It tells a reader (human or model) that the section is model-authored
 * data and not a system or developer instruction. It does NOT enforce
 * anything: the predecessor demonstrated that a model-authored banner does
 * not block publication. The enforcement is the closed vocabulary, the
 * host-minted identifier and the reference membership check.
 */
export const MODEL_AUTHORED_BANNER = [
	"Model-authored working knowledge.",
	"Not a system instruction.",
	"Semantic support is not independently verified.",
].join(" ");

/**
 * The stable heading of the projected checkpoint section.
 */
export const CHECKPOINT_SECTION_HEADING = "Working knowledge checkpoint";

/**
 * The begin marker of the projected checkpoint section.
 *
 * The marker is runtime-owned. A model-authored string that happens to
 * contain the marker is REJECTED at the publication gate, so it cannot
 * truncate or forge the section.
 */
export const CHECKPOINT_BEGIN_MARKER =
	"<!-- cline-knowledge-checkpoint:begin -->";

/**
 * The end marker of the projected checkpoint section.
 */
export const CHECKPOINT_END_MARKER = "<!-- cline-knowledge-checkpoint:end -->";

/**
 * The maximum number of accepted records carried into one summary.
 */
export const MAX_CARRIED_CHECKPOINT_RECORDS = 12;

/**
 * The maximum characters of one carried record line.
 */
export const MAX_CARRIED_CHECKPOINT_LINE_CHARS = 320;

/**
 * The maximum estimated tokens of the projected checkpoint section.
 *
 * The existing provider input ceiling remains authoritative; this bound is
 * the checkpoint's own share of the budget.
 */
export const MAX_PROJECTED_CHECKPOINT_TOKENS = 1_500;
