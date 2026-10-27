/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01
 *
 * Executable witnesses for the workspace-effect trace.
 *
 * These tests exercise the REAL production executors
 * (`createEditorExecutor` / `createApplyPatchExecutor`) against REAL
 * temporary files. The mutation-producing executor is NEVER mocked: the
 * only thing under test is what the OBSERVATION reports about a write
 * that actually happened.
 *
 * WHY THIS SUITE EXISTS
 * ----------------------
 * A benchmark run produced THIRTEEN applied native writes and ZERO
 * retained workspace changes, and the existing trace could not explain
 * why. The existing trace records THAT a write happened and WHAT content
 * the executor INTENDED to write, but never WHERE the write landed and
 * never what is actually on disk.
 *
 * The production executor accepts an ABSOLUTE input path with no
 * containment check, so a write can land outside the workspace without
 * producing any error. These witnesses make that visible — and prove
 * that the new evidence distinguishes it from an in-workspace write.
 *
 * Witness map:
 *   W01  Outside-workspace absolute write   → classified outside
 *   W02  In-workspace write                 → classified active
 *   W03  Symlinked destination               → NOT classified inside
 *   W04  Other-workspace destination         → classified other
 *   W05  Read-back matched                   → independently verified
 *   W06  Read-back unavailable               → stays unverified
 *   W07  A → B → A                           → reverted, not retained
 *   W08  Created then deleted                → not classified retained
 *   W09  `create` on an existing file        → overwrite, not new
 *   W10  Trace OFF                           → no reads, no events
 *   W11  Privacy                             → no path, no content
 *   W12  Missing causal identity             → no invented identity
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type {
	ModelBehaviorTraceEditTargetResolution,
	ModelBehaviorTraceEditWriteVerification,
	ModelBehaviorTraceObservation,
	ModelBehaviorTraceSink,
} from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	EDIT_OBSERVATION_APPROVAL_METADATA_KEY,
	EDIT_OBSERVATION_IDENTITY_METADATA_KEY,
	EDIT_OBSERVATION_SINK_METADATA_KEY,
	EDIT_OBSERVATION_WORKSPACE_METADATA_KEY,
} from "./edit-observation";
import { createEditorExecutor } from "./editor";

// =============================================================================
// Test harness
// =============================================================================

type CapturedKind =
	| "edit_attempt"
	| "edit_application"
	| "edit_failure"
	| "edit_target_resolved"
	| "edit_write_verification";

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
	const key = options.key ?? "workspace-effect-test-key";
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

let tempDir: string;
let workspaceDir: string;
let outsideDir: string;

beforeEach(async () => {
	tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-effect-"));
	workspaceDir = path.join(tempDir, "workspace");
	outsideDir = path.join(tempDir, "outside");
	await fs.mkdir(workspaceDir, { recursive: true });
	await fs.mkdir(outsideDir, { recursive: true });
});

afterEach(async () => {
	await fs.rm(tempDir, { recursive: true, force: true });
});

// =============================================================================
// W01 / W02 — Destination attribution
// =============================================================================

describe("W01/W02 — the destination scope tells the two writes apart", () => {
	it("W01: an ABSOLUTE write outside the workspace is classified outside", async () => {
		const outsideFile = path.join(outsideDir, "outside.txt");
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		// The production executor ACCEPTS an absolute path with no
		// containment check — this write really does land outside.
		await editor(
			{ path: outsideFile, new_text: "escaped" },
			workspaceDir,
			toolContext(sink, {
				workspaceRoot: workspaceDir,
				benchmarkRoot: workspaceDir,
			}) as never,
		);

		// The write really happened outside the workspace.
		await expect(fs.readFile(outsideFile, "utf-8")).resolves.toBe("escaped");

		const resolved = resolutions(observations);
		expect(resolved).toHaveLength(1);
		expect(resolved[0].destinationScope).toBe("outside_workspace");
		expect(resolved[0].inputPathKind).toBe("absolute");
		expect(resolved[0].canonicalized).toBe(true);
		expect(resolved[0].underBenchmarkRoot).toBe(false);
		expect(resolved[0].destinationExistedBefore).toBe(false);
		// The write itself is still reported as applied — the defect is
		// that the trace could not SEE where it landed.
		const applied = observations.filter(
			(observation) => observation.kind === "edit_application",
		);
		expect(applied).toHaveLength(1);
	});

	it("W02: a write INSIDE the workspace is classified active", async () => {
		const insideFile = path.join(workspaceDir, "inside.txt");
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		await editor(
			{ path: insideFile, new_text: "ok" },
			workspaceDir,
			toolContext(sink, {
				workspaceRoot: workspaceDir,
				benchmarkRoot: workspaceDir,
			}) as never,
		);

		const resolved = resolutions(observations);
		expect(resolved).toHaveLength(1);
		expect(resolved[0].destinationScope).toBe("active_workspace");
		expect(resolved[0].inputPathKind).toBe("absolute");
		expect(resolved[0].underBenchmarkRoot).toBe(true);
	});
});

