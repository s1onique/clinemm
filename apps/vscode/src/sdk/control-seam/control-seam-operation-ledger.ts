/**
 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01
 *
 * The bounded, INSTANCE-LOCAL operation ledger for
 * `clinemm_start_act` idempotency.
 *
 * WHY A LEDGER
 *
 * The client supplies a `requestId`. Within ONE extension-host
 * instance:
 *
 *   - Same key + same payload -> the SAME recorded outcome.
 *   - Same key + different payload -> REJECTED (the key is bound to
 *     its payload; a conflicting replay is a client bug or an attack).
 *   - Repeated delivery after acceptance -> NEVER starts another task.
 *
 * The ledger records an IN-FLIGHT entry as soon as the operation
 * starts, so a duplicate delivery that arrives WHILE the first start
 * is still running joins the first operation instead of starting a
 * second one.
 *
 * SCOPE — EXPLICITLY NOT DURABLE
 *
 * The ledger is IN MEMORY. It lives in the extension-host process. After
 * a host restart it is empty, and this ACT does NOT pretend otherwise:
 * the ledger's contract is "within one extension-host instance". An
 * ambiguous outcome MUST be reconciled through the existing session
 * state before retrying; there is NO automatic retry that could create
 * a duplicate execution.
 *
 * BOUNDS
 *
 * The ledger holds at most `maxEntries` records. When it is full, the
 * OLDEST entry is evicted. Eviction can only ever cause a MISSED
 * duplicate-suppression, never a wrong outcome: an evicted key is
 * treated as a fresh key.
 *
 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-CORR01: an IN-FLIGHT (`pending`)
 * entry is NEVER evicted. The V1 implementation evicted the oldest
 * entry unconditionally, so a start that was still running could be
 * dropped from the ledger while its lifecycle call was in flight. A
 * later duplicate of that request id was then treated as ABSENT and
 * could start a SECOND task. The correction makes the bound apply to
 * COMPLETED entries only: a pending entry always survives, so the
 * duplicate-suppression contract holds for the whole in-flight window.
 * The bound is therefore a bound on COMPLETED entries; the number of
 * simultaneously pending entries is bounded by the server's own
 * single-slot in-flight reservation (at most one).
 */

/**
 * The recorded outcome of a `clinemm_start_act` operation.
 *
 * `pending` is the in-flight state: the operation has started but has
 * not yet produced a terminal outcome.
 */
export type ControlSeamLedgerOutcome =
	| { readonly status: "pending" }
	/**
	 * The `sessionId` is the accepted session identity. It is present for
	 * `clinemm_start_act` (whose `accepted` outcome REQUIRES it — the
	 * server must never report an acceptance without an authoritative
	 * session identity) and absent for the supervision operations, whose
	 * accepted outcome is scoped to the session the client already owns.
	 */
	| { readonly status: "accepted"; readonly sessionId?: string; readonly taskId?: string }
	| { readonly status: "rejected"; readonly reason: string }
	| { readonly status: "superseded"; readonly reason: string }
	| { readonly status: "unknown_outcome"; readonly reason: string }
	/**
	 * ACT-CLINEMM-MCP-SUPERVISION-V2-01: the feedback operation's QUEUED
	 * outcome. It carries the queue's OWN prompt id, so the client can
	 * correlate the item's eventual consumption by the intended run.
	 */
	| { readonly status: "queued"; readonly queuedPromptId: string }
	/**
	 * ACT-CLINEMM-MCP-SUPERVISION-V2-01: the cancellation operation's
	 * ALREADY-TERMINAL outcome. The cancellation was a no-op and did NOT
	 * overwrite the committed terminal completion.
	 */
	| { readonly status: "already_terminal" }

/**
 * One ledger record.
 *
 * The `payloadFingerprint` binds the key to its payload. It is a
 * SHA-256 over a canonical encoding of the payload — the ledger never
 * stores the prompt itself, so a ledger dump cannot leak task content.
 */
export interface ControlSeamLedgerEntry {
	readonly payloadFingerprint: string
	outcome: ControlSeamLedgerOutcome
}

/**
 * The result of looking a key up in the ledger.
 */
export type ControlSeamLedgerLookup =
	| { readonly kind: "absent" }
	| { readonly kind: "conflict"; readonly reason: string }
	| { readonly kind: "found"; readonly outcome: ControlSeamLedgerOutcome }

/**
 * A bounded, instance-local operation ledger.
 */
export class ControlSeamOperationLedger {
	private readonly entries = new Map<string, ControlSeamLedgerEntry>()
	private readonly maxEntries: number

	constructor(options: { readonly maxEntries?: number } = {}) {
		const requested = options.maxEntries ?? CONTROL_SEAM_LEDGER_DEFAULT_MAX_ENTRIES
		this.maxEntries = Math.max(1, Math.floor(requested))
	}

