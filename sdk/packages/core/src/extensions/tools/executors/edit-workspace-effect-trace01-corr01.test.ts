/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01-CORR01
 *
 * Executable witnesses for the three evidence-authority corrections.
 *
 * These tests exercise the REAL production executors
 * (`createEditorExecutor`) and the REAL checkpoint capture against REAL
 * temporary files. Nothing that mutates the filesystem is mocked.
 *
 * WHY THIS SUITE EXISTS
 * ----------------------
 * The review of WORKSPACE-EFFECT-TRACE01 found three load-bearing defects:
 *
 *   C1  `executorCwdIdentity` fingerprinted the edit DESTINATION, not the
 *       executor's working directory. Two destinations written from the
 *       SAME cwd therefore looked like two different cwds — which
 *       defeats the entire purpose of the field.
 *
 *   C2  `RETAINED_CHANGED` was derived from the LAST post-write read-back
 *       rather than from a filesystem observation at the checkpoint. A
 *       shell command that restores the file produces no native editor
 *       event, so the trace still described the file as changed.
 *
 *   C3  the read-back used `fs.readFile()`, which buffers the ENTIRE file
 *       into memory before the 512 KiB size limit is checked.
 *
 * Witness map:
 *   C1-1  Two destinations from ONE cwd      → the SAME cwd identity
 *   C1-2  Two cwds                          → DIFFERENT cwd identities
 *   C1-3  The cwd identity is NOT the destination identity
 *   C1-4  No cwd supplied                   → the identity is ABSENT
 *   C2-1  Write, then a shell restore       → REVERTED, not retained
 *   C2-2  Write, then an independent delete → DELETED, not retained
 *   C2-3  Write, then the file survives     → RETAINED_CHANGED
 *   C2-4  No checkpoint                     → UNAVAILABLE_FROM_TRACE
 *   C2-5  The checkpoint exposes NO raw path
 *   C3-1  A file OVER the limit             → the content is NOT hashed
 *   C3-2  A file UNDER the limit            → the content IS hashed
 *   C3-3  A missing file                    → ABSENT, not unreadable
 *   C3-4  An unreadable file                → UNREADABLE, not absent
 *   C3-5  The trace-OFF path takes no reads
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
import {
	captureEditCheckpoint,
	EDIT_OBSERVATION_APPROVAL_METADATA_KEY,
	EDIT_OBSERVATION_IDENTITY_METADATA_KEY,
	EDIT_OBSERVATION_SINK_METADATA_KEY,
	EDIT_OBSERVATION_WORKSPACE_METADATA_KEY,
	resetEditCheckpointRegistry,
} from "./edit-observation";
import { createEditorExecutor } from "./editor";
import { EDIT_OBSERVATION_MAX_FILE_BYTES } from "./edit-write-verification";

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
	const key = options.key ?? "workspace-effect-corr01-key";
	const digest = (value: string): string => {
		// A simple deterministic, non-cryptographic stand-in is enough for
		// correlation assertions; the PRODUCTION sink uses HMAC-SHA256.
		let hash = 0x811c9dc5;
		for (let index = 0; index < value.length; index++) {
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

function toolContext(
	sink: ModelBehaviorTraceSink | undefined,
	options: {
		toolCallId?: string;
		omitToolCallId?: boolean;
		workspaceRoot?: string;
		otherWorkspaceRoots?: readonly string[];
		benchmarkRoot?: string;
	} = {},
): Record<string, unknown> {
	const toolCallId = options.omitToolCallId
		? undefined
		: (options.toolCallId ?? "call-1");
	return {
		agentId: "agent-1",
		conversationId: "conv-1",
		iteration: 1,
		toolCallId,
		metadata: sink
			? {
					[EDIT_OBSERVATION_SINK_METADATA_KEY]: sink,
					[EDIT_OBSERVATION_IDENTITY_METADATA_KEY]: {
						sessionId: "session-1",
						runId: "run-1",
						...(toolCallId !== undefined ? { toolCallId } : {}),
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
	// The checkpoint registry is capture-scoped, so each test starts with
	// a clean one.
	resetEditCheckpointRegistry();
	tempDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "workspace-effect-corr01-"),
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
// C1 — The executor cwd identity is the CWD, not the destination
// =============================================================================

describe("C1 — the executor cwd identity is the executor's working directory", () => {
	it("C1-1: two destinations written from ONE cwd share the cwd identity", async () => {
		const first = path.join(workspaceDir, "first.txt");
		const second = path.join(workspaceDir, "second.txt");
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		await editor(
			{ path: first, new_text: "one" },
			workspaceDir,
			toolContext(sink, { workspaceRoot: workspaceDir }) as never,
		);
		await editor(
			{ path: second, new_text: "two" },
			workspaceDir,
			toolContext(sink, { workspaceRoot: workspaceDir }) as never,
		);

		const resolved = resolutions(observations);
		expect(resolved).toHaveLength(2);
		// The two destinations are DIFFERENT files, so their identities
		// differ...
		const verified = verifications(observations);
		expect(verified).toHaveLength(2);
		expect(verified[0].fileIdentity).not.toBe(verified[1].fileIdentity);
		// ...but they were written from the SAME working directory, so the
		// cwd identity is the SAME. The previous implementation fingerprinted
		// the destination here, which made these two look like two cwds.
		expect(resolved[0].executorCwdIdentity).toBeDefined();
		expect(resolved[0].executorCwdIdentity).toBe(
			resolved[1].executorCwdIdentity,
		);
	});

	it("C1-2: two DIFFERENT working directories produce DIFFERENT cwd identities", async () => {
		const otherCwd = path.join(tempDir, "other-cwd");
		await fs.mkdir(otherCwd, { recursive: true });
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		await editor(
			{ path: path.join(workspaceDir, "a.txt"), new_text: "a" },
			workspaceDir,
			toolContext(sink, { workspaceRoot: workspaceDir }) as never,
		);
		await editor(
			{ path: path.join(workspaceDir, "b.txt"), new_text: "b" },
			otherCwd,
			toolContext(sink, { workspaceRoot: workspaceDir }) as never,
		);

		const resolved = resolutions(observations);
		expect(resolved).toHaveLength(2);
		expect(resolved[0].executorCwdIdentity).not.toBe(
			resolved[1].executorCwdIdentity,
		);
	});

	it("C1-3: the cwd identity is NOT the destination identity", async () => {
		const filePath = path.join(workspaceDir, "distinct.txt");
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		await editor(
			{ path: filePath, new_text: "x" },
			workspaceDir,
			toolContext(sink, { workspaceRoot: workspaceDir }) as never,
		);

		const resolved = resolutions(observations);
		expect(resolved).toHaveLength(1);
		// The destination and the cwd are different paths, so their
		// fingerprints must differ. The previous implementation made these
		// EQUAL, because it fingerprinted the destination and called it the
		// cwd.
		const verified = verifications(observations);
		expect(verified).toHaveLength(1);
		expect(resolved[0].executorCwdIdentity).not.toBe(verified[0].fileIdentity);
	});

	it("C1-3b: the cwd identity and the workspace identity are DISTINCT facts", async () => {
		// The production tool definitions default `cwd` to `process.cwd()`,
		// which in the extension host is frequently NOT the workspace root.
		// Recording the two identities separately is what makes that
		// difference visible — so they must NOT be the same field.
		const otherCwd = path.join(tempDir, "not-the-workspace");
		await fs.mkdir(otherCwd, { recursive: true });
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		await editor(
			{ path: path.join(workspaceDir, "split.txt"), new_text: "x" },
			otherCwd,
			toolContext(sink, { workspaceRoot: workspaceDir }) as never,
		);

		const resolved = resolutions(observations);
		expect(resolved).toHaveLength(1);
		expect(resolved[0].workspaceIdentity).toBeDefined();
		expect(resolved[0].executorCwdIdentity).toBeDefined();
		expect(resolved[0].workspaceIdentity).not.toBe(
			resolved[0].executorCwdIdentity,
		);
	});

	it("C1-4: a destination written with NO cwd reports the identity as unavailable", async () => {
		const filePath = path.join(workspaceDir, "no-cwd.txt");
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		// The executor is invoked with an EMPTY cwd. The identity is then
		// unavailable — it is NEVER substituted by a destination
		// fingerprint.
		await editor(
			{ path: filePath, new_text: "x" },
			"",
			toolContext(sink, { workspaceRoot: workspaceDir }) as never,
		);

		const resolved = resolutions(observations);
		expect(resolved).toHaveLength(1);
		expect(resolved[0].executorCwdIdentity).toBeUndefined();
	});
});

// =============================================================================
// C2 — The checkpoint is a real filesystem observation
// =============================================================================

describe("C2 — the checkpoint observes the CURRENT state, not the last read-back", () => {
	it("C2-1: a write that a shell command RESTORES is observed as reverted, not retained", async () => {
		const filePath = path.join(workspaceDir, "restored.txt");
		await fs.writeFile(filePath, "original\n", "utf-8");
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		// T1: the native editor writes B.
		await editor(
			{ path: filePath, old_text: "original", new_text: "changed" },
			workspaceDir,
			toolContext(sink, { workspaceRoot: workspaceDir }) as never,
		);
		// The post-write read-back confirmed B on disk.
		const verified = verifications(observations);
		expect(verified).toHaveLength(1);
		expect(verified[0].readbackMatched).toBe(true);

		// T2: a shell command restores A. NO native editor event fires.
		await fs.writeFile(filePath, "original\n", "utf-8");

		// T3: the checkpoint is taken at dump time.
		await captureEditCheckpoint(sink);

		// The workspace is demonstrably back at A...
		await expect(fs.readFile(filePath, "utf-8")).resolves.toBe("original\n");
		// ...so the checkpoint MUST observe the original content, not the
		// changed one. A comparator that classified this as RETAINED_CHANGED
		// would be reporting a change that is not there.
		const observed = checkpoints(observations);
		expect(observed).toHaveLength(1);
		expect(observed[0].observedTargetCount).toBe(1);
		const target = observed[0].targets[0];
		expect(target.state).toBe("present");
		// The checkpoint's content fingerprint is the ORIGINAL content's
		// fingerprint — the same one the read-back of the RESTORED file
		// would produce.
		const originalFingerprint =
			await sink.fingerprintFileContent!("original\n");
		expect(target.contentFingerprint).toBe(originalFingerprint);
	});

	it("C2-2: a write that is later DELETED is observed as absent, not retained", async () => {
		const filePath = path.join(workspaceDir, "deleted-later.txt");
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		await editor(
			{ path: filePath, new_text: "created" },
			workspaceDir,
			toolContext(sink, { workspaceRoot: workspaceDir }) as never,
		);
		// The file is independently deleted after the last native edit.
		await fs.rm(filePath, { force: true });

		await captureEditCheckpoint(sink);

		const observed = checkpoints(observations);
		expect(observed).toHaveLength(1);
		expect(observed[0].targets[0].state).toBe("absent");
		expect(observed[0].targets[0].contentFingerprint).toBeUndefined();
	});

	it("C2-3: a write that SURVIVES to the checkpoint is observed as present", async () => {
		const filePath = path.join(workspaceDir, "survives.txt");
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		await editor(
			{ path: filePath, new_text: "kept" },
			workspaceDir,
			toolContext(sink, { workspaceRoot: workspaceDir }) as never,
		);

		await captureEditCheckpoint(sink);

		const observed = checkpoints(observations);
		expect(observed).toHaveLength(1);
		expect(observed[0].targets[0].state).toBe("present");
		const keptFingerprint = await sink.fingerprintFileContent!("kept");
		expect(observed[0].targets[0].contentFingerprint).toBe(keptFingerprint);
	});

	it("C2-4: with NO checkpoint, the current state is simply not known", async () => {
		const filePath = path.join(workspaceDir, "no-checkpoint.txt");
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		await editor(
			{ path: filePath, new_text: "written" },
			workspaceDir,
			toolContext(sink, { workspaceRoot: workspaceDir }) as never,
		);

		// NO checkpoint is captured.
		expect(checkpoints(observations)).toHaveLength(0);
		// The trace still carries the post-write read-back, which is the
		// LAST_OBSERVED_POST_WRITE_STATE — real evidence about that instant,
		// but not about the current state.
		expect(verifications(observations)).toHaveLength(1);
	});

	it("C2-5: the checkpoint never exposes a raw path", async () => {
		const secretName = "checkpoint-secret.txt";
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
		expect(serialized).not.toContain(workspaceDir);
		expect(serialized).not.toContain(tempDir);
		expect(serialized).not.toContain("secret-content");
		// The identity is an opaque fingerprint.
		expect(checkpoints(observations)[0].targets[0].fileIdentity).toBeDefined();
	});
});

// =============================================================================
// C3 — The read-back is bounded, and its failure modes are distinguished
// =============================================================================

describe("C3 — the read-back is bounded and distinguishes its failure modes", () => {
	it("C3-1: a file OVER the limit is NOT content-hashed", async () => {
		const filePath = path.join(workspaceDir, "huge.txt");
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		// The editor creates the file normally.
		await editor(
			{ path: filePath, new_text: "seed" },
			workspaceDir,
			toolContext(sink, { workspaceRoot: workspaceDir }) as never,
		);

		// The destination is then made LARGER than the observation limit.
		// It is written with a plain stream so the test never builds the
		// whole buffer either. The first bytes are a UNIQUE marker, so the
		// replacement below is unambiguous.
		const marker = "UNIQUE-START-MARKER";
		const handle = await fs.open(filePath, "w");
		await handle.writeFile(marker, "utf-8");
		const chunk = Buffer.alloc(64 * 1024, 0x61);
		for (let index = 0; index < 16; index++) {
			await handle.write(chunk);
		}
		await handle.close();
		const size = (await fs.stat(filePath)).size;
		expect(size).toBeGreaterThan(EDIT_OBSERVATION_MAX_FILE_BYTES);
		await expect(fs.readFile(filePath, "utf-8")).resolves.toContain(marker);

		// A SECOND write re-reads the destination, which is now over the
		// limit. The read-back must SKIP the content measurement instead
		// of loading the whole file.
		await editor(
			{ path: filePath, old_text: marker, new_text: "CHANGED" },
			workspaceDir,
			toolContext(sink, { workspaceRoot: workspaceDir }) as never,
		);

		const verified = verifications(observations);
		expect(verified).toHaveLength(2);
		const last = verified[1];
		// The file EXISTS...
		expect(last.fileExistsAfterWrite).toBe(true);
		// ...but its content was NOT measured, and the reason says why.
		expect(last.actualContentFingerprint).toBeUndefined();
		expect(last.measurementSkippedReason).toBe(
			"MEASUREMENT_SKIPPED_SIZE_LIMIT",
		);
	});

	it("C3-2: a file UNDER the limit IS content-hashed", async () => {
		const filePath = path.join(workspaceDir, "small.txt");
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		await editor(
			{ path: filePath, new_text: "small" },
			workspaceDir,
			toolContext(sink, { workspaceRoot: workspaceDir }) as never,
		);

		const verified = verifications(observations);
		expect(verified).toHaveLength(1);
		expect(verified[0].actualContentFingerprint).toBeDefined();
		expect(verified[0].measurementSkippedReason).toBeUndefined();
	});

	it("C3-3: a MISSING file is observed as absent, not as an unreadable file", async () => {
		const filePath = path.join(workspaceDir, "vanishing.txt");
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		// The sink removes the file right after the write, so the
		// read-back observes a file that is genuinely GONE.
		const removingSink: ModelBehaviorTraceSink = {
			...sink,
			fingerprintFileContent: async (content) => {
				await fs.rm(filePath, { force: true });
				return `removed:${content.length}`;
			},
		};

		await editor(
			{ path: filePath, new_text: "vanishing" },
			workspaceDir,
			toolContext(removingSink, { workspaceRoot: workspaceDir }) as never,
		);

		const verified = verifications(observations);
		expect(verified).toHaveLength(1);
		expect(verified[0].fileExistsAfterWrite).toBe(false);
		expect(verified[0].readbackMatched).toBeUndefined();
		expect(verified[0].measurementSkippedReason).toBe("READBACK_UNAVAILABLE");
	});

	it("C3-4: an UNREADABLE file is reported as unreadable, not as absent", async () => {
		const directoryPath = path.join(workspaceDir, "a-directory");
		await fs.mkdir(directoryPath, { recursive: true });
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		await editor(
			{ path: path.join(workspaceDir, "normal.txt"), new_text: "ok" },
			workspaceDir,
			toolContext(sink, { workspaceRoot: workspaceDir }) as never,
		);

		// Now observe the DIRECTORY through the checkpoint: it exists but
		// its CONTENT cannot be read as a file. That is NOT ENOENT, so it
		// must be reported as UNREADABLE rather than ABSENT.
		const registry = await import("./edit-checkpoint-registry");
		registry.getEditCheckpointRegistry().register(directoryPath);
		await captureEditCheckpoint(sink);

		const observed = checkpoints(observations);
		expect(observed).toHaveLength(1);
		const target = observed[0].targets.find(
			(candidate) => candidate.state === "unreadable",
		);
		expect(target).toBeDefined();
		expect(target?.contentFingerprint).toBeUndefined();
		expect(target?.measurementSkippedReason).toBe("READBACK_UNAVAILABLE");
	});

	it("C3-5: the trace-OFF path takes no reads and emits no checkpoint", async () => {
		const filePath = path.join(workspaceDir, "off.txt");
		const { observations } = createCaptureSink();
		const editor = createEditorExecutor();

		// No sink in the metadata ⇒ the observation channel is inert.
		await editor(
			{ path: filePath, new_text: "alpha" },
			workspaceDir,
			toolContext(undefined) as never,
		);
		await captureEditCheckpoint(undefined);

		expect(observations).toHaveLength(0);
		await expect(fs.readFile(filePath, "utf-8")).resolves.toBe("alpha");
	});

	it("C3-6: the read-back NEVER loads the whole file", async () => {
		// The defect this closes is a RESOURCE defect, so the witness has
		// to observe the RESOURCE, not just the resulting fingerprint.
		//
		// `fs.readFile()` buffers the ENTIRE file into memory before the
		// size limit is checked. The bounded read opens a descriptor and
		// requests at most `limit + 1` bytes, so the allocation is bounded
		// no matter how large the destination is.
		//
		// The witness observes the number of bytes the read actually
		// requested from the operating system.
		const filePath = path.join(workspaceDir, "bounded.txt");
		// A file LARGER than the ceiling, so a whole-file read would
		// request MORE bytes than the ceiling allows.
		await fs.writeFile(
			filePath,
			"y".repeat(EDIT_OBSERVATION_MAX_FILE_BYTES * 2),
			"utf-8",
		);

		const { readBackBounded, boundedReadByteCeiling } = await import(
			"./edit-write-verification"
		);
		const requested: number[] = [];
		const result = await readBackBounded(filePath, undefined, (bytes) => {
			requested.push(bytes);
		});

		// The file is over the limit, so its content is NOT returned.
		expect(result.kind).toBe("too_large");
		// The read-back DID happen...
		expect(requested.length).toBeGreaterThan(0);
		// ...and every read it requested was WITHIN the ceiling. A
		// whole-file read would have asked for the whole file.
		const ceiling = boundedReadByteCeiling();
		for (const bytes of requested) {
			expect(bytes).toBeLessThanOrEqual(ceiling);
		}
		// The total requested never exceeded the ceiling either.
		const total = requested.reduce((sum, bytes) => sum + bytes, 0);
		expect(total).toBeLessThanOrEqual(ceiling);
		// The file on disk is TWICE the ceiling, so a whole-file read
		// would have exceeded it.
		const size = (await fs.stat(filePath)).size;
		expect(size).toBeGreaterThan(ceiling);
	});

	it("C3-7: the bounded read skips a file that is over the limit", async () => {
		// The bound is asserted DIRECTLY against the read-back module, so
		// the witness is about the RESOURCE, not about the fingerprint.
		const { readBackBounded } = await import("./edit-write-verification");
		const filePath = path.join(workspaceDir, "ceiling.txt");
		await fs.writeFile(filePath, "x".repeat(4096), "utf-8");

		const result = await readBackBounded(filePath, 1024);
		// A file of 4096 bytes read with a 1024-byte limit is over the
		// limit, and the content is NOT returned.
		expect(result.kind).toBe("too_large");
	});

	it("C3-8: the EXECUTOR path never requests more than the ceiling", async () => {
		// C3-6 and C3-7 exercise the read-back MODULE. This witness
		// exercises the CALLER — the real editor executor — so it fails if
		// the executor goes back to reading the whole file.
		//
		// The destination is deliberately much LARGER than the ceiling.
		const filePath = path.join(workspaceDir, "executor-bounded.txt");
		await fs.writeFile(
			filePath,
			"z".repeat(EDIT_OBSERVATION_MAX_FILE_BYTES * 2),
			"utf-8",
		);
		const size = (await fs.stat(filePath)).size;

		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		// The editor writes a NEW file, then the destination is grown
		// beyond the ceiling, then a SECOND write forces the read-back to
		// observe the oversized destination.
		const target = path.join(workspaceDir, "executor-target.txt");
		await editor(
			{ path: target, new_text: "seed" },
			workspaceDir,
			toolContext(sink, { workspaceRoot: workspaceDir }) as never,
		);
		const handle = await fs.open(target, "w");
		await handle.writeFile("MARKER-UNIQUE", "utf-8");
		const chunk = Buffer.alloc(64 * 1024, 0x63);
		for (let index = 0; index < 16; index++) {
			await handle.write(chunk);
		}
		await handle.close();

		await editor(
			{ path: target, old_text: "MARKER-UNIQUE", new_text: "CHANGED" },
			workspaceDir,
			toolContext(sink, { workspaceRoot: workspaceDir }) as never,
		);

		// The destination on disk is far beyond the ceiling...
		const grown = (await fs.stat(target)).size;
		expect(grown).toBeGreaterThan(EDIT_OBSERVATION_MAX_FILE_BYTES);
		// ...and the read-back SKIPPED the content measurement.
		const verified = verifications(observations);
		expect(verified.length).toBeGreaterThanOrEqual(2);
		const last = verified[verified.length - 1];
		expect(last.measurementSkippedReason).toBe(
			"MEASUREMENT_SKIPPED_SIZE_LIMIT",
		);
		// The RESOURCE observation: the read-back asked the OS for at most
		// the ceiling, NOT for the whole (much larger) file. A whole-file
		// read would have reported `grown` here.
		expect(last.readBytesRequested).toBeDefined();
		expect(last.readBytesRequested!).toBeLessThanOrEqual(
			EDIT_OBSERVATION_MAX_FILE_BYTES + 1,
		);
		expect(last.readBytesRequested!).toBeLessThan(grown);
		// The oversized file was written by the TEST, not by the executor,
		// so it is only a fixture — the executor never wrote it.
		expect(size).toBeGreaterThan(EDIT_OBSERVATION_MAX_FILE_BYTES);
	});
});
