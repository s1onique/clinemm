/**
 * Editor Executor
 *
 * Built-in implementation for filesystem editing operations.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentToolContext } from "@cline/shared";
import type { EditFileInput } from "../schemas";
import type { EditorExecutor } from "../types";
import {
	classifyEditFailure,
	type EditObservation,
	EditOperationError,
	readEditObservation,
} from "./edit-observation";
import {
	classifyEditInputPathKind,
	resolveEditDestination,
} from "./edit-target-resolution";
import {
	detectLineEnding,
	normalizeLineEndings,
	normalizeNewFileLineEndings,
} from "./line-endings";

/**
 * Options for the editor executor
 */
export interface EditorExecutorOptions {
	/**
	 * File encoding used for read/write operations
	 * @default "utf-8"
	 */
	encoding?: BufferEncoding;

	/**
	 * Restrict relative-path file operations to paths inside cwd.
	 * Absolute paths are always accepted as-is.
	 * @default true
	 */
	restrictToCwd?: boolean;

	/**
	 * Maximum number of diff lines in str_replace output
	 * @default 200
	 */
	maxDiffLines?: number;
}

function resolveFilePath(
	cwd: string,
	inputPath: string,
	restrictToCwd: boolean,
): string {
	const isAbsoluteInput = path.isAbsolute(inputPath);
	const resolved = isAbsoluteInput
		? path.normalize(inputPath)
		: path.resolve(cwd, inputPath);
	if (!restrictToCwd) {
		return resolved;
	}

	// Absolute paths are accepted directly; cwd restriction applies to relative inputs.
	if (isAbsoluteInput) {
		return resolved;
	}

	const rel = path.relative(cwd, resolved);
	if (rel.startsWith("..") || path.isAbsolute(rel)) {
		throw new Error(`Path must stay within cwd: ${inputPath}`);
	}
	return resolved;
}

function countOccurrences(content: string, needle: string): number {
	if (needle.length === 0) return 0;
	return content.split(needle).length - 1;
}

// Reads produced via readline strip "\r", so models emit LF-only text even
// for CRLF files; edits must be normalized to the file's own EOL (see
// ./line-endings) or they create mixed line endings and break subsequent
// exact-match replacements.

function createLineDiff(
	oldContent: string,
	newContent: string,
	maxLines: number,
): string {
	const oldLines = oldContent.split(/\r\n|\n/);
	const newLines = newContent.split(/\r\n|\n/);

	// Trim the common prefix and suffix so only the changed region is emitted;
	// a naive positional compare would mispair every line after an edit that
	// changes the line count.
	let start = 0;
	while (
		start < oldLines.length &&
		start < newLines.length &&
		oldLines[start] === newLines[start]
	) {
		start++;
	}
	let oldEnd = oldLines.length;
	let newEnd = newLines.length;
	while (
		oldEnd > start &&
		newEnd > start &&
		oldLines[oldEnd - 1] === newLines[newEnd - 1]
	) {
		oldEnd--;
		newEnd--;
	}

	// Split the line budget between removals and additions so neither side is
	// silently dropped when the other alone would exhaust maxLines.
	const removedCount = oldEnd - start;
	const addedCount = newEnd - start;
	let removedBudget = removedCount;
	let addedBudget = addedCount;
	if (removedCount + addedCount > maxLines) {
		removedBudget = Math.min(
			removedCount,
			Math.max(Math.ceil(maxLines / 2), maxLines - addedCount),
		);
		addedBudget = Math.min(addedCount, maxLines - removedBudget);
	}

	const out: string[] = ["```diff"];
	for (let i = start; i < start + removedBudget; i++) {
		out.push(`-${i + 1}: ${oldLines[i]}`);
	}
	for (let i = start; i < start + addedBudget; i++) {
		out.push(`+${i + 1}: ${newLines[i]}`);
	}

	const omittedRemoved = removedCount - removedBudget;
	const omittedAdded = addedCount - addedBudget;
	if (omittedRemoved > 0 || omittedAdded > 0) {
		out.push(
			`... diff truncated (${omittedRemoved} more removed, ${omittedAdded} more added lines) ...`,
		);
	}

	out.push("```");
	return out.join("\n");
}

