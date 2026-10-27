/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01-CORR02
 *
 * Executable witnesses for the CAUSAL-IDENTITY corrections.
 *
 * THE DEFECTS THIS SUITE CLOSES
 * -----------------------------
 * P0-1 — CHECKPOINTS HAD NO SESSION/RUN IDENTITY.
 *
 *   `captureEditCheckpoint()` emitted one checkpoint for the whole capture
 *   and carried NO `sessionId`/`runId`. The comparator's `scopeRecords()`
 *   intentionally excludes a record that carries neither the selected run
 *   id nor the owning session id, so `--m3-run` / `--m3.1-run` DROPPED the
 *   checkpoint: the retained-change authority of a selected run was simply
 *   absent. Worse, the registry was keyed by absolute path ALONE, so two
 *   runs of one capture that touched the same destination were MERGED into
 *   one target and the checkpoint could not be attributed to either.
 *
 * P0-2 — MULTI-FILE PATCH ATTRIBUTION WAS NOT SOURCE-BOUND.
 *
 *   `reportTargetResolution()` emitted `toolCallId` and
 *   `destinationScope` but NOT `fileIdentity`, while
 *   `reportWriteVerification()` DID emit `fileIdentity`. The comparator
 *   therefore joined a destination scope to a verified write by tool-call
 *   id alone — but several destinations of ONE `apply_patch` share ONE
 *   tool-call id, so the join was ambiguous.
 *
 * P1 — READ-BYTE ACCOUNTING WAS CUMULATIVE.
 *
 *   `readBytesRequested` accumulated across reads, but each
 *   `edit_write_verification` published the accumulated total, so the field
 *   stopped describing ONE read operation.
 *
 * WITNESS MAP
 * -----------
 *   C1-1  Two runs in ONE capture → TWO checkpoints, one per run.
 *   C1-2  Each checkpoint carries its OWN session/run identity.
 *   C1-3  Selecting a run keeps ONLY that run's checkpoint.
 *   C1-4  Two runs touching the SAME destination are NOT merged.
 *   C2-1  A real two-file apply_patch: one inside, one outside the
 *         workspace; each write joins to its OWN destination.
 *   C2-2  The resolution and the verification share the SAME fileIdentity.
 *   C3-1  An AMBIGUOUS join (no per-file identity, several destinations)
 *         is UNAVAILABLE, never inferred.
 *   C3-2  A resolution WITHOUT a fileIdentity is not attributed.
 *   C4-1  Two read-backs under ONE tool call report their OWN counts.
 *   C5-1  The trace-OFF path takes no reads and emits no checkpoint.
 *   C5-2  The checkpoint never exposes a raw path.
 *
 * These tests exercise the REAL production executors
 * (`createEditorExecutor`, `createApplyPatchExecutor`) and the REAL
 * checkpoint capture against REAL temporary files. Nothing that mutates the
 * filesystem is mocked.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type {
	ModelBehaviorTraceEditCheckpointObservation,
	ModelBehaviorTraceEditTargetResolution,
	ModelBehaviorTraceEditWriteVerification,
	ModelBehaviorTraceObservation,
	ModelBehaviorTraceSink,
} from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApplyPatchExecutor } from "./apply-patch";
import {
	captureEditCheckpoint,
	EDIT_OBSERVATION_APPROVAL_METADATA_KEY,
	EDIT_OBSERVATION_IDENTITY_METADATA_KEY,
	EDIT_OBSERVATION_SINK_METADATA_KEY,
	EDIT_OBSERVATION_WORKSPACE_METADATA_KEY,
	resetEditCheckpointRegistry,
} from "./edit-observation";
import { EDIT_OBSERVATION_MAX_FILE_BYTES } from "./edit-write-verification";
import { createEditorExecutor } from "./editor";

// =============================================================================
// Test harness
// =============================================================================

type CapturedKind =
	| "edit_attempt"
	| "edit_application"
	| "edit_failure"
	| "edit_target_resolved"
	| "edit_write_verification"
	| "edit_checkpoint_observation";

