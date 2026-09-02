/**
 * ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
 * twelfth-pass (2026-09-03) — per-turn carrier inspection RED
 *
 * Reviewer: factory causal reviewer + SDK runtime/state
 * engineer (PASS on 47fd3c995; C1:
 * GO_PER_TURN_CARRIER_INSPECTION).
 *
 * Reviewer's stop rule (verbatim):
 *
 *   If source inspection shows no existing event/snapshot
 *   both (a) occurs after every prepareTurn, and (b) can
 *   carry the exact result-local W, then stop with:
 *     CADENCE_CORRECT_EXISTING_CARRIER = ABSENT / PROVEN
 *     NEW_TYPED_PER_TURN_CARRIER       = AUTHORIZED
 *   That is enough. Do not launch another recon essay.
 *
 * Reviewer's RED-after-binding directive (verbatim):
 *
 *   The first true RED should end at the existing
 *   host-facing boundary, not yet at TaskHeader.
 *
 *   Given prepareTurn returns W2,
 *   and no provider response / api_req_started follows,
 *   expected:
 *     host-facing current runtime/session projection
 *     contains W2
 *   actual:
 *     W2 is absent.
 *
 * This file is that RED.
 *
 * Invocation:
 *   bun .factory/evidence/ACT-CLINEMM-COMPACTION-WORKING-
 *     CONTEXT-HEADER-TRANSPORT-REPAIR01/per-turn-carrier-
 *     inspection-red.provenance.ts
 *
 * Expected at the next bounded repair (C2 carrier bind):
 *   status = "GREEN"
 *   W_N = 4242 matches the prepareTurn return value
 *
 * Actual at HEAD = 47fd3c995:
 *   status = "RED"
 *   snapshot.currentWorkingContextEstimate is undefined
 *   (no field on AgentRuntimeStateSnapshot;
 *    agent-runtime.ts:1738-1770 discards W after
 *    prepareTurnForModelRequest).
 */// Carrier inspection table (source topology):
//
//   +------------------------------------+----------+----------------+--------------+--------------+------------+
//   | candidate seam                     | after    | receives       | agents->core?| core->host?  | verdict    |
//   |                                    | every    | exact W w/o    |              |              |            |
//   |                                    | prepareT?| recompute?     |              |              |            |
//   +------------------------------------+----------+----------------+--------------+--------------+------------+
//   | AgentRuntimeEvent                  | NO       | n/a            | n/a          | n/a          | TEMPORAL   |
//   |   e.g. turn-started                | (fires   |                |              |              | BIND FAIL  |
//   |   (agent-runtime.ts:1374)          | BEFORE   |                |              |              |            |
//   |                                    | prepareT)|                |              |              |            |
//   +------------------------------------+----------+----------------+--------------+--------------+------------+
//   | AgentRuntime.snapshot()            | YES      | NO             | n/a          | n/a          | IDENTITY   |
//   |   AgentRuntimeStateSnapshot        | (query-  | (no W field)   |              |              | BIND FAIL  |
//   |   (agent-runtime.ts:1001)          | able)    |                |              |              |            |
//   +------------------------------------+----------+----------------+--------------+--------------+------------+
//   | snapshot.usage                     | YES      | NO             | n/a          | n/a          | NO         |
//   |   AgentUsage extends               |          | (usage accu-   |              |              | RECOMPUTE  |
//   |   AgentTokenUsage                  |          | mulates from   |              |              | VIOLATION  |
//   |   (shared/src/agent.ts:125)        |          | provider)      |              |              |            |
//   +------------------------------------+----------+----------------+--------------+--------------+------------+
//   | LocalRuntimeHost                   | NO       | n/a            | NO           | n/a          | INHERITS   |
//   |   session.updated / current        | (derives |                | (downstream) |              | UPSTREAM   |
//   |   snapshot projection              | from snap|                |              |              | GAP        |
//   +------------------------------------+----------+----------------+--------------+--------------+------------+
//   | usage / context event              | NO       | n/a            | n/a          | n/a          | POST-      |
//   |   (fires only on provider          | (fires   |                |              |              | PROVIDER   |
//   |   response)                        | on resp.)|                |              |              | (forbids)  |
//   +------------------------------------+----------+----------------+--------------+--------------+------------+
//
// Verdict (per stop rule):
//
//   CADENCE_CORRECT_EXISTING_CARRIER = ABSENT / PROVEN
//   NEW_TYPED_PER_TURN_CARRIER       = AUTHORIZED

