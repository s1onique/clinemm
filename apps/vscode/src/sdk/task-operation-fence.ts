/**
 * ACT-CLINEMM-TASK-CONTROL-LIVENESS01-FIX01 / Phase 2
 *
 * Shared task-operation generation authority.
 *
 * The invariant we are protecting is the
 * {@link TASK_SESSION_PAIR_INVARIANT}: at every externally observable
 * settled boundary, either both `TaskProxy` and `activeSession` are
 * absent, or both are present and identify the same logical task.
 *
 * Why this is a shared authority (not, say, a counter inside the
 * lifecycle): the invariant spans two owners — `TaskProxy` is owned
 * by `SdkTaskControlCoordinator` (via `setTask`) and `activeSession`
 * is owned by `SdkSessionLifecycle`. A counter inside the lifecycle
 * alone cannot make the pair atomic.
 *
 * Why this is a generation/epoch (not a mutex): the writes are
 * scattered across multiple awaits (provider config build,
 * `sdkHost.start`, message finalization). A mutex held across I/O
 * would serialize expensive work, create reentrancy risk, and make
 * cancellation semantics brittle. A generation says "old work may
 * finish its I/O, but it has lost authority to commit shared state".
 *
 * Why the caller carries the token (instead of the lifecycle reading
 * `current()` at commit time): if the lifecycle reads `current()`
 * when it happens to begin `sdkHost.start`, a stale A can pick up B's
 * generation when B advanced the fence in the meantime. A stale actor
 * MUST retain its old token so it can later be rejected.
 *
 * Semantics:
 *
 *   begin()            — capture the next generation; the caller
 *                        carries this token for the rest of the operation.
 *   isCurrent(token)   — true iff the caller is still the most recent
 *                        intent. false means a newer intent has won;
 *                        the caller must NOT commit shared state and
 *                        must clean up only resources it uniquely owns.
 *
 * There is intentionally no `current()` accessor — only `isCurrent(token)`.
 * This forces callers to carry the token explicitly and prevents the
 * "stale A adopts B's generation" footgun.
 */
export class TaskOperationFence {
	private generation = 0

	/**
	 * Allocate the next generation token. The caller MUST carry this
	 * token to every async commit point and check `isCurrent(token)`
	 * before mutating shared task/session state.
	 *
	 * Returns the just-allocated generation (always strictly greater
	 * than every previous token).
	 */
	begin(): number {
		return ++this.generation
	}

	/**
	 * True iff `token` is still the most recent generation. False
	 * means a newer intent has superseded this one; the caller must
	 * abandon the operation without mutating shared state.
	 */
	isCurrent(token: number): boolean {
		return token === this.generation
	}
}