interface CapturedObservation extends ModelBehaviorTraceObservation {
	readonly kind: CapturedKind;
	readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * A sink that records every edit observation and computes the ephemeral
 * fingerprints with a fixed key (so the test can assert on identity
 * correlation deterministically).
 */
function createCaptureSink(options: { key?: string } = {}): {
	sink: ModelBehaviorTraceSink;
	observations: CapturedObservation[];
} {
	const observations: CapturedObservation[] = [];
	const key = options.key ?? "workspace-effect-corr02-key";
	const digest = (value: string): string => {
		let hash = 0x811c9dc5;
		for (let index = 0; index < value.length; index += 1) {
			hash ^= value.charCodeAt(index);
			hash = Math.imul(hash, 0x01000193) >>> 0;
		}
		return `${key}:${hash.toString(16).padStart(8, "0")}`;
	};
	const sink: ModelBehaviorTraceSink = {
		fingerprintFilePath: (resolvedPath) => digest(`path:${resolvedPath}`),
		fingerprintFileContent: (content) => digest(`content:${content}`),
		onEditAttempt: (observation) => {
			observations.push({ ...observation, kind: "edit_attempt" });
		},
		onEditApplication: (observation) => {
			observations.push({ ...observation, kind: "edit_application" });
		},
		onEditFailure: (observation) => {
			observations.push({ ...observation, kind: "edit_failure" });
		},
		onEditTargetResolved: (observation) => {
			observations.push({ ...observation, kind: "edit_target_resolved" });
		},
		onEditWriteVerification: (observation) => {
			observations.push({ ...observation, kind: "edit_write_verification" });
		},
		onEditCheckpointObservation: (observation) => {
			observations.push({
				...observation,
				kind: "edit_checkpoint_observation",
			});
		},
	};
	return { sink, observations };
}

interface ToolContextOptions {
	toolCallId?: string;
	sessionId?: string;
	runId?: string;
	workspaceRoot?: string;
	otherWorkspaceRoots?: readonly string[];
	benchmarkRoot?: string;
}

function toolContext(
	sink: ModelBehaviorTraceSink | undefined,
	options: ToolContextOptions = {},
): Record<string, unknown> {
	const toolCallId = options.toolCallId ?? "call-1";
	return {
		agentId: "agent-1",
		conversationId: "conv-1",
		iteration: 1,
		toolCallId,
		metadata: sink
			? {
					[EDIT_OBSERVATION_SINK_METADATA_KEY]: sink,
					[EDIT_OBSERVATION_IDENTITY_METADATA_KEY]: {
						sessionId: options.sessionId ?? "session-1",
						runId: options.runId ?? "run-1",
						toolCallId,
					},
					[EDIT_OBSERVATION_APPROVAL_METADATA_KEY]: "approved",
					[EDIT_OBSERVATION_WORKSPACE_METADATA_KEY]: {
						...(options.workspaceRoot !== undefined
							? { workspaceRoot: options.workspaceRoot }
							: {}),
						...(options.otherWorkspaceRoots !== undefined
							? { otherWorkspaceRoots: options.otherWorkspaceRoots }
							: {}),
						...(options.benchmarkRoot !== undefined
							? { benchmarkRoot: options.benchmarkRoot }
							: {}),
					},
				}
			: undefined,
	};
}

function resolutions(
	observations: CapturedObservation[],
): ModelBehaviorTraceEditTargetResolution[] {
	return observations
		.filter((observation) => observation.kind === "edit_target_resolved")
		.map(
			(observation) =>
				observation.payload as unknown as ModelBehaviorTraceEditTargetResolution,
		);
}

function verifications(
	observations: CapturedObservation[],
): ModelBehaviorTraceEditWriteVerification[] {
	return observations
		.filter((observation) => observation.kind === "edit_write_verification")
		.map(
			(observation) =>
				observation.payload as unknown as ModelBehaviorTraceEditWriteVerification,
		);
}

function checkpoints(
	observations: CapturedObservation[],
): ModelBehaviorTraceEditCheckpointObservation[] {
	return observations
		.filter((observation) => observation.kind === "edit_checkpoint_observation")
		.map(
			(observation) =>
				observation.payload as unknown as ModelBehaviorTraceEditCheckpointObservation,
		);
}

let tempDir: string;
let workspaceDir: string;
let outsideDir: string;

beforeEach(async () => {
	resetEditCheckpointRegistry();
	tempDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "workspace-effect-corr02-"),
	);
	workspaceDir = path.join(tempDir, "workspace");
	outsideDir = path.join(tempDir, "outside");
	await fs.mkdir(workspaceDir, { recursive: true });
	await fs.mkdir(outsideDir, { recursive: true });
});

afterEach(async () => {
	resetEditCheckpointRegistry();
	await fs.rm(tempDir, { recursive: true, force: true });
});

// =============================================================================
// C1 — Checkpoint ownership: the checkpoint carries its session/run identity
// =============================================================================

