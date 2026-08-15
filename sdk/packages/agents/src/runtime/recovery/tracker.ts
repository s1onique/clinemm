/**
 * In-memory recovery tracker for bounded tool/protocol repair loops.
 *
 * ## Privacy discipline (Stage 1 of CORRECTION01)
 *
 *   - Internal state (Sets, Maps, family control identities) uses full
 *     canonical input strings for equality. These NEVER leave the tracker.
 *   - Public snapshots and events use opaque 8-char diagnostic IDs
 *     derived from the canonical input via FNV-1a. Telemetry, runtime
 *     events, and host projections see the diagnostic IDs only.
 *   - Conversion is deterministic and stable within a runtime invocation,
 *     so equality assertions in tests remain valid.
 *
 * ## C1.0 contract (locked substrate design — do not weaken without updating
 * the invariant matrix test in `recovery-tracker.test.ts`):
 *
 *   1. Single source of circuit truth. `state`, `isFamilyBlocked(...)`,
 *      `getBlockedFamilies()`, and `snapshot()` all read from the same
 *      per-episode per-family `FamilyState`. There is no separate
 *      `seenFamilies` total-observation counter that can disagree with
 *      the budget-based view.
 *
 *   2. Multi-family episodes. An episode is **not** a single failure
 *      family. It is a context that may accumulate exhaustion across
 *      multiple families (`A → B → A` does not forget A's pressure).
 *      A new failed family extends `families`, it does not replace
 *      `episode`.
 *
 *   3. Exact vs family. An "exact" identity is `(toolName, canonical input)`,
 *      known at intent time (pre-execution). A "family" identity is
 *      `(toolName, failureClass, stableCode)`, only known after execution.
 *      Two-level enforcement lives here:
 *      - PRE-EXECUTION: block exact-exhausted attempts before `tool.execute`
 *        via `isExactBlockedControl(attemptKey)` (family-independent at intent
 *        time). `recordBlockedAttemptControl(attemptKey)` is the runtime's
 *        signal that the breaker fired, and re-anchors the canonical
 *        `activeFamily` to the resolved owner.
 *      - POST-EXECUTION: update per-family state via `recordFailureControl(...)`.
 *
 *   4. State-transition event capture. Transitions are computed from the
 *      *previous* snapshot, emitted via `notifyWith(prev, curr)`, and
 *      only fire when `prev !== curr`. Reading the getter after mutation
 *      (the pre-C1.0 bug) is fixed.
 *
 *   5. Two latches per family: `budgetExhausted` (sticky on the third
 *      observation; gates `isExactBlocked` / `isFamilyBlocked`; visible
 *      state = `warning`) and `circuitTripped` (sticky once the runtime
 *      records an interception via `recordBlockedAttempt`; visible
 *      state = `circuit_open`). They distinguish "budget consumed"
 *      from "circuit tripped" — necessary for the model-facing
 *      `bounded_recovery_exhausted` notice to fire on actual
 *      interception, not mere exhaustion.
 *
 *   6. Reset policy is explicit. `resetActiveFamily()` clears only the
 *      family whose tool just succeeded; `resetEpisode()` clears all
 *      retained exhaustion (user input / new run only, never incidental
 *      model progress).
 */

import type {
	RecoverySnapshot,
	RecoveryState,
	RecoveryStateChangeEvent,
	ToolFailureClass,
} from "@cline/shared";
import {
	controlFamilyToDiagnosticId,
	controlKeyToDiagnosticId,
	type ToolAttemptIdentity,
	type ToolFamilyIdentity,
	type ToolFailureFingerprint,
} from "./fingerprint";
import {
	RecoveryPolicy,
	type RecoveryPolicyConfig,
	computeRecoveryState,
} from "./policy";

// Re-export the public contract types so consumers can `import { ... }`
// from this module without depending on `@cline/shared` directly.
export type {
	RecoverySnapshot,
	RecoveryStateChangeEvent,
	ToolFailureClass,
} from "@cline/shared";

type RecoveryStateChangeCallback = (event: RecoveryStateChangeEvent) => void;