async function createFile(
	filePath: string,
	fileText: string,
	encoding: BufferEncoding,
	observation?: EditObservation,
): Promise<string> {
	const normalized = normalizeNewFileLineEndings(fileText);
	const pre = observation
		? await observation.measurePreWrite(filePath, undefined)
		: undefined;
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, normalized, {
		encoding,
	});
	observation?.recordIntendedContent(normalized);
	if (observation && pre) {
		const post = await observation.measurePostWrite(filePath, normalized);
		observation.recordMutation(pre, post, {
			added: normalized.split(/\r\n|\n/).length,
			removed: 0,
		});
	}
	return `File created successfully at: ${filePath}`;
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function replaceInFile(
	filePath: string,
	oldStr: string,
	newStr: string | null | undefined,
	encoding: BufferEncoding,
	maxDiffLines: number,
	observation?: EditObservation,
): Promise<string> {
	const content = await fs.readFile(filePath, encoding);
	const eol = detectLineEnding(content);
	const normalizedOldStr = normalizeLineEndings(oldStr, eol);
	const normalizedNewStr = normalizeLineEndings(newStr ?? "", eol);
	const occurrences = countOccurrences(content, normalizedOldStr);

	if (occurrences === 0) {
		throw new EditOperationError(
			`No replacement performed: text not found in ${filePath}.`,
			"text_not_found",
		);
	}

	if (occurrences > 1) {
		throw new EditOperationError(
			`No replacement performed: multiple occurrences of text found in ${filePath}.`,
			"multiple_matches",
		);
	}

	// Replacer function so "$"-sequences in new_text ($&, $', $`, $$, $n)
	// are inserted literally instead of being expanded by String.replace.
	const updated = content.replace(normalizedOldStr, () => normalizedNewStr);
	const pre = observation
		? await observation.measurePreWrite(filePath, content)
		: undefined;
	await fs.writeFile(filePath, updated, { encoding });
	observation?.recordIntendedContent(updated);
	if (observation && pre) {
		const post = await observation.measurePostWrite(filePath, updated);
		observation.recordMutation(pre, post, {
			added: updated.split(/\r\n|\n/).length,
			removed: content.split(/\r\n|\n/).length,
		});
	}

	const diff = createLineDiff(content, updated, maxDiffLines);
	return `Edited ${filePath}\n${diff}`;
}

async function insertInFile(
	filePath: string,
	insertLineOneBased: number,
	newStr: string,
	encoding: BufferEncoding,
	observation?: EditObservation,
): Promise<string> {
	const content = await fs.readFile(filePath, encoding);
	const eol = detectLineEnding(content);
	const lines = content.split(/\r\n|\n/);
	const maxBoundaryLine = lines.length + 1;

	if (insertLineOneBased < 1 || insertLineOneBased > maxBoundaryLine) {
		throw new EditOperationError(
			`Invalid insert_line: ${insertLineOneBased}. insert_line must be a positive one-based boundary line in the range 1-${maxBoundaryLine}. Use ${maxBoundaryLine} to append at EOF.`,
			"invalid_patch",
		);
	}

	const insertLine = insertLineOneBased - 1;
	lines.splice(insertLine, 0, ...newStr.split(/\r\n|\n/));
	const updated = lines.join(eol);
	const pre = observation
		? await observation.measurePreWrite(filePath, content)
		: undefined;
	await fs.writeFile(filePath, updated, { encoding });
	observation?.recordIntendedContent(updated);
	if (observation && pre) {
		const post = await observation.measurePostWrite(filePath, updated);
		observation.recordMutation(pre, post, {
			added: newStr.split(/\r\n|\n/).length,
			removed: 0,
		});
	}

	return `Inserted content at line ${insertLineOneBased} in ${filePath}.`;
}

/**
 * Create an editor executor using Node.js fs module
 */