describe("C1 — a checkpoint is owned by the run it observed", () => {
	it("C1-1: two runs in ONE capture produce TWO checkpoints, one per run", async () => {
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		await editor(
			{ path: path.join(workspaceDir, "run-a.txt"), new_text: "a" },
			workspaceDir,
			toolContext(sink, {
				workspaceRoot: workspaceDir,
				sessionId: "session-1",
				runId: "run-a",
				toolCallId: "call-a",
			}) as never,
		);
		await editor(
			{ path: path.join(workspaceDir, "run-b.txt"), new_text: "b" },
			workspaceDir,
			toolContext(sink, {
				workspaceRoot: workspaceDir,
				sessionId: "session-1",
				runId: "run-b",
				toolCallId: "call-b",
			}) as never,
		);

		await captureEditCheckpoint(sink);

		const observed = checkpoints(observations);
		expect(observed).toHaveLength(2);
	});

	it("C1-2: each checkpoint carries the identity of the run that owns it", async () => {
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		await editor(
			{ path: path.join(workspaceDir, "run-a.txt"), new_text: "a" },
			workspaceDir,
			toolContext(sink, {
				workspaceRoot: workspaceDir,
				sessionId: "session-1",
				runId: "run-a",
				toolCallId: "call-a",
			}) as never,
		);
		await editor(
			{ path: path.join(workspaceDir, "run-b.txt"), new_text: "b" },
			workspaceDir,
			toolContext(sink, {
				workspaceRoot: workspaceDir,
				sessionId: "session-1",
				runId: "run-b",
				toolCallId: "call-b",
			}) as never,
		);

		await captureEditCheckpoint(sink);

		const observed = checkpoints(observations);
		const byRun = new Map(
			observed.map((observation) => [observation.runId, observation]),
		);
		expect(byRun.get("run-a")?.sessionId).toBe("session-1");
		expect(byRun.get("run-b")?.sessionId).toBe("session-1");
		// Each checkpoint observes ONLY its own run's target.
		expect(byRun.get("run-a")?.observedTargetCount).toBe(1);
		expect(byRun.get("run-b")?.observedTargetCount).toBe(1);
	});

	it("C1-3: selecting a run keeps ONLY that run's checkpoint evidence", async () => {
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		await editor(
			{ path: path.join(workspaceDir, "run-a.txt"), new_text: "a" },
			workspaceDir,
			toolContext(sink, {
				workspaceRoot: workspaceDir,
				sessionId: "session-1",
				runId: "run-a",
				toolCallId: "call-a",
			}) as never,
		);
		await editor(
			{ path: path.join(workspaceDir, "run-b.txt"), new_text: "b" },
			workspaceDir,
			toolContext(sink, {
				workspaceRoot: workspaceDir,
				sessionId: "session-1",
				runId: "run-b",
				toolCallId: "call-b",
			}) as never,
		);

		await captureEditCheckpoint(sink);

		// The comparator's identity-verified scope: a record is kept when it
		// carries the selected run id, or the session id that owns it.
		const selectedRunId = "run-a";
		const owningSessions = new Set(
			checkpoints(observations)
				.filter((observation) => observation.runId === selectedRunId)
				.map((observation) => observation.sessionId)
				.filter((value): value is string => value !== undefined),
		);
		expect(owningSessions.size).toBe(1);
		const scoped = checkpoints(observations).filter((observation) => {
			if (observation.runId !== undefined) {
				return observation.runId === selectedRunId;
			}
			return (
				owningSessions.size === 1 &&
				observation.sessionId === [...owningSessions][0]
			);
		});
		expect(scoped).toHaveLength(1);
		expect(scoped[0].runId).toBe("run-a");
	});

	it("C1-4: two runs touching the SAME destination are NOT merged", async () => {
		const shared = path.join(workspaceDir, "shared.txt");
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		await editor(
			{ path: shared, new_text: "from-run-a" },
			workspaceDir,
			toolContext(sink, {
				workspaceRoot: workspaceDir,
				sessionId: "session-1",
				runId: "run-a",
				toolCallId: "call-a",
			}) as never,
		);
		await editor(
			{ path: shared, old_text: "from-run-a", new_text: "from-run-b" },
			workspaceDir,
			toolContext(sink, {
				workspaceRoot: workspaceDir,
				sessionId: "session-1",
				runId: "run-b",
				toolCallId: "call-b",
			}) as never,
		);

		await captureEditCheckpoint(sink);

		const observed = checkpoints(observations);
		expect(observed).toHaveLength(2);
		expect(observed.map((observation) => observation.runId).sort()).toEqual([
			"run-a",
			"run-b",
		]);
		// Each run owns its own target — the SAME destination, observed
		// once per owner.
		for (const observation of observed) {
			expect(observation.observedTargetCount).toBe(1);
		}
	});
});

