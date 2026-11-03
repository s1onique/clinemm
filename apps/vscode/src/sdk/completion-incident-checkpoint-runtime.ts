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
	recordCompletionIncidentCheckpointTruncation,
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
 *
 * ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION01:
 * Exported so the bound can be asserted by the executable evidence
 * rather than being an unobservable internal constant.
 */
export const MAX_CHECKPOINT_BYTES = 512 * 1024

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
	/** Capsules dropped to fit the byte bound. Evidence loss. */
	readonly droppedCapsules?: number
	/** Records dropped to fit the byte bound. Evidence loss. */
	readonly droppedRecords?: number
	readonly error?: string
}

/**
 * The size of a serialized checkpoint in ACTUAL UTF-8 BYTES.
 *
 * ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION01:
 * The bound was previously enforced with `String.length`, which
 * counts UTF-16 code units — NOT bytes. A checkpoint containing
 * multi-byte characters could therefore exceed the 512-KiB bound on
 * disk while appearing to fit. The bound is now enforced against
 * the real byte length of the UTF-8 encoding, which is exactly what
 * `writeFile(..., "utf8")` persists.
 */
function utf8ByteLength(value: string): number {
	return Buffer.byteLength(value, "utf8")
}

/**
 * Serialize the recorder's capsules into a checkpoint that fits
 * within `maxBytes`.
 *
 * When the full checkpoint does not fit, the capsules are dropped
 * OLDEST-FIRST, preferring to keep the ANOMALOUS ones (the incidents
 * the operator is investigating). The drop is reported through the
 * returned `droppedCapsules` / `droppedRecords` counts.
 *
 * ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION01:
 * The returned checkpoint's OWN `stats` block carries the truncation
 * counts, so the PERSISTED artifact itself records the loss it
 * incurred. Without this, the checkpoint on disk claimed a clean
 * capture while silently having dropped capsules — and a restart
 * restored that clean-looking accounting.
 */
