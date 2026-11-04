/**
 * Canonical resolution of the trusted host-helper AF_UNIX endpoint.
 *
 * ACT-CLINEMM-BACKGROUND-EXEC-EPERM-LIVE-QUALIFICATION01
 *
 * WHY THIS EXISTS
 * ---------------
 * The VS Code extension host cannot signal the process groups it owns
 * when the host process tree is inside the IDE's Chromium zygote
 * sandbox: the kernel returns `EPERM` for `kill(-pgid, sig)`. The
 * trusted host helper (a per-user `launchd` LaunchAgent, running
 * outside that sandbox) CAN deliver those signals. The extension only
 * reaches the helper if it knows the helper's socket path.
 *
 * Two production seams need that path and they MUST agree:
 *
 *   1. `apps/vscode/src/sdk/host-helper-pgid-adapter.ts`
 *      `resolveLiveHelperOwnedPgidProvider()` — the EPERM fallback
 *      provider used by `CommandJobManager`.
 *   2. `sdk/packages/core/src/runtime/sandbox/macos/seatbelt-backend.ts`
 *      — emits the exact-socket AF_UNIX rule pair so the sandboxed
 *      CHILD may reach the same endpoint, and re-injects the
 *      endpoint into the child's allow-listed environment.
 *
 * Before this module, BOTH seams read `CLINEMM_HOST_HELPER_SOCKET`
 * from the environment and nothing else. That is correct for the
 * `launchd` agent itself (which sets the variable in its own
 * `EnvironmentVariables` dict) but NOT for the extension host:
 *
 *   - The GUI launchd domain (`gui/<uid>`) that starts VS Code /
 *     VSCodium does NOT export `CLINEMM_HOST_HELPER_SOCKET`.
 *     Verified live: `launchctl print gui/501` lists only `DISPLAY`
 *     and `SSH_AUTH_SOCK` in its domain environment, and
 *     `launchctl getenv CLINEMM_HOST_HELPER_SOCKET` returns empty.
 *   - Consequently the extension host resolved NO socket path, the
 *     provider was `undefined`, the helper was never registered,
 *     and the EPERM fallback was dead code in the real extension.
 *
 * RESOLUTION TIERS
 * ----------------
 * The tiering is the one already established elsewhere in this
 * repository (`tools/macos-host-helper/server.ts` `resolveSocketPath`
 * and `tools/tart-testbed/src/cli.ts` `resolveLaunchdHelperSocket`):
 *
 *   1. `CLINEMM_HOST_HELPER_SOCKET` — explicit override. Wins.
 *   2. `$HOME/.clinemm/host-helper.sock` — the installer's default
 *      (`scripts/macos/clinemm-host-helper`: `SOCKET_PATH="${CLINEMM_HOST_HELPER_SOCKET:-$HOME/.clinemm/host-helper.sock}"`),
 *      which is also the path the LaunchAgent's `Sockets` dict binds.
 *
 * Returning a path does NOT mean the helper is present or reachable:
 * callers still have to connect. This resolver only answers "where
 * would the endpoint be"; it performs no I/O, so it is safe to call
 * from any process on any platform.
 */

/** The environment variable that carries an explicit endpoint override. */
export const HOST_HELPER_SOCKET_ENV_VAR = "CLINEMM_HOST_HELPER_SOCKET";

/**
 * The installer's default endpoint location, relative to the user's
 * home directory. Kept as a separate constant so both the resolver
 * and the tests reference one literal.
 */
export const HOST_HELPER_SOCKET_HOME_RELATIVE_PATH =
	".clinemm/host-helper.sock";

/**
 * Resolve the host-helper AF_UNIX endpoint path.
 *
 * @param env The environment to read. Defaults to `process.env`.
 * @param home The home directory to use for the default tier.
 *             Defaults to `env.HOME`.
 * @returns The absolute socket path, or `undefined` when neither the
 *          env override nor a home directory is available.
 */
export function resolveHostHelperSocketPath(
	env: Record<string, string | undefined> = process.env,
	home: string | undefined = env.HOME,
): string | undefined {
	const fromEnv = env[HOST_HELPER_SOCKET_ENV_VAR];
	if (typeof fromEnv === "string" && fromEnv.length > 0) {
		return fromEnv;
	}
	if (typeof home === "string" && home.length > 0) {
		return `${home}/${HOST_HELPER_SOCKET_HOME_RELATIVE_PATH}`;
	}
	return undefined;
}
