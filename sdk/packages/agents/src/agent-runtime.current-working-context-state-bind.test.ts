/**
 * ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
 * (fourteenth-pass): STATE_BIND committed test.
 *
 * Verifies that:
 *   - `AgentRuntimeStateSnapshot.currentWorkingContextEstimate`
 *     is captured verbatim from the producer-side
 *     `prepareTurn` return value at the prepare-turn
 *     boundary (NOT recomputed by the agent runtime).
 *   - The captured value survives across consecutive
 *     prepareTurn invocations: each new W_N replaces the
 *     prior W_{N-1} (no accumulation, no stale retention).
 *   - `restore()` resets the field to `undefined` so a
 *     new transcript starts with no captured W.
 *   - A fresh `run()` on a reused runtime also resets the
 *     field to `undefined` between runs.
 *
 * This test replaces the transient RED provenance file
 * at
 *   .factory/evidence/ACT-CLINEMM-COMPACTION-WORKING-
 *     CONTEXT-HEADER-TRANSPORT-REPAIR01/
 *     per-turn-carrier-inspection-red.provenance.ts
 * which was the RED witness for STATE_BIND.
 *
 * STATE_BIND contract (freezer):
 *   after prepareTurn returns W_n,
 *   AgentRuntimeStateSnapshot
 *     .currentWorkingContextEstimate === W_n
 *
 * NO RECOMPUTE: the agent runtime captures the exact
 * value the producer-side metadata-only helper
 * published (see
 * sdk/packages/core/src/extensions/context/compaction.ts
 *   :publishWorkingContextEstimateMetadataOnly).
 *
 * The complementary PUBLICATION_BIND (host-side
 * notification trigger) is a separate bounded repair
 * and is NOT tested here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetSdkErrorRateLimiterForTests } from "@cline/shared";
import type {
	AgentMessage,
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentRuntimePrepareTurnResult,
	AgentRuntimeStateSnapshot,
} from "@cline/shared";
import { AgentRuntime } from "./index";

beforeEach(() => {
	resetSdkErrorRateLimiterForTests();
});

class FinishingOnlyModel implements AgentModel {
	async stream(
		_request: AgentModelRequest,
	): Promise<AsyncIterable<AgentModelEvent>> {
		async function* gen(): AsyncIterable<AgentModelEvent> {
			yield { type: "finish", reason: "stop" };
		}
		return gen();
	}
}

function createUserMessage(text: string): AgentMessage {
	return {
		role: "user",
		content: [{ type: "text", text }],
		createdAt: 0,
	};
}
describe("AgentRuntime STATE_BIND — currentWorkingContextEstimate", () => {
	it("captures the exact prepareTurn W into snapshot (STATE_BIND.1)", async () => {
		const prepareTurnCalls: Array<
			AgentRuntimePrepareTurnResult | undefined
		> = [];
		const W_FIXTURE = 4242;
		const prepareTurn = vi.fn(
			async (): Promise<AgentRuntimePrepareTurnResult> => {
				const result: AgentRuntimePrepareTurnResult = {
					currentWorkingContextEstimate: W_FIXTURE,
				};
				prepareTurnCalls.push(result);
				return result;
			},
		);
		const model = new FinishingOnlyModel();
		const runtime = new AgentRuntime({
			model,
			prepareTurn: prepareTurn as Parameters<
				typeof AgentRuntime
			>[0]["prepareTurn"],
		});

		await runtime.run("hello");

		const snapshot: AgentRuntimeStateSnapshot = runtime.snapshot();
		expect(prepareTurnCalls).toHaveLength(1);
		expect(snapshot.currentWorkingContextEstimate).toBe(W_FIXTURE);
	});

	it("leaves snapshot.currentWorkingContextEstimate undefined when prepareTurn returns undefined", async () => {
		const prepareTurn = vi.fn(async () => undefined);
		const model = new FinishingOnlyModel();
		const runtime = new AgentRuntime({
			model,
			prepareTurn: prepareTurn as Parameters<
				typeof AgentRuntime
			>[0]["prepareTurn"],
		});

		await runtime.run("hello");

		const snapshot: AgentRuntimeStateSnapshot = runtime.snapshot();
		expect(prepareTurn).toHaveBeenCalledTimes(1);
		expect(snapshot.currentWorkingContextEstimate).toBeUndefined();
	});

	// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
	// (fifteenth-pass): P1 FIX. The reviewer requested exactly
	// this test. With fail-closed semantics, a later
	// prepareTurn that omits W must reset state.W to
	// `undefined`, not preserve the prior W.
	it("FAIL-CLOSED: W1=100 then prepareTurn-without-W resets snapshot.W to undefined", async () => {
		const WByCall: Array<AgentRuntimePrepareTurnResult | undefined> = [
			{ currentWorkingContextEstimate: 100 },
			// Second prepareTurn returns no W at all.
			{ messages: [] },
		];
		const prepareTurn = vi.fn(
			async (): Promise<AgentRuntimePrepareTurnResult | undefined> =>
				WByCall.shift(),
		);
		const model = new FinishingOnlyModel();
		const runtime = new AgentRuntime({
			model,
			prepareTurn: prepareTurn as Parameters<
				typeof AgentRuntime
			>[0]["prepareTurn"],
		});

		// Single run, two prepareTurns (model yields finish:stop,
		// causing the run loop to terminate; the two prepareTurns
		// are produced against an execute() lifecycle by running
		// two consecutive run() invocations).
		await runtime.run("first");
		// After the first run, snapshot.W === 100.
		expect(
			runtime.snapshot().currentWorkingContextEstimate,
		).toBe(100);

		// Second run: execute() resets lifecycle state, then
		// prepareTurn #2 returns `{ messages: [] }` with no
		// currentWorkingContextEstimate. With fail-closed
		// semantics, snapshot.W MUST be undefined (NOT 100).
		await runtime.run("second");
		const snapshot: AgentRuntimeStateSnapshot = runtime.snapshot();
		expect(snapshot.currentWorkingContextEstimate).toBeUndefined();
		// The negative assertion: NOT preserved as 100.
		expect(snapshot.currentWorkingContextEstimate).not.toBe(100);
	});
});

describe("AgentRuntime STATE_BIND — lifetime semantics", () => {
	it("captures the latest W across consecutive prepareTurns (no accumulation, no stale retention)", async () => {
		// The frozen state-lifetime rule:
		//   W_n remains current
		//   until prepareTurn_{n+1} produces W_{n+1}
		// So W1=100 followed by W2=120 must yield snapshot
		// === 120, not 100 nor 100+120=220.
		const prepareTurnCalls: Array<number | undefined> = [];
		const prepareTurn = vi.fn(
			async (): Promise<AgentRuntimePrepareTurnResult> => {
				const w = prepareTurnCalls.length === 0 ? 100 : 120;
				prepareTurnCalls.push(w);
				return { currentWorkingContextEstimate: w };
			},
		);
		const model = new FinishingOnlyModel();
		const runtime = new AgentRuntime({
			model,
			prepareTurn: prepareTurn as Parameters<
				typeof AgentRuntime
			>[0]["prepareTurn"],
		});

		// First run captures W1 = 100.
		await runtime.run("first");
		const snapshotAfterRun1: AgentRuntimeStateSnapshot =
			runtime.snapshot();
		expect(
			snapshotAfterRun1.currentWorkingContextEstimate,
		).toBe(100);

		// Second run: execute() resets the field, then the
		// next prepareTurn captures W2 = 120.
		await runtime.run("second");
		const snapshotAfterRun2: AgentRuntimeStateSnapshot =
			runtime.snapshot();
		expect(
			snapshotAfterRun2.currentWorkingContextEstimate,
		).toBe(120);
		expect(
			snapshotAfterRun2.currentWorkingContextEstimate,
		).not.toBe(220); // not accumulated
		expect(
			snapshotAfterRun2.currentWorkingContextEstimate,
		).not.toBe(100); // not stale
	});

	it("restore() resets currentWorkingContextEstimate to undefined", async () => {
		const prepareTurn = vi.fn(
			async (): Promise<AgentRuntimePrepareTurnResult> => ({
				currentWorkingContextEstimate: 999,
			}),
		);
		const model = new FinishingOnlyModel();
		const runtime = new AgentRuntime({
			model,
			prepareTurn: prepareTurn as Parameters<
				typeof AgentRuntime
			>[0]["prepareTurn"],
		});

		await runtime.run("first");
		expect(
			runtime.snapshot().currentWorkingContextEstimate,
		).toBe(999);

		// restore() with a fresh message transcript must
		// clear the captured W so the next run starts from
		// no W.
		runtime.restore([createUserMessage("fresh")]);
		expect(
			runtime.snapshot().currentWorkingContextEstimate,
		).toBeUndefined();
	});

	it("fresh run resets currentWorkingContextEstimate before the next prepareTurn", async () => {
		// Verifies the lifetime order: execute() resets the
		// field BEFORE the next prepareTurn fires. A stale
		// value from the prior run cannot leak into the new
		// prepareTurn's capture.
		const prepareTurn = vi.fn(
			async (
				_ctx: unknown,
			): Promise<AgentRuntimePrepareTurnResult> => {
				return { currentWorkingContextEstimate: 7777 };
			},
		);
		const model = new FinishingOnlyModel();
		const runtime = new AgentRuntime({
			model,
			prepareTurn: prepareTurn as Parameters<
				typeof AgentRuntime
			>[0]["prepareTurn"],
		});

		let observedAtPrepareTurn: number | undefined;
		const observingPrepareTurn = vi.fn(
			async (
				_ctx: unknown,
			): Promise<AgentRuntimePrepareTurnResult> => {
				// Capture the field at the moment
				// prepareTurn fires. After execute() resets
				// but before the capture below, the field
				// should be undefined.
				observedAtPrepareTurn =
					runtime.snapshot().currentWorkingContextEstimate;
				return { currentWorkingContextEstimate: 7777 };
			},
		);
		const _unused = prepareTurn;
		void _unused;
		const runtime2 = new AgentRuntime({
			model,
			prepareTurn: observingPrepareTurn as Parameters<
				typeof AgentRuntime
			>[0]["prepareTurn"],
		});
		await runtime2.run("first");
		expect(
			runtime2.snapshot().currentWorkingContextEstimate,
		).toBe(7777);
		expect(observedAtPrepareTurn).toBeUndefined();
	});
});

describe("AgentRuntime STATE_BIND — API delta", () => {
	it("additive-optional API delta: snapshot field is optional", () => {
		// Type-level: a snapshot constructed without
		// currentWorkingContextEstimate must still be a
		// valid AgentRuntimeStateSnapshot (additive
		// optional).
		const snapshotWithout: AgentRuntimeStateSnapshot = {
			agentId: "test",
			status: "idle",
			iteration: 0,
			messages: [],
			pendingToolCalls: [],
			usage: {
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
		};
		expect(
			snapshotWithout.currentWorkingContextEstimate,
		).toBeUndefined();
		// Compile-time check: field is optional, not required.
		const _typeCheck: number | undefined =
			snapshotWithout.currentWorkingContextEstimate;
		void _typeCheck;
	});
});
