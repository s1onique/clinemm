/**
 * ACT-CLINEMM-BACKGROUND-EXEC-EPERM-LIVE-QUALIFICATION01
 *
 * Unit contract for the shared host-helper socket resolver.
 */
import { describe, expect, it } from "vitest";
import {
	HOST_HELPER_SOCKET_ENV_VAR,
	HOST_HELPER_SOCKET_HOME_RELATIVE_PATH,
	resolveHostHelperSocketPath,
} from "./host-helper-socket";

describe("ACT-CLINEMM-BACKGROUND-EXEC-EPERM-LIVE-QUALIFICATION01: resolveHostHelperSocketPath", () => {
	it("prefers the explicit env override", () => {
		expect(
			resolveHostHelperSocketPath(
				{
					[HOST_HELPER_SOCKET_ENV_VAR]: "/custom/helper.sock",
					HOME: "/home/me",
				},
				"/home/me",
			),
		).toBe("/custom/helper.sock");
	});

	it("falls back to the installer default under HOME", () => {
		expect(resolveHostHelperSocketPath({ HOME: "/home/me" }, "/home/me")).toBe(
			`/home/me/${HOST_HELPER_SOCKET_HOME_RELATIVE_PATH}`,
		);
	});

	it("uses env.HOME when the explicit home argument is omitted", () => {
		expect(resolveHostHelperSocketPath({ HOME: "/home/other" })).toBe(
			`/home/other/${HOST_HELPER_SOCKET_HOME_RELATIVE_PATH}`,
		);
	});

	it("ignores an EMPTY env override (falls through to the default)", () => {
		expect(
			resolveHostHelperSocketPath(
				{ [HOST_HELPER_SOCKET_ENV_VAR]: "" },
				"/home/me",
			),
		).toBe(`/home/me/${HOST_HELPER_SOCKET_HOME_RELATIVE_PATH}`);
	});

	it("returns undefined when neither the env override nor HOME is available", () => {
		expect(resolveHostHelperSocketPath({}, undefined)).toBeUndefined();
		expect(resolveHostHelperSocketPath({ HOME: "" }, "")).toBeUndefined();
	});

	it("resolves the endpoint in the REAL extension-host shape (env var ABSENT)", () => {
		// The GUI launchd domain that starts VS Code / VSCodium does NOT
		// export CLINEMM_HOST_HELPER_SOCKET (verified live). Before the
		// repair, this shape resolved to `undefined`, the provider was
		// undefined, and the EPERM fallback was unreachable.
		const resolved = resolveHostHelperSocketPath(
			{ HOME: "/Users/someone" },
			"/Users/someone",
		);
		expect(resolved).toBe("/Users/someone/.clinemm/host-helper.sock");
	});
});
