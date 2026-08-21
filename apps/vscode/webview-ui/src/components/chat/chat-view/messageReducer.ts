import type { ClineMessage, TurnState } from "@shared/ExtensionMessage"

// Convergent-replica reducer for the webview's clineMessages transcript.
//
// The webview receives the same conversation over two unordered, fire-and-forget channels
// (incremental partial messages and full state snapshots). This reducer makes the transcript
// converge to the correct set under ANY arrival order, duplication, or loss, using three
// extension-stamped quantities:
//
//   - ts    : message identity / merge key (one process-wide monotonic id; see MessageIdMinter)
//   - seq   : freshness within an epoch (higher seq = newer copy of the same ts)
//   - epoch : conversation/replica fence (newer epoch replaces; older is dropped)
//
// The reducer is a pure function so it can be exhaustively unit-tested (including
// property-based, order-independent tests) with no React/gRPC/timers.

/**
 * The webview's replica of the conversation transcript plus the fence/freshness high-water
 * marks needed to reject stale traffic. `messages` is kept as an array (rendering order) and
 * mirrors what the UI consumes.
 */
export interface ReplicaState {
	messages: ClineMessage[]
	/** Highest epoch applied. Messages/snapshots from an older epoch are dropped. */
	epoch: number
	/** Highest per-message seq applied per ts. Used to ignore older copies of the same ts. */
	seqByTs: Map<number, number>
	/** Highest state snapshot version applied. Older snapshots are ignored wholesale. */
	stateVersion: number
	/**
	 * The authoritative UI mode for the current turn. Moves forward by `turnState.seq` only, so a
	 * late/out-of-order snapshot carrying an older phase (e.g. "idle") can never revert a newer
	 * phase (e.g. "streaming"). `undefined` for classic/legacy state with no turnState.
	 */
	turnState?: TurnState
}

/** Create an empty replica. */
export function createReplicaState(): ReplicaState {
	return { messages: [], epoch: 0, seqByTs: new Map(), stateVersion: 0, turnState: undefined }
}

/**
 * Effective epoch of an incoming item. Unstamped (classic/legacy) items use 0, which equals
 * a fresh replica's epoch, so they merge rather than being dropped.
 */
function epochOf(item: { epoch?: number }): number {
	return item.epoch ?? 0
}

function seqOf(message: ClineMessage): number {
	return message.seq ?? 0
}

/** Replace the replica's transcript wholesale at a new epoch (new task / history load). */
function resetTo(epoch: number, messages: ClineMessage[], stateVersion: number, turnState?: TurnState): ReplicaState {
	const seqByTs = new Map<number, number>()
	for (const m of messages) {
		const existing = seqByTs.get(m.ts)
		if (existing === undefined || seqOf(m) >= existing) {
			seqByTs.set(m.ts, seqOf(m))
		}
	}
	return { messages: [...messages], epoch, seqByTs, stateVersion, turnState }
}

/**
 * Apply a TurnState update, gated by `seq`. The replica keeps the highest-seq TurnState and
 * ignores older ones, so a late/out-of-order "streaming" can never overwrite a newer
 * "completed" (and vice-versa). Returns the same state when ignored.
 */
export function applyTurnState(state: ReplicaState, incoming: TurnState | undefined): ReplicaState {
	if (!incoming) {
		return state
	}
	if (state.turnState !== undefined && incoming.seq <= state.turnState.seq) {
		return state
	}
	return { ...state, turnState: incoming }
}

