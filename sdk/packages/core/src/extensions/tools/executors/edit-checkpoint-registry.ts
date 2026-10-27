/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01-CORR01
 *
 * The EPHEMERAL, IN-MEMORY registry of previously observed edit targets.
 *
 * WHY THIS EXISTS
 * ---------------
 * The `edit_write_verification` event records what an INDEPENDENT read-back
 * observed IMMEDIATELY AFTER an individual write. It is real evidence about
 * the disk state at that instant, but it says NOTHING about whether that
 * state survived the commands that ran afterwards:
 *
 *   T1  native editor writes B     → read-back confirms B on disk
 *   T2  a shell command restores A  → NO native editor event is emitted
 *   T3  the trace is dumped         → the last read-back still says "B"
 *
 * A retained-change classification derived from that last read-back is
 * therefore unsound. The fix is a SEPARATE, EXPLICIT filesystem observation
 * taken at a checkpoint, which needs to know WHICH targets to re-observe.
 *
 * That is what this registry is for.
 *
 * PRIVACY / LIFETIME
 * ------------------
 * The registry holds RAW ABSOLUTE PATHS, and it holds them ONLY IN MEMORY:
 *
 * - the paths are never serialized, never written to disk, and never
 *   reported to the trace sink;
 * - only EPHEMERAL fingerprints (computed by the sink, which owns the key)
 *   ever leave this module;
 * - the registry is scoped to ONE capture and is dropped when the capture
 *   ends;
 * - the repository is NEVER scanned — only the destinations the write layer
 *   actually observed are re-observed.
 *
 * COST
 * ----
 * The registry is a plain `Map` bounded by the number of DISTINCT observed
 * destinations. A patch that touches the same file repeatedly registers it
 * once.
 */

import type {
	ModelBehaviorTraceEditCheckpointTarget,
	ModelBehaviorTraceEditCheckpointTargetState,
} from "@cline/shared";
import {
	readBackBounded,
	type BoundedReadBack,
} from "./edit-write-verification";

/**
 * The fingerprinting seam the registry needs from the sink.
 *
 * It is deliberately narrower than `ModelBehaviorTraceSink`: the registry
 * only ever needs to turn a path into an ephemeral fingerprint and content
 * into an ephemeral fingerprint.
 */
export interface EditCheckpointFingerprinting {
	/** The ephemeral fingerprint of a resolved path. */
	fingerprintFilePath: (resolvedPath: string) => Promise<string | undefined>;
	/** The ephemeral fingerprint of file content. */
	fingerprintFileContent: (content: string) => Promise<string | undefined>;
}

/**
 * One registered target: the RAW PATH (in memory only) plus the ephemeral
 * content fingerprint observed after the last successful write.
 */
interface RegisteredTarget {
	/** The raw absolute path. IN-MEMORY ONLY — never reported. */
	readonly absolutePath: string;
	/**
	 * The ephemeral fingerprint of the content observed by the last
	 * successful post-write read-back.
	 *
	 * ABSENT when the last read-back could not measure the content. The
	 * checkpoint then reports the state but no content fingerprint.
	 */
	readonly lastObservedContentFingerprint?: string;
}

/**
 * The registry of previously observed edit targets.
 */
export class EditCheckpointRegistry {
	/**
	 * The registered targets, keyed by their raw absolute path.
	 *
	 * A `Map` keeps the registration order, so the checkpoint observation
	 * is deterministic.
	 */
	private readonly targets = new Map<string, RegisteredTarget>();

	/**
	 * Register a destination the write layer has observed.
	 *
	 * Registering the same destination again UPDATES the last observed
	 * content fingerprint — the most recent read-back is the one that
	 * matters for a later comparison.
	 */
	register(
		absolutePath: string,
		lastObservedContentFingerprint?: string,
	): void {
		this.targets.set(absolutePath, {
			absolutePath,
			...(lastObservedContentFingerprint !== undefined
				? { lastObservedContentFingerprint }
				: {}),
		});
	}

	/** How many distinct destinations have been observed. */
	get size(): number {
		return this.targets.size;
	}

	/**
	 * Re-observe every registered target and report the result.
	 *
	 * The observation is BOUNDED in the same way the post-write read-back
	 * is: at most `limit + 1` bytes are read per target, and a target
	 * larger than the limit is reported as `present` with its measurement
	 * skipped rather than being loaded whole.
	 */
	async observe(
		fingerprinting: EditCheckpointFingerprinting,
	): Promise<readonly ModelBehaviorTraceEditCheckpointTarget[]> {
		const observed: ModelBehaviorTraceEditCheckpointTarget[] = [];
		for (const target of this.targets.values()) {
			observed.push(await observeTarget(target, fingerprinting));
		}
		return observed;
	}

	/**
	 * Forget every registered target.
	 *
	 * Used when a capture ends, so the raw paths do not outlive it.
	 */
	clear(): void {
		this.targets.clear();
	}
}

/**
 * The EPHEMERAL, IN-MEMORY registry shared by EVERY edit observation in
 * ONE capture.
 *
 * WHY IT IS SHARED
 * ----------------
 * A checkpoint has to re-observe the targets of the WHOLE capture, not
 * just the ones of the tool call that happens to be running when the
 * operator dumps the trace. The observation channel is created per tool
 * call, so the registry cannot live on the observation instance; it lives
 * here, at the capture's scope.
 *
 * LIFETIME
 * --------
 * The registry is reset when a capture is reset (the recorder's `_reset`
 * seam and the trace runtime's `_resetModelBehaviorTrace`). The raw paths
 * therefore never outlive the capture that observed them.
 */
let sharedRegistry = new EditCheckpointRegistry();

/**
 * The shared, capture-scoped checkpoint registry.
 */
export function getEditCheckpointRegistry(): EditCheckpointRegistry {
	return sharedRegistry;
}

/**
 * Drop every registered target.
 *
 * Called when a capture is reset, so the raw paths do not outlive it.
 */
export function resetEditCheckpointRegistry(): void {
	sharedRegistry = new EditCheckpointRegistry();
}

/**
 * Observe ONE registered target.
 */
async function observeTarget(
	target: RegisteredTarget,
	fingerprinting: EditCheckpointFingerprinting,
): Promise<ModelBehaviorTraceEditCheckpointTarget> {
	const fileIdentity = await fingerprinting.fingerprintFilePath(
		target.absolutePath,
	);
	const base = fileIdentity !== undefined ? { fileIdentity } : {};
	const readBack: BoundedReadBack = await readBackBounded(target.absolutePath);
	if (readBack.kind === "absent") {
		return {
			...base,
			state: "absent" as ModelBehaviorTraceEditCheckpointTargetState,
		};
	}
	if (readBack.kind === "too_large") {
		// The target EXISTS but its content is not measured. The state
		// is known; the content comparison is not.
		return {
			...base,
			state: "present" as ModelBehaviorTraceEditCheckpointTargetState,
			measurementSkippedReason: "MEASUREMENT_SKIPPED_SIZE_LIMIT",
		};
	}
	if (readBack.kind === "unreadable") {
		// The target exists but could not be read: the state is
		// genuinely UNKNOWN, never "unchanged".
		return {
			...base,
			state: "unreadable" as ModelBehaviorTraceEditCheckpointTargetState,
			measurementSkippedReason: "READBACK_UNAVAILABLE",
		};
	}
	const contentFingerprint = await fingerprinting.fingerprintFileContent(
		readBack.content,
	);
	return {
		...base,
		state: "present" as ModelBehaviorTraceEditCheckpointTargetState,
		...(contentFingerprint !== undefined ? { contentFingerprint } : {}),
	};
}
