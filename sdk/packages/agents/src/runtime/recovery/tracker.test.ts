import { describe, expect, it, vi, beforeEach } from "vitest";
import { RecoveryTracker } from "./tracker";
import {
	createAttemptIdentity,
	createFamilyIdentity,
	fingerprintToolFailure,
	type ToolAttemptIdentity,
	type ToolFamilyIdentity,
} from "./fingerprint";
import { DEFAULT_RECOVERY_POLICY } from "./policy";

const makeFingerprint = (overrides: Partial<{
	toolName: string;
	failureClass: string;
	stableCode: string;
	iteration: number;
	toolCallId: string;
	exactKey?: string;
}> = {}) => fingerprintToolFailure(
	overrides.toolName ?? "run_commands",
	overrides.failureClass ?? "tool_execution_error",
	(overrides.stableCode ?? "ENOENT") as any,
	overrides.iteration ?? 1,
	overrides.toolCallId ?? `call_${Math.random().toString(36).slice(2, 8)}`,
);

/**
 * Construct a typed two-track family identity for tests. Tests use
 * this everywhere a family is needed; the storage key (controlFamily)
 * is for internal tracker queries, and the diagnosticFamily is for
 * snapshot/event projection queries.
 */
const family = (toolName: string, stableCode: string = "ENOENT"): ToolFamilyIdentity =>
	createFamilyIdentity(toolName, "tool_execution_error", stableCode);

/**
 * Construct a typed two-track attempt identity for tests. The
 * canonical control key is the (toolName, exactKey) tuple encoded
 * by `createAttemptIdentity`; the diagnosticId is the 8-char hex
 * projection the snapshot/event surface will emit.
 */
const attempt = (toolName: string, exactKey: string): ToolAttemptIdentity =>
	createAttemptIdentity(toolName, { exactKey });

interface DriveStep {
	previousState: string;
	newState: string;
	nextEquivalentAttemptAllowed: boolean;
	repairAttempts: number;
	failureObservations: number;
	noticeEmitted: boolean;
}

function drive(
	tracker: RecoveryTracker,
	n: number,
	opts: { family?: ToolFamilyIdentity; exactKey?: string; toolName?: string } = {},
): DriveStep[] {
	const out: DriveStep[] = [];
	const fam = opts.family ?? family("run_commands");
	const exactKey = opts.exactKey ?? `key_${Math.random().toString(36).slice(2, 6)}`;
	const a = attempt(opts.toolName ?? fam.toolName, exactKey);
	for (let i = 1; i <= n; i++) {
		const fp = makeFingerprint({ iteration: i, toolCallId: `call_${i}` });
		out.push(tracker.recordFailureIdentity(fam, a, fp));
	}
	return out;
}

/**
 * Convenience helper: drive `n` failures into the same family using
 * a fixed exact key. Returns both the per-step records AND the
 * typed identities (so subsequent `recordBlockedAttemptIdentity`
 * calls have the real identity the tracker recorded, not a synthetic
 * one).
 */
function drivePinned(
	tracker: RecoveryTracker,
	n: number,
	opts: { family?: ToolFamilyIdentity; exactKey?: string; toolName?: string } = {},
): { steps: DriveStep[]; family: ToolFamilyIdentity; attempt: ToolAttemptIdentity } {
	const fam = opts.family ?? family("run_commands");
	const exactKey = opts.exactKey ?? `key_${Math.random().toString(36).slice(2, 6)}`;
	const a = attempt(opts.toolName ?? fam.toolName, exactKey);
	const steps: DriveStep[] = [];
	for (let i = 1; i <= n; i++) {
		const fp = makeFingerprint({ iteration: i, toolCallId: `call_${i}` });
		steps.push(tracker.recordFailureIdentity(fam, a, fp));
	}
	return { steps, family: fam, attempt: a };
}