// P1_2-aware imports: repo-relative (no /Volumes/...).
// Path from .factory/evidence/ACT-.../file.ts to the
// targets:
//   ../              -> .factory/evidence/
//   ../../           -> .factory/
//   ../../../        -> repo root
import { AgentRuntime } from "../../../sdk/packages/agents/src/index";
import type {
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentRuntimeStateSnapshot,
} from "../../../sdk/packages/shared/src/agent";

// Minimal scripted model — completes the first turn with
// `finish` (no provider response beyond the required
// events). Reproduces the reviewer's "no provider
// response / api_req_started follows" gate by giving the
// scripted model ONE step that finishes cleanly.
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

const W_N_FIXTURE = 4242;

async function main(): Promise<{
	error: string | false;
	prepareTurnCalls: number;
}> {
	// Track that prepareTurn WAS invoked and produced a
	// metadata-only result with currentWorkingContextEstimate.
	const prepareTurnCalls: Array<{
		result: { currentWorkingContextEstimate?: number } | undefined;
	}> = [];
	const prepareTurn = async (
		_context: unknown,
	): Promise<{ currentWorkingContextEstimate: number }> => {
		// Simulate the producer-side metadata-only return
		// shape from publishWorkingContextEstimateMetadataOnly
		// at compaction.ts:894.
		const result = { currentWorkingContextEstimate: W_N_FIXTURE };
		prepareTurnCalls.push({ result });
		return result;
	};

	const model = new FinishingOnlyModel();
	const runtime = new AgentRuntime({
		model,
		// biome-ignore lint/suspicious/noExplicitAny: minimal
		// provenance file; signature is exact from agent
		// runtime config.
		prepareTurn: prepareTurn as any,
	});

	await runtime.run("hello");

	// CRITICAL OBSERVATION POINT: at this moment, prepareTurn
	// has been called exactly once and returned W_N=4242. No
	// provider response beyond `finish: "stop"`. No
	// api_req_started-style event follows. The agent runtime
	// should have made the W observable to the host.
	const snapshot: AgentRuntimeStateSnapshot = runtime.snapshot();

	const snapshotHasWField =
		"currentWorkingContextEstimate" in snapshot;
	const snapshotWValue = (
		snapshot as unknown as { currentWorkingContextEstimate?: number }
	).currentWorkingContextEstimate;

	if (
		snapshotHasWField &&
		snapshotWValue !== undefined &&
		snapshotWValue === W_N_FIXTURE
	) {
		return {
			error: false,
			prepareTurnCalls: prepareTurnCalls.length,
		};
	}

	const detail = snapshotHasWField
		? `snapshot.currentWorkingContextEstimate is ${snapshotWValue}; prepareTurn returned ${W_N_FIXTURE} but the agent runtime at agent-runtime.ts:1738-1770 does NOT propagate W into this.state or into snapshot()`
		: `snapshot.currentWorkingContextEstimate is undefined; AgentRuntimeStateSnapshot at shared/src/agent.ts:273 has NO currentWorkingContextEstimate field; prepareTurn returned ${W_N_FIXTURE} but the value is discarded at agent-runtime.ts:1738-1770 (only flows into the model request via openTaskLifecycleStream)`;

	return {
		error: detail,
		prepareTurnCalls: prepareTurnCalls.length,
	};
}

main()
	.then((result) => {
		if (result.error === false) {
			console.log(
				JSON.stringify({ status: "GREEN", ...result }, null, 2),
			);
			process.exit(0);
		}
		console.log(JSON.stringify({ status: "RED", ...result }, null, 2));
		process.exit(1);
	})
	.catch((e: unknown) => {
		console.error("UNEXPECTED ERROR:", e);
		process.exit(2);
	});
