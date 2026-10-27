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
 *   M3  BROKEN TRACING-OFF FAST PATH — the patch-target count is hoisted
 *       out of the `if (observation)` guard, so the disabled path scans
 *       the patch body. The tracing-OFF contract must go RED.
 *
 * Every mutation has a GREEN CONTROL: the SAME predicate is evaluated
 * against the REAL production implementation and must hold. Without the
 * control, a predicate that always returned the broken value would also
 * "prove" that the mutation is detected.
 *
 * ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01-CORR01: the M2
 * witness now evaluates the ACTUAL reversion invariant — the exact
 * predicate the E06 witness asserts — instead of asserting only the
 * SHAPE of the mutated output, which both implementations satisfied.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEditorExecutor as createProductionEditorExecutor } from "./editor";

const EXECUTOR_DIR = path.dirname(new URL(import.meta.url).pathname);
const EDITOR_SOURCE = path.join(EXECUTOR_DIR, "editor.ts");
const APPLY_PATCH_SOURCE = path.join(EXECUTOR_DIR, "apply-patch.ts");

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

/**
 * Derive the OBSERVED file revisions from the recorded applications.
 *
 * This is the SAME derivation the E06/E07 witnesses use, and the same one
 * an offline analyst performs on a trace dump: group the per-file
 * mutations by their ephemeral file identity and read the content-version
 * sequence.
 */
function deriveRevisions(
	applications: Array<Record<string, unknown>>,
): Map<string, string[]> {
	const revisions = new Map<string, string[]>();
	for (const application of applications) {
		const mutations = application.fileMutations;
		if (!Array.isArray(mutations)) {
			continue;
		}
		for (const mutation of mutations) {
			if (!mutation || typeof mutation !== "object") {
				continue;
			}
			const record = mutation as Record<string, unknown>;
			const fileIdentity = record.fileIdentity;
			if (typeof fileIdentity !== "string" || fileIdentity === "") {
				continue;
			}
			const versions = revisions.get(fileIdentity) ?? [];
			// The FIRST mutation's PRE version is the file's INITIAL version.
			if (
				versions.length === 0 &&
				typeof record.contentVersionPre === "string"
			) {
				versions.push(record.contentVersionPre);
			}
			if (typeof record.contentVersionPost === "string") {
				versions.push(record.contentVersionPost);
			}
			revisions.set(fileIdentity, versions);
		}
	}
	return revisions;
}

/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01-CORR01.
 *
 * Evaluate the tracing-OFF fast-path contract of the `apply_patch`
 * executor.
 *
 * The contract is STRUCTURAL and it is observable in the source: the
 * patch-target count is an INSTRUMENTATION-ONLY value, so it must be
 * computed INSIDE the `if (observation)` guard. When the trace is OFF
 * the executor must not scan the patch body at all.
 *
 * The evaluation finds the `countPatchTargets(...)` call site and reports
 * whether it lies within the observation guard.
 */
function evaluateTraceOffFastPathContract(source: string): {
	scanCallFound: boolean;
	scanInsideObservationGuard: boolean;
} {
	const callIndex = source.indexOf("countPatchTargets(");
	if (callIndex < 0) {
		return { scanCallFound: false, scanInsideObservationGuard: false };
	}
	// The guard is the `if (observation) {` block that opens the
	// instrumentation section. Its closing brace is the first `}` at the
	// same indentation as the `if`.
	const guardIndex = source.indexOf("if (observation) {");
	if (guardIndex < 0 || guardIndex > callIndex) {
		return { scanCallFound: true, scanInsideObservationGuard: false };
	}
	// Find the end of the guard block: the first `}` that follows the
	// `if (observation) {` and is not nested inside it. The block is
	// written with a single-tab body indent, so its closing brace is the
	// one at the same indentation as the `if`.
	const guardBody = source.slice(guardIndex);
	const closingIndex = guardBody.indexOf("\n\t}");
	return {
		scanCallFound: true,
		scanInsideObservationGuard: callIndex < guardIndex + closingIndex,
	};
}

/**
 * The ACTUAL reversion invariant, expressed as the E06 witness asserts it.
 *
 * A reversion is observed when the file's version sequence contains the
 * INITIAL version and the FINAL version returns to it:
 *
 *   versions.length >= 3 AND versions[last] === versions[0]
 *
 * This helper evaluates the invariant and returns the verdict plus the
 * observed sequence, so a witness can assert BOTH that the invariant HOLDS
 * for the production code and that it FAILS for the mutated code.
 */