export function createEditorExecutor(
	options: EditorExecutorOptions = {},
): EditorExecutor {
	const {
		encoding = "utf-8",
		restrictToCwd = true,
		maxDiffLines = 200,
	} = options;

	return async (
		input: EditFileInput,
		cwd: string,
		context: AgentToolContext,
	): Promise<string> => {
		// ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01: the
		// observation channel is OPTIONAL. When the trace is OFF the
		// metadata carries no sink and `readEditObservation` returns
		// undefined, so NO extra read, NO fingerprint and NO allocation
		// happen on the disabled path.
		const observation = readEditObservation(context.metadata, "editor");
		const filePath = resolveFilePath(cwd, input.path, restrictToCwd);

		if (observation) {
			// ACT-CLINEMM-MODEL-BEHAVIOR-EDIT-EFFICIENCY-TRACE01: the RUNTIME
			// is the sole reporter of the "edit requested → authorized"
			// link, because only it knows the authorization state. The
			// executor reports the "mutation applied" link — the only layer
			// that can say what the write actually did.
			observation.setRequestedFileCount(1);
		}

		// ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01 (R2): the
		// DESTINATION is resolved and classified BEFORE the write, so the
		// trace records where the write would land even when the write
		// itself later fails.
		//
		// This is INSIDE the `observation` guard: when the trace is OFF no
		// canonicalization, no `stat` and no extra read happens at all.
		const resolution = observation
			? await resolveEditDestination(
					filePath,
					classifyEditInputPathKind(input.path),
					observation.workspaceRoots,
				)
			: undefined;
		if (observation && resolution) {
			await observation.reportTargetResolution({
				inputPathKind: resolution.inputPathKind,
				absolutePath: resolution.absolutePath,
				destinationScope: resolution.destinationScope,
				canonicalized: resolution.canonicalized,
				existedBefore: resolution.existedBefore,
				...(resolution.underBenchmarkRoot !== undefined
					? { underBenchmarkRoot: resolution.underBenchmarkRoot }
					: {}),
			});
		}

		try {
			const result = await runEditorOperation(
				input,
				filePath,
				encoding,
				maxDiffLines,
				observation,
			);
			observation?.reportApplication("applied", {
				noOp: observation.fileMutations.every(
					(mutation) =>
						mutation.contentVersionPre !== undefined &&
						mutation.contentVersionPre === mutation.contentVersionPost,
				),
				durationMs: observation.elapsedMs(),
			});
			// ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01 (R3): the
			// write is INDEPENDENTLY verified by reading the destination back
			// from disk. The intended content is passed in so the consumer
			// can compare the intended fingerprint against the actual one
			// without re-deriving the intent.
			if (observation) {
				await observation.reportWriteVerification({
					absolutePath: filePath,
					writeReturned: true,
					...(observation.lastIntendedContent !== undefined
						? { intendedContent: observation.lastIntendedContent }
						: {}),
				});
			}
			return result;
		} catch (error) {
			const category = classifyEditFailure(error);
			const outcome =
				category === "timeout"
					? "timed_out"
					: category === "text_not_found" ||
							category === "multiple_matches" ||
							category === "path_rejected" ||
							category === "invalid_patch"
						? "rejected"
						: "failed";
			observation?.reportApplication(outcome, {
				failureCategory: category,
				durationMs: observation.elapsedMs(),
			});
			throw error;
		}
	};
}

/**
 * Run the editor operation against an already-resolved path.
 */
async function runEditorOperation(
	input: EditFileInput,
	filePath: string,
	encoding: BufferEncoding,
	maxDiffLines: number,
	observation?: EditObservation,
): Promise<string> {
	if (input.insert_line != null) {
		return insertInFile(
			filePath,
			input.insert_line, // One-based index
			input.new_text,
			encoding,
			observation,
		);
	}

	if (!(await fileExists(filePath))) {
		return createFile(filePath, input.new_text, encoding, observation);
	}
	if (input.old_text == null) {
		throw new EditOperationError(
			"Parameter `old_text` is required when editing an existing file without `insert_line`",
			"invalid_patch",
		);
	}

	return replaceInFile(
		filePath,
		input.old_text,
		input.new_text,
		encoding,
		maxDiffLines,
		observation,
	);
}