describe("RecoveryTracker", () => {
	let tracker: RecoveryTracker;
	beforeEach(() => { tracker = new RecoveryTracker(); });

	describe("initial state", () => {
		it("starts in idle state", () => {
			expect(tracker.state).toBe("idle");
			expect(tracker.repairAttempts).toBe(0);
			expect(tracker.equivalentRepeats).toBe(0);
			expect(tracker.getBlockedFamilies()).toEqual([]);
		});
		it("snapshot reflects idle state", () => {
			const snap = tracker.snapshot();
			expect(snap.state).toBe("idle");
			expect(snap.currentRepairAttempts).toBe(0);
			expect(snap.blockedFamilies).toEqual([]);
			expect(snap.blockedExactKeys).toEqual([]);
		});
	});

	describe("recordFailure transition behavior", () => {
		it("records the original failure as recovering with 0 repairs", () => {
			const steps = drive(tracker, 1);
			expect(steps).toHaveLength(1);
			const step = steps[0];
			expect(step.newState).toBe("recovering");
			expect(step.repairAttempts).toBe(0);
			expect(step.failureObservations).toBe(1);
			expect(step.nextEquivalentAttemptAllowed).toBe(true);
		});
		it("incrementing repair counts within budget stays in recovering", () => {
			const steps = drive(tracker, 2);
			expect(steps[0].newState).toBe("recovering");
			expect(steps[0].repairAttempts).toBe(0);
			expect(steps[0].failureObservations).toBe(1);
			expect(steps[1].newState).toBe("recovering");
			expect(steps[1].repairAttempts).toBe(1);
			expect(steps[1].failureObservations).toBe(2);
		});
		it("crossing the budget threshold transitions to warning", () => {
			const steps = drive(tracker, 3);
			const step = steps[2];
			expect(step.newState).toBe("warning");
			expect(step.repairAttempts).toBe(2);
			expect(step.failureObservations).toBe(3);
		});
	});

	describe("pre-execution exact breaker", () => {
		it("flags the exact key as blocked once the budget is exhausted", () => {
			const fam = family("run_commands");
			const a = attempt("run_commands", "k_exact_repeat_lock");
			drive(tracker, 3, { family: fam, exactKey: "k_exact_repeat_lock" });
			expect(tracker.state).toBe("warning");
			expect(tracker.isFamilyBlocked(fam.controlFamily)).toBe(true);
			expect(tracker.isExactBlockedIdentity(a)).toBe(true);
		});
		it("transitions to circuit_open only when recordBlockedAttempt claims the attempt", () => {
			const { family: fam, attempt: a } = drivePinned(tracker, 3, { exactKey: "k_block_transition" });
			expect(tracker.state).toBe("warning");
			const r = tracker.recordBlockedAttemptIdentity(a);
			expect(r.previousState).toBe("warning");
			expect(r.newState).toBe("circuit_open");
			// The result.family is the projected diagnostic ID.
			expect(r.family).toBe(fam.diagnosticFamily);
			expect(tracker.state).toBe("circuit_open");
		});
	});

	describe("budget recovery policy", () => {
		it("respects a custom RepairAttempts budget (state per iteration)", () => {
			const max = 4;
			const t = new RecoveryTracker({ maxRepairAttempts: max, warningThreshold: max });
			const fam = family("run_commands");
			const records: number[] = [];
			const newStates: string[] = [];
			for (let i = 0; i < max + 1; i++) {
				const a = attempt("run_commands", `k_${i}`);
				const r = t.recordFailureIdentity(fam, a, makeFingerprint({ iteration: i + 1, toolCallId: `c_${i}` }));
				records.push(r.repairAttempts);
				newStates.push(r.newState);
			}
			expect(records).toEqual([0, 1, 2, 3, 4]);
			expect(newStates).toEqual(["recovering", "recovering", "recovering", "recovering", "warning"]);
			expect(t.state).toBe("warning");
		});
	});

	describe("C1.3 full state proof", () => {
		it("bounded executor count + warning → circuit_open transition only on interception", () => {
			const max = 2;
			const t = new RecoveryTracker();
			const fam = family("run_commands");
			const a = attempt("run_commands", "k_exact_c1_3");

			const events: { previousState: string; currentState: string; repairAttempts: number }[] = [];
			t.onStateChange((ev) => events.push({
				previousState: ev.previousState,
				currentState: ev.currentState,
				repairAttempts: ev.repairAttempts,
			}));

			let executorCalls = 0;

			for (let i = 1; i <= 1 + max; i++) {
				if (t.isExactBlockedIdentity(a)) {
					throw new Error(`pre-exec breaker fired too early at attempt ${i}`);
				}
				executorCalls++;
				t.recordFailureIdentity(fam, a, makeFingerprint({ iteration: i, toolCallId: `c_${i}` }));
			}

			expect(executorCalls).toBe(1 + max);
			expect(t.state).toBe("warning");
			expect(t.isFamilyBlocked(fam.controlFamily)).toBe(true);
			expect(t.isExactBlockedIdentity(a)).toBe(true);
			expect(t.circuitNoticeCountForEpisode()).toBe(0);
			expect(t.repairAttempts).toBe(max);

			if (!t.isExactBlockedIdentity(a)) {
				throw new Error("pre-exec breaker should be true after budget exhausted");
			}
			const blockResult = t.recordBlockedAttemptIdentity(a);
			expect(blockResult.previousState).toBe("warning");
			expect(blockResult.newState).toBe("circuit_open");
			expect(blockResult.family).toBe(fam.diagnosticFamily);
			expect(blockResult.noticeEmitted).toBe(true);
			expect(t.state).toBe("circuit_open");
			expect(t.circuitNoticeCountForEpisode()).toBe(1);

			const blockAgain = t.recordBlockedAttemptIdentity(a);
			expect(blockAgain.previousState).toBe("circuit_open");
			expect(blockAgain.newState).toBe("circuit_open");
			expect(blockAgain.noticeEmitted).toBe(false);
			expect(t.circuitNoticeCountForEpisode()).toBe(1);

			expect(executorCalls).toBe(1 + max);

			const warningToCircuit = events.filter(
				(e) => e.previousState === "warning" && e.currentState === "circuit_open",
			);
			expect(warningToCircuit).toHaveLength(1);
			expect(warningToCircuit[0].repairAttempts).toBe(max);
		});
	});

	describe("multi-family attribution", () => {
		it("independent family latches: A exhausts, B is unaffected", () => {
			const A = family("run_commands");
			const B = family("read_files", "ENOENT");
			drive(tracker, 3, { family: A });
			expect(tracker.isFamilyBlocked(A.controlFamily)).toBe(true);
			expect(tracker.state).toBe("warning");
			drive(tracker, 1, { family: B });
			expect(tracker.isFamilyBlocked(A.controlFamily)).toBe(true);
			expect(tracker.isFamilyBlocked(B.controlFamily)).toBe(false);
		});
		it("preserves exhaustion across re-observation of an already-blocked family", () => {
			const A = family("run_commands");
			const B = family("read_files", "ENOENT");
			drive(tracker, 3, { family: A });
			drive(tracker, 1, { family: B });
			drive(tracker, 3, { family: A });
			drive(tracker, 1, { family: B });
			expect(tracker.isFamilyBlocked(A.controlFamily)).toBe(true);
			expect(tracker.isFamilyBlocked(B.controlFamily)).toBe(false);
		});
		it("multi-family episodes extend, not replace, the active family list", () => {
			const A = family("run_commands");
			const B = family("read_files", "ENOENT");
			drive(tracker, 3, { family: A });
			drive(tracker, 1, { family: B });
			expect(tracker.getBlockedFamilies()).toContain(A.diagnosticFamily);
		});

		describe("equivalent-repeat counting", () => {
			it("counts a second occurrence of the same exact key as equivalent repeat", () => {
				const fam = family("run_commands");
				tracker.recordFailureIdentity(fam, attempt("run_commands", "k_eq"), makeFingerprint({ iteration: 1, toolCallId: "c1" }));
				expect(tracker.equivalentRepeats).toBe(0);
				tracker.recordFailureIdentity(fam, attempt("run_commands", "k_eq"), makeFingerprint({ iteration: 2, toolCallId: "c2" }));
				expect(tracker.equivalentRepeats).toBe(1);
			});
		});

		describe("isExactBlocked consults family circuit latch, not just blockedExactKeys", () => {
			it("returns true when the family is exhausted and the key was observed", () => {
				const fam = family("run_commands");
				tracker.recordFailureIdentity(fam, attempt("run_commands", "k1"), makeFingerprint({ iteration: 1, toolCallId: "c1" }));
				expect(tracker.isExactBlockedIdentity(attempt("run_commands", "k1"))).toBe(false);
			});
			it("returns true after budget exhausted for an observed key", () => {
				const fam = family("run_commands");
				drive(tracker, 3, { family: fam, exactKey: "k_budget_exhausted" });
				expect(tracker.state).toBe("warning");
				expect(tracker.isExactBlockedIdentity(attempt("run_commands", "k_budget_exhausted"))).toBe(true);
			});
			it("returns true for keys observed only via episode-level markExactBlocked", () => {
				const fam = family("run_commands");
				tracker.recordFailureIdentity(fam, attempt("run_commands", "kZ"), makeFingerprint({ iteration: 1, toolCallId: "cZ" }));
				tracker.markExactBlockedIdentity(attempt("run_commands", "k_pre"));
				expect(tracker.isExactBlockedIdentity(attempt("run_commands", "k_pre"))).toBe(true);
			});
			it("returns true via the family circuit latch for an attempt key", () => {
				const fam = family("run_commands");
				drive(tracker, 3, { family: fam, exactKey: "k_via_circuit" });
				expect(tracker.isExactBlockedIdentity(attempt("run_commands", "k_via_circuit"))).toBe(true);
			});
			it("returns false for keys not in the breaker", () => {
				expect(tracker.isExactBlockedIdentity(attempt("run_commands", "Y"))).toBe(false);
			});
		});

		describe("multi-family active family re-anchoring", () => {
			it("family-hop interception re-anchors activeFamily to the exhausted owner", () => {
				const A = family("run_commands");
				const B = family("read_files", "ENOENT");
				drive(tracker, 3, { family: A, exactKey: "keyA" });
				expect(tracker.isFamilyBlocked(A.controlFamily)).toBe(true);
				expect(tracker.isExactBlockedIdentity(attempt("run_commands", "keyA"))).toBe(true);

				// B becomes active but is not budget-exhausted.
				tracker.recordFailureIdentity(B, attempt("read_files", "kB"), makeFingerprint({ iteration: 4, toolCallId: "cB" }));
				expect(tracker.isExactBlockedIdentity(attempt("run_commands", "keyA"))).toBe(true);

				const events: { previousState: string; currentState: string; failureFamily?: string }[] = [];
				tracker.onStateChange((ev) => events.push(ev));

				const blocked = tracker.recordBlockedAttemptIdentity(attempt("run_commands", "keyA"));
				expect(blocked.previousState).toBe("recovering");
				expect(blocked.newState).toBe("circuit_open");
				expect(blocked.family).toBe(A.diagnosticFamily);
				expect(blocked.noticeEmitted).toBe(true);

				expect(tracker.state).toBe("circuit_open");
				expect(tracker.activeFamily()).toBe(A.controlFamily);
				const snap = tracker.snapshot();
				expect(snap.state).toBe("circuit_open");
				expect(snap.currentFailureFamily).toBe(A.diagnosticFamily);
				expect(snap.currentRepairAttempts).toBe(2);

				const interceptionEvents = events.filter(
					(e) => e.previousState !== "circuit_open" && e.currentState === "circuit_open",
				);
				expect(interceptionEvents).toHaveLength(1);
				expect(interceptionEvents[0].failureFamily).toBe(A.diagnosticFamily);

				expect(tracker.isFamilyBlocked(B.controlFamily)).toBe(false);
			});

			it("blocks the budget-exhausted owner, not a non-exhausted family that also saw the key", () => {
				// CORRECTION.3 attribution invariant: when the same
				// (toolName, canonical input) attempt is observed by
				// two independent families, the block must resolve to
				// the budget-exhausted owner regardless of insertion
				// order.
				//
				// Critical structural assertions: A and B MUST be
				// distinct FamilyState entries in the episode's
				// families Map. The only knob that distinguishes
				// FamilyStates is `controlFamily`, which is
				// `(toolName, failureClass, stableCode)`. Vary
				// stableCode between A and B to keep them independent,
				// and use the same canonical input for the attempt so
				// both observations land on the same `controlKey`.
				const A = family("run_commands", "EACCES");
				const B = family("run_commands", "ENOENT");
				expect(A.controlFamily).not.toBe(B.controlFamily);

				const sharedAttempt = attempt("run_commands", "shared_canonical_input");
				// Also pin the attempt identity is the canonical
				// shared key — a future regression that produces
				// different controlKeys for the "same" input fails
				// here.
				const sharedAttemptAgain = attempt("run_commands", "shared_canonical_input");
				expect(sharedAttempt.controlKey).toBe(sharedAttemptAgain.controlKey);
				expect(sharedAttempt.diagnosticId).toBe(sharedAttemptAgain.diagnosticId);

				// A observes sharedAttempt once — A is NOT
				// budget-exhausted.
				tracker.recordFailureIdentity(
					A,
					sharedAttempt,
					makeFingerprint({ iteration: 1, toolCallId: "cA1" }),
				);
				expect(tracker.isFamilyBlocked(A.controlFamily)).toBe(false);

				// B observes sharedAttempt three times — B IS
				// budget-exhausted.
				drivePinned(tracker, 3, {
					family: B,
					exactKey: "shared_canonical_input",
					toolName: "run_commands",
				});
				expect(tracker.isFamilyBlocked(B.controlFamily)).toBe(true);

				// isExactBlocked must return true (B is exhausted and
				// owns the same controlKey).
				expect(tracker.isExactBlockedIdentity(sharedAttempt)).toBe(true);

				// The runtime asks us to record the interception.
				// Attribution must resolve to B (the budget-exhausted
				// owner), not A (the earlier non-exhausted entry).
				const blocked = tracker.recordBlockedAttemptIdentity(sharedAttempt);
				expect(blocked.family).toBe(B.diagnosticFamily);
				expect(blocked.previousState).toBe("warning");
				expect(blocked.newState).toBe("circuit_open");
				expect(blocked.noticeEmitted).toBe(true);
			});

			it("does NOT attribute a markExactBlocked-only block to an unrelated active family", () => {
				tracker.recordFailureIdentity(
					family("read_files"),
					attempt("read_files", "kB"),
					makeFingerprint({ iteration: 1, toolCallId: "cB1" }),
				);
				expect(tracker.activeFamily()).toBeDefined();
				const activeBefore = tracker.activeFamily();
				expect(activeBefore).toBeDefined();

				tracker.markExactBlockedIdentity(attempt("any_tool", "k_preblocked"));
				expect(tracker.isExactBlockedIdentity(attempt("any_tool", "k_preblocked"))).toBe(true);

				const before = tracker.state;
				const r = tracker.recordBlockedAttemptIdentity(attempt("any_tool", "k_preblocked"));
				expect(r.previousState).toBe(before);
				expect(r.newState).toBe(before);
				expect(r.family).toBeUndefined();
				expect(r.noticeEmitted).toBe(false);
				expect(tracker.state).toBe(before);
				expect(tracker.circuitNoticeCountForEpisode()).toBe(0);
			});
		});
	});

	describe("successful repair reset", () => {
		it("recordToolSuccess clears the active family when toolName matches (within budget)", () => {
			const fam = family("run_commands");
			tracker.recordFailureIdentity(fam, attempt("run_commands", "k1"), makeFingerprint({ iteration: 1, toolCallId: "c1" }));
			expect(tracker.state).toBe("recovering");
			const out = tracker.recordToolSuccess("run_commands");
			expect(out.clearedFamily).toBe(fam.diagnosticFamily);
			expect(tracker.isFamilyBlocked(fam.controlFamily)).toBe(false);
		});
		it("recordToolSuccess with mismatched toolName does NOT clear active pressure (P1 #4)", () => {
			const fam = family("run_commands");
			tracker.recordFailureIdentity(fam, attempt("run_commands", "k1"), makeFingerprint({ iteration: 1, toolCallId: "c1" }));
			const out = tracker.recordToolSuccess("read_files");
			expect(out.clearedFamily).toBeUndefined();
			expect(tracker.state).toBe("recovering");
			expect(tracker.isFamilyBlocked(fam.controlFamily)).toBe(false);
			expect(tracker.activeFamily()).toBe(fam.controlFamily);
		});
		it("recordToolSuccess after exhaustion clears blocked-families view of that family", () => {
			const fam = family("run_commands");
			tracker.recordFailureIdentity(fam, attempt("run_commands", "k1"), makeFingerprint({ iteration: 1, toolCallId: "c1" }));
			tracker.recordFailureIdentity(fam, attempt("run_commands", "k2"), makeFingerprint({ iteration: 2, toolCallId: "c2" }));
			tracker.recordFailureIdentity(fam, attempt("run_commands", "k3"), makeFingerprint({ iteration: 3, toolCallId: "c3" }));
			expect(tracker.state).toBe("warning");
			const out = tracker.recordToolSuccess("run_commands");
			expect(out.clearedFamily).toBe(fam.diagnosticFamily);
			expect(tracker.isFamilyBlocked(fam.controlFamily)).toBe(false);
		});
		it("recordToolSuccess does NOT clear non-active (already-blocked) families", () => {
			const A = family("run_commands");
			const B = family("read_files");
			tracker.recordFailureIdentity(A, attempt("run_commands", "kA1"), makeFingerprint({ iteration: 1, toolCallId: "cA1" }));
			tracker.recordFailureIdentity(A, attempt("run_commands", "kA2"), makeFingerprint({ iteration: 2, toolCallId: "cA2" }));
			tracker.recordFailureIdentity(A, attempt("run_commands", "kA3"), makeFingerprint({ iteration: 3, toolCallId: "cA3" }));
			tracker.recordFailureIdentity(B, attempt("read_files", "kB1"), makeFingerprint({ iteration: 4, toolCallId: "cB1" }));
			expect(tracker.isFamilyBlocked(A.controlFamily)).toBe(true);
			tracker.recordToolSuccess("write_files");
			expect(tracker.isFamilyBlocked(A.controlFamily)).toBe(true);
			expect(tracker.getBlockedFamilies()).toContain(A.diagnosticFamily);
		});
		it("recordToolSuccess on the active family at warning clears the family latch", () => {
			const fam = family("run_commands");
			tracker.recordFailureIdentity(fam, attempt("run_commands", "k1"), makeFingerprint({ iteration: 1, toolCallId: "c1" }));
			tracker.recordFailureIdentity(fam, attempt("run_commands", "k2"), makeFingerprint({ iteration: 2, toolCallId: "c2" }));
			tracker.recordFailureIdentity(fam, attempt("run_commands", "k3"), makeFingerprint({ iteration: 3, toolCallId: "c3" }));
			expect(tracker.state).toBe("warning");
			const out = tracker.recordToolSuccess("run_commands");
			expect(out.clearedFamily).toBe(fam.diagnosticFamily);
			expect(tracker.isFamilyBlocked(fam.controlFamily)).toBe(false);
			expect(tracker.getBlockedFamilies()).not.toContain(fam.diagnosticFamily);
		});
		it("resetEpisode clears the entire episode", () => {
			tracker.recordFailureIdentity(family("run_commands"), attempt("run_commands", "k"), makeFingerprint({ iteration: 1, toolCallId: "c" }));
			tracker.resetEpisode();
			expect(tracker.state).toBe("idle");
			expect(tracker.getBlockedFamilies()).toEqual([]);
			expect(tracker.episodeId).toBeNull();
		});
		it("reset is a backwards-compatible alias for resetEpisode", () => {
			tracker.recordFailureIdentity(family("run_commands"), attempt("run_commands", "k"), makeFingerprint({ iteration: 1, toolCallId: "c" }));
			tracker.reset();
			expect(tracker.state).toBe("idle");
		});
	});

	describe("state change callbacks - captured prev, exact iteration", () => {
		it("emits idle -> recovering on the original failure (call 1, repairs=0)", () => {
			const cb = vi.fn();
			tracker.onStateChange(cb);
			tracker.recordFailureIdentity(family("run_commands"), attempt("run_commands", "k"), makeFingerprint({ iteration: 1, toolCallId: "c1" }));
			expect(cb).toHaveBeenCalledWith(expect.objectContaining({
				previousState: "idle",
				currentState: "recovering",
				repairAttempts: 0,
			}));
			expect(cb).toHaveBeenCalledTimes(1);
		});
		it("emits NO transition on repair #1 (recovering -> recovering)", () => {
			const cb = vi.fn();
			tracker.onStateChange(cb);
			drive(tracker, 2);
			expect(cb).toHaveBeenCalledTimes(1);
		});
		it("emits recovering -> warning on repair #2 (last permitted, budget exhausted)", () => {
			const cb = vi.fn();
			tracker.onStateChange(cb);
			drive(tracker, 3);
			expect(cb).toHaveBeenCalledWith(expect.objectContaining({
				previousState: "recovering",
				currentState: "warning",
				repairAttempts: 2,
			}));
			expect(cb).toHaveBeenCalledTimes(2);
		});
		it("does NOT emit warning -> circuit_open via recordFailure alone", () => {
			const cb = vi.fn();
			tracker.onStateChange(cb);
			drive(tracker, 4);
			expect(cb).toHaveBeenCalledTimes(2);
		});
		it("emits warning -> circuit_open on recordBlockedAttempt, exactly once", () => {
			const cb = vi.fn();
			tracker.onStateChange(cb);
			const { attempt: a } = drivePinned(tracker, 3, { exactKey: "k_block_test" });
			tracker.recordBlockedAttemptIdentity(a);
			expect(cb).toHaveBeenLastCalledWith(expect.objectContaining({
				previousState: "warning",
				currentState: "circuit_open",
				repairAttempts: 2,
			}));
			tracker.recordBlockedAttemptIdentity(a);
			tracker.recordBlockedAttemptIdentity(a);
			const transitions = cb.mock.calls.filter(
				(c) => c[0].previousState === "warning" && c[0].currentState === "circuit_open",
			);
			expect(transitions).toHaveLength(1);
		});
		it("can unsubscribe", () => {
			const cb = vi.fn();
			const unsub = tracker.onStateChange(cb);
			unsub();
			tracker.recordFailureIdentity(family("run_commands"), attempt("run_commands", "k"), makeFingerprint({ iteration: 1, toolCallId: "c1" }));
			expect(cb).not.toHaveBeenCalled();
		});
		it("subscriber exceptions do not break control flow", () => {
			const ok = vi.fn();
			tracker.onStateChange(() => { throw new Error("boom"); });
			tracker.onStateChange(ok);
			tracker.recordFailureIdentity(family("run_commands"), attempt("run_commands", "k"), makeFingerprint({ iteration: 1, toolCallId: "c1" }));
			expect(ok).toHaveBeenCalled();
		});
	});

	describe("circuit notice counter", () => {
		it("is 0 after the budget is exhausted (warning, no interception yet)", () => {
			drivePinned(tracker, 3);
			expect(tracker.state).toBe("warning");
			expect(tracker.circuitNoticeCountForEpisode()).toBe(0);
		});
		it("increments exactly once when the runtime records a blocked attempt", () => {
			const { attempt: a } = drivePinned(tracker, 3);
			const r = tracker.recordBlockedAttemptIdentity(a);
			expect(r.noticeEmitted).toBe(true);
			expect(tracker.circuitNoticeCountForEpisode()).toBe(1);
		});
		it("does not increment on subsequent recordBlockedAttempt for the same key", () => {
			const { attempt: a } = drivePinned(tracker, 3);
			tracker.recordBlockedAttemptIdentity(a);
			tracker.recordBlockedAttemptIdentity(a);
			tracker.recordBlockedAttemptIdentity(a);
			expect(tracker.circuitNoticeCountForEpisode()).toBe(1);
		});
		it("resets on resetEpisode", () => {
			const { attempt: a } = drivePinned(tracker, 3);
			tracker.recordBlockedAttemptIdentity(a);
			tracker.resetEpisode();
			expect(tracker.circuitNoticeCountForEpisode()).toBe(0);
		});
	});
});