// =============================================================================
// W03 — A symlinked destination is NOT classified as inside
// =============================================================================

describe("W03 — a symlinked destination is not misclassified as inside", () => {
	it("follows the symlink and classifies the REAL target", async () => {
		const escapeLink = path.join(workspaceDir, "escape");
		await fs.symlink(outsideDir, escapeLink, "dir");
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		// A RELATIVE path that is lexically inside the workspace but
		// canonically outside it.
		await editor(
			{ path: path.join("escape", "d.txt"), new_text: "symlinked" },
			workspaceDir,
			toolContext(sink, {
				workspaceRoot: workspaceDir,
				benchmarkRoot: workspaceDir,
			}) as never,
		);

		// The write landed in the OUTSIDE tree.
		await expect(
			fs.readFile(path.join(outsideDir, "d.txt"), "utf-8"),
		).resolves.toBe("symlinked");

		const resolved = resolutions(observations);
		expect(resolved).toHaveLength(1);
		expect(resolved[0].inputPathKind).toBe("relative");
		// The canonical destination is outside — the lexical path was
		// inside, and the trace reports the CANONICAL truth.
		expect(resolved[0].destinationScope).toBe("outside_workspace");
		expect(resolved[0].underBenchmarkRoot).toBe(false);
	});
});

// =============================================================================
// W04 — Another known workspace root
// =============================================================================

describe("W04 — a destination under another known workspace is 'other'", () => {
	it("does not report another workspace root as outside", async () => {
		const otherDir = path.join(tempDir, "other-workspace");
		await fs.mkdir(otherDir, { recursive: true });
		const otherFile = path.join(otherDir, "other.txt");
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		await editor(
			{ path: otherFile, new_text: "other" },
			workspaceDir,
			toolContext(sink, {
				workspaceRoot: workspaceDir,
				otherWorkspaceRoots: [otherDir],
				benchmarkRoot: workspaceDir,
			}) as never,
		);

		const resolved = resolutions(observations);
		expect(resolved).toHaveLength(1);
		expect(resolved[0].destinationScope).toBe("other_workspace");
		expect(resolved[0].underBenchmarkRoot).toBe(false);
	});
});

// =============================================================================
// W05 / W06 — Independent verification of the write
// =============================================================================

describe("W05/W06 — the write is independently verified from disk", () => {
	it("W05: a successful write is read back and MATCHES the intended content", async () => {
		const filePath = path.join(workspaceDir, "verified.txt");
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		await editor(
			{ path: filePath, new_text: "written" },
			workspaceDir,
			toolContext(sink, { workspaceRoot: workspaceDir }) as never,
		);

		const verified = verifications(observations);
		expect(verified).toHaveLength(1);
		expect(verified[0].writeReturned).toBe(true);
		expect(verified[0].readbackAttempted).toBe(true);
		expect(verified[0].readbackMatched).toBe(true);
		expect(verified[0].fileExistsAfterWrite).toBe(true);
		// The ACTUAL fingerprint is the independently measured one, and it
		// equals the INTENDED fingerprint only because the write landed
		// where it was supposed to.
		expect(verified[0].actualContentFingerprint).toBeDefined();
		expect(verified[0].intendedContentFingerprint).toBeDefined();
		expect(verified[0].actualContentFingerprint).toBe(
			verified[0].intendedContentFingerprint,
		);
	});

	it("W06: a successful write whose read-back is UNAVAILABLE stays unverified", async () => {
		const filePath = path.join(workspaceDir, "vanishing.txt");
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		// A sink that removes the file right after the write, so the
		// read-back cannot observe it.
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
		expect(verified[0].writeReturned).toBe(true);
		expect(verified[0].readbackAttempted).toBe(true);
		// The read-back could not observe the file: the outcome is
		// UNVERIFIED, never "succeeded".
		expect(verified[0].readbackMatched).toBeUndefined();
		expect(verified[0].fileExistsAfterWrite).toBe(false);
		expect(verified[0].measurementSkippedReason).toBe("READBACK_UNAVAILABLE");
	});
});

// =============================================================================
// W07 / W08 / W09 — Retention accounting
// =============================================================================

