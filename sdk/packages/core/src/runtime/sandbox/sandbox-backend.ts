/**
 * SandboxBackend dispatcher.
 *
 * Maps a {@link SandboxMode} to a concrete {@link SandboxBackend}
 * instance. Centralizes:
 *
 * 1. The DEFAULT_OFF invariant: `DEFAULT_SANDBOX_MODE === "disabled"`.
 * 2. The fail-closed invariant: when a mode is requested but its
 *    backend is unavailable, the dispatcher returns `undefined`
 *    (signaling "do not run" — the executor is responsible for treating
 *    this as a fail-closed error).
 * 3. The opt-in gate: `seatbelt-experimental` is only constructed when
 *    the caller explicitly passes an `optIn` flag. Without opt-in,
 *    `getSandboxBackend("seatbelt-experimental")` returns `undefined`
 *    so an attacker cannot force the experimental code path by writing
 *    to config alone.
 *
 * The dispatcher itself is stateless; it constructs backends lazily on
 * first request and caches them per-process. This keeps the cost of
 * probing Seatbelt availability off the hot path until the host opts in.
 */

import { noSandboxBackend } from "./no-sandbox-backend";
import type { SandboxBackend, SandboxMode } from "./types";

/**
 * The default sandbox mode. Hardcoded to `"disabled"` so any release
 * artifact built without any setting change behaves exactly as today's
 * installed ClineMM. This is load-bearing.
 */
export const DEFAULT_SANDBOX_MODE: SandboxMode = "disabled";

/**
 * Opt-in gate for experimental modes. The only currently supported
 * opt-in source is the `CLINEMM_EXPERIMENTAL_SANDBOX` env var (see
 * `createSandboxBackendFromEnv` below). Future opt-in sources (a
 * hidden setting, a developer-flag file) can be added here.
 */
export interface SandboxBackendOptIn {
	readonly mode: "seatbelt-experimental";
}

interface CachedBackends {
	seatbelt?: SandboxBackend;
}

const cache: CachedBackends = {};

/**
 * Resolve a {@link SandboxMode} to a concrete backend instance, or
 * `undefined` if no backend applies (or the requested backend is
 * unavailable / not opted in).
 *
 * Return value contract:
 *
 * - `mode === "disabled"` → returns the shared `NoSandboxBackend`
 *   instance. NEVER `undefined`.
 *
 * - `mode === "seatbelt-experimental"`:
 *   - When `optIn` is not provided → returns `undefined`.
 *     The executor MUST treat this as fail-closed: not a fallback to
 *     unsandboxed execution, but a "do not run" signal.
 *   - When `optIn` is provided AND the Seatbelt substrate is available
 *     → returns the cached `SeatbeltSandboxBackendExperimental`.
 *   - When `optIn` is provided but the Seatbelt substrate is NOT
 *     available (non-darwin host, missing binary, probe failure)
 *     → returns `undefined`. Same fail-closed semantics.
 *
 * Lazy Seatbelt import keeps the module from being loaded when the
 * SDK is consumed on non-darwin platforms. The first `seatbelt-experimental`
 * request pays the import cost; subsequent requests hit the cache.
 */
export async function getSandboxBackend(
	mode: SandboxMode,
	optIn?: SandboxBackendOptIn,
): Promise<SandboxBackend | undefined> {
	if (mode === "disabled") {
		return noSandboxBackend;
	}

	if (mode === "seatbelt-experimental") {
		if (!optIn) {
			// Opt-in gate: requested but not authorized.
			return undefined;
		}
		if (!cache.seatbelt) {
			// Lazy import — keeps the Seatbelt-specific code out of the
			// startup path for non-darwin hosts and for users who never
			// opt in.
			const { SeatbeltSandboxBackendExperimental } = await import(
				"./macos/seatbelt-backend"
			);
			cache.seatbelt = SeatbeltSandboxBackendExperimental;
		}
		const available = await cache.seatbelt.isAvailable();
		if (!available) {
			return undefined;
		}
		return cache.seatbelt;
	}

	// Unknown mode (defensive: the union is closed, but future
	// additions must not silently fall through).
	return undefined;
}

/**
 * Convenience: build the opt-in argument from environment variables.
 *
 * The only supported opt-in knob today is `CLINEMM_EXPERIMENTAL_SANDBOX=seatbelt`.
 * Any other value (or unset) means "not opted in" → `getSandboxBackend`
 * returns `undefined` for experimental modes → executor fails closed.
 *
 * This function never throws and is safe to call at startup.
 */
export function readExperimentalSandboxOptIn(): SandboxBackendOptIn | undefined {
	const raw = process.env.CLINEMM_EXPERIMENTAL_SANDBOX;
	if (typeof raw !== "string") return undefined;
	if (raw === "seatbelt") {
		return { mode: "seatbelt-experimental" };
	}
	return undefined;
}