/**
 * ACT-CLINEMM-APPLICATION-OWNERSHIP-PROJECTION-COHERENCE01-AOPC02-PHASE-B-REPAIR01:
 *
 * Pure monotonic-merge helper for the two presentation projections that ride
 * alongside `turnState` on a full ExtensionState snapshot: `taskHeaderPresentation`
 * and `thinkingPresentation`. The producer selectors
 * (`selectTaskHeaderPresentation` / `selectThinkingPresentation` in
 * `apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts`) stamp the same
 * `TurnStateTracker.seq` onto each projection as they stamp onto `turnState`,
 * so each projection carries its own monotonic seq -- there is no need to
 * invent a shared counter.
 *
 * Same-epoch invariant (the only domain this helper governs):
 *
 *   incoming.seq  < current.seq  => preserve current (stale straggler)
 *   incoming.seq == current.seq  => accept incoming (idempotent; matches
 *                                    CTRL-C duplicate-push contract)
 *   incoming.seq  > current.seq  => accept incoming (advance)
 *
 *   incoming == undefined        => preserve current (matches applyTurnState
 *                                    contract at line 73-74; the live wire
 *                                    path never emits undefined for these
 *                                    fields, but the helper is defensive
 *                                    against partial-state payloads)
 *
 * Epoch scope: this helper is ONLY called inside the same-epoch branch
 * of the W1 functional updater (see ExtensionStateContext.tsx ~line 683-720).
 * A newer epoch wholesale-resets the projection domain via the standard
 * `resetTo` path -- that is the established CTRL-E contract and is not
 * changed by this helper.
 *
 * Returns the same reference identity on the "preserve current" branch so
 * React callers can use referential equality to detect "no change".
 */
export function applyPresentationProjection<T extends { seq: number }>(
	current: T | undefined,
	incoming: T | undefined,
): T | undefined {
	if (!incoming) {
		return current
	}
	if (current === undefined || incoming.seq >= current.seq) {
		return incoming
	}
	return current
}

/**
 * Apply the two presentation projections together, independently fenced by
 * their own `.seq`. Each field moves forward on its own seq domain; the two
 * are NOT coupled. This proves out PBR01 (independent projection skew).
 */
export interface PresentationProjections {
	taskHeaderPresentation?: import("@shared/ExtensionMessage").TaskHeaderPresentationProjection | undefined
	thinkingPresentation?: import("@shared/ExtensionMessage").ThinkingPresentationProjection | undefined
}

export function applyPresentationProjections(
	current: PresentationProjections,
	incoming: PresentationProjections | undefined,
): PresentationProjections {
	if (!incoming) {
		return current
	}
	const taskHeaderPresentation = applyPresentationProjection(current.taskHeaderPresentation, incoming.taskHeaderPresentation)
	const thinkingPresentation = applyPresentationProjection(current.thinkingPresentation, incoming.thinkingPresentation)
	const currentTaskHeaderRef = current.taskHeaderPresentation
	const currentThinkingRef = current.thinkingPresentation
	const taskHeaderChanged = taskHeaderPresentation !== currentTaskHeaderRef
	const thinkingChanged = thinkingPresentation !== currentThinkingRef
	if (!taskHeaderChanged && !thinkingChanged) {
		return current
	}
	return { taskHeaderPresentation, thinkingPresentation }
}

/**
 * Apply one incoming ClineMessage (from the partial-message stream OR from within a state
 * snapshot). Returns the same state object when the message is stale/ignored, or a new state
 * when it changes the transcript.
 *
 * Rules:
 *  - older epoch  -> drop (straggler from a previous task/render)
 *  - newer epoch  -> advance the fence, but do NOT discard the existing transcript on the
 *                    strength of a single message. The authoritative wholesale replace for a
 *                    new task/render comes from a full state snapshot (applyStateSnapshot); a
 *                    lone newer-epoch *partial* (e.g. a bookkeeping api_req_started that raced
 *                    ahead of its snapshot) must not empty a live conversation — that would
 *                    strand the webview at messages.length === 0 and route Enter to newTask().
 *                    So we bump the epoch and append/merge this one message; the snapshot that
 *                    follows will reconcile to the true new-task transcript.
 *  - same epoch   -> upsert by ts, keeping the higher seq
 */