/**
 * Per-family circuit state. Single source of truth for one failure family
 * within one recovery episode.
 *
 * - `failureObservations`: how many times the family has been observed
 *   failing (original + repairs). Informational telemetry.
 * - `repairAttempts`: how many *repair* attempts have failed
 *   (post-original). This drives `computeRecoveryState` and the
 *   `circuitOpen` decision.
 * - `equivalentRepeats`: how many times an *exact* (tool+canonicalInput)
 *   fingerprint was observed more than once. Strong loop signal.
 * - `exhaustedExactKeys`: per-(toolName, canonicalInput) memory of which
 *   exact keys we have already blocked at the pre-execution stage in
 *   this episode.
 */
interface FamilyState {
	family: string;
	failureObservations: number;
	repairAttempts: number;
	equivalentRepeats: number;
	lastFailure?: ToolFailureFingerprint;
	exhaustedExactKeys: Map<string, true>;
	/**
	 * `true` once the family's repair budget has been consumed (last
	 * permitted repair observed). This is *not* the same as "the
	 * circuit has tripped" — that distinction is tracked separately
	 * via `circuitTripped`. While `budgetExhausted = true` and
	 * `circuitTripped = false`, the visible state is `warning` and
	 * the runtime's pre-execution breaker is responsible for
	 * intercepting any further attempt.
	 */
	budgetExhausted: boolean;
	/**
	 * `true` once the runtime actually intercepts an attempt at the
	 * pre-execution stage (i.e. `recordBlockedAttempt` has been
	 * called). Set on the first intercepted attempt and remains true
	 * for the rest of the episode unless `resetActiveFamily` /
	 * `resetEpisode` clears it. The visible state transitions to
	 * `circuit_open` at this moment.
	 */
	circuitTripped: boolean;
}

interface Episode {
	episodeId: string;
	startedAtIteration: number;
	families: Map<string, FamilyState>;
	blockedExactKeys: Set<string>;
	activeFamily?: string;
}

export class RecoveryTracker {
	private readonly policy: RecoveryPolicy;
	private episode: Episode | null = null;
	private callbacks: RecoveryStateChangeCallback[] = [];
	/**
	 * Number of `circuit_open` transitions emitted for this episode.
	 * The model-facing notification policy is once-per-episode:
	 * the FIRST `recordBlockedAttempt` that resolves to an exhausted
	 * family increments this to 1; subsequent interceptions in the
	 * same episode are no-ops at this layer. The runtime is expected
	 * to interpret the first notice as "the breaker is open" and
	 * proceed to terminal action (C1.4) rather than spawn another
	 * recovery cycle, which would otherwise reproduce the upstream
	 * request-storm pattern (see GitHub #11542).
	 *
	 * Does NOT increment when the budget is merely exhausted (that
	 * state is `warning`, not `circuit_open`); the notice is
	 * reserved for actual interception.
	 */
	private circuitNoticeCount = 0;
	/**
	 * Identity-projection maps for the two-track privacy contract.
	 *
	 * Populated by the typed-identity overloads
	 * (`recordFailureIdentity`, `markExactBlockedIdentity`,
	 * `recordBlockedAttemptIdentity`). When the snapshot/event
	 * surface emits `blockedExactKeys`, `currentFailureFamily`,
	 * `blockedFamilies`, or `RecoveryStateChangeEvent.failureFamily`,
	 * the stored label is projected through this map; keys present in
	 * the map are converted to their diagnostic identifier (8-char
	 * FNV-1a hex), keys NOT in the map are passed through unchanged
	 * (legacy string callers without privacy expectations).
	 *
	 * This map is the enforcement boundary: the runtime MUST use the
	 * typed-identity overloads if it wants its canonical control
	 * identity to be hidden from telemetry. The legacy string
	 * overloads deliberately do not populate the map.
	 */
	private readonly controlKeyToDiagnostic: Map<string, string> = new Map();
	private readonly controlFamilyToDiagnostic: Map<string, string> = new Map();

	constructor(config?: Partial<RecoveryPolicyConfig>) {
		this.policy = new RecoveryPolicy(config);
	}

