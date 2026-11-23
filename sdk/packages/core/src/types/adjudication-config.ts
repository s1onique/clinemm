/**
 * ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01
 *
 * The HOST-SUPPLIED adjudication contract.
 *
 * WHY THE CONTRACT IS A CONFIG INPUT
 * ----------------------------------
 *
 * The adjudication vocabulary (finding ids, decisions, qualification codes,
 * remaining-question ids) is TASK-SCOPED. `S1` and `manual_enforcement_only`
 * are meaningful only inside the task that defined them, so they cannot be a
 * global ClineMM vocabulary.
 *
 * The host therefore SUPPLIES the vocabulary. Without a supplied
 * vocabulary:
 *
 *   - no adjudication candidate is ever accepted, and
 *   - the ordinary agent path is completely unchanged.
 *
 * This is a CONFIG FIELD, not a new public tool, provider protocol or
 * persistence subsystem. It carries no behavior of its own: it names the
 * closed vocabulary the runtime is allowed to accept.
 */

import type {
	AdjudicationVocabulary,
	SourceRevisionResolver,
} from "../extensions/context/adjudication-continuity";

/**
 * The adjudication contract a host may supply for a task.
 */
export interface CoreAdjudicationConfig {
	/**
	 * Whether the adjudication contract is ACTIVE for this session.
	 *
	 * Defaults to `false`. It is an explicit opt-in because the contract
	 * changes what the model is asked to publish.
	 */
	enabled?: boolean;
	/**
	 * The TASK-SCOPED vocabulary the runtime is allowed to accept.
	 *
	 * Without it, no candidate is accepted: the runtime has no authorized
	 * vocabulary and therefore cannot tell an authorized finding id from an
	 * invented one.
	 */
	vocabulary?: AdjudicationVocabulary;
	/**
	 * The runtime's source-revision resolver.
	 *
	 * Without it, no candidate can be accepted either: the runtime cannot
	 * independently bind a source revision, and a model-authored revision
	 * claim is never read.
	 *
	 * ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION01:
	 * the resolver is an ACQUISITION-TIME instrument. It is called ONCE,
	 * when a tool result is observed, and the answer is STORED against the
	 * tool-result identity. It is NOT called during candidate evaluation.
	 */
	revisionResolver?: SourceRevisionResolver;
	/**
	 * ACT-CLINEMM-ADJUDICATION-OUTPUT-CONTRACT-IMPLEMENT-01-CORRECTION01.
	 *
	 * The host-supplied, RE-DERIVABLE per-session evidence-handle secret.
	 *
	 * The host owns the session's lifetime, so it is the only party that
	 * can reproduce the same secret for the same session id. Supplying it
	 * makes the opaque evidence handles survive a session recreation: a
	 * restored session re-derives the same handles, so an adjudication
	 * published before the restart still resolves afterwards.
	 *
	 * When it is absent, the runtime generates an in-memory secret, the
	 * handles are valid only for the lifetime of the process, and a
	 * restored session cannot resolve a previously published handle. That
	 * is the FAIL-CLOSED direction, and the runtime reports it as such
	 * rather than claiming a restoration it cannot perform.
	 */
	secretProvider?: (sessionId: string) => string | Promise<string>;
}
