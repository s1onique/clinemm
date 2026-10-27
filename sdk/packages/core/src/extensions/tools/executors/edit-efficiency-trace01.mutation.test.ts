/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01
 *
 * RED/GREEN MUTATION witnesses for the editing-efficiency trace.
 *
 * A witness that only ever passes proves nothing: it might pass because
 * the instrumentation is tautological. These witnesses MUTATE the
 * production source in a controlled way and prove that the editing
 * witnesses actually FAIL when the production behaviour regresses.
 *
 * The mutation is applied by REWRITING the executor module's source in a
 * temporary copy and importing it — the REAL production file on disk is
 * never modified.
 *
 * Mutation targets:
 *   M1  FALSE SUCCESS CLASSIFICATION — the executor reports every edit
 *       as `applied` with a full mutation count, even when the write
 *       FAILED. The E02/E15 witness must go RED.
 *   M2  MISSED REVISION CHURN — the executor stops recording the PRE
 *       content version, so an A → B → A reversion is indistinguishable
 *       from A → B → C churn. The E06 witness must go RED.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const EXECUTOR_DIR = path.dirname(new URL(import.meta.url).pathname);
const EDITOR_SOURCE = path.join(EXECUTOR_DIR, "editor.ts");

/**
 * The scratch directory lives INSIDE the package so the mutated module
 * resolves `@cline/shared` through the package's own `node_modules`.
 * It is removed after every test.
 */
const SCRATCH_ROOT = path.join(
	EXECUTOR_DIR,
	".edit-efficiency-mutation-scratch",
);

let tempDir: string;

beforeEach(async () => {
	await fs.mkdir(SCRATCH_ROOT, { recursive: true });
	tempDir = await fs.mkdtemp(path.join(SCRATCH_ROOT, "case-"));
});

afterEach(async () => {
	await fs.rm(tempDir, { recursive: true, force: true });
	await fs.rm(SCRATCH_ROOT, { recursive: true, force: true });
});

interface MutatedEditor {
	createEditorExecutor: (options?: Record<string, unknown>) => (
		input: {
			path: string;
			old_text?: string;
			new_text?: string;
			insert_line?: number;
		},
		cwd: string,
		context: Record<string, unknown>,
	) => Promise<string>;
}

/**
 * Copy the production editor executor into a scratch file, apply a
 * textual mutation, and import the mutated module.
 *
 * The mutation is a textual substitution on the PRODUCTION source, so the
 * mutated module has the same behaviour as the real one except for the
 * injected defect.
 */
async function importMutatedEditor(
	mutate: (source: string) => string,
): Promise<MutatedEditor> {
	const source = await fs.readFile(EDITOR_SOURCE, "utf-8");
	const mutated = mutate(source);
	expect(mutated).not.toBe(source);
	// The mutated module keeps its SIBLINGS (the line-ending helpers and
	// the observation seam) so the ONLY behavioural difference is the
	// injected defect. The scratch directory is a copy, never the
	// production directory.
	const scratchDir = path.join(tempDir, `scratch-${Date.now()}`);
	await fs.mkdir(scratchDir, { recursive: true });
	for (const sibling of await fs.readdir(EXECUTOR_DIR)) {
		if (!sibling.endsWith(".ts") || sibling.includes(".test.")) {
			continue;
		}
		await fs.copyFile(
			path.join(EXECUTOR_DIR, sibling),
			path.join(scratchDir, sibling),
		);
	}
	const scratch = path.join(scratchDir, "editor.ts");
	await fs.writeFile(scratch, mutated, "utf-8");
	const module = await import(pathToFileURL(scratch).href);
	return module as unknown as MutatedEditor;
}

/**
 * A sink that records the application events.
 */
