/**
 * macOS Seatbelt availability probe.
 *
 * `process.platform === "darwin"` is necessary but NOT sufficient.
 * `sandbox-exec` ships with every macOS install but is an
 * undocumented API surface; we want to confirm it is present AND
 * functional on this host before we let the executor enter the
 * sandbox path.
 *
 * The probe runs the absolute minimum Seatbelt profile:
 *
 *     (version 1) (allow default)
 *
 * and runs `/usr/bin/true` under it. We assert:
 *   - `sandbox-exec` is at `/usr/bin/sandbox-exec` (resolves via PATH
 *     lookup at the OS, not a hardcoded path inside our process);
 *   - the probe command exits 0;
 *   - the probe does not exceed a tight wall-clock budget.
 *
 * Any failure returns `false`. The probe is best-effort: callers MUST
 * not let a transient failure cascade. The probe is intentionally
 * synchronous on the `child_process.spawnSync` boundary so it does
 * not block the event loop for long.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * Standard path to `sandbox-exec`. Hardcoded on purpose: it lives at
 * `/usr/bin/sandbox-exec` on every macOS release that ships with the
 * binary, and we want a stable probe target regardless of the
 * developer's PATH.
 */
export const SANDBOX_EXEC_PATH = "/usr/bin/sandbox-exec";

/**
 * Wall-clock budget for the probe. 5 seconds is generous — the
 * minimal `(version 1) (allow default)` profile is sub-millisecond on
 * any sane macOS install — but we leave headroom for slow CI runners.
 */
const PROBE_TIMEOUT_MS = 5_000;

/**
 * The minimum profile used to verify the Seatbelt substrate is
 * functional. Equivalent to "allow everything".
 */
const MINIMAL_PROBE_PROFILE = "(version 1) (allow default)";

/**
 * Cached probe result, so we only run the probe once per process.
 * The cache is invalidated implicitly on process restart, which is
 * fine: the host's Seatbelt substrate does not change at runtime.
 */
let cachedResult: boolean | undefined;

/**
 * Reset the cached probe result. Test-only.
 */
export function _resetSeatbeltAvailabilityCache(): void {
	cachedResult = undefined;
}

/**
 * Probe whether `sandbox-exec` is present and functional on this host.
 *
 * Returns `true` iff:
 *   - `process.platform === "darwin"`;
 *   - the binary exists at `/usr/bin/sandbox-exec`;
 *   - the probe run (`/usr/bin/sandbox-exec -p '<profile>' /usr/bin/true`)
 *     exits 0 within the budget.
 *
 * Returns `false` otherwise (including on non-darwin hosts, missing
 * binary, probe failure, timeout, or any error).
 */
export function probeSeatbeltAvailability(): boolean {
	if (cachedResult !== undefined) {
		return cachedResult;
	}

	if (process.platform !== "darwin") {
		cachedResult = false;
		return false;
	}

	if (!existsSync(SANDBOX_EXEC_PATH)) {
		cachedResult = false;
		return false;
	}

	try {
		const result = spawnSync(
			SANDBOX_EXEC_PATH,
			["-p", MINIMAL_PROBE_PROFILE, "/usr/bin/true"],
			{
				stdio: "ignore",
				timeout: PROBE_TIMEOUT_MS,
				// Do not inherit env into a probe child; we just want
				// to know whether the kernel Seatbelt accepts the profile.
				env: {
					PATH: "/usr/bin:/bin",
				},
			},
		);

		if (result.error) {
			cachedResult = false;
			return false;
		}

		const ok =
			result.status === 0 &&
			result.signal === null;
		cachedResult = ok;
		return ok;
	} catch {
		// Any synchronous throw from spawnSync (extremely rare on POSIX,
		// but possible on EAGAIN, etc.) is a "not available" result.
		cachedResult = false;
		return false;
	}
}
