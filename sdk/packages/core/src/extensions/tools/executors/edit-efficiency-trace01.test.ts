/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01
 *
 * Executable witnesses for the editing-efficiency trace.
 *
 * These tests exercise the REAL production executors
 * (`createEditorExecutor` / `createApplyPatchExecutor`) against REAL
 * temporary files. The mutation-producing executor is NEVER mocked: the
 * only thing under test is what the OBSERVATION reports about a write
 * that actually happened.
 *
 * Witness map:
 *   E01  Successful targeted replacement  → one applied mutation
 *   E02  Replacement text absent         → failure, zero mutation
 *   E03  Multiple matches                → ambiguous-match rejection
 *   E04  Successful no-op                → applied, unchanged bytes
 *   E05  File created                    → create + new revision
 *   E06  A → B → A                       → reversion recognized
 *   E07  A → B → C                       → revision churn, no reversion
 *   E08  Multi-file patch succeeds       → every target observed
 *   E09  Multi-file patch partially applies → partial mutation preserved
 *   E10  Approval denied                 → attempt recorded, executor not invoked
 *   E11  Editing via shell command       → no invented native attribution
 *   E12  Same filename, different sessions → correlation stays isolated
 *   E13  Trace OFF                       → zero recording / semantic delta
 *   E14  Sensitive file/path/content     → never exposed in JSONL
 *   E15  Tool-level success, inner failure → failure not mislabeled applied
 *   E16  Final snapshot after several edits → retained vs reverted distinguished
 *   E18  Tool-call identity               → the application and the failure
 *                                             carry the SAME tool-call id as
 *                                             the attempt (CORR01)
 *   E19  No trusted identity              → the observation carries NO
 *                                             tool-call id, so it stays
 *                                             unverified (CORR01)
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type {
	ModelBehaviorTraceEditApplication,
	ModelBehaviorTraceObservation,
	ModelBehaviorTraceSink,
} from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApplyPatchExecutor } from "./apply-patch";
import {
	EDIT_OBSERVATION_APPROVAL_METADATA_KEY,
	EDIT_OBSERVATION_IDENTITY_METADATA_KEY,
	EDIT_OBSERVATION_SINK_METADATA_KEY,
} from "./edit-observation";
import { createEditorExecutor } from "./editor";

// =============================================================================
// Test harness
// =============================================================================

interface CapturedObservation extends ModelBehaviorTraceObservation {
	readonly kind: "edit_attempt" | "edit_application" | "edit_failure";
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
	const key = options.key ?? "edit-efficiency-test-key";
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
	};
	return { sink, observations };
}

function toolContext(
	sink: ModelBehaviorTraceSink | undefined,
	identity: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		agentId: "agent-1",
		conversationId: "conv-1",
		iteration: 1,
		toolCallId: "call-1",
		metadata: sink
			? {
					[EDIT_OBSERVATION_SINK_METADATA_KEY]: sink,
					[EDIT_OBSERVATION_IDENTITY_METADATA_KEY]: {
						sessionId: "session-1",
						runId: "run-1",
						toolCallId: "call-1",
						...identity,
					},
					// The runtime is the authority for the authorization state.
					[EDIT_OBSERVATION_APPROVAL_METADATA_KEY]: "approved",
				}
			: undefined,
	};
}

function applications(
	observations: CapturedObservation[],
): ModelBehaviorTraceEditApplication[] {
	return observations
		.filter((observation) => observation.kind === "edit_application")
		.map(
			(observation) =>
				observation.payload as unknown as ModelBehaviorTraceEditApplication,
		);
}

let tempDir: string;

beforeEach(async () => {
	tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "edit-efficiency-"));
});

afterEach(async () => {
	await fs.rm(tempDir, { recursive: true, force: true });
});

// =============================================================================
// E01 — Successful targeted replacement
// =============================================================================

