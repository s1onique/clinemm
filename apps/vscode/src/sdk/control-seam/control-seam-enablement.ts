/**
 * ACT-CLINEMM-EMBEDDED-MCP-CONTROL-SEAM-RECON01
 *
 * Enablement resolver for the embedded MCP control seam.
 *
 * DEFAULT OFF. The seam is a diagnostic/observation surface, not a
 * product feature, so it follows the SAME enablement discipline the
 * rest of this repository already uses for its closed-runtime
 * diagnostics (see `dogfood-diagnostic-profile.ts`): a PURE resolver
 * that decides the effective bit, and an activation site that
 * respects the verdict.
 *
 * PRECEDENCE (top wins; deterministic; fail-closed):
 *
 *   1. Explicit env override:
 *        "1" / "true" / "yes"   -> force ON
 *        "0" / "off" / "false"   -> force OFF
 *        anything else / unset    -> falls through to (2)
 *   2. Explicit opt-in file (the "authorization record" written by the
 *      operator / installer). Presence of a well-formed record turns
 *      the seam ON.
 *   3. PUBLIC DEFAULT -> OFF.
 *
 * Why there is no "dogfood -> ON" tier: the seam opens a LOCAL
 * listener that an external process can reach. A build-profile-derived
 * default would mean a developer build silently listens on a socket.
 * The seam must be turned on EXPLICITLY, by someone who asked for it.
 *
 * The resolver is PURE / synchronous / no I/O. The file tier is read
 * by the caller (the activation site), which passes the result in as
 * `optInRecordPresent`.
 */

/** The environment variable that carries the explicit override. */
export const CONTROL_SEAM_ENABLE_ENV_VAR = "CLINEMM_CONTROL_SEAM"

/** The relative name of the opt-in record inside the control-seam directory. */
export const CONTROL_SEAM_OPT_IN_FILE_NAME = "enabled.json"

export type ControlSeamEnableSource = "env-on" | "env-off" | "opt-in-file" | "default-off"

export interface ControlSeamEnableResolution {
	readonly enabled: boolean
	readonly source: ControlSeamEnableSource
}

const TRUTHY = new Set(["1", "true", "yes", "on"])
const FALSY = new Set(["0", "false", "no", "off"])

/**
 * Resolve the effective enablement bit.
 *
 * @param env The environment to read. Defaults to `process.env`.
 * @param optInRecordPresent Whether the operator's explicit opt-in
 *        record was found. The caller performs the (single) file read
 *        so this resolver stays pure.
 */
export function resolveControlSeamEnablement(
	env: NodeJS.ProcessEnv = process.env,
	optInRecordPresent = false,
): ControlSeamEnableResolution {
	const raw = env[CONTROL_SEAM_ENABLE_ENV_VAR]?.trim().toLowerCase()
	if (raw !== undefined && raw.length > 0) {
		if (TRUTHY.has(raw)) {
			return { enabled: true, source: "env-on" }
		}
		if (FALSY.has(raw)) {
			return { enabled: false, source: "env-off" }
		}
		// Garbage -> fall through to the next tier (documented).
	}
	if (optInRecordPresent) {
		return { enabled: true, source: "opt-in-file" }
	}
	return { enabled: false, source: "default-off" }
}
