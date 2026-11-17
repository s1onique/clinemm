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
 */

/**
 * The recorded outcome of a `clinemm_start_act` operation.
 *
 * `pending` is the in-flight state: the operation has started but has
 * not yet produced a terminal outcome.
 */
export type ControlSeamLedgerOutcome =
	| { readonly status: "pending" }
	| { readonly status: "accepted"; readonly sessionId: string; readonly taskId?: string }
	| { readonly status: "rejected"; readonly reason: string }
	| { readonly status: "superseded"; readonly reason: string }
	| { readonly status: "unknown_outcome"; readonly reason: string }

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
	 */
	complete(requestId: string, outcome: ControlSeamLedgerOutcome): void {
		const existing = this.entries.get(requestId)
		if (!existing) {
			// The key was evicted while the operation ran. Re-insert it
			// so the terminal outcome is still observable.
			this.evictIfNeeded()
			this.entries.set(requestId, { payloadFingerprint: "", outcome })
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
	 * Evict the OLDEST entry when the ledger is at capacity.
	 *
	 * `Map` preserves insertion order, so the first key is the oldest.
	 */
	private evictIfNeeded(): void {
		while (this.entries.size >= this.maxEntries) {
			const oldest = this.entries.keys().next()
			if (oldest.done) {
				return
			}
			this.entries.delete(oldest.value)
		}
	}
}

/**
 * The default maximum number of retained ledger entries.
 */
export const CONTROL_SEAM_LEDGER_DEFAULT_MAX_ENTRIES = 64