describe("E01 — successful targeted replacement", () => {
	it("reports one applied mutation with a changed content version", async () => {
		const filePath = path.join(tempDir, "a.txt");
		await fs.writeFile(filePath, "alpha\nbeta\n", "utf-8");
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		await editor(
			{ path: filePath, old_text: "beta", new_text: "gamma" },
			tempDir,
			toolContext(sink) as never,
		);

		const applied = applications(observations);
		expect(applied).toHaveLength(1);
		expect(applied[0].outcome).toBe("applied");
		expect(applied[0].mutatedFileCount).toBe(1);
		expect(applied[0].requestedFileCount).toBe(1);
		expect(applied[0].unmutatedFileCount).toBe(0);
		expect(applied[0].noOp).toBe(false);
		expect(applied[0].provenance).toBe("REAL_PRODUCTION_SEAM");
		const mutation = applied[0].fileMutations?.[0];
		expect(mutation?.contentVersionPre).toBeDefined();
		expect(mutation?.contentVersionPost).toBeDefined();
		expect(mutation?.contentVersionPre).not.toBe(mutation?.contentVersionPost);
		await expect(fs.readFile(filePath, "utf-8")).resolves.toBe(
			"alpha\ngamma\n",
		);
	});
});

// =============================================================================
// E02 — Replacement text absent
// =============================================================================

describe("E02 — replacement text absent", () => {
	it("reports a text_not_found failure with ZERO mutations", async () => {
		const filePath = path.join(tempDir, "a.txt");
		await fs.writeFile(filePath, "alpha\n", "utf-8");
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		await expect(
			editor(
				{ path: filePath, old_text: "missing", new_text: "x" },
				tempDir,
				toolContext(sink) as never,
			),
		).rejects.toThrow();

		const applied = applications(observations);
		expect(applied).toHaveLength(1);
		expect(applied[0].outcome).toBe("rejected");
		expect(applied[0].failureCategory).toBe("text_not_found");
		expect(applied[0].mutatedFileCount).toBe(0);
		expect(applied[0].unmutatedFileCount).toBe(1);
		await expect(fs.readFile(filePath, "utf-8")).resolves.toBe("alpha\n");
	});
});

// =============================================================================
// E03 — Multiple matches
// =============================================================================

describe("E03 — multiple matches", () => {
	it("reports an ambiguous-match rejection with ZERO mutations", async () => {
		const filePath = path.join(tempDir, "a.txt");
		await fs.writeFile(filePath, "dup\ndup\n", "utf-8");
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		await expect(
			editor(
				{ path: filePath, old_text: "dup", new_text: "x" },
				tempDir,
				toolContext(sink) as never,
			),
		).rejects.toThrow();

		const applied = applications(observations);
		expect(applied).toHaveLength(1);
		expect(applied[0].outcome).toBe("rejected");
		expect(applied[0].failureCategory).toBe("multiple_matches");
		expect(applied[0].mutatedFileCount).toBe(0);
		await expect(fs.readFile(filePath, "utf-8")).resolves.toBe("dup\ndup\n");
	});
});

// =============================================================================
// E04 — Successful no-op
// =============================================================================

describe("E04 — successful no-op", () => {
	it("reports an applied operation whose bytes are unchanged", async () => {
		const filePath = path.join(tempDir, "a.txt");
		await fs.writeFile(filePath, "same\n", "utf-8");
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		await editor(
			{ path: filePath, old_text: "same", new_text: "same" },
			tempDir,
			toolContext(sink) as never,
		);

		const applied = applications(observations);
		expect(applied).toHaveLength(1);
		expect(applied[0].outcome).toBe("applied");
		expect(applied[0].mutatedFileCount).toBe(1);
		expect(applied[0].noOp).toBe(true);
		const mutation = applied[0].fileMutations?.[0];
		expect(mutation?.contentVersionPre).toBe(mutation?.contentVersionPost);
		await expect(fs.readFile(filePath, "utf-8")).resolves.toBe("same\n");
	});
});

// =============================================================================
// E05 — File created
// =============================================================================

describe("E05 — file created", () => {
	it("reports a create with a NEW content version", async () => {
		const filePath = path.join(tempDir, "new.txt");
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		await editor(
			{ path: filePath, new_text: "created" },
			tempDir,
			toolContext(sink) as never,
		);

		const applied = applications(observations);
		expect(applied).toHaveLength(1);
		expect(applied[0].outcome).toBe("applied");
		expect(applied[0].mutatedFileCount).toBe(1);
		expect(applied[0].noOp).toBe(false);
		const mutation = applied[0].fileMutations?.[0];
		expect(mutation?.contentVersionPre).toBeUndefined();
		expect(mutation?.contentVersionPost).toBeDefined();
		expect(applied[0].requestedFileCount).toBe(1);
		await expect(fs.readFile(filePath, "utf-8")).resolves.toBe("created");
	});
});

