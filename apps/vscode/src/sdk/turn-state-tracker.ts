import type { TurnPhase, TurnState } from "@shared/ExtensionMessage"
import {
	recordTurnStateWriterProvenance,
	type TurnStateWriterIdentity,
	type TurnStateWriterProvenanceRecord,
} from "@shared/turn-state-writer-provenance"
import type { MessageIdMinter } from "./message-id-minter"

// Authoritative UI-mode tracker for the current agent turn.
//
// The backend knows the true phase at every SDK lifecycle point (it drives the session and owns
// every interaction promise), so it sets the phase explicitly here rather than letting the
// webview infer it from the tail of the message array. The webview renders
// footer/buttons/thinking from this.
//
// Each transition stamps a fresh `seq` from the shared minter so the webview keeps only the
// newest TurnState and ignores stale/out-of-order ones (a late "streaming" can never overwrite
// a newer "completed").

export type TurnPhaseListener = (phase: TurnPhase, anchorTs: number | undefined) => void

export class TurnStateTracker {
	private phase: TurnPhase = "idle"
	private anchorTs: number | undefined
	private seq: number
	private listeners: TurnPhaseListener[] = []

	constructor(private readonly minter: MessageIdMinter) {
		this.seq = minter.nextSeq()
	}

	/**
	 * Set the phase (and optional anchor message ts), advancing seq. No-op metadata if unchanged.
	 *
	 * Listeners are notified synchronously AFTER the snapshot is updated,
	 * iterating over a snapshot of the listener array so a listener that
	 * unsubscribes itself or another listener does not affect iteration.
	 *
	 * ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A-CORRECTION03:
	 *
	 * Observer isolation — this method MUST remain authoritative. A
	 * throwing listener cannot:
	 *   - prevent later listeners from running
	 *   - cause `set()` itself to throw (which would unwind the
	 *     production caller: `cancelTask`, `askResponse`,
	 *     `initTask`, the turn coordinator, etc.)
	 *   - leave the tracker's internal state in a partial half-applied
	 *     position
	 *
	 * Throws are swallowed silently (this primitive deliberately does
	 * not couple to a Logger service). Callers that need observability
	 * over their own subscriber should wrap their callback in
	 * try/catch before passing it to `subscribe()`. The
	 * `TaskTelemetryTracker` observer is wrapped that way as well
	 * (defense in depth).
	 *
	 * Subscribers MUST NOT mutate the tracker or rely on synchronous
	 * re-entrant `set()` calls from within a listener — observers are
	 * fire-and-forget projections.
	 *
	 * ACT-CLINEMM-LEGACY-TURNSTATE-WRITER-PROVENANCE01:
	 *
	 * `set()` is a legacy alias for `setWithWriter(phase, anchorTs,
	 * { writerId: "unknown-legacy-writer" })`. New code SHOULD call
	 * `setWithWriter()` directly with a tagged identity from the
	 * closed writerId union. The legacy alias preserves
	 * byte/semantic equivalence for every pre-existing caller when
	 * the diagnostic is disabled (WPROV06).
	 */
	set(phase: TurnPhase, anchorTs?: number): void {
		this.setWithWriter(phase, anchorTs, { writerId: "unknown-legacy-writer" })
	}

	/**
	 * ACT-CLINEMM-LEGACY-TURNSTATE-WRITER-PROVENANCE01:
	 *
	 * Tagged-authority mutation seam. Behaves identically to `set()`
	 * with respect to the snapshot mutation and listener fan-out —
	 * the only addition is stamping one `TurnStateWriterProvenanceRecord`
	 * to the diagnostic ring when the diagnostic is enabled. When the
	 * diagnostic is disabled (the production default), the stamp is
	 * a complete no-op and this method is byte/semantic-equivalent
	 * to `set()` (verified by WPROV06).
	 *
	 * The previous snapshot is read BEFORE the mutation so the
	 * `previous.phase/seq/anchorTs` triple is the authoritative
	 * "what was overwritten" witness. The committed snapshot is read
	 * AFTER the mutation so the `committed` triple reflects the
	 * post-mint seq exactly.
	 *
	 * `taskId` / `epoch` are optional on the identity. SdkController
	 * stamps them when the active session is known; coordinators that
	 * run with a generic callback can pass `undefined`.
	 */
	setWithWriter(phase: TurnPhase, anchorTs: number | undefined, identity: TurnStateWriterIdentity): void {
		const previousPhase = this.phase
		const previousSeq = this.seq
		const previousAnchorTs = this.anchorTs
		const requestedAnchorTs = anchorTs

		this.phase = phase
		this.anchorTs = anchorTs
		this.seq = this.minter.nextSeq()

		const record: TurnStateWriterProvenanceRecord = {
			capturedAt: Date.now(),
			writerId: identity.writerId,
			taskId: identity.taskId,
			epoch: identity.epoch,
			previous: {
				phase: previousPhase,
				seq: previousSeq,
				anchorTs: previousAnchorTs,
			},
			requested: {
				phase,
				anchorTs: requestedAnchorTs,
			},
			committed: {
				phase: this.phase,
				seq: this.seq,
				anchorTs: this.anchorTs,
			},
		}
		// Diagnostic stamp happens AFTER the snapshot mutation so
		// the committed triple always reflects the post-mint state.
		// The stamp is a synchronous in-process ring-buffer append
		// with no I/O and no exceptions thrown out of the module —
		// a stamp failure (e.g. disable-flag race) is a silent skip
		// and cannot unwind the production caller.
		recordTurnStateWriterProvenance(record)

		for (const listener of [...this.listeners]) {
			try {
				listener(phase, anchorTs)
			} catch {
				// Observation must not veto the authoritative transition.
				// Subsequent listeners still run; the phase mutation has
				// already been committed to the snapshot.
			}
		}
	}

	/**
	 * Subscribe to phase transitions. The listener is invoked synchronously
	 * after every `set()` call, including no-op transitions (the same
	 * phase value passed twice still notifies). Subscribers should
	 * idempotently project the new phase; this is the canonical seam
	 * for "the visible task just reached a terminal phase" observers.
	 *
	 * Returns an unsubscribe function.
	 *
	 * ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A-CORRECTION01: the
	 * TaskTelemetryTracker uses this hook to freeze the elapsed clock
	 * on `error` / `resumable` / `completed` transitions without
	 * sprinkling `endTask()` calls through SdkController.
	 *
	 * ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A-CORRECTION03: observer
	 * isolation (see `set()` JSDoc). Throws from a listener are
	 * swallowed — this seam is observation-only and must never
	 * influence the authoritative task-control path.
	 */
	subscribe(listener: TurnPhaseListener): () => void {
		this.listeners.push(listener)
		return () => {
			const i = this.listeners.indexOf(listener)
			if (i >= 0) {
				this.listeners.splice(i, 1)
			}
		}
	}

	/** Current immutable snapshot for inclusion in the state payload. */
	get(): TurnState {
		return { phase: this.phase, anchorTs: this.anchorTs, seq: this.seq }
	}

	get currentPhase(): TurnPhase {
		return this.phase
	}
}
