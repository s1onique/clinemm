/**
 * Recovery policy configuration for bounded tool/protocol repair loops.
 *
 * This module defines the policy that controls when the circuit breaker
 * opens based on recovery pressure.
 */

/**
 * Recovery policy configuration.
 *
 * C1.0 contract:
 *   - `maxRepairAttempts` is the number of *repairs* (post-original-failure
 *     attempts) permitted for a given failure family before the circuit opens.
 *   - `warningThreshold` is the repair-count at which the visible state
 *     transitions from `recovering` to `warning`. The intended UX meaning
 *     of `warning` is **"budget consumed; the next equivalent attempt will
 *     trip the circuit"**, which means `warningThreshold === maxRepairAttempts`.
 *   - Keeping them equal also makes `computeRecoveryState` exclusive: a
 *     value of `repairAttempts === maxRepairAttempts` is `warning`, and a
 *     value of `repairAttempts > maxRepairAttempts` is `circuit_open`. They
 *     can never overlap.
 */
export interface RecoveryPolicyConfig {
	/**
	 * Maximum number of repair attempts before opening the circuit.
	 * After the original failure (attempt 0), this many additional repair
	 * attempts are permitted before circuit break.
	 *
	 * Default: 2 (original + 2 repairs = 3 total attempts on the same family)
	 */
	maxRepairAttempts: number;

	/**
	 * Repair-count at which the recovery state becomes `"warning"`.
	 *
	 * Default: equal to `maxRepairAttempts`. The intended semantic is
	 * "your last permitted repair has been observed; the next equivalent
	 * attempt will open the circuit." Mismatching this with `maxRepairAttempts`
	 * is allowed for testing but should not be done in production defaults.
	 */
	warningThreshold: number;

	/**
	 * C1.4 episode-level non-convergence ceiling. Counts genuinely
	 * RECOVERABLE failures (i.e. `outcome.kind === "failure"`,
	 * regardless of `familyEligible`) observed across the whole
	 * recovery episode. Once `recoveryEpisodeFailures >=
	 * maxRecoveryEpisodeFailures`, the runtime's second-stage
	 * continuation latch arms (Trigger D — episode exhaustion).
	 *
	 * This is a SEPARATE policy dimension from `maxRepairAttempts`:
	 *   - `maxRepairAttempts` bounds failures of ONE convergence
	 *     family (i.e. the model is hammering the same broken path).
	 *   - `maxRecoveryEpisodeFailures` bounds the total non-
	 *     convergent observations across distinct families / distinct
	 *     exact keys (i.e. the model is trying many distinct broken
	 *     paths in a row).
	 *
	 * Default: 6. Rationale: with `maxRepairAttempts = 2`, a single
	 * convergence family consumes `1 + 2 = 3` failures before
	 * exhausting. The episode budget of 6 therefore tolerates
	 * approximately two distinct convergence-family failures before
	 * declaring non-convergence. This is enough patience for the
	 * model to attempt one materially different approach (e.g.
	 * switching from `fs_read` to `fs_list`) without permitting the
	 * upstream runaway-loop pattern (870 provider requests in
	 * cline/cline#11542). Smaller values may break legitimate
	 * "try a different tool" behaviour; larger values weaken the
	 * load-bearing invariant that "non-convergent provider
	 * continuation is finite."
	 */
	maxRecoveryEpisodeFailures: number;
}

/**
 * Default recovery policy.
 *
 * - attempt 0 (original failure):        state = recovering
 * - repair 1 failure:                    state = recovering
 * - repair 2 failure:                    state = warning  (last permitted repair)
 * - next equivalent attempt of any kind: state = circuit_open (blocked)
 *
 * Total executor calls on the failing family before the circuit opens:
 *   original + maxRepairAttempts = 3. Any subsequent attempt is short-circuited.
 */
export const DEFAULT_RECOVERY_POLICY: RecoveryPolicyConfig = {
	maxRepairAttempts: 2,
	warningThreshold: 2,
	maxRecoveryEpisodeFailures: 6,
};

/**
 * Recovery state describing the current status of recovery tracking.
 */
export type RecoveryState =
	/** No active recovery episode. */
	| "idle"
	/** Actively recovering from a failure. */
	| "recovering"
	/**
	 * The budget has been consumed (last permitted repair observed).
	 * The next equivalent attempt MUST be intercepted by the runtime at
	 * the pre-execution stage (via `RecoveryTracker.recordBlockedAttempt`),
	 * which transitions the visible state to `circuit_open`. If a
	 * further failure reaches `recordFailure` while the state is still
	 * `warning`, that indicates a runtime-side pre-execution breaker
	 * bypass.
	 */
	| "warning"
	/** Circuit breaker is open — an equivalent attempt was intercepted. */
	| "circuit_open";