// =============================================================================
// C2 — Target identity: the per-file join is source-bound
// =============================================================================

describe("C2 — the destination scope and the verified write share one identity", () => {
	it("C2-1: a real two-file apply_patch attributes each write to its OWN destination", async () => {
		const inside = path.join(workspaceDir, "inside.txt");
		const outside = path.join(outsideDir, "outside.txt");
		const { sink, observations } = createCaptureSink();
		const applyPatch = createApplyPatchExecutor({ restrictToCwd: false });

		const patch = [
			"*** Begin Patch",
			`*** Add File: ${inside}`,
			"+inside-content",
			`*** Add File: ${outside}`,
			"+outside-content",
			"*** End Patch",
		].join("\n");

		await applyPatch(
			{ input: patch } as never,
			workspaceDir,
			toolContext(sink, {
				workspaceRoot: workspaceDir,
				toolCallId: "call-multi",
			}) as never,
		);

		const resolved = resolutions(observations);
		expect(resolved).toHaveLength(2);
		const scopes = resolved.map((entry) => entry.destinationScope).sort();
		expect(scopes).toEqual(["active_workspace", "outside_workspace"]);

		// The join is EXACT per-target: each resolution's fileIdentity is
		// the identity of ITS OWN destination, and it is the SAME identity
		// the write verification reports for that destination.
		const verified = verifications(observations);
		expect(verified).toHaveLength(2);
		const verifiedIdentities = new Set(
			verified.map((entry) => entry.fileIdentity),
		);
		for (const resolution of resolved) {
			const identity = resolution.fileIdentity;
			expect(identity).toBeDefined();
			expect(verifiedIdentities.has(identity ?? "")).toBe(true);
		}
		// The two destinations have DISTINCT identities, so the scopes are
		// distinguishable.
		const identities = new Set(resolved.map((entry) => entry.fileIdentity));
		expect(identities.size).toBe(2);
	});

	it("C2-2: the resolution and the verification report the SAME fileIdentity", async () => {
		const filePath = path.join(workspaceDir, "same-identity.txt");
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		await editor(
			{ path: filePath, new_text: "content" },
			workspaceDir,
			toolContext(sink, { workspaceRoot: workspaceDir }) as never,
		);

		const resolved = resolutions(observations);
		const verified = verifications(observations);
		expect(resolved).toHaveLength(1);
		expect(verified).toHaveLength(1);
		expect(resolved[0].fileIdentity).toBeDefined();
		expect(verified[0].fileIdentity).toBe(resolved[0].fileIdentity);
	});
});

// =============================================================================
// C3 — Missing identity: an ambiguous join is never inferred
// =============================================================================

describe("C3 — an incomplete or ambiguous ownership is never inferred", () => {
	it("C3-1: a write whose destination cannot be joined is not attributed", async () => {
		// The production producer can no longer emit a resolution WITHOUT
		// a fileIdentity for a path the sink could fingerprint, so the
		// ambiguous case is witnessed with a sink that cannot fingerprint
		// paths at all: the identity is then genuinely unavailable.
		const filePath = path.join(workspaceDir, "unfingerprintable.txt");
		const { observations } = createCaptureSink();
		const editor = createEditorExecutor();
		const sinkWithoutPathFingerprint: ModelBehaviorTraceSink = {
			fingerprintFilePath: () => undefined,
			fingerprintFileContent: () => "content-identity",
			onEditAttempt: (observation) => {
				observations.push({ ...observation, kind: "edit_attempt" });
			},
			onEditApplication: (observation) => {
				observations.push({ ...observation, kind: "edit_application" });
			},
			onEditFailure: (observation) => {
				observations.push({ ...observation, kind: "edit_failure" });
			},
			onEditTargetResolved: (observation) => {
				observations.push({ ...observation, kind: "edit_target_resolved" });
			},
			onEditWriteVerification: (observation) => {
				observations.push({ ...observation, kind: "edit_write_verification" });
			},
			onEditCheckpointObservation: (observation) => {
				observations.push({
					...observation,
					kind: "edit_checkpoint_observation",
				});
			},
		};

		await editor(
			{ path: filePath, new_text: "content" },
			workspaceDir,
			toolContext(sinkWithoutPathFingerprint, {
				workspaceRoot: workspaceDir,
			}) as never,
		);

		const resolved = resolutions(observations);
		expect(resolved).toHaveLength(1);
		// The identity is genuinely UNAVAILABLE — it is not invented.
		expect(resolved[0].fileIdentity).toBeUndefined();
		// The destination scope is still reported: the scope is a
		// structural fact about the path, independent of the identity.
		expect(resolved[0].destinationScope).toBe("active_workspace");
	});

	it("C3-2: a checkpoint whose owner has no identity is not attributed to a run", async () => {
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		// A write with NO session/run identity in the tool context.
		const context = toolContext(sink, { workspaceRoot: workspaceDir });
		const metadata = context.metadata as Record<string, unknown>;
		metadata[EDIT_OBSERVATION_IDENTITY_METADATA_KEY] = {
			toolCallId: "call-anonymous",
		};

		await editor(
			{ path: path.join(workspaceDir, "anonymous.txt"), new_text: "x" },
			workspaceDir,
			context as never,
		);

		await captureEditCheckpoint(sink);

		const observed = checkpoints(observations);
		expect(observed).toHaveLength(1);
		// The checkpoint carries NO run identity: it cannot be claimed by
		// any selected run, so it is never attributed to one.
		expect(observed[0].runId).toBeUndefined();
		expect(observed[0].sessionId).toBeUndefined();
	});
});