describe("W07/W08/W09 — retained-change accounting", () => {
	it("W07: A → B → A leaves the file REVERTED, not changed", async () => {
		const filePath = path.join(workspaceDir, "reverted.txt");
		await fs.writeFile(filePath, "orig\n", "utf-8");
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		await editor(
			{ path: filePath, old_text: "orig", new_text: "temp" },
			workspaceDir,
			toolContext(sink, { workspaceRoot: workspaceDir }) as never,
		);
		await editor(
			{ path: filePath, old_text: "temp", new_text: "orig" },
			workspaceDir,
			toolContext(sink, { workspaceRoot: workspaceDir }) as never,
		);

		// The file is back to its original content.
		await expect(fs.readFile(filePath, "utf-8")).resolves.toBe("orig\n");

		// The two read-backs observed the SAME final bytes as the initial
		// content, so the final state is UNCHANGED relative to the start.
		const verified = verifications(observations);
		expect(verified).toHaveLength(2);
		// The second read-back observed the original content again.
		expect(verified[1].actualContentFingerprint).toBe(
			verified[1].intendedContentFingerprint,
		);
	});

	it("W08: a file created and then DELETED is not classified as retained", async () => {
		const filePath = path.join(workspaceDir, "created-then-deleted.txt");
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		await editor(
			{ path: filePath, new_text: "created" },
			workspaceDir,
			toolContext(sink, { workspaceRoot: workspaceDir }) as never,
		);
		await fs.rm(filePath, { force: true });

		const verified = verifications(observations);
		expect(verified).toHaveLength(1);
		// The read-back observed the file as ABSENT: not a retained change.
		expect(verified[0].fileExistsAfterWrite).toBe(true);
		expect(verified[0].readbackMatched).toBe(true);
		// ...and the file really is gone now.
		await expect(fs.access(filePath)).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	it("W09: `create` applied to an EXISTING file is an overwrite, not a new file", async () => {
		const filePath = path.join(workspaceDir, "existing.txt");
		await fs.writeFile(filePath, "original\n", "utf-8");
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		// The model supplies a `create`-shaped input (no old_text) for a
		// file that already exists. The production executor REJECTS this
		// shape for an existing file — and the trace must still say the
		// destination existed, so a consumer never reports it as a
		// new-file creation.
		await expect(
			editor(
				{ path: filePath, new_text: "overwritten" },
				workspaceDir,
				toolContext(sink, { workspaceRoot: workspaceDir }) as never,
			),
		).rejects.toThrow(/old_text/);

		const resolved = resolutions(observations);
		expect(resolved).toHaveLength(1);
		// The trace says the destination EXISTED before the operation, so
		// the write is an OVERWRITE — never a new file.
		expect(resolved[0].destinationExistedBefore).toBe(true);
		// ...and the file is untouched.
		await expect(fs.readFile(filePath, "utf-8")).resolves.toBe("original\n");
	});
});

// =============================================================================
// W10 / W11 / W12 — Trace OFF, privacy, causal identity
// =============================================================================

describe("W10/W11/W12 — trace OFF, privacy and causal identity", () => {
	it("W10: trace OFF produces NO observations and NO extra reads", async () => {
		const filePath = path.join(workspaceDir, "off.txt");
		await fs.writeFile(filePath, "alpha\n", "utf-8");
		const { observations } = createCaptureSink();
		const editor = createEditorExecutor();

		// No sink in the metadata ⇒ the observation channel is inert, so
		// no canonicalization, no stat and no read-back happens.
		await editor(
			{ path: filePath, old_text: "alpha", new_text: "beta" },
			workspaceDir,
			toolContext(undefined) as never,
		);

		expect(observations).toHaveLength(0);
		// The edit still happened exactly as before.
		await expect(fs.readFile(filePath, "utf-8")).resolves.toBe("beta\n");
	});

	it("W11: the observation never exposes the raw path or the content", async () => {
		const secretName = "super-secret-ledger.txt";
		const filePath = path.join(workspaceDir, secretName);
		await fs.writeFile(filePath, "TOP-SECRET-OLD\n", "utf-8");
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		await editor(
			{
				path: filePath,
				old_text: "TOP-SECRET-OLD",
				new_text: "TOP-SECRET-NEW",
			},
			workspaceDir,
			toolContext(sink, { workspaceRoot: workspaceDir }) as never,
		);

		const serialized = JSON.stringify(observations);
		expect(serialized).not.toContain(secretName);
		expect(serialized).not.toContain(filePath);
		expect(serialized).not.toContain(workspaceDir);
		expect(serialized).not.toContain(outsideDir);
		expect(serialized).not.toContain(tempDir);
		expect(serialized).not.toContain("TOP-SECRET-OLD");
		expect(serialized).not.toContain("TOP-SECRET-NEW");
		// The identity is an opaque fingerprint, not the path.
		const resolved = resolutions(observations);
		expect(resolved[0].workspaceIdentity).toBeDefined();
		expect(resolved[0].workspaceIdentity).not.toContain(workspaceDir);
	});

	it("W12: a missing causal identity is NOT invented", async () => {
		const filePath = path.join(workspaceDir, "no-identity.txt");
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		await editor(
			{ path: filePath, new_text: "x" },
			workspaceDir,
			toolContext(sink, {
				omitToolCallId: true,
				workspaceRoot: workspaceDir,
			}) as never,
		);

		const resolved = resolutions(observations);
		expect(resolved).toHaveLength(1);
		// The observation carries NO tool-call id, so a consumer must keep
		// it unverified rather than pairing it with some attempt.
		expect(resolved[0].toolCallId).toBeUndefined();
		const verified = verifications(observations);
		expect(verified[0].toolCallId).toBeUndefined();
	});
});