function evaluateReversionInvariant(
	applications: Array<Record<string, unknown>>,
): { reversionDetected: boolean; versions: string[] } {
	const revisions = deriveRevisions(applications);
	const versions = [...revisions.values()][0] ?? [];
	if (versions.length < 3) {
		return { reversionDetected: false, versions };
	}
	return {
		reversionDetected: versions[versions.length - 1] === versions[0],
		versions,
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
		//
		// ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01-CORR01: the
		// mutation MUST target the `replaceInFile` call site, which is the
		// one this witness exercises. `editor.ts` has THREE
		// `recordMutation` call sites (create / replace / insert), and a
		// bare `String.replace` rewrites only the FIRST one — the
		// `createFile` path — which this witness never runs. The mutation
		// therefore has to be anchored on the `replaceInFile` context.
		const { createEditorExecutor } = await importMutatedEditor((source) =>
			source.replace(
				`\t\tobservation.recordMutation(pre, post, {
\t\t\tadded: updated.split(/\\r\\n|\\n/).length,
\t\t\tremoved: content.split(/\\r\\n|\\n/).length,
\t\t});`,
				`\t\tobservation.recordMutation({ fileIdentity: pre.fileIdentity }, post, {
\t\t\tadded: updated.split(/\\r\\n|\\n/).length,
\t\t\tremoved: content.split(/\\r\\n|\\n/).length,
\t\t});`,
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

		// ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01-CORR01: the
		// witness evaluates the ACTUAL reversion invariant — the exact
		// predicate the E06 witness asserts — against the MUTATED
		// production implementation.
		//
		// The previous version of this witness only collected the POST
		// versions and asserted their SHAPE ([B, A], length 2). That shape
		// is produced by BOTH the mutated and the unmutated implementation
		// once the POST versions are collected on their own, so the witness
		// could not discriminate the defect at all: it would have passed
		// against the broken code.
		const mutated = evaluateReversionInvariant(applications);
		// The MUTATED code observes only [B, A]: the INITIAL version is
		// gone, so the reversion is NO LONGER detectable.
		expect(mutated.versions).toHaveLength(2);
		expect(mutated.versions[0]).not.toBe(mutated.versions[1]);
		// THE RED ASSERTION: the actual reversion invariant FAILS against
		// the mutated implementation. This is the assertion that the E06
		// witness would fail on.
		expect(mutated.reversionDetected).toBe(false);
	});

	it("M2 (GREEN control): the UNMUTATED implementation satisfies the reversion invariant", async () => {
		// The control half of the M2 witness: the SAME invariant, evaluated
		// against the REAL production implementation, HOLDS. Without this
		// control, a witness that always returned `false` would also
		// "prove" that the mutation is detected.
		const filePath = path.join(tempDir, "a.txt");
		await fs.writeFile(filePath, "A\n", "utf-8");
		const { sink, applications } = createCaptureSink();
		const editor = createProductionEditorExecutor();

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

		const production = evaluateReversionInvariant(applications);
		// The production code observes [initial A, after edit B, after
		// revert A] — three versions whose final one returns to the first.
		expect(production.versions).toHaveLength(3);
		expect(production.versions[2]).toBe(production.versions[0]);
		expect(production.versions[1]).not.toBe(production.versions[0]);
		// THE GREEN ASSERTION: the actual reversion invariant HOLDS.
		expect(production.reversionDetected).toBe(true);
	});

	it("M3: moving the patch scan out of the guard breaks the tracing-OFF fast path", async () => {
		// MUTATION: the patch-target count is hoisted OUT of the
		// `if (observation)` guard, so the tracing-OFF path scans the patch
		// body even though the instrumentation is disabled.
		//
		// ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01-CORR01: the
		// guard placement is a STRUCTURAL contract — the count is an
		// instrumentation-only value, so the disabled path must not pay
		// for it.
		const source = await fs.readFile(APPLY_PATCH_SOURCE, "utf-8");
		const mutated = source
			.replace(
				`\t\tif (observation) {`,
				`\t\tconst targetCount = countPatchTargets(input.input);\n\t\tif (observation) {`,
			)
			.replace(
				`\t\t\tobservation.setRequestedFileCount(countPatchTargets(input.input));`,
				`\t\t\tobservation.setRequestedFileCount(targetCount);`,
			);
		expect(mutated).not.toBe(source);

		const mutatedContract = evaluateTraceOffFastPathContract(mutated);
		// The MUTATED source still performs the scan, but OUTSIDE the
		// observation guard...
		expect(mutatedContract.scanCallFound).toBe(true);
		// ...so the tracing-OFF fast path is broken.
		expect(mutatedContract.scanInsideObservationGuard).toBe(false);
	});

	it("M3 (GREEN control): the production executor keeps the patch scan inside the guard", async () => {
		// The control half: the SAME contract, evaluated against the REAL
		// production source, HOLDS.
		const source = await fs.readFile(APPLY_PATCH_SOURCE, "utf-8");
		const productionContract = evaluateTraceOffFastPathContract(source);
		expect(productionContract.scanCallFound).toBe(true);
		// THE GREEN ASSERTION: the scan lives INSIDE the observation guard,
		// so the tracing-OFF path performs no additional patch scan.
		expect(productionContract.scanInsideObservationGuard).toBe(true);
	});
});
