/**
 * ACT-CLINEMM-ADJUDICATION-VSCODE-ACTIVATION-01
 *
 * The HOST-OWNED, TASK-SCOPED adjudication contract store.
 *
 * WHY A STORE AND NOT A SETTINGS FIELD
 * ------------------------------------
 *
 * The adjudication vocabulary (finding ids, decisions, qualification codes,
 * remaining-question ids) is TASK-SCOPED by construction: `S1` and
 * `manual_enforcement_only` are meaningful only inside the task that
 * defined them. Persisting them in the global `Settings` surface would make
 * them a GLOBAL vocabulary — which the SDK contract explicitly forbids and
 * which the ACT's G2.2 forbids ("Do not create a permanent Keycloak/Round C
 * vocabulary").
 *
 * The existing precedent for exactly this shape in this codebase is
 * `SessionAutoApprovalStore` (`apps/vscode/src/sdk/session-auto-approval.ts`):
 * a host-owned, in-memory, ONE-SHOT armed intent that binds to the NEXT
 * session id and is consumed exactly once at the authoritative allocation
 * point. This store follows the same discipline:
 *
 *   - the contract is ARMED by an explicit, user-authorized act;
 *   - it binds to exactly ONE session id (the next task's);
 *   - it is consumed EXACTLY ONCE, so an unrelated task can never inherit it;
 *   - it is NOT persisted, so it cannot leak across a restart into a task
 *     the user did not authorize.
 *
 * WHAT THIS STORE IS NOT
 * ----------------------
 *
 * It is NOT derived from:
 *
 *   - a model's interpretation of the task,
 *   - an arbitrary workspace file,
 *   - repository content,
 *   - tool output,
 *   - a prompt containing the string `R1`,
 *   - the presence of compaction,
 *   - provider or model identity.
 *
 * The ONLY way to arm it is an explicit call to `arm()`. A repository
 * controlled file therefore CANNOT silently authorize a privileged host
 * capability.
 *
 * THE AUTHORITY IS THE CALLER
 * ---------------------------
 *
 * This store is deliberately transport-agnostic: it does not own a proto
 * message, a UI, or a settings field. The host's task-authority seam decides
 * HOW a user authorizes a contract and calls `arm()`. That keeps the ACT's
 * production delta at the "real VS Code host-configuration boundary and its
 * directly necessary trusted adapters" and out of the public protocol.
 */

// ACT-CLINEMM-ADJUDICATION-VSCODE-ACTIVATION-01-CORRECTION01: the trusted,
// host-owned persisted record of a session's authorized vocabulary. The
// BOUND contract is a fact about a specific session, so it must survive an
// extension-host restart; the ARMED intent deliberately must not.
import {
	clearPersistedSessionVocabulary,
	persistSessionVocabulary,
	readPersistedSessionVocabulary,
} from "./adjudication-session-vocabulary"

/**
 * The task-scoped adjudication contract a host may supply for a task.
 *
 * It mirrors the SDK's `CoreAdjudicationConfig` in shape, but carries ONLY
 * the parts that are USER-AUTHORIZABLE. The trusted instruments — the
 * revision resolver and the secret provider — are HOST-SUPPLIED at the
 * producer seam and are never authorable by anyone (least privilege).
 */
export interface AdjudicationTaskContract {
	/**
	 * The authorized, task-scoped vocabulary.
	 *
	 * Without it no candidate is accepted: the runtime cannot tell an
	 * authorized finding id from an invented one.
	 */
	readonly vocabulary: {
		readonly findingIds: readonly string[]
		readonly decisions: readonly string[]
		readonly qualificationCodes: readonly string[]
		readonly remainingQuestions: Readonly<Record<string, string>>
		readonly allowedDecisionsByFinding?: Readonly<Record<string, readonly string[]>>
		readonly requiredQualificationsByFinding?: Readonly<Record<string, readonly string[]>>
	}
}

/**
 * The host-owned store of task-scoped adjudication contracts.
 *
 * The store holds AT MOST ONE armed contract (the next task's) and AT MOST
 * ONE bound contract (the current task's). Both are in-memory only.
 */
export class AdjudicationTaskContractStore {
	/**
	 * The ONE-SHOT armed contract, waiting for the next task's session id.
	 *
	 * `undefined` means "no task has been authorized to carry an
	 * adjudication contract", which is the DEFAULT and the only state an
	 * ordinary task ever observes.
	 */
	private armed: AdjudicationTaskContract | undefined

	/**
	 * The contract bound to the CURRENT session.
	 *
	 * `undefined` for every session that was not explicitly authorized.
	 */
	private bound: { sessionId: string; contract: AdjudicationTaskContract } | undefined

	/**
	 * Arm the contract for the NEXT task.
	 *
	 * The armed contract is consumed exactly once, by
	 * `consumeForSession()`, at the authoritative session-id allocation
	 * point. Arming twice REPLACES the previous armed contract: an
	 * authorization for a later task must not be silently dropped by an
	 * earlier one, and the store never holds two armed contracts.
	 */
	arm(contract: AdjudicationTaskContract): void {
		this.armed = contract
	}

	/**
	 * Whether a contract is currently armed for the next task.
	 */
	hasArmed(): boolean {
		return this.armed !== undefined
	}

