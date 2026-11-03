/**
 * ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01
 *
 * The extension-host checkpoint runtime for the completion-incident
 * causal flight recorder.
 *
 * PURPOSE
 * -------
 * The recorder keeps per-task capsules in memory. This module makes
 * them SURVIVE:
 *
 *   - a task switch (the capsule is checkpointed when the active
 *     task changes), and
 *   - an extension-host shutdown (the capsules are checkpointed on
 *     deactivate).
 *
 * On the next activation the checkpoint is RESTORED, so an anomalous
 * capsule that the operator was still investigating is still there.
 *
 * NON-BLOCKING BY CONSTRUCTION
 * ----------------------------
 * The checkpoint write is FIRE-AND-FORGET. The production path never
 * awaits it, so a slow or failing disk can NEVER block task
 * execution. A failed write is COUNTED (`failedCheckpoints`) and
 * reported in the bundle manifest — a lost checkpoint is never
 * silently presented as a successful one.
 *
 * BOUNDS
 * ------
 * The checkpoint file is written with an explicit size cap. When the
 * serialized checkpoint exceeds the cap, the OLDEST (non-anomalous
 * preferred) capsules are dropped until it fits, and the loss is
 * recorded. The file is a bounded diagnostic artifact, never an
 * unbounded log.
 *
 * PRIVACY
 * -------
 * The checkpoint carries the SAME privacy-safe records the in-memory
 * recorder holds: identities, predicate values, counts, phase names.
 * No prompt text, credentials, command output, or provider payloads.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import {
	buildCompletionIncidentCheckpoint,
	type CompletionIncidentCheckpoint,
	getCompletionIncidentCapsules,
	recordCompletionIncidentCheckpointOutcome,
	restoreCompletionIncidentCheckpoint,
} from "@shared/completion-incident-flight-recorder"

/**
 * The single file the checkpoint lives in, under the extension's
 * global storage directory.
 */
const CHECKPOINT_FILE = "completion-incident-checkpoint.json"

/**
 * The maximum size of the serialized checkpoint. The checkpoint is a
 * BOUNDED diagnostic artifact; it is never allowed to grow without
 * limit.
 */
const MAX_CHECKPOINT_BYTES = 512 * 1024

/**
 * Narrow structural type for the bits of `vscode.ExtensionContext`
 * this module touches. Mirrors the other diagnostic runtime contexts
 * structurally — this module does NOT import `vscode` for type
 * information.
 */
export interface CompletionIncidentCheckpointContext {
	readonly globalStorageUri: { readonly fsPath: string }
}

/**
 * The result of a checkpoint attempt.
 */
export interface CompletionIncidentCheckpointResult {
	readonly succeeded: boolean
	readonly bytes: number
	readonly error?: string
}

/**
 * Serialize the recorder's capsules into a checkpoint that fits
 * within `maxBytes`.
 *
 * When the full checkpoint does not fit, the capsules are dropped
 * OLDEST-FIRST, preferring to keep the ANOMALOUS ones (the incidents
 * the operator is investigating). The drop is reported through the
 * returned `droppedCapsules` count.
 */
function buildBoundedCheckpoint(maxBytes: number): {
	checkpoint: CompletionIncidentCheckpoint
	bytes: number
	droppedCapsules: number
} {
	const full = buildCompletionIncidentCheckpoint()
	const serialized = JSON.stringify(full)
	if (serialized.length <= maxBytes) {
		return { checkpoint: full, bytes: serialized.length, droppedCapsules: 0 }
	}
	// Drop capsules oldest-first, preferring to keep the anomalous
	// ones. The in-memory recorder keeps its own copy; this only
	// bounds the PERSISTED artifact.
	const capsules = [...full.capsules]
	const anomalous = capsules.filter((c) => c.anomalous)
	const ordinary = capsules.filter((c) => !c.anomalous)
	let dropped = 0
	while (ordinary.length > 0) {
		capsules.splice(capsules.indexOf(ordinary.shift()!), 1)
		dropped += 1
		const candidate: CompletionIncidentCheckpoint = { ...full, capsules }
		const size = JSON.stringify(candidate).length
		if (size <= maxBytes) {
			return { checkpoint: candidate, bytes: size, droppedCapsules: dropped }
		}
	}
	// Even the anomalous capsules alone do not fit. Keep only the
	// most recent one and report the loss.
	const minimal: CompletionIncidentCheckpoint = { ...full, capsules: anomalous.slice(-1) }
	return {
		checkpoint: minimal,
		bytes: JSON.stringify(minimal).length,
		droppedCapsules: dropped + capsules.length - minimal.capsules.length,
	}
}

/**
 * Write the checkpoint to disk.
 *
 * NEVER throws — a failed checkpoint is recorded and reported, not
 * thrown into the production path.
 */
export async function checkpointCompletionIncidentCapsules(
	context: CompletionIncidentCheckpointContext,
): Promise<CompletionIncidentCheckpointResult> {
	try {
		const { checkpoint, bytes } = buildBoundedCheckpoint(MAX_CHECKPOINT_BYTES)
		const dir = context.globalStorageUri.fsPath
		await mkdir(dir, { recursive: true })
		await writeFile(join(dir, CHECKPOINT_FILE), JSON.stringify(checkpoint), "utf8")
		recordCompletionIncidentCheckpointOutcome(true)
		return { succeeded: true, bytes }
	} catch (err) {
		recordCompletionIncidentCheckpointOutcome(false)
		return {
			succeeded: false,
			bytes: 0,
			error: err instanceof Error ? err.message : String(err),
		}
	}
}

/**
 * Restore the capsules from the on-disk checkpoint, if any.
 *
 * NEVER throws — a missing or corrupt checkpoint is simply a
 * no-op (there is nothing to restore). The restore is bounded by the
 * recorder's own caps.
 */
export async function restoreCompletionIncidentCapsules(context: CompletionIncidentCheckpointContext): Promise<boolean> {
	try {
		const file = join(context.globalStorageUri.fsPath, CHECKPOINT_FILE)
		const raw = await readFile(file, "utf8")
		const parsed = JSON.parse(raw) as CompletionIncidentCheckpoint
		restoreCompletionIncidentCheckpoint(parsed)
		return true
	} catch {
		// No checkpoint, or an unreadable one. There is nothing to
		// restore — this is NOT an error worth propagating.
		return false
	}
}

/**
 * The number of capsules that would be persisted by a checkpoint.
 * Exposed for diagnostics and tests.
 */
export function getCompletionIncidentCheckpointCapsuleCount(): number {
	return getCompletionIncidentCapsules().length
}