// =============================================================================
// C4 — Bounded accounting: the count describes ONE read
// =============================================================================

describe("C4 — the read-back reports its OWN requested-byte count", () => {
	it("C4-1: two read-backs under ONE tool call report their individual counts", async () => {
		const inside = path.join(workspaceDir, "one.txt");
		const outside = path.join(outsideDir, "two.txt");
		const { sink, observations } = createCaptureSink();
		const applyPatch = createApplyPatchExecutor({ restrictToCwd: false });

		const patch = [
			"*** Begin Patch",
			`*** Add File: ${inside}`,
			"+one",
			`*** Add File: ${outside}`,
			"+two",
			"*** End Patch",
		].join("\n");

		await applyPatch(
			{ input: patch } as never,
			workspaceDir,
			toolContext(sink, {
				workspaceRoot: workspaceDir,
				toolCallId: "call-multi",
			}) as never,
		);

		const verified = verifications(observations);
		expect(verified).toHaveLength(2);
		const ceiling = EDIT_OBSERVATION_MAX_FILE_BYTES + 1;
		for (const entry of verified) {
			const requested = entry.readBytesRequested;
			expect(requested).toBeDefined();
			expect(requested ?? 0).toBeGreaterThan(0);
			expect(requested ?? Number.MAX_SAFE_INTEGER).toBeLessThanOrEqual(ceiling);
		}
		// The count is PER READ, never the accumulated total of the tool
		// call: two reads report the SAME individual count, not its sum.
		expect(verified[0].readBytesRequested).toBe(verified[1].readBytesRequested);
	});
});

// =============================================================================
// C5 — Conservation: nothing else changed
// =============================================================================

describe("C5 — the conservation properties are unchanged", () => {
	it("C5-1: the trace-OFF path takes no reads and emits no checkpoint", async () => {
		const filePath = path.join(workspaceDir, "off.txt");
		const { observations } = createCaptureSink();
		const editor = createEditorExecutor();

		await editor(
			{ path: filePath, new_text: "alpha" },
			workspaceDir,
			toolContext(undefined) as never,
		);
		await captureEditCheckpoint(undefined);

		expect(observations).toHaveLength(0);
		await expect(fs.readFile(filePath, "utf-8")).resolves.toBe("alpha");
	});

	it("C5-2: the checkpoint never exposes a raw path", async () => {
		const secretName = "corr02-secret.txt";
		const filePath = path.join(workspaceDir, secretName);
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		await editor(
			{ path: filePath, new_text: "secret-content" },
			workspaceDir,
			toolContext(sink, { workspaceRoot: workspaceDir }) as never,
		);
		await captureEditCheckpoint(sink);

		const serialized = JSON.stringify(checkpoints(observations));
		expect(serialized).not.toContain(secretName);
		expect(serialized).not.toContain(filePath);
		expect(serialized).not.toContain(tempDir);
	});

	it("C5-3: a SINGLE-run capture still produces exactly ONE checkpoint", async () => {
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		await editor(
			{ path: path.join(workspaceDir, "single.txt"), new_text: "x" },
			workspaceDir,
			toolContext(sink, {
				workspaceRoot: workspaceDir,
				sessionId: "session-1",
				runId: "run-1",
			}) as never,
		);

		await captureEditCheckpoint(sink);

		const observed = checkpoints(observations);
		expect(observed).toHaveLength(1);
		expect(observed[0].observedTargetCount).toBe(1);
	});
});