	/**
	 * PEEK the armed contract WITHOUT consuming it.
	 *
	 * The producer seam uses this to decide whether the config it is about
	 * to build carries the adjudication block. The CONSUMPTION is a
	 * separate, later step at the authoritative session-id allocation
	 * point, so the contract binds to exactly one session id.
	 */
	peekArmed(): AdjudicationTaskContract | undefined {
		return this.armed
	}

	/**
	 * Consume the armed contract and bind it to `sessionId`.
	 *
	 * Called EXACTLY ONCE per session, at the authoritative session-id
	 * allocation point. Returns `undefined` when no contract was armed, so
	 * the ordinary path is unchanged.
	 *
	 * Calling it twice for the same session id is a no-op: the second call
	 * returns the ALREADY-BOUND contract rather than consuming a second
	 * armed contract, so a retry cannot consume the NEXT task's arm.
	 */
	consumeForSession(sessionId: string): AdjudicationTaskContract | undefined {
		if (this.bound?.sessionId === sessionId) {
			return this.bound.contract
		}
		if (this.armed === undefined) {
			return undefined
		}
		const contract = this.armed
		this.armed = undefined
		this.bound = { sessionId, contract }
		// ACT-CLINEMM-ADJUDICATION-VSCODE-ACTIVATION-01-CORRECTION01:
		// PERSIST the bound vocabulary for this session id.
		//
		// The armed intent is deliberately NOT persisted — it must never
		// survive a restart into a task the user did not authorize. But once
		// the intent has been CONSUMED and bound to a SPECIFIC session id,
		// it is no longer an intent: it is a fact about that session. The
		// fact must survive an extension-host restart, or the restored
		// host would silently disable the continuity feature for the very
		// session the user authorized.
		//
		// The write happens HERE — the authoritative session-id allocation
		// point — so no window exists in which a restart loses it.
		persistSessionVocabulary(sessionId, contract.vocabulary)
		return contract
	}

	/**
	 * The contract bound to `sessionId`, if any.
	 *
	 * PURE: it never consumes the armed contract. The producer seam uses
	 * this to decide whether a session that is being REBUILT (model change,
	 * provider change) keeps its adjudication contract.
	 */
	getBound(sessionId: string | undefined): AdjudicationTaskContract | undefined {
		if (!sessionId) {
			return undefined
		}
		return this.bound?.sessionId === sessionId ? this.bound.contract : undefined
	}

	/**
	 * The contract OWNED BY `sessionId` — and ONLY by `sessionId`.
	 *
	 * ACT-CLINEMM-ADJUDICATION-VSCODE-ACTIVATION-01-CORRECTION01 (P0-1 —
	 * `HALT_SESSION_AUTHORITY_LIFECYCLE`): this is the SINGLE authority the
	 * producer seam consults for an EXISTING session.
	 *
	 * It resolves, in order:
	 *
	 *   1. the IN-MEMORY bound contract for this exact session id;
	 *   2. the PERSISTED vocabulary for this exact session id, which is how
	 *      a recreated extension host restores the authorization.
	 *
	 * It NEVER consults the ARMED slot. The armed slot is PENDING INTENT for
	 * the NEXT task, and a pending intent must never attach to an existing
	 * session: an unrelated resume or rebuild that happened to run while an
	 * arm was pending would otherwise inherit a vocabulary the user never
	 * authorized for that session.
	 *
	 * It NEVER consults another session's record. There is no cross-session
	 * lookup of any kind.
	 */
	getBoundOrPersisted(sessionId: string | undefined): AdjudicationTaskContract | undefined {
		const id = sessionId?.trim()
		if (!id) {
			return undefined
		}
		const bound = this.getBound(id)
		if (bound) {
			return bound
		}
		const persisted = readPersistedSessionVocabulary(id)
		if (!persisted) {
			return undefined
		}
		return { vocabulary: persisted }
	}

	/**
	 * Clear the BOUND contract. Does NOT touch the armed contract.
	 *
	 * Called at the task-clear choke-point: cancelling the current task must
	 * not erase an authorization the user prepared for the NEXT task.
	 *
	 * ACT-CLINEMM-ADJUDICATION-VSCODE-ACTIVATION-01-CORRECTION01: it also
	 * retires the PERSISTED record of the retired session's vocabulary, so
	 * a later extension-host restart cannot resurrect an authorization for a
	 * task the user has already abandoned. The ARMED contract is untouched —
	 * the user may still have prepared it for the next task.
	 */
	clearBound(): void {
		const retiredSessionId = this.bound?.sessionId
		this.bound = undefined
		if (retiredSessionId) {
			clearPersistedSessionVocabulary(retiredSessionId)
		}
	}

	/**
	 * Clear the ARMED contract. Does NOT touch the bound contract.
	 */
	clearArmed(): void {
		this.armed = undefined
	}
}

/**
 * The process-wide store.
 *
 * A single store is the correct cardinality: the extension host owns one
 * task at a time, so "the contract authorized for the next task" is a
 * process-level fact, exactly like `SessionAutoApprovalStore`'s armed
 * override.
 */
let singleton: AdjudicationTaskContractStore | undefined

export function getAdjudicationTaskContractStore(): AdjudicationTaskContractStore {
	if (!singleton) {
		singleton = new AdjudicationTaskContractStore()
	}
	return singleton
}

/**
 * Reset the process-wide store. Test-only seam.
 */
export function resetAdjudicationTaskContractStore(): void {
	singleton = undefined
}
