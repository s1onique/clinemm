import type { TurnPhase, TurnState } from "@shared/ExtensionMessage"
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
	 * Listeners are notified synchronously AFTER the snapshot is updated.
	 * Subscribers MUST NOT mutate the tracker or rely on synchronous re-entrant
	 * `set()` calls — observers are fire-and-forget projections.
	 */
	set(phase: TurnPhase, anchorTs?: number): void {
		this.phase = phase
		this.anchorTs = anchorTs
		this.seq = this.minter.nextSeq()
		for (const listener of this.listeners) {
			listener(phase, anchorTs)
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