/**
 * Result of checking if a repair attempt is allowed.
 */
export interface RecoveryCheckResult {
	/** Whether the repair attempt is allowed. */
	allowed: boolean;
	/** The new recovery state after this check. */
	state: RecoveryState;
	/** Reason for denial if not allowed. */
	reason?: string;
	/** Number of repair attempts after this check. */
	repairAttempts: number;
	/** Number of equivalent repeats (exact fingerprint matches). */
	equivalentRepeats: number;
}

/**
 * Computes the recovery state based on repair attempts.
 *
 * Branch order is significant:
 *   1. If `repairAttempts > maxRepairAttempts` the circuit is open. This must
 *      be checked **before** the `warning` branch so that an attempt past
 *      the budget can never be reported as `warning`.
 *   2. If `repairAttempts >= warningThreshold` (and we haven't already
 *      crossed into `circuit_open`), the budget is consumed: the next
 *      equivalent attempt will open the circuit.
 *   3. Otherwise (still under budget), we are recovering.
 *   4. `repairAttempts === 0` (initial failure observation, never seen a
 *      repair yet) is the special case for "we are inside a recovery episode
 *      but no repair has been attempted." This is treated the same as
 *      `recovering` here; the runtime distinguishes "no episode" (`idle`) from
 *      "episode with no repair yet" by checking the episode handle itself,
 *      not by inferring it from the count.
 */
export function computeRecoveryState(
	repairAttempts: number,
	config: RecoveryPolicyConfig,
): RecoveryState {
	if (repairAttempts > config.maxRepairAttempts) {
		return "circuit_open";
	}
	if (repairAttempts >= config.warningThreshold) {
		return "warning";
	}
	return "recovering";
}

/**
 * Default recovery policy that can be used directly.
 */
export class RecoveryPolicy {
	private readonly config: RecoveryPolicyConfig;

	constructor(config: Partial<RecoveryPolicyConfig> = {}) {
		this.config = {
			maxRepairAttempts: config.maxRepairAttempts ?? DEFAULT_RECOVERY_POLICY.maxRepairAttempts,
			warningThreshold: config.warningThreshold ?? DEFAULT_RECOVERY_POLICY.warningThreshold,
			maxRecoveryEpisodeFailures:
				config.maxRecoveryEpisodeFailures ??
				DEFAULT_RECOVERY_POLICY.maxRecoveryEpisodeFailures,
		};
	}

	/**
	 * Returns the effective config.
	 */
	get configValue(): RecoveryPolicyConfig {
		return { ...this.config };
	}

	/**
	 * Maximum repair attempts allowed.
	 */
	get maxRepairAttempts(): number {
		return this.config.maxRepairAttempts;
	}

	/**
	 * Warning threshold.
	 */
	get warningThreshold(): number {
		return this.config.warningThreshold;
	}

	/**
	 * C1.4 episode-level non-convergence ceiling. See
	 * `RecoveryPolicyConfig.maxRecoveryEpisodeFailures` for the
	 * default rationale. Distinct from `maxRepairAttempts`.
	 */
	get maxRecoveryEpisodeFailures(): number {
		return this.config.maxRecoveryEpisodeFailures;
	}

	/**
	 * Decides whether the *next* repair attempt is allowed given the
	 * current count. The tracker has responsibility for the increment; this
	 * function is purely the budget gate.
	 *
	 * With default policy `{ maxRepairAttempts: 2, warningThreshold: 2 }`:
	 *   currentAttempts = 0 → next attempt would yield state=recovering → ALLOWED
	 *   currentAttempts = 1 → next attempt would yield state=warning     → ALLOWED (last permitted)
	 *   currentAttempts = 2 → next attempt would yield state=circuit_open→ DENIED
	 *
	 * The tracker enforces the cap on `repairAttempts` itself; this function
	 * only reports the *projected* state for the next-attempt policy gate.
	 */
	checkRepairAttempt(currentAttempts: number): RecoveryCheckResult {
		const projectedAttempts = currentAttempts + 1;
		const state = computeRecoveryState(projectedAttempts, this.config);

		if (state === "circuit_open") {
			return {
				allowed: false,
				state,
				reason: `Recovery budget exhausted (${projectedAttempts} attempts would exceed max ${this.config.maxRepairAttempts})`,
				repairAttempts: currentAttempts,
				equivalentRepeats: 0,
			};
		}

		return {
			allowed: true,
			state,
			repairAttempts: currentAttempts,
			equivalentRepeats: 0,
		};
	}

	/**
	 * Returns a circuit-open message for blocked attempts.
	 */
	getCircuitOpenMessage(): string {
		return (
			"Recovery circuit opened for repeated equivalent tool failures. " +
			"Further equivalent attempts are blocked for this recovery episode. " +
			"Use a materially different strategy or request user input."
		);
	}
}