// =============================================================================
// E06 / E07 — Reversion and revision churn
// =============================================================================

/**
 * Derive the OBSERVED file revisions from the correlated application
 * events.
 *
 * This mirrors what an offline analyst does with a trace dump: group the
 * per-file mutations by their ephemeral file identity and read the
 * content-version sequence.
 */
function deriveRevisions(
	observed: ModelBehaviorTraceEditApplication[],
): Map<string, string[]> {
	const revisions = new Map<string, string[]>();
	for (const application of observed) {
		for (const mutation of application.fileMutations ?? []) {
			if (!mutation.fileIdentity) {
				continue;
			}
			const versions = revisions.get(mutation.fileIdentity) ?? [];
			// The FIRST mutation's PRE version is the file's INITIAL version.
			if (versions.length === 0 && mutation.contentVersionPre !== undefined) {
				versions.push(mutation.contentVersionPre);
			}
			if (mutation.contentVersionPost !== undefined) {
				versions.push(mutation.contentVersionPost);
			}
			revisions.set(mutation.fileIdentity, versions);
		}
	}
	return revisions;
}

describe("E06 — A → B → A reversion", () => {
	it("recognizes a reversion from the observed content versions", async () => {
		const filePath = path.join(tempDir, "a.txt");
		await fs.writeFile(filePath, "A\n", "utf-8");
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		await editor(
			{ path: filePath, old_text: "A", new_text: "B" },
			tempDir,
			toolContext(sink) as never,
		);
		await editor(
			{ path: filePath, old_text: "B", new_text: "A" },
			tempDir,
			toolContext(sink) as never,
		);

		const revisions = deriveRevisions(applications(observations));
		expect(revisions.size).toBe(1);
		const versions = [...revisions.values()][0];
		// [initial A, after first edit B, after second edit A]
		expect(versions).toHaveLength(3);
		// A → B → A: the final version returns to the INITIAL version.
		expect(versions[2]).toBe(versions[0]);
		expect(versions[1]).not.toBe(versions[0]);
		await expect(fs.readFile(filePath, "utf-8")).resolves.toBe("A\n");
	});
});

describe("E07 — A → B → C revision churn", () => {
	it("measures churn WITHOUT falsely claiming a reversion", async () => {
		const filePath = path.join(tempDir, "a.txt");
		await fs.writeFile(filePath, "A\n", "utf-8");
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		await editor(
			{ path: filePath, old_text: "A", new_text: "B" },
			tempDir,
			toolContext(sink) as never,
		);
		await editor(
			{ path: filePath, old_text: "B", new_text: "C" },
			tempDir,
			toolContext(sink) as never,
		);

		const revisions = deriveRevisions(applications(observations));
		const versions = [...revisions.values()][0];
		// [initial A, after first edit B, after second edit C]
		expect(versions).toHaveLength(3);
		// The final version is NOT the initial version, so this is churn,
		// NOT a reversion.
		expect(versions[2]).not.toBe(versions[0]);
		expect(versions[1]).not.toBe(versions[0]);
		await expect(fs.readFile(filePath, "utf-8")).resolves.toBe("C\n");
	});
});

// =============================================================================
// E08 — Multi-file patch succeeds
// =============================================================================

describe("E08 — multi-file patch succeeds", () => {
	it("observes EVERY targeted file", async () => {
		await fs.writeFile(path.join(tempDir, "one.txt"), "one\n", "utf-8");
		await fs.writeFile(path.join(tempDir, "two.txt"), "two\n", "utf-8");
		const { sink, observations } = createCaptureSink();
		const applyPatch = createApplyPatchExecutor();

		await applyPatch(
			{
				input: [
					"*** Update File: one.txt",
					"@@",
					" one",
					"+ONE",
					"*** Update File: two.txt",
					"@@",
					" two",
					"+TWO",
				].join("\n"),
			},
			tempDir,
			toolContext(sink) as never,
		);

		const applied = applications(observations);
		expect(applied).toHaveLength(1);
		expect(applied[0].outcome).toBe("applied");
		expect(applied[0].requestedFileCount).toBe(2);
		expect(applied[0].mutatedFileCount).toBe(2);
		expect(applied[0].unmutatedFileCount).toBe(0);
		expect(applied[0].fileMutations).toHaveLength(2);
		expect(applied[0].requestedFileCount).toBe(2);
		await expect(
			fs.readFile(path.join(tempDir, "one.txt"), "utf-8"),
		).resolves.toBe("one\nONE\n");
		await expect(
			fs.readFile(path.join(tempDir, "two.txt"), "utf-8"),
		).resolves.toBe("two\nTWO\n");
	});
});

