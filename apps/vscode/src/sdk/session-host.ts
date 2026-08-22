import type {
	ClineCoreListHistoryOptions,
	ClineCoreStartInput,
	CompareCheckpointInput,
	CompareCheckpointResult,
	CoreSessionEvent,
	HookEventPayload,
	PendingPromptMutationResult,
	PendingPromptsDeleteInput,
	PendingPromptsListInput,
	PendingPromptsUpdateInput,
	RestoreInput,
	RestoreResult,
	SendSessionInput,
	SessionAccumulatedUsage,
	SessionCompactionState,
	SessionHistoryRecord,
	SessionPendingPrompt,
	SessionRecord,
	StartSessionInput,
	StartSessionResult,
} from "@cline/core"
import type { AgentResult, AgentRuntimeEvent, AgentRuntimeRecoverySnapshot, AgentRuntimeStateSnapshot } from "@cline/shared"

export interface SdkSessionHost {
	readonly runtimeAddress: string | undefined
	start(input: StartSessionInput): Promise<StartSessionResult>
	start(input: ClineCoreStartInput): Promise<StartSessionResult>
	send(input: SendSessionInput): Promise<AgentResult | undefined>
	getAccumulatedUsage(sessionId: string): Promise<SessionAccumulatedUsage | undefined>
	abort(sessionId: string, reason?: unknown): Promise<void>
	stop(sessionId: string): Promise<void>
	dispose(reason?: string): Promise<void>
	get(sessionId: string): Promise<SessionRecord | undefined>
	list(limit?: number, options?: Omit<ClineCoreListHistoryOptions, "limit">): Promise<SessionHistoryRecord[]>
	listHistory(options?: ClineCoreListHistoryOptions): Promise<SessionHistoryRecord[]>
	delete(sessionId: string): Promise<boolean>
	readMessages(sessionId: string): Promise<SdkInitialMessages>
	/**
	 * Like readMessages, but prefers the live in-memory conversation when the
	 * session is still resident, so an in-flight (or just-aborted) turn is not
	 * lost to the persisted transcript lagging behind.
	 */
	readLiveMessages?(sessionId: string): Promise<SdkInitialMessages>
	updateSessionCompactionState?(sessionId: string, state: SessionCompactionState): Promise<{ updated: boolean }>
	restore(input: RestoreInput): Promise<RestoreResult>
	/** Diffs a checkpoint snapshot against the current working tree. */
	compareCheckpoint?(input: CompareCheckpointInput): Promise<CompareCheckpointResult>
	update(
		sessionId: string,
		updates: {
			prompt?: string | null
			metadata?: Record<string, unknown> | null
			title?: string | null
		},
	): Promise<{ updated: boolean }>
	handleHookEvent(payload: HookEventPayload): Promise<void>
	pendingPrompts(action: "list", input: PendingPromptsListInput): Promise<SessionPendingPrompt[]>
	pendingPrompts(action: "update", input: PendingPromptsUpdateInput): Promise<PendingPromptMutationResult>
	pendingPrompts(action: "delete", input: PendingPromptsDeleteInput): Promise<PendingPromptMutationResult>
	subscribe(listener: (event: CoreSessionEvent) => void): () => void
	/**
	 * ACT-CLINEMM-TASK-HEADER-TELEMETRY01-A: subscribe to canonical recovery
	 * state transitions for the current task. The listener receives
	 * `(sessionId, recovery)` once per externally-meaningful change. The
	 * host uses this to feed the cumulative `recoveryBudgetFailures` counter
	 * exposed on the TaskHeader (CORRECTION02 rename: this is a
	 * bounded-recovery control-plane metric, not a total of recoverable
	 * tool failures) — it is an OBSERVER-ONLY stream; nothing on the
	 * recovery-policy or runtime-control path reads from it.
	 *
	 * Optional. Implementations that don't ship recovery projections (e.g.
	 * the standalone core for legacy host bridges) may omit this method.
	 */
	subscribeRecoveryStateChange?(listener: (sessionId: string, recovery: AgentRuntimeRecoverySnapshot) => void): () => void
	/**
	 * ACT-CLINEMM-ELM-ARCHITECTURE01-E2F-CANONICAL-RUNTIME-EVENT-SEAM01-F1:
	 * subscribe to canonical `AgentRuntimeEvent`s for the active
	 * session. Mirrors `subscribeRecoveryStateChange?` (recovery
	 * projection only) but exposes the full canonical event surface.
	 *
	 * Optional. Implementations that don't expose raw canonical events
	 * (e.g. remote/hub hosts that proxy legacy `AgentEvent`s only)
	 * MUST omit this method.
	 */
	subscribeRuntimeEvents?(listener: (sessionId: string, event: AgentRuntimeEvent) => void): () => void
	/**
	 * ACT-CLINEMM-ELM-ARCHITECTURE01-E2F-F1-CANONICAL-RUNTIME-EVENT-SEAM01-ELM-02F-CORRECTION01:
	 * Returns the canonical `AgentRuntimeStateSnapshot` of the
	 * currently active `AgentRuntime` instance for `sessionId`, if
	 * any. This is the canonical arbiter source that ELM-02F
	 * unblocks — when the result is non-`undefined`, the
	 * `TaskStateShadow` wiring uses the canonical `mapper`; when
	 * `undefined`, the legacy mirror is preserved as the
	 * FALLBACK. Hub/Remote hosts omit this method by design; the
	 * method-absent and returns-undefined cases collapse to a
	 * single fallback at the consumer via `?.()`. See ELM-02F
	 * plan §1.2 (CONTRACT_2) and §3 T4_SOURCE_SELECTION.
	 *
	 * Optional. Implementations that don't expose the canonical
	 * runtime snapshot (e.g. remote/hub hosts) MUST omit this
	 * method.
	 */
	runtimeSnapshot?(sessionId: string | undefined): AgentRuntimeStateSnapshot | undefined
	updateSessionModel?(sessionId: string, modelId: string): Promise<void>
}

export type SdkInitialMessages = NonNullable<StartSessionInput["initialMessages"]>