	/**
	 * Look a key up.
	 *
	 * `conflict` is returned when the key exists with a DIFFERENT
	 * payload fingerprint — the caller MUST reject the request.
	 */
	lookup(requestId: string, payloadFingerprint: string): ControlSeamLedgerLookup {
		const existing = this.entries.get(requestId)
		if (!existing) {
			return { kind: "absent" }
		}
		if (existing.payloadFingerprint !== payloadFingerprint) {
			return { kind: "conflict", reason: "request-id-conflict" }
		}
		return { kind: "found", outcome: existing.outcome }
	}

	/**
	 * Record an IN-FLIGHT entry for a key.
	 *
	 * Callers MUST have observed `lookup(...) === absent` (or the
	 * equivalent conflict check) first. Recording an in-flight entry is
	 * what makes a duplicate delivery that arrives DURING the start
	 * join the first operation instead of starting a second one.
	 */
	begin(requestId: string, payloadFingerprint: string): void {
		this.evictIfNeeded()
		this.entries.set(requestId, { payloadFingerprint, outcome: { status: "pending" } })
	}

	/**
	 * Record a terminal outcome for a key.
	 *
	 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-CORR01: the payload
	 * fingerprint is supplied so that a re-inserted entry stays BOUND to
	 * its payload. The V1 implementation re-inserted with an EMPTY
	 * fingerprint, so the next lookup of that key reported `conflict`
	 * instead of the recorded outcome - a duplicate of a completed
	 * request could then be told "request-id-conflict" rather than being
	 * answered with the SAME recorded outcome.
	 *
	 * With the CORR01 eviction rule an IN-FLIGHT entry is never evicted,
	 * so this re-insert path is only reachable for a key that was never
	 * begun.
	 */
	complete(requestId: string, outcome: ControlSeamLedgerOutcome, payloadFingerprint = ""): void {
		const existing = this.entries.get(requestId)
		if (!existing) {
			// The key was evicted while the operation ran. Re-insert it
			// so the terminal outcome is still observable.
			this.evictIfNeeded()
			this.entries.set(requestId, { payloadFingerprint, outcome })
			return
		}
		existing.outcome = outcome
	}

	/**
	 * Forget a key. Used when the operation is abandoned before any
	 * lifecycle call (so a retry is not permanently blocked by an
	 * in-flight marker).
	 */
	forget(requestId: string): void {
		this.entries.delete(requestId)
	}

	/** The number of retained entries. */
	get size(): number {
		return this.entries.size
	}

	/** Drop every entry. Called on controller disposal. */
	clear(): void {
		this.entries.clear()
	}

	/**
	 * Evict the OLDEST COMPLETED entry when the ledger is at capacity.
	 *
	 * `Map` preserves insertion order, so the first key is the oldest.
	 *
	 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-CORR01: an IN-FLIGHT
	 * (`pending`) entry is NEVER evicted. The V1 implementation evicted
	 * the oldest entry unconditionally, so a start that was still running
	 * could be dropped from the ledger while its lifecycle call was in
	 * flight. A later duplicate of that request id was then treated as
	 * ABSENT and could start a SECOND task, violating the
	 * duplicate-suppression contract for the whole in-flight window.
	 *
	 * THE BOUND. The bound applies to the COMPLETED entries: those are
	 * evicted oldest-first until the ledger is back within its bound.
	 * The PENDING entries are retained regardless - the in-flight
	 * guarantee outranks the bound. Because the server's single-slot
	 * in-flight reservation admits at most ONE pending entry at a time,
	 * the ledger is bounded by `maxEntries + 1` in the worst case.
	 */
	private evictIfNeeded(): void {
		while (this.completedEntryCount() >= this.maxEntries) {
			if (!this.evictOldestCompleted()) {
				// Every retained entry is IN FLIGHT. Nothing can be
				// evicted without breaking the in-flight guarantee.
				return
			}
		}
	}

	/** The number of COMPLETED (non-pending) entries. */
	private completedEntryCount(): number {
		let count = 0
		for (const entry of this.entries.values()) {
			if (entry.outcome.status !== "pending") {
				count++
			}
		}
		return count
	}

	/**
	 * Evict the oldest COMPLETED entry.
	 *
	 * Returns `true` when an entry was evicted, `false` when every
	 * retained entry is IN FLIGHT.
	 */
	private evictOldestCompleted(): boolean {
		for (const [key, entry] of this.entries) {
			if (entry.outcome.status !== "pending") {
				this.entries.delete(key)
				return true
			}
		}
		return false
	}
}

/**
 * The default maximum number of retained ledger entries.
 */
export const CONTROL_SEAM_LEDGER_DEFAULT_MAX_ENTRIES = 64