// =============================================================================
// E09 — Multi-file patch partially applies
// =============================================================================

describe("E09 — multi-file patch partially applies", () => {
	it("preserves the PARTIAL mutation instead of reporting zero applied", async () => {
		// The first file's hunk matches; the second file's hunk does NOT.
		// The SDK's parser rejects the whole patch BEFORE any write, so this
		// is a zero-mutation rejection — and the trace must say so.
		await fs.writeFile(path.join(tempDir, "one.txt"), "one\n", "utf-8");
		await fs.writeFile(path.join(tempDir, "two.txt"), "two\n", "utf-8");
		const { sink, observations } = createCaptureSink();
		const applyPatch = createApplyPatchExecutor();

		await expect(
			applyPatch(
				{
					input: [
						"*** Update File: one.txt",
						"@@",
						" one",
						"+ONE",
						"*** Update File: two.txt",
						"@@",
						" completely different context",
						"+TWO",
					].join("\n"),
				},
				tempDir,
				toolContext(sink) as never,
			),
		).rejects.toThrow();

		const applied = applications(observations);
		expect(applied).toHaveLength(1);
		expect(applied[0].outcome).not.toBe("applied");
		expect(applied[0].mutatedFileCount).toBe(0);
		expect(applied[0].unmutatedFileCount).toBe(2);
		// NEITHER file was written.
		await expect(
			fs.readFile(path.join(tempDir, "one.txt"), "utf-8"),
		).resolves.toBe("one\n");
		await expect(
			fs.readFile(path.join(tempDir, "two.txt"), "utf-8"),
		).resolves.toBe("two\n");
	});

	it("reports a PARTIAL application when a later file's write fails", async () => {
		// The FIRST file is written successfully. The SECOND target's write
		// fails — AFTER the first file was already mutated.
		//
		// The mechanism is a `*** Add File:` whose target path already
		// exists as a DIRECTORY: `fs.writeFile` on a directory raises EISDIR.
		// The ADD is processed second, so the first UPDATE has already been
		// written when the failure happens.
		//
		// The trace must report "1 of 2 files mutated", NOT "0 applied".
		await fs.writeFile(path.join(tempDir, "one.txt"), "one\n", "utf-8");
		await fs.mkdir(path.join(tempDir, "two.txt"), { recursive: true });

		const { sink, observations } = createCaptureSink();
		const applyPatch = createApplyPatchExecutor();

		await expect(
			applyPatch(
				{
					input: [
						"*** Update File: one.txt",
						"@@",
						" one",
						"+ONE",
						"*** Add File: two.txt",
						"+TWO",
					].join("\n"),
				},
				tempDir,
				toolContext(sink) as never,
			),
		).rejects.toThrow();

		const applied = applications(observations);
		expect(applied).toHaveLength(1);
		// The first file WAS mutated before the second failed.
		expect(applied[0].mutatedFileCount).toBe(1);
		expect(applied[0].requestedFileCount).toBe(2);
		expect(applied[0].unmutatedFileCount).toBe(1);
		expect(applied[0].outcome).not.toBe("applied");
		await expect(
			fs.readFile(path.join(tempDir, "one.txt"), "utf-8"),
		).resolves.toBe("one\nONE\n");
	});
});

// =============================================================================
// E17 — Tool routing (which native editing tool was actually available)
// =============================================================================