	// -------------------------------------------------------------------------
	// Snapshot / introspection
	// -------------------------------------------------------------------------

	/**
	 * Project an internal stored label (a canonical control key) to its
	 * diagnostic identifier. Maps are populated by the typed-identity
	 * overloads. If a label is not in the map (e.g. it was injected via
	 * the private `*Control` methods without going through the typed
	 * identity constructors), the label is hashed to its 8-char
	 * diagnostic form so the public surface remains privacy-safe
	 * regardless of the entry path.
	 *
	 * This is the boundary that prevents raw canonical tool input from
	 * reaching telemetry, runtime events, or host projections.
	 */
	private projectControlKey(controlKey: string): string {
		const diag = this.controlKeyToDiagnostic.get(controlKey);
		return diag ?? controlKeyToDiagnosticId(controlKey);
	}

	private projectControlFamily(controlFamily: string): string {
		const diag = this.controlFamilyToDiagnostic.get(controlFamily);
		return diag ?? controlFamilyToDiagnosticId(controlFamily);
	}

	/** Project every key in an array of stored exact keys. */
	private projectExactKeys(keys: Iterable<string>): string[] {
		const out: string[] = [];
		for (const k of keys) out.push(this.projectControlKey(k));
		return out;
	}

	snapshot(): RecoverySnapshot {
		if (!this.episode) {
			return {
				state: "idle",
				currentRepairAttempts: 0,
				equivalentRepeatCount: 0,
				blockedFamilies: [],
				blockedExactKeys: [],
			};
		}
		const active = this.activeFamilyState();
		if (!active) {
			return {
				state: "idle",
				currentRepairAttempts: 0,
				equivalentRepeatCount: 0,
				blockedFamilies: this.getBlockedFamilies(),
				blockedExactKeys: this.projectExactKeys(this.episode.blockedExactKeys),
			};
		}
		const repairAttempts = active.repairAttempts;
		let state: RecoveryState;
		if (active.circuitTripped) {
			state = "circuit_open";
		} else if (active.budgetExhausted) {
			state = "warning";
		} else {
			state = computeRecoveryState(repairAttempts, this.policy.configValue);
		}
		return {
			state,
			currentRepairAttempts: repairAttempts,
			equivalentRepeatCount: active.equivalentRepeats,
			currentFailureClass: active.lastFailure?.failureClass as ToolFailureClass | undefined,
			currentToolName: active.lastFailure?.toolName,
			currentFailureFamily: this.projectControlFamily(active.family),
			circuitReason: state === "circuit_open" ? this.policy.getCircuitOpenMessage() : undefined,
			blockedFamilies: this.getBlockedFamilies(),
			blockedExactKeys: this.projectExactKeys(this.episode.blockedExactKeys),
		};
	}

	get state(): RecoveryState {
		if (!this.episode) return "idle";
		const active = this.activeFamilyState();
		if (!active) return "idle";
		// The visible state transitions to `circuit_open` only when the
		// runtime actually intercepts an attempt at the pre-execution
		// stage (i.e. `recordBlockedAttempt` has been called). Until
		// then, a budget-exhausted family is in `warning`.
		if (active.circuitTripped) return "circuit_open";
		if (active.budgetExhausted) return "warning";
		return computeRecoveryState(active.repairAttempts, this.policy.configValue);
	}

	get repairAttempts(): number {
		if (!this.episode) return 0;
		return this.activeFamilyState()?.repairAttempts ?? 0;
	}

	get equivalentRepeats(): number {
		if (!this.episode) return 0;
		return this.activeFamilyState()?.equivalentRepeats ?? 0;
	}

	get episodeId(): string | null {
		return this.episode?.episodeId ?? null;
	}

	// -------------------------------------------------------------------------
	// Pre-execution: exact repeat breaker (Rule 1 — identity-time)
	// -------------------------------------------------------------------------

