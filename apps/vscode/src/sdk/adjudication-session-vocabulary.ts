/**
 * ACT-CLINEMM-ADJUDICATION-VSCODE-ACTIVATION-01-CORRECTION01
 *
 * The HOST-OWNED, PERSISTED record of a session's authorized adjudication
 * vocabulary.
 *
 * WHY A PERSISTED RECORD IS NEEDED
 * --------------------------------
 *
 * `AdjudicationTaskContractStore` is IN-MEMORY by design: an armed
 * authorization is a host-authority fact, not a durable setting. That is
 * correct for the ARMED intent — it must never survive a restart into a task
 * the user did not authorize.
 *
 * It is NOT correct for the BOUND contract. Once an armed contract has been
 * CONSUMED at the authoritative session-id allocation point, it is no longer
 * an intent: it is a fact about a SPECIFIC session. A recreated extension
 * host must be able to restore that fact, otherwise:
 *
 *   Host A: arm vocabulary S1 -> bind to session A -> persist secret ->
 *           accept adjudication
 *   Host B (after restart): fresh store, no armed/bound vocabulary ->
 *           buildSessionConfig(session A) -> adjudication = undefined ->
 *           the continuity feature is silently disabled for the very
 *           session that was authorized
 *
 * That is exactly the gap the correction closes: the restored host must
 * enable continuity for the ORIGINAL session WITHOUT re-arming it.
 *
 * WHERE THE RECORD LIVES
 * ----------------------
 *
 * The record lives in the SAME trusted, host-owned secret store that already
 * holds the per-session evidence secret: the file-backed `secrets.json`
 * (mode 0o600) behind `StateManager`. It is NOT stored in:
 *
 *   - workspace settings,
 *   - a repository file,
 *   - a task prompt,
 *   - a provider request,
 *   - a debug log,
 *   - the committed evidence package.
 *
 * The vocabulary itself is NOT a secret — it is an authorized, task-scoped
 * identifier set — but it IS an authorization, so it is kept in the same
 * protected store rather than in a world-readable settings surface.
 *
 * SESSION SCOPING
 * ---------------
 *
 * The record is a JSON object keyed by session id, so:
 *
 *   - a different session never sees another session's vocabulary;
 *   - a restored session re-derives the SAME vocabulary it was authorized
 *     with, so the accepted adjudications stay meaningful;
 *   - there is no cross-session lookup.
 *
 * FAIL-CLOSED
 * -----------
 *
 * A malformed or missing record yields `undefined`: the session simply has no
 * adjudication contract, which is the DEFAULT state for every ordinary task.
 */

import { StateManager } from "@/core/storage/StateManager"
import type { AdjudicationTaskContract } from "./adjudication-task-contract"

/**
 * The trusted secret-store key that holds the persisted per-session
 * authorized vocabularies.
 */
const VOCABULARY_STORAGE_KEY = "adjudicationSessionVocabularies" as const

/**
 * The persisted shape: a JSON object keyed by session id.
 */
type SessionVocabularyBlob = Record<string, AdjudicationTaskContract["vocabulary"]>

/**
 * Whether a persisted value is a well-formed vocabulary.
 *
 * The shape check is DELIBERATE: a corrupt store must not silently widen
 * the contract. An unrecognized record is treated as absent.
 */
function isVocabulary(value: unknown): value is AdjudicationTaskContract["vocabulary"] {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return false
	}
	const candidate = value as Record<string, unknown>
	if (!Array.isArray(candidate.findingIds)) {
		return false
	}
	if (!Array.isArray(candidate.decisions)) {
		return false
	}
	if (!Array.isArray(candidate.qualificationCodes)) {
		return false
	}
	if (!candidate.remainingQuestions || typeof candidate.remainingQuestions !== "object") {
		return false
	}
	return true
}

/**
 * Read the persisted blob. A malformed blob is treated as EMPTY.
 */
function readBlob(): SessionVocabularyBlob {
	try {
		const raw = StateManager.get().getSecretKey(VOCABULARY_STORAGE_KEY)
		if (!raw) {
			return {}
		}
		const parsed = JSON.parse(raw) as unknown
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return {}
		}
		const blob: SessionVocabularyBlob = {}
		for (const [sessionId, value] of Object.entries(parsed as Record<string, unknown>)) {
			if (isVocabulary(value)) {
				blob[sessionId] = value
			}
		}
		return blob
	} catch {
		return {}
	}
}

/**
 * Persist the blob.
 */
function writeBlob(blob: SessionVocabularyBlob): void {
	try {
		StateManager.get().setSecret(VOCABULARY_STORAGE_KEY, JSON.stringify(blob))
	} catch {
		// The store is unavailable. The in-memory contract still works for
		// this session; the restoration simply will not be restorable, which
		// the runtime reports rather than claims away.
	}
}

/**
 * The authorized vocabulary persisted for `sessionId`, if any.
 *
 * PURE: it never writes, and it never falls back to another session.
 */
export function readPersistedSessionVocabulary(
	sessionId: string | undefined,
): AdjudicationTaskContract["vocabulary"] | undefined {
	const id = sessionId?.trim()
	if (!id) {
		return undefined
	}
	return readBlob()[id]
}

/**
 * Persist the authorized vocabulary for `sessionId`.
 *
 * Called EXACTLY ONCE per session, at the authoritative session-id
 * allocation point — the same point at which the armed contract is
 * consumed. Persisting earlier would write an authorization for a session
 * that does not exist yet; persisting later would leave a window in which
 * a restart loses the authorization.
 *
 * Persisting the SAME session id twice REPLACES the record: a re-bound
 * session's vocabulary is authoritative, and the store never holds two
 * records for one session.
 */
export function persistSessionVocabulary(sessionId: string, vocabulary: AdjudicationTaskContract["vocabulary"]): void {
	const id = sessionId?.trim()
	if (!id) {
		return
	}
	const blob = readBlob()
	blob[id] = vocabulary
	writeBlob(blob)
}

/**
 * Clear the persisted vocabulary for `sessionId`.
 *
 * Used when the task-clear choke-point retires a task: the authorization is
 * retired with the task, so a later host restart cannot resurrect it.
 */
export function clearPersistedSessionVocabulary(sessionId: string): void {
	const id = sessionId?.trim()
	if (!id) {
		return
	}
	const blob = readBlob()
	if (!(id in blob)) {
		return
	}
	delete blob[id]
	writeBlob(blob)
}