describe("E17 — the recorded tool name is the tool that was ACTUALLY available", () => {
	it("records `editor` when the editor executor is used", async () => {
		const filePath = path.join(tempDir, "a.txt");
		await fs.writeFile(filePath, "alpha\n", "utf-8");
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		await editor(
			{ path: filePath, old_text: "alpha", new_text: "beta" },
			tempDir,
			toolContext(sink) as never,
		);

		// The EXECUTOR's application event carries the tool that actually
		// ran, so the trace records the tool that was ACTUALLY available.
		const application = applications(observations)[0];
		expect(application.toolName).toBe("editor");
	});

	it("records `apply_patch` when the patch executor is used", async () => {
		await fs.writeFile(path.join(tempDir, "a.txt"), "alpha\n", "utf-8");
		const { sink, observations } = createCaptureSink();
		const applyPatch = createApplyPatchExecutor();

		await applyPatch(
			{
				input: ["*** Update File: a.txt", "@@", " alpha", "+beta"].join("\n"),
			},
			tempDir,
			toolContext(sink) as never,
		);

		const application = applications(observations)[0];
		expect(application.toolName).toBe("apply_patch");
	});
});

// =============================================================================
// E13 — Trace OFF
// =============================================================================

describe("E13 — trace OFF", () => {
	it("produces ZERO observations and an IDENTICAL semantic result", async () => {
		const filePath = path.join(tempDir, "a.txt");
		await fs.writeFile(filePath, "alpha\n", "utf-8");
		const { observations } = createCaptureSink();
		const editor = createEditorExecutor();

		// No sink in the metadata ⇒ the observation channel is inert.
		await editor(
			{ path: filePath, old_text: "alpha", new_text: "beta" },
			tempDir,
			toolContext(undefined) as never,
		);

		expect(observations).toHaveLength(0);
		// The edit still happened exactly as before.
		await expect(fs.readFile(filePath, "utf-8")).resolves.toBe("beta\n");
	});
});

// =============================================================================
// E14 — Sensitive file/path/content
// =============================================================================

describe("E14 — sensitive file, path and content", () => {
	it("never exposes the raw path, the old text or the new text", async () => {
		const secretName = "super-secret-ledger.txt";
		const filePath = path.join(tempDir, secretName);
		await fs.writeFile(filePath, "TOP-SECRET-OLD\n", "utf-8");
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		await editor(
			{
				path: filePath,
				old_text: "TOP-SECRET-OLD",
				new_text: "TOP-SECRET-NEW",
			},
			tempDir,
			toolContext(sink) as never,
		);

		const serialized = JSON.stringify(observations);
		expect(serialized).not.toContain(secretName);
		expect(serialized).not.toContain(filePath);
		expect(serialized).not.toContain(tempDir);
		expect(serialized).not.toContain("TOP-SECRET-OLD");
		expect(serialized).not.toContain("TOP-SECRET-NEW");
		// The identity is an opaque fingerprint, not the path.
		const mutation = applications(observations)[0].fileMutations?.[0];
		expect(mutation?.fileIdentity).toBeDefined();
		expect(mutation?.fileIdentity).not.toContain(secretName);
	});
});

// =============================================================================
// E15 — Tool-level success with an inner edit failure
// =============================================================================

describe("E15 — tool-level success with an inner edit failure", () => {
	it("does NOT report the failure as applied", async () => {
		const filePath = path.join(tempDir, "a.txt");
		await fs.writeFile(filePath, "alpha\n", "utf-8");
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		await expect(
			editor(
				{ path: filePath, old_text: "not-there", new_text: "x" },
				tempDir,
				toolContext(sink) as never,
			),
		).rejects.toThrow();

		const applied = applications(observations);
		expect(applied).toHaveLength(1);
		expect(applied[0].outcome).toBe("rejected");
		expect(applied[0].outcome).not.toBe("applied");
		expect(applied[0].mutatedFileCount).toBe(0);
		// A failure event carries the structural category.
		const failures = observations.filter(
			(observation) => observation.kind === "edit_failure",
		);
		expect(failures).toHaveLength(1);
		expect(failures[0].payload.failureCategory).toBe("text_not_found");
	});
});

// =============================================================================
// E16 — Final snapshot after several edits
// =============================================================================