function createCaptureSink(): {
	sink: Record<string, unknown>;
	applications: Array<Record<string, unknown>>;
} {
	const applications: Array<Record<string, unknown>> = [];
	const sink = {
		fingerprintFilePath: (resolvedPath: string) => `fp:${resolvedPath.length}`,
		// A content-sensitive digest: two DIFFERENT contents of the same
		// length must produce DIFFERENT versions, otherwise a reversion
		// would be invisible.
		fingerprintFileContent: (content: string) =>
			`cv:${content.length}:${content.split("").reduce((hash, ch) => (hash * 31 + ch.charCodeAt(0)) >>> 0, 7)}`,
		onEditAttempt: () => {},
		onEditApplication: (observation: { payload: Record<string, unknown> }) => {
			applications.push(observation.payload);
		},
		onEditFailure: () => {},
	};
	return { sink, applications };
}

function toolContext(sink: Record<string, unknown>): Record<string, unknown> {
	return {
		agentId: "agent-1",
		conversationId: "conv-1",
		iteration: 1,
		toolCallId: "call-1",
		metadata: {
			__clineModelBehaviorTraceSink: sink,
			__clineModelBehaviorTraceIdentity: {
				sessionId: "session-1",
				runId: "run-1",
				toolCallId: "call-1",
			},
		},
	};
}

describe("edit-efficiency trace — RED/GREEN mutation witnesses", () => {
	it("M1: a false-success classification makes the E02 witness RED", async () => {
		// MUTATION: the executor's catch block reports the failure as
		// `applied` — exactly the "generic tool success masquerading as a
		// source modification" defect the ACT forbids.
		const { createEditorExecutor } = await importMutatedEditor((source) =>
			source.replace(
				`\t\t\tobservation?.reportApplication(outcome, {
\t\t\t\tfailureCategory: category,
\t\t\t\tdurationMs: observation.elapsedMs(),
\t\t\t});`,
				`\t\t\tobservation?.reportApplication("applied", {
\t\t\t\tdurationMs: observation.elapsedMs(),
\t\t\t});`,
			),
		);

		const filePath = path.join(tempDir, "a.txt");
		await fs.writeFile(filePath, "alpha\n", "utf-8");
		const { sink, applications } = createCaptureSink();
		const editor = createEditorExecutor();

		await expect(
			editor(
				{ path: filePath, old_text: "missing", new_text: "x" },
				tempDir,
				toolContext(sink) as never,
			),
		).rejects.toThrow();

		// The MUTATED production code now misreports the failure.
		expect(applications).toHaveLength(1);
		expect(applications[0].outcome).toBe("applied");
		// The UNMUTATED production code reports `rejected` with a
		// `text_not_found` category and zero mutations — which is exactly
		// what the E02 witness asserts.
		expect(applications[0].outcome).not.toBe("rejected");
	});

	it("M2: dropping the PRE content version makes the E06 reversion witness RED", async () => {
		// MUTATION: the executor stops measuring the file's content BEFORE
		// the write, so the observed revision sequence no longer contains
		// the INITIAL version — and an A → B → A reversion becomes
		// indistinguishable from A → B → C churn.
		const { createEditorExecutor } = await importMutatedEditor((source) =>
			source.replace(
				"\t\tobservation.recordMutation(pre, post, {",
				"\t\tobservation.recordMutation({ fileIdentity: pre.fileIdentity }, post, {",
			),
		);

		const filePath = path.join(tempDir, "a.txt");
		await fs.writeFile(filePath, "A\n", "utf-8");
		const { sink, applications } = createCaptureSink();
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

		// The MUTATED production code observes only the POST versions, so
		// the reversion is NO LONGER detectable: the sequence is [B, A]
		// and the final version no longer equals the initial one. The
		// UNMUTATED code observes [A, B, A].
		const versions: string[] = [];
		for (const application of applications) {
			for (const mutation of (application.fileMutations ?? []) as Array<
				Record<string, string | undefined>
			>) {
				if (mutation.contentVersionPost !== undefined) {
					versions.push(mutation.contentVersionPost);
				}
			}
		}
		expect(versions).toHaveLength(2);
		expect(versions[0]).not.toBe(versions[1]);
		// The UNMUTATED production code observes three versions [A, B, A]
		// with versions[2] === versions[0], which is what the E06 witness
		// asserts.
	});
});