function buildBoundedCheckpoint(maxBytes: number): {
	checkpoint: CompletionIncidentCheckpoint
	bytes: number
	droppedCapsules: number
	droppedRecords: number
} {
	const full = buildCompletionIncidentCheckpoint()

	/**
	 * Fold the truncation counts into the checkpoint's persisted
	 * stats so the artifact carries its own loss accounting.
	 */
	const withTruncationStats = (
		capsules: readonly CompletionIncidentCheckpoint["capsules"][number][],
		droppedCapsules: number,
		droppedRecords: number,
	): CompletionIncidentCheckpoint => ({
		...full,
		capsules,
		stats: {
			...full.stats,
			checkpointTruncatedCapsules: full.stats.checkpointTruncatedCapsules + droppedCapsules,
			checkpointTruncatedRecords: full.stats.checkpointTruncatedRecords + droppedRecords,
		},
	})

	const serialized = JSON.stringify(full)
	if (utf8ByteLength(serialized) <= maxBytes) {
		return { checkpoint: full, bytes: utf8ByteLength(serialized), droppedCapsules: 0, droppedRecords: 0 }
	}
	// Drop capsules oldest-first, preferring to keep the anomalous
	// ones. The in-memory recorder keeps its own copy; this only
	// bounds the PERSISTED artifact.
	const capsules = [...full.capsules]
	const anomalous = capsules.filter((c) => c.anomalous)
	const ordinary = capsules.filter((c) => !c.anomalous)
	let dropped = 0
	let droppedRecords = 0
	while (ordinary.length > 0) {
		const victim = ordinary.shift()!
		capsules.splice(capsules.indexOf(victim), 1)
		dropped += 1
		droppedRecords += victim.records.length
		const candidate = withTruncationStats(capsules, dropped, droppedRecords)
		const size = utf8ByteLength(JSON.stringify(candidate))
		if (size <= maxBytes) {
			return { checkpoint: candidate, bytes: size, droppedCapsules: dropped, droppedRecords }
		}
	}
	// Even the anomalous capsules alone do not fit. Keep only the
	// most recent one and report the loss.
	//
	// ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION02:
	// The single-capsule fallback MUST ALSO satisfy the byte bound.
	// The previous implementation returned that fallback WITHOUT
	// checking its final serialized size, so a single oversized
	// capsule was written to disk OVER the 512-KiB bound — the very
	// limit the bounded builder exists to enforce. The fallback now
	// verifies its size and, when even one capsule is too large,
	// sheds that capsule's RECORDS until it fits (or until nothing
	// remains). The shed records are reported as dropped evidence.
	const kept = anomalous.slice(-1)
	const droppedAnomalous = anomalous.slice(0, -1)
	droppedRecords += droppedAnomalous.reduce((sum, c) => sum + c.records.length, 0)
	const totalDropped = dropped + droppedAnomalous.length
	let minimal = withTruncationStats(kept, totalDropped, droppedRecords)
	let minimalBytes = utf8ByteLength(JSON.stringify(minimal))
	if (minimalBytes > maxBytes && kept.length > 0) {
		// Shed the retained capsule's records, OLDEST first, until the
		// serialized form fits the bound.
		const retained = kept[0]
		if (!retained) {
			return {
				checkpoint: minimal,
				bytes: minimalBytes,
				droppedCapsules: totalDropped,
				droppedRecords,
			}
		}
		//
		// ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION03:
		// The shed count is computed against the ORIGINAL retained
		// record count, NOT against the shrinking working array.
		//
		// The previous implementation derived `shed` from the
		// difference between the working array's current length and
		// the candidate's length — which was ALWAYS 1, because the
		// candidate was produced with `slice(0, -1)` (exactly one
		// element removed). So a checkpoint that had to discard 200
		// records reported `droppedRecords: 1`, understating the
		// evidence loss by 199. The persisted checkpoint's `stats`
		// block carried that same understated number, so the artifact
		// itself declared a clean capture while a large fraction of
		// the incident's causal records had been dropped — a direct
		// violation of the recorder's evidence-accounting contract.
		//
		// The shed count is now CUMULATIVE and exact:
		//     shed = originalCount - retainedRecords.length
		//
		// The records are shed OLDEST-FIRST (`shift()`), which
		// preserves the NEWEST causal records — the ones closest to
		// the incident's terminal state and therefore the most
		// valuable during incident diagnosis. (The previous
		// `slice(0, -1)` dropped the NEWEST record instead.)
		const originalCount = retained.records.length
		const retainedRecords = [...retained.records]
		while (true) {
			const shed = originalCount - retainedRecords.length
			const candidate = withTruncationStats(
				[{ ...retained, records: retainedRecords }],
				totalDropped,
				droppedRecords + shed,
			)
			const size = utf8ByteLength(JSON.stringify(candidate))
			if (size <= maxBytes) {
				minimal = candidate
				minimalBytes = size
				droppedRecords += shed
				break
			}
			if (retainedRecords.length === 0) {
				// Even a capsule with ZERO records does not fit. The
				// checkpoint cannot satisfy the byte bound, so the
				// caller must report a FAILED checkpoint rather than
				// persist an artifact that violates the bound.
				throw new Error("Checkpoint cannot fit within byte bound")
			}
			// Shed the OLDEST retained record, preserving the newest.
			retainedRecords.shift()
		}
	}
	return {
		checkpoint: minimal,
		bytes: minimalBytes,
		droppedCapsules: totalDropped,
		droppedRecords,
	}
}

/**
 * Write the checkpoint to disk.
 *
 * NEVER throws — a failed checkpoint is recorded and reported, not
 * thrown into the production path.
 *
 * ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION01:
 * The TRUNCATION loss is no longer discarded. When the bounded
 * builder dropped capsules to fit the byte bound, the dropped counts
 * are recorded into the recorder's loss accounting so the bundle
 * declares `evidenceLoss: true` instead of presenting a truncated
 * capture as complete.
 */
export async function checkpointCompletionIncidentCapsules(
	context: CompletionIncidentCheckpointContext,
): Promise<CompletionIncidentCheckpointResult> {
	try {
		const { checkpoint, bytes, droppedCapsules, droppedRecords } = buildBoundedCheckpoint(MAX_CHECKPOINT_BYTES)
		const dir = context.globalStorageUri.fsPath
		await mkdir(dir, { recursive: true })
		await writeFile(join(dir, CHECKPOINT_FILE), JSON.stringify(checkpoint), "utf8")
		// ACT-CLINEMM-BCB-CAUSAL-FLIGHT-RECORDER01-CORRECTION01:
		// The truncation loss is no longer discarded. The CUMULATIVE
		// count (as carried in the checkpoint's own `stats` block) is
		// reported so the recorder's loss accounting matches the
		// persisted artifact exactly — and survives a restart.
		recordCompletionIncidentCheckpointTruncation(
			checkpoint.stats.checkpointTruncatedCapsules,
			checkpoint.stats.checkpointTruncatedRecords,
		)
		recordCompletionIncidentCheckpointOutcome(true)
		return { succeeded: true, bytes, droppedCapsules, droppedRecords }
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