export function applyMessage(state: ReplicaState, incoming: ClineMessage): ReplicaState {
	const incomingEpoch = epochOf(incoming)

	if (incomingEpoch < state.epoch) {
		return state
	}

	if (incomingEpoch > state.epoch) {
		// Advance the fence without throwing away an existing transcript. Carry the prior
		// messages forward at the new epoch and merge this one in; a subsequent newer-epoch
		// snapshot performs the real wholesale replace when a genuine new task begins.
		const advanced: ReplicaState = {
			messages: [...state.messages],
			epoch: incomingEpoch,
			seqByTs: new Map(state.seqByTs),
			stateVersion: state.stateVersion,
			turnState: state.turnState,
		}
		return applyMessage(advanced, incoming)
	}

	// Same epoch: merge by ts, keep highest seq.
	const existingSeq = state.seqByTs.get(incoming.ts)
	const index = state.messages.findIndex((m) => m.ts === incoming.ts)

	if (index !== -1) {
		// A copy of this ts already exists. Keep ours unless the incoming is at least as fresh.
		if (existingSeq !== undefined && seqOf(incoming) < existingSeq) {
			return state
		}
		const messages = [...state.messages]
		messages[index] = incoming
		const seqByTs = new Map(state.seqByTs)
		seqByTs.set(incoming.ts, Math.max(existingSeq ?? 0, seqOf(incoming)))
		return { ...state, messages, seqByTs }
	}

	// New ts at the current epoch — append.
	const messages = [...state.messages, incoming]
	const seqByTs = new Map(state.seqByTs)
	seqByTs.set(incoming.ts, seqOf(incoming))
	return { ...state, messages, seqByTs }
}

/**
 * Apply a full state snapshot's transcript.
 *
 *  - older epoch        -> drop entirely
 *  - newer epoch        -> replace the transcript wholesale (new task / history load)
 *  - same epoch:
 *      - older/equal stateVersion -> ignore (a newer snapshot already applied)
 *      - newer stateVersion       -> MERGE each message by ts/seq (NEVER truncate). This is the
 *                                    fix for "last message missing": a snapshot that lacks a
 *                                    message the partial stream already delivered cannot drop it.
 *
 * `snapshotEpoch`/`snapshotVersion` default to 0 (unstamped classic/legacy) which merges.
 *
 * `snapshotTurnState` (when present) is applied through the same seq gate as applyTurnState: a
 * newer epoch adopts it wholesale; otherwise it only advances the replica's turnState if its
 * seq is higher. This is what stops a late/stale snapshot from reverting "streaming" -> "idle".
 */
export function applyStateSnapshot(
	state: ReplicaState,
	snapshotMessages: ClineMessage[],
	snapshotEpoch = 0,
	snapshotVersion = 0,
	snapshotTurnState?: TurnState,
): ReplicaState {
	if (snapshotEpoch < state.epoch) {
		return state
	}

	if (snapshotEpoch > state.epoch) {
		// New task/render: replace transcript AND adopt the snapshot's turnState wholesale.
		return resetTo(snapshotEpoch, snapshotMessages, snapshotVersion, snapshotTurnState)
	}

	// Same epoch.
	if (snapshotVersion !== 0 && snapshotVersion <= state.stateVersion) {
		// A newer (or equal) snapshot already applied for the transcript — but a turnState with a
		// higher seq may still need to move the UI forward, so don't bail before the seq gate.
		return applyTurnState(state, snapshotTurnState)
	}

	// Merge each message; never shrink the transcript for the same task/epoch.
	let next = state
	for (const message of snapshotMessages) {
		next = applyMessage(next, message)
	}
	if (snapshotVersion > next.stateVersion) {
		next = next === state ? { ...state } : next
		next.stateVersion = snapshotVersion
	}
	// Gate turnState by seq so a stale snapshot cannot revert a newer phase.
	next = applyTurnState(next, snapshotTurnState)
	return next
}