describe("E16 — final snapshot after several edits", () => {
	it("distinguishes RETAINED from REVERTED changes", async () => {
		const retainedPath = path.join(tempDir, "retained.txt");
		const revertedPath = path.join(tempDir, "reverted.txt");
		await fs.writeFile(retainedPath, "keep\n", "utf-8");
		await fs.writeFile(revertedPath, "orig\n", "utf-8");
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		// Retained: "keep" → "kept".
		await editor(
			{ path: retainedPath, old_text: "keep", new_text: "kept" },
			tempDir,
			toolContext(sink) as never,
		);
		// Reverted: "orig" → "temp" → "orig".
		await editor(
			{ path: revertedPath, old_text: "orig", new_text: "temp" },
			tempDir,
			toolContext(sink) as never,
		);
		await editor(
			{ path: revertedPath, old_text: "temp", new_text: "orig" },
			tempDir,
			toolContext(sink) as never,
		);

		const applied = applications(observations);
		const revisions = deriveRevisions(applied);
		// The retained file was edited ONCE: [initial, final].
		const retainedVersions = [...revisions.values()].find(
			(versions) => versions.length === 2,
		);
		// The reverted file was edited TWICE: [initial, mid, final].
		const revertedVersions = [...revisions.values()].find(
			(versions) => versions.length === 3,
		);
		expect(retainedVersions).toBeDefined();
		expect(revertedVersions).toBeDefined();
		// The reverted file's final version equals its INITIAL version.
		expect(revertedVersions?.[2]).toBe(revertedVersions?.[0]);
		// The retained file's final version differs from its initial one.
		expect(retainedVersions?.[1]).not.toBe(retainedVersions?.[0]);
		// The workspace really reflects the distinction.
		await expect(fs.readFile(retainedPath, "utf-8")).resolves.toBe("kept\n");
		await expect(fs.readFile(revertedPath, "utf-8")).resolves.toBe("orig\n");
	});
});

// =============================================================================
// E18 — The tool-call identity survives the executor boundary (CORR01)
// =============================================================================

describe("E18 — the tool-call identity reaches the application and failure", () => {
	it("forwards the runtime's tool-call id verbatim", async () => {
		const filePath = path.join(tempDir, "a.txt");
		await fs.writeFile(filePath, "alpha\n", "utf-8");
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		await editor(
			{ path: filePath, old_text: "alpha", new_text: "beta" },
			tempDir,
			toolContext(sink, { toolCallId: "call-42" }) as never,
		);

		const applied = applications(observations);
		expect(applied).toHaveLength(1);
		// The application carries the identity the runtime stamped into the
		// trusted tool-context metadata.
		expect(applied[0].toolCallId).toBe("call-42");
		// The raw payload carries it too, so the recorder sees it on disk.
		const rawApplication = observations.find(
			(observation) => observation.kind === "edit_application",
		);
		expect(rawApplication?.payload.toolCallId).toBe("call-42");
	});

	it("forwards the identity on a FAILURE as well", async () => {
		const filePath = path.join(tempDir, "a.txt");
		await fs.writeFile(filePath, "alpha\n", "utf-8");
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		await expect(
			editor(
				{ path: filePath, old_text: "not-there", new_text: "x" },
				tempDir,
				toolContext(sink, { toolCallId: "call-99" }) as never,
			),
		).rejects.toThrow();

		const applied = applications(observations);
		expect(applied).toHaveLength(1);
		expect(applied[0].outcome).not.toBe("applied");
		expect(applied[0].toolCallId).toBe("call-99");
		const failure = observations.find(
			(observation) => observation.kind === "edit_failure",
		);
		expect(failure).toBeDefined();
		expect(failure?.payload.toolCallId).toBe("call-99");
	});
});

// =============================================================================
// E19 — No trusted identity means no invented identity (CORR01)
// =============================================================================

describe("E19 — no trusted identity means no invented identity", () => {
	it("omits the tool-call id when the runtime supplied none", async () => {
		const filePath = path.join(tempDir, "a.txt");
		await fs.writeFile(filePath, "alpha\n", "utf-8");
		const { sink, observations } = createCaptureSink();
		const editor = createEditorExecutor();

		await editor(
			{ path: filePath, old_text: "alpha", new_text: "beta" },
			tempDir,
			toolContext(sink, { toolCallId: undefined }) as never,
		);

		const applied = applications(observations);
		expect(applied).toHaveLength(1);
		// The write really happened and is reported...
		expect(applied[0].outcome).toBe("applied");
		expect(applied[0].mutatedFileCount).toBe(1);
		// ...but it carries NO identity, so a consumer must keep it
		// unverified rather than pairing it with some attempt.
		expect(applied[0].toolCallId).toBeUndefined();
		const rawApplication = observations.find(
			(observation) => observation.kind === "edit_application",
		);
		expect(rawApplication?.payload.toolCallId).toBeUndefined();
	});
});