	/**
	 * Decide whether an attempt with the given canonical identity should be
	 * blocked *before* `tool.execute`.
	 *
	 * The pre-execution boundary only has the *attempt* identity — the
	 * failure family is a property of the outcome, not the request. This
	 * method therefore takes a single `attemptKey` (canonical signature of
	 * `(toolName, canonicalInput)`). It does NOT take a family.
	 *
	 * An attemptKey is blocked when:
	 *   - the runtime explicitly marked it blocked via `markExactBlocked(...)`, OR
	 *   - the family that previously classified a failure with this attemptKey
	 *     has since exhausted its repair budget (transitioned to `circuit_open`).
	 *     The bookkeeping lives in the family state, but lookup is purely
	 *     attempt-identity so this method can be called without knowing the
	 *     family at intent time.
	 */
	private isExactBlockedControl(attemptKey: string): boolean {
		if (!this.episode) return false;
		if (this.episode.blockedExactKeys.has(attemptKey)) return true;
		// A family whose budget has been exhausted blocks any further
		// attempt with an exact key it has previously observed. This
		// does NOT require the circuit to have tripped yet — the
		// runtime is expected to consult this and, when true, route
		// through `recordBlockedAttempt` so the visible state and the
		// event stream both reflect the actual interception.
		for (const fam of this.episode.families.values()) {
			if (fam.budgetExhausted && fam.exhaustedExactKeys.has(attemptKey)) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Mark an attempt key as blocked without observing an actual failure.
	 * Used when the runtime chooses to fail-closed on a known loop (host
	 * explicitly says "this input has been tried too often").
	 *
	 * Takes only an `attemptKey` — no family. The runtime must not be
	 * required to predict the post-execution classification to enforce a
	 * pre-execution block.
	 */
	private markExactBlockedControl(attemptKey: string): void {
		const ep = this.ensureEpisode();
		ep.blockedExactKeys.add(attemptKey);
	}

	// -------------------------------------------------------------------------
	// Post-execution: family-level convergence (Rule 1 — classification-time)
	// -------------------------------------------------------------------------

	/**
	 * Record the result of a tool execution that just failed in `family`
	 * with the given exact key and `fingerprint`. Returns the new recovery
	 * state after this observation, plus the decision for the next
	 * equivalent attempt.
	 *
	 * Critical correctness rules:
	 *   - Capture `previousState` BEFORE mutation.
	 *   - Increment `repairAttempts` exactly once when allowed.
	 *   - Notify only when `previousState !== newState`.
	 *   - If `nextEquivalentAttemptAllowed` is false, the runtime must
	 *     consult `isExactBlocked(...)` and block any further same-key
	 *     attempt *before* `tool.execute`.
	 */
	private recordFailureControl(
		family: string,
		exactKey: string,
		fingerprint: ToolFailureFingerprint,
	): {
		previousState: RecoveryState;
		newState: RecoveryState;
		nextEquivalentAttemptAllowed: boolean;
		noticeEmitted: boolean;
		repairAttempts: number;
		failureObservations: number;
	} {
		const ep = this.ensureEpisode();
		const previousState = this.state;
		let fam = ep.families.get(family);
		if (!fam) {
			fam = this.blankFamily(family);
			ep.families.set(family, fam);
		}
		ep.activeFamily = family;

		// Failure observation count includes the original failure.
		fam.lastFailure = fingerprint;
		fam.failureObservations++;

		// Track that we have SEEN this exact key in this family. The
		// pre-execution breaker (`isExactBlocked`) consults this on
		// the next attempt; the breaker itself is gated by
		// `budgetExhausted`, not by direct episode-wide blocking.
		if (fam.exhaustedExactKeys.has(exactKey)) {
			fam.equivalentRepeats++;
		}
		fam.exhaustedExactKeys.set(exactKey, true);

		// repairAttempts = post-original-failure failures only.
		//   observations === 1 → repairs = 0 (original)
		//   observations === 2 → repairs = 1
		//   observations === N → repairs = min(N - 1, maxRepairAttempts)
		fam.repairAttempts = Math.min(
			fam.failureObservations - 1,
			this.policy.maxRepairAttempts,
		);

		// Set the `budgetExhausted` latch on the observation that
		// consumes the last permitted repair. This does NOT trip the
		// circuit (visible state remains `warning`); the runtime must
		// route the next attempt through `recordBlockedAttempt` to
		// transition to `circuit_open` and emit the bounded-recovery
		// notice exactly once.
		const exhaustsBudget = fam.repairAttempts >= this.policy.maxRepairAttempts
			&& fam.failureObservations > 1;
		if (!fam.budgetExhausted && exhaustsBudget) {
			fam.budgetExhausted = true;
		}

		// Visible state from the budget perspective only — the circuit
		// does not trip here. (`recordBlockedAttempt` performs the
		// transition to `circuit_open` and emits the notice.)
		const newState: RecoveryState = fam.budgetExhausted
			? "warning"
			: computeRecoveryState(fam.repairAttempts, this.policy.configValue);
		const noticeEmitted = previousState !== newState;
		if (noticeEmitted) {
			this.notifyWith(previousState, newState, fam.repairAttempts);
		}

		return {
			previousState,
			newState,
			// Once the budget is exhausted, no further equivalent attempt
			// is allowed at the runtime boundary. The runtime is
			// expected to call `isExactBlocked` and route blocked
			// attempts through `recordBlockedAttempt`.
			nextEquivalentAttemptAllowed: !fam.budgetExhausted,
			noticeEmitted,
			repairAttempts: fam.repairAttempts,
			failureObservations: fam.failureObservations,
		};
	}

	// -------------------------------------------------------------------------
	// Pre-execution interception: the runtime wires the breaker here.
	// -------------------------------------------------------------------------

	/**
	 * Record an attempt that the runtime intercepted at the
	 * pre-execution stage. Call this *after* `isExactBlockedControl(attemptKey)`
	 * returns true (or after the runtime has independently determined
	 * that the attempt should not execute) and *before* `tool.execute`
	 * would have been called.
	 *
	 * The owning family is the family whose `budgetExhausted` latch is
	 * set and which previously classified the exact key — i.e. the
	 * same predicate `isExactBlocked` consulted. The resolved family
	 * becomes the canonical active recovery context for this episode,
	 * even if a different family was previously active (the
	 * multi-family `A → B → A` case). Without this re-anchoring, the
	 * canonical state and event stream could report a different
	 * family's `recovering`/`warning` while a retained exhausted
	 * family is the one that actually tripped.
	 *
	 * Effect on the resolved family:
	 *   - `circuitTripped` is set (sticky until reset)
	 *   - the episode's `activeFamily` is re-anchored to this family
	 *   - the visible state transitions to `circuit_open`
	 *   - `circuitNoticeCount` increments by exactly 1 (per episode —
	 *     see `circuitNoticeCountForEpisode` for the policy)
	 *   - the transition event fires exactly once
	 *
	 * If no exhausted family owns the attempt key (e.g. the block
	 * came from `markExactBlocked` without any recorded failure),
	 * the call is a no-op and `family` is undefined in the result —
	 * we never fabricate ownership of an unrelated family.
	 */
	private recordBlockedAttemptControl(attemptKey: string): {
		previousState: RecoveryState;
		newState: RecoveryState;
		family?: string;
		noticeEmitted: boolean;
	} {
		if (!this.episode) {
			return { previousState: "idle", newState: "idle", noticeEmitted: false };
		}
		// Resolve the owning exhausted family using the SAME predicate
		// `isExactBlocked` consulted. This prevents attributing a block
		// to the wrong family when one exact key was historically seen
		// by multiple families (same tool+input → different classifications
		// over time) and only one of them is currently budget-exhausted.
		const fam = this.blockedFamilyForAttemptKey(attemptKey);
		if (!fam) {
			// No exhausted family claims this attempt key. Either the
			// runtime asked us to record a block we have no context for,
			// or the block came from `markExactBlocked` without any
			// recorded failure. In both cases we must NOT attribute the
			// block to an unrelated active family — that would corrupt
			// canonical state and event attribution.
			return {
				previousState: this.state,
				newState: this.state,
				noticeEmitted: false,
			};
		}
		// Re-anchor the active family to the resolved owner BEFORE
		// deriving the canonical state, so the visible transition
		// correctly reports the family's state change.
		const previousState = this.state;
		const wasTripped = fam.circuitTripped;
		this.episode.activeFamily = fam.family;
		if (!wasTripped) {
			fam.circuitTripped = true;
		}
		const newState: RecoveryState = this.state;
		const noticeEmitted = previousState !== newState;
		if (noticeEmitted) {
			this.notifyWith(previousState, newState, fam.repairAttempts, fam.family);
		}
		// Once-per-episode model-facing notice. Multiple intercepted
		// keys from the same episode do NOT re-emit the notice. The
		// first interception trips the breaker; subsequent interceptions
		// are no-ops at this layer (the runtime should treat them as
		// "the model has been told the breaker is open" and proceed to
		// termination per C1.4, not spawn another recovery cycle).
		if (!wasTripped && this.circuitNoticeCount === 0) {
			this.circuitNoticeCount++;
		}
		return {
			previousState,
			newState,
			// Projected: this is the public surface, so the privacy
			// contract requires the diagnostic form, not the raw control
			// family.
			family: this.projectControlFamily(fam.family),
			noticeEmitted,
		};
	}

	/**
	 * Resolve the exhausted family that owns an exact key. Uses the
	 * same predicate `isExactBlocked` consults — a family whose
	 * `budgetExhausted` latch is set and which has previously classified
	 * the attempt key. Returns the first match (deterministic over
	 * insertion order of `Map`); returns undefined if no exhausted
	 * family claims the key.
	 */
	private blockedFamilyForAttemptKey(attemptKey: string): FamilyState | undefined {
		if (!this.episode) return undefined;
		for (const fam of this.episode.families.values()) {
			if (fam.budgetExhausted && fam.exhaustedExactKeys.has(attemptKey)) {
				return fam;
			}
		}
		return undefined;
	}

	/**
	 * Mark a successful tool execution.
	 *
	 * Clears the active family ONLY when the successful tool matches the
	 * active family's last-failure toolName. This is a structural check —
	 * it relies on the fact that a successful execution of the same tool
	 * implies the underlying failure mode for that family has been
	 * resolved. If a different tool succeeds (e.g. `read_files` succeeds
	 * while the active family is `run_commands:ENOENT`), the active
	 * family's pressure is preserved: incidental diagnostic successes do
	 * NOT erase recovery pressure.
	 *
	 * Cross-family exhaustion (a non-active family that has already
	 * exhausted its budget) is intentionally not cleared here either;
	 * only `resetEpisode()` clears it.
	 */
	recordToolSuccess(toolName: string): { state: RecoveryState; clearedFamily?: string } {
		if (!this.episode) return { state: "idle" };
		const fam = this.activeFamilyState();
		// Only clear when the success is structurally attributable to
		// the active family. If there is no active family or the tool
		// names differ, the success is incidental — preserve the
		// episode and return without state change.
		if (!fam || fam.lastFailure?.toolName !== toolName) {
			return { state: this.state };
		}
		const previousState = this.state;
		const cleared = this.resetActiveFamily();
		const newState = this.state;
		if (cleared && previousState !== newState) {
			this.notifyWith(previousState, newState, this.repairAttempts);
			// Projected: this is the public surface, so the privacy
			// contract requires the diagnostic form, not the raw
			// control family.
			return { state: newState, clearedFamily: this.projectControlFamily(fam.family) };
		}
		return { state: newState };
	}

	/**
	 * Reset only the currently active family. Exhausted families in the same
	 * episode remain blocked. Returns `true` if a family was cleared.
	 */
	resetActiveFamily(): boolean {
		if (!this.episode) return false;
		const fam = this.activeFamilyState();
		if (!fam) return false;
		// Clear the family's own exact-key bookkeeping. Episode-wide
		// `blockedExactKeys` is intentionally NOT pruned here because
		// those keys belong to the runtime's pre-execution policy, not
		// to any specific family — clearing the family should not undo
		// an explicit runtime decision to block a known-loop key.
		this.episode.families.delete(fam.family);
		if (this.episode.activeFamily === fam.family) {
			this.episode.activeFamily = undefined;
		}
		return true;
	}

	/**
	 * Reset the entire episode. Intended for user-input boundaries / new runs.
	 * Returns `true` if there was an episode to reset.
	 */
	resetEpisode(): boolean {
		if (!this.episode) {
			if (this.state !== "idle") this.notifyWith("circuit_open", "idle", 0);
			return false;
		}
		const previousState = this.state;
		this.episode = null;
		this.circuitNoticeCount = 0;
		this.controlFamilyToDiagnostic.clear();
		this.controlKeyToDiagnostic.clear();
		if (previousState !== "idle") {
			this.notifyWith(previousState, "idle", 0);
		}
		return true;
	}

	/** Backwards-compatible alias for older callers / tests. */
	reset(): boolean {
		return this.resetEpisode();
	}

	// -------------------------------------------------------------------------
	// Query API
	// -------------------------------------------------------------------------

	// -------------------------------------------------------------------------
	// Typed-identity overloads — production privacy contract
	//
	// These overloads MUST be used by the runtime wiring layer (Stage 4)
	// to satisfy the privacy contract. They:
	//
	//   1. Store the canonical control family / control key in the
	//      tracker's internal Sets/Maps. Equality is over the full
	//      canonical form, not the 32-bit diagnostic projection, so a
	//      32-bit birthday collision cannot make one tool attempt
	//      inherit another attempt's recovery state.
	//
	//   2. Populate the identity-projection maps so that
	//      `snapshot()`, `getBlockedFamilies()`, and
	//      `notifyWith()` automatically translate stored labels to
	//      8-char FNV-1a hex on the way out. Raw canonical tool input
	//      therefore never appears in telemetry, runtime events, or
	//      host projections.
	//
	// API split:
	//   - PUBLIC_MUTATION / ENFORCEMENT API: the typed-identity
	//     overloads (`*Identity` methods) below. These are what the
	//     runtime wiring layer MUST call. They populate the identity
	//     projection maps.
	//   - PRIVATE / INTERNAL MECHANICS: the `*Control` methods. They
	//     take and return raw control strings. They are private so the
	//     runtime cannot bypass the typed identity contract from
	//     outside the package. Their return values are projected before
	//     they reach the public surface.
	// -------------------------------------------------------------------------

	/**
	 * Typed-identity variant of `recordFailureControl`. Stores the
	 * canonical control family and control key; populates the
	 * privacy-projection maps. Runtime wiring MUST use this overload.
	 */
	recordFailureIdentity(
		family: ToolFamilyIdentity,
		attempt: ToolAttemptIdentity,
		fingerprint: ToolFailureFingerprint,
	) {
		this.controlFamilyToDiagnostic.set(family.controlFamily, family.diagnosticFamily);
		this.controlKeyToDiagnostic.set(attempt.controlKey, attempt.diagnosticId);
		return this.recordFailureControl(family.controlFamily, attempt.controlKey, fingerprint);
	}

	/**
	 * Typed-identity variant of `isExactBlockedControl`. Looks up the
	 * canonical control key in the tracker's internal Sets. This is
	 * the public query API for the exact-block breaker.
	 */
	isExactBlockedIdentity(attempt: ToolAttemptIdentity): boolean {
		this.controlKeyToDiagnostic.set(attempt.controlKey, attempt.diagnosticId);
		return this.isExactBlockedControl(attempt.controlKey);
	}

	/**
	 * Typed-identity variant of `markExactBlockedControl`. Records an
	 * attempt key as blocked without any preceding failure (e.g.
	 * host-level pre-emptive deny). This is the public mutation API.
	 */
	markExactBlockedIdentity(attempt: ToolAttemptIdentity): void {
		this.controlKeyToDiagnostic.set(attempt.controlKey, attempt.diagnosticId);
		this.markExactBlockedControl(attempt.controlKey);
	}

	/**
	 * Typed-identity variant of `recordBlockedAttemptControl`. Routes
	 * the runtime's blocked-attempt observation into the tracker; the
	 * returned `family` is already projected to 8-char FNV-1a hex.
	 */
	recordBlockedAttemptIdentity(attempt: ToolAttemptIdentity) {
		this.controlKeyToDiagnostic.set(attempt.controlKey, attempt.diagnosticId);
		return this.recordBlockedAttemptControl(attempt.controlKey);
	}

	getBlockedFamilies(): string[] {
		if (!this.episode) return [];
		const result: string[] = [];
		for (const fam of this.episode.families.values()) {
			// A family is considered "blocked" once its repair budget is
			// exhausted (`budgetExhausted`). This is the same predicate
			// that `isExactBlocked` consults: the pre-execution breaker
			// will return true for any exact key the family has observed.
			if (fam.budgetExhausted) {
				result.push(this.projectControlFamily(fam.family));
			}
		}
		return result;
	}

	/**
	 * DEBUG / QUERY API. Returns true if the given control family is
	 * budget-exhausted. Accepts the raw control family because the
	 * caller is the runtime wiring layer that already holds the
	 * `ToolFamilyIdentity.controlFamily` from the classifier output;
	 * passing it back is cheaper than reconstructing the identity.
	 *
	 * Not intended for telemetry emission. Use `snapshot()` or
	 * `getBlockedFamilies()` (both projected) for that.
	 */
	isFamilyBlocked(family: string): boolean {
		if (!this.episode) return false;
		const fam = this.episode.families.get(family);
		if (!fam) return false;
		return fam.budgetExhausted;
	}

	/**
	 * DEBUG / QUERY API. Returns the raw control family of the active
	 * `FamilyState`, or undefined when no family is active. Like
	 * `isFamilyBlocked`, this returns the storage key because the
	 * caller needs it for cross-family operations; it is not intended
	 * for telemetry.
	 */
	activeFamily(): string | undefined {
		return this.episode?.activeFamily;
	}

	circuitNoticeCountForEpisode(): number {
		return this.circuitNoticeCount;
	}

	// -------------------------------------------------------------------------
	// Event subscription
	// -------------------------------------------------------------------------

	onStateChange(cb: RecoveryStateChangeCallback): () => void {
		this.callbacks.push(cb);
		return () => {
			const i = this.callbacks.indexOf(cb);
			if (i !== -1) this.callbacks.splice(i, 1);
		};
	}

	// -------------------------------------------------------------------------
	// Internals
	// -------------------------------------------------------------------------

	private ensureEpisode(): Episode {
		if (!this.episode) {
			this.episode = {
				episodeId: `recovery_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
				startedAtIteration: 0,
				families: new Map(),
				blockedExactKeys: new Set(),
			};
			this.circuitNoticeCount = 0;
		}
		return this.episode;
	}

	private activeFamilyState(): FamilyState | undefined {
		if (!this.episode?.activeFamily) return undefined;
		return this.episode.families.get(this.episode.activeFamily);
	}

	private blankFamily(family: string): FamilyState {
		return {
			family,
			failureObservations: 0,
			repairAttempts: 0,
			equivalentRepeats: 0,
			exhaustedExactKeys: new Map(),
			budgetExhausted: false,
			circuitTripped: false,
		};
	}

	private notifyWith(prev: RecoveryState, curr: RecoveryState, repairAttempts: number, failureFamily?: string): void {
		if (prev === curr) return;
		const active = this.activeFamilyState();
		const event: RecoveryStateChangeEvent = {
			previousState: prev,
			currentState: curr,
			repairAttempts,
			failureClass: active?.lastFailure?.failureClass as ToolFailureClass | undefined,
			toolName: active?.lastFailure?.toolName,
			failureFamily: failureFamily !== undefined
				? this.projectControlFamily(failureFamily)
				: active !== undefined
					? this.projectControlFamily(active.family)
					: undefined,
			recoveryEpisode: this.episode?.episodeId ?? null,
		};
		for (const cb of this.callbacks) {
			try {
				cb(event);
			} catch {
				/* swallow subscriber errors to keep recovery control flow alive */
			}
		}
	}
}
