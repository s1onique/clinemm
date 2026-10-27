/**
 * ACT-CLINEMM-MODEL-BEHAVIOR-WORKSPACE-EFFECT-TRACE01-CORR01
 *
 * Bounded read-back of ONE destination.
 *
 * WHY THIS MODULE
 * ---------------
 * The original read-back in `edit-observation.ts` used `fs.readFile()` and
 * checked the size limit AFTER the whole file had been buffered into
 * memory. Node documents that `fs.readFile()` reads the file into memory
 * entirely, so a 10 GiB destination made a DIAGNOSTIC allocate far more
 * memory than its 512 KiB budget allows.
 *
 * This module performs a genuinely BOUNDED read: it opens the file, reads
 * at most `limit + 1` bytes, and reports the measurement as skipped when
 * the file is larger than the limit. The file is never loaded whole.
 *
 * It also DISTINGUISHES the failure modes that used to collapse into a
 * single `READBACK_UNAVAILABLE`:
 *
 * - `ENOENT` — the file does not exist. That is a REAL observation
 *   ("absent"), not an unavailable measurement.
 * - `EACCES` / `EPERM` / any other error — the file exists but could not
 *   be read. The measurement is genuinely unavailable, and the reason is
 *   reported as such.
 *
 * PRIVACY
 * -------
 * No content leaves this module. The caller receives the bytes it must
 * fingerprint, and nothing else. The module never retains them.
 */

import * as fs from "node:fs/promises";

/**
 * The maximum number of bytes read back for a content fingerprint.
 *
 * A file larger than this is not content-fingerprinted; only its
 * existence is observed.
 */
export const EDIT_OBSERVATION_MAX_FILE_BYTES = 512 * 1024;

/**
 * The result of ONE bounded read-back.
 */
export type BoundedReadBack =
	| {
			/** The file exists and was read within the limit. */
			readonly kind: "read";
			/** The content that was read, as a UTF-8 string. */
			readonly content: string;
	  }
	| {
			/** The file exists but exceeded the size limit. */
			readonly kind: "too_large";
	  }
	| {
			/** The file does not exist. */
			readonly kind: "absent";
	  }
	| {
			/** The file exists but could not be read. */
			readonly kind: "unreadable";
			/** The POSIX error code, when the platform supplied one. */
			readonly code?: string;
	  };

/**
 * Read at most `limit` bytes of `absolutePath`.
 *
 * The read is BOUNDED: the file descriptor is opened once and at most
 * `limit + 1` bytes are requested, so the memory ceiling holds even for
 * a multi-gigabyte file. Reading one byte past the limit is what makes
 * "exactly at the limit" distinguishable from "over the limit" without
 * a `stat` race.
 *
 * `onBytesRequested` is a TEST SEAM: it reports how many bytes the read
 * actually asked the operating system for. It exists so a witness can
 * assert the RESOURCE bound directly, rather than inferring it from the
 * resulting fingerprint.
 *
 * Never throws: every failure is mapped to a bounded result.
 */
export async function readBackBounded(
	absolutePath: string,
	limit: number = EDIT_OBSERVATION_MAX_FILE_BYTES,
	onBytesRequested?: (bytes: number) => void,
): Promise<BoundedReadBack> {
	// The read is bounded by `limit + 1` bytes, so a file of exactly
	// `limit` bytes reads fully and a file of `limit + 1` bytes is
	// detected as too large.
	const maxBytes = limit + 1;
	let handle: fs.FileHandle | undefined;
	try {
		handle = await fs.open(absolutePath, "r");
		const buffer = Buffer.allocUnsafe(maxBytes);
		onBytesRequested?.(maxBytes);
		const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
		if (bytesRead > limit) {
			return { kind: "too_large" };
		}
		return { kind: "read", content: buffer.toString("utf-8", 0, bytesRead) };
	} catch (error) {
		const code = readErrorCode(error);
		if (code === "ENOENT") {
			// The file is genuinely ABSENT. That is an observation, not
			// a failed measurement.
			return { kind: "absent" };
		}
		return { kind: "unreadable", ...(code !== undefined ? { code } : {}) };
	} finally {
		// The descriptor is always released, even on the failure path.
		try {
			await handle?.close();
		} catch {
			// Closing a descriptor never affects the edit.
		}
	}
}

/**
 * Read the POSIX error code from an unknown thrown value.
 */
function readErrorCode(error: unknown): string | undefined {
	if (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		typeof (error as { code?: unknown }).code === "string"
	) {
		return (error as { code: string }).code;
	}
	return undefined;
}

/**
 * The number of bytes the bounded read is allowed to request from the
 * operating system for ONE read.
 *
 * It is exported so the witness can assert the ceiling directly instead
 * of inferring it from a fingerprint.
 */
export function boundedReadByteCeiling(
	limit: number = EDIT_OBSERVATION_MAX_FILE_BYTES,
): number {
	return limit + 1;
}
